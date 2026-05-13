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

const DATA_DIR = resolveDataDir();
const REVIEWS_DIR = join(DATA_DIR, 'reviews');

const SPRINT_DIR_RE = /^sprint(\d+)-prs$/;
const BLOQUE_FILE_RE = /^bloque-(\d+)-.+\.md$/;

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

// ---- HTTP --------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  try {
    if (method === 'GET' && path === '/api/health') {
      return sendJSON(res, 200, { ok: true, data_dir: DATA_DIR, sprints_loaded: listSprints().length });
    }
    if (method === 'GET' && path === '/api/sprints') {
      return sendJSON(res, 200, listSprints());
    }
    let m;
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
    server.listen(port, () => {
      const addr = server.address();
      const real = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`[review-app] escuchando en http://localhost:${real}`);
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
