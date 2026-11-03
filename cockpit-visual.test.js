// cockpit-visual.test.js
// Formato visual del cockpit, sin navegador:
//   - renderer de diagramas (cockpit/public/diagrams.js): datos → SVG, escapado y texto legible
//   - contrato: visual, headline, stats; las revisiones viejas siguen válidas
//   - avisos al publicar y rechazo con --estricto
//   - media de los visuales: el server solo sirve rutas declaradas
//   - sprint-deck y la tarjeta de datos de "Qué puedo pedir"
// La prueba con navegador real es scripts/cockpit_visual_check.js. Idioma: español neutro.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import { renderDiagram, svgString, wrapText, ICONS } from './cockpit/public/diagrams.js';
import {
  validateReview, reviewWarnings, publishReview, listReviews, getReview, saveFeedback, pendingFeedback,
  buildSprintDeck, itemMediaPaths, reviewCover, buildGuideInstructions, CockpitError,
} from './src/cockpit.js';
import { startCockpit } from './cockpit/server.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; }
  catch (e) { console.error(`FAIL  ${label}\n      ${e && e.message}`); failed += 1; }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'esperaba true'); }
function assertThrows(fn, re, msg) {
  try { fn(); } catch (e) { assert(re.test(e.message), `${msg}: ${e.message}`); return; }
  throw new Error(`${msg}: no lanzó`);
}

const FLOW = { kind: 'flow', steps: [{ label: 'Copia', icon: 'copy' }, { parallel: [{ label: 'Ciega' }, { label: 'Con contexto' }] }, { label: 'Tú eliges', tone: 'you', icon: 'user' }] };
const ORG = { kind: 'org', lead: { label: 'Orquestador' }, members: [{ label: 'Desarrollador', badge: 'Nuevo', icon: 'code' }, { label: 'Directora de arte' }] };
const TIMELINE = { kind: 'timeline', items: [{ label: 'Kickoff', state: 'past' }, { label: 'Sprint 1', state: 'current' }, { label: 'Sprint 2', state: 'next' }] };
const CONNECTS = { kind: 'connects', center: 'Tu proyecto', links: [{ label: 'Supabase', state: 'missing' }, { label: 'Canva', state: 'ok' }] };
const ALL = { flow: FLOW, org: ORG, timeline: TIMELINE, connects: CONNECTS };

function fontSizes(svg) { return [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map(m => Number(m[1])); }
function viewBoxOf(svg) { const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg); return { w: Number(m[1]), h: Number(m[2]) }; }

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

for (const [kind, data] of Object.entries(ALL)) {
  await check(`renderer: ${kind} produce SVG en los dos layouts con todos sus textos`, () => {
    for (const layout of ['wide', 'tall']) {
      const svg = svgString(renderDiagram(data, { layout }));
      assert(svg.startsWith('<svg') && svg.includes('role="img"'), 'sin SVG accesible');
      for (const t of JSON.stringify(data).match(/"(?:label|center)":"([^"]+)"/g).map(s => s.split(':"')[1].slice(0, -1))) {
        assert(svg.includes(t.split(' ')[0]), `${layout}: falta ${t}`);
      }
      assert(fontSizes(svg).length > 0, 'sin texto');
    }
  });
}

await check('renderer: el layout de celular es angosto y con letra legible', () => {
  for (const data of Object.values(ALL)) {
    const svg = svgString(renderDiagram(data, { layout: 'tall' }));
    assert(viewBoxOf(svg).w <= 340, `${data.kind} ancho ${viewBoxOf(svg).w}`);
    assert(Math.min(...fontSizes(svg)) >= 13, `${data.kind} letra ${Math.min(...fontSizes(svg))}`);
  }
});

await check('renderer: un timeline marca pasado, ahora y sigue', () => {
  const svg = svgString(renderDiagram(TIMELINE));
  for (const c of ['dg-tl-past', 'dg-tl-now', 'dg-tl-next', 'Hecho', 'Ahora', 'Sigue']) assert(svg.includes(c), c);
});

await check('renderer: flow con muchos pasos se parte en dos filas', () => {
  const many = { kind: 'flow', steps: Array.from({ length: 8 }, (_, i) => ({ label: `Paso ${i + 1}` })) };
  const { w, h } = viewBoxOf(svgString(renderDiagram(many)));
  assert(h > 250 && w < 1100, `viewBox ${w}x${h}`);
});

await check('renderer: datos con HTML salen escapados (no se inyecta nada)', () => {
  const evil = { kind: 'connects', center: '<script>alert(1)</script>', links: [{ label: '"><img src=x onerror=alert(1)>' }] };
  for (const layout of ['wide', 'tall']) {
    const svg = svgString(renderDiagram(evil, { layout }));
    assert(!svg.includes('<script') && !svg.includes('<img'), svg.slice(0, 200));
  }
});

await check('renderer: el texto largo se corta con puntos suspensivos, no se desborda', () => {
  const lines = wrapText('una frase muy larga que no puede caber completa en una tarjeta chica', 12, 2);
  assert(lines.length === 2 && lines[1].endsWith('…'), JSON.stringify(lines));
  assert(lines.every(l => l.length <= 13), JSON.stringify(lines));
  const word = wrapText('supercalifragilisticoespialidoso', 10, 3);
  assert(word.every(l => l.length <= 11), JSON.stringify(word));
});

await check('renderer: datos rotos o tipo desconocido lanzan error (la lámina muestra un aviso)', () => {
  assertThrows(() => renderDiagram({ kind: 'flow' }), /steps/, 'flow');
  assertThrows(() => renderDiagram({ kind: 'nope' }), /desconocido/, 'kind');
  assertThrows(() => renderDiagram(null), /desconocido/, 'null');
});

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

const base = (items, extra = {}) => ({ id: 'r1', title: 'Revisión', kind: 'deliverable', items, ...extra });
const goodItem = { id: 'a', title: 'A', headline: 'Un titular corto', visual: { type: 'diagram', ...FLOW } };

await check('contrato: la revisión vieja sigue válida y sin campos nuevos inventados', () => {
  const r = validateReview(base([{ id: 'a', title: 'A', body_md: 'texto', media: ['x/y.png'], tags: ['t'] }]));
  assert(JSON.stringify(Object.keys(r.items[0])) === JSON.stringify(['id', 'title', 'body_md', 'media', 'tags']), Object.keys(r.items[0]).join(','));
  assert(r.sprint === undefined, 'sprint no debe inventarse');
});

await check('contrato: conserva headline, visual, stats, ask y kicker', () => {
  const r = validateReview(base([{ ...goodItem, stats: [{ value: 3, label: 'pasos' }], ask: '¿Sí?', kicker: 'Sprint 1' }], { sprint: 2 }));
  const it = r.items[0];
  assert(it.headline === 'Un titular corto' && it.visual.kind === 'flow' && it.stats[0].value === 3 && it.ask === '¿Sí?' && it.kicker === 'Sprint 1', JSON.stringify(it));
  assert(r.sprint === 2, 'sprint');
});

await check('contrato: acepta los cuatro tipos de visual', () => {
  const visuals = [
    { type: 'image', path: 'a/b.png', hotspots: [{ x: 0, y: 0.1, w: 0.5, h: 0.2, label: 'Titular' }] },
    { type: 'before_after', before: 'a/b.png', after: 'a/c.webp', views: [{ label: 'Celular', device: 'mobile', before: 'a/d.png', after: 'a/e.png' }] },
    { type: 'compare', options: [{ id: 'x', label: 'X', image: 'a/b.png', item: 'blind' }, { id: 'y', label: 'Y', icon: 'flag' }] },
    ...Object.values(ALL).map(d => ({ type: 'diagram', ...d })),
  ];
  for (const visual of visuals) validateReview(base([{ id: 'a', title: 'A', visual }]));
});

await check('contrato: lista TODOS los errores de visual y stats', () => {
  const bad = base([
    { id: 'a', title: 'A', visual: { type: 'video' } },
    { id: 'b', title: 'B', visual: { type: 'before_after', before: '../secreto.png', after: '.env' } },
    { id: 'c', title: 'C', visual: { type: 'compare', options: [{ id: 'x', label: 'X' }] } },
    { id: 'd', title: 'D', visual: { type: 'diagram', kind: 'nope' } },
    { id: 'e', title: 'E', stats: [{ value: 1, label: 'a' }, { value: 2, label: 'b' }, { value: 3, label: 'c' }, { value: 4, label: 'd' }] },
    { id: 'f', title: 'F', visual: { type: 'image', path: 'a.png', hotspots: [{ x: 2, y: 0, w: 1, h: 1 }] } },
    { id: 'g', title: 'G', visual: { type: 'image', path: 'documento.pdf' } },
    { id: 'h', title: 'H', visual: { type: 'diagram', kind: 'timeline', items: [{ label: 'x', state: 'luego' }] } },
  ]);
  assertThrows(() => validateReview(bad), /items\[0\]\.visual\.type[\s\S]*items\[1\]\.visual\.before[\s\S]*items\[2\]\.visual\.options[\s\S]*items\[3\]\.visual\.kind[\s\S]*items\[4\]\.stats[\s\S]*items\[5\]\.visual\.hotspots[\s\S]*items\[6\]\.visual\.path[\s\S]*items\[7\]\.visual\.items/, 'errores');
});

await check('contrato: bloquea rutas inseguras en compare y views', () => {
  assertThrows(() => validateReview(base([{ id: 'a', title: 'A', visual: { type: 'compare', options: [{ id: 'x', label: 'X', image: '../../etc/passwd.png' }, { id: 'y', label: 'Y', images: ['.git/x.png'] }] } }])), /options\[0\]\.image[\s\S]*options\[1\]\.images/, 'compare');
  assertThrows(() => validateReview(base([{ id: 'a', title: 'A', visual: { type: 'before_after', before: 'a.png', after: 'b.png', views: [{ before: 'C:/x.png', after: 'b.png' }] } }])), /views\[0\]\.before/, 'views');
});

// ---------------------------------------------------------------------------
// Avisos al publicar
// ---------------------------------------------------------------------------

function withWarnCapture(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return lines.join('\n');
}

await check('avisos: sin visual, sin headline y headline largo', () => {
  const w = reviewWarnings(validateReview(base([
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B', visual: { type: 'image', path: 'a.png' } },
    { id: 'c', title: 'C', headline: 'uno dos tres cuatro cinco seis siete ocho nueve diez once', visual: { type: 'image', path: 'a.png' } },
  ])));
  assert(w.some(x => x.startsWith('a:') && /sin visual/.test(x)), w.join(' | '));
  assert(w.some(x => x.startsWith('b:') && /sin headline/.test(x)), w.join(' | '));
  assert(w.some(x => x.startsWith('c:') && /11 palabras/.test(x)), w.join(' | '));
  assert(reviewWarnings(validateReview(base([goodItem]))).length === 0, 'el ítem bueno no avisa');
});

const pubRoot = mkdtempSync(join(tmpdir(), 'cockpit-visual-'));

await check('publishReview: avisa por consola y publica igual', () => {
  let res;
  const out = withWarnCapture(() => { res = publishReview(base([{ id: 'a', title: 'A' }]), pubRoot); });
  assert(/no es visual primero/.test(out) && /sin visual/.test(out), out);
  assert(res.warnings.length === 2 && getReview('r1', pubRoot), 'debió publicarse');
});

await check('publishReview: con estricto rechaza y no escribe nada', () => {
  const r = base([{ id: 'a', title: 'A' }], { id: 'estricta' });
  assertThrows(() => publishReview(r, pubRoot, { estricto: true }), /--estricto[\s\S]*sin visual/, 'estricto');
  assert(!getReview('estricta', pubRoot), 'no debió escribirse');
  const ok = publishReview(base([goodItem], { id: 'buena' }), pubRoot, { estricto: true });
  assert(ok.warnings.length === 0 && getReview('buena', pubRoot), 'la buena pasa');
});

await check('CLI: publish --estricto sale con error; sin la bandera avisa y publica', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-cli-'));
  try {
    const file = join(dir, 'r.json');
    writeFileSync(file, JSON.stringify(base([{ id: 'a', title: 'A' }], { id: 'cli-r' })));
    const env = { ...process.env, COCKPIT_ROOT: dir };
    const strict = spawnSync(process.execPath, ['src/cockpit.js', 'publish', file, '--estricto'], { encoding: 'utf8', env });
    assert(strict.status === 1 && /--estricto/.test(strict.stderr), strict.stderr);
    assert(!existsSync(join(dir, 'cockpit', 'reviews', 'cli-r.json')), 'no debió escribirse');
    const soft = spawnSync(process.execPath, ['src/cockpit.js', 'publish', file], { encoding: 'utf8', env });
    assert(soft.status === 0 && /no es visual primero/.test(soft.stderr), soft.stderr);
    assert(existsSync(join(dir, 'cockpit', 'reviews', 'cli-r.json')), 'debió escribirse');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('publishReview: toma el sprint activo del roadmap si no trae uno', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-sprint-'));
  try {
    mkdirSync(join(dir, 'roadmap'), { recursive: true });
    writeFileSync(join(dir, 'roadmap', 'current-sprint.json'), JSON.stringify({ number: 4, objective: 'Lanzar', tasks: [], backlog_added_during_sprint: [] }));
    assert(publishReview(base([goodItem], { id: 's' }), dir).review.sprint === 4, 'sprint activo');
    assert(publishReview(base([goodItem], { id: 't', sprint: 2 }), dir).review.sprint === 2, 'respeta el suyo');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Media, miniaturas, feedback y guía de voz
// ---------------------------------------------------------------------------

await check('itemMediaPaths y reviewCover: leen los visuales', () => {
  const it = { media: ['m.png'], visual: { type: 'before_after', before: 'a.png', after: 'b.png', views: [{ before: 'c.png', after: 'd.png' }] } };
  assert(itemMediaPaths(it).join(',') === 'm.png,a.png,b.png,c.png,d.png', itemMediaPaths(it).join(','));
  assert(reviewCover({ items: [{ visual: { type: 'diagram', ...FLOW } }, it] }).path === 'b.png', 'prefiere una imagen');
  assert(reviewCover({ items: [{ visual: { type: 'diagram', ...FLOW } }] }).type === 'diagram', 'si no, el diagrama');
  assert(reviewCover({ items: [{ media: ['x.mp4'] }] }) === null, 'sin imagen');
});

await check('listReviews: trae miniatura, sprint y votos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-list-'));
  try {
    publishReview(base([{ ...goodItem, visual: { type: 'image', path: 'a.png' } }, { ...goodItem, id: 'b' }], { sprint: 3 }), dir);
    saveFeedback('r1', { items: { a: { vote: 'up', comment: '' } } }, dir);
    const [r] = listReviews(dir);
    assert(r.cover.path === 'a.png' && r.sprint === 3 && r.voted_count === 1 && r.item_count === 2, JSON.stringify(r));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('feedback: el contrato items{id:{vote,comment}} no cambia; elegir usa el ítem destino', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-fb-'));
  try {
    publishReview(base([{ id: 'elegir', title: 'E', headline: 'Elige', visual: { type: 'compare', options: [{ id: 'x', label: 'Opción X', image: 'a.png', item: 'destino' }, { id: 'y', label: 'Y', image: 'b.png' }] } }]), dir);
    const { feedback } = saveFeedback('r1', { items: { destino: { vote: 'up', comment: '' }, inventado: { vote: 'up', comment: '' } } }, dir);
    assert(feedback.items.destino.vote === 'up' && !feedback.items.inventado, JSON.stringify(feedback.items));
    assert(JSON.stringify(Object.keys(feedback.items.destino)) === JSON.stringify(['vote', 'comment']), 'forma');
    assert(pendingFeedback(dir)[0].item_titles.destino === 'Opción X', 'título para el orquestador');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('guía de voz: describe lo que muestran los visuales', () => {
  const g = buildGuideInstructions(validateReview(base([
    { id: 'a', title: 'A', visual: { type: 'diagram', ...ORG }, stats: [{ value: 3, label: 'roles' }] },
    { id: 'b', title: 'B', visual: { type: 'compare', options: [{ id: 'x', label: 'Opción X', icon: 'flag' }, { id: 'y', label: 'Opción Y', icon: 'flag' }] } },
    { id: 'c', title: 'C', visual: { type: 'before_after', before: 'a.png', after: 'b.png', hotspots: [{ x: 0, y: 0, w: 1, h: 1, label: 'Titular nuevo' }] } },
  ])));
  for (const t of ['Directora de arte', '3 roles', 'Opción Y', 'Titular nuevo']) assert(g.includes(t), `falta ${t}`);
});

// ---------------------------------------------------------------------------
// Server: media de visuales
// ---------------------------------------------------------------------------

function get(port, path) {
  return new Promise((ok, fail) => {
    http.get({ host: '127.0.0.1', port, path }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', fail);
  });
}

const srvRoot = mkdtempSync(join(tmpdir(), 'cockpit-srv-'));
mkdirSync(join(srvRoot, 'shots'), { recursive: true });
for (const f of ['antes.png', 'despues.png', 'opcion.png', 'otra.png']) writeFileSync(join(srvRoot, 'shots', f), 'x');
publishReview(base([
  { id: 'a', title: 'A', headline: 'A', visual: { type: 'before_after', before: 'shots/antes.png', after: 'shots/despues.png' } },
  { id: 'b', title: 'B', headline: 'B', visual: { type: 'compare', options: [{ id: 'x', label: 'X', image: 'shots/opcion.png' }, { id: 'y', label: 'Y', icon: 'flag' }] } },
]), srvRoot);
const { server, port } = await startCockpit({ root: srvRoot, port: 0, env: {}, pollMs: 1000 });

try {
  await check('server: sirve la media declarada en visuales y nada más', async () => {
    for (const f of ['antes', 'despues', 'opcion']) assert((await get(port, `/media?path=shots%2F${f}.png`)).status === 200, f);
    assert((await get(port, '/media?path=shots%2Fotra.png')).status === 403, 'no declarada');
    assert((await get(port, '/media?path=..%2F..%2Fx.png')).status === 400, 'traversal');
  });

  await check('server: entrega los módulos del frontend y la ayuda', async () => {
    for (const f of ['/diagrams.js', '/visuals.js', '/app.js', '/capacidades.json']) assert((await get(port, f)).status === 200, f);
    const home = (await get(port, '/')).text;
    assert(home.includes('Qué puedo pedir') && home.includes('Ver más'), 'botones');
  });
} finally {
  await new Promise(done => server.close(done));
  rmSync(srvRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Sprint deck
// ---------------------------------------------------------------------------

const DECK = JSON.parse(readFileSync('cockpit/ejemplo-sprint-deck.json', 'utf8'));

await check('sprint-deck: el ejemplo arma un deck visual sin avisos', () => {
  const r = validateReview(buildSprintDeck(DECK));
  assert(reviewWarnings(r).length === 0, reviewWarnings(r).join(' | '));
  assert(r.sprint === 2 && r.id === 'ejemplo-sprint-deck', r.id);
  const ids = r.items.map(i => i.id);
  assert(ids[0] === 'resumen' && ids.at(-2) === 'sigue' && ids.at(-1) === 'decision', ids.join(','));
  assert(r.items[0].stats.length === 3 && r.items[0].visual.kind === 'timeline', 'resumen con 3 números');
  assert(r.items.at(-1).visual.type === 'compare', 'la decisión se elige con un clic');
});

await check('sprint-deck: capturas pasan a image o before_after', () => {
  const r = buildSprintDeck({ ...DECK, entregado: [
    { titular: 'Con captura', imagen: 'a.png', imagen_mobile: 'b.png' },
    { titular: 'Antes y después', antes: 'c.png', despues: 'd.png' },
  ] });
  assert(r.items[1].visual.type === 'image' && r.items[1].visual.path_mobile === 'b.png', 'image');
  assert(r.items[2].visual.type === 'before_after' && r.items[2].visual.after === 'd.png', 'before_after');
});

await check('sprint-deck: un borrador incompleto lista todos los problemas', () => {
  assertThrows(() => buildSprintDeck({ sprint: 'x' }), /sprint[\s\S]*titular[\s\S]*numeros[\s\S]*entregado[\s\S]*sigue[\s\S]*decision/, 'errores');
  assertThrows(() => buildSprintDeck({ ...DECK, numeros: [1, 2, 3, 4] }), /numeros/, 'más de 3 números');
  assertThrows(() => buildSprintDeck({ ...DECK, entregado: [{ titular: 'Sin imagen' }] }), /entregado\[0\]/, 'sin visual');
  assert(new CockpitError('x') instanceof Error, 'tipo');
});

await check('sprint-deck: el CLI publica', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-deck-'));
  try {
    const r = spawnSync(process.execPath, ['src/cockpit.js', 'sprint-deck', 'cockpit/ejemplo-sprint-deck.json', '--estricto'], { encoding: 'utf8', env: { ...process.env, COCKPIT_ROOT: dir } });
    assert(r.status === 0, r.stderr);
    assert(existsSync(join(dir, 'cockpit', 'reviews', 'ejemplo-sprint-deck.json')), 'sin publicar');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Qué puedo pedir
// ---------------------------------------------------------------------------

const CAPS = JSON.parse(readFileSync('cockpit/public/capacidades.json', 'utf8'));

await check('Qué puedo pedir: cubre lo pedido, con frase exacta y diagrama válido', () => {
  const ids = CAPS.cards.map(c => c.id);
  for (const id of ['bold-rounds', 'council', 'kickoff', 'astra', 'video-director', 'importar-modulo']) assert(ids.includes(id), `falta ${id}`);
  assert(new Set(ids).size === ids.length, 'ids repetidos');
  for (const c of CAPS.cards) {
    assert(c.title && (c.phrase || (c.modes && c.modes.length)), `${c.id} sin frase`);
    for (const layout of ['wide', 'tall']) assert(svgString(renderDiagram(c.diagram, { layout, density: 'compact' })).startsWith('<svg'), c.id);
    const icons = JSON.stringify(c.diagram).match(/"(?:icon|center_icon)":"([^"]+)"/g) || [];
    for (const m of icons) { const name = m.split(':"')[1].slice(0, -1); assert(ICONS[name], `${c.id}: ícono ${name}`); }
  }
});

await check('Qué puedo pedir: council explica las tres formas de armar el panel', () => {
  const council = CAPS.cards.find(c => c.id === 'council');
  assert(council.modes.length === 3, 'tres modos');
  assert(council.modes.some(m => /Arma tú el panel de expertos/.test(m.phrase)), 'el orquestador decide');
  assert(council.modes.some(m => /Crea una experta/.test(m.phrase)), 'crear el propio');
  assert(/--crear/.test(council.more) && /--personas/.test(council.more), 'comandos en Ver más');
});

await check('Qué puedo pedir: sin voseo', () => {
  const text = JSON.stringify(CAPS).toLowerCase();
  for (const bad of [' vos ', 'tenés', 'podés', 'querés', 'decime', 'mirá ', ' che ']) assert(!text.includes(bad), bad);
});

rmSync(pubRoot, { recursive: true, force: true });

console.log(`\n${passed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
