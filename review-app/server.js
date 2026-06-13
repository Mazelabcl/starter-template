// review-app/server.js
// Local HTTP app for reviewing sprint blocks (typically PRs / audit findings).
// Zero deps — uses only node:http, node:fs.
//
// Sprint v3.1 — promoted from audit-master/review-app/ with refactors:
//   - Endpoints regex \d+ (no hardcoded [1-4]).
//   - Dynamic sprint detection: scan dataDir for `sprint<N>-prs`.
//   - Dynamic bloque detection: readdir + regex per sprint.
//   - Hot-reload of parser cache via fs.watch + mtime dedup.
//   - Cross-project via --data-dir or REVIEW_APP_DATA_DIR.
//
// Usage:
//   node review-app/server.js
//   node review-app/server.js --data-dir /path/to/audit
//   REVIEW_APP_DATA_DIR=/path/to/audit node review-app/server.js

import http from 'node:http';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  watch,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import '../src/load_env.js'; // idempotent .env loader

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = parseInt(process.env.REVIEW_APP_PORT || '7788', 10);
// Por defecto la review-app solo escucha en loopback (127.0.0.1) — NO en todas
// las interfaces. Para exponerla a la LAN (opt-in consciente), setea
// REVIEW_APP_HOST=0.0.0.0 (o la IP de la interfaz deseada). Sin esa env var, no
// es alcanzable desde otras máquinas de la red.
const HOST = process.env.REVIEW_APP_HOST || '127.0.0.1';

const SPRINT_DIR_RE = /^sprint(\d+)-prs$/;
const BLOQUE_FILE_RE = /^bloque-(\d+)-.+\.md$/;
const VIEWER_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/;

// CLI flag --data-dir gana sobre env var.
function resolveDataDir() {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf('--data-dir');
  if (flagIdx !== -1 && argv[flagIdx + 1]) {
    return resolve(argv[flagIdx + 1]);
  }
  if (process.env.REVIEW_APP_DATA_DIR) {
    return resolve(process.env.REVIEW_APP_DATA_DIR);
  }
  return join(REPO_ROOT, 'audit');
}

// Modo: "sprint" (revisar bloques de un sprint marcando OK/Feedback) o
// "viewer" (listar CUALQUIER .md del dataDir como output de agentes a leer).
// Resolución: flag --mode viewer|sprint gana; si no, autodetect — si NO hay
// carpetas sprint<N>-prs pero SÍ hay .md sueltos, es viewer; en otro caso sprint.
function resolveMode(dataDir) {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf('--mode');
  if (flagIdx !== -1 && argv[flagIdx + 1]) {
    const v = String(argv[flagIdx + 1]).toLowerCase();
    if (v === 'viewer' || v === 'sprint') return v;
  }
  if (process.env.REVIEW_APP_MODE) {
    const v = String(process.env.REVIEW_APP_MODE).toLowerCase();
    if (v === 'viewer' || v === 'sprint') return v;
  }
  return autodetectMode(dataDir);
}

export function autodetectMode(dataDir) {
  if (!existsSync(dataDir)) return 'sprint';
  let hasSprintDir = false;
  let hasMd = false;
  try {
    for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
      if (entry.isDirectory() && SPRINT_DIR_RE.test(entry.name)) hasSprintDir = true;
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) hasMd = true;
    }
  } catch { /* ignore */ }
  if (!hasSprintDir && hasMd) return 'viewer';
  return 'sprint';
}

const DATA_DIR = resolveDataDir();
const REVIEWS_DIR = join(DATA_DIR, 'reviews');
const MODE = resolveMode(DATA_DIR);

// ---- Parser & cache --------------------------------------------------------

// Cache shape: Map<sprintNumber, { mtime: number, bloques: Bloque[] }>
const sprintCache = new Map();

/**
 * Lee `<DATA_DIR>` y devuelve la lista de sprints detectados (sin bloques internos).
 * Dynamic — no hardcoded sprint range.
 */
export function listSprints(dataDir = DATA_DIR) {
  if (!existsSync(dataDir)) return [];
  const entries = readdirSync(dataDir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = SPRINT_DIR_RE.exec(entry.name);
    if (!m) continue;
    const sprintNumber = parseInt(m[1], 10);
    if (!Number.isFinite(sprintNumber) || sprintNumber < 0) continue;
    const sprintDir = join(dataDir, entry.name);
    const indexPath = join(sprintDir, 'INDEX.md');
    const meta = parseSprintIndex(indexPath);
    out.push({
      id: sprintNumber,
      title: meta.title || `Sprint ${sprintNumber}`,
      description: meta.description || '',
      block_count: countBlocks(sprintDir),
    });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function countBlocks(sprintDir) {
  if (!existsSync(sprintDir)) return 0;
  let n = 0;
  for (const f of readdirSync(sprintDir)) {
    if (BLOQUE_FILE_RE.test(f)) n += 1;
  }
  return n;
}

function parseSprintIndex(indexPath) {
  if (!existsSync(indexPath)) return { title: '', description: '' };
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let title = '';
    let description = '';
    for (const line of lines) {
      const t = line.trim();
      if (!title && /^#\s+/.test(t)) {
        title = t.replace(/^#\s+/, '').trim();
        continue;
      }
      if (title && !description && t && !t.startsWith('#') && !t.startsWith('-')) {
        description = t;
        break;
      }
    }
    return { title, description };
  } catch {
    return { title: '', description: '' };
  }
}

/**
 * Lista bloques de un sprint dado. Hot-reload via mtime dedup.
 */
export function listBlocks(sprintNumber, dataDir = DATA_DIR) {
  const sprintDir = join(dataDir, `sprint${sprintNumber}-prs`);
  if (!existsSync(sprintDir)) return [];
  // mtime de la carpeta sirve como signal de cambio (un nuevo bloque cambia el mtime).
  let mt = 0;
  try { mt = statSync(sprintDir).mtimeMs; } catch { /* ignore */ }
  const cached = sprintCache.get(sprintNumber);
  if (cached && cached.mtime === mt) return cached.bloques;

  const bloques = [];
  for (const f of readdirSync(sprintDir)) {
    const m = BLOQUE_FILE_RE.exec(f);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    if (!Number.isFinite(number)) continue;
    bloques.push({
      number,
      filename: f,
      path: join(sprintDir, f),
    });
  }
  bloques.sort((a, b) => a.number - b.number);
  sprintCache.set(sprintNumber, { mtime: mt, bloques });
  return bloques;
}

export function readBlock(sprintNumber, bloqueNumber, dataDir = DATA_DIR) {
  const blocks = listBlocks(sprintNumber, dataDir);
  const b = blocks.find(x => x.number === bloqueNumber);
  if (!b) return null;
  try {
    return readFileSync(b.path, 'utf8');
  } catch {
    return null;
  }
}

// ---- Viewer mode (A1) ------------------------------------------------------
// Lista CUALQUIER .md del dataDir (no recursivo) como output de agentes para
// leer. Cada archivo trae un TLDR derivado: H1 + primer párrafo. Si el .md tiene
// front-matter con `model:`, se expone para trazabilidad.

/**
 * Extrae metadata ligera de un markdown:
 *   - title: primer `# H1` (o el nombre del archivo si no hay).
 *   - tldr: primer párrafo de texto después del H1 (no header, no bullet, no fence).
 *   - model: valor de `model:` en el front-matter YAML si existe.
 */
export function extractTldr(md, fallbackTitle = '') {
  const out = { title: fallbackTitle, tldr: '', model: null };
  if (typeof md !== 'string' || !md.trim()) return out;
  let body = md;
  // Front-matter: capturamos `model:` si está entre los primeros `---`.
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (fmMatch) {
    const fm = fmMatch[1];
    const mm = /^model:\s*(.+)$/m.exec(fm);
    if (mm) out.model = mm[1].trim().replace(/^["']|["']$/g, '');
    body = md.slice(fmMatch[0].length);
  }
  const lines = body.split(/\r?\n/);
  let sawH1 = false;
  let inFence = false;
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!sawH1) {
      const h1 = /^#\s+(.+)$/.exec(line);
      if (h1) { out.title = h1[1].trim(); sawH1 = true; continue; }
      // Permitimos texto antes del H1 también como TLDR si nunca hay H1.
    }
    if (!out.tldr && line && !/^#{1,6}\s/.test(line) && !/^[-*]\s/.test(line) && !/^>/.test(line) && !/^\|/.test(line)) {
      out.tldr = line.replace(/\*\*/g, '').replace(/`/g, '');
      if (sawH1) break;
    }
  }
  return out;
}

/**
 * Lista los .md del dataDir (no recursivo) con su TLDR. Hot-reload via mtime
 * dedup sobre el dataDir.
 */
const viewerCache = { mtime: -1, files: [] };
export function listViewerFiles(dataDir = DATA_DIR) {
  if (!existsSync(dataDir)) return [];
  let mt = 0;
  try { mt = statSync(dataDir).mtimeMs; } catch { /* ignore */ }
  if (viewerCache.mtime === mt && dataDir === DATA_DIR) return viewerCache.files;
  const out = [];
  let entries = [];
  try { entries = readdirSync(dataDir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!VIEWER_FILE_RE.test(entry.name)) continue;
    let raw = '';
    try { raw = readFileSync(join(dataDir, entry.name), 'utf8'); } catch { /* ignore */ }
    const meta = extractTldr(raw, entry.name);
    out.push({ name: entry.name, title: meta.title, tldr: meta.tldr, model: meta.model });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  if (dataDir === DATA_DIR) { viewerCache.mtime = mt; viewerCache.files = out; }
  return out;
}

/** Lee un .md del viewer por nombre (con guard anti-traversal). */
export function readViewerFile(name, dataDir = DATA_DIR) {
  if (typeof name !== 'string' || !VIEWER_FILE_RE.test(name)) return null;
  const target = resolve(dataDir, name);
  // Guard: el archivo resuelto tiene que vivir DIRECTO dentro de dataDir.
  if (resolve(target) !== resolve(join(dataDir, name))) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  try { return readFileSync(target, 'utf8'); } catch { return null; }
}

// ---- Reviews persistence ---------------------------------------------------

function reviewPath(sprintNumber, bloqueNumber, dataDir = DATA_DIR) {
  return join(dataDir, 'reviews', `sprint${sprintNumber}`, `bloque-${bloqueNumber}.json`);
}

function readReview(sprintNumber, bloqueNumber, dataDir = DATA_DIR) {
  const p = reviewPath(sprintNumber, bloqueNumber, dataDir);
  if (!existsSync(p)) {
    return { sprint: sprintNumber, bloque: bloqueNumber, decisions: [] };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { sprint: sprintNumber, bloque: bloqueNumber, decisions: [] };
  }
}

function writeReview(sprintNumber, bloqueNumber, review, dataDir = DATA_DIR) {
  const p = reviewPath(sprintNumber, bloqueNumber, dataDir);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(review, null, 2) + '\n', 'utf8');
    renameSync(tmp, p);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

function upsertDecision(sprintNumber, bloqueNumber, testIndex, status, comment, dataDir = DATA_DIR) {
  if (!['ok', 'feedback', 'pending'].includes(status)) {
    throw new Error(`status inválido: ${status}`);
  }
  if (!Number.isInteger(testIndex) || testIndex < 0) {
    throw new Error('test_index debe ser entero >= 0');
  }
  const review = readReview(sprintNumber, bloqueNumber, dataDir);
  if (!Array.isArray(review.decisions)) review.decisions = [];
  review.sprint = sprintNumber;
  review.bloque = bloqueNumber;
  review.reviewed_at = new Date().toISOString();
  const existing = review.decisions.find(d => d.test_index === testIndex);
  if (existing) {
    existing.status = status;
    existing.comment = typeof comment === 'string' ? comment : '';
  } else {
    review.decisions.push({ test_index: testIndex, status, comment: typeof comment === 'string' ? comment : '' });
  }
  writeReview(sprintNumber, bloqueNumber, review, dataDir);
  return review;
}

// Recorre <DATA_DIR>/reviews/sprint<N>/bloque-<M>.json y devuelve TODAS las
// decisiones con status='feedback' aplanadas como
// [{ sprint, bloque, test_index, comment, reviewed_at }]. Reutilizable fuera del
// endpoint (export). Degrada con gracia: si no existe reviews/ devuelve []. No
// rompe ante archivos JSON corruptos — los salta.
const REVIEW_SPRINT_DIR_RE = /^sprint(\d+)$/;
const REVIEW_BLOQUE_FILE_RE = /^bloque-(\d+)\.json$/;

export function listPendingFeedback(dataDir = DATA_DIR) {
  const reviewsDir = join(dataDir, 'reviews');
  if (!existsSync(reviewsDir)) return [];
  const out = [];
  let sprintEntries = [];
  try { sprintEntries = readdirSync(reviewsDir, { withFileTypes: true }); } catch { return []; }
  for (const sEntry of sprintEntries) {
    if (!sEntry.isDirectory()) continue;
    const sm = REVIEW_SPRINT_DIR_RE.exec(sEntry.name);
    if (!sm) continue;
    const sprint = parseInt(sm[1], 10);
    const sprintDir = join(reviewsDir, sEntry.name);
    let bloqueEntries = [];
    try { bloqueEntries = readdirSync(sprintDir, { withFileTypes: true }); } catch { continue; }
    for (const bEntry of bloqueEntries) {
      if (!bEntry.isFile()) continue;
      const bm = REVIEW_BLOQUE_FILE_RE.exec(bEntry.name);
      if (!bm) continue;
      const bloque = parseInt(bm[1], 10);
      let review;
      try {
        review = JSON.parse(readFileSync(join(sprintDir, bEntry.name), 'utf8'));
      } catch {
        continue; // archivo corrupto: lo saltamos, no rompemos el listado entero.
      }
      const decisions = Array.isArray(review && review.decisions) ? review.decisions : [];
      for (const d of decisions) {
        if (!d || d.status !== 'feedback') continue;
        out.push({
          sprint,
          bloque,
          test_index: d.test_index,
          comment: typeof d.comment === 'string' ? d.comment : '',
          reviewed_at: review.reviewed_at || null,
        });
      }
    }
  }
  out.sort((a, b) => (a.sprint - b.sprint) || (a.bloque - b.bloque) || (a.test_index - b.test_index));
  return out;
}

// ---- HTTP --------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// CORS restringido a orígenes locales. La review-app es una herramienta de
// desarrollo loopback; no necesita exponerse a orígenes cross-site arbitrarios.
const ALLOWED_ORIGIN = process.env.REVIEW_APP_ORIGIN || 'http://localhost:7788';
const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function send404(res, msg) {
  sendJSON(res, 404, { error: msg || 'not found' });
}

function readBody(req, limit = 100_000) {
  return new Promise((resolveP, rejectP) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > limit) { req.destroy(); rejectP(new Error('payload demasiado grande')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectP);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel.includes('..')) return send404(res, 'path inválido');
  const file = join(PUBLIC_DIR, rel);
  if (!existsSync(file) || !statSync(file).isFile()) return send404(res, `archivo no encontrado: ${rel}`);
  const ext = extname(file).toLowerCase();
  const data = readFileSync(file);
  res.writeHead(200, { ...CORS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length });
  res.end(data);
}

// Regex de paths — TODOS con \d+, sin hardcodes.
const RE_SPRINT = /^\/api\/sprint\/(\d+)$/;
const RE_BLOQUE = /^\/api\/bloque\/(\d+)\/(\d+)$/;
const RE_RAW_BLOQUE = /^\/raw\/bloque\/(\d+)\/(\d+)$/;
const RE_REVIEW_GET = /^\/api\/review\/(\d+)\/(\d+)$/;
const RE_REVIEW_POST = /^\/api\/review\/(\d+)\/(\d+)\/(\d+)$/;
const RE_VIEWER_FILE = /^\/api\/viewer\/file\/(.+)$/;
const RE_RAW_VIEWER = /^\/raw\/viewer\/(.+)$/;

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  try {
    if (method === 'GET' && path === '/api/health') {
      return sendJSON(res, 200, { ok: true, mode: MODE, data_dir: DATA_DIR, sprints_loaded: listSprints().length });
    }
    if (method === 'GET' && path === '/api/mode') {
      return sendJSON(res, 200, { mode: MODE, data_dir: DATA_DIR });
    }
    if (method === 'GET' && path === '/api/sprints') {
      return sendJSON(res, 200, listSprints());
    }
    if (method === 'GET' && path === '/api/feedback/pending') {
      return sendJSON(res, 200, listPendingFeedback());
    }
    // ---- Viewer mode (A1) ----
    if (method === 'GET' && path === '/api/viewer/files') {
      return sendJSON(res, 200, listViewerFiles());
    }
    let m;
    if (method === 'GET' && (m = RE_VIEWER_FILE.exec(path))) {
      let name;
      try { name = decodeURIComponent(m[1]); } catch { return send404(res, 'nombre inválido'); }
      const content = readViewerFile(name);
      if (content === null) return send404(res, `archivo viewer no encontrado: ${name}`);
      const meta = extractTldr(content, name);
      return sendJSON(res, 200, { name, title: meta.title, model: meta.model, content });
    }
    if (method === 'GET' && (m = RE_RAW_VIEWER.exec(path))) {
      let name;
      try { name = decodeURIComponent(m[1]); } catch { return send404(res, 'nombre inválido'); }
      const content = readViewerFile(name);
      if (content === null) return send404(res, `archivo viewer no encontrado: ${name}`);
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(content);
      return;
    }
    if (method === 'GET' && (m = RE_SPRINT.exec(path))) {
      const sn = parseInt(m[1], 10);
      const blocks = listBlocks(sn);
      return sendJSON(res, 200, { sprint: sn, blocks });
    }
    if (method === 'GET' && (m = RE_BLOQUE.exec(path))) {
      const sn = parseInt(m[1], 10);
      const bn = parseInt(m[2], 10);
      const content = readBlock(sn, bn);
      if (content === null) return send404(res, `bloque ${bn} no encontrado en sprint ${sn}`);
      return sendJSON(res, 200, { sprint: sn, bloque: bn, content });
    }
    if (method === 'GET' && (m = RE_RAW_BLOQUE.exec(path))) {
      const sn = parseInt(m[1], 10);
      const bn = parseInt(m[2], 10);
      const content = readBlock(sn, bn);
      if (content === null) return send404(res, `bloque ${bn} no encontrado en sprint ${sn}`);
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(content);
      return;
    }
    if (method === 'GET' && (m = RE_REVIEW_GET.exec(path))) {
      const sn = parseInt(m[1], 10);
      const bn = parseInt(m[2], 10);
      return sendJSON(res, 200, readReview(sn, bn));
    }
    if (method === 'POST' && (m = RE_REVIEW_POST.exec(path))) {
      const sn = parseInt(m[1], 10);
      const bn = parseInt(m[2], 10);
      const ti = parseInt(m[3], 10);
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (e) { return sendJSON(res, 400, { error: `JSON inválido: ${e.message}` }); }
      const status = typeof body.status === 'string' ? body.status : 'pending';
      const comment = typeof body.comment === 'string' ? body.comment : '';
      try {
        const review = upsertDecision(sn, bn, ti, status, comment);
        return sendJSON(res, 200, review);
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
    }
    if (method === 'GET') return serveStatic(req, res, path);
    send404(res, `${method} ${path} no soportado`);
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

// ---- File watcher (hot-reload del parser) ---------------------------------

const watchers = [];

function setupWatcher() {
  if (!existsSync(DATA_DIR)) return;
  try {
    const handle = watch(DATA_DIR, () => {
      // invalida toda la cache al cambiar la dir raíz
      sprintCache.clear();
      viewerCache.mtime = -1;
    });
    if (handle && handle.unref) handle.unref();
    watchers.push(handle);
  } catch (e) {
    console.warn(`[review-app] no pude watchear ${DATA_DIR}: ${e.message}`);
  }
}

// ---- Bootstrap --------------------------------------------------------------

export function startServer(port = PORT) {
  setupWatcher();
  const server = http.createServer(handleRequest);
  return new Promise((resolveP, rejectP) => {
    server.on('error', rejectP);
    server.listen(port, HOST, () => {
      const addr = server.address();
      const real = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`[review-app] escuchando en http://${HOST}:${real}`);
      console.log(`[review-app] data dir: ${DATA_DIR}`);
      console.log(`[review-app] sprints detectados: ${listSprints().length}`);
      resolveP({ server, port: real });
    });
  });
}

export function closeWatchers() {
  for (const w of watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  watchers.length = 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  startServer().catch(e => {
    console.error(`[review-app] no pude arrancar: ${e.message}`);
    process.exit(1);
  });
}
