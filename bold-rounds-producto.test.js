// bold-rounds-producto.test.js
// Tests de modo producto, involucramiento, comentarios y corridas paralelas de
// scripts/bold_rounds.js. Sin red, sin LLM y sin Playwright real (launcher falso).
// Idioma: español neutro.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  init, prepare, after, apply, buildRoundReview, review, takeShots, encodePNG, loadRun, buildPrompt,
  parseInvolvement, parseMode, autoLimit, checkProductNotes, isAestheticCategory, parseNotes, nextAction,
  reviewId, feedbackComment, CORE_PROMPT, CATEGORIES, PRODUCT_CATEGORIES, AUTO_SAFETY_CAP, BoldError,
} from './scripts/bold_rounds.js';
import { validateReview, reviewWarnings, saveFeedback, getReview } from './src/cockpit.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
async function throwsLike(fn, re, msg) {
  let m = '';
  try { await fn(); } catch (e) { m = e.message; }
  assert(re.test(m), `${msg}: obtuve "${m}"`);
}

function solid(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
  return buf;
}
// Launcher falso: el color del "screenshot" depende SOLO del HTML de entrada.
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
              const hex = createHash('sha1').update(readFileSync(new URL(url), 'utf8')).digest();
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

const FULL_NOTES = v => [
  `# Ronda 1 — variante ${v}`,
  'Titular: Invitados suben fotos sin instalar nada',
  'Categoría: capacidad nueva',
  'Situación: invitado en la fiesta, celular en mano, hoy no sabe dónde mandar sus fotos',
  'Antes: las fotos quedaban dispersas en WhatsApp',
  'Ahora: escanea un QR y sube al álbum común en 2 toques',
  'Cómo probarlo: 1) abre index.html 2) toca "Subir fotos" 3) mira el álbum de ejemplo',
  'Señal de validación: 40% de invitados sube 3+ fotos durante la fiesta',
  'Depende de prueba real: que la señal del salón aguante',
  'Riesgo: invitados mayores no usan QR',
].join('\n');

const ROOT = mkdtempSync(join(tmpdir(), 'bold-producto-'));
const SITE = join(ROOT, 'sitio');
mkdirSync(SITE, { recursive: true });
writeFileSync(join(SITE, 'index.html'), '<h1>Weddi</h1><p>Fotos de tu matrimonio</p>');
const OUT = join(ROOT, 'rounds');

try {
  await check('involucramiento: auto, cada:N, todas, default e inválido', async () => {
    assert(parseInvolvement('auto').involucramiento === 'auto', 'auto');
    const c = parseInvolvement('cada:2');
    assert(c.involucramiento === 'cada:2' && c.pause_every === 2, JSON.stringify(c));
    assert(parseInvolvement('todas').involucramiento === 'todas', 'todas');
    assert(parseInvolvement(undefined, { pauseEvery: 4 }).involucramiento === 'cada:4', 'default = cada:pause-every');
    assert(parseInvolvement('cada:99').pause_every === 10, 'cada:N se limita a 10');
    await throwsLike(() => parseInvolvement('a veces'), /auto \| cada:N/, 'inválido');
    await throwsLike(() => parseMode('bonito'), /visual \| producto/, 'modo inválido');
    assert(parseMode(undefined) === 'visual', 'modo por defecto visual');
    assert(autoLimit({ involucramiento: 'auto', pause_every: 10 }) === AUTO_SAFETY_CAP, 'auto: tope de seguridad');
    assert(autoLimit({ involucramiento: 'todas', pause_every: 1 }) === 0, 'todas: Claude nunca elige');
    assert(autoLimit({ pause_every: 3 }) === 3, 'corridas viejas sin campo = cada:pause_every');
  });

  await check('notes en modo producto: campos obligatorios y categoría estética', () => {
    assert(checkProductNotes(FULL_NOTES('blind')).ok, 'notes completas deben pasar');
    const p = parseNotes(FULL_NOTES('blind'));
    assert(p.antes && p.ahora && p.como_probarlo && p.senal && p.situacion && p.depende, JSON.stringify(p));
    const sinAntes = checkProductNotes('Titular: X\nCategoría: capacidad nueva\nAhora: algo\nCómo probarlo: abre');
    assert(!sinAntes.ok && sinAntes.missing.includes('Antes'), JSON.stringify(sinAntes));
    const estetica = checkProductNotes(FULL_NOTES('blind').replace('Categoría: capacidad nueva', 'Categoría: tipografía'));
    assert(!estetica.ok && estetica.aesthetic, 'tipografía es estética');
    for (const c of ['color', 'layout', 'copy', 'jerarquía', 'Mejor look and feel']) assert(isAestheticCategory(c), `${c} debió ser estética`);
    for (const c of PRODUCT_CATEGORIES) assert(!isAestheticCategory(c), `${c} no es estética`);
    assert(checkProductNotes('- **Categoría:** capacidad nueva\n- Antes: a\n- Ahora: b\n- Como probarlo: c').ok, 'tolera viñetas, negritas y sin tilde');
  });

  await check('init producto + auto: queda guardado en run.json', async () => {
    const run = await init(SITE, { out: OUT, rounds: 4, goal: 'que más invitados compartan fotos', modo: 'producto', involucramiento: 'auto' });
    assert(run.modo === 'producto' && run.involucramiento === 'auto', JSON.stringify(run));
    const saved = loadRun(OUT);
    assert(saved.modo === 'producto' && saved.involucramiento === 'auto', 'run.json');
    assert(readFileSync(join(OUT, 'DESIGN.md'), 'utf8').includes('Modo producto'), 'DESIGN.md menciona el modo');
  });

  await check('prompt producto: instrucción literal intacta, categorías de producto, sin categorías estéticas', async () => {
    const r = await prepare(1, { out: OUT, shots, root: ROOT });
    for (const v of ['blind', 'context']) {
      const p = readFileSync(r.prompts[v], 'utf8');
      assert(p.includes(`"${CORE_PROMPT}"`), `${v}: falta el prompt literal`);
      assert(p.includes(PRODUCT_CATEGORIES.join(', ')), `${v}: faltan categorías de producto`);
      assert(!p.includes(CATEGORIES.join(', ')) && !p.includes(CATEGORIES.join(' | ')), `${v}: no debe ofrecer categorías estéticas`);
      assert(/only touches typography, color, layout/.test(p), `${v}: falta la prohibición explícita`);
      for (const f of ['Antes:', 'Ahora:', 'Cómo probarlo:', 'Señal de validación:', 'Situación:', 'Depende de prueba real:']) assert(p.includes(f), `${v}: falta ${f}`);
      assert(/testable in the copy/.test(p), `${v}: debe pedir algo ensayable`);
    }
  });

  await check('after producto: rechaza notes incompletas o estéticas; acepta sin diff de píxeles', async () => {
    // blind: agrega un script (mismo HTML → 0% de diff) con notes completas → pasa.
    writeFileSync(join(OUT, '001', 'blind', 'subir.js'), 'export const subir = () => true;');
    writeFileSync(join(OUT, '001', 'blind', 'notes.md'), FULL_NOTES('blind'));
    // context: cambia el HTML pero las notes no tienen Antes ni Cómo probarlo → rechazada.
    writeFileSync(join(OUT, '001', 'context', 'index.html'), '<h1 style="font-size:80px">Weddi</h1>');
    writeFileSync(join(OUT, '001', 'context', 'notes.md'), 'Titular: Letras grandes\nCategoría: capacidad nueva\nAhora: se lee mejor');
    let r = await after(1, { out: OUT, shots });
    assert(!r.variants.blind.rejected, `blind debió pasar: ${r.variants.blind.reason}`);
    assert(r.variants.context.rejected && /Antes/.test(r.variants.context.reason) && /Cómo probarlo/.test(r.variants.context.reason), r.variants.context.reason);
    // context con categoría estética → rechazada aunque haya diff visible.
    writeFileSync(join(OUT, '001', 'context', 'notes.md'), FULL_NOTES('context').replace('capacidad nueva', 'tipografía'));
    r = await after(1, { out: OUT, shots });
    assert(r.variants.context.rejected && r.variants.context.product.aesthetic && r.variants.context.ratios.desktop > 0, JSON.stringify(r.variants.context));
    // context válida → ambas candidatas.
    writeFileSync(join(OUT, '001', 'context', 'notes.md'), FULL_NOTES('context').replace('Titular: Invitados suben fotos sin instalar nada', 'Titular: Los novios eligen las mejores en 5 minutos')
      .replace('Ahora: escanea un QR y sube al álbum común en 2 toques', 'Ahora: los novios marcan favoritas y sale un álbum listo'));
    r = await after(1, { out: OUT, shots });
    assert(!r.variants.context.rejected, r.variants.context.reason);
  });

  await check('review producto: "elegir" muestra Titular, Antes → Ahora, Cómo probarlo y Señal lado a lado', () => {
    const rv = buildRoundReview(1, { out: OUT, root: ROOT });
    validateReview(JSON.parse(JSON.stringify(rv)));
    const elegir = rv.items.find(i => i.id === 'elegir');
    assert(elegir, `sin elegir: ${rv.items.map(i => i.id)}`);
    const [blind, context, integrar] = elegir.visual.options;
    const labels = blind.lines.map(l => l.label).join('|');
    assert(labels === 'Titular|Antes → Ahora|Cómo probarlo|Señal', labels);
    assert(blind.lines[1].text.includes('→') && blind.lines[0].text !== context.lines[0].text, 'la diferencia debe verse');
    assert(integrar.item === 'integrar', 'integrar');
    assert(/coment/.test(elegir.ask) && /ciega no ve nada/.test(elegir.body_md), 'debe invitar a comentar');
    // La ciega solo agregó un script: sin diff visual su lámina es Antes → Ahora.
    const bItem = rv.items.find(i => i.id === 'blind');
    assert(bItem.visual.type === 'diagram' && bItem.visual.steps[0].label === 'Antes', JSON.stringify(bItem.visual));
    // La de contexto sí cambió píxeles: mantiene el slider antes/después.
    assert(rv.items.find(i => i.id === 'context').visual.type === 'before_after', 'con diff visual se sigue mostrando el slider');
    assert(reviewWarnings(validateReview(JSON.parse(JSON.stringify(rv)))).length === 0, 'revisión visual');
  });

  await check('auto: Claude elige con razón visible y nunca se bloquea por pausas', async () => {
    await throwsLike(() => apply(1, 'blind', { out: OUT, auto: true, root: ROOT }), /--razon/, 'auto exige razón');
    review(1, { out: OUT, root: ROOT });
    const r = apply(1, 'blind', { out: OUT, auto: true, reason: 'resuelve el momento más frecuente: subir fotos en la fiesta', root: ROOT });
    assert(r.republished, 'debió republicar la revisión con la razón');
    const rv = getReview(reviewId(loadRun(OUT), 1), ROOT);
    assert(rv.items[0].id === 'decision-claude' && /subir fotos/.test(rv.items[0].body_md), 'la razón debe quedar visible primero');
    validateReview(rv);
    // Simula 3 rondas más elegidas por Claude: en auto prepare no pausa.
    const run = loadRun(OUT);
    run.history = [1, 2, 3].map(n => ({ round: n, variant: 'blind', auto: true, reason: 'x' }));
    writeFileSync(join(OUT, 'run.json'), JSON.stringify(run));
    const p = await prepare(4, { out: OUT, shots, root: ROOT });
    assert(p.round === 4, 'auto no debe bloquear');
    assert(/Claude elige|after 4|Corre las variantes/.test(nextAction(loadRun(OUT), OUT, ROOT)), nextAction(loadRun(OUT), OUT, ROOT));
  });

  // Corrida "todas" + comentarios, en otra carpeta.
  const OUT2 = join(ROOT, 'rounds-todas');
  await check('todas: --auto se niega y el siguiente paso dice qué está pendiente', async () => {
    await init(SITE, { out: OUT2, rounds: 3, modo: 'producto', involucramiento: 'todas' });
    await prepare(1, { out: OUT2, shots, root: ROOT });
    for (const v of ['blind', 'context']) {
      writeFileSync(join(OUT2, '001', v, `${v}.js`), `// ${v}`);
      writeFileSync(join(OUT2, '001', v, 'notes.md'), FULL_NOTES(v).replace('Titular: Invitados', `Titular: ${v} invitados`));
    }
    await after(1, { out: OUT2, shots });
    review(1, { out: OUT2, root: ROOT });
    await throwsLike(() => apply(1, 'blind', { out: OUT2, auto: true, reason: 'x', root: ROOT }), /todas/, 'todas no acepta --auto');
    const next = nextAction(loadRun(OUT2), OUT2, ROOT);
    assert(/PENDIENTE del usuario/.test(next) && /ciega, contexto o integrar/.test(next), next);
  });

  await check('comentario del cockpit: va a CONTEXTO de la ronda siguiente y a DESIGN.md; la ciega no lo ve', async () => {
    const id = reviewId(loadRun(OUT2), 1);
    saveFeedback(id, { items: { context: { vote: 'up', comment: '' }, elegir: { vote: null, comment: 'que el QR funcione también impreso en la invitación' } } }, ROOT);
    assert(/QR funcione/.test(feedbackComment({ items: { elegir: { comment: 'que el QR funcione' } } })), 'feedbackComment');
    const r = apply(1, 'context', { out: OUT2, root: ROOT });
    assert(/QR funcione/.test(r.comment), 'apply debió leer el comentario');
    assert(/QR funcione/.test(loadRun(OUT2).history[0].comment), 'queda en run.json');
    assert(/QR funcione/.test(readFileSync(join(OUT2, 'DESIGN.md'), 'utf8')), 'queda en DESIGN.md');
    const run = loadRun(OUT2);
    const ctx = buildPrompt('context', { run, out: OUT2, n: 2, root: ROOT });
    const blind = buildPrompt('blind', { run, out: OUT2, n: 2, root: ROOT });
    assert(/User comments from previous rounds[\s\S]*QR funcione/.test(ctx), 'CONTEXTO debe recibir el comentario');
    assert(!/QR funcione/.test(blind) && !blind.includes('DESIGN.md'), 'la ciega no recibe nada');
    // --comentario desde el chat también se guarda.
    const again = apply(1, 'context', { out: OUT2, root: ROOT, comment: 'sin pedir correo' });
    assert(/sin pedir correo/.test(again.comment) && /QR funcione/.test(again.comment), again.comment);
  });

  await check('hallazgos de un council: solo los recibe la variante CONTEXTO', async () => {
    const f = join(ROOT, 'hallazgos.md');
    writeFileSync(f, '# Hallazgos\n- La novia práctica teme perder las fotos de la abuela');
    const OUT3 = join(ROOT, 'rounds-hallazgos');
    const run = await init(SITE, { out: OUT3, modo: 'producto', hallazgos: [f] });
    const ctx = buildPrompt('context', { run, out: OUT3, n: 1, root: ROOT });
    const blind = buildPrompt('blind', { run, out: OUT3, n: 1, root: ROOT });
    assert(ctx.includes('fotos de la abuela') && !blind.includes('fotos de la abuela'), 'hallazgos solo en contexto');
    await throwsLike(() => init(SITE, { out: join(ROOT, 'rounds-x'), hallazgos: [join(ROOT, 'no-existe.md')] }), /No existe/, 'hallazgos inexistentes');
  });

  await check('dos corridas en paralelo con --out: ids distintos y una no copia a la otra', async () => {
    const P = join(ROOT, 'proyecto');
    mkdirSync(P, { recursive: true });
    writeFileSync(join(P, 'index.html'), '<h1>Weddi</h1>');
    const novia = join(P, 'rounds-novia');
    const novio = join(P, 'rounds-novio');
    const a = await init(P, { out: novia, rounds: 10, modo: 'producto', involucramiento: 'auto', goal: 'lente novia' });
    const b = await init(P, { out: novio, rounds: 10, modo: 'producto', involucramiento: 'auto', goal: 'lente novio' });
    assert(!existsSync(join(novio, 'working', 'rounds-novia')), 'la segunda corrida copió la carpeta de la primera');
    assert(reviewId(a, 1) !== reviewId(b, 1) && reviewId(a, 1).includes('novia'), `${reviewId(a, 1)} vs ${reviewId(b, 1)}`);
    await Promise.all([prepare(1, { out: novia, shots, root: P }), prepare(1, { out: novio, shots, root: P })]);
    assert(existsSync(join(novia, '001', 'prompt-context.md')) && existsSync(join(novio, '001', 'prompt-context.md')), 'ambas preparadas');
    assert(readFileSync(join(novia, '001', 'prompt-context.md'), 'utf8').includes('lente novia'), 'cada una con su objetivo');
    assert(a.max_rounds === 10 && b.max_rounds === 10, '10 rondas cada una');
  });

  await check('cockpit: compare acepta lines {label,text} (máx. 5) y rechaza las mal formadas', async () => {
    const base = opts => ({ id: 'x-lines', title: 'X', kind: 'rounds', connects_to: [], context_brief: '', items: [{ id: 'elegir', title: 'E', headline: 'E', visual: { type: 'compare', options: opts } }] });
    validateReview(base([{ id: 'a', label: 'A', lines: [{ label: 'Antes → Ahora', text: 'x → y' }] }, { id: 'b', label: 'B' }]));
    await throwsLike(() => validateReview(base([{ id: 'a', label: 'A', lines: [{ label: 'sin texto' }] }, { id: 'b', label: 'B' }])), /lines\[0\]: \{ label, text \}/, 'línea sin text');
    const six = Array.from({ length: 6 }, (_, i) => ({ label: 'L' + i, text: 't' }));
    await throwsLike(() => validateReview(base([{ id: 'a', label: 'A', lines: six }, { id: 'b', label: 'B' }])), /hasta 5/, 'máximo 5');
  });

  await check('modo visual por defecto: sin cambios para corridas viejas', async () => {
    const OUTV = join(ROOT, 'rounds-visual');
    const run = await init(SITE, { out: OUTV });
    assert(run.modo === 'visual' && run.involucramiento === 'cada:3', JSON.stringify(run));
    const p = buildPrompt('blind', { run, out: OUTV, n: 1, root: ROOT });
    assert(p.includes(CATEGORIES.join(', ')) && !p.includes(PRODUCT_CATEGORIES[0]), 'visual mantiene sus categorías');
    assert(BoldError, 'export');
  });
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

console.log(`\n${passed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
