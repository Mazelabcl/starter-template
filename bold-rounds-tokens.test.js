// bold-rounds-tokens.test.js
// Bold-rounds sin devorar tokens: IDEAR y CONSTRUIR separados (método B), variantes en
// serie, presupuesto antes de init, límite de uso = reintentar, chequeo de sintaxis,
// espera corta y página de resumen en el cockpit (con botón Probar servido en sandbox).
// Sin red ni Claude real: el "runner" de sesiones aisladas es falso y los screenshots
// salen de un launcher falso. Idioma: español neutro.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import http from 'node:http';

import {
  init, prepare, after, apply, loadRun, roundPaths, runVariant, runHeadless, waitRun, buildResumen,
  syntaxErrors, notesFromIdea, nextAction, takeShots, encodePNG, IDEA_TOOLS, BUILD_TOOLS, DEFAULTS, GLOSARIO,
} from './scripts/bold_rounds.js';
import { validateReview, publishReview } from './src/cockpit.js';
import { startCockpit } from './cockpit/server.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

function solid(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
  return buf;
}
// Launcher falso: el color del PNG depende del HTML, así un cambio de archivo se "ve".
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

const IDEA = [
  '# Ronda 1 — variante blind',
  'Titular: La carta se vuelve comanda',
  'Categoría: composición',
  'Gana: pide en un toque sin buscar el teléfono',
  'Cambio 1: Comanda arriba',
  'Por qué: hoy el pedido está escondido',
  'Construir:',
  '- Reemplaza el header por una comanda',
  '- Agrega botón de WhatsApp',
  'No tocar: precios y teléfonos',
  'Riesgo: que se vea apretado en celular',
].join('\n');

const ok = (extra = {}) => ({
  ok: true, timed_out: false, requests: 2, num_turns: 3, subtype: 'success', cost_usd: 0.1, result: '',
  usage: { first_context: 6000, peak_context: 9000, total: 18000, output: 2000 }, window: { first: 0.1, last: 0.11 }, limit: { hit: false }, ...extra,
});

/** Runner falso: la ideación devuelve IDEA; la construcción edita index.html (opcionalmente con JS roto). */
function fakeRunner({ calls, brokenJs = false, limitAt = null } = {}) {
  return async opts => {
    calls.push(opts);
    const phase = opts.tools.includes('Edit') ? 'build' : 'idea';
    if (limitAt === phase) return ok({ ok: false, limit: { hit: true, resets_at: 1793980800, message: "You've hit your 5-hour limit" } });
    if (phase === 'idea') return ok({ result: IDEA.replace('blind', opts.cwd.endsWith('context') ? 'context' : 'blind') });
    const f = join(opts.cwd, 'index.html');
    writeFileSync(f, `${readFileSync(f, 'utf8')}<section>comanda ${opts.cwd.slice(-7)}</section>${brokenJs ? '<script>function x( {</script>' : '<script>const a = 1;</script>'}`);
    return ok({ result: 'Cambié el header' });
  };
}

const ROOT = mkdtempSync(join(tmpdir(), 'bold-tokens-'));
const SITE = join(ROOT, 'sitio');
mkdirSync(SITE, { recursive: true });
writeFileSync(join(SITE, 'index.html'), '<h1>Café</h1><p>Pedidos por WhatsApp</p>');
const OUT = join(ROOT, 'rounds-t');

await check('init: modelos separados (idea Opus, construir Sonnet por defecto), en serie y con presupuesto', async () => {
  const run = await init(SITE, { out: OUT, rounds: 2 });
  assert(run.modelo_idea === 'opus' && run.modelo_construir === 'sonnet' && run.modelo === 'sonnet' && run.paralelo === false, JSON.stringify(run));
  assert(run.presupuesto && run.presupuesto.pct_ventana > 0 && /ventana de 5 h/.test(run.presupuesto.texto), JSON.stringify(run.presupuesto));
  const both = await init(SITE, { out: `${OUT}-x`, modelo: 'haiku' });
  assert(both.modelo_idea === 'haiku' && both.modelo_construir === 'haiku', '--modelo fija ambos');
});

await check('CLI init: sin --yes muestra presupuesto y aviso de enchufe, sale 2 y NO crea nada', () => {
  const dir = join(ROOT, 'rounds-cli');
  const r = spawnSync(process.execPath, ['scripts/bold_rounds.js', 'init', SITE, '--out', dir, '--modelo-idea', 'opus', '--modelo-construir', 'sonnet'], { encoding: 'utf8' });
  assert(r.status === 2 && /Presupuesto estimado/.test(r.stdout) && /% de una ventana de 5 h/.test(r.stdout) && /enchufado/.test(r.stdout), r.stdout + r.stderr);
  assert(!existsSync(join(dir, 'run.json')), 'no debió crear la corrida');
  const s = spawnSync(process.execPath, ['scripts/bold_rounds.js', 'init', SITE, '--out', dir], { encoding: 'utf8' });
  assert(s.status !== 0 && /Falta --modelo/.test(s.stderr) && /Opus para idear/.test(s.stderr) && /Sonnet para construir/.test(s.stderr), s.stderr);
});

await check('prepare: prompt de IDEAR con capturas, archivo incluido y sin historia en la ciega', async () => {
  await prepare(1, { out: OUT, shots, root: ROOT });
  const rp = roundPaths(OUT, 1);
  const blind = readFileSync(rp.ideaPrompt('blind'), 'utf8');
  const ctx = readFileSync(rp.ideaPrompt('context'), 'utf8');
  assert(/IDEATION step/.test(blind) && blind.includes('before-desktop.png') && blind.includes('<h1>Café</h1>'), 'capturas + archivo');
  assert(/Reply with ONLY these lines/.test(blind) && /Construir:/.test(blind) && /Gana:/.test(blind), 'formato de la idea');
  assert(!/## DESIGN\.md/.test(blind) && /## DESIGN\.md/.test(ctx), 'la ciega no ve historia; la de contexto sí');
});

await check('notesFromIdea: deja los campos de notes.md y quita Construir / No tocar', () => {
  const n = notesFromIdea(IDEA);
  assert(/Titular:/.test(n) && /Gana:/.test(n) && /Riesgo:/.test(n), n);
  assert(!/Construir|No tocar|Agrega botón/.test(n), n);
});

await check('runVariant: idea (Opus, solo Read, pocos turnos) y luego construir (Sonnet, solo edición, tope)', async () => {
  const calls = [];
  const info = await runVariant(1, 'blind', { out: OUT, runner: fakeRunner({ calls }) });
  assert(info.estado === 'ok' && calls.length === 2, JSON.stringify(info));
  const [idea, build] = calls;
  assert(idea.model === 'opus' && idea.tools.join() === IDEA_TOOLS.join() && idea.maxTurns === DEFAULTS.ideaTurns && idea.systemPrompt && idea.effort === 'high', JSON.stringify(idea));
  assert(build.model === 'sonnet' && build.tools.join() === BUILD_TOOLS.join() && build.maxTurns === DEFAULTS.buildTurns && build.permissionMode === 'acceptEdits' && build.effort === 'medium', JSON.stringify(build));
  assert(!build.tools.includes('Bash') && /Do NOT take or view screenshots/.test(build.prompt) && build.prompt.includes('La carta se vuelve comanda'), 'construir sin capturas y con la idea');
  const rp = roundPaths(OUT, 1);
  assert(existsSync(rp.idea('blind')) && /Titular: La carta/.test(readFileSync(join(rp.variant('blind'), 'notes.md'), 'utf8')), 'idea y notes');
  assert(readFileSync(rp.runInfo('blind'), 'utf8').includes('"first_context": 6000'), 'métricas guardadas');
});

await check('runHeadless: en SERIE por defecto (la de contexto empieza cuando la ciega terminó) y estado para espera', async () => {
  const calls = [];
  const runner = fakeRunner({ calls });
  const order = [];
  const res = await runHeadless(1, 'both', { out: OUT, runner: async o => {
    order.push(`${/context$/.test(o.cwd) ? 'context' : 'blind'}:${o.tools.includes('Edit') ? 'construir' : 'idear'}`);
    return runner(o);
  } });
  assert(res.every(r => r.estado === 'ok') && res[0].medidas.tokens === 36000, JSON.stringify(res));
  assert(order.join(',') === 'blind:idear,blind:construir,context:idear,context:construir', order.join(','));
  const st = JSON.parse(readFileSync(roundPaths(OUT, 1).status, 'utf8'));
  assert(st.estado === 'listo' && st.paralelo === false && st.variantes.blind === 'ok', JSON.stringify(st));
  const w = await waitRun(1, { out: OUT, maxSec: 1 });
  assert(w.done, 'espera ve "listo"');
});

await check('espera: nunca más de 4 min por llamada y devuelve "sigue" sin bloquear', async () => {
  const rp = roundPaths(OUT, 1);
  writeFileSync(rp.status, JSON.stringify({ estado: 'corriendo', variantes: { blind: 'corriendo' } }));
  let slept = 0;
  const t0 = Date.now();
  const w = await waitRun(1, { out: OUT, maxSec: 99999, pollMs: 1, sleep: async () => { slept += 1; if (slept > 3) throw new Error('stop'); } }).catch(e => ({ err: e.message }));
  assert(w.err === 'stop' && Date.now() - t0 < 5000, 'debe sondear, no bloquear');
  assert(DEFAULTS.waitSec <= 240, 'tope de 4 min');
  const w2 = await waitRun(1, { out: OUT, maxSec: 0.001, pollMs: 1, sleep: async () => {} });
  assert(!w2.done && w2.status.estado === 'corriendo', JSON.stringify(w2));
  assert(/espera 1/.test(nextAction(loadRun(OUT), OUT, ROOT)), nextAction(loadRun(OUT), OUT, ROOT));
  writeFileSync(rp.status, JSON.stringify({ estado: 'listo', variantes: { blind: 'ok', context: 'ok' } }));
});

await check('after: JS válido pasa; resumen-ready', async () => {
  const r = await after(1, { out: OUT, shots });
  assert(!r.variants.blind.rejected && !r.variants.context.rejected && !r.variants.blind.syntax_errors, JSON.stringify(r.variants));
});

await check('syntaxErrors: node --check de .js y de <script> inline; JSON y src se saltan', () => {
  const d = mkdtempSync(join(tmpdir(), 'syn-'));
  writeFileSync(join(d, 'ok.js'), 'const a = 1;');
  writeFileSync(join(d, 'mal.js'), 'function (');
  writeFileSync(join(d, 'p.html'), '<script src="x.js"></script><script type="application/json">{"a":</script><script>let x = {;</script><script type="module">import x from "./y.js"; export const z = 1;</script>');
  const errs = syntaxErrors(d, ['ok.js', 'mal.js', 'p.html']);
  assert(errs.length === 2 && errs[0].file === 'mal.js' && /p\.html \(<script> 1\)/.test(errs[1].file), JSON.stringify(errs));
});

await check('after: JS roto rechaza la variante con "error de sintaxis"', async () => {
  const OUT2 = join(ROOT, 'rounds-js');
  await init(SITE, { out: OUT2, rounds: 1 });
  await prepare(1, { out: OUT2, shots, root: ROOT });
  await runHeadless(1, 'blind', { out: OUT2, runner: fakeRunner({ calls: [], brokenJs: true }) });
  const r = await after(1, { out: OUT2, shots });
  assert(r.variants.blind.rejected && /error de sintaxis/.test(r.variants.blind.reason), JSON.stringify(r.variants.blind));
});

await check('límite de uso: reintentar (no rechazo de calidad), no lanza la siguiente variante y status lo dice', async () => {
  const OUT3 = join(ROOT, 'rounds-limite');
  await init(SITE, { out: OUT3, rounds: 1 });
  await prepare(1, { out: OUT3, shots, root: ROOT });
  const calls = [];
  const res = await runHeadless(1, 'both', { out: OUT3, runner: fakeRunner({ calls, limitAt: 'build' }) });
  assert(res.length === 1 && res[0].estado === 'reintentar' && calls.length === 2, `serie se corta: ${JSON.stringify(res)} ${calls.length}`);
  const r = await after(1, { out: OUT3, shots });
  assert(r.variants.blind.reintentar && /límite de uso/.test(r.variants.blind.reason) && /no es un problema de calidad/.test(r.variants.blind.reason), JSON.stringify(r.variants.blind));
  // Método A u otros: el aviso en notes.md también cuenta.
  writeFileSync(join(roundPaths(OUT3, 1).variant('context'), 'notes.md'), "You've hit your 5-hour limit · resets 6pm (America/Santiago)");
  const r2 = await after(1, { out: OUT3, shots });
  assert(r2.variants.context.reintentar, JSON.stringify(r2.variants.context));
  assert(/Límite de uso/.test(nextAction(loadRun(OUT3), OUT3, ROOT)), nextAction(loadRun(OUT3), OUT3, ROOT));
});

let resumenReview;
await check('resumen: una ronda por lámina con chip, "qué gana", Probar y glosario de 5 términos', async () => {
  apply(1, 'blind', { out: OUT, auto: true, reason: 'la comanda pone el pedido arriba', root: ROOT });
  resumenReview = buildResumen({ out: OUT, root: ROOT });
  const v = validateReview(resumenReview);
  const ronda = v.items.find(i => i.id === 'ronda-001');
  assert(ronda && ronda.chip.text === 'Claude eligió Ciega' && ronda.chip.tone === 'ok', JSON.stringify(ronda && ronda.chip));
  assert(ronda.gain === 'Qué gana el usuario: pide en un toque sin buscar el teléfono' && /index\.html$/.test(ronda.try.path), JSON.stringify(ronda));
  assert(ronda.visual.type === 'before_after' && ronda.headline.split(/\s+/).length <= 10, JSON.stringify(ronda.visual));
  const g = v.items.at(-1);
  assert(g.visual.type === 'glossary' && g.visual.terms.length === 5 && GLOSARIO.map(t => t.term).join() === 'Ciega,Con contexto,Señal,Veredicto,Categoría', JSON.stringify(g));
  assert(v.items[0].id === 'evolucion', 'primera lámina: evolución');
});

await check('cockpit: valida chip/gain/try/glossary y rechaza rutas peligrosas', () => {
  const base = { id: 'r1', title: 't', kind: 'other', items: [{ id: 'a', title: 'x' }] };
  const bad = (it, re) => {
    let m = '';
    try { validateReview({ ...base, items: [{ id: 'a', title: 'x', ...it }] }); } catch (e) { m = e.message; }
    assert(re.test(m), `${JSON.stringify(it)} → ${m}`);
  };
  bad({ try: { label: 'Probar', path: '../fuera/index.html' } }, /try/);
  bad({ try: { label: 'Probar', path: '.env/x.html' } }, /try/);
  bad({ try: { label: 'Probar', path: 'a/b.js' } }, /try/);
  bad({ chip: { text: 'x', tone: 'rojo' } }, /chip/);
  bad({ visual: { type: 'glossary', terms: [] } }, /terms/);
});

await check('cockpit /probar: sirve la carpeta de la demo con scripts en sandbox; nada fuera de ella', async () => {
  publishReview(resumenReview, ROOT);
  writeFileSync(join(ROOT, 'secreto.html'), 'no');
  const { server, port } = await startCockpit({ root: ROOT, port: 0, host: '127.0.0.1', env: {}, pollMs: 200 });
  const get = path => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path }, r => {
    let b = '';
    r.on('data', d => { b += d; });
    r.on('end', () => res({ status: r.statusCode, csp: r.headers['content-security-policy'], body: b }));
  }).on('error', rej));
  try {
    const id = encodeURIComponent(resumenReview.id);
    const okR = await get(`/probar/${id}/ronda-001/index.html`);
    assert(okR.status === 200 && /comanda/.test(okR.body) && /sandbox allow-scripts/.test(okR.csp) && !/allow-same-origin/.test(okR.csp), JSON.stringify(okR));
    const up = await get(`/probar/${id}/ronda-001/..%2F..%2F..%2F..%2Fsecreto.html`);
    assert(up.status >= 400, `traversal: ${up.status}`);
    const none = await get(`/probar/${id}/glosario/index.html`);
    assert(none.status === 404, `sin try: ${none.status}`);
  } finally { server.close(); }
});

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
