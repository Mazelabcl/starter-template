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
//   node src/cockpit.js publish <archivo> [--estricto]  (valida y publica; con
//                                           --estricto rechaza ítems sin visual o con titular largo)
//   node src/cockpit.js sprint-deck <borrador.json> [--estricto]  (cierre de sprint
//                                           como presentación para directorio)
//   node src/cockpit.js done <review_id>   (marca el feedback como procesado)
//   node src/cockpit.js list               (revisiones publicadas)
//   node src/cockpit.js open [review_id]   (levanta el server en segundo plano si
//                                           no está y abre el navegador; idempotente;
//                                           `open uso` abre la página de uso)
//   node src/cockpit.js stop               (cierra el server que levantó `open`)
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
  openSync,
  closeSync,
} from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

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

// --- Visuales: una revisión se mira, no se lee. Ver cockpit/README.md ---------

export const VISUAL_TYPES = ['image', 'before_after', 'compare', 'diagram'];
export const DIAGRAM_KINDS = ['flow', 'org', 'timeline', 'connects'];
export const HEADLINE_MAX_WORDS = 10;
export const MAX_STATS = 3;
export const MAX_OPTION_LINES = 5;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const isText = v => typeof v === 'string' && v.trim().length > 0;
const isUnit = v => typeof v === 'number' && v >= 0 && v <= 1;

function checkImage(p, where, errors) {
  if (!isSafeMediaPath(p) || !IMAGE_EXT.test(String(p))) errors.push(`${where}: imagen con ruta relativa a la raíz, sin ".." ni carpetas ocultas (${p})`);
}

function checkHotspots(list, where, errors) {
  if (list === undefined) return;
  if (!Array.isArray(list)) { errors.push(`${where}: array`); return; }
  list.forEach((s, i) => {
    if (!s || !isUnit(s.x) || !isUnit(s.y) || !isUnit(s.w) || !isUnit(s.h)) errors.push(`${where}[${i}]: x, y, w, h entre 0 y 1`);
    if (s && s.label !== undefined && typeof s.label !== 'string') errors.push(`${where}[${i}].label: string`);
  });
}

function checkBeforeAfter(v, where, errors) {
  checkImage(v.before, `${where}.before`, errors);
  checkImage(v.after, `${where}.after`, errors);
  checkHotspots(v.hotspots, `${where}.hotspots`, errors);
}

function checkDiagram(v, where, errors) {
  if (!DIAGRAM_KINDS.includes(v.kind)) { errors.push(`${where}.kind: uno de ${DIAGRAM_KINDS.join('|')}`); return; }
  const labels = (list, name, min = 1) => {
    if (!Array.isArray(list) || list.length < min) { errors.push(`${where}.${name}: al menos ${min}`); return false; }
    return true;
  };
  if (v.kind === 'flow' && labels(v.steps, 'steps', 2)) {
    v.steps.forEach((s, i) => {
      const parallel = s && Array.isArray(s.parallel) && s.parallel.length && s.parallel.every(p => p && isText(p.label));
      if (!s || (!isText(s.label) && !parallel)) errors.push(`${where}.steps[${i}]: label o parallel[{label}]`);
    });
  }
  if (v.kind === 'org' && labels(v.members, 'members')) {
    v.members.forEach((m, i) => { if (!m || !isText(m.label)) errors.push(`${where}.members[${i}].label: texto`); });
    if (v.lead !== undefined && (!v.lead || !isText(v.lead.label))) errors.push(`${where}.lead.label: texto`);
  }
  if (v.kind === 'timeline' && labels(v.items, 'items')) {
    v.items.forEach((t, i) => {
      if (!t || !isText(t.label)) errors.push(`${where}.items[${i}].label: texto`);
      if (!t || !['past', 'current', 'next'].includes(t.state)) errors.push(`${where}.items[${i}].state: past|current|next`);
    });
  }
  if (v.kind === 'connects') {
    if (!isText(v.center)) errors.push(`${where}.center: texto`);
    if (labels(v.links, 'links')) v.links.forEach((l, i) => { if (!l || !isText(l.label)) errors.push(`${where}.links[${i}].label: texto`); });
  }
}

function checkVisual(v, where, errors) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${where}: objeto`); return; }
  if (!VISUAL_TYPES.includes(v.type)) { errors.push(`${where}.type: uno de ${VISUAL_TYPES.join('|')}`); return; }
  if (v.type === 'image') {
    checkImage(v.path, `${where}.path`, errors);
    if (v.path_mobile !== undefined) checkImage(v.path_mobile, `${where}.path_mobile`, errors);
    checkHotspots(v.hotspots, `${where}.hotspots`, errors);
  }
  if (v.type === 'before_after') {
    checkBeforeAfter(v, where, errors);
    if (v.views !== undefined) {
      if (!Array.isArray(v.views)) errors.push(`${where}.views: array`);
      else v.views.forEach((x, i) => { if (x && typeof x === 'object') checkBeforeAfter(x, `${where}.views[${i}]`, errors); else errors.push(`${where}.views[${i}]: objeto`); });
    }
  }
  if (v.type === 'compare') {
    if (!Array.isArray(v.options) || v.options.length < 2 || v.options.length > 3) errors.push(`${where}.options: de 2 a 3 opciones`);
    else {
      const ids = new Set();
      v.options.forEach((o, i) => {
        const w = `${where}.options[${i}]`;
        if (!o || typeof o !== 'object') { errors.push(`${w}: objeto`); return; }
        if (typeof o.id !== 'string' || !ID_RE.test(o.id)) errors.push(`${w}.id: string sin espacios`);
        else if (ids.has(o.id)) errors.push(`${w}.id duplicado: ${o.id}`);
        else ids.add(o.id);
        if (!isText(o.label)) errors.push(`${w}.label: texto`);
        if (o.image !== undefined) checkImage(o.image, `${w}.image`, errors);
        if (o.image_mobile !== undefined) checkImage(o.image_mobile, `${w}.image_mobile`, errors);
        if (o.images !== undefined) {
          if (!isStringArray(o.images)) errors.push(`${w}.images: array de rutas`);
          else o.images.forEach((m, j) => checkImage(m, `${w}.images[${j}]`, errors));
        }
        if (o.item !== undefined && (typeof o.item !== 'string' || !ID_RE.test(o.item))) errors.push(`${w}.item: id sin espacios`);
        // Líneas cortas bajo cada opción para ver la DIFERENCIA de un vistazo (p. ej. Antes → Ahora).
        if (o.lines !== undefined) {
          if (!Array.isArray(o.lines) || o.lines.length > MAX_OPTION_LINES) errors.push(`${w}.lines: hasta ${MAX_OPTION_LINES} líneas`);
          else o.lines.forEach((l, j) => { if (!l || !isText(l.label) || !isText(l.text)) errors.push(`${w}.lines[${j}]: { label, text }`); });
        }
      });
    }
  }
  if (v.type === 'diagram') checkDiagram(v, where, errors);
}

function checkStats(stats, where, errors) {
  if (stats === undefined) return;
  if (!Array.isArray(stats) || stats.length > MAX_STATS) { errors.push(`${where}: hasta ${MAX_STATS} números grandes`); return; }
  stats.forEach((s, i) => {
    const okValue = s && (typeof s.value === 'number' || isText(s.value));
    if (!okValue || !isText(s.label)) errors.push(`${where}[${i}]: { value, label }`);
  });
}

/** Todas las imágenes que usa un visual (el server solo sirve media declarada). */
export function visualPaths(v) {
  if (!v || typeof v !== 'object') return [];
  const out = [];
  const add = p => { if (typeof p === 'string') out.push(p); };
  if (v.type === 'image') { add(v.path); add(v.path_mobile); }
  if (v.type === 'before_after') {
    add(v.before); add(v.after);
    for (const x of Array.isArray(v.views) ? v.views : []) { add(x?.before); add(x?.after); }
  }
  if (v.type === 'compare') {
    for (const o of Array.isArray(v.options) ? v.options : []) {
      add(o?.image); add(o?.image_mobile);
      for (const m of Array.isArray(o?.images) ? o.images : []) add(m);
    }
  }
  return out;
}

/** Rutas que un ítem declara: su `media` más las del visual. */
export function itemMediaPaths(item) {
  return [...(Array.isArray(item?.media) ? item.media : []), ...visualPaths(item?.visual)];
}

/** Ítems que reciben votos además de los de la revisión (opciones de un `compare`). */
function compareTargets(review) {
  const out = {};
  for (const it of Array.isArray(review?.items) ? review.items : []) {
    if (it?.visual?.type !== 'compare' || !Array.isArray(it.visual.options)) continue;
    for (const o of it.visual.options) if (o && typeof o.item === 'string') out[o.item] = o.label;
  }
  return out;
}

const countWords = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/**
 * Lo que aleja a una revisión del formato visual. No invalida el JSON: se avisa al
 * publicar y solo se rechaza con --estricto.
 */
export function reviewWarnings(review) {
  const out = [];
  for (const it of review.items || []) {
    if (!it.visual) out.push(`${it.id}: sin visual (agrega image, before_after, compare o diagram)`);
    if (!isText(it.headline)) out.push(`${it.id}: sin headline (titular de máximo ${HEADLINE_MAX_WORDS} palabras)`);
    else if (countWords(it.headline) > HEADLINE_MAX_WORDS) out.push(`${it.id}: headline de ${countWords(it.headline)} palabras (máximo ${HEADLINE_MAX_WORDS})`);
  }
  return out;
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
  if (review.sprint !== undefined && !(Number.isInteger(review.sprint) && review.sprint >= 0)) errors.push('sprint: entero desde 0 (0 = arranque)');
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
      for (const k of ['headline', 'ask', 'kicker']) if (it[k] !== undefined && typeof it[k] !== 'string') errors.push(`${where}.${k}: string`);
      if (it.visual !== undefined) checkVisual(it.visual, `${where}.visual`, errors);
      checkStats(it.stats, `${where}.stats`, errors);
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
    ...(review.sprint !== undefined ? { sprint: review.sprint } : {}),
    items: review.items.map(it => ({
      id: it.id,
      title: it.title.trim(),
      body_md: it.body_md || '',
      media: it.media || [],
      tags: it.tags || [],
      // Campos visuales: solo si vienen, para que el contrato viejo quede intacto.
      ...(it.headline !== undefined ? { headline: it.headline.trim() } : {}),
      ...(it.kicker !== undefined ? { kicker: it.kicker.trim() } : {}),
      ...(it.ask !== undefined ? { ask: it.ask.trim() } : {}),
      ...(it.visual !== undefined ? { visual: it.visual } : {}),
      ...(it.stats !== undefined ? { stats: it.stats } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// API de revisiones
// ---------------------------------------------------------------------------

/**
 * Publica una revisión. `opts.estricto` rechaza lo que no sea visual primero; sin él
 * solo avisa por consola. Si no trae `sprint`, toma el sprint activo del roadmap.
 */
export function publishReview(review, root, opts = {}) {
  const normalized = validateReview(review);
  const warnings = reviewWarnings(normalized);
  if (warnings.length && opts.estricto) {
    throw new CockpitError(`Revisión rechazada por --estricto (no es visual primero):\n- ${warnings.join('\n- ')}`);
  }
  if (warnings.length && !opts.silencioso) {
    console.warn(`[cockpit] Aviso: esta revisión no es visual primero. Aldot no lee muros de texto.\n- ${warnings.join('\n- ')}`);
  }
  if (normalized.sprint === undefined) {
    const now = roadmapSnapshot(root).now;
    if (now && now.objective) normalized.sprint = now.number;
  }
  const { reviews } = cockpitPaths(root);
  const path = join(reviews, `${normalized.id}.json`);
  atomicWrite(path, JSON.stringify(normalized, null, 2) + '\n');
  return { path, review: normalized, warnings };
}

// ---------------------------------------------------------------------------
// Cierre de sprint: presentación para directorio
// ---------------------------------------------------------------------------

/**
 * Borrador → revisión: resumen con 3 números, lo entregado en imágenes, lo que sigue
 * y la decisión que se necesita. Lista TODOS los problemas del borrador de una vez.
 * Formato: cockpit/ejemplo-sprint-deck.json.
 */
export function buildSprintDeck(d) {
  const errors = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new CockpitError('El borrador debe ser un objeto JSON.');
  if (!Number.isInteger(d.sprint) || d.sprint < 0) errors.push('sprint: número de sprint');
  if (!isText(d.titular)) errors.push('titular: una idea en máximo 10 palabras');
  if (!Array.isArray(d.numeros) || !d.numeros.length || d.numeros.length > MAX_STATS) errors.push(`numeros: de 1 a ${MAX_STATS} { value, label }`);
  if (!Array.isArray(d.entregado) || !d.entregado.length) errors.push('entregado: al menos 1 { titular, imagen | antes + despues | visual }');
  else d.entregado.forEach((e, i) => {
    if (!e || !isText(e.titular)) errors.push(`entregado[${i}].titular: texto`);
    if (e && !e.imagen && !e.visual && !(e.antes && e.despues)) errors.push(`entregado[${i}]: imagen, antes + despues, o visual`);
  });
  if (!Array.isArray(d.sigue) || !d.sigue.length) errors.push('sigue: al menos 1 texto');
  if (!d.decision || !isText(d.decision.titular) || !Array.isArray(d.decision.opciones) || d.decision.opciones.length < 2) errors.push('decision: { titular, opciones: [2 o 3 { label, imagen? }] }');
  if (errors.length) throw new CockpitError(`Borrador de sprint inválido:\n- ${errors.join('\n- ')}`);

  const label = x => (typeof x === 'string' ? x : x.label);
  const items = [{
    id: 'resumen',
    title: d.titular,
    headline: d.titular,
    kicker: `Sprint ${d.sprint}`,
    ask: '¿Vamos bien?',
    body_md: d.detalle || '',
    visual: {
      type: 'diagram',
      kind: 'timeline',
      items: [
        ...(d.antes || []).slice(-2).map(x => ({ label: label(x), state: 'past' })),
        { label: d.entregado_corto || `Sprint ${d.sprint}`, state: 'current' },
        ...d.sigue.slice(0, 2).map(x => ({ label: label(x), state: 'next' })),
      ],
    },
    stats: d.numeros,
  }];
  d.entregado.forEach((e, i) => {
    const visual = e.visual || (e.imagen
      ? { type: 'image', path: e.imagen, ...(e.imagen_mobile ? { path_mobile: e.imagen_mobile } : {}) }
      : { type: 'before_after', before: e.antes, after: e.despues, ...(e.hotspots ? { hotspots: e.hotspots } : {}) });
    items.push({
      id: e.id || `entregado-${i + 1}`,
      title: e.titular,
      headline: e.titular,
      kicker: 'Entregado',
      ask: e.pregunta || '¿Te convence?',
      body_md: e.detalle || '',
      visual,
      ...(e.numeros ? { stats: e.numeros } : {}),
    });
  });
  items.push({
    id: 'sigue',
    title: 'Lo que sigue',
    headline: d.sigue_titular || 'Lo que sigue',
    kicker: 'Sigue',
    ask: '¿Es el orden correcto?',
    body_md: '',
    visual: d.sigue.length >= 2
      ? { type: 'diagram', kind: 'flow', steps: d.sigue.slice(0, 6).map(x => (typeof x === 'string' ? { label: x } : x)) }
      : { type: 'diagram', kind: 'timeline', items: [{ label: `Sprint ${d.sprint}`, state: 'current' }, { label: label(d.sigue[0]), state: 'next' }] },
  });
  items.push({
    id: 'decision',
    title: d.decision.titular,
    headline: d.decision.titular,
    kicker: 'Decisión',
    ask: 'Elige una',
    body_md: d.decision.detalle || '',
    visual: {
      type: 'compare',
      options: d.decision.opciones.slice(0, 3).map((o, i) => ({
        id: o.id || `opcion-${i + 1}`,
        label: o.label,
        ...(o.imagen ? { image: o.imagen } : {}),
        ...(o.icon ? { icon: o.icon } : {}),
      })),
    },
  });
  return {
    id: d.id || `sprint-${d.sprint}-deck`,
    title: `Sprint ${d.sprint}: ${d.titular}`,
    kind: 'deliverable',
    sprint: d.sprint,
    connects_to: d.connects_to || [`Sprint ${d.sprint}`],
    context_brief: d.context_brief || `Cierre del sprint ${d.sprint}: ${d.titular}. Recorre lo entregado, lo que sigue y pide la decisión: ${d.decision.titular}.`,
    items,
  };
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

/** Miniatura de una revisión: la primera imagen; si no hay, el primer diagrama. */
export function reviewCover(review) {
  const items = Array.isArray(review?.items) ? review.items : [];
  for (const it of items) {
    const v = it?.visual;
    if (v?.type === 'before_after' && typeof v.after === 'string') return { type: 'image', path: v.after };
    const path = visualPaths(v)[0];
    if (path) return { type: 'image', path };
    const img = (Array.isArray(it?.media) ? it.media : []).find(m => typeof m === 'string' && IMAGE_EXT.test(m));
    if (img) return { type: 'image', path: img };
  }
  for (const it of items) if (it?.visual?.type === 'diagram') return { type: 'diagram', visual: it.visual };
  return null;
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
      voted_count: fb && fb.items ? Object.values(fb.items).filter(v => v && v.vote).length : 0,
      sprint: Number.isInteger(r.sprint) ? r.sprint : null,
      cover: reviewCover(r),
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
  const validIds = new Set([...(review.items || []).map(i => i.id), ...Object.keys(compareTargets(review))]);

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
    const titles = { ...compareTargets(review) };
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

/** Lo que muestra un visual, en palabras: la guía de voz no ve imágenes. */
function visualDigest(v) {
  if (!v) return '';
  if (v.type === 'before_after') {
    const spots = (v.hotspots || []).map(s => s.label).filter(Boolean);
    return `Se ve un antes y después${spots.length ? `; cambios marcados: ${spots.join(', ')}` : ''}.`;
  }
  if (v.type === 'compare') {
    return `Se comparan estas opciones: ${(v.options || []).map(o => {
      const lines = (Array.isArray(o.lines) ? o.lines : []).map(l => `${l.label}: ${l.text}`).join('; ');
      return lines ? `${o.label} (${lines})` : o.label;
    }).join(', ')}.`;
  }
  if (v.type === 'image') return `Se ve una imagen${v.alt ? `: ${v.alt}` : ''}.`;
  if (v.type === 'diagram') {
    if (v.kind === 'flow') return `Diagrama de pasos: ${(v.steps || []).map(s => s.label || (s.parallel || []).map(p => p.label).join(' y ')).join(' → ')}.`;
    if (v.kind === 'org') return `Equipo: ${(v.members || []).map(m => m.label).join(', ')}.`;
    if (v.kind === 'timeline') return `Línea de tiempo: ${(v.items || []).map(t => t.label).join(' → ')}.`;
    if (v.kind === 'connects') return `${v.center} conecta con: ${(v.links || []).map(l => l.label).join(', ')}.`;
  }
  return '';
}

function itemsDigest(review, maxBody = 600) {
  return (review.items || []).map((it, i) => {
    const body = String(it.body_md || '').replace(/\s+/g, ' ').trim();
    const short = body.length > maxBody ? `${body.slice(0, maxBody)}…` : body;
    const tags = it.tags && it.tags.length ? ` (etiquetas: ${it.tags.join(', ')})` : '';
    const seen = visualDigest(it.visual);
    const stats = (it.stats || []).map(s => `${s.value} ${s.label}`).join(', ');
    const extra = [seen, stats, short].filter(Boolean).join(' ');
    return `${i + 1}. [${it.id}] ${it.title}${tags}${extra ? `\n   ${extra}` : ''}`;
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
// Server en segundo plano (open / stop): el usuario no abre otra terminal.
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 7788;
const SERVER_SCRIPT = join(REPO_ROOT, 'cockpit', 'server.js');
const PORT_SCAN = 10; // si 7788 lo ocupa otra cosa, prueba 7789..7797

export function defaultPort() {
  const p = parseInt(process.env.COCKPIT_PORT || '', 10);
  return Number.isInteger(p) && p > 0 ? p : DEFAULT_PORT;
}

export function serverFiles(root) {
  const dir = join(resolveRoot(root), 'cockpit');
  return { dir, pid: join(dir, '.server.pid'), log: join(dir, '.server.log') };
}

export function cockpitUrl(port, reviewId) {
  const base = `http://localhost:${port}`;
  if (!reviewId) return base;
  if (reviewId === 'uso') return `${base}/#/uso`; // página fija, no una revisión
  assertId(reviewId, 'review_id');
  return `${base}/#/r/${reviewId}`;
}

/** Pregunta por HTTP a /api/health. Devuelve { ok, root } si responde un cockpit, o null. */
export function probeCockpit(port, timeoutMs = 800) {
  return new Promise(done => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          done(res.statusCode === 200 && j && j.ok === true ? j : null);
        } catch { done(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

function portFree(port) {
  return new Promise(done => {
    const s = net.createServer();
    s.once('error', () => done(false));
    s.listen(port, '127.0.0.1', () => s.close(() => done(true)));
  });
}

function sameRoot(a, b) {
  if (!a || !b) return false;
  const norm = p => resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function readPidFile(root) {
  const f = serverFiles(root).pid;
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return Number.isInteger(j.pid) && Number.isInteger(j.port) ? j : null;
  } catch { return null; }
}

function removePidFile(root) {
  try { unlinkSync(serverFiles(root).pid); } catch { /* no existía */ }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Busca un cockpit de ESTA raíz ya corriendo (puerto del .pid o el puerto por defecto). */
export async function findRunningServer({ root, port } = {}) {
  const r = resolveRoot(root);
  const info = readPidFile(r);
  const candidates = [...new Set([info?.port, port ?? defaultPort()].filter(Boolean))];
  for (const p of candidates) {
    const h = await probeCockpit(p);
    if (h && sameRoot(h.root, r)) return { port: p, pid: info && info.port === p ? info.pid : null };
  }
  return null;
}

function tailLog(file, n = 8) {
  try { return readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-n).join('\n'); } catch { return ''; }
}

/**
 * Deja un cockpit de esta raíz respondiendo. Si ya hay uno, no hace nada.
 * Si el puerto lo ocupa otra cosa (review-app, cockpit de otro proyecto), usa el siguiente libre.
 * Devuelve { port, pid, started }.
 */
export async function ensureServer({ root, port, timeoutMs = 15000, serverScript = SERVER_SCRIPT } = {}) {
  const r = resolveRoot(root);
  const base = port ?? defaultPort();
  const running = await findRunningServer({ root: r, port: base });
  if (running) return { ...running, started: false };

  let chosen = null;
  for (let p = base; p < base + PORT_SCAN; p++) {
    if (await portFree(p)) { chosen = p; break; }
  }
  if (!chosen) throw new CockpitError(`No encontré un puerto libre entre ${base} y ${base + PORT_SCAN - 1}.`);

  const files = serverFiles(r);
  mkdirSync(files.dir, { recursive: true });
  const fd = openSync(files.log, 'a');
  let child;
  try {
    child = spawn(process.execPath, [serverScript], {
      cwd: r,
      env: { ...process.env, COCKPIT_ROOT: r, COCKPIT_PORT: String(chosen) },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  let exited = null;
  child.on('exit', code => { exited = code ?? 'señal'; });
  child.on('error', e => { exited = e.message; });
  child.unref();
  writeFileSync(files.pid, JSON.stringify({ pid: child.pid, port: chosen, started_at: new Date().toISOString() }) + '\n');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await probeCockpit(chosen, 500);
    if (h && sameRoot(h.root, r)) return { port: chosen, pid: child.pid, started: true };
    if (exited !== null) break;
    await sleep(200);
  }
  if (exited === null) { try { process.kill(child.pid); } catch { /* ya cerró */ } }
  removePidFile(r);
  const tail = tailLog(files.log);
  throw new CockpitError(`El cockpit no arrancó${exited !== null ? ` (salió con ${exited})` : ' a tiempo'}.${tail ? `\nÚltimas líneas de cockpit/.server.log:\n${tail}` : ''}`);
}

/** Comando para abrir el navegador por defecto según el sistema. */
export function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url], verbatim: true };
  if (platform === 'darwin') return { cmd: 'open', args: [url], verbatim: false };
  return { cmd: 'xdg-open', args: [url], verbatim: false };
}

/** Abre el navegador. Con COCKPIT_NO_BROWSER=1 no abre nada (tests). Devuelve true si lo intentó. */
export function openBrowser(url) {
  if (process.env.COCKPIT_NO_BROWSER === '1') return false;
  const { cmd, args, verbatim } = browserCommand(url);
  try {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: verbatim });
    p.on('error', () => { /* sin navegador: el usuario usa la URL impresa */ });
    p.unref();
    return true;
  } catch { return false; }
}

export async function openCockpit({ root, port, reviewId, timeoutMs } = {}) {
  if (reviewId) assertId(reviewId, 'review_id');
  const s = await ensureServer({ root, port, timeoutMs });
  const url = cockpitUrl(s.port, reviewId);
  const browser = openBrowser(url);
  return { ...s, url, browser };
}

/** Cierra el server que levantó `open` (el del .server.pid). Devuelve { stopped, reason }. */
export async function stopServer({ root, timeoutMs = 5000 } = {}) {
  const r = resolveRoot(root);
  const info = readPidFile(r);
  if (!info) {
    const other = await findRunningServer({ root: r });
    if (other) return { stopped: false, reason: 'manual', port: other.port };
    return { stopped: false, reason: 'none' };
  }
  if (!processAlive(info.pid)) { removePidFile(r); return { stopped: false, reason: 'stale' }; }
  // Solo matamos el PID si en su puerto responde un cockpit de esta raíz (evita matar
  // un proceso ajeno que reutilizó el PID).
  const h = await probeCockpit(info.port);
  if (!h || !sameRoot(h.root, r)) { removePidFile(r); return { stopped: false, reason: 'stale' }; }
  try { process.kill(info.pid); } catch { /* ya cerró */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && await probeCockpit(info.port, 300)) await sleep(150);
  removePidFile(r);
  return { stopped: true, port: info.port, pid: info.pid };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function cliOpen(reviewId) {
  const s = await openCockpit({ reviewId });
  const how = s.started ? `servidor iniciado en segundo plano, PID ${s.pid}, log en cockpit/.server.log` : 'el servidor ya estaba corriendo';
  if (s.browser) console.log(`Te abrí el cockpit en el navegador: ${s.url} (${how}).`);
  else console.log(`Cockpit listo en ${s.url} (${how}). Ábrelo en el navegador.`);
  return 0;
}

async function cliStop() {
  const s = await stopServer();
  if (s.stopped) console.log(`Cockpit cerrado (puerto ${s.port}).`);
  else if (s.reason === 'manual') console.log(`Hay un cockpit en el puerto ${s.port}, pero no lo abrí yo: ciérralo con Ctrl + C en la terminal donde corre npm run cockpit.`);
  else if (s.reason === 'stale') console.log('El cockpit ya estaba cerrado (limpié el registro viejo).');
  else console.log('No hay ningún cockpit corriendo.');
  return 0;
}

function cliMain(argv) {
  const [cmd, arg] = argv;
  if (cmd === 'open' || cmd === 'stop') {
    const run = cmd === 'open' ? cliOpen(arg) : cliStop();
    return run.catch(e => { console.error(e.message); return 1; });
  }
  try {
    if (cmd === 'pending') {
      const list = pendingFeedback();
      if (argv.includes('--json')) console.log(JSON.stringify(list, null, 2));
      else console.log(formatPending(list));
      return 0;
    }
    if (cmd === 'publish' || cmd === 'sprint-deck') {
      if (!arg) { console.error(`Uso: node src/cockpit.js ${cmd} <archivo.json> [--estricto]`); return 1; }
      const raw = readFileSync(resolve(arg), 'utf8');
      let data;
      try { data = JSON.parse(raw); } catch (e) { console.error(`JSON inválido en ${arg}: ${e.message}`); return 1; }
      const toPublish = cmd === 'sprint-deck' ? buildSprintDeck(data) : data;
      const { path, review } = publishReview(toPublish, undefined, { estricto: argv.includes('--estricto') });
      console.log(`Publicada "${review.title}" (${review.items.length} ítems) en ${path}. Ábrela con: node src/cockpit.js open ${review.id}`);
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
    console.log('Uso: node src/cockpit.js pending [--json] | publish <archivo> [--estricto] | sprint-deck <borrador> [--estricto] | done <id> | list | open [id] | stop');
    return cmd ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) Promise.resolve(cliMain(process.argv.slice(2))).then(code => process.exit(code));
