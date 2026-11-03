// bold-rounds.test.js
// Tests de scripts/bold_rounds.js (/bold-rounds). Sin red, sin LLM y sin Playwright real:
// los screenshots se simulan con un launcher falso que escribe PNGs generados.
// Valida: init no toca el original, el diff distingue igual vs. distinto, la forma
// del JSON de revisión (kind "rounds"), apply promueve la variante, la pausa de control
// y la lectura del voto. Idioma: español neutro.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  init, prepare, after, apply, buildRoundReview, review, choiceFromFeedback, pixelDiff,
  encodePNG, decodePNG, takeShots, autoStreak, loadRun, buildPrompt, CORE_PROMPT, BoldError,
  changedRegions, labelRegion, parseNotes, realChangeRatio,
} from './scripts/bold_rounds.js';
import { validateReview, getReview, reviewWarnings, saveFeedback } from './src/cockpit.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const firstLabelWords = s => String(s).trim().split(/\s+/).length;

const sha = p => createHash('sha1').update(readFileSync(p)).digest('hex');

function solid(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
  return buf;
}

// Launcher falso: el "screenshot" es un PNG cuyo color depende del contenido del HTML.
function fakeLauncher() {
  return async () => ({
    async newContext() {
      let url = '';
      return {
        async newPage() {
          return {
            async goto(u) { url = u; },
            async waitForTimeout() {},
            async screenshot({ path }) {
              const html = readFileSync(new URL(url), 'utf8');
              const hex = createHash('sha1').update(html).digest();
              writeFileSync(path, encodePNG(20, 20, solid(20, 20, [hex[0], hex[1], hex[2]])));
            },
          };
        },
        async close() {},
      };
    },
    async close() {},
  });
}
const shots = (target, prefix, opts) => takeShots(target, prefix, { ...opts, launcher: fakeLauncher() });

const ROOT = mkdtempSync(join(tmpdir(), 'bold-rounds-'));
const SITE = join(ROOT, 'sitio');
const OUT = join(ROOT, 'rounds');
mkdirSync(join(SITE, 'node_modules', 'x'), { recursive: true });
mkdirSync(join(SITE, 'css'), { recursive: true });
writeFileSync(join(SITE, 'index.html'), '<h1>Café</h1><a href="#">pedidos</a>');
writeFileSync(join(SITE, 'css', 'a.css'), 'h1{color:red}');
writeFileSync(join(SITE, 'node_modules', 'x', 'big.js'), 'x');
const origHash = sha(join(SITE, 'index.html'));
const origMtime = statSync(join(SITE, 'index.html')).mtimeMs;

try {
  await check('PNG: encode/decode ida y vuelta', () => {
    const img = decodePNG(encodePNG(3, 2, solid(3, 2, [10, 200, 30])));
    assert(img.width === 3 && img.height === 2, 'tamaño');
    assert(img.data[0] === 10 && img.data[1] === 200 && img.data[2] === 30 && img.data[3] === 255, 'color');
  });

  await check('diff: imágenes idénticas → 0', () => {
    const a = encodePNG(10, 10, solid(10, 10, [1, 2, 3]));
    assert(pixelDiff(a, Buffer.from(a)).ratio === 0, 'debió ser 0');
  });

  await check('diff: imagen cambiada → ratio > 0; ruido bajo la tolerancia → 0', () => {
    const a = encodePNG(10, 10, solid(10, 10, [0, 0, 0]));
    const half = solid(10, 10, [0, 0, 0]);
    for (let i = 0; i < 50; i++) half[i * 4] = 255;
    assert(Math.abs(pixelDiff(a, encodePNG(10, 10, half)).ratio - 0.5) < 1e-9, 'debió ser 0.5');
    assert(pixelDiff(a, encodePNG(10, 10, solid(10, 10, [5, 5, 5]))).ratio === 0, 'ruido mínimo no cuenta');
    assert(pixelDiff(a, encodePNG(10, 20, solid(10, 20, [0, 0, 0]))).ratio === 0.5, 'alto distinto cuenta como cambio');
  });

  // Lienzo de prueba: rectángulos de color sobre un fondo.
  function canvas(w, h, bg, rects = []) {
    const buf = solid(w, h, bg);
    for (const { x, y, w: rw, h: rh, c } of rects) {
      for (let py = y; py < y + rh; py++) {
        for (let px = x; px < x + rw; px++) {
          const i = (py * w + px) * 4;
          buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
        }
      }
    }
    return { width: w, height: h, data: buf };
  }
  const WHITE = [255, 255, 255];
  const RED = [220, 30, 30];
  const BLUE = [20, 40, 200];

  await check('hotspots: imágenes iguales no marcan ninguna zona', () => {
    const a = canvas(300, 300, WHITE, [{ x: 10, y: 10, w: 50, h: 50, c: RED }]);
    assert(changedRegions(a, a).length === 0, 'debió ser vacío');
  });

  await check('hotspots: un bloque nuevo da una zona con su caja, en coordenadas 0..1', () => {
    const a = canvas(600, 600, WHITE);
    const b = canvas(600, 600, WHITE, [{ x: 120, y: 240, w: 240, h: 120, c: RED }]);
    const r = changedRegions(a, b);
    assert(r.length === 1, `zonas: ${r.length}`);
    const near = (v, e) => Math.abs(v - e) < 0.03;
    assert(near(r[0].x, 0.2) && near(r[0].y, 0.4) && near(r[0].w, 0.4) && near(r[0].h, 0.2), JSON.stringify(r[0]));
  });

  await check('hotspots: dos cambios lejanos son dos zonas, en orden de lectura', () => {
    const a = canvas(600, 600, WHITE);
    const b = canvas(600, 600, WHITE, [{ x: 300, y: 450, w: 200, h: 100, c: BLUE }, { x: 40, y: 40, w: 200, h: 100, c: RED }]);
    const r = changedRegions(a, b);
    assert(r.length === 2 && r[0].y < r[1].y, JSON.stringify(r));
  });

  await check('hotspots: respeta el máximo y descarta líneas finas', () => {
    const a = canvas(600, 900, WHITE);
    const rects = [0, 1, 2, 3, 4, 5, 6].map(i => ({ x: 40, y: 20 + i * 120, w: 200, h: 80, c: RED }));
    assert(changedRegions(a, canvas(600, 900, WHITE, rects), { maxRegions: 3 }).length === 3, 'máximo');
    assert(changedRegions(a, canvas(600, 900, WHITE, [{ x: 0, y: 300, w: 600, h: 2, c: RED }])).length === 0, 'una línea no es zona');
  });

  await check('hotspots: lo que solo se corrió hacia abajo no cuenta como cambio', () => {
    const rows = [0, 1, 2, 3].map(i => ({ x: 40, y: 100 + i * 100, w: 200, h: 40, c: BLUE }));
    const a = canvas(400, 600, WHITE, rows);
    const moved = rows.map(r => ({ ...r, y: r.y + 80 }));
    const b = canvas(400, 680, WHITE, [{ x: 20, y: 10, w: 300, h: 50, c: RED }, ...moved]);
    const r = changedRegions(a, b);
    assert(r.length === 1 && r[0].y < 0.1, JSON.stringify(r));
    assert(realChangeRatio(a, b) < 0.1, `ratio ${realChangeRatio(a, b)}`);
  });

  await check('hotspots: un rediseño total se divide en bloques en vez de una caja gigante', () => {
    const a = canvas(600, 900, [250, 240, 200]);
    // Mismo fondo nuevo en toda la página, con contenido solo en tres bloques.
    const blocks = [{ x: 40, y: 40, w: 300, h: 90 }, { x: 40, y: 380, w: 300, h: 90 }, { x: 40, y: 720, w: 300, h: 90 }].map(r => ({ ...r, c: WHITE }));
    const r = changedRegions(a, canvas(600, 900, [30, 20, 15], blocks));
    assert(r.length === 3, `zonas: ${JSON.stringify(r)}`);
    for (const z of r) assert(z.w * z.h < 0.2, 'zona demasiado grande');
  });

  await check('hotspots: el nombre sale del texto más grande, sin precios ni palabras colgando', () => {
    const region = { x: 0, y: 0, w: 1, h: 0.5 };
    const blocks = [
      { tag: 'td', text: '$2.800', x: 10, y: 10, w: 50, h: 20, fs: 40 },
      { tag: 'p', text: 'texto chico', x: 10, y: 60, w: 50, h: 20, fs: 12 },
      { tag: 'h1', text: 'Pide tu café para llevar hoy mismo', x: 10, y: 100, w: 400, h: 60, fs: 36 },
    ];
    assert(labelRegion(region, blocks, 800, 1000) === 'Pide tu café para llevar', labelRegion(region, blocks, 800, 1000));
    const hanging = labelRegion(region, [{ tag: 'p', text: 'Café de grano tostado en casa', x: 10, y: 10, w: 100, h: 20, fs: 16 }], 800, 1000);
    assert(hanging === 'Café de grano tostado', hanging);
    const label = labelRegion({ x: 0, y: 0.8, w: 1, h: 0.1 }, [], 800, 1000);
    assert(label === 'Zona inferior', label);
    assert(labelRegion(region, [{ tag: 'img', text: '', x: 10, y: 10, w: 100, h: 100, fs: 0 }], 800, 1000) === 'Imagen nueva', 'imagen');
    for (const b of blocks) assert(firstLabelWords(labelRegion(region, [b], 800, 1000)) <= 5, 'máximo 5 palabras');
  });

  await check('notes.md: lee titular, categoría y una línea por cambio', () => {
    const n = parseNotes('# Ronda 1\nTitular: Pedir es lo primero\nCategoría: jerarquía\nCambio 1: Botón grande\nCambio 2: Menos texto\nPor qué: vende más');
    assert(n.titular === 'Pedir es lo primero' && n.categoria === 'jerarquía', JSON.stringify(n));
    assert(n.cambios.join('|') === 'Botón grande|Menos texto', n.cambios.join('|'));
    assert(parseNotes('solo texto').titular === '', 'sin titular');
  });

  await check('init: copia sin node_modules y no toca el original', async () => {
    const run = await init(SITE, { out: OUT, rounds: 3, pauseEvery: 2, goal: 'más pedidos' });
    assert(run.kind === 'folder' && run.entry === 'index.html' && run.web, 'run.json incorrecto');
    assert(existsSync(join(OUT, 'working', 'css', 'a.css')), 'faltó copiar css/');
    assert(!existsSync(join(OUT, 'working', 'node_modules')), 'copió node_modules');
    assert(existsSync(join(OUT, 'DESIGN.md')), 'falta DESIGN.md');
    let threw = false;
    try { await init(SITE, { out: OUT }); } catch (e) { threw = e instanceof BoldError; }
    assert(threw, 'un segundo init en la misma carpeta debe fallar');
  });

  await check('prepare: copias blind/context, "antes" y prompts (ciego sin historia)', async () => {
    const r = await prepare(1, { out: OUT, shots, root: ROOT });
    assert(r.before.ok, 'sin screenshots antes');
    for (const v of ['blind', 'context']) assert(existsSync(join(OUT, '001', v, 'index.html')), `falta ${v}`);
    const blind = readFileSync(r.prompts.blind, 'utf8');
    const ctx = readFileSync(r.prompts.context, 'utf8');
    assert(blind.includes(CORE_PROMPT) && ctx.includes(CORE_PROMPT), 'falta el prompt literal');
    assert(!blind.includes('DESIGN.md') && ctx.includes('DESIGN.md'), 'el ciego no debe recibir DESIGN.md; el de contexto sí');
  });

  // Simula las variantes: blind cambia algo visible, context no cambia nada.
  writeFileSync(join(OUT, '001', 'blind', 'index.html'), '<h1 style="font-size:90px">Café</h1><a href="#">Pide ahora</a>');
  writeFileSync(join(OUT, '001', 'blind', 'notes.md'), '# Ronda 1 — variante blind\nCategoría: jerarquía\n');
  writeFileSync(join(OUT, '001', 'context', 'notes.md'), '# Ronda 1 — variante context\nCategoría: color\n');

  await check('after: rechaza la variante sin cambio visible', async () => {
    const r = await after(1, { out: OUT, shots });
    assert(!r.variants.blind.rejected, 'blind debió pasar');
    assert(r.variants.blind.files_changed.includes('index.html'), 'blind: archivo cambiado');
    assert(r.variants.blind.ratios.desktop > 0, 'blind: diff > 0');
    assert(r.variants.context.rejected && r.variants.context.files_changed.length === 0, 'context debió rechazarse');
  });

  await check('review: JSON kind "rounds" válido, media relativa, sin "elegir" si una falla', () => {
    const rv = buildRoundReview(1, { out: OUT, root: ROOT });
    validateReview(JSON.parse(JSON.stringify(rv)));
    assert(rv.kind === 'rounds', 'kind');
    assert(rv.items.map(i => i.id).join(',') === 'blind,context', `ítems: ${rv.items.map(i => i.id)}`);
    const blind = rv.items[0];
    assert(blind.media.includes('rounds/001/shots/before-desktop.png') && blind.media.includes('rounds/001/shots/blind-mobile.png'), `media: ${blind.media}`);
    assert(rv.items[1].tags.includes('rechazada'), 'context debe ir marcada como rechazada');
    const pub = review(1, { out: OUT, root: ROOT });
    assert(getReview(pub.review.id, ROOT), 'no quedó publicada en cockpit/reviews');
  });

  await check('review: cada variante es un antes/después con hotspots, en escritorio y celular', () => {
    const blind = buildRoundReview(1, { out: OUT, root: ROOT }).items[0];
    const v = blind.visual;
    assert(v.type === 'before_after' && v.before === 'rounds/001/shots/before-desktop.png' && v.after === 'rounds/001/shots/blind-desktop.png', JSON.stringify(v));
    assert(v.views.map(x => x.device).join(',') === 'desktop,mobile', 'vistas');
    assert(v.hotspots.length >= 1 && v.hotspots.every(h => h.label && h.label.split(/\s+/).length <= 5), JSON.stringify(v.hotspots));
    assert(blind.headline && blind.headline.split(/\s+/).length <= 10, blind.headline);
    assert(blind.stats.length >= 1, 'sin números');
  });

  await check('review: con ambas válidas agrega "elegir" (compare) y no avisa nada', async () => {
    writeFileSync(join(OUT, '001', 'context', 'index.html'), '<h1>Café</h1><a href="#" style="background:#000">pedidos</a>');
    await after(1, { out: OUT, shots });
    const rv = buildRoundReview(1, { out: OUT, root: ROOT });
    assert(rv.items.map(i => i.id).join(',') === 'blind,context,elegir', `ítems: ${rv.items.map(i => i.id)}`);
    const cmp = rv.items[2].visual;
    assert(cmp.type === 'compare' && cmp.options.map(o => o.item).join(',') === 'blind,context,integrar', JSON.stringify(cmp.options));
    assert(cmp.options[0].image === 'rounds/001/shots/blind-desktop.png' && cmp.options[0].image_mobile === 'rounds/001/shots/blind-mobile.png', 'imágenes');
    assert(cmp.options[2].images.length === 2, 'integrar muestra ambas');
    assert(reviewWarnings(validateReview(JSON.parse(JSON.stringify(rv)))).length === 0, 'la revisión de rondas debe ser visual');
    review(1, { out: OUT, root: ROOT });
  });

  await check('elegir "integrar" se guarda aunque no sea un ítem, y choice lo lee', () => {
    const id = buildRoundReview(1, { out: OUT, root: ROOT }).id;
    const { feedback } = saveFeedback(id, { items: { integrar: { vote: 'up', comment: '' }, inventado: { vote: 'up' } } }, ROOT);
    assert(feedback.items.integrar.vote === 'up' && !feedback.items.inventado, JSON.stringify(feedback.items));
    assert(choiceFromFeedback(feedback) === 'integrar', 'choice');
    rmSync(join(ROOT, 'cockpit', 'feedback', `${id}.json`));
  });

  await check('choice: lee el voto', () => {
    assert(choiceFromFeedback(null) === null, 'sin feedback');
    assert(choiceFromFeedback({ items: { blind: { vote: 'up' }, context: { vote: 'down' } } }) === 'blind', 'blind');
    assert(choiceFromFeedback({ items: { blind: { vote: 'up' }, context: { vote: 'up' } } }) === 'integrar', 'ambas');
    assert(choiceFromFeedback({ items: { integrar: { vote: 'up' } } }) === 'integrar', 'integrar');
  });

  await check('apply: promueve la variante a working/ sin notes.md y sin tocar el original', () => {
    apply(1, 'blind', { out: OUT });
    const w = readFileSync(join(OUT, 'working', 'index.html'), 'utf8');
    assert(w.includes('Pide ahora'), 'working no tiene la variante');
    assert(!existsSync(join(OUT, 'working', 'notes.md')), 'notes.md no debe pasar a working');
    assert(existsSync(join(OUT, 'working', 'css', 'a.css')), 'perdió archivos no cambiados');
    assert(sha(join(SITE, 'index.html')) === origHash && statSync(join(SITE, 'index.html')).mtimeMs === origMtime, 'el original cambió');
    assert(loadRun(OUT).history[0].variant === 'blind', 'historia');
  });

  await check('apply: rechaza variantes rechazadas salvo --force', async () => {
    writeFileSync(join(OUT, '001', 'context', 'index.html'), readFileSync(join(OUT, 'working', 'index.html')));
    await after(1, { out: OUT, shots });
    let threw = false;
    try { apply(1, 'context', { out: OUT }); } catch { threw = true; }
    assert(threw, 'debió negarse');
  });

  await check('prompt de contexto incluye la historia y el feedback del usuario', async () => {
    mkdirSync(join(ROOT, 'cockpit', 'feedback'), { recursive: true });
    const id = buildRoundReview(1, { out: OUT, root: ROOT }).id;
    writeFileSync(join(ROOT, 'cockpit', 'feedback', `${id}.json`), JSON.stringify({ review_id: id, processed: false, items: { blind: { vote: 'up', comment: 'me gusta el botón grande' } }, conversation: [], summary: null }));
    const p = buildPrompt('context', { run: loadRun(OUT), out: OUT, n: 2, root: ROOT });
    assert(p.includes('chosen: blind') && p.includes('me gusta el botón grande'), 'falta historia/feedback');
    assert(!buildPrompt('blind', { run: loadRun(OUT), out: OUT, n: 2, root: ROOT }).includes('me gusta'), 'el ciego no debe ver feedback');
  });

  await check('pausa de control y tope de rondas', async () => {
    const run = loadRun(OUT);
    run.history = [{ round: 1, variant: 'blind', auto: true }, { round: 2, variant: 'blind', auto: true }];
    writeFileSync(join(OUT, 'run.json'), JSON.stringify(run));
    assert(autoStreak(loadRun(OUT)) === 2, 'racha');
    let msg = '';
    try { await prepare(3, { out: OUT, shots, root: ROOT }); } catch (e) { msg = e.message; }
    assert(/Pausa de control/.test(msg), `esperaba pausa, obtuve: ${msg}`);
    msg = '';
    try { await prepare(4, { out: OUT, shots, root: ROOT, force: true }); } catch (e) { msg = e.message; }
    assert(/Tope/.test(msg), `esperaba tope, obtuve: ${msg}`);
  });

  await check('sin Playwright: takeShots devuelve la instrucción de instalación', async () => {
    const r = await takeShots(SITE, join(ROOT, 'x', 'y'), { launcher: async () => null });
    assert(!r.ok && r.reason === 'playwright' && /npm install/.test(r.hint), 'debió dar el comando de instalación');
  });
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

console.log(`\n${passed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
