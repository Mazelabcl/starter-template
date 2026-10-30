// src/cockpit.js
// Contrato de datos del cockpit (revisiones + feedback) y CLI para el orquestador.
//
// Carpetas (en la raíz del proyecto):
//   cockpit/reviews/<review_id>.json   → las escriben agentes u orquestador (publishReview)
//   cockpit/feedback/<review_id>.json  → la escribe la UI del cockpit (saveFeedback)
//
// El orquestador DEBE leer el feedback pendiente (processed=false), aplicarlo y
// luego marcarlo con markProcessed(). Ese es el circuito que cierra el loop.
//
// CLI:
//   node src/cockpit.js pending            (feedback sin procesar, legible)
//   node src/cockpit.js pending --json     (lo mismo en JSON)
//   node src/cockpit.js publish <archivo>  (valida y publica una revisión)
//   node src/cockpit.js done <review_id>   (marca el feedback como procesado)
//   node src/cockpit.js list               (revisiones publicadas)
//
// Raíz: por defecto la raíz del repo; se puede cambiar con COCKPIT_ROOT o
// pasando `root` como último argumento de cada función (lo usan los tests).
// Idioma: español neutro.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { getCurrentSprint, _internal as roadmapInternal } from './roadmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const KINDS = ['plan', 'council', 'rounds', 'deliverable', 'other'];
export const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const VOTES = ['up', 'down', null];
const WHO = ['usuario', 'guia'];

const LIMITS = {
  comment: 5000,
  conversationTurns: 600,
  turnText: 4000,
  summaryEntries: 50,
  summaryText: 1000,
};

export class CockpitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CockpitError';
  }
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function resolveRoot(root) {
  return resolve(root || process.env.COCKPIT_ROOT || REPO_ROOT);
}

export function cockpitPaths(root) {
  const r = resolveRoot(root);
  return {
    root: r,
    reviews: join(r, 'cockpit', 'reviews'),
    feedback: join(r, 'cockpit', 'feedback'),
    roadmap: join(r, 'roadmap'),
    memory: join(r, 'memory'),
  };
}

function assertId(id, label = 'id') {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new CockpitError(`${label} inválido: usa letras, números, punto, guion o guion bajo (máx. 100), sin espacios. Recibido: ${JSON.stringify(id)}`);
  }
}

function atomicWrite(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, contents, 'utf8');
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

function readJSONSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listJSONIds(dir) {
  if (!existsSync(dir)) return [];
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names
    .filter(n => n.endsWith('.json'))
    .map(n => n.slice(0, -5))
    .filter(id => ID_RE.test(id));
}

// ---------------------------------------------------------------------------
// Validación de revisiones
// ---------------------------------------------------------------------------

function isStringArray(v) {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

// Media: rutas relativas a la raíz del proyecto. Sin "..", sin absolutas, sin
// segmentos ocultos (.env, .git). El server vuelve a validar al servirlas.
export function isSafeMediaPath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  if (isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  const parts = p.split(/[\\/]+/);
  return parts.every(seg => seg && seg !== '..' && seg !== '.' && !seg.startsWith('.'));
}

/**
 * Valida y normaliza una revisión. Lanza CockpitError con TODOS los problemas
 * encontrados (no solo el primero) para que el agente los corrija de una vez.
 */
export function validateReview(review) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    throw new CockpitError('La revisión debe ser un objeto JSON.');
  }
  if (typeof review.id !== 'string' || !ID_RE.test(review.id)) errors.push('id: string sin espacios (letras, números, . _ -)');
  if (typeof review.title !== 'string' || !review.title.trim()) errors.push('title: string no vacío');
  if (!KINDS.includes(review.kind)) errors.push(`kind: uno de ${KINDS.join('|')}`);
  if (review.created_at !== undefined && (typeof review.created_at !== 'string' || Number.isNaN(Date.parse(review.created_at)))) {
    errors.push('created_at: fecha ISO (o se omite y se completa sola)');
  }
  if (review.connects_to !== undefined && !isStringArray(review.connects_to)) errors.push('connects_to: array de strings');
  if (review.context_brief !== undefined && typeof review.context_brief !== 'string') errors.push('context_brief: string');
  if (!Array.isArray(review.items) || review.items.length === 0) {
    errors.push('items: array con al menos 1 ítem');
  } else {
    const seen = new Set();
    review.items.forEach((it, i) => {
      const where = `items[${i}]`;
      if (!it || typeof it !== 'object') { errors.push(`${where}: objeto`); return; }
      if (typeof it.id !== 'string' || !ID_RE.test(it.id)) errors.push(`${where}.id: string sin espacios`);
      else if (seen.has(it.id)) errors.push(`${where}.id duplicado: ${it.id}`);
      else seen.add(it.id);
      if (typeof it.title !== 'string' || !it.title.trim()) errors.push(`${where}.title: string no vacío`);
      if (it.body_md !== undefined && typeof it.body_md !== 'string') errors.push(`${where}.body_md: string`);
      if (it.media !== undefined) {
        if (!isStringArray(it.media)) errors.push(`${where}.media: array de rutas relativas`);
        else it.media.forEach((m, j) => { if (!isSafeMediaPath(m)) errors.push(`${where}.media[${j}]: ruta relativa a la raíz, sin ".." ni carpetas ocultas (${m})`); });
      }
      if (it.tags !== undefined && !isStringArray(it.tags)) errors.push(`${where}.tags: array de strings`);
    });
  }
  if (errors.length) throw new CockpitError(`Revisión inválida:\n- ${errors.join('\n- ')}`);

  return {
    id: review.id,
    title: review.title.trim(),
    kind: review.kind,
    created_at: review.created_at || new Date().toISOString(),
    connects_to: review.connects_to || [],
    context_brief: review.context_brief || '',
    items: review.items.map(it => ({
      id: it.id,
      title: it.title.trim(),
      body_md: it.body_md || '',
      media: it.media || [],
      tags: it.tags || [],
    })),
  };
}

// ---------------------------------------------------------------------------
// API de revisiones
// ---------------------------------------------------------------------------

export function publishReview(review, root) {
  const normalized = validateReview(review);
  const { reviews } = cockpitPaths(root);
  const path = join(reviews, `${normalized.id}.json`);
  atomicWrite(path, JSON.stringify(normalized, null, 2) + '\n');
  return { path, review: normalized };
}

export function getReview(id, root) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return readJSONSafe(join(cockpitPaths(root).reviews, `${id}.json`));
}

export function getFeedback(id, root) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return readJSONSafe(join(cockpitPaths(root).feedback, `${id}.json`));
}

function feedbackStatus(fb) {
  if (!fb) return 'sin-feedback';
  return fb.processed ? 'procesado' : 'pendiente';
}

export function listReviews(root) {
  const p = cockpitPaths(root);
  const out = [];
  for (const id of listJSONIds(p.reviews)) {
    const r = readJSONSafe(join(p.reviews, `${id}.json`));
    if (!r || typeof r !== 'object' || !Array.isArray(r.items)) continue; // corrupto: se salta
    const fb = getFeedback(id, root);
    out.push({
      id,
      title: typeof r.title === 'string' ? r.title : id,
      kind: r.kind || 'other',
      created_at: r.created_at || '',
      connects_to: Array.isArray(r.connects_to) ? r.connects_to : [],
      item_count: r.items.length,
      feedback_status: feedbackStatus(fb),
      feedback_saved_at: fb ? fb.saved_at || null : null,
    });
  }
  out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return out;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function clip(s, n) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

export function normalizeSummary(summary) {
  if (summary === null || summary === undefined) return null;
  if (typeof summary !== 'object' || Array.isArray(summary)) return null;
  const arr = v => (Array.isArray(v) ? v : [])
    .filter(x => typeof x === 'string' && x.trim())
    .slice(0, LIMITS.summaryEntries)
    .map(x => clip(x.trim(), LIMITS.summaryText));
  return {
    decisions: arr(summary.decisions),
    open_questions: arr(summary.open_questions),
    requests: arr(summary.requests),
  };
}

/**
 * Guarda el feedback de una revisión (lo llama el server del cockpit). Siempre
 * deja processed=false: cualquier guardado nuevo vuelve a quedar pendiente para
 * el orquestador. Solo acepta ítems que existen en la revisión.
 */
export function saveFeedback(reviewId, payload, root) {
  assertId(reviewId, 'review_id');
  const review = getReview(reviewId, root);
  if (!review) throw new CockpitError(`No existe la revisión ${reviewId}`);
  const body = payload && typeof payload === 'object' ? payload : {};
  const validIds = new Set((review.items || []).map(i => i.id));

  const items = {};
  const rawItems = body.items && typeof body.items === 'object' ? body.items : {};
  for (const [itemId, v] of Object.entries(rawItems)) {
    if (!validIds.has(itemId) || !v || typeof v !== 'object') continue;
    const vote = VOTES.includes(v.vote) ? v.vote : null;
    const comment = clip(v.comment, LIMITS.comment);
    items[itemId] = { vote, comment };
  }

  const conversation = (Array.isArray(body.conversation) ? body.conversation : [])
    .filter(t => t && WHO.includes(t.who) && typeof t.text === 'string' && t.text.trim())
    .slice(-LIMITS.conversationTurns)
    .map(t => ({ who: t.who, text: clip(t.text.trim(), LIMITS.turnText) }));

  const feedback = {
    review_id: reviewId,
    saved_at: new Date().toISOString(),
    processed: false,
    items,
    conversation,
    summary: normalizeSummary(body.summary),
  };
  const path = join(cockpitPaths(root).feedback, `${reviewId}.json`);
  atomicWrite(path, JSON.stringify(feedback, null, 2) + '\n');
  return { path, feedback };
}

/** Feedback con processed=false, enriquecido con títulos de la revisión. */
export function pendingFeedback(root) {
  const p = cockpitPaths(root);
  const out = [];
  for (const id of listJSONIds(p.feedback)) {
    const fb = readJSONSafe(join(p.feedback, `${id}.json`));
    if (!fb || typeof fb !== 'object' || fb.processed !== false) continue;
    const review = getReview(id, root);
    const titles = {};
    if (review && Array.isArray(review.items)) for (const it of review.items) titles[it.id] = it.title;
    out.push({
      ...fb,
      review_id: id,
      review_title: review ? review.title : '(revisión borrada)',
      item_titles: titles,
    });
  }
  out.sort((a, b) => String(a.saved_at).localeCompare(String(b.saved_at)));
  return out;
}

export function markProcessed(reviewId, root) {
  assertId(reviewId, 'review_id');
  const path = join(cockpitPaths(root).feedback, `${reviewId}.json`);
  const fb = readJSONSafe(path);
  if (!fb) throw new CockpitError(`No hay feedback para ${reviewId}`);
  fb.processed = true;
  fb.processed_at = new Date().toISOString();
  atomicWrite(path, JSON.stringify(fb, null, 2) + '\n');
  return { review_id: reviewId, processed: true };
}

/** Texto compacto para el orquestador (lo imprime `node src/cockpit.js pending`). */
export function formatPending(list) {
  if (!list.length) return 'Sin feedback pendiente en el cockpit.';
  const lines = [`Feedback pendiente: ${list.length} revisión(es). Aplícalo y luego marca cada una con: node src/cockpit.js done <id>`, ''];
  for (const fb of list) {
    lines.push(`## ${fb.review_title}  [id: ${fb.review_id}]  guardado ${fb.saved_at}`);
    const entries = Object.entries(fb.items || {}).filter(([, v]) => v && (v.vote || (v.comment || '').trim()));
    if (entries.length) {
      lines.push('Ítems:');
      for (const [itemId, v] of entries) {
        const vote = v.vote === 'up' ? '[+]' : v.vote === 'down' ? '[-]' : '[ ]';
        const title = fb.item_titles[itemId] || itemId;
        const comment = (v.comment || '').trim();
        lines.push(`- ${vote} ${title}${comment ? `: ${comment}` : ''}`);
      }
    }
    const s = fb.summary;
    if (s) {
      if (s.decisions.length) { lines.push('Decisiones:'); s.decisions.forEach(d => lines.push(`- ${d}`)); }
      if (s.open_questions.length) { lines.push('Preguntas abiertas:'); s.open_questions.forEach(d => lines.push(`- ${d}`)); }
      if (s.requests.length) { lines.push('Pedidos nuevos:'); s.requests.forEach(d => lines.push(`- ${d}`)); }
    }
    if (fb.conversation && fb.conversation.length) {
      lines.push(`Conversación: ${fb.conversation.length} turnos (completa en cockpit/feedback/${fb.review_id}.json)`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Roadmap (solo lectura: no reescribe roadmap.md)
// ---------------------------------------------------------------------------

function readSectionRaw(md, marker) {
  const s = md.indexOf(marker.start);
  const e = md.indexOf(marker.end);
  if (s === -1 || e === -1 || e < s) return '';
  return md.slice(s + marker.start.length, e).trim();
}

function bulletLines(text) {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^[-*]\s+/.test(l))
    .map(l => l.replace(/^[-*]\s+(\[[ xX]\]\s+)?/, '').replace(/_\(.*?\)_/g, '').trim())
    .filter(l => l && !/^\(sin /.test(l));
}

// Parsea memory/sprint-log.md ignorando bloques ``` y comentarios <!-- -->.
export function parseSprintLog(md) {
  if (typeof md !== 'string') return [];
  const clean = md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
  const out = [];
  let cur = null;
  let section = null;
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+Sprint\s+(\d+)\s*[—–-]\s*(.+)$/.exec(line);
    if (h) {
      cur = { number: parseInt(h[1], 10), title: h[2].trim(), dates: '', deliverables: [], lessons: [] };
      out.push(cur);
      section = null;
      continue;
    }
    if (!cur) continue;
    const f = /^\*\*Fechas:\*\*\s*(.+)$/.exec(line);
    if (f) { cur.dates = f[1].trim(); continue; }
    if (/^\*\*Entregables:\*\*/.test(line)) { section = 'deliverables'; continue; }
    if (/^\*\*Lessons/.test(line)) { section = 'lessons'; continue; }
    if (/^\*\*/.test(line)) { section = null; continue; }
    const b = /^[-*]\s+(.+)$/.exec(line);
    if (b && section && !/^\(sin /.test(b[1])) cur[section].push(b[1].trim());
  }
  return out;
}

/** Foto del roadmap para el cockpit: sprints pasados, actual y lo que sigue. */
export function roadmapSnapshot(root) {
  const p = cockpitPaths(root);
  let sprint = null;
  try {
    if (existsSync(join(p.roadmap, 'current-sprint.json'))) sprint = getCurrentSprint(p.roadmap);
  } catch { sprint = null; }

  let md = '';
  try { md = readFileSync(join(p.roadmap, 'roadmap.md'), 'utf8'); } catch { md = ''; }
  const M = roadmapInternal.MARKERS;
  const preview = bulletLines(readSectionRaw(md, M.preview));
  const alta = bulletLines(readSectionRaw(md, M.alta));

  let log = '';
  try { log = readFileSync(join(p.memory, 'sprint-log.md'), 'utf8'); } catch { log = ''; }

  return {
    done: parseSprintLog(log),
    now: sprint ? {
      number: sprint.number,
      objective: sprint.objective || '',
      started_at: sprint.started_at || '',
      target_close: sprint.target_close || '',
      tasks: (sprint.tasks || []).map(t => ({ id: t.id, title: t.title, status: t.status })),
    } : null,
    next: { preview, high_priority: alta },
  };
}

// ---------------------------------------------------------------------------
// Guía conversacional (voz y texto comparten persona y formato de resumen)
// ---------------------------------------------------------------------------

export const SUMMARY_INSTRUCTIONS = 'Resume la conversación SOLO como JSON válido, sin texto extra ni bloques de código, con esta forma exacta: {"decisions": [string], "open_questions": [string], "requests": [string]}. decisions = lo que el usuario aprobó, rechazó o decidió. open_questions = dudas que quedaron sin resolver. requests = pedidos o ideas nuevas del usuario. Incluye solo lo que el usuario dijo de forma explícita: no infieras aprobaciones de ítems que no comentó. Frases cortas en español neutro. Arrays vacíos si no hay nada.';

function itemsDigest(review, maxBody = 600) {
  return (review.items || []).map((it, i) => {
    const body = String(it.body_md || '').replace(/\s+/g, ' ').trim();
    const short = body.length > maxBody ? `${body.slice(0, maxBody)}…` : body;
    const tags = it.tags && it.tags.length ? ` (etiquetas: ${it.tags.join(', ')})` : '';
    return `${i + 1}. [${it.id}] ${it.title}${tags}${short ? `\n   ${short}` : ''}`;
  }).join('\n');
}

/**
 * Instrucciones de la guía. NO es el orquestador: recorre los ítems, pregunta la
 * opinión del usuario y al final resume. `mode` = 'voz' | 'texto'.
 */
export function buildGuideInstructions(review, mode = 'voz') {
  const connects = review.connects_to && review.connects_to.length ? review.connects_to.join(', ') : 'el resto del proyecto';
  const style = mode === 'voz'
    ? 'Hablas por voz: turnos cortos (1 a 3 frases), ritmo tranquilo, sin listas largas ni markdown, sin leer IDs ni rutas en voz alta.'
    : 'Escribes en un chat: mensajes cortos (máximo 4 frases), texto plano sin markdown (sin asteriscos, títulos ni tablas).';
  return [
    'Eres la guía de revisión del cockpit de Aldot. Hablas en español neutro con tuteo neutro: "quieres", "puedes", "tienes", "dime", "mira". NUNCA voseo ni regionalismos rioplatenses (nada de vos, querés, queres, podés, tenés, decime, mirá, che). Aldot es un usuario novato: explica sin jerga.',
    'No eres el orquestador: no ejecutas tareas ni prometes cambios. Tu trabajo es recorrer la revisión, pedir la opinión de Aldot y dejar sus decisiones claras para que el orquestador las aplique después.',
    style,
    'Método: saluda en una frase y di cuántos ítems hay. Luego recorre los ítems en orden, uno a la vez: explica el ítem en pocas palabras y haz UNA sola pregunta (¿lo apruebas, lo cambias o lo descartas?). Ahí termina tu turno: DETENTE y espera la respuesta. Nunca expliques dos ítems en el mismo turno; si hay silencio, espera o pregunta si sigue ahí. Si Aldot pide saltar o volver, hazlo. Si algo no está en el contexto, dilo; no inventes.',
    'Al terminar los ítems, pregunta si hay algo nuevo que quiera pedir. Cierra con un resumen hablado de máximo 4 frases: decisiones, dudas abiertas y pedidos nuevos. Luego dile que presione "Terminar y guardar".',
    '',
    `Revisión: "${review.title}" (tipo: ${review.kind}). Conecta con: ${connects}.`,
    '',
    'Contexto escrito por el orquestador:',
    review.context_brief || '(sin contexto adicional)',
    '',
    'Ítems:',
    itemsDigest(review),
  ].join('\n');
}

/** Extrae y normaliza el JSON de resumen desde la respuesta de un modelo. */
export function parseSummary(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return normalizeSummary(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cliMain(argv) {
  const [cmd, arg] = argv;
  try {
    if (cmd === 'pending') {
      const list = pendingFeedback();
      if (argv.includes('--json')) console.log(JSON.stringify(list, null, 2));
      else console.log(formatPending(list));
      return 0;
    }
    if (cmd === 'publish') {
      if (!arg) { console.error('Uso: node src/cockpit.js publish <archivo.json>'); return 1; }
      const raw = readFileSync(resolve(arg), 'utf8');
      let data;
      try { data = JSON.parse(raw); } catch (e) { console.error(`JSON inválido en ${arg}: ${e.message}`); return 1; }
      const { path, review } = publishReview(data);
      console.log(`Publicada "${review.title}" (${review.items.length} ítems) en ${path}. Ábrela con npm run cockpit → http://localhost:7788/#/r/${review.id}`);
      return 0;
    }
    if (cmd === 'done') {
      if (!arg) { console.error('Uso: node src/cockpit.js done <review_id>'); return 1; }
      markProcessed(arg);
      console.log(`Feedback de ${arg} marcado como procesado.`);
      return 0;
    }
    if (cmd === 'list') {
      const list = listReviews();
      if (!list.length) { console.log('No hay revisiones publicadas.'); return 0; }
      for (const r of list) console.log(`${r.id}  [${r.kind}] ${r.title}  (${r.item_count} ítems, ${r.feedback_status})`);
      return 0;
    }
    console.log('Uso: node src/cockpit.js pending [--json] | publish <archivo> | done <id> | list');
    return cmd ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(cliMain(process.argv.slice(2)));
