// cockpit/server.js
// Cockpit de revisión: roadmap arriba, foco, votos por ítem, feedback que el
// orquestador SÍ consume (src/cockpit.js pending) y conversación por voz
// (OpenAI Realtime vía WebRTC) o por texto (OpenRouter) sobre cada revisión.
//
// Por qué un server nuevo y no la review-app: la review-app modela "bloques
// .md de un sprint" y su feedback no tiene estado processed; el cockpit usa el
// contrato JSON de cockpit/reviews + cockpit/feedback (que también escriben los
// agentes de council y video). Reutiliza las ideas que funcionan de la
// review-app: zero deps, loopback por defecto, escritura atómica, render XSS-safe.
//
// Uso: node src/cockpit.js open [id]  (lo levanta en segundo plano y abre el navegador)
//      npm run cockpit                (modo manual en primer plano, http://localhost:7788)
// Env: COCKPIT_PORT, COCKPIT_HOST, COCKPIT_ROOT, COCKPIT_VOICE_MODEL,
//      COCKPIT_VOICE, COCKPIT_CHAT_MODEL.
// La key real (OPENAI_API_KEY) NUNCA sale al navegador: el server acuña un
// client secret efímero (ek_...) de 10 minutos por conversación.
// Idioma: español neutro.

import http from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/load_env.js';
import {
  ID_RE,
  cockpitPaths,
  listReviews,
  getReview,
  getFeedback,
  saveFeedback,
  pendingFeedback,
  roadmapSnapshot,
  isSafeMediaPath,
  itemMediaPaths,
  buildGuideInstructions,
  parseSummary,
  SUMMARY_INSTRUCTIONS,
  CockpitError,
} from '../src/cockpit.js';
import { reporteProyecto, reporteTodos, paraWeb, parseDesde, claudeDirDefault } from '../src/uso.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

export const REALTIME_DEFAULTS = {
  // Verificado en developers.openai.com (oct-2026): gpt-realtime-2.1 es el
  // modelo de los ejemplos; la variante mini cuesta ~3 veces menos en audio.
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  transcription_model: 'gpt-4o-mini-transcribe',
  client_secrets_url: 'https://api.openai.com/v1/realtime/client_secrets',
  calls_url: 'https://api.openai.com/v1/realtime/calls',
  ttl_seconds: 600,
};

const DEFAULT_CHAT_MODEL = 'anthropic/claude-haiku-4.5';

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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.pdf', '.html']);

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > limit) { fail(new Error('payload demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

async function readJSONBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

// Solo aceptamos POST desde la propia página (localhost). Un sitio externo no
// puede gatillar el endpoint de voz (que cuesta plata) ni escribir feedback.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / tests / mismo origen sin header
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

// El uso es privado aunque alguien exponga el cockpit con COCKPIT_HOST: solo desde este
// PC y con un Host local (esto último frena DNS rebinding).
function requestLocal(req) {
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return false;
  try {
    const h = new URL(`http://${req.headers.host}`).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}

function sendFile(res, file, extraHeaders = {}) {
  const data = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(data);
}

/** Ruta de un archivo dentro de base, o null si escapa (anti path traversal). */
export function safeJoin(base, rel) {
  const b = resolve(base);
  const target = resolve(b, rel);
  if (target !== b && !target.startsWith(b + sep)) return null;
  return target;
}

// ---------------------------------------------------------------------------
// Proveedores (inyectables en tests)
// ---------------------------------------------------------------------------

function transcriptToText(conversation) {
  return (conversation || [])
    .map(t => `${t.who === 'guia' ? 'Guía' : 'Usuario'}: ${t.text}`)
    .join('\n');
}

async function defaultChat({ system, messages, env }) {
  if (env.OPENROUTER_API_KEY) {
    const { chat } = await import('../src/openrouter_client.js');
    const r = await chat({
      model: env.COCKPIT_CHAT_MODEL || DEFAULT_CHAT_MODEL,
      system,
      messages,
      max_tokens: 600,
      timeout_ms: 60_000,
    });
    return typeof r.content === 'string' ? r.content : String(r.content || '');
  }
  throw new Error('No hay OPENROUTER_API_KEY para el chat de texto. Corre npm run setup.');
}

/** Pide a OpenAI un client secret efímero para una sesión Realtime. */
export async function mintRealtimeSecret({ review, env, fetchImpl }) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new CockpitError('Falta OPENAI_API_KEY en .env: la voz no está disponible (usa el chat de texto).');
  const model = env.COCKPIT_VOICE_MODEL || REALTIME_DEFAULTS.model;
  const voice = env.COCKPIT_VOICE || REALTIME_DEFAULTS.voice;
  const body = {
    expires_after: { anchor: 'created_at', seconds: REALTIME_DEFAULTS.ttl_seconds },
    session: {
      type: 'realtime',
      model,
      instructions: buildGuideInstructions(review, 'voz'),
      output_modalities: ['audio'],
      audio: {
        input: {
          transcription: { model: REALTIME_DEFAULTS.transcription_model, language: 'es' },
          turn_detection: { type: 'semantic_vad', eagerness: 'low' },
        },
        output: { voice },
      },
    },
  };
  const res = await fetchImpl(REALTIME_DEFAULTS.client_secrets_url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data || typeof data.value !== 'string') {
    const msg = data && data.error && data.error.message ? data.error.message : text.slice(0, 300);
    const err = new Error(`OpenAI rechazó la sesión de voz (HTTP ${res.status}): ${msg}`);
    err.status = 502;
    throw err;
  }
  return { value: data.value, expires_at: data.expires_at, model, voice, calls_url: REALTIME_DEFAULTS.calls_url };
}

// ---------------------------------------------------------------------------
// Señal de cambios (para SSE): firma barata de los archivos que importan
// ---------------------------------------------------------------------------

function dirSignature(dir) {
  if (!existsSync(dir)) return '';
  let names = [];
  try { names = readdirSync(dir).filter(n => n.endsWith('.json')).sort(); } catch { return ''; }
  return names.map(n => {
    try { return `${n}:${statSync(join(dir, n)).mtimeMs}`; } catch { return n; }
  }).join('|');
}

function fileSig(f) {
  try { return String(statSync(f).mtimeMs); } catch { return '-'; }
}

export function changeSignature(root) {
  const p = cockpitPaths(root);
  return [
    dirSignature(p.reviews),
    dirSignature(p.feedback),
    fileSig(join(p.roadmap, 'current-sprint.json')),
    fileSig(join(p.roadmap, 'roadmap.md')),
    fileSig(join(p.memory, 'sprint-log.md')),
  ].join('#');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const RE_REVIEW = /^\/api\/reviews\/([^/]+)$/;
const RE_FEEDBACK = /^\/api\/feedback\/([^/]+)$/;
const RE_VOICE = /^\/api\/voice\/session\/([^/]+)$/;
const RE_CHAT = /^\/api\/chat\/([^/]+)$/;
const RE_SUMMARY = /^\/api\/summary\/([^/]+)$/;

/**
 * Crea el server (sin escuchar). Opciones inyectables para tests:
 *   root, env, fetchImpl, chatImpl({system, messages, env}) → string, pollMs.
 */
export function createCockpitServer(opts = {}) {
  const root = cockpitPaths(opts.root).root;
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const chatImpl = opts.chatImpl || defaultChat;
  const pollMs = opts.pollMs || 1500;

  // SSE: un único poll compartido; empuja "change" a todos los clientes.
  const clients = new Set();
  let lastSig = changeSignature(root);
  const poll = setInterval(() => {
    let sig;
    try { sig = changeSignature(root); } catch { return; }
    if (sig === lastSig) return;
    lastSig = sig;
    for (const res of clients) res.write(`event: change\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  }, pollMs);
  if (poll.unref) poll.unref();
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);
  if (heartbeat.unref) heartbeat.unref();

  // Uso: leer las transcripciones toma segundos, así que se guarda un minuto en memoria.
  const usoCache = new Map();
  function usoCacheado(alcance, desde) {
    const clave = `${alcance}|${desde ?? ''}`;
    const prev = usoCache.get(clave);
    if (prev && Date.now() - prev.at < 60_000) return prev.promise;
    const claudeDir = opts.usoDir || claudeDirDefault(env);
    const promise = (alcance === 'todos'
      ? reporteTodos({ starterRoot: root, claudeDir, desde })
      : reporteProyecto({ root, claudeDir, desde })).then(paraWeb);
    usoCache.set(clave, { at: Date.now(), promise });
    promise.catch(() => usoCache.delete(clave));
    return promise;
  }

  function reviewOr404(res, rawId) {
    let id;
    try { id = decodeURIComponent(rawId); } catch { id = ''; }
    if (!ID_RE.test(id)) { sendJSON(res, 400, { error: 'id inválido' }); return null; }
    const review = getReview(id, root);
    if (!review) { sendJSON(res, 404, { error: `no existe la revisión ${id}` }); return null; }
    return review;
  }

  // Solo se sirven rutas que alguna revisión declara en `media` o en su `visual`
  // (lista blanca), con extensión de media conocida y sin escapar de la raíz.
  function serveMedia(res, rel) {
    if (!isSafeMediaPath(rel)) return sendJSON(res, 400, { error: 'ruta de media inválida' });
    const ext = extname(rel).toLowerCase();
    if (!MEDIA_EXT.has(ext)) return sendJSON(res, 400, { error: 'tipo de archivo no permitido' });
    const declared = listReviews(root).some(r => {
      const rv = getReview(r.id, root);
      return rv && rv.items.some(it => itemMediaPaths(it).includes(rel));
    });
    if (!declared) return sendJSON(res, 403, { error: 'media no declarada en ninguna revisión' });
    const file = safeJoin(root, rel);
    if (!file || !existsSync(file) || !statSync(file).isFile()) return sendJSON(res, 404, { error: 'archivo no encontrado' });
    // HTML ajeno: se sirve en sandbox (sin scripts con acceso al cockpit).
    const extra = ext === '.html' || ext === '.svg' ? { 'Content-Security-Policy': 'sandbox' } : {};
    return sendFile(res, file, extra);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;
    let m;

    if (method === 'POST' && !originAllowed(req)) return sendJSON(res, 403, { error: 'origen no permitido' });

    if (method === 'GET' && path === '/api/health') return sendJSON(res, 200, { ok: true, root });
    if (method === 'GET' && path === '/api/status') {
      return sendJSON(res, 200, {
        project: basename(root),
        voice: Boolean(env.OPENAI_API_KEY),
        chat: Boolean(env.OPENROUTER_API_KEY) || Boolean(chatImpl !== defaultChat),
        voice_model: env.COCKPIT_VOICE_MODEL || REALTIME_DEFAULTS.model,
        voice_name: env.COCKPIT_VOICE || REALTIME_DEFAULTS.voice,
        summary_instructions: SUMMARY_INSTRUCTIONS,
      });
    }
    if (method === 'GET' && path === '/api/uso') {
      if (!requestLocal(req)) return sendJSON(res, 403, { error: 'el uso solo se ve desde este computador' });
      let desde;
      try { desde = parseDesde(url.searchParams.get('desde') || null); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      const alcance = url.searchParams.get('alcance') === 'todos' ? 'todos' : 'proyecto';
      return sendJSON(res, 200, await usoCacheado(alcance, desde));
    }
    if (method === 'GET' && path === '/api/roadmap') return sendJSON(res, 200, roadmapSnapshot(root));
    if (method === 'GET' && path === '/api/reviews') return sendJSON(res, 200, listReviews(root));
    if (method === 'GET' && path === '/api/feedback/pending') return sendJSON(res, 200, pendingFeedback(root));
    if (method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (method === 'GET' && path === '/media') return serveMedia(res, url.searchParams.get('path') || '');

    if (method === 'GET' && (m = RE_REVIEW.exec(path))) {
      const review = reviewOr404(res, m[1]);
      if (!review) return;
      return sendJSON(res, 200, { review, feedback: getFeedback(review.id, root) });
    }
    if (method === 'POST' && (m = RE_FEEDBACK.exec(path))) {
      const review = reviewOr404(res, m[1]);
      if (!review) return;
      const body = await readJSONBody(req);
      const { feedback } = saveFeedback(review.id, body, root);
      return sendJSON(res, 200, feedback);
    }
    if (method === 'POST' && (m = RE_VOICE.exec(path))) {
      const review = reviewOr404(res, m[1]);
      if (!review) return;
      const secret = await mintRealtimeSecret({ review, env, fetchImpl });
      return sendJSON(res, 200, secret);
    }
    if (method === 'POST' && (m = RE_CHAT.exec(path))) {
      const review = reviewOr404(res, m[1]);
      if (!review) return;
      const body = await readJSONBody(req);
      const conv = Array.isArray(body.conversation) ? body.conversation.slice(-80) : [];
      const messages = conv
        .filter(t => t && typeof t.text === 'string' && t.text.trim())
        .map(t => ({ role: t.who === 'guia' ? 'assistant' : 'user', content: t.text.slice(0, 4000) }));
      if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: 'Hola, empecemos la revisión.' });
      const reply = await chatImpl({ system: buildGuideInstructions(review, 'texto'), messages, env });
      return sendJSON(res, 200, { reply: String(reply || '').trim() });
    }
    if (method === 'POST' && (m = RE_SUMMARY.exec(path))) {
      const review = reviewOr404(res, m[1]);
      if (!review) return;
      const body = await readJSONBody(req);
      const transcript = transcriptToText(Array.isArray(body.conversation) ? body.conversation : []);
      if (!transcript.trim()) return sendJSON(res, 200, { summary: { decisions: [], open_questions: [], requests: [] } });
      const system = `Revisión: "${review.title}". Ítems: ${review.items.map(i => i.title).join('; ')}.\n${SUMMARY_INSTRUCTIONS}`;
      const reply = await chatImpl({ system, messages: [{ role: 'user', content: `Conversación:\n${transcript.slice(-30_000)}` }], env });
      const summary = parseSummary(reply);
      if (!summary) return sendJSON(res, 502, { error: 'el modelo no devolvió un resumen JSON válido' });
      return sendJSON(res, 200, { summary });
    }

    if (method === 'GET') {
      const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      const file = safeJoin(PUBLIC_DIR, rel);
      if (!file || !existsSync(file) || !statSync(file).isFile()) return sendJSON(res, 404, { error: 'no encontrado' });
      return sendFile(res, file, { 'Cache-Control': 'no-store' });
    }
    return sendJSON(res, 404, { error: `${method} ${path} no soportado` });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      const status = e instanceof SyntaxError ? 400 : e instanceof CockpitError ? 400 : e.status || 500;
      if (!res.headersSent) sendJSON(res, status, { error: e.message });
      else res.end();
    });
  });
  server.on('close', () => {
    clearInterval(poll);
    clearInterval(heartbeat);
    for (const c of clients) c.end();
    clients.clear();
  });
  return server;
}

export function startCockpit(opts = {}) {
  const port = opts.port ?? parseInt(process.env.COCKPIT_PORT || '7788', 10);
  const host = opts.host || process.env.COCKPIT_HOST || '127.0.0.1';
  const server = createCockpitServer(opts);
  return new Promise((ok, fail) => {
    server.on('error', fail);
    server.listen(port, host, () => {
      const real = server.address().port;
      ok({ server, port: real });
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  startCockpit().then(({ port }) => {
    console.log(`[cockpit] abierto en http://localhost:${port}`);
    console.log(`[cockpit] voz: ${process.env.OPENAI_API_KEY ? 'disponible' : 'sin OPENAI_API_KEY (solo texto)'} · chat: ${process.env.OPENROUTER_API_KEY ? 'disponible' : 'sin OPENROUTER_API_KEY'}`);
    console.log('[cockpit] Ctrl+C para cerrar.');
  }).catch(e => {
    if (e.code === 'EADDRINUSE') console.error(`[cockpit] el puerto ${process.env.COCKPIT_PORT || '7788'} está ocupado (¿la review-app u otro cockpit abierto?). Usa node src/cockpit.js open, que busca un puerto libre solo.`);
    else console.error(`[cockpit] no pude arrancar: ${e.message}`);
    process.exit(1);
  });
}
