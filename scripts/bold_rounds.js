// scripts/bold_rounds.js
// Helper de /bold-rounds: mejora audaz por rondas sobre una COPIA del objetivo.
// Cada ronda corre dos variantes (ciega y con contexto), saca screenshots antes/después,
// descarta las que no cambian nada visible y publica la comparación en el cockpit.
// El objetivo original NUNCA se modifica desde este script.
//
// Uso (desde la raíz del proyecto):
//   node scripts/bold_rounds.js init <carpeta|archivo|url> [--rounds 5] [--pause-every 3] [--out rounds] [--goal "texto"]
//        [--modo visual|producto] [--involucramiento auto|cada:N|todas] [--hallazgos a.md,b.md] [--lentes a,b|auto] [--modelo sonnet]
//   node scripts/bold_rounds.js prepare <ronda> [--force] [--lente-blind X --lente-context Y --modelo M]     (copias blind/context + "antes" + prompts)
//   node scripts/bold_rounds.js run <ronda> [blind|context|both] [--fondo] [--paralelo] [--timeout-min 15]
//        (método B: por variante, IDEAR con `claude -p` aislado y luego CONSTRUIR en otra sesión aislada)
//   node scripts/bold_rounds.js espera <ronda> [--max-seg 240]   (espera corta a que termine `run --fondo`)
//   node scripts/bold_rounds.js after <ronda>                   (screenshots "después" + diff + sintaxis + rechazo)
//   node scripts/bold_rounds.js resumen                         (página visual de toda la corrida en el cockpit)
//   node scripts/bold_rounds.js review <ronda> [--sprint N]     (publica la revisión kind "rounds" en el cockpit, en imágenes)
//   node scripts/bold_rounds.js choice <ronda>                  (lee los votos del cockpit)
//   node scripts/bold_rounds.js apply <ronda> <blind|context|integrada> [--auto --razon "..."] [--comentario "..."]
//   node scripts/bold_rounds.js status | changes                (status incluye "siguiente_paso")
//   node scripts/bold_rounds.js shot <carpeta|archivo|url> <prefijo>
//   node scripts/bold_rounds.js diff <antes.png> <despues.png>
//
// Sin dependencias obligatorias: el PNG se decodifica con zlib. Playwright es opcional
// (solo para screenshots) y se carga dinámicamente.
// Idioma: español neutro.

import {
  cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

import { publishReview, getFeedback, getReview, resolveRoot, isSafeMediaPath } from '../src/cockpit.js';
import { runAislado, detectaLimite } from '../src/claude_aislado.js';
import { presupuestoRondas, textoPresupuesto } from '../src/presupuesto.js';

export const DEFAULTS = {
  rounds: 5, maxRounds: 10, pauseEvery: 3, threshold: 0.005, timeoutMin: 15,
  // Método B: idear y construir son sesiones aisladas distintas, con topes duros.
  ideaModel: 'opus', buildModel: 'sonnet', ideaTurns: 6, buildTurns: 25, ideaTimeoutMin: 6,
  ideaEffort: 'high', buildEffort: 'medium', waitSec: 240,
};
// Herramientas de cada fase: idear solo mira (capturas y archivo); construir solo edita.
export const IDEA_TOOLS = ['Read'];
export const BUILD_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];
export const PLUGGED_WARNING = 'Aviso: deja el PC enchufado y sin suspensión mientras corre (si se suspende, las variantes se cortan y hay que reintentarlas).';
export const VARIANTS = ['blind', 'context', 'integrada'];
export const CATEGORIES = ['composición', 'tipografía', 'color', 'imágenes', 'interacción', 'jerarquía', 'mobile'];
// Modo producto: la ronda cambia lo que el usuario final PUEDE hacer, decidir u obtener.
export const MODES = ['visual', 'producto'];
export const PRODUCT_CATEGORIES = [
  'capacidad nueva', 'decisión que se facilita', 'resultado o entregable nuevo', 'coordinación que se elimina',
  'momento que se protege', 'recuerdo o valor difícil de conseguir hoy', 'monetización o motivo de compra',
];
// Campos obligatorios de notes.md en modo producto (sin ellos la variante se rechaza).
export const PRODUCT_REQUIRED = ['categoria', 'antes', 'ahora', 'como_probarlo'];
// Involucramiento: auto = Claude elige siempre (sin pausas); cada:N = pausa cada N; todas = el usuario elige cada ronda.
export const INVOLVEMENT = ['auto', 'cada:N', 'todas'];
// En auto no hay pausa: el tope de seguridad son las rondas máximas de la corrida (nunca más de 10).
export const AUTO_SAFETY_CAP = 10;
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};
const SKIP = new Set(['node_modules', '.git', 'rounds', '.next', 'dist', '.cache']);
// Corridas paralelas (--out rounds-novia, rounds-novio): una nunca copia la carpeta de la otra.
const isRunsDir = name => SKIP.has(name) || /^rounds-[\w-]+$/.test(name);
const NOTES = 'notes.md';

// El prompt literal del usuario (demo del café de los 90). Va en inglés: es instrucción de sistema.
export const CORE_PROMPT = 'Look at the site first. Then innovate: think about the user experience and think outside the box. Make one bold change that improves conversions or the look and feel, not a small tweak. Use any tool you have. You must ship a change every time.';

export class BoldError extends Error {}

// ---------------------------------------------------------------------------
// Lentes (miradas) y modelo
// ---------------------------------------------------------------------------
// Una lente es un ángulo concreto (qué mira + qué pregunta responde), no un halago.
// Fuente: councils/personas/*.json (campo opcional `lente`; si falta se deriva de
// obsessions y typical_questions). Sin esa carpeta no hay lentes: se pide instalar el módulo council.

export const MODELS = ['sonnet', 'opus', 'haiku'];
export const DEFAULT_MODEL = 'sonnet';
const PERSONAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'councils', 'personas');
const LENS_BASE_ORDER = ['director-arte', 'growth', 'usuario-novato', 'ux-research', 'contrarian', 'cliente'];

export function listLenses(dir = PERSONAS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}

export function loadLens(id, dir = PERSONAS_DIR) {
  const valid = listLenses(dir);
  if (!valid.includes(id)) {
    throw new BoldError(`Lente desconocida: "${id}". ${valid.length ? `Disponibles: ${valid.join(', ')}.` : 'No hay lentes: falta la carpeta councils/personas (módulo council).'}`);
  }
  const p = readJSON(join(dir, `${id}.json`));
  const l = p.lente || {};
  return {
    id,
    etiqueta: l.etiqueta || String(p.name || id).toLowerCase(),
    mira: l.mira || (p.obsessions || []).slice(0, 3).join('; '),
    pregunta: l.pregunta || (p.typical_questions || [])[0] || '',
  };
}

export const miradaLabel = lens => `Mirada de ${lens.etiqueta}`;

export function checkModel(m) {
  const v = String(m || '').toLowerCase();
  if (!MODELS.includes(v)) throw new BoldError(`Modelo desconocido: "${m}". Usa: ${MODELS.join(' | ')}.`);
  return v;
}

/** Lista corta de lentes según el objetivo y el tipo de destino (modo auto). */
export function autoPool(run, dir = PERSONAS_DIR) {
  const goal = String(run.goal || '').toLowerCase();
  const web = !!run.web;
  const score = {
    'director-arte': (/actual|look|visual|dise|marca|estilo|moderno|identidad|se vea/.test(goal) ? 2 : 0) - (web ? 0 : 3),
    growth: /pedid|venta|convers|compr|reserv|lead|clic|contact|cliente|suscri/.test(goal) ? 2 : 0,
    'usuario-novato': /entiend|claro|confus|simple|usabil|nuevo/.test(goal) ? 2 : 0,
    'ux-research': (web && /celular|mobile|movil|móvil|navega/.test(goal) ? 1 : 0) - (web ? 0 : 3),
  };
  const have = listLenses(dir);
  return LENS_BASE_ORDER.filter(id => have.includes(id))
    .map((id, i) => ({ id, s: score[id] || 0, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 4).map(x => x.id);
}

/** Elige el par (blind, context) de la ronda n: nunca iguales y sin repetir pares de rondas previas. */
export function pickLenses(run, n, { blind, context, dir = PERSONAS_DIR } = {}) {
  const pool = Array.isArray(run.lentes) ? run.lentes : autoPool(run, dir);
  [blind, context].filter(Boolean).forEach(id => loadLens(id, dir));
  if (blind && blind === context) throw new BoldError('Las dos variantes no pueden tener la misma lente.');
  const log = (run.lens_log || []).filter(l => l.round !== Number(n));
  const key = (a, b) => [a, b].sort().join('+');
  const usedPairs = new Set(log.map(l => key(l.blind, l.context)));
  const uses = id => log.reduce((s, l) => s + (l.blind === id) + (l.context === id), 0);
  const asBlind = id => log.filter(l => l.blind === id).length;
  let best = null;
  for (const b of blind ? [blind] : pool) {
    for (const c of context ? [context] : pool) {
      if (b === c) continue;
      const sc = (usedPairs.has(key(b, c)) ? 1000 : 0) + uses(b) + uses(c) + 0.1 * asBlind(b) + 0.01 * (pool.indexOf(b) * 10 + pool.indexOf(c));
      if (!best || sc < best.sc) best = { sc, blind: b, context: c };
    }
  }
  if (!best) throw new BoldError('Se necesitan al menos 2 lentes distintas. Usa --lentes a,b o deja "auto".');
  return { blind: best.blind, context: best.context };
}

/** Modelo de una ronda: el de la ronda si se fijó en prepare, si no el de la corrida (corridas viejas: sonnet). */
export const roundModel = (run, n) => (run.lens_log || []).find(l => l.round === Number(n))?.model || run.modelo || DEFAULT_MODEL;
export const roundLens = (run, n, v) => {
  const id = (run.lens_log || []).find(l => l.round === Number(n))?.[v];
  if (!id) return null;
  try { return loadLens(id); } catch { return null; }
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export const pad = n => String(n).padStart(3, '0');
export const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'objetivo';
const isUrl = s => /^https?:\/\//i.test(String(s));
const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
const writeJSON = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const toPosix = p => p.split(sep).join('/');

/** Copia una carpeta sin node_modules/.git/rounds ni lo que diga `skip`. */
export function copyTree(src, dst, { skip = [] } = {}) {
  const skipAbs = skip.map(s => resolve(s));
  mkdirSync(dst, { recursive: true });
  const filter = p => {
    const abs = resolve(p);
    if (skipAbs.some(s => abs === s || abs.startsWith(s + sep))) return false;
    return !isRunsDir(basename(p));
  };
  // Hijo por hijo: si la carpeta de rondas vive DENTRO del objetivo (p. ej. objetivo "." y
  // --out rounds-novia), cpSync del objetivo entero se niega a copiar "en un subdirectorio de sí mismo".
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    if (!filter(from)) continue;
    cpSync(from, join(dst, name), { recursive: true, filter });
  }
}

function emptyDir(dir) {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return; }
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(toPosix(relative(base, p)));
  }
  return out.sort();
}

const hashFile = p => createHash('sha1').update(readFileSync(p)).digest('hex');

/** Archivos que difieren entre dos carpetas (ignora notes.md). */
export function changedFiles(a, b) {
  const fa = new Set(listFiles(a).filter(f => f !== NOTES));
  const fb = new Set(listFiles(b).filter(f => f !== NOTES));
  const all = [...new Set([...fa, ...fb])].sort();
  return all.filter(f => !fa.has(f) || !fb.has(f) || hashFile(join(a, f)) !== hashFile(join(b, f)));
}

export function detectEntry(dir) {
  if (existsSync(join(dir, 'index.html'))) return 'index.html';
  const files = listFiles(dir);
  return files.find(f => f.endsWith('.html')) || files.find(f => /\.(md|txt)$/.test(f)) || null;
}

// ---------------------------------------------------------------------------
// PNG mínimo (decodificar para el diff; codificar para los tests)
// ---------------------------------------------------------------------------

export function decodePNG(buf) {
  const SIG = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== SIG) throw new BoldError('No es un PNG');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new BoldError(`PNG no soportado (profundidad ${depth}, entrelazado ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new BoldError(`Tipo de color PNG no soportado: ${ctype}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch, d = i * 4;
    if (ctype === 6) px.copy(rgba, d, s, s + 4);
    else if (ctype === 2) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = 255; }
    else if (ctype === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; }
    else if (ctype === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else { const k = px[s]; rgba[d] = palette[k * 3]; rgba[d + 1] = palette[k * 3 + 1]; rgba[d + 2] = palette[k * 3 + 2]; rgba[d + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { width, height, data: rgba };
}

// CRC32 propio (zlib.crc32 solo existe desde Node 22).
function zlibCrc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function encodePNG(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlibCrc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Proporción de píxeles distintos (0..1). Si las imágenes tienen distinto tamaño,
 * lo que no se superpone cuenta como cambio. `tolerance` = diferencia por canal ignorada.
 */
export function pixelDiff(a, b, { tolerance = 16 } = {}) {
  const A = Buffer.isBuffer(a) ? decodePNG(a) : a;
  const B = Buffer.isBuffer(b) ? decodePNG(b) : b;
  const W = Math.max(A.width, B.width), H = Math.max(A.height, B.height);
  const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
  let diff = W * H - w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * A.width + x) * 4, j = (y * B.width + x) * 4;
      if (Math.abs(A.data[i] - B.data[j]) > tolerance || Math.abs(A.data[i + 1] - B.data[j + 1]) > tolerance
        || Math.abs(A.data[i + 2] - B.data[j + 2]) > tolerance) diff++;
    }
  }
  return { ratio: W * H ? diff / (W * H) : 0, width: W, height: H, changed_pixels: diff };
}

// ---------------------------------------------------------------------------
// Hotspots: de la diferencia de píxeles a zonas numeradas sobre el "después"
// ---------------------------------------------------------------------------

// Celdas marcadas → grupos, uniendo celdas a menos de gx/gy celdas de distancia.
function groupCells(mask, gw, gh, gx, gy, within = null) {
  const seen = new Uint8Array(gw * gh);
  const out = [];
  const x0 = within ? within.x0 : 0, x1 = within ? within.x1 : gw - 1;
  const y0 = within ? within.y0 : 0, y1 = within ? within.y1 : gh - 1;
  for (let sy = y0; sy <= y1; sy++) {
    for (let sx = x0; sx <= x1; sx++) {
      const start = sy * gw + sx;
      if (!mask[start] || seen[start]) continue;
      const box = { x0: sx, x1: sx, y0: sy, y1: sy, cells: 0 };
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % gw, cy = (cur - cx) / gw;
        box.cells++;
        if (cx < box.x0) box.x0 = cx;
        if (cx > box.x1) box.x1 = cx;
        if (cy < box.y0) box.y0 = cy;
        if (cy > box.y1) box.y1 = cy;
        for (let ny = Math.max(y0, cy - gy); ny <= Math.min(y1, cy + gy); ny++) {
          for (let nx = Math.max(x0, cx - gx); nx <= Math.min(x1, cx + gx); nx++) {
            const k = ny * gw + nx;
            if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
          }
        }
      }
      out.push(box);
    }
  }
  return out;
}

// Huella de cada fila de píxeles (FNV-1a). Sirve para ver contenido que solo se movió.
function rowHashes({ width, height, data }) {
  const out = new Uint32Array(height);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    let h = 2166136261;
    const end = (y + 1) * stride;
    for (let i = y * stride; i < end; i++) h = Math.imul(h ^ data[i], 16777619);
    out[y] = h >>> 0;
  }
  return out;
}

// Mapa de cambios en celdas. Una fila idéntica a alguna del "antes" no cuenta: si se
// agrega un bloque arriba, lo de abajo solo se corrió y marcarlo sería mentir.
function changeMap(A, B, { tolerance = 16, cell = 12, minCellRatio = 0.12 } = {}) {
  const W = B.width, H = B.height;
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const changedCount = new Uint32Array(gw * gh);
  const totalCount = new Uint32Array(gw * gh);
  const lumMin = new Uint8Array(gw * gh).fill(255);
  const lumMax = new Uint8Array(gw * gh);
  const known = A.width === W ? new Set(rowHashes(A)) : new Set();
  const hashes = known.size ? rowHashes(B) : null;
  let changedPixels = 0;
  for (let y = 0; y < H; y++) {
    const gy = Math.floor(y / cell);
    const moved = hashes && known.has(hashes[y]);
    for (let x = 0; x < W; x++) {
      const k = gy * gw + Math.floor(x / cell);
      const j = (y * W + x) * 4;
      totalCount[k]++;
      const lum = (B.data[j] * 3 + B.data[j + 1] * 6 + B.data[j + 2]) / 10;
      if (lum < lumMin[k]) lumMin[k] = lum;
      if (lum > lumMax[k]) lumMax[k] = lum;
      if (moved) continue;
      const inA = x < A.width && y < A.height;
      const i = (y * A.width + x) * 4;
      if (!inA || Math.abs(A.data[i] - B.data[j]) > tolerance || Math.abs(A.data[i + 1] - B.data[j + 1]) > tolerance
        || Math.abs(A.data[i + 2] - B.data[j + 2]) > tolerance) { changedCount[k]++; changedPixels++; }
    }
  }
  const changed = new Uint8Array(gw * gh);
  const content = new Uint8Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) {
    if (totalCount[k] && changedCount[k] / totalCount[k] >= minCellRatio) {
      changed[k] = 1;
      if (lumMax[k] - lumMin[k] > 40) content[k] = 1;
    }
  }
  return { gw, gh, cell, W, H, changed, content, ratio: W * H ? changedPixels / (W * H) : 0 };
}

/** Proporción del "después" que de verdad es nueva (lo que solo se movió no cuenta). */
export function realChangeRatio(a, b, opts) {
  const A = Buffer.isBuffer(a) ? decodePNG(a) : a;
  const B = Buffer.isBuffer(b) ? decodePNG(b) : b;
  return changeMap(A, B, opts).ratio;
}

/**
 * Zonas que cambiaron, en coordenadas 0..1 de la imagen "después" y en orden de lectura.
 * En un rediseño total todo cambia y saldría una sola caja gigante: esa caja se vuelve
 * a dividir usando solo las celdas con contenido (texto, bordes, imágenes) del "después".
 */
export function changedRegions(a, b, { gap = 2, maxRegions = 5, minArea = 0.0015, giantArea = 0.35, ...mapOpts } = {}) {
  const A = Buffer.isBuffer(a) ? decodePNG(a) : a;
  const B = Buffer.isBuffer(b) ? decodePNG(b) : b;
  const { gw, gh, cell, W, H, changed, content } = changeMap(A, B, mapOpts);
  const pageCells = gw * gh;
  const boxCells = c => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
  let groups = [];
  for (const g of groupCells(changed, gw, gh, gap, gap)) {
    if (boxCells(g) / pageCells < giantArea) { groups.push(g); continue; }
    const parts = groupCells(content, gw, gh, 4, 3, g).filter(p => boxCells(p) / pageCells >= minArea);
    if (parts.length >= 2) groups.push(...parts);
    else groups.push(g);
  }
  // Una línea separadora de 1 celda de alto no es una "zona que cambió".
  const boxes = groups
    .filter(g => boxCells(g) / pageCells >= minArea && g.x1 > g.x0 && g.y1 > g.y0)
    .sort((p, q) => boxCells(q) - boxCells(p))
    .slice(0, maxRegions)
    .sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  const num = n => Number(n.toFixed(4));
  return boxes.map(g => {
    const px0 = g.x0 * cell, py0 = g.y0 * cell;
    const px1 = Math.min(W, (g.x1 + 1) * cell), py1 = Math.min(H, (g.y1 + 1) * cell);
    return { x: num(px0 / W), y: num(py0 / H), w: num((px1 - px0) / W), h: num((py1 - py0) / H) };
  });
}

const TRAILING_WORD = /^(en|de|del|y|o|con|la|el|los|las|un|una|para|por|tu|tus|a|al|que)$/i;

// Hasta n palabras, sin dejar colgando un "de" o un "y" al final.
function firstWords(text, n = 5) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').slice(0, n);
  while (words.length > 1 && TRAILING_WORD.test(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[.,;:¿?¡!«»"—–-]+$/u, '');
}

// Un nombre útil tiene palabras: un precio o un teléfono no dice qué cambió.
const hasWords = s => /\p{L}{3}/u.test(s);

/**
 * Nombre de 2-5 palabras para una zona: el texto más grande que quedó dentro (según los
 * bloques que `takeShots` guarda), "Imagen nueva" si solo hay imagen, o su posición.
 */
export function labelRegion(region, blocks, width, height, used = new Set()) {
  const px = { x0: region.x * width, x1: (region.x + region.w) * width, y0: region.y * height, y1: (region.y + region.h) * height };
  const inside = (Array.isArray(blocks) ? blocks : []).filter(b => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return cx >= px.x0 && cx <= px.x1 && cy >= px.y0 && cy <= px.y1;
  });
  const texts = inside.filter(b => b.text && hasWords(firstWords(b.text))).sort((p, q) => (q.fs || 0) - (p.fs || 0));
  for (const b of texts) {
    const label = firstWords(b.text);
    if (!used.has(label)) { used.add(label); return label; }
  }
  if (inside.some(b => b.tag === 'img')) return 'Imagen nueva';
  const mid = region.y + region.h / 2;
  return mid < 0.34 ? 'Zona superior' : mid < 0.67 ? 'Zona media' : 'Zona inferior';
}

// ---------------------------------------------------------------------------
// Screenshots (Playwright opcional)
// ---------------------------------------------------------------------------

export const INSTALL_HINT = [
  'Falta Playwright para sacar screenshots. Instálalo una vez (en la terminal del proyecto):',
  '  npm install --no-save playwright-core',
  '  (esto instala Playwright sin navegador propio; usa el Chrome o Edge que ya tienes)',
  'Si no tienes Chrome ni Edge:',
  '  npm install --no-save playwright  y luego  npx playwright install chromium',
  '  (esto descarga un Chromium solo para Playwright, ~150 MB)',
].join('\n');

export async function defaultLauncher() {
  for (const mod of ['playwright', 'playwright-core']) {
    let pw;
    try { pw = await import(mod); } catch { continue; }
    const chromium = pw.chromium || (pw.default && pw.default.chromium);
    for (const opts of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
      try { return await chromium.launch({ headless: true, ...opts }); } catch { /* siguiente opción */ }
    }
  }
  return null;
}

/** Convierte un .md/.txt en una página simple para poder fotografiarlo. */
function textPageURL(file, outDir) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:40px;font:16px/1.6 Georgia,serif;max-width:760px;white-space:pre-wrap">${esc(readFileSync(file, 'utf8'))}</body>`;
  const tmp = join(outDir, `_render-${basename(file)}.html`);
  writeFileSync(tmp, html, 'utf8');
  return { url: pathToFileURL(tmp).href, tmp };
}

// Corre dentro de la página: qué texto o imagen hay y dónde, para nombrar los hotspots.
function collectBlocks() {
  const out = [];
  for (const node of document.querySelectorAll('h1,h2,h3,h4,button,a,[role=button],img,p,li,td,strong,span')) {
    const r = node.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || out.length >= 400) continue;
    const tag = node.tagName.toLowerCase();
    const text = tag === 'img' ? '' : (node.innerText || '').trim().slice(0, 80);
    if (tag !== 'img' && !text) continue;
    out.push({
      tag, text,
      x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height),
      fs: Math.round(parseFloat(getComputedStyle(node).fontSize) || 0),
    });
  }
  return out;
}

/**
 * Saca <prefix>-desktop.png y <prefix>-mobile.png, más <prefix>-<vista>.blocks.json con
 * los textos de la página. `target` = carpeta, archivo o URL.
 * Devuelve { ok, files } u { ok:false, reason } si no hay Playwright.
 */
export async function takeShots(target, prefix, { launcher = defaultLauncher, entry } = {}) {
  let url, tmp = null;
  mkdirSync(dirname(resolve(prefix)), { recursive: true });
  if (isUrl(target)) url = target;
  else {
    let file = resolve(target);
    if (statSync(file).isDirectory()) {
      const e = entry || detectEntry(file);
      if (!e) return { ok: false, reason: 'sin archivo html/md que mostrar' };
      file = join(file, e);
    }
    if (/\.(md|txt)$/i.test(file)) ({ url, tmp } = textPageURL(file, dirname(resolve(prefix))));
    else url = pathToFileURL(file).href;
  }
  const browser = await launcher();
  if (!browser) return { ok: false, reason: 'playwright', hint: INSTALL_HINT };
  const files = {};
  try {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(300);
      const out = `${resolve(prefix)}-${name}.png`;
      await page.screenshot({ path: out, fullPage: true, animations: 'disabled' });
      files[name] = out;
      if (typeof page.evaluate === 'function') {
        try { writeFileSync(`${resolve(prefix)}-${name}.blocks.json`, JSON.stringify(await page.evaluate(collectBlocks)), 'utf8'); }
        catch { /* sin bloques, los hotspots se nombran por posición */ }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (tmp) rmSync(tmp, { force: true });
  }
  return { ok: true, files };
}

// ---------------------------------------------------------------------------
// Estado de la corrida (run.json)
// ---------------------------------------------------------------------------

export function runPaths(out) {
  const dir = resolve(out);
  return { dir, run: join(dir, 'run.json'), working: join(dir, 'working'), design: join(dir, 'DESIGN.md') };
}

export function roundPaths(out, n) {
  const dir = join(resolve(out), pad(n));
  return {
    dir, shots: join(dir, 'shots'), check: join(dir, 'check.json'),
    variant: v => join(dir, v), prompt: v => join(dir, `prompt-${v}.md`),
    // Método B: prompt de idear, idea escrita, métricas por variante y estado de `run`.
    ideaPrompt: v => join(dir, `idea-prompt-${v}.md`), idea: v => join(dir, `idea-${v}.md`),
    runInfo: v => join(dir, `run-${v}.json`), status: join(dir, 'run-status.json'),
  };
}

export function loadRun(out) {
  const p = runPaths(out);
  if (!existsSync(p.run)) throw new BoldError(`No hay corrida en ${p.dir}. Empieza con: node scripts/bold_rounds.js init <objetivo>`);
  return readJSON(p.run);
}
const saveRun = (out, run) => writeJSON(runPaths(out).run, run);

const DESIGN_TEMPLATE = (goal, mode = 'visual') => `# DESIGN.md — dirección corta (máx. 15 líneas)

Objetivo: ${goal}
${mode === 'producto' ? '\nModo producto: cada ronda cambia lo que el usuario final puede hacer, decidir u obtener (no estética).\n' : ''}
## Dirección
- (se completa tras la ronda 1 con lo que el usuario eligió)

## Restricciones anti-slop
- Nada de degradados por defecto, todo en "píldoras" ni grillas de tarjetas iguales (card soup).
- Paleta limitada: 3-4 colores + neutros. Copy real, sin lorem ipsum.
- Cada cambio nombra 1-2 referencias concretas (estudio, diseñador, publicación o movimiento).

## Aprendido de las rondas
- (vacío)

${DESIGN_LOG_HEADER}
`;

// Sección que escribe el helper (comentarios del usuario y elecciones de Claude). Solo la lee la variante CONTEXTO.
const DESIGN_LOG_HEADER = '## Comentarios y decisiones por ronda';
const DESIGN_LOG_MAX = 8;

/** Agrega (o reemplaza) la línea de una ronda en la sección de comentarios de DESIGN.md. */
export function logToDesign(out, round, line) {
  const p = runPaths(out).design;
  let md = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (!md.includes(DESIGN_LOG_HEADER)) md = `${md.trimEnd()}\n\n${DESIGN_LOG_HEADER}\n`;
  const [head, tail = ''] = md.split(DESIGN_LOG_HEADER);
  const tag = `- Ronda ${round}:`;
  const entries = tail.split('\n').filter(l => l.startsWith('- Ronda ') && !l.startsWith(tag));
  entries.push(`${tag} ${line}`);
  entries.sort((a, b) => parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10));
  writeFileSync(p, `${head}${DESIGN_LOG_HEADER}\n${entries.slice(-DESIGN_LOG_MAX).join('\n')}\n`, 'utf8');
}

/** `--modo visual|producto` (por defecto visual, para no cambiar corridas viejas). */
export function parseMode(v) {
  if (v === undefined || v === null || v === true || v === '') return 'visual';
  const s = String(v).trim().toLowerCase();
  if (!MODES.includes(s)) throw new BoldError(`--modo inválido: "${v}". Usa visual | producto`);
  return s;
}

/**
 * `--involucramiento auto|cada:N|todas` → { involucramiento, pause_every }.
 * Sin flag se mantiene el comportamiento viejo: cada:<pause-every>.
 */
export function parseInvolvement(v, { pauseEvery = DEFAULTS.pauseEvery } = {}) {
  const every = Math.max(1, parseInt(pauseEvery, 10) || DEFAULTS.pauseEvery);
  if (v === undefined || v === null || v === true || v === '') return { involucramiento: `cada:${every}`, pause_every: every };
  const s = String(v).trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'auto') return { involucramiento: 'auto', pause_every: AUTO_SAFETY_CAP };
  if (s === 'todas') return { involucramiento: 'todas', pause_every: 1 };
  const m = /^cada[:=]?(\d+)$/.exec(s);
  if (m && Number(m[1]) >= 1) {
    const n = Math.min(Number(m[1]), DEFAULTS.maxRounds);
    return { involucramiento: `cada:${n}`, pause_every: n };
  }
  throw new BoldError(`--involucramiento inválido: "${v}". Usa auto | cada:N (ej. cada:3) | todas`);
}

/** Tipo de involucramiento de una corrida (las viejas sin el campo = cada:pause_every). */
export const involvementOf = run => String(run.involucramiento || `cada:${run.pause_every}`).split(':')[0];

/**
 * Cuántas rondas seguidas puede elegir Claude solo antes de pausar.
 * auto → tope de seguridad (10, igual al máximo de rondas: nunca bloquea dentro de la corrida);
 * cada:N → N; todas → 0 (Claude nunca elige).
 */
export function autoLimit(run) {
  const kind = involvementOf(run);
  if (kind === 'auto') return AUTO_SAFETY_CAP;
  if (kind === 'todas') return 0;
  return run.pause_every;
}

/** Crea la copia de trabajo. Nunca escribe en el objetivo original. */
export async function init(target, {
  out = 'rounds', rounds = DEFAULTS.rounds, pauseEvery = DEFAULTS.pauseEvery, goal,
  modo, involucramiento, hallazgos = [], lentes = 'auto', modelo, modeloIdea, modeloConstruir, paralelo = false,
} = {}) {
  const p = runPaths(out);
  // Idear y construir usan modelos distintos (lo elige el usuario; recomendado Opus + Sonnet).
  // `modelo` solo fija ambos a la vez (corridas y método A de antes).
  const modeloBuild = checkModel(modeloConstruir || modelo || DEFAULTS.buildModel);
  const modeloIdeaOk = checkModel(modeloIdea || modelo || DEFAULTS.ideaModel);
  modelo = modeloBuild;
  let lentesList = 'auto';
  if (lentes && lentes !== 'auto') {
    lentesList = String(lentes).split(',').map(s => s.trim()).filter(Boolean);
    lentesList.forEach(id => loadLens(id));
    if (new Set(lentesList).size < 2) throw new BoldError('--lentes necesita al menos 2 lentes distintas (o "auto").');
  }
  if (existsSync(p.run)) throw new BoldError(`Ya hay una corrida en ${p.dir}. Usa otro --out o borra esa carpeta.`);
  const maxRounds = Math.min(Math.max(1, parseInt(rounds, 10) || DEFAULTS.rounds), DEFAULTS.maxRounds);
  const mode = parseMode(modo);
  const inv = parseInvolvement(involucramiento, { pauseEvery });
  const findings = (Array.isArray(hallazgos) ? hallazgos : String(hallazgos || '').split(','))
    .map(s => String(s).trim()).filter(Boolean).map(f => resolve(f));
  for (const f of findings) if (!existsSync(f)) throw new BoldError(`No existe el archivo de hallazgos ${f}`);
  emptyDir(p.working);
  let kind, entry, note = '';
  if (isUrl(target)) {
    kind = 'url';
    const res = await fetch(target);
    if (!res.ok) throw new BoldError(`No se pudo bajar ${target}: HTTP ${res.status}`);
    let html = await res.text();
    const base = `<base href="${target}">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}${base}`) : base + html;
    writeFileSync(join(p.working, 'index.html'), html, 'utf8');
    entry = 'index.html';
    note = 'Copia de URL (best effort): solo el HTML; CSS e imágenes se siguen cargando desde el sitio original vía <base>.';
  } else {
    const src = resolve(target);
    if (!existsSync(src)) throw new BoldError(`No existe ${src}`);
    if (statSync(src).isDirectory()) {
      kind = 'folder';
      copyTree(src, p.working, { skip: [p.dir] });
      entry = detectEntry(p.working);
    } else {
      kind = 'file';
      cpSync(src, join(p.working, basename(src)));
      entry = basename(src);
    }
  }
  const run = {
    target: isUrl(target) ? target : resolve(target), kind, entry,
    web: !!entry && /\.html?$/i.test(entry),
    goal: goal || `Mejorar ${isUrl(target) ? target : basename(resolve(target))}`,
    slug: slugify(isUrl(target) ? target : basename(resolve(target))),
    // Distingue corridas paralelas sobre el mismo objetivo en el cockpit (ids de revisión distintos).
    tag: basename(p.dir) === 'rounds' ? '' : slugify(basename(p.dir)).replace(/^rounds-/, ''),
    created_at: new Date().toISOString(),
    modo: mode,
    involucramiento: inv.involucramiento,
    max_rounds: maxRounds, pause_every: inv.pause_every,
    hallazgos: findings,
    threshold: DEFAULTS.threshold, history: [], note,
    lentes: lentesList, modelo, modelo_idea: modeloIdeaOk, modelo_construir: modeloBuild, lens_log: [],
    // En serie por defecto: una variante a la vez (gasta igual, pero no dispara picos ni cortes).
    paralelo: !!paralelo,
  };
  run.presupuesto = estimateRun(run, { working: p.working });
  saveRun(out, run);
  if (!existsSync(p.design)) writeFileSync(p.design, DESIGN_TEMPLATE(run.goal, mode), 'utf8');
  return run;
}

/** Presupuesto estimado de una corrida (tokens y % de la ventana de 5 h). */
export function estimateRun(run, { rondas, working } = {}) {
  let entryChars = 8000;
  try { if (run.entry && working) entryChars = statSync(join(working, run.entry)).size; } catch { /* sin archivo */ }
  const p = presupuestoRondas({
    rondas: rondas || run.max_rounds, modeloIdea: run.modelo_idea || DEFAULTS.ideaModel,
    modeloConstruir: run.modelo_construir || run.modelo || DEFAULTS.buildModel, entryChars,
  });
  return {
    tokens: p.tokens, pct_ventana: p.pct_ventana, carga_usd: p.carga_usd,
    por_variante: p.por_variante, weddi_por_variante: p.weddi_por_variante, texto: textoPresupuesto(p),
  };
}

/** Presupuesto antes de `init` (no crea nada): lo que el usuario confirma con --yes. */
export function previewEstimate(target, { rounds = DEFAULTS.rounds, modeloIdea, modeloConstruir, modelo } = {}) {
  let entry = null, working = null;
  if (!isUrl(target)) {
    const src = resolve(target);
    if (existsSync(src)) {
      if (statSync(src).isDirectory()) { working = src; entry = detectEntry(src); } else { working = dirname(src); entry = basename(src); }
    }
  }
  const max = Math.min(Math.max(1, parseInt(rounds, 10) || DEFAULTS.rounds), DEFAULTS.maxRounds);
  return estimateRun({
    entry, max_rounds: max,
    modelo_idea: checkModel(modeloIdea || modelo || DEFAULTS.ideaModel), modelo_construir: checkModel(modeloConstruir || modelo || DEFAULTS.buildModel),
  }, { working });
}

/** Cuántas rondas seguidas se aplicaron sin un humano (--auto). */
export function autoStreak(run) {
  let n = 0;
  for (let i = run.history.length - 1; i >= 0 && run.history[i].auto; i--) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Prompts de las variantes
// ---------------------------------------------------------------------------

function clipText(s, n) { s = String(s || '').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; }

/** Historia para la variante CONTEXT: rondas previas, lo elegido y el feedback del usuario. */
export function buildHistory(out, run, n, root) {
  const lines = [];
  for (let r = 1; r < n; r++) {
    const rp = roundPaths(out, r);
    const chosen = run.history.find(h => h.round === r);
    lines.push(`### Round ${r} — chosen: ${chosen ? chosen.variant : 'none yet'}`);
    for (const v of VARIANTS) {
      const notes = join(rp.variant(v), NOTES);
      if (existsSync(notes)) lines.push(`- ${v} notes: ${clipText(readFileSync(notes, 'utf8').replace(/\s+/g, ' '), 600)}`);
    }
    const fb = getFeedback(reviewId(run, r), root);
    if (fb) {
      for (const [id, v] of Object.entries(fb.items || {})) {
        if (v.vote || (v.comment || '').trim()) lines.push(`- user on ${id}: vote=${v.vote || '-'} ${v.comment ? `"${clipText(v.comment, 300)}"` : ''}`);
      }
      if (fb.summary) for (const d of [...fb.summary.decisions, ...fb.summary.requests]) lines.push(`- user said: ${clipText(d, 200)}`);
    }
  }
  return lines.join('\n') || '(no previous rounds)';
}

/** Comentarios del usuario y razones de Claude de rondas previas (solo los ve la variante CONTEXTO). */
export function commentsFor(run, n) {
  return run.history
    .filter(h => h.round < n && ((h.comment || '').trim() || (h.reason || '').trim()))
    .sort((a, b) => b.round - a.round)
    .map(h => {
      const who = h.auto ? `Claude picked ${h.variant} alone` : `user picked ${h.variant}`;
      const parts = [`- Round ${h.round} (${who})`];
      if ((h.comment || '').trim()) parts.push(`user comment: "${clipText(h.comment, 500)}"`);
      if ((h.reason || '').trim()) parts.push(`Claude's reason: ${clipText(h.reason, 300)}`);
      return parts.join(' · ');
    }).join('\n');
}

function findingsFor(run) {
  return (run.hallazgos || []).filter(f => existsSync(f))
    .map(f => `### ${basename(f)}\n${clipText(readFileSync(f, 'utf8'), 3000)}`).join('\n\n');
}

function notesSpec(run, n, variant, lens = null) {
  const mirada = [
    ...(lens ? [`   Mirada: ${lens.etiqueta}`] : []),
    '   Gana: <what the END USER gains, in at most 15 words; it is shown under the headline of the summary>',
  ];
  if (run.modo === 'producto') {
    return [
      `   # Ronda ${n} — variante ${variant}`,
      '   Titular: <the innovation in at most 8 words, the end-user benefit first>',
      `   Categoría: <one of: ${PRODUCT_CATEGORIES.join(' | ')}>`,
      ...mirada,
      '   Situación: <who, in which moment, and what fails for them today; one line>',
      '   Antes: <what the end user could NOT do before this round>',
      '   Ahora: <what the end user CAN do now>',
      '   Cómo probarlo: <2-4 short steps inside the copy, e.g. "1) abre index.html 2) toca X 3) mira Y">',
      '   Señal de validación: <metric + threshold that would prove it with real users, e.g. "40% de invitados sube 3+ fotos en la fiesta">',
      '   Depende de prueba real: <what only real users or real data can confirm>',
      '   Riesgo: <one line>',
    ];
  }
  return [
    `   # Ronda ${n} — variante ${variant}`,
    '   Titular: <the change in at most 8 words; it is the big headline of the slide>',
    `   Categoría: <one of: ${CATEGORIES.join(' | ')}>`,
    ...mirada,
    '   Cambio 1: <2 to 5 words naming one visible change>',
    '   Cambio 2: <one line per change, top of the page to the bottom, at most 5; omit extras>',
    '   Por qué: <one line>',
    '   Referencias: <1-2 named references>',
    '   Riesgo: <one line>',
  ];
}

function rulesFor(run, beforeShots) {
  const look = `1. Look first: read the entry file completely${beforeShots.length ? ` and view these screenshots of the current state: ${beforeShots.join(', ')}` : ''}.`;
  const common = [
    '5. Self-contained: no external network assets and no paid APIs. Inline CSS/SVG/JS or local files only.',
    '6. Never write outside the working folder. No git commands.',
    '7. All user-facing text (page copy and notes.md) in neutral Spanish with "tú". Never voseo ("vos", "tenés", "podés", "decime").',
  ];
  if (run.modo === 'producto') {
    return [
      'Product mode: this loop innovates the PRODUCT, not its styling. Read "look and feel" in the core instruction as "how it feels to use it", never as visual polish.',
      '',
      'Rules:',
      look,
      `2. Make ONE bold product innovation that changes a capability, a decision or an outcome for the END USER of this product. Pick exactly one category: ${PRODUCT_CATEGORIES.join(', ')}. Start from a concrete moment of a concrete user and what fails for them today.`,
      '3. Forbidden as the change of the round: anything that only touches typography, color, layout, spacing, images or copy. Visual work is allowed only as the vehicle of the new capability. A round with only aesthetic changes is rejected automatically.',
      '4. It must be testable in the copy: leave a working interaction (a button that does something, a flow, a simulated result with sample data clearly labeled "ejemplo"), not a mockup with "próximamente". Keep facts truthful: never invent prices, statistics, testimonials or claims about the real business.',
      ...common,
      `8. When done, write ${NOTES} in the working folder, in Spanish, with these one-line fields (Categoría, Antes, Ahora and Cómo probarlo are required; without them the variant is rejected):`,
    ];
  }
  return [
    'Rules:',
    look,
    `2. Make ONE bold change inside exactly one category: ${CATEGORIES.join(', ')}. It must be visible to a user at first glance (desktop or mobile). Refactors, cleanup or small tweaks do not count: a pixel diff rejects rounds without a visible change.`,
    '3. Anti-slop: no default purple/blue gradients, no pill-shaped everything, no "card soup" (grids of identical rounded cards), a limited palette (3-4 colors plus neutrals), real copy (no lorem ipsum). Name 1-2 concrete references (designer, studio, publication or movement) that inspired the change.',
    '4. Keep facts truthful: do not invent prices, addresses, phone numbers or claims that are not in the original. You may rewrite, reorder and cut copy.',
    ...common,
    `8. When done, write ${NOTES} in the working folder, in Spanish. The user reads pictures, not reports, so keep it to these one-line fields:`,
  ];
}

export function buildPrompt(variant, { run, out, n, root, beforeShots = [], lens = null }) {
  const dir = roundPaths(out, n).variant(variant);
  const parts = [
    `You are the ${variant.toUpperCase()} variant of round ${n} of a "bold rounds" improvement loop.`,
    `Objective: ${run.goal}`,
    `Working folder (the ONLY place you may write): ${dir}`,
    `Entry file: ${run.entry || '(find the main file)'}`,
    '',
    'Core instruction from the user (follow it literally; if the target is not a website, read "site" as the document or project):',
    `"${CORE_PROMPT}"`,
    ...(lens ? [
      '',
      'Lens for this round (an angle to look from, not a role to play). It decides WHICH problem you attack; the instruction above and the rules below stay unchanged:',
      `- Lens: ${lens.etiqueta}`,
      `- You look at: ${lens.mira}`,
      `- Question your change must answer: ${lens.pregunta}`,
    ] : []),
    '',
    ...rulesFor(run, beforeShots),
    ...notesSpec(run, n, variant, lens),
    '9. Reply with one line: the category and a one-sentence summary.',
  ];
  if (variant === 'blind') {
    parts.push('', 'You have NO history on purpose: judge only what you see now. Do not read other folders of this loop.');
  } else {
    const design = existsSync(runPaths(out).design) ? readFileSync(runPaths(out).design, 'utf8') : '';
    const comments = commentsFor(run, n);
    const findings = findingsFor(run);
    parts.push('',
      'You are the CONTEXT variant: build on what was learned. Respect the user feedback below; it outranks your taste.',
      `Avoid repeating a ${run.modo === 'producto' ? 'product ' : ''}category used in the last 2 rounds unless the user asked for it.`);
    if (comments) parts.push('', '## User comments from previous rounds (apply the latest one first)', comments);
    if (findings) parts.push('', '## Findings to build on (audience interview / council; use them as evidence, do not copy them literally)', clipText(findings, 6000));
    parts.push('',
      '## DESIGN.md', clipText(design, 2000), '',
      '## Previous rounds and user feedback', clipText(buildHistory(out, run, n, root), 4000));
  }
  return parts.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Método B: IDEAR (sin editar) y CONSTRUIR (sin mirar capturas), sesiones separadas
// ---------------------------------------------------------------------------

/** System prompt corto de la sesión de ideación (reemplaza al de Claude Code: ~1 K tokens en vez de ~25 K). */
export const IDEA_SYSTEM = [
  'You are a bold product and design innovator. You think outside the box and propose ONE concrete change that a builder can implement in a single short session.',
  'You only look (Read tool for screenshots and files). You never edit files. Your final reply IS the idea spec, in neutral Spanish with "tú" (never voseo).',
].join('\n');

const IDEA_EXCERPT_CHARS = 12000;

/** Campos que la ideación debe devolver (después van a notes.md y al prompt de construir). */
function ideaSpec(run, n, variant, lens) {
  return [
    `# Ronda ${n} — variante ${variant}`,
    ...notesSpec(run, n, variant, lens).map(l => l.trim()).slice(1),
    'Construir: <3-6 bullets, each one concrete edit in the entry file (what element, what behavior or style). The builder only sees this spec and the files.>',
    'No tocar: <what must stay as it is, one line>',
  ];
}

/** Prompt de IDEAR: instrucción literal del usuario + lente + reglas, sin editar y con contexto mínimo. */
export function buildIdeaPrompt(variant, { run, out, n, root, beforeShots = [], lens = null }) {
  const dir = roundPaths(out, n).variant(variant);
  let excerpt = '';
  try { if (run.entry) excerpt = readFileSync(join(dir, run.entry), 'utf8'); } catch { /* sin entrada legible */ }
  const product = run.modo === 'producto';
  const parts = [
    `IDEATION step of the ${variant.toUpperCase()} variant, round ${n}, of a "bold rounds" loop. Another session will build your idea; you only decide WHAT to change.`,
    `Objective: ${run.goal}`,
    `Entry file: ${run.entry ? join(dir, run.entry) : '(none)'}`,
    '',
    'Core instruction from the user (follow it literally; if the target is not a website, read "site" as the document or project):',
    `"${CORE_PROMPT}"`,
    ...(lens ? ['', 'Lens for this round (an angle to look from, not a role to play):', `- Lens: ${lens.etiqueta}`, `- You look at: ${lens.mira}`, `- Question your change must answer: ${lens.pregunta}`] : []),
    '',
    'How to look (keep it short, at most 3 tool calls):',
    beforeShots.length ? `- View these screenshots of the current state with the Read tool: ${beforeShots.join(', ')}` : '- There are no screenshots: judge from the file.',
    `- The entry file is below${excerpt.length > IDEA_EXCERPT_CHARS ? ` (first ${IDEA_EXCERPT_CHARS} characters; Read the file only if you need the rest)` : ''}.`,
    '',
    product
      ? `Rules: ONE bold product innovation for the END USER (pick one category: ${PRODUCT_CATEGORIES.join(', ')}). Only-aesthetic changes are forbidden. It must be testable in the copy with sample data labeled "ejemplo". Never invent prices, statistics, testimonials or claims about the real business. Self-contained (no network, no paid APIs).`
      : `Rules: ONE bold change in exactly one category (${CATEGORIES.join(', ')}), visible at first glance. Anti-slop: no default purple/blue gradients, no pill-shaped everything, no card soup, 3-4 colors plus neutrals, real copy. Name 1-2 concrete references. Never invent prices, addresses or claims. Self-contained (no network, no paid APIs).`,
    'Be bold, but buildable in about 15 edits of one session.',
    '',
    'Reply with ONLY these lines (one line each, in Spanish), nothing before or after:',
    ...ideaSpec(run, n, variant, lens),
  ];
  if (variant === 'blind') parts.push('', 'You have NO history on purpose: judge only what you see now.');
  else {
    const design = existsSync(runPaths(out).design) ? readFileSync(runPaths(out).design, 'utf8') : '';
    const comments = commentsFor(run, n);
    const findings = findingsFor(run);
    parts.push('', 'You are the CONTEXT variant: build on what was learned. The user feedback below outranks your taste.',
      `Avoid repeating a ${product ? 'product ' : ''}category used in the last 2 rounds unless the user asked for it.`);
    if (comments) parts.push('', '## User comments from previous rounds (apply the latest one first)', comments);
    if (findings) parts.push('', '## Findings to build on (use them as evidence, do not copy them literally)', clipText(findings, 6000));
    parts.push('', '## DESIGN.md', clipText(design, 2000), '', '## Previous rounds and user feedback', clipText(buildHistory(out, run, n, root), 4000));
  }
  if (excerpt) parts.push('', `## ${run.entry}`, '```', excerpt.slice(0, IDEA_EXCERPT_CHARS), '```');
  return parts.join('\n') + '\n';
}

/** Prompt de CONSTRUIR: implementar la idea tal cual, con tope de turnos y sin auto-verificación. */
export function buildBuildPrompt(variant, idea, { run, out, n, maxTurns = DEFAULTS.buildTurns }) {
  const dir = roundPaths(out, n).variant(variant);
  const product = run.modo === 'producto';
  return [
    `BUILD step of the ${variant.toUpperCase()} variant, round ${n}. Implement the idea spec below in the working folder. Do not redesign it and do not add a second idea.`,
    `Working folder (the ONLY place you may write): ${dir}`,
    `Entry file: ${run.entry || '(find the main file)'}`,
    '',
    '## Idea spec (decided already)',
    String(idea || '').trim(),
    '',
    'Rules:',
    `1. You have at most ${maxTurns} turns. Read the entry file once, then edit. Prefer a few large Edit/Write calls over many small ones. Do not re-read files you just wrote.`,
    '2. Do NOT take or view screenshots and do not verify visually: a helper takes before/after screenshots and checks the result after you finish.',
    '3. Keep JavaScript valid (balanced braces, no unfinished code): a syntax check rejects the variant otherwise.',
    product
      ? '4. Leave a working interaction (a button that does something, a flow, a simulated result with sample data labeled "ejemplo"), never "próximamente". Never invent prices, statistics, testimonials or claims about the real business.'
      : '4. Keep facts truthful: do not invent prices, addresses, phone numbers or claims that are not in the original.',
    '5. Self-contained: no external network assets and no paid APIs. Inline CSS/SVG/JS or local files only. Never write outside the working folder. No git.',
    '6. All user-facing text in neutral Spanish with "tú". Never voseo ("vos", "tenés", "podés", "decime").',
    `7. ${NOTES} already holds the idea fields. At the end, edit it only if what you built differs (keep the same one-line fields${product ? '; Categoría, Antes, Ahora and Cómo probarlo are required' : ''}).`,
    '8. Reply with one line: what you changed.',
  ].join('\n') + '\n';
}

/** Escribe notes.md a partir de la idea (sin las líneas de construcción). */
const NOTE_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(#|Titular|Categor|Mirada|Gana|Cambio\s*\d|Por qu|Referencias|Riesgo|Situaci|Antes|Ahora|C[oó]mo probarlo|Se[ñn]al|Depende)/i;
export function notesFromIdea(idea) {
  const out = [];
  let skip = false;
  for (const l of String(idea || '').replace(/^```\w*\s*|```\s*$/g, '').split(/\r?\n/)) {
    if (/^\s*(?:[-*]\s*)?(?:\*\*)?(Construir|No tocar)(?:\*\*)?:/i.test(l)) { skip = true; continue; }
    if (skip && !NOTE_LINE.test(l)) continue;
    skip = false;
    out.push(l);
  }
  return `${out.join('\n').trim()}\n`;
}

// ---------------------------------------------------------------------------
// Pasos de la ronda
// ---------------------------------------------------------------------------

export async function prepare(n, { out = 'rounds', force = false, shots = takeShots, root, lenteBlind, lenteContext, modelo, modeloIdea } = {}) {
  const run = loadRun(out);
  n = parseInt(n, 10);
  if (!(n >= 1)) throw new BoldError('Ronda inválida');
  if (n > run.max_rounds) throw new BoldError(`Tope alcanzado: max_rounds=${run.max_rounds}. Sube el tope solo si el usuario lo pide.`);
  if (!force && n > 1 && !run.history.some(h => h.round === n - 1)) {
    throw new BoldError(`La ronda ${n - 1} aún no tiene variante aplicada. Primero: apply ${n - 1} <variante>`);
  }
  const limit = autoLimit(run);
  if (!force && involvementOf(run) !== 'auto' && autoStreak(run) > 0 && autoStreak(run) >= limit) {
    throw new BoldError(`Pausa de control (involucramiento ${run.involucramiento || `cada:${run.pause_every}`}): ${autoStreak(run)} rondas seguidas sin decisión humana. No elijas por el usuario: pídele que revise la ronda ${n - 1} en el cockpit. Cuando responda (o diga "sigue"), registra su decisión con apply ${n - 1} <variante> SIN --auto y luego prepare ${n}.`);
  }
  if (!force && autoStreak(run) >= AUTO_SAFETY_CAP) {
    throw new BoldError(`Tope de seguridad: ${AUTO_SAFETY_CAP} rondas seguidas eligiendo solo. Pide al usuario que revise antes de seguir.`);
  }
  const rp = roundPaths(out, n);
  const wp = runPaths(out).working;
  for (const v of ['blind', 'context']) { emptyDir(rp.variant(v)); copyTree(wp, rp.variant(v)); }
  let before = { ok: false, reason: 'no-web' };
  if (run.web) before = await shots(wp, join(rp.shots, 'before'), { entry: run.entry });
  const beforeShots = before.ok ? Object.values(before.files) : [];
  const pair = pickLenses(run, n, { blind: lenteBlind, context: lenteContext });
  const model = checkModel(modelo || run.modelo || DEFAULT_MODEL);
  const modelIdea = checkModel(modeloIdea || run.modelo_idea || DEFAULTS.ideaModel);
  run.lens_log = [...(run.lens_log || []).filter(l => l.round !== n), { round: n, ...pair, model, model_idea: modelIdea }].sort((a, b) => a.round - b.round);
  saveRun(out, run);
  for (const v of ['blind', 'context']) {
    const lens = loadLens(pair[v]);
    writeFileSync(rp.prompt(v), buildPrompt(v, { run, out, n, root, beforeShots, lens }), 'utf8');
    writeFileSync(rp.ideaPrompt(v), buildIdeaPrompt(v, { run, out, n, root, beforeShots, lens }), 'utf8');
  }
  return {
    round: n, dir: rp.dir, before, model, model_idea: modelIdea, lenses: pair,
    agent_model: `Método B (run, por defecto): idea con ${modelIdea} y construye con ${model}, aislado. Método A: pasa model: "${model}" en AMBAS llamadas a Agent.`,
    prompts: { blind: rp.prompt('blind'), context: rp.prompt('context') },
  };
}

/** `node --check` de un archivo: null si compila, o el error en una línea. */
export function nodeCheck(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (r.status === 0) return null;
  return String(r.stderr || r.error || 'error de sintaxis').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/^at |^Node\.js v/.test(s)).slice(0, 4).join(' · ').slice(0, 300);
}

/**
 * Errores de sintaxis en lo que cambió: `node --check` de cada .js/.mjs/.cjs y de cada
 * <script> inline de los .html (sin src; JSON y plantillas se saltan).
 */
export function syntaxErrors(dir, files, { check = nodeCheck } = {}) {
  const errs = [];
  let k = 0;
  for (const f of files) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    if (/\.(m|c)?js$/i.test(f)) {
      const e = check(p);
      if (e) errs.push({ file: f, error: e.replace(p, f) });
      continue;
    }
    if (!/\.html?$/i.test(f)) continue;
    const html = readFileSync(p, 'utf8');
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    let i = 0;
    while ((m = re.exec(html))) {
      const attrs = m[1];
      if (/\bsrc\s*=/i.test(attrs) || !m[2].trim()) continue;
      const type = ((/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '').toLowerCase();
      if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) continue;
      i += 1;
      const tmp = join(tmpdir(), `mazelab-check-${process.pid}-${k++}.${type === 'module' ? 'mjs' : 'js'}`);
      writeFileSync(tmp, m[2], 'utf8');
      const e = check(tmp);
      rmSync(tmp, { force: true });
      if (e) errs.push({ file: `${f} (<script> ${i})`, error: e.split(tmp).join(`${f}#script${i}`) });
    }
  }
  return errs;
}

/** ¿La variante se cortó por el límite de uso? (run-<v>.json del método B, o el texto de logs y notas). */
export function limitOf(rp, v) {
  if (existsSync(rp.runInfo(v))) {
    try {
      const info = readJSON(rp.runInfo(v));
      if (info.estado === 'reintentar') return info.idear?.limite || info.construir?.limite || { hit: true, message: 'límite de uso' };
    } catch { /* run-<v>.json dañado: se sigue con los textos */ }
  }
  for (const f of [join(rp.dir, `log-${v}.txt`), join(rp.variant(v), NOTES)]) {
    if (!existsSync(f)) continue;
    const msg = detectaLimite(readFileSync(f, 'utf8').slice(-20000));
    if (msg) return { hit: true, message: msg };
  }
  return null;
}

const resetText = lim => {
  const t = Number(lim?.resets_at);
  if (!t) return '';
  const d = new Date(t > 1e12 ? t : t * 1000);
  return ` (se libera cerca de las ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')})`;
};

/** Screenshots "después", diff contra "antes", sintaxis y rechazo si no hay cambio válido. */
export async function after(n, { out = 'rounds', shots = takeShots, check = nodeCheck } = {}) {
  const run = loadRun(out);
  const rp = roundPaths(out, n);
  const wp = runPaths(out).working;
  const result = { round: n, threshold: run.threshold, variants: {} };
  for (const v of VARIANTS) {
    const vd = rp.variant(v);
    if (!existsSync(vd)) continue;
    const files = changedFiles(wp, vd);
    const lens = roundLens(run, n, v);
    const notesFile = join(vd, NOTES);
    if (lens && existsSync(notesFile) && !/^Mirada:/im.test(readFileSync(notesFile, 'utf8'))) {
      writeFileSync(notesFile, `${readFileSync(notesFile, 'utf8').trimEnd()}\nMirada: ${lens.etiqueta}\n`, 'utf8');
    }
    const r = { files_changed: files, has_notes: existsSync(join(vd, NOTES)), ratios: {}, visible: files.length > 0 };
    if (run.web && files.length) {
      const s = await shots(vd, join(rp.shots, v), { entry: run.entry });
      if (s.ok) {
        for (const vp of Object.keys(VIEWPORTS)) {
          const b = join(rp.shots, `before-${vp}.png`);
          if (existsSync(b) && s.files[vp]) r.ratios[vp] = Number(pixelDiff(readFileSync(b), readFileSync(s.files[vp])).ratio.toFixed(4));
        }
        if (Object.keys(r.ratios).length) r.visible = Object.values(r.ratios).some(x => x >= run.threshold);
      } else r.shot_error = s.reason;
    }
    if (run.modo === 'producto') {
      // Modo producto: los píxeles no bastan (ni se exigen: una capacidad puede vivir tras un clic).
      // Se exige que cambie algún archivo y que notes.md cuente Antes/Ahora/Cómo probarlo sin categoría estética.
      const notesP = join(vd, NOTES);
      const pc = checkProductNotes(existsSync(notesP) ? readFileSync(notesP, 'utf8') : '');
      r.product = { ok: pc.ok, missing: pc.missing, aesthetic: pc.aesthetic, known_category: pc.known_category };
      r.rejected = !files.length || !pc.ok;
      r.reason = !files.length ? 'no cambió ningún archivo' : !pc.ok ? pc.reason : '';
    } else {
      r.rejected = !r.visible;
      r.reason = !files.length ? 'no cambió ningún archivo' : !r.visible ? `cambio no visible (diff < ${run.threshold * 100}%)` : '';
    }
    // JS roto: la variante no sirve aunque se vea distinta.
    const syn = syntaxErrors(vd, files, { check });
    if (syn.length) {
      r.syntax_errors = syn;
      r.rejected = true;
      r.reason = `error de sintaxis en ${syn[0].file}: ${clipText(syn[0].error, 160)}`;
    }
    // Límite de uso: no es un problema de calidad. Se marca para reintentar, nunca como rechazo.
    const lim = limitOf(rp, v);
    if (lim) {
      r.reintentar = true;
      r.rejected = true;
      r.reason = `límite de uso alcanzado${resetText(lim)}: no es un problema de calidad, reintenta con run ${n} ${v}`;
    }
    result.variants[v] = r;
  }
  writeJSON(rp.check, result);
  return result;
}

export const reviewId = (run, n) => `rounds-${run.slug}${run.tag ? `-${run.tag}` : ''}-${pad(n)}`;
const LABEL = { blind: 'ciega (sin memoria)', context: 'con contexto', integrada: 'integrada' };
const SHORT_LABEL = { blind: 'Ciega', context: 'Con contexto', integrada: 'Integrada' };
const CHOICE_LABEL = { blind: 'Ciega: sin memoria', context: 'Con contexto: conoce tus votos', integrada: 'Integrada', integrar: 'Integrar ambas' };

function mediaPath(abs, root) {
  const rel = toPosix(relative(resolveRoot(root), abs));
  if (!isSafeMediaPath(rel)) throw new BoldError(`La carpeta de rondas debe estar dentro del proyecto (sin carpetas ocultas) para que el cockpit muestre la media: ${rel}`);
  return rel;
}

// Campos de notes.md (regex tolerante a tildes y a viñetas "- ").
const NOTE_FIELDS = {
  titular: 'Titular', categoria: 'Categor[ií]a', situacion: 'Situaci[oó]n', antes: 'Antes', ahora: 'Ahora',
  como_probarlo: 'C[oó]mo probarlo', senal: 'Se[ñn]al(?: de validaci[oó]n)?', depende: 'Depende de prueba real',
  riesgo: 'Riesgo', por_que: 'Por qu[eé]', gana: 'Gana',
};
const FIELD_LABEL = { categoria: 'Categoría', antes: 'Antes', ahora: 'Ahora', como_probarlo: 'Cómo probarlo' };

/** Lee las líneas de notes.md: Titular, Categoría, "Cambio N" y los campos de modo producto. */
export function parseNotes(md) {
  const text = String(md || '');
  const field = re => {
    const m = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${re})(?:\\*\\*)?:\\s*(.+)$`, 'im').exec(text);
    return m ? m[1].replace(/^\*\*\s*/, '').trim() : '';
  };
  const out = Object.fromEntries(Object.entries(NOTE_FIELDS).map(([k, re]) => [k, field(re)]));
  out.cambios = [...text.matchAll(/^Cambio\s*\d*:\s*(.+)$/gim)].map(m => m[1].trim());
  return out;
}

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const AESTHETIC_RE = /\b(tipografi\w*|fuentes?|colou?r(es)?|paleta|layout|maquetaci\w*|composicion|jerarquia|espaciado|estetic\w*|look and feel|copy|textos?|imagen(es)?|fotos? de portada|mobile|responsive|visual(es)?|diseno visual|estilo)\b/;

/** ¿La categoría es estética? (lo que el modo producto no acepta como cambio de la ronda) */
export function isAestheticCategory(cat) {
  const c = fold(cat);
  if (!c) return false;
  if (PRODUCT_CATEGORIES.some(p => c.startsWith(fold(p)) || fold(p).startsWith(c))) return false;
  return CATEGORIES.some(v => c === fold(v)) || AESTHETIC_RE.test(c);
}

/** Validación de notes.md en modo producto: campos obligatorios y categoría no estética. */
export function checkProductNotes(md) {
  const n = parseNotes(md);
  const missing = PRODUCT_REQUIRED.filter(k => !n[k]).map(k => FIELD_LABEL[k]);
  const aesthetic = isAestheticCategory(n.categoria);
  const known = PRODUCT_CATEGORIES.some(p => fold(n.categoria).startsWith(fold(p)));
  const reasons = [];
  if (missing.length) reasons.push(`faltan en notes.md: ${missing.join(', ')}`);
  if (aesthetic) reasons.push(`la categoría "${n.categoria}" es estética (en modo producto la ronda debe cambiar una capacidad, decisión o resultado)`);
  return { ok: !reasons.length, missing, aesthetic, known_category: known, notes: n, reason: reasons.join('; ') };
}

function readBlocks(rp, name) {
  const p = join(rp.shots, `${name}.blocks.json`);
  if (!existsSync(p)) return [];
  try { return readJSON(p); } catch { return []; }
}

// Hotspots de una vista: zonas por píxeles, nombres según la página o notes.md.
function hotspotsFor(rp, v, vp, cambios) {
  const a = join(rp.shots, `before-${vp}.png`);
  const b = join(rp.shots, `${v}-${vp}.png`);
  if (!existsSync(a) || !existsSync(b)) return [];
  let regions, img;
  try {
    img = decodePNG(readFileSync(b));
    regions = changedRegions(decodePNG(readFileSync(a)), img);
  } catch { return []; }
  const blocks = readBlocks(rp, `${v}-${vp}`);
  const used = new Set();
  // Las líneas "Cambio N" solo se usan si calzan con las zonas: mejor un nombre
  // sacado de la propia página que uno bonito sobre la zona equivocada.
  const useNotes = cambios.length === regions.length;
  return regions.map((r, i) => ({ ...r, label: useNotes ? cambios[i] : labelRegion(r, blocks, img.width, img.height, used) }));
}

function realRatio(rp, v) {
  const a = join(rp.shots, 'before-desktop.png');
  const b = join(rp.shots, `${v}-desktop.png`);
  if (!existsSync(a) || !existsSync(b)) return 0;
  try { return realChangeRatio(readFileSync(a), readFileSync(b)); } catch { return 0; }
}

function variantVisual(rp, v, cambios, root) {
  const view = vp => {
    const before = join(rp.shots, `before-${vp}.png`);
    const after = join(rp.shots, `${v}-${vp}.png`);
    if (!existsSync(before) || !existsSync(after)) return null;
    return {
      label: vp === 'desktop' ? 'Escritorio' : 'Celular',
      device: vp,
      before: mediaPath(before, root),
      after: mediaPath(after, root),
      hotspots: hotspotsFor(rp, v, vp, cambios),
    };
  };
  const views = Object.keys(VIEWPORTS).map(view).filter(Boolean);
  if (!views.length) return null;
  const [first] = views;
  return { type: 'before_after', before: first.before, after: first.after, device: first.device, hotspots: first.hotspots, ...(views.length > 1 ? { views } : {}) };
}

const capWords = (s, n = 10) => {
  const w = String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' ');
};

/** Líneas cortas bajo cada opción de "elegir": la diferencia entre ciega y contexto, lado a lado. */
export function optionLines(parsed, modo = 'visual') {
  const t = s => clipText(s, 140);
  const lines = modo === 'producto'
    ? [
      { label: 'Titular', text: parsed.titular },
      { label: 'Antes → Ahora', text: parsed.antes && parsed.ahora ? `${parsed.antes} → ${parsed.ahora}` : '' },
      { label: 'Cómo probarlo', text: parsed.como_probarlo },
      { label: 'Señal', text: parsed.senal },
    ]
    : [
      { label: 'Titular', text: parsed.titular },
      { label: 'Categoría', text: parsed.categoria },
      { label: 'Cambios', text: (parsed.cambios || []).slice(0, 3).join(' · ') },
    ];
  return lines.filter(l => String(l.text || '').trim()).map(l => ({ label: l.label, text: t(l.text) }));
}

// Lámina de producto cuando no hay antes/después visible: Antes → Ahora → Cómo probarlo.
function productDiagram(parsed) {
  const steps = [
    parsed.antes && { label: 'Antes', note: capWords(parsed.antes, 14), icon: 'close' },
    parsed.ahora && { label: 'Ahora', note: capWords(parsed.ahora, 14), icon: 'rocket', tone: 'you' },
    parsed.como_probarlo && { label: 'Cómo probarlo', note: capWords(parsed.como_probarlo, 14), icon: 'check' },
  ].filter(Boolean);
  return steps.length >= 2 ? { type: 'diagram', kind: 'flow', steps } : null;
}

/** Arma el JSON de la revisión (kind "rounds"), en imágenes. Puro: no publica. */
export function buildRoundReview(n, { out = 'rounds', root, sprint } = {}) {
  const run = loadRun(out);
  const product = run.modo === 'producto';
  const rp = roundPaths(out, n);
  if (!existsSync(rp.check)) throw new BoldError(`Falta ${rp.check}. Corre primero: after ${n}`);
  const check = readJSON(rp.check);
  const shot = name => { const p = join(rp.shots, `${name}.png`); return existsSync(p) ? [mediaPath(p, root)] : []; };
  const items = [];
  const ok = [];
  const parsedBy = {};
  for (const v of ['blind', 'context', 'integrada']) {
    const c = check.variants[v];
    if (!c) continue;
    const notesP = join(rp.variant(v), NOTES);
    const notes = existsSync(notesP) ? readFileSync(notesP, 'utf8').trim() : '(la variante no dejó notes.md)';
    const parsed = parseNotes(notes);
    parsedBy[v] = parsed;
    const lens = roundLens(run, n, v);
    const mirada = lens ? miradaLabel(lens) : '';
    const ratios = Object.entries(c.ratios).map(([k, x]) => `${k} ${(x * 100).toFixed(1)}%`).join(', ');
    const media = [...shot('before-desktop'), ...shot(`${v}-desktop`), ...shot('before-mobile'), ...shot(`${v}-mobile`)];
    if (run.web && run.entry && existsSync(join(rp.variant(v), run.entry)) && /\.html?$/i.test(run.entry)) media.push(mediaPath(join(rp.variant(v), run.entry), root));
    if (!c.rejected) ok.push(v);
    const slider = variantVisual(rp, v, parsed.cambios, root);
    // En modo producto, si los píxeles casi no cambian, el antes/después no dice nada: va Antes → Ahora.
    const pixelsMoved = Object.values(c.ratios || {}).some(x => x >= run.threshold);
    const visual = (product && !(slider && pixelsMoved) && productDiagram(parsed)) || slider || (c.files_changed.length
      ? { type: 'diagram', kind: 'connects', center: `Variante ${SHORT_LABEL[v]}`, links: c.files_changed.slice(0, 8).map(f => ({ label: f, icon: 'pencil' })) }
      : shot('before-desktop').length ? { type: 'image', path: shot('before-desktop')[0], alt: 'La página sigue igual que antes' } : null);
    const pct = realRatio(rp, v);
    const zones = visual?.hotspots?.length || 0;
    const stats = c.rejected ? [] : [
      ...(pct ? [{ value: `${Math.round(pct * 100)}%`, label: 'de la página es nueva' }] : []),
      ...(zones ? [{ value: zones, label: zones === 1 ? 'zona marcada' : 'zonas marcadas' }] : []),
    ];
    const rejectedHeadline = c.syntax_errors?.length ? `${SHORT_LABEL[v]}: rechazada, el código tiene un error`
      : product ? `${SHORT_LABEL[v]}: rechazada, ${c.product?.aesthetic ? 'cambio solo estético' : 'sin Antes/Ahora/Cómo probarlo'}` : `${SHORT_LABEL[v]}: sin cambio visible`;
    items.push({
      id: v,
      title: `Ronda ${n} · Variante ${LABEL[v]}${c.rejected ? ' · RECHAZADA' : ''}`,
      headline: c.reintentar ? `${SHORT_LABEL[v]}: pausada por límite de uso` : c.rejected ? (c.files_changed.length ? rejectedHeadline : `${SHORT_LABEL[v]}: no cambió nada`) : parsed.titular || `${SHORT_LABEL[v]}: ${parsed.categoria || 'mira el cambio'}`,
      kicker: `Ronda ${n} · ${SHORT_LABEL[v]}${mirada ? ` · ${mirada}` : ''}${product && parsed.categoria ? ` · ${capWords(parsed.categoria, 5)}` : ''}`,
      ask: c.reintentar ? 'Se reintenta más tarde' : c.rejected ? 'Descartada sola' : product ? '¿Esto le sirve al usuario?' : '¿Te gusta?',
      body_md: [
        notes, '',
        `**Archivos cambiados:** ${c.files_changed.length ? c.files_changed.join(', ') : 'ninguno'}`,
        ratios ? `**Diferencia visual vs. antes:** ${ratios}` : '',
        c.rejected ? `**Rechazada automáticamente:** ${c.reason}.` : '',
      ].filter(Boolean).join('\n'),
      media,
      tags: [v, c.rejected ? 'rechazada' : 'candidata', ...(c.reintentar ? ['reintentar'] : [])],
      ...(visual ? { visual } : {}),
      ...(stats.length ? { stats } : {}),
    });
  }
  // Elegir con un clic: cada opción vota el ítem de su variante, así `choice` sigue igual.
  // Cada opción muestra su diferencia en líneas cortas (no solo "opción 1 / opción 2").
  const pictured = ok.filter(v => shot(`${v}-desktop`).length);
  const choosable = product ? ok : pictured;
  if (choosable.length >= 2) {
    const options = choosable.slice(0, 3).map(v => {
      const lines = optionLines(parsedBy[v], run.modo);
      const lens = roundLens(run, n, v);
      return {
        id: v,
        label: `${CHOICE_LABEL[v]}${lens ? ` · ${miradaLabel(lens)}` : ''}`,
        item: v,
        ...(shot(`${v}-desktop`).length ? { image: shot(`${v}-desktop`)[0] } : { icon: v === 'blind' ? 'sparkles' : 'chat' }),
        ...(shot(`${v}-mobile`).length ? { image_mobile: shot(`${v}-mobile`)[0] } : {}),
        ...(lines.length ? { lines } : {}),
      };
    });
    if (!check.variants.integrada) {
      const both = [shot('blind-desktop')[0], shot('context-desktop')[0]].filter(Boolean);
      options.push({
        id: 'integrar', label: CHOICE_LABEL.integrar, item: 'integrar', icon: 'merge',
        ...(both.length === 2 ? { images: both } : {}),
        lines: [{ label: 'Qué pasa', text: 'Claude junta lo mejor de ambas según tu comentario y te la muestra antes de seguir' }],
      });
    }
    items.push({
      id: 'elegir',
      title: `Ronda ${n} · Elegir la base de la siguiente ronda`,
      headline: '¿Con cuál seguimos?',
      kicker: `Ronda ${n} · tu decisión`,
      ask: 'Elige una y comenta si quieres',
      body_md: [
        'Elige con un clic. Con el botón de comentario dices qué ajustar: la variante con contexto lo recibe en la ronda siguiente (la ciega no ve nada, a propósito).',
        check.variants.integrada ? '' : 'Si eliges "Integrar ambas", dime en el comentario qué tomar de cada una; Claude arma la versión integrada y te la muestra antes de seguir.',
      ].filter(Boolean).join('\n\n'),
      media: [],
      tags: ['elegir'],
      visual: { type: 'compare', options: options.slice(0, 3) },
    });
  }
  // Si Claude eligió solo (auto / cada:N), la razón queda visible primero para revisarla después.
  const decided = run.history.find(h => h.round === Number(n) && h.auto && (h.reason || '').trim());
  if (decided) {
    const pic = shot(`${decided.variant}-desktop`);
    items.unshift({
      id: 'decision-claude',
      title: `Ronda ${n} · Claude eligió ${SHORT_LABEL[decided.variant]}`,
      headline: capWords(`Claude eligió ${SHORT_LABEL[decided.variant]}: ${decided.reason}`, 10),
      kicker: `Ronda ${n} · elección de Claude (${run.involucramiento || 'auto'})`,
      ask: '¿Estás de acuerdo?',
      body_md: `**Por qué:** ${decided.reason}\n\nSi no estás de acuerdo, vota abajo y deja un comentario: la variante con contexto lo recibe en la ronda siguiente.`,
      media: [],
      tags: ['decision-claude', decided.variant],
      visual: pic.length ? { type: 'image', path: pic[0], alt: `Variante ${SHORT_LABEL[decided.variant]}` }
        : { type: 'diagram', kind: 'flow', steps: [{ label: 'Claude eligió', note: SHORT_LABEL[decided.variant], icon: 'check', tone: 'ok' }, { label: 'Por qué', note: capWords(decided.reason, 14), icon: 'chat' }] },
    });
  }
  return {
    id: reviewId(run, n),
    title: `Bold rounds${product ? ' (producto)' : ''} · ${run.slug}${run.tag ? ` · ${run.tag}` : ''} · ronda ${n} de ${run.max_rounds}`,
    kind: 'rounds',
    ...(sprint !== undefined ? { sprint } : {}),
    connects_to: n > 1 ? [reviewId(run, n - 1)] : [],
    context_brief: [
      `Objetivo: ${run.goal}. Se trabaja sobre una COPIA; el original no se toca hasta que el usuario diga "aplicar".`,
      product ? 'Modo producto: cada variante cambia lo que el usuario final puede hacer (Antes → Ahora) y trae pasos para probarlo en la copia.' : '',
      'Cada ronda corre dos variantes en paralelo: la ciega no sabe nada de rondas anteriores (para innovar sin sesgo); la de contexto conoce las rondas previas y el feedback del usuario.',
      'Pide al usuario que vote a favor de UNA opción (ciega, contexto o integrar) y que deje un comentario si quiere ajustar algo. La elegida se convierte en la base de la ronda siguiente.',
      product ? 'Las rechazadas no cambiaron nada o les faltó Antes/Ahora/Cómo probarlo, o el cambio era solo estético.' : 'Las rechazadas no cambiaron nada visible.',
      decided ? `En esta ronda Claude eligió solo (${decided.variant}) porque: ${decided.reason}.` : '',
    ].filter(Boolean).join(' '),
    items,
  };
}

// ---------------------------------------------------------------------------
// Resumen visual de la corrida (una ronda por pantalla), en el cockpit
// ---------------------------------------------------------------------------

/** Las 5 palabras que confundían, en lenguaje simple. */
export const GLOSARIO = [
  { term: 'Ciega', text: 'La versión hecha sin memoria: no sabe qué elegiste antes. Sirve para traer ideas frescas.' },
  { term: 'Con contexto', text: 'La versión que sí conoce tus votos, tus comentarios y lo aprendido en las rondas anteriores.' },
  { term: 'Señal', text: 'El número que diría si la idea funciona con gente real. Ejemplo: 4 de cada 10 invitados suben una foto.' },
  { term: 'Veredicto', text: 'Lo que pasó con la ronda: la elegiste, Claude la eligió, se descartó sola o quedó para reintentar.' },
  { term: 'Categoría', text: 'El tipo de cambio de la ronda (color, tipografía, una capacidad nueva...). Ayuda a no repetir siempre lo mismo.' },
];

const firstSentence = s => String(s || '').split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '').trim();

export const resumenId = run => `rounds-${run.slug}${run.tag ? `-${run.tag}` : ''}-resumen`;

function readNotes(rp, v) {
  const p = join(rp.variant(v), NOTES);
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : '';
}

/** Veredicto de una ronda para el chip: quién eligió qué, o por qué no hay elegida. */
function verdictOf(run, n, check) {
  const h = run.history.find(x => x.round === n);
  if (h) return { variant: h.variant, chip: { text: h.auto ? `Claude eligió ${SHORT_LABEL[h.variant]}` : `Elegiste ${SHORT_LABEL[h.variant]}`, tone: 'ok' } };
  const vs = Object.entries(check?.variants || {});
  if (vs.some(([, c]) => c.reintentar)) return { variant: null, chip: { text: 'Reintentar: límite de uso', tone: 'warn' } };
  const ok = vs.filter(([, c]) => !c.rejected).map(([v]) => v);
  if (!ok.length) return { variant: null, chip: { text: 'Sin cambio válido', tone: 'bad' } };
  return { variant: ok[0], chip: { text: 'Falta elegir', tone: 'info' } };
}

/** Arma la revisión "resumen" de toda la corrida. Puro: no publica. */
export function buildResumen({ out = 'rounds', root } = {}) {
  const run = loadRun(out);
  const product = run.modo === 'producto';
  const rounds = [];
  for (let n = 1; n <= run.max_rounds; n++) if (existsSync(roundPaths(out, n).check)) rounds.push(n);
  if (!rounds.length) throw new BoldError('Todavía no hay rondas revisadas (corre after en al menos una ronda).');
  const items = [];
  const chosenRounds = rounds.filter(n => run.history.some(h => h.round === n));
  // Lámina 1: de dónde partimos y dónde estamos.
  const firstBefore = join(roundPaths(out, rounds[0]).shots, 'before-desktop.png');
  const lastH = run.history.filter(h => rounds.includes(h.round)).at(-1);
  const lastAfter = lastH ? join(roundPaths(out, lastH.round).shots, `${lastH.variant}-desktop.png`) : null;
  if (existsSync(firstBefore) && lastAfter && existsSync(lastAfter)) {
    items.push({
      id: 'evolucion', title: `Evolución completa: ${chosenRounds.length} rondas aplicadas`,
      headline: `${chosenRounds.length} ${chosenRounds.length === 1 ? 'ronda' : 'rondas'}: así cambió`,
      kicker: 'De dónde partimos', gain: `Objetivo: ${clipText(run.goal, 140)}`,
      visual: { type: 'before_after', before: mediaPath(firstBefore, root), after: mediaPath(lastAfter, root), device: 'desktop' },
      ...(run.web && run.entry ? { try: { label: 'Probar la versión actual', path: mediaPath(join(roundPaths(out, lastH.round).variant(lastH.variant), run.entry), root) } } : {}),
      body_md: `Se trabajó sobre una copia; el original sigue intacto hasta que digas "aplicar".\n\nRondas: ${rounds.length}. Elegidas: ${chosenRounds.length}.`,
      media: [], tags: ['resumen'],
    });
  }
  for (const n of rounds) {
    const rp = roundPaths(out, n);
    const check = readJSON(rp.check);
    const { variant, chip } = verdictOf(run, n, check);
    const v = variant || 'blind';
    const parsed = parseNotes(readNotes(rp, v));
    const slider = variant ? variantVisual(rp, v, parsed.cambios, root) : null;
    const before = join(rp.shots, 'before-desktop.png');
    const visual = slider || (product && productDiagram(parsed))
      || (existsSync(before) ? { type: 'image', path: mediaPath(before, root), alt: 'Así estaba antes de la ronda' } : { type: 'diagram', kind: 'flow', steps: [{ label: 'Ronda', note: String(n), icon: 'flag' }, { label: 'Veredicto', note: chip.text, icon: 'alert' }] });
    const gainText = parsed.gana || (product ? parsed.ahora : '') || firstSentence(parsed.por_que) || parsed.titular;
    const entry = variant && run.web && run.entry ? join(rp.variant(v), run.entry) : null;
    const detail = ['blind', 'context', 'integrada'].filter(x => check.variants[x]).map(x => {
      const c = check.variants[x];
      const p = parseNotes(readNotes(rp, x));
      return `**${SHORT_LABEL[x]}:** ${p.titular || '(sin titular)'}${c.rejected ? ` · descartada: ${c.reason}` : ''}`;
    });
    const why = run.history.find(h => h.round === n);
    items.push({
      id: `ronda-${pad(n)}`,
      title: `Ronda ${n} · ${variant ? SHORT_LABEL[variant] : 'sin elegida'}`,
      headline: capWords(variant ? (parsed.titular || `Ronda ${n}`) : `Ronda ${n}: ${chip.text}`, 10),
      kicker: `Ronda ${n} de ${run.max_rounds}`,
      chip,
      ...(gainText ? { gain: `Qué gana el usuario: ${clipText(gainText, 120)}` } : {}),
      ...(entry && existsSync(entry) ? { try: { label: 'Probar', path: mediaPath(entry, root) } } : {}),
      visual,
      body_md: [
        ...detail, '',
        why?.reason ? `**Por qué se eligió:** ${why.reason}` : '',
        why?.comment ? `**Tu comentario:** ${why.comment}` : '',
        parsed.senal ? `**Señal para validar con gente real:** ${parsed.senal}` : '',
        parsed.como_probarlo ? `**Cómo probarlo:** ${parsed.como_probarlo}` : '',
      ].filter(Boolean).join('\n'),
      media: [], tags: [chip.text],
    });
  }
  items.push({
    id: 'glosario', title: 'Glosario: 5 palabras en lenguaje simple', headline: '5 palabras, en simple',
    kicker: 'Glosario', visual: { type: 'glossary', terms: GLOSARIO }, body_md: '', media: [], tags: ['glosario'],
  });
  return {
    id: resumenId(run),
    title: `Resumen bold rounds${product ? ' (producto)' : ''} · ${run.slug}${run.tag ? ` · ${run.tag}` : ''}`,
    kind: 'rounds',
    connects_to: rounds.map(n => reviewId(run, n)),
    context_brief: `Resumen de una corrida de bold rounds sobre una copia. Objetivo: ${run.goal}. Una ronda por lámina: titular, antes/después, qué gana el usuario, botón Probar y un chip con el veredicto. El usuario decide mirando; el detalle va en "Ver más". La última lámina es un glosario.`,
    items,
  };
}

export function resumen({ out = 'rounds', root } = {}) {
  const r = buildResumen({ out, root });
  return publishReview(r, root);
}

export function review(n, { out = 'rounds', root, sprint } = {}) {
  const r = buildRoundReview(n, { out, root, sprint });
  const res = publishReview(r, root);
  return { ...res, candidates: r.items.filter(i => !i.tags.includes('rechazada') && !['elegir', 'decision-claude'].includes(i.id)).map(i => i.id) };
}

/** Lee los votos del cockpit: devuelve blind | context | integrar | null. */
export function choiceFromFeedback(fb) {
  if (!fb || !fb.items) return null;
  const up = Object.entries(fb.items).filter(([, v]) => v && v.vote === 'up').map(([k]) => k);
  if (up.includes('integrar') || (up.includes('blind') && up.includes('context'))) return 'integrar';
  if (up.includes('blind')) return 'blind';
  if (up.includes('context')) return 'context';
  return null;
}

const COMMENT_ORDER = ['elegir', 'integrar', 'context', 'blind', 'integrada', 'decision-claude'];

/** Comentarios de texto (y resumen de voz) que el usuario dejó en la revisión de una ronda. */
export function feedbackComment(fb) {
  if (!fb) return '';
  const items = fb.items || {};
  const ids = [...COMMENT_ORDER.filter(k => items[k]), ...Object.keys(items).filter(k => !COMMENT_ORDER.includes(k))];
  const parts = [];
  for (const k of ids) {
    const text = String(items[k]?.comment || '').replace(/^Elegida: .*(\r?\n|$)/, '').trim();
    if (text) parts.push(k === 'elegir' ? text : `(sobre ${SHORT_LABEL[k] || k}) ${text}`);
  }
  if (fb.summary) parts.push(...(fb.summary.decisions || []), ...(fb.summary.requests || []));
  return clipText([...new Set(parts.map(p => String(p).trim()).filter(Boolean))].join(' | '), 1200);
}

export function choice(n, { out = 'rounds', root } = {}) {
  const run = loadRun(out);
  const fb = getFeedback(reviewId(run, n), root);
  return { review_id: reviewId(run, n), has_feedback: !!fb, choice: choiceFromFeedback(fb), comment: feedbackComment(fb) };
}

/**
 * Promueve una variante a la copia de trabajo. El objetivo original no se toca.
 * Guarda el comentario del usuario (cockpit o `--comentario`) para la variante CONTEXTO de la
 * ronda siguiente y en DESIGN.md. Con `auto` exige la razón y la deja visible en la revisión.
 */
export function apply(n, variant, { out = 'rounds', auto = false, force = false, root, comment = '', reason = '' } = {}) {
  if (variant === 'integrar') variant = 'integrada';
  if (!VARIANTS.includes(variant)) throw new BoldError(`Variante inválida: ${variant} (usa blind | context | integrada)`);
  const run = loadRun(out);
  if (auto && involvementOf(run) === 'todas' && !force) {
    throw new BoldError('Involucramiento "todas": el usuario elige cada ronda. No uses --auto: avísale qué está pendiente y espera su elección (cockpit o chat).');
  }
  if (auto && !String(reason || '').trim()) throw new BoldError('Con --auto deja escrito el porqué: --razon "una línea"');
  const rp = roundPaths(out, n);
  const vd = rp.variant(variant);
  if (!existsSync(vd)) throw new BoldError(`No existe ${vd}`);
  if (!force && existsSync(rp.check)) {
    const c = readJSON(rp.check).variants[variant];
    if (c && c.rejected) throw new BoldError(`La variante ${variant} fue rechazada (${c.reason}). Usa --force solo si el usuario insiste.`);
  }
  const wp = runPaths(out).working;
  emptyDir(wp);
  copyTree(vd, wp);
  rmSync(join(wp, NOTES), { force: true });
  const userComment = [String(comment || '').trim(), feedbackComment(getFeedback(reviewId(run, n), root))]
    .filter(Boolean).join(' | ');
  run.history = run.history.filter(h => h.round !== Number(n));
  run.history.push({
    round: Number(n), variant, auto: !!auto, at: new Date().toISOString(),
    ...(userComment ? { comment: clipText(userComment, 1500) } : {}),
    ...(auto ? { reason: clipText(reason, 500) } : {}),
  });
  run.history.sort((a, b) => a.round - b.round);
  saveRun(out, run);
  logToDesign(out, n, auto
    ? `Claude eligió ${variant} sin pausa porque ${clipText(reason, 200)}${userComment ? `; comentario: "${clipText(userComment, 160)}"` : ''}`
    : `el usuario eligió ${variant}${userComment ? `; comentó: "${clipText(userComment, 240)}"` : ''}`);
  let republished = false;
  if (auto && existsSync(rp.check)) {
    try { review(n, { out, root }); republished = true; } catch { /* sin revisión publicable (p. ej. fuera del proyecto) */ }
  }
  return { working: wp, history: run.history, comment: userComment, republished };
}

/**
 * Qué toca ahora, en una línea para el usuario/Claude. Nunca inventa la elección del usuario:
 * si el modo pide su decisión y no llegó, dice qué está pendiente y cómo responder.
 */
export function nextAction(run, out = 'rounds', root) {
  const last = run.history.at(-1)?.round || 0;
  const n = last + 1;
  const kind = involvementOf(run);
  if (n > run.max_rounds) return `Corrida terminada (${run.max_rounds} rondas). Resume la evolución y ofrece "aplicar" (changes).`;
  const rp = roundPaths(out, n);
  if (!existsSync(rp.prompt('blind'))) {
    if (kind !== 'auto' && autoStreak(run) > 0 && autoStreak(run) >= autoLimit(run)) {
      return `PENDIENTE del usuario: checkpoint de ${run.involucramiento}. Que revise la ronda ${last} en el cockpit (${reviewId(run, last)}) y responda; luego apply ${last} <variante> sin --auto y prepare ${n}.`;
    }
    return `prepare ${n}`;
  }
  const st = existsSync(rp.status) ? (() => { try { return readJSON(rp.status); } catch { return null; } })() : null;
  if (st && st.estado === 'corriendo') return `Las variantes de la ronda ${n} siguen corriendo: espera ${n} (espera como máximo 4 min y vuelve; no uses comandos más largos).`;
  if (!existsSync(rp.check)) return `Corre las variantes de la ronda ${n} (run ${n} --fondo y luego espera ${n}) y después after ${n}.`;
  let retry = [];
  try { retry = Object.entries(readJSON(rp.check).variants || {}).filter(([, c]) => c.reintentar).map(([v]) => v); } catch { /* check dañado */ }
  if (retry.length) return `Límite de uso alcanzado en ${retry.join(' y ')} (no es un rechazo de calidad). Cuando se libere la ventana: run ${n} ${retry.length === 2 ? 'both' : retry[0]} --fondo, espera ${n} y after ${n}.`;
  const id = reviewId(run, n);
  if (!getReview(id, root)) return `review ${n}`;
  const picked = choiceFromFeedback(getFeedback(id, root));
  if (picked) return `El usuario eligió ${picked}: ${picked === 'integrar' ? `arma la integrada, after ${n} y apply ${n} integrada` : `apply ${n} ${picked}`}.`;
  if (kind === 'auto' || (kind === 'cada' && autoStreak(run) < autoLimit(run))) {
    return `Claude elige (involucramiento ${run.involucramiento}): apply ${n} <blind|context> --auto --razon "<por qué, una línea>".`;
  }
  return `PENDIENTE del usuario: elegir la ronda ${n} en el cockpit (${id}). Dile: "Elige con un clic en el cockpit o respóndeme aquí: ciega, contexto o integrar, y un comentario si quieres". No elijas por él.`;
}

/** Resumen corto de una fase (para run-<v>.json y el reporte). */
const phaseInfo = r => ({
  ok: r.ok, secs: r.secs, timed_out: r.timed_out, requests: r.requests, num_turns: r.num_turns, subtype: r.subtype,
  first_context: r.usage.first_context, peak_context: r.usage.peak_context, total_tokens: r.usage.total,
  output_tokens: r.usage.output, cost_usd_lista: r.cost_usd, ventana_5h: r.window,
  ...(r.limit.hit ? { limite: r.limit } : {}), ...(r.error ? { error: r.error } : {}),
});

/**
 * Una variante del método B: IDEAR (sesión aislada, solo Read, system prompt propio) y
 * CONSTRUIR (otra sesión aislada, solo herramientas de edición, tope de turnos). Nunca lanza.
 * Estado: ok | reintentar (límite de uso) | timeout | fallo.
 */
export async function runVariant(n, v, { out = 'rounds', timeoutMin = DEFAULTS.timeoutMin, runner = runAislado, now = () => Date.now() } = {}) {
  const run = loadRun(out);
  const rp = roundPaths(out, n);
  const vd = rp.variant(v);
  if (!existsSync(rp.ideaPrompt(v))) throw new BoldError(`Falta ${rp.ideaPrompt(v)}. Corre primero: prepare ${n}`);
  const log = (run.lens_log || []).find(l => l.round === Number(n)) || {};
  const modelIdea = log.model_idea || run.modelo_idea || DEFAULTS.ideaModel;
  const modelBuild = log.model || run.modelo_construir || run.modelo || DEFAULTS.buildModel;
  const t0 = now();
  const total = timeoutMin * 60000;
  const info = { variant: v, round: Number(n), modelo_idea: modelIdea, modelo_construir: modelBuild, started_at: new Date(t0).toISOString() };
  const save = () => writeJSON(rp.runInfo(v), info);
  const idea = await runner({
    prompt: readFileSync(rp.ideaPrompt(v), 'utf8'), cwd: vd, model: modelIdea, tools: IDEA_TOOLS,
    systemPrompt: IDEA_SYSTEM, effort: DEFAULTS.ideaEffort, maxTurns: DEFAULTS.ideaTurns,
    addDirs: [rp.shots], timeoutMs: Math.min(DEFAULTS.ideaTimeoutMin * 60000, total),
    logFile: join(rp.dir, `log-${v}-idea.jsonl`),
  });
  info.idear = phaseInfo(idea);
  const finish = estado => { info.estado = estado; info.secs = Math.round((now() - t0) / 1000); save(); return info; };
  if (idea.limit.hit) return finish('reintentar');
  if (idea.timed_out) return finish('timeout');
  const spec = String(idea.result || '').trim();
  if (!spec || !/Titular\s*:/i.test(spec)) { info.error = 'la ideación no devolvió una idea con Titular'; return finish('fallo'); }
  writeFileSync(rp.idea(v), `${spec}\n`, 'utf8');
  writeFileSync(join(vd, NOTES), notesFromIdea(spec), 'utf8');
  const left = total - (now() - t0);
  if (left < 60000) return finish('timeout');
  const build = await runner({
    prompt: buildBuildPrompt(v, spec, { run, out, n }), cwd: vd, model: modelBuild, tools: BUILD_TOOLS,
    permissionMode: 'acceptEdits', effort: DEFAULTS.buildEffort, maxTurns: DEFAULTS.buildTurns,
    timeoutMs: left, logFile: join(rp.dir, `log-${v}-build.jsonl`),
  });
  info.construir = phaseInfo(build);
  if (build.limit.hit) return finish('reintentar');
  if (build.timed_out) return finish('timeout');
  // error_max_turns no es fatal: lo que alcanzó a editar se juzga en `after`.
  return finish(build.ok || build.subtype === 'error_max_turns' ? 'ok' : 'fallo');
}

/** Totales de una variante (idea + construcción) para comparar con Weddi. */
export function variantTotals(info) {
  const ph = [info.idear, info.construir].filter(Boolean);
  return {
    contexto_inicial_idea: info.idear?.first_context ?? null,
    contexto_inicial_construir: info.construir?.first_context ?? null,
    peticiones: ph.reduce((s, p) => s + (p.requests || 0), 0),
    tokens: ph.reduce((s, p) => s + (p.total_tokens || 0), 0),
    pico: Math.max(0, ...ph.map(p => p.peak_context || 0)),
    segundos: info.secs ?? null,
  };
}

/**
 * Método B (desatendido): variantes en SERIE por defecto (paralelo solo si se pide).
 * Escribe NNN/run-status.json para que `espera` pueda informar sin bloquear al orquestador.
 */
export async function runHeadless(n, which = 'both', { out = 'rounds', timeoutMin = DEFAULTS.timeoutMin, paralelo, runner } = {}) {
  const run = loadRun(out);
  const rp = roundPaths(out, n);
  const list = which === 'both' ? ['blind', 'context'] : [which];
  for (const v of list) if (!['blind', 'context'].includes(v)) throw new BoldError(`Variante inválida para run: ${v} (usa blind | context | both)`);
  const par = paralelo === undefined ? !!run.paralelo : !!paralelo;
  const status = { estado: 'corriendo', round: Number(n), variantes: Object.fromEntries(list.map(v => [v, 'pendiente'])), paralelo: par, pid: process.pid, started_at: new Date().toISOString() };
  writeJSON(rp.status, status);
  const one = async v => {
    status.variantes[v] = 'corriendo';
    writeJSON(rp.status, status);
    let r;
    try { r = await runVariant(n, v, { out, timeoutMin, runner }); } catch (e) { r = { variant: v, estado: 'fallo', error: e.message }; }
    status.variantes[v] = r.estado;
    writeJSON(rp.status, status);
    return r;
  };
  const results = [];
  if (par) results.push(...await Promise.all(list.map(one)));
  else for (const v of list) {
    const r = await one(v);
    results.push(r);
    // Con el límite de uso alcanzado no tiene sentido lanzar la siguiente variante.
    if (r.estado === 'reintentar') {
      for (const w of list.slice(list.indexOf(v) + 1)) status.variantes[w] = 'reintentar';
      break;
    }
  }
  status.estado = 'listo';
  status.finished_at = new Date().toISOString();
  writeJSON(rp.status, status);
  return results.map(r => ({ variant: r.variant, estado: r.estado, ...(r.error ? { error: r.error } : {}), ...(r.idear ? { medidas: variantTotals(r) } : {}) }));
}

/** Lanza `run` en segundo plano (proceso aparte) y vuelve enseguida: el orquestador nunca espera > 4 min. */
export function runInBackground(n, which = 'both', { out = 'rounds', timeoutMin = DEFAULTS.timeoutMin, paralelo = false, spawnFn = spawn } = {}) {
  const rp = roundPaths(out, n);
  if (!existsSync(rp.ideaPrompt('blind'))) throw new BoldError(`Falta prepare ${n}.`);
  mkdirSync(rp.dir, { recursive: true });
  const args = [fileURLToPath(import.meta.url), 'run', String(n), which, '--out', out, '--timeout-min', String(timeoutMin), ...(paralelo ? ['--paralelo'] : [])];
  const logPath = join(rp.dir, 'run-fondo.log');
  writeJSON(rp.status, { estado: 'corriendo', round: Number(n), variantes: {}, started_at: new Date().toISOString(), fondo: true });
  const fd = openSync(logPath, 'a');
  const child = spawnFn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.unref();
  return { pid: child.pid, status: rp.status, log: logPath };
}

/** Espera corta (≤ maxSec) a que termine un `run --fondo`. done=false → volver a llamar. */
export async function waitRun(n, { out = 'rounds', maxSec = DEFAULTS.waitSec, pollMs = 5000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const rp = roundPaths(out, n);
  const limit = Math.min(Math.max(1, Number(maxSec) || DEFAULTS.waitSec), DEFAULTS.waitSec);
  const t0 = Date.now();
  for (;;) {
    const st = existsSync(rp.status) ? readJSON(rp.status) : null;
    if (st && st.estado === 'listo') return { done: true, status: st };
    if ((Date.now() - t0) / 1000 >= limit) return { done: false, status: st };
    await sleep(pollMs);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const USAGE = `Uso: node scripts/bold_rounds.js <comando>
  init <carpeta|archivo|url> [--rounds 5] [--pause-every 3] [--goal "..."]   crea la copia de trabajo
       [--modo visual|producto]               visual = look and feel (por defecto); producto = capacidad/decisión/resultado
       [--involucramiento auto|cada:N|todas]  auto = Claude elige sin pausas; cada:N = pausa cada N; todas = tú eliges cada ronda
       [--hallazgos a.md,b.md]                archivos (p. ej. de un council entrevista) que solo recibe la variante CONTEXTO
       [--lentes a,b,c|auto] --modelo-idea opus --modelo-construir sonnet   (o --modelo M para ambos; se pregunta al usuario)
       [--paralelo] [--yes]                    sin --yes solo muestra el presupuesto (tokens y % de la ventana de 5 h)
  prepare <ronda> [--lente-blind X] [--lente-context Y] [--modelo M] [--modelo-idea M]   copias, "antes", prompts, lentes y modelos
  run <ronda> [both|blind|context] [--fondo] [--paralelo]   idear + construir con claude -p aislado (en serie por defecto)
  espera <ronda> [--max-seg 240]   espera corta a que termine run --fondo (exit 3 = sigue corriendo)
  after <ronda>            screenshots "después" + diff + sintaxis + rechazo; límite de uso = reintentar
  resumen                  publica en el cockpit la página visual de toda la corrida (una ronda por lámina)
  review <ronda> [--sprint N]   publica la ronda en el cockpit: antes/después con zonas marcadas y elegir con un clic
  choice <ronda>           lee el voto del usuario
  apply <ronda> <blind|context|integrada> [--auto --razon "..."] [--comentario "..."]   promueve la variante a la copia de trabajo
  status | changes         estado de la corrida y siguiente paso | archivos que difieren del original
  shot <objetivo> <prefijo>  |  diff <a.png> <b.png>
Opción común: --out <carpeta> (por defecto rounds)`;

async function cli(argv) {
  const { pos, flags } = parseArgs(argv);
  const [cmd, a, b] = pos;
  const out = flags.out || 'rounds';
  const print = v => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  switch (cmd) {
    case 'init': {
      if (!a) throw new BoldError('Falta el objetivo: init <carpeta|archivo|url>');
      // El modelo lo elige el usuario al configurar: la línea de comandos no asume ninguno.
      const mIdea = typeof flags['modelo-idea'] === 'string' ? flags['modelo-idea'] : flags.modelo;
      const mBuild = typeof flags['modelo-construir'] === 'string' ? flags['modelo-construir'] : flags.modelo;
      if (typeof mIdea !== 'string' || typeof mBuild !== 'string') {
        throw new BoldError(`Falta --modelo (o --modelo-idea y --modelo-construir): pregúntale al usuario qué modelo usar para IDEAR y cuál para CONSTRUIR (${MODELS.join(' | ')}). Recomienda Opus para idear (ideas fuera de la caja) y Sonnet para construir (gasta menos). No elijas por él.`);
      }
      const opts = {
        out, rounds: flags.rounds || flags['max-rounds'], pauseEvery: flags['pause-every'], goal: flags.goal,
        modo: flags.modo, involucramiento: flags.involucramiento, hallazgos: typeof flags.hallazgos === 'string' ? flags.hallazgos : [],
        lentes: flags.lentes || 'auto', modeloIdea: mIdea, modeloConstruir: mBuild, paralelo: !!flags.paralelo,
      };
      // Presupuesto visible ANTES de crear nada: sin --yes solo se muestra y se pide confirmación.
      if (!flags.yes) {
        const pre = previewEstimate(a, opts);
        print(pre.texto);
        print(`${PLUGGED_WARNING}\nPara seguir, muéstrale esto al usuario y, si dice que sí, repite el mismo comando con --yes.`);
        return 2;
      }
      const run = await init(a, opts);
      const inv = involvementOf(run) === 'auto' ? `auto (Claude elige sin pausas; tope de seguridad ${AUTO_SAFETY_CAP} rondas)`
        : involvementOf(run) === 'todas' ? 'todas (tú eliges cada ronda)' : `${run.involucramiento} (Claude elige y pausa cada ${run.pause_every})`;
      print(`Copia de trabajo lista en ${runPaths(out).working} (original intacto). Modo: ${run.modo}. Rondas máx: ${run.max_rounds}. Involucramiento: ${inv}. Lentes: ${Array.isArray(run.lentes) ? run.lentes.join(', ') : 'auto'}. Idea: ${run.modelo_idea}, construye: ${run.modelo_construir}. Variantes ${run.paralelo ? 'en paralelo' : 'en serie'}.${run.hallazgos.length ? ` Hallazgos para CONTEXTO: ${run.hallazgos.length}.` : ''}${run.note ? `\n${run.note}` : ''}`);
      print(PLUGGED_WARNING);
      return 0;
    }
    case 'prepare': {
      const r = await prepare(a, { out, force: !!flags.force, lenteBlind: flags['lente-blind'], lenteContext: flags['lente-context'], modelo: flags.modelo, modeloIdea: flags['modelo-idea'] });
      if (!r.before.ok && r.before.hint) print(r.before.hint);
      print({ round: r.round, MODELO_PARA_AGENT: r.model, MODELO_IDEA: r.model_idea, lentes: r.lenses, agent_model: r.agent_model, before: r.before.ok ? r.before.files : r.before.reason, prompts: r.prompts });
      return 0;
    }
    case 'run': {
      const timeoutMin = Number(flags['timeout-min']) || DEFAULTS.timeoutMin;
      if (flags.fondo) {
        const r = runInBackground(a, b || 'both', { out, timeoutMin, paralelo: !!flags.paralelo });
        print(`Variantes de la ronda ${a} corriendo en segundo plano (PID ${r.pid}). Ahora: node scripts/bold_rounds.js espera ${a}${out !== 'rounds' ? ` --out ${out}` : ''} (espera como máximo 4 min; repítelo hasta que diga "listo").\n${PLUGGED_WARNING}`);
        return 0;
      }
      print(await runHeadless(a, b || 'both', { out, timeoutMin, ...(flags.paralelo ? { paralelo: true } : {}) }));
      return 0;
    }
    case 'espera': {
      const r = await waitRun(a, { out, maxSec: Number(flags['max-seg']) || DEFAULTS.waitSec });
      const vs = Object.entries(r.status?.variantes || {}).map(([v, e]) => `${v}: ${e}`).join(', ') || 'arrancando';
      if (r.done) { print(`listo (${vs}). Sigue con: after ${a}`); return 0; }
      print(`sigue corriendo (${vs}). Vuelve a llamar: espera ${a}`);
      return 3;
    }
    case 'resumen': {
      const r = resumen({ out });
      print(`Resumen publicado: "${r.review.title}" (${r.review.items.length} láminas). Ábrelo con: node src/cockpit.js open ${r.review.id}`);
      return 0;
    }
    case 'after': {
      const r = await after(a, { out });
      for (const [v, c] of Object.entries(r.variants)) print(`${v}: ${c.rejected ? `RECHAZADA (${c.reason})` : 'ok'} | archivos: ${c.files_changed.length} | diff: ${JSON.stringify(c.ratios)}${c.shot_error ? ` | sin screenshots: ${c.shot_error}` : ''}`);
      if (Object.values(r.variants).some(c => c.shot_error === 'playwright')) print(INSTALL_HINT);
      return 0;
    }
    case 'review': {
      const r = review(a, { out, sprint: flags.sprint !== undefined ? Number(flags.sprint) : undefined });
      print(`Publicada "${r.review.title}" (${r.review.items.length} ítems; candidatas: ${r.candidates.join(', ') || 'ninguna'}). Ábrela con: node src/cockpit.js open ${r.review.id}`);
      return 0;
    }
    case 'choice': print(choice(a, { out })); return 0;
    case 'apply': {
      if (!b) throw new BoldError('Uso: apply <ronda> <blind|context|integrada>');
      const r = apply(a, b, {
        out, auto: !!flags.auto, force: !!flags.force,
        reason: typeof flags.razon === 'string' ? flags.razon : '', comment: typeof flags.comentario === 'string' ? flags.comentario : '',
      });
      print(`Variante ${b} de la ronda ${a} aplicada a ${r.working}. El original sigue intacto.${r.comment ? `\nComentario guardado para la variante con contexto: "${r.comment}"` : ''}${r.republished ? '\nLa razón de la elección quedó visible en la revisión del cockpit.' : ''}`);
      print(`Siguiente paso: ${nextAction(loadRun(out), out)}`);
      return 0;
    }
    case 'status': {
      const run = loadRun(out);
      print({ ...run, auto_streak: autoStreak(run), next_round: (run.history.at(-1)?.round || 0) + 1, siguiente_paso: nextAction(run, out) });
      return 0;
    }
    case 'changes': {
      const run = loadRun(out);
      if (run.kind === 'url') { print('El objetivo es una URL: no hay archivos locales que comparar.'); return 0; }
      const orig = run.kind === 'file' ? dirname(run.target) : run.target;
      const files = changedFiles(orig, runPaths(out).working).filter(f => run.kind !== 'file' || f === run.entry);
      print(files.length ? `Archivos que cambiarían en el original:\n${files.map(f => `- ${f}`).join('\n')}` : 'Sin diferencias con el original.');
      return 0;
    }
    case 'shot': {
      if (!a || !b) throw new BoldError('Uso: shot <carpeta|archivo|url> <prefijo>');
      const r = await takeShots(a, b);
      if (!r.ok) { print(r.hint || `Sin screenshots: ${r.reason}`); return r.reason === 'playwright' ? 3 : 1; }
      print(r.files);
      return 0;
    }
    case 'diff': {
      if (!a || !b) throw new BoldError('Uso: diff <antes.png> <despues.png>');
      const r = pixelDiff(readFileSync(a), readFileSync(b));
      const th = Number(flags.threshold) || DEFAULTS.threshold;
      print({ ...r, ratio: Number(r.ratio.toFixed(5)), visible_change: r.ratio >= th, threshold: th });
      return 0;
    }
    default:
      print(USAGE);
      return cmd ? 1 : 0;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cli(process.argv.slice(2)).then(code => process.exit(code), e => {
    console.error(e instanceof BoldError ? e.message : (e && e.stack) || String(e));
    process.exit(1);
  });
}
