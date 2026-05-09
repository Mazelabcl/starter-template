// dashboard/server.js
// Servidor HTTP nativo (cero deps) para el dashboard de observabilidad multi-agente.
// Endpoints:
//   GET  /api/state    → state.json + derivados de memory.summarize() + contratos declarados
//   GET  /api/events   → Server-Sent Events: emite cuando state.json cambia (fs.watch)
//   POST /api/state    → merge atómico contra state.json (validación básica)
//   GET  /api/history  → últimos 100 eventos persistidos
//   GET  /             → archivos estáticos en dashboard/public/
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
const CONTRACTS_DIR = join(REPO_ROOT, 'contracts', 'declared');
const PORT = parseInt(process.env.DASHBOARD_PORT || '7777', 10);
const HISTORY_LIMIT = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

function normalizeState(s) {
  const base = emptyState();
  return {
    session_id: s.session_id || base.session_id,
    session_started_at: s.session_started_at || base.session_started_at,
    active_tasks: Array.isArray(s.active_tasks) ? s.active_tasks : [],
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

  try {
    if (method === 'GET' && path === '/api/state') {
      const snap = buildSnapshot();
      sendJSON(res, 200, snap);
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
