// dashboard/server.js
// Servidor HTTP nativo (cero deps) para el dashboard de observabilidad multi-agente.
// Endpoints:
//   GET  /api/state       → state.json + derivados de memory.summarize() + contratos declarados
//   GET  /api/events      → Server-Sent Events: emite cuando state.json cambia (fs.watch)
//   POST /api/state       → merge atómico contra state.json (validación básica)
//   GET  /api/history     → últimos 100 eventos persistidos
//   GET  /                → archivos estáticos en dashboard/public/ (HTML plano)
//
// Modo público: DASHBOARD_PUBLIC=1 activa whitelist de métodos (GET/HEAD/OPTIONS).
// Cualquier otro método → 403 read-only. Aplica ANTES de los handlers.
//
// Diseño: http nativo, fs.watch + dedup por mtime, atomic write (tmp + rename).

import http from 'node:http';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
  watch,
  appendFileSync,
} from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

import { summarize } from '../src/memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const STATE_PATH = join(__dirname, 'state.json');
const PUBLIC_DIR = join(__dirname, 'public');
const HISTORY_DIR = join(__dirname, 'history');
const HISTORY_LOG = join(HISTORY_DIR, 'events.log');
const CHAT_LOG_PATH = join(__dirname, 'chat-log.jsonl');
const CONTRACTS_DIR = join(REPO_ROOT, 'contracts', 'declared');
const PORT = parseInt(process.env.DASHBOARD_PORT || '7777', 10);
const HISTORY_LIMIT = 100;
const CHAT_HISTORY_LIMIT = 200;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

// ---------- estado inicial / lectura defensiva ----------

function emptyState() {
  return {
    session_id: randomUUID(),
    session_started_at: new Date().toISOString(),
    active_tasks: [],
    events: [],
    metrics: {
      total_tokens_session: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      councils_invoked: 0,
      images_generated: 0,
    },
    active_skills: [],
    current_sprint: { number: 0, objective: '(sin sprint declarado)' },
  };
}

export function readState() {
  if (!existsSync(STATE_PATH)) {
    // Si no existe, retornamos estado inicial sin escribirlo:
    // el primer POST/update lo materializa.
    return emptyState();
  }
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    if (!raw.trim()) return emptyState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (e) {
    // Archivo corrupto: log y retorno estado inicial. No crasheamos el server.
    console.error(`[dashboard] state.json corrupto, usando estado inicial: ${e.message}`);
    return emptyState();
  }
}

// v2: completa campos opcionales en cada task con defaults seguros (no toca disco).
function ensureTaskV2Fields(task) {
  if (!task || typeof task !== 'object') return task;
  if (task.role_full === undefined) task.role_full = task.agent_role || null;
  if (task.summary === undefined) task.summary = null;
  if (task.origin === undefined) task.origin = null;
  if (task.gate === undefined) task.gate = null;
  if (!Array.isArray(task.artifacts)) task.artifacts = [];
  if (typeof task.review_worthy !== 'boolean') task.review_worthy = false;
  if (task.review_reason === undefined) task.review_reason = null;
  if (typeof task.review_seen !== 'boolean') task.review_seen = false;
  // v2.1 (fase 6 expandida): drill-down opcional para el side panel.
  if (task.prompt_brief === undefined) task.prompt_brief = null;
  if (!Array.isArray(task.plan_steps)) task.plan_steps = [];
  if (typeof task.current_step !== 'number' || !Number.isInteger(task.current_step) || task.current_step < 0) {
    task.current_step = 0;
  }
  // v2.2 (fase 7): agrupación organizativa por fase y épica. Default null.
  if (task.phase === undefined) task.phase = null;
  if (task.epic === undefined) task.epic = null;
  // v2.3 (Sprint v3.1): asociación al sprint vivo. Default null.
  if (task.sprint_number === undefined) task.sprint_number = null;
  if (task.sprint_number !== null && (!Number.isInteger(task.sprint_number) || task.sprint_number < 0)) {
    task.sprint_number = null;
  }
  return task;
}

function normalizeState(s) {
  const base = emptyState();
  const tasks = Array.isArray(s.active_tasks) ? s.active_tasks : [];
  return {
    session_id: s.session_id || base.session_id,
    session_started_at: s.session_started_at || base.session_started_at,
    active_tasks: tasks.map(ensureTaskV2Fields),
    events: Array.isArray(s.events) ? s.events : [],
    metrics: { ...base.metrics, ...(s.metrics || {}) },
    active_skills: Array.isArray(s.active_skills) ? s.active_skills : [],
    current_sprint: s.current_sprint && typeof s.current_sprint === 'object'
      ? s.current_sprint
      : base.current_sprint,
  };
}

// ---------- escritura atómica ----------

export function writeStateAtomic(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    renameSync(tmp, STATE_PATH);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

// ---------- history log (NDJSON append-only) ----------

function appendHistory(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  mkdirSync(HISTORY_DIR, { recursive: true });
  const lines = events.map(ev => JSON.stringify(ev)).join('\n') + '\n';
  appendFileSync(HISTORY_LOG, lines, 'utf8');
}

function readHistoryTail(limit = HISTORY_LIMIT) {
  if (!existsSync(HISTORY_LOG)) return [];
  // Lectura simple: archivo estará acotado en práctica (rotación pendiente).
  const raw = readFileSync(HISTORY_LOG, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-limit);
  const parsed = [];
  for (const line of tail) {
    try { parsed.push(JSON.parse(line)); } catch { /* skip línea corrupta */ }
  }
  return parsed;
}

// ---------- chat log (NDJSON append-only) ----------
// Sprint v3.1: chat público orquestador ↔ agentes. Cada entry es un objeto:
//   { from, to, message, timestamp }
// Persiste en dashboard/chat-log.jsonl. Endpoint POST /api/chat lo escribe Y
// emite por SSE como evento `chat-msg`. El frontend lo renderiza con avatares
// pixel-art. NO se mezcla con events.log porque chat tiene shape distinto y
// volumen propio.

function sanitizeChatField(v, max = 4000) {
  if (typeof v !== 'string') return '';
  // Strip caracteres de control (excepto \n \t) y limita longitud.
  const cleaned = v.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function appendChatEntry(entry) {
  mkdirSync(dirname(CHAT_LOG_PATH), { recursive: true });
  appendFileSync(CHAT_LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

function readChatTail(limit = CHAT_HISTORY_LIMIT) {
  if (!existsSync(CHAT_LOG_PATH)) return [];
  const raw = readFileSync(CHAT_LOG_PATH, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-limit);
  const parsed = [];
  for (const line of tail) {
    try { parsed.push(JSON.parse(line)); } catch { /* skip línea corrupta */ }
  }
  return parsed;
}

// ---------- merge POST /api/state ----------
// Política: campos escalares (session_id, current_sprint) reemplazan;
// arrays (active_tasks, active_skills, events) reemplazan si vienen en el patch;
// metrics hace shallow merge sumando solo lo que el cliente mande explícito.
// Si el patch trae events nuevos, también los append-ea al history log.

function applyPatch(current, patch) {
  if (!patch || typeof patch !== 'object') {
    throw new Error('payload debe ser objeto JSON');
  }
  const out = { ...current };

  if (patch.session_id !== undefined) out.session_id = String(patch.session_id);
  if (patch.session_started_at !== undefined) out.session_started_at = String(patch.session_started_at);

  if (patch.active_tasks !== undefined) {
    if (!Array.isArray(patch.active_tasks)) {
      throw new Error('active_tasks debe ser array');
    }
    out.active_tasks = patch.active_tasks;
  }

  let newEvents = [];
  if (patch.events !== undefined) {
    if (!Array.isArray(patch.events)) {
      throw new Error('events debe ser array');
    }
    // Detectamos eventos nuevos por timestamp+type para append al history.
    const known = new Set(current.events.map(e => `${e.timestamp}|${e.type}`));
    newEvents = patch.events.filter(e => !known.has(`${e.timestamp}|${e.type}`));
    out.events = patch.events;
  }

  if (patch.metrics && typeof patch.metrics === 'object') {
    out.metrics = { ...out.metrics, ...patch.metrics };
  }

  if (patch.active_skills !== undefined) {
    if (!Array.isArray(patch.active_skills)) {
      throw new Error('active_skills debe ser array');
    }
    out.active_skills = patch.active_skills;
  }

  if (patch.current_sprint !== undefined) {
    out.current_sprint = patch.current_sprint;
  }

  return { merged: out, newEvents };
}

// ---------- contratos declarados ----------

function listDeclaredContracts() {
  if (!existsSync(CONTRACTS_DIR)) return [];
  try {
    return readdirSync(CONTRACTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  } catch (e) {
    console.error(`[dashboard] no pude listar contracts/declared: ${e.message}`);
    return [];
  }
}

// ---------- snapshot completo /api/state ----------

function buildSnapshot() {
  const state = readState();
  let memory = null;
  try {
    memory = summarize();
  } catch (e) {
    memory = { error: `summarize() falló: ${e.message}` };
  }
  return {
    ...state,
    derived: {
      memory_snapshot: memory,
      declared_contracts: listDeclaredContracts(),
      uptime_seconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
    },
  };
}

// ---------- HTTP helpers ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function send404(res, msg) {
  sendJSON(res, 404, { error: msg || 'not found' });
}

function send500(res, msg) {
  sendJSON(res, 500, { error: msg || 'error interno del servidor' });
}

function readRequestBody(req, limitBytes = 1_000_000) {
  return new Promise((resolveP, rejectP) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > limitBytes) {
        rejectP(new Error(`payload demasiado grande (>${limitBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectP);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  // Path traversal guard.
  if (rel.includes('..')) return send404(res, 'ruta inválida');
  const filePath = join(PUBLIC_DIR, rel);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return send404(res, `archivo no encontrado: ${rel}`);
  }
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const data = readFileSync(filePath);
  res.writeHead(200, {
    ...CORS,
    'Content-Type': mime,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

// v2: /files/<path-relativo-al-repo> sirve archivos del repo bajo subcarpetas
// permitidas (resuelto contra REPO_ROOT) con guard de path-traversal y
// whitelist explícita. Sin esto los chips de "entregable" en las task cards no
// podrían abrir los outputs reales.
//
// Política:
//   - Solo lectura, nunca escribe.
//   - Path traversal bloqueado (rechaza `..`).
//   - Whitelist de raíces (DASHBOARD_FILES_ALLOW env var sobrescribe la lista).
//     Por defecto: content/, councils/results/, dashboard/public/, memory/,
//     contracts/declared/, roadmap/, process-log/, docs/.
//   - Bloquea archivos sensibles por nombre/ruta: .env, .git, node_modules,
//     dashboard/state.json (privado), dashboard/history (privado),
//     .cache (privado).
//
// Cuando el dashboard se expone fuera de localhost, restringir aún más vía
// DASHBOARD_FILES_ALLOW="content,councils/results" o usar un proxy con auth.
const DEFAULT_FILES_ALLOW = [
  'content',
  'councils/results',
  'dashboard/public',
  'memory',
  'contracts/declared',
  'contracts/schemas',
  'roadmap',
  'process-log',
  'docs',
];
const FILES_ALLOW = (process.env.DASHBOARD_FILES_ALLOW || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const FILES_ALLOW_LIST = FILES_ALLOW.length > 0 ? FILES_ALLOW : DEFAULT_FILES_ALLOW;
// Subcadenas que nunca deben aparecer en una ruta servida (block list dura).
const FILES_BLOCK_SUBSTRINGS = [
  '.env', '.git/', 'node_modules/', 'dashboard/state.json',
  'dashboard/history/', '.cache/', '.claude/',
];

function isPathAllowed(relNormalized) {
  // Verifica whitelist + blocklist. relNormalized usa forward slashes.
  for (const block of FILES_BLOCK_SUBSTRINGS) {
    if (relNormalized.includes(block)) return false;
  }
  for (const allow of FILES_ALLOW_LIST) {
    const a = allow.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!a) continue;
    if (relNormalized === a) return true;
    if (relNormalized.startsWith(a + '/')) return true;
  }
  return false;
}

function serveRepoFile(req, res, encodedRel) {
  let rel;
  try {
    rel = decodeURIComponent(encodedRel || '');
  } catch {
    return send404(res, 'path inválido');
  }
  if (!rel || rel.length > 600) return send404(res, 'path inválido');
  // Normalizamos backslashes de Windows a forward, y bloqueamos anti-traversal.
  rel = rel.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  if (rel.includes('..')) return send404(res, 'path inválido (..)');
  // Whitelist + blocklist check ANTES de tocar disco.
  if (!isPathAllowed(rel)) {
    return send404(res, `path fuera de la whitelist: ${rel}`);
  }
  const root = resolve(REPO_ROOT);
  const target = resolve(root, rel);
  // Guard: el resolved path tiene que vivir dentro del repo root.
  const sep = process.platform === 'win32' ? '\\' : '/';
  if (target !== root && !target.startsWith(root + sep) && !target.startsWith(root + '/')) {
    return send404(res, 'path fuera del repo');
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return send404(res, `archivo no encontrado: ${rel}`);
  }
  const ext = extname(target).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const data = readFileSync(target);
  res.writeHead(200, {
    ...CORS,
    'Content-Type': mime,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

// ---------- read-only public mode ----------
// DASHBOARD_PUBLIC=1 → whitelist de métodos GET/HEAD/OPTIONS. Cualquier otro
// método rechaza con 403 ANTES de entrar a los handlers. Esto cubre futuros
// endpoints mutantes sin tener que recordar agregar 403 en cada uno.
const DASHBOARD_PUBLIC = process.env.DASHBOARD_PUBLIC === '1';
const PUBLIC_METHOD_WHITELIST = new Set(['GET', 'HEAD', 'OPTIONS']);

// ---------- SSE stream ----------

const sseClients = new Set();

function sseBroadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* ignore */ }
  }
}

function attachSSE(req, res) {
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, ts: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  // Heartbeat cada 25s para evitar que proxies cierren la conexión.
  const hb = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* ignore */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(hb);
    sseClients.delete(res);
  });
}

// ---------- watcher de state.json ----------

let lastMtimeMs = 0;
let watcherSetup = false;
let watcherHandle = null;

function setupWatcher() {
  if (watcherSetup) return;
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  // fs.watch sobre el directorio (más confiable que sobre el archivo en Windows).
  watcherHandle = watch(dirname(STATE_PATH), (eventType, filename) => {
    if (filename !== 'state.json') return;
    if (!existsSync(STATE_PATH)) return;
    let mt;
    try { mt = statSync(STATE_PATH).mtimeMs; } catch { return; }
    if (mt === lastMtimeMs) return; // dedup
    lastMtimeMs = mt;
    sseBroadcast('state', { ts: new Date().toISOString() });
  });
  // unref() permite que el proceso termine si solo el watcher mantiene el loop vivo
  // (importante para tests: evita que process.exit dispare la assertion de libuv).
  if (watcherHandle && typeof watcherHandle.unref === 'function') {
    watcherHandle.unref();
  }
  if (existsSync(STATE_PATH)) {
    try { lastMtimeMs = statSync(STATE_PATH).mtimeMs; } catch { /* ignore */ }
  }
  watcherSetup = true;
}

export function closeWatcher() {
  if (watcherHandle) {
    try { watcherHandle.close(); } catch { /* ignore */ }
    watcherHandle = null;
    watcherSetup = false;
  }
}

// ---------- request handler ----------

const SERVER_STARTED_AT = Date.now();

// ---------- /api/sprint ----------
// Lee roadmap/current-sprint.json y lo devuelve tal cual. Si no existe o es
// inválido, devuelve {} con 200 — el frontend lo trata como "sin sprint activo".
// El shape del sprint vive en src/roadmap.js (función readSprint). Esto evita
// que el frontend tenga que adivinar el path o duplicar defaults defensivos.
const SPRINT_PATH = join(REPO_ROOT, 'roadmap', 'current-sprint.json');

function readSprintFile() {
  if (!existsSync(SPRINT_PATH)) return {};
  try {
    const raw = readFileSync(SPRINT_PATH, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[dashboard] /api/sprint: no pude leer current-sprint.json: ${e.message}`);
    return {};
  }
}

// ---------- /api/roadmap ----------
// Devuelve { markdown: <contenido literal de roadmap/roadmap.md> }. Si no existe,
// retorna { markdown: "" } con 200. El frontend lo renderiza con un mini-parser
// XSS-safe (textContent-only) en panel.js — no servimos HTML pre-renderizado.
const ROADMAP_MD_PATH = join(REPO_ROOT, 'roadmap', 'roadmap.md');

function readRoadmapMarkdown() {
  if (!existsSync(ROADMAP_MD_PATH)) return '';
  try {
    return readFileSync(ROADMAP_MD_PATH, 'utf8');
  } catch (e) {
    console.warn(`[dashboard] /api/roadmap: no pude leer roadmap.md: ${e.message}`);
    return '';
  }
}

// ---------- /api/sprints/history ----------
// Parsea memory/sprint-log.md a un array estructurado de sprints cerrados.
//
// Shape de parser (best-effort, defensivo):
//   - Cada sprint vive bajo un header `## Sprint <N>` o `## Sprint <N> — <título>`.
//     Tomamos N como número entero. Si no parsea, el sprint se descarta.
//   - Dentro del bloque, buscamos los siguientes subheaders (case-insensitive,
//     español neutro):
//       * "Objetivo" → string en la siguiente línea o párrafo.
//       * "Fechas" / "Dates" → si trae `inicio: YYYY-MM-DD` y `fin: YYYY-MM-DD`
//         (o `start`/`end`), los extrae. Si no, dates queda en {}.
//       * "Entregables" / "Deliverables" → lista con bullets `-` o `*`.
//       * "Lessons" / "Lecciones" → idem.
//   - Si el archivo no existe → retorna [].
//   - Si el archivo existe pero no matchea ningún header → retorna [].
//
// El parser es deliberadamente conservador. Si el formato evoluciona, se ajusta
// acá. La verdad estructurada futura podría vivir como JSON, pero por ahora
// `addSprint()` de memory.js escribe markdown.
const SPRINT_LOG_PATH = join(REPO_ROOT, 'memory', 'sprint-log.md');

function parseSprintLogMarkdown(md) {
  if (typeof md !== 'string' || !md.trim()) return [];
  // Split por headers `## Sprint <N>...`. Mantenemos el header capturado para
  // saber qué número es. Usamos un regex de split con grupo.
  const re = /^##\s+Sprint\s+(\d+)(.*)$/gmi;
  const sprints = [];
  const positions = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    positions.push({ start: m.index, headerEnd: m.index + m[0].length, number: parseInt(m[1], 10), titleTail: m[2] || '' });
  }
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const blockEnd = i + 1 < positions.length ? positions[i + 1].start : md.length;
    const body = md.slice(cur.headerEnd, blockEnd);
    const number = cur.number;
    if (!Number.isFinite(number)) continue;
    // Extraemos el objetivo del titleTail si tiene formato `— <texto>` o `: <texto>`.
    let objective = '';
    const titleMatch = cur.titleTail.match(/^\s*[—:\-]\s*(.+?)\s*$/);
    if (titleMatch && titleMatch[1]) {
      objective = titleMatch[1].trim();
    }
    // Si el titleTail no trae el objetivo, buscamos un sub-bloque "Objetivo".
    const objBlock = extractSubBlock(body, /^(?:###?\s+|\*\*)?(?:Objetivo|Objective)\b/i);
    if (!objective && objBlock) {
      // Toma la primera línea no-vacía del bloque objetivo.
      const firstLine = objBlock.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
      if (firstLine) objective = firstLine;
    }
    // Fechas: buscamos un sub-bloque con keywords o líneas inline.
    let dates = {};
    const datesBlock = extractSubBlock(body, /^(?:###?\s+|\*\*)?(?:Fechas|Dates)\b/i);
    const datesSource = datesBlock || body;
    const startMatch = datesSource.match(/\b(?:inicio|start)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i);
    const endMatch = datesSource.match(/\b(?:fin|end)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i);
    if (startMatch) dates.start = startMatch[1];
    if (endMatch) dates.end = endMatch[1];
    // Entregables y lessons: extraemos sub-bloques y parseamos bullets.
    const deliverablesBlock = extractSubBlock(body, /^(?:###?\s+|\*\*)?(?:Entregables|Deliverables)\b/i);
    const lessonsBlock = extractSubBlock(body, /^(?:###?\s+|\*\*)?(?:Lessons|Lecciones)\b/i);
    sprints.push({
      number,
      objective,
      dates,
      deliverables: extractBullets(deliverablesBlock),
      lessons: extractBullets(lessonsBlock),
    });
  }
  // Orden descendente por número de sprint (lo más reciente primero).
  sprints.sort((a, b) => b.number - a.number);
  return sprints;
}

// Extrae el cuerpo entre un sub-header que matchea `headerRe` y el siguiente
// header (cualquier `## ` o `### `) o el fin del bloque. Devuelve null si no
// encuentra el sub-header.
function extractSubBlock(body, headerRe) {
  const lines = body.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i].trim())) { startIdx = i + 1; break; }
  }
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+/.test(t) || /^###\s+/.test(t) || /^\*\*[^*]+\*\*\s*$/.test(t)) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

function extractBullets(block) {
  if (!block || typeof block !== 'string') return [];
  return block.split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*]\s+/.test(l))
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function readSprintHistory() {
  if (!existsSync(SPRINT_LOG_PATH)) return [];
  try {
    const raw = readFileSync(SPRINT_LOG_PATH, 'utf8');
    return parseSprintLogMarkdown(raw);
  } catch (e) {
    console.warn(`[dashboard] /api/sprints/history: no pude leer sprint-log.md: ${e.message}`);
    return [];
  }
}

// Exportamos los parsers internos para los tests.
export { parseSprintLogMarkdown, readSprintHistory, readRoadmapMarkdown };
export { readChatTail, appendChatEntry, sanitizeChatField, CHAT_LOG_PATH };

function handleRequest(req, res) {
  const t0 = Date.now();
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const path = urlObj.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // Read-only public mode: whitelist de métodos.
  if (DASHBOARD_PUBLIC && !PUBLIC_METHOD_WHITELIST.has(method)) {
    return sendJSON(res, 403, { error: 'read-only mode' });
  }

  try {
    if ((method === 'GET' || method === 'HEAD') && path === '/api/sprint') {
      const sprint = readSprintFile();
      const body = JSON.stringify(sprint, null, 2);
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
      return;
    }
    if ((method === 'GET' || method === 'HEAD') && path === '/api/roadmap') {
      const body = JSON.stringify({ markdown: readRoadmapMarkdown() });
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
      return;
    }
    if ((method === 'GET' || method === 'HEAD') && path === '/api/sprints/history') {
      const body = JSON.stringify(readSprintHistory());
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
      return;
    }
    if (method === 'POST' && path === '/api/chat') {
      // Sprint v3.1: endpoint del chat público orquestador ↔ agentes.
      readRequestBody(req, 200_000).then(raw => {
        let body;
        try { body = JSON.parse(raw || '{}'); }
        catch (e) { return sendJSON(res, 400, { error: `JSON inválido: ${e.message}` }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return sendJSON(res, 400, { error: 'payload debe ser objeto' });
        }
        const from = sanitizeChatField(body.from, 80);
        const to = sanitizeChatField(body.to, 80);
        const message = sanitizeChatField(body.message, 4000);
        if (!from || !to || !message) {
          return sendJSON(res, 400, { error: 'from, to y message son requeridos y deben ser strings no vacíos' });
        }
        const timestamp = (typeof body.timestamp === 'string' && body.timestamp)
          ? body.timestamp
          : new Date().toISOString();
        const entry = { from, to, message, timestamp };
        try {
          appendChatEntry(entry);
          sseBroadcast('chat-msg', entry);
          sendJSON(res, 200, { ok: true });
        } catch (e) {
          sendJSON(res, 500, { error: `no pude persistir chat: ${e.message}` });
        }
      }).catch(e => sendJSON(res, 400, { error: e.message }));
      return;
    }
    if ((method === 'GET' || method === 'HEAD') && path === '/api/chat/history') {
      const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || CHAT_HISTORY_LIMIT, 10) || CHAT_HISTORY_LIMIT, 1000);
      const body = JSON.stringify({ messages: readChatTail(limit) });
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
      return;
    }
    if ((method === 'GET' || method === 'HEAD') && path === '/api/state') {
      const snap = buildSnapshot();
      const body = JSON.stringify(snap, null, 2);
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
    } else if (method === 'POST' && path === '/api/state') {
      readRequestBody(req).then(raw => {
        let patch;
        try { patch = JSON.parse(raw || '{}'); }
        catch (e) { return sendJSON(res, 400, { error: `JSON inválido: ${e.message}` }); }
        try {
          const current = readState();
          const { merged, newEvents } = applyPatch(current, patch);
          writeStateAtomic(merged);
          if (newEvents.length) appendHistory(newEvents);
          sendJSON(res, 200, { ok: true, written: true, new_events: newEvents.length });
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
        }
      }).catch(e => sendJSON(res, 400, { error: e.message }));
    } else if (method === 'GET' && path === '/api/events') {
      attachSSE(req, res);
    } else if (method === 'GET' && path === '/api/history') {
      const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || HISTORY_LIMIT, 10) || HISTORY_LIMIT, 1000);
      sendJSON(res, 200, { events: readHistoryTail(limit) });
    } else if (method === 'GET' && path.startsWith('/files/')) {
      // v2: sirve cualquier archivo del repo para preview/descarga desde las cards.
      const encodedRel = path.slice('/files/'.length);
      serveRepoFile(req, res, encodedRel);
    } else if (method === 'GET') {
      serveStatic(req, res, path);
    } else {
      send404(res, `${method} ${path} no soportado`);
    }
  } catch (e) {
    send500(res, e.message);
  } finally {
    res.on('finish', () => {
      const ms = Date.now() - t0;
      // No logueamos SSE finalizadas (siempre largas).
      if (path !== '/api/events') {
        console.log(`[dashboard] ${method} ${path} ${res.statusCode} ${ms}ms`);
      }
    });
  }
}

// ---------- bootstrap ----------

export function startServer(port = PORT) {
  setupWatcher();
  const server = http.createServer(handleRequest);
  return new Promise((resolveP, rejectP) => {
    server.on('error', rejectP);
    server.listen(port, () => {
      const addr = server.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`[dashboard] escuchando en http://localhost:${realPort}`);
      console.log(`[dashboard] state: ${STATE_PATH}`);
      console.log(`[dashboard] public: ${PUBLIC_DIR}`);
      resolveP({ server, port: realPort });
    });
  });
}

// Si se ejecuta directo (no importado), arranca el servidor.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  startServer().catch(e => {
    console.error(`[dashboard] no pude arrancar: ${e.message}`);
    process.exit(1);
  });
}
