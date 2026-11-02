// scripts/bold_rounds.js
// Helper de /bold-rounds: mejora audaz por rondas sobre una COPIA del objetivo.
// Cada ronda corre dos variantes (ciega y con contexto), saca screenshots antes/después,
// descarta las que no cambian nada visible y publica la comparación en el cockpit.
// El objetivo original NUNCA se modifica desde este script.
//
// Uso (desde la raíz del proyecto):
//   node scripts/bold_rounds.js init <carpeta|archivo|url> [--rounds 5] [--pause-every 3] [--out rounds] [--goal "texto"]
//   node scripts/bold_rounds.js prepare <ronda> [--force]       (copias blind/context + "antes" + prompts)
//   node scripts/bold_rounds.js run <ronda> [blind|context|both] [--timeout-min 15]   (headless `claude -p`)
//   node scripts/bold_rounds.js after <ronda>                   (screenshots "después" + diff + rechazo)
//   node scripts/bold_rounds.js review <ronda>                  (publica la revisión kind "rounds" en el cockpit)
//   node scripts/bold_rounds.js choice <ronda>                  (lee los votos del cockpit)
//   node scripts/bold_rounds.js apply <ronda> <blind|context|integrada> [--auto]
//   node scripts/bold_rounds.js status | changes
//   node scripts/bold_rounds.js shot <carpeta|archivo|url> <prefijo>
//   node scripts/bold_rounds.js diff <antes.png> <despues.png>
//
// Sin dependencias obligatorias: el PNG se decodifica con zlib. Playwright es opcional
// (solo para screenshots) y se carga dinámicamente.
// Idioma: español neutro.

import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { publishReview, getFeedback, resolveRoot, isSafeMediaPath } from '../src/cockpit.js';

export const DEFAULTS = { rounds: 5, maxRounds: 10, pauseEvery: 3, threshold: 0.005, timeoutMin: 15 };
export const VARIANTS = ['blind', 'context', 'integrada'];
export const CATEGORIES = ['composición', 'tipografía', 'color', 'imágenes', 'interacción', 'jerarquía', 'mobile'];
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};
const SKIP = new Set(['node_modules', '.git', 'rounds', '.next', 'dist', '.cache']);
const NOTES = 'notes.md';

// El prompt literal del usuario (demo del café de los 90). Va en inglés: es instrucción de sistema.
export const CORE_PROMPT = 'Look at the site first. Then innovate: think about the user experience and think outside the box. Make one bold change that improves conversions or the look and feel, not a small tweak. Use any tool you have. You must ship a change every time.';

export class BoldError extends Error {}

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
  cpSync(src, dst, {
    recursive: true,
    filter: p => {
      const abs = resolve(p);
      if (abs === resolve(src)) return true;
      if (skipAbs.some(s => abs === s || abs.startsWith(s + sep))) return false;
      return !SKIP.has(basename(p));
    },
  });
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

async function defaultLauncher() {
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

/**
 * Saca <prefix>-desktop.png y <prefix>-mobile.png. `target` = carpeta, archivo o URL.
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
  };
}

export function loadRun(out) {
  const p = runPaths(out);
  if (!existsSync(p.run)) throw new BoldError(`No hay corrida en ${p.dir}. Empieza con: node scripts/bold_rounds.js init <objetivo>`);
  return readJSON(p.run);
}
const saveRun = (out, run) => writeJSON(runPaths(out).run, run);

const DESIGN_TEMPLATE = goal => `# DESIGN.md — dirección corta (máx. 15 líneas)

Objetivo: ${goal}

## Dirección
- (se completa tras la ronda 1 con lo que el usuario eligió)

## Restricciones anti-slop
- Nada de degradados por defecto, todo en "píldoras" ni grillas de tarjetas iguales (card soup).
- Paleta limitada: 3-4 colores + neutros. Copy real, sin lorem ipsum.
- Cada cambio nombra 1-2 referencias concretas (estudio, diseñador, publicación o movimiento).

## Aprendido de las rondas
- (vacío)
`;

/** Crea la copia de trabajo. Nunca escribe en el objetivo original. */
export async function init(target, { out = 'rounds', rounds = DEFAULTS.rounds, pauseEvery = DEFAULTS.pauseEvery, goal } = {}) {
  const p = runPaths(out);
  if (existsSync(p.run)) throw new BoldError(`Ya hay una corrida en ${p.dir}. Usa otro --out o borra esa carpeta.`);
  const maxRounds = Math.min(Math.max(1, parseInt(rounds, 10) || DEFAULTS.rounds), DEFAULTS.maxRounds);
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
    created_at: new Date().toISOString(),
    max_rounds: maxRounds, pause_every: Math.max(1, parseInt(pauseEvery, 10) || DEFAULTS.pauseEvery),
    threshold: DEFAULTS.threshold, history: [], note,
  };
  saveRun(out, run);
  if (!existsSync(p.design)) writeFileSync(p.design, DESIGN_TEMPLATE(run.goal), 'utf8');
  return run;
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

export function buildPrompt(variant, { run, out, n, root, beforeShots = [] }) {
  const dir = roundPaths(out, n).variant(variant);
  const parts = [
    `You are the ${variant.toUpperCase()} variant of round ${n} of a "bold rounds" improvement loop.`,
    `Objective: ${run.goal}`,
    `Working folder (the ONLY place you may write): ${dir}`,
    `Entry file: ${run.entry || '(find the main file)'}`,
    '',
    'Core instruction from the user (follow it literally; if the target is not a website, read "site" as the document or project):',
    `"${CORE_PROMPT}"`,
    '',
    'Rules:',
    `1. Look first: read the entry file completely${beforeShots.length ? ` and view these screenshots of the current state: ${beforeShots.join(', ')}` : ''}.`,
    `2. Make ONE bold change inside exactly one category: ${CATEGORIES.join(', ')}. It must be visible to a user at first glance (desktop or mobile). Refactors, cleanup or small tweaks do not count: a pixel diff rejects rounds without a visible change.`,
    '3. Anti-slop: no default purple/blue gradients, no pill-shaped everything, no "card soup" (grids of identical rounded cards), a limited palette (3-4 colors plus neutrals), real copy (no lorem ipsum). Name 1-2 concrete references (designer, studio, publication or movement) that inspired the change.',
    '4. Keep facts truthful: do not invent prices, addresses, phone numbers or claims that are not in the original. You may rewrite, reorder and cut copy.',
    '5. Self-contained: no external network assets and no paid APIs. Inline CSS/SVG or local files only.',
    '6. Never write outside the working folder. No git commands.',
    '7. All user-facing text (page copy and notes.md) in neutral Spanish with "tú". Never voseo ("vos", "tenés", "podés", "decime").',
    `8. When done, write ${NOTES} in the working folder, in Spanish, with exactly these lines:`,
    `   # Ronda ${n} — variante ${variant}`,
    `   Categoría: <one of: ${CATEGORIES.join(' | ')}>`,
    '   Qué cambió: <1-3 sentences>',
    '   Por qué: <how it improves conversion or look and feel>',
    '   Referencias: <1-2 named references>',
    '   Riesgo: <what could go wrong>',
    '9. Reply with one line: the category and a one-sentence summary.',
  ];
  if (variant === 'blind') {
    parts.push('', 'You have NO history on purpose: judge only what you see now. Do not read other folders of this loop.');
  } else {
    const design = existsSync(runPaths(out).design) ? readFileSync(runPaths(out).design, 'utf8') : '';
    parts.push('',
      'You are the CONTEXT variant: build on what was learned. Respect the user feedback below; it outranks your taste.',
      'Avoid repeating a category used in the last 2 rounds unless the user asked for it.', '',
      '## DESIGN.md', clipText(design, 2000), '',
      '## Previous rounds and user feedback', clipText(buildHistory(out, run, n, root), 4000));
  }
  return parts.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Pasos de la ronda
// ---------------------------------------------------------------------------

export async function prepare(n, { out = 'rounds', force = false, shots = takeShots, root } = {}) {
  const run = loadRun(out);
  n = parseInt(n, 10);
  if (!(n >= 1)) throw new BoldError('Ronda inválida');
  if (n > run.max_rounds) throw new BoldError(`Tope alcanzado: max_rounds=${run.max_rounds}. Sube el tope solo si el usuario lo pide.`);
  if (!force && n > 1 && !run.history.some(h => h.round === n - 1)) {
    throw new BoldError(`La ronda ${n - 1} aún no tiene variante aplicada. Primero: apply ${n - 1} <variante>`);
  }
  if (!force && autoStreak(run) >= run.pause_every) {
    throw new BoldError(`Pausa de control: ${autoStreak(run)} rondas seguidas sin decisión humana (pause_every=${run.pause_every}). Pide al usuario que vote en el cockpit.`);
  }
  const rp = roundPaths(out, n);
  const wp = runPaths(out).working;
  for (const v of ['blind', 'context']) { emptyDir(rp.variant(v)); copyTree(wp, rp.variant(v)); }
  let before = { ok: false, reason: 'no-web' };
  if (run.web) before = await shots(wp, join(rp.shots, 'before'), { entry: run.entry });
  const beforeShots = before.ok ? Object.values(before.files) : [];
  for (const v of ['blind', 'context']) {
    writeFileSync(rp.prompt(v), buildPrompt(v, { run, out, n, root, beforeShots }), 'utf8');
  }
  return { round: n, dir: rp.dir, before, prompts: { blind: rp.prompt('blind'), context: rp.prompt('context') } };
}

/** Screenshots "después", diff contra "antes" y rechazo si no hay cambio visible. */
export async function after(n, { out = 'rounds', shots = takeShots } = {}) {
  const run = loadRun(out);
  const rp = roundPaths(out, n);
  const wp = runPaths(out).working;
  const result = { round: n, threshold: run.threshold, variants: {} };
  for (const v of VARIANTS) {
    const vd = rp.variant(v);
    if (!existsSync(vd)) continue;
    const files = changedFiles(wp, vd);
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
    r.rejected = !r.visible;
    r.reason = !files.length ? 'no cambió ningún archivo' : !r.visible ? `cambio no visible (diff < ${run.threshold * 100}%)` : '';
    result.variants[v] = r;
  }
  writeJSON(rp.check, result);
  return result;
}

export const reviewId = (run, n) => `rounds-${run.slug}-${pad(n)}`;
const LABEL = { blind: 'ciega (sin memoria)', context: 'con contexto', integrada: 'integrada' };

function mediaPath(abs, root) {
  const rel = toPosix(relative(resolveRoot(root), abs));
  if (!isSafeMediaPath(rel)) throw new BoldError(`La carpeta de rondas debe estar dentro del proyecto (sin carpetas ocultas) para que el cockpit muestre la media: ${rel}`);
  return rel;
}

/** Arma el JSON de la revisión (kind "rounds"). Puro: no publica. */
export function buildRoundReview(n, { out = 'rounds', root } = {}) {
  const run = loadRun(out);
  const rp = roundPaths(out, n);
  if (!existsSync(rp.check)) throw new BoldError(`Falta ${rp.check}. Corre primero: after ${n}`);
  const check = readJSON(rp.check);
  const shot = name => { const p = join(rp.shots, `${name}.png`); return existsSync(p) ? [mediaPath(p, root)] : []; };
  const items = [];
  const ok = [];
  for (const v of ['blind', 'context', 'integrada']) {
    const c = check.variants[v];
    if (!c) continue;
    const notesP = join(rp.variant(v), NOTES);
    const notes = existsSync(notesP) ? readFileSync(notesP, 'utf8').trim() : '(la variante no dejó notes.md)';
    const ratios = Object.entries(c.ratios).map(([k, x]) => `${k} ${(x * 100).toFixed(1)}%`).join(', ');
    const media = [...shot('before-desktop'), ...shot(`${v}-desktop`), ...shot('before-mobile'), ...shot(`${v}-mobile`)];
    if (run.web && run.entry && existsSync(join(rp.variant(v), run.entry)) && /\.html?$/i.test(run.entry)) media.push(mediaPath(join(rp.variant(v), run.entry), root));
    if (!c.rejected) ok.push(v);
    items.push({
      id: v,
      title: `Ronda ${n} · Variante ${LABEL[v]}${c.rejected ? ' · RECHAZADA' : ''}`,
      body_md: [
        notes, '',
        `**Archivos cambiados:** ${c.files_changed.length ? c.files_changed.join(', ') : 'ninguno'}`,
        ratios ? `**Diferencia visual vs. antes:** ${ratios}` : '',
        c.rejected ? `**Rechazada automáticamente:** ${c.reason}.` : '',
        'Imágenes: antes y después en escritorio, luego antes y después en celular.',
      ].filter(Boolean).join('\n'),
      media,
      tags: [v, c.rejected ? 'rechazada' : 'candidata'],
    });
  }
  if (ok.includes('blind') && ok.includes('context') && !check.variants.integrada) {
    items.push({
      id: 'integrar',
      title: `Ronda ${n} · Integrar ambas`,
      body_md: 'Propuesta: combinar lo mejor de la variante ciega y la de contexto en una sola versión. Si votas a favor, dime en el comentario qué tomar de cada una; Claude arma la versión integrada y te la muestra antes de seguir.',
      media: [...shot('blind-desktop'), ...shot('context-desktop')],
      tags: ['integrar'],
    });
  }
  return {
    id: reviewId(run, n),
    title: `Bold rounds · ${run.slug} · ronda ${n} de ${run.max_rounds}`,
    kind: 'rounds',
    connects_to: n > 1 ? [reviewId(run, n - 1)] : [],
    context_brief: [
      `Objetivo: ${run.goal}. Se trabaja sobre una COPIA; el original no se toca hasta que el usuario diga "aplicar".`,
      'Cada ronda corre dos variantes en paralelo: la ciega no sabe nada de rondas anteriores (para innovar sin sesgo); la de contexto conoce las rondas previas y el feedback del usuario.',
      'Pide al usuario que vote a favor de UNA opción (ciega, contexto o integrar). La elegida se convierte en la base de la ronda siguiente. Las rechazadas no cambiaron nada visible.',
    ].join(' '),
    items,
  };
}

export function review(n, { out = 'rounds', root } = {}) {
  const r = buildRoundReview(n, { out, root });
  const res = publishReview(r, root);
  return { ...res, candidates: r.items.filter(i => !i.tags.includes('rechazada')).map(i => i.id) };
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

export function choice(n, { out = 'rounds', root } = {}) {
  const run = loadRun(out);
  const fb = getFeedback(reviewId(run, n), root);
  return { review_id: reviewId(run, n), has_feedback: !!fb, choice: choiceFromFeedback(fb) };
}

/** Promueve una variante a la copia de trabajo. El objetivo original no se toca. */
export function apply(n, variant, { out = 'rounds', auto = false, force = false } = {}) {
  if (variant === 'integrar') variant = 'integrada';
  if (!VARIANTS.includes(variant)) throw new BoldError(`Variante inválida: ${variant} (usa blind | context | integrada)`);
  const run = loadRun(out);
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
  run.history = run.history.filter(h => h.round !== Number(n));
  run.history.push({ round: Number(n), variant, auto: !!auto, at: new Date().toISOString() });
  run.history.sort((a, b) => a.round - b.round);
  saveRun(out, run);
  return { working: wp, history: run.history };
}

/** Lanza variantes con `claude -p` headless (modo desatendido). */
export function runHeadless(n, which = 'both', { out = 'rounds', timeoutMin = DEFAULTS.timeoutMin, bin = 'claude' } = {}) {
  const rp = roundPaths(out, n);
  const list = which === 'both' ? ['blind', 'context'] : [which];
  return Promise.all(list.map(v => new Promise(res => {
    const prompt = readFileSync(rp.prompt(v), 'utf8');
    // El prompt va por stdin (evita el límite y las comillas de la línea de comandos de Windows).
    // Un solo string con shell: en Windows `claude` es un .cmd y no se puede lanzar sin shell.
    const cmd = [bin, '-p', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep',
      '--add-dir', `"${rp.shots}"`, '--max-turns', '40', '--output-format', 'text'].join(' ');
    const t0 = Date.now();
    const child = spawn(cmd, { cwd: rp.variant(v), shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMin * 60000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); res({ variant: v, ok: false, error: e.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      writeFileSync(join(rp.dir, `log-${v}.txt`), `${stdout}\n--- stderr ---\n${stderr}`, 'utf8');
      res({ variant: v, ok: code === 0, code, secs: Math.round((Date.now() - t0) / 1000), reply: stdout.trim().split('\n').slice(-1)[0] });
    });
    child.stdin.end(prompt);
  })));
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
  prepare <ronda>          copias blind/ y context/, screenshots "antes" y prompts
  run <ronda> [both]       variantes con claude -p (desatendido)
  after <ronda>            screenshots "después" + diff + rechazo de cambios invisibles
  review <ronda>           publica la comparación en el cockpit
  choice <ronda>           lee el voto del usuario
  apply <ronda> <blind|context|integrada> [--auto]   promueve la variante a la copia de trabajo
  status | changes         estado de la corrida | archivos que difieren del original
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
      const run = await init(a, { out, rounds: flags.rounds || flags['max-rounds'], pauseEvery: flags['pause-every'], goal: flags.goal });
      print(`Copia de trabajo lista en ${runPaths(out).working} (original intacto). Rondas máx: ${run.max_rounds}, pausa cada ${run.pause_every}.${run.note ? `\n${run.note}` : ''}`);
      return 0;
    }
    case 'prepare': {
      const r = await prepare(a, { out, force: !!flags.force });
      if (!r.before.ok && r.before.hint) print(r.before.hint);
      print({ round: r.round, before: r.before.ok ? r.before.files : r.before.reason, prompts: r.prompts });
      return 0;
    }
    case 'run': print(await runHeadless(a, b || 'both', { out, timeoutMin: Number(flags['timeout-min']) || DEFAULTS.timeoutMin })); return 0;
    case 'after': {
      const r = await after(a, { out });
      for (const [v, c] of Object.entries(r.variants)) print(`${v}: ${c.rejected ? `RECHAZADA (${c.reason})` : 'ok'} | archivos: ${c.files_changed.length} | diff: ${JSON.stringify(c.ratios)}${c.shot_error ? ` | sin screenshots: ${c.shot_error}` : ''}`);
      if (Object.values(r.variants).some(c => c.shot_error === 'playwright')) print(INSTALL_HINT);
      return 0;
    }
    case 'review': {
      const r = review(a, { out });
      print(`Publicada "${r.review.title}" (${r.review.items.length} ítems; candidatas: ${r.candidates.join(', ') || 'ninguna'}). Ábrela con: node src/cockpit.js open ${r.review.id}`);
      return 0;
    }
    case 'choice': print(choice(a, { out })); return 0;
    case 'apply': {
      if (!b) throw new BoldError('Uso: apply <ronda> <blind|context|integrada>');
      const r = apply(a, b, { out, auto: !!flags.auto, force: !!flags.force });
      print(`Variante ${b} de la ronda ${a} aplicada a ${r.working}. El original sigue intacto.`);
      return 0;
    }
    case 'status': {
      const run = loadRun(out);
      print({ ...run, auto_streak: autoStreak(run), next_round: (run.history.at(-1)?.round || 0) + 1 });
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
