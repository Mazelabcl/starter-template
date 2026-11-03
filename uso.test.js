// uso.test.js
// Verifica src/uso.js y /api/uso con transcripciones de juguete. Nunca lee las reales.
// Cubre: deduplicación, reparto, hilo principal vs subagentes, carga base, módulos
// (incluye falsos positivos), rondas, nunca usados, líneas dañadas, --desde, `todos`
// con carpetas borradas, y que no se filtren contenidos, rutas ni .env.
// Idioma: español neutro.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import {
  reporteProyecto, reporteTodos, modulosDeComando, catalogoModulos, mediana, slugDe, raizCanonica,
  parseDesde, sugerencias, fmt, textoProyecto, textoTodos,
} from './src/uso.js';
import { startCockpit } from './cockpit/server.js';
import { cockpitUrl } from './src/cockpit.js';
import { importModules } from './scripts/importar_modulo.js';

const REPO = dirname(fileURLToPath(import.meta.url));
const SECRETO = 'CANARIO-PROMPT-NO-DEBE-SALIR';
const CLAVE_ENV = 'sk-CANARIO-ENV-NO-DEBE-SALIR';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1;
  }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }
function eq(a, e, m) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m}: esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`); }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const base = mkdtempSync(join(tmpdir(), 'uso-test-'));
const claudeDir = join(base, 'claude');
const proyecto = join(base, 'mi-proyecto');
const otro = join(base, 'sin-starter');
const borrado = join(base, 'borrado-starter');
const borradoAjeno = join(base, 'borrado-ajeno');
mkdirSync(join(proyecto, 'councils', 'results'), { recursive: true });
mkdirSync(join(proyecto, 'astra-bridge', 'resultados'), { recursive: true });
mkdirSync(otro, { recursive: true });
writeFileSync(join(proyecto, 'modulos.json'), readFileSync(join(REPO, 'modulos.json')));
writeFileSync(join(proyecto, '.env'), `OPENROUTER_API_KEY=${CLAVE_ENV}\n`);
writeFileSync(join(proyecto, 'councils', 'results', 'c1.json'), JSON.stringify({ id: 'c1', question: SECRETO, metadata: { cost_usd: 0.04 } }));
writeFileSync(join(proyecto, 'astra-bridge', 'resultados', 'a1.json'), JSON.stringify({ id: 'a1', estado: 'ok', archivos: ['x.png', 'y.png'], salida_codex: SECRETO }));

const linea = o => JSON.stringify(o);
const usuario = (cwd, ts, content, extra = {}) => linea({ type: 'user', cwd, timestamp: ts, sessionId: 's', message: { role: 'user', content }, ...extra });
function asistente(cwd, ts, id, u, content = [{ type: 'text', text: SECRETO }], model = 'claude-opus-prueba') {
  return linea({
    type: 'assistant', cwd, timestamp: ts, requestId: `req-${id}`,
    message: { id, model, content, usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] } },
  });
}
const herramienta = (id, name, input) => ({ type: 'tool_use', id, name, input });
function escribir(cwd, sesion, lineas, carpeta = slugDe(cwd)) {
  const dir = join(claudeDir, carpeta);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sesion}.jsonl`), `${lineas.join('\n')}\n`);
  return dir;
}
function escribirAgente(dir, sesion, agente, lineas, meta) {
  const d = join(dir, sesion, 'subagents');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `agent-${agente}.jsonl`), `${lineas.join('\n')}\n`);
  writeFileSync(join(d, `agent-${agente}.meta.json`), JSON.stringify(meta));
}

const D1 = '2026-10-10T10:00:00Z';
const D2 = '2026-10-20T10:00:00Z';

// Sesión A: el streaming repite m1 (no debe sumarse dos veces), usa /kickoff y lanza un subagente.
const dirA = escribir(proyecto, 'sesion-a', [
  usuario(proyecto, D1, `<command-name>/kickoff</command-name> ${SECRETO}`),
  asistente(proyecto, D1, 'm1', [10, 1000, 2000, 5], [{ type: 'text', text: SECRETO }]),
  asistente(proyecto, D1, 'm1', [10, 1000, 2000, 50], [herramienta('t-agente', 'Agent', { subagent_type: 'general-purpose', prompt: SECRETO })]),
  usuario(proyecto, D1, [{ type: 'tool_result', tool_use_id: 't-agente', content: 'ok' }]),
  asistente(proyecto, D1, 'm2', [1, 100, 3000, 10]),
  '{"type":"assistant","roto',
  'esto no es json',
  usuario(proyecto, D1, 'siguiente pedido'),
  asistente(proyecto, D1, 'm3', [1, 0, 3100, 20], [
    herramienta('t-grep', 'Bash', { command: 'grep council src/council.js' }),
    herramienta('t-cat', 'Bash', { command: 'cat src/astra.js; ls' }),
    herramienta('t-cockpit', 'Bash', { command: 'cd x && node src/cockpit.js publish r.json' }),
    herramienta('t-otra', 'Skill', { skill: 'skill-global-ajena' }),
    herramienta('t-rara', 'Skill', { skill: `${SECRETO} con espacios` }),
  ]),
  asistente(proyecto, D1, 'msyn', [0, 0, 0, 0], [{ type: 'text', text: 'x' }], '<synthetic>'),
]);
escribirAgente(dirA, 'sesion-a', 'a1', [
  usuario(proyecto, D1, SECRETO),
  asistente(proyecto, D1, 'ag1', [2, 500, 0, 30], [{ type: 'text', text: 'x' }], 'claude-sonnet-prueba'),
  asistente(proyecto, D1, 'ag2', [2, 0, 500, 40], [{ type: 'text', text: 'x' }], 'claude-sonnet-prueba'),
], { agentType: 'general-purpose', description: SECRETO, toolUseId: 't-agente' });

// Sesión B (más tarde): council corrido en el hilo principal.
escribir(proyecto, 'sesion-b', [
  usuario(proyecto, D2, 'corre el council'),
  asistente(proyecto, D2, 'b1', [5, 200, 800, 15], [herramienta('t-council', 'Bash', { command: 'node --env-file=.env src/council.js run --question "x"' })]),
  asistente(proyecto, D2, 'b2', [5, 0, 1000, 25]),
]);

// Una ronda de bold-rounds: `claude -p` en una copia, con su propia carpeta.
const ronda = join(proyecto, 'rounds', '002', 'blind');
escribir(ronda, 'sesion-ronda', [
  usuario(ronda, D2, SECRETO),
  asistente(ronda, D2, 'r1', [1, 700, 300, 100]),
]);

// Prefijo parecido: no es parte del proyecto aunque la carpeta empiece igual.
const parecido = `${proyecto}-2`;
mkdirSync(parecido, { recursive: true });
escribir(parecido, 'sesion-parecida', [usuario(parecido, D2, 'x'), asistente(parecido, D2, 'p1', [1, 1, 1, 1])]);

// Proyecto ajeno vivo, ajeno borrado y del starter borrado.
escribir(otro, 'sesion-otro', [usuario(otro, D2, 'x'), asistente(otro, D2, 'o1', [1, 90000, 0, 1])]);
escribir(borradoAjeno, 'sesion-ajena', [usuario(borradoAjeno, D2, 'x'), asistente(borradoAjeno, D2, 'z1', [1, 1, 1, 1])]);
escribir(borrado, 'sesion-borrada', [
  usuario(borrado, D2, 'x'),
  asistente(borrado, D2, 'd1', [1, 400, 400, 8], [herramienta('t-astra', 'Bash', { command: 'node src/astra.js estado' })]),
]);

const opts = { root: proyecto, claudeDir };
const r = await reporteProyecto(opts);
const modulo = id => r.modulos.find(m => m.id === id);

// ---------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------

await check('deduplica por id de mensaje y se queda con el valor final del streaming', () => {
  // m1=10+1000+2000+50, m2=1+100+3000+10, m3=1+0+3100+20 / ag1=532 / ag2=542 / b1=1020 / b2=1030 / r1=1101.
  eq(r.totales.output, 50 + 10 + 20 + 30 + 40 + 15 + 25 + 100, 'output');
  eq(r.totales.input, 10 + 1 + 1 + 2 + 2 + 5 + 5 + 1, 'input');
  eq(r.totales.cache_write, 1000 + 100 + 500 + 200 + 700, 'cache_write');
  eq(r.totales.cache_read, 2000 + 3000 + 3100 + 500 + 800 + 1000 + 300, 'cache_read');
  eq(r.totales.llamadas, 8, 'llamadas');
  eq(r.totales.total, r.totales.output + r.totales.input + r.totales.cache_write + r.totales.cache_read, 'total');
  eq(r.totales.nuevos, r.totales.total - r.totales.cache_read, 'nuevos');
});

await check('separa hilo principal, subagentes y rondas sin perder ni repetir', () => {
  eq(r.subagentes.total, 532 + 542, 'subagentes');
  eq(r.rondas.total, 1101, 'rondas');
  eq(r.principal.total + r.subagentes.total + r.rondas.total, r.totales.total, 'suma');
});

await check('reparte por modelo e ignora los mensajes sintéticos', () => {
  eq(r.por_modelo.map(m => m.modelo).sort(), ['claude-opus-prueba', 'claude-sonnet-prueba'], 'modelos');
  eq(r.por_modelo.find(m => m.modelo === 'claude-sonnet-prueba').total, 1074, 'sonnet');
});

await check('la carpeta con prefijo parecido no entra en el proyecto', () => {
  eq(r.sesiones.length, 3, 'sesiones');
});

await check('carga base: mediana de la primera request de cada sesión principal', () => {
  eq(r.carga_base.sesiones, 2, 'sesiones');
  // Primera de A: 3010. Primera de B: 1005. Mediana: 2008 (redondeo). La ronda va aparte.
  eq(r.carga_base.mediana, 2008, 'mediana');
  eq(r.carga_base.rondas_mediana, 1001, 'rondas');
  eq(r.carga_base.subagentes_mediana, 502, 'subagentes');
  eq(mediana([]), null, 'vacía');
  eq(mediana([5, 1, 3]), 3, 'impar');
});

await check('cuenta y salta las líneas dañadas', () => {
  eq(r.lectura.lineas_malas, 2, 'malas');
});

// ---------------------------------------------------------------------------
// Módulos
// ---------------------------------------------------------------------------

const catalogo = catalogoModulos(proyecto);
await check('detecta comandos reales, no menciones', () => {
  eq(modulosDeComando('node src/council.js run', catalogo), ['council'], 'simple');
  eq(modulosDeComando('cd a && node --env-file=.env ./src/astra.js estado', catalogo), ['astra'], 'con env');
  eq(modulosDeComando('node C:\\repo\\scripts\\bold_rounds.js status', catalogo), ['bold-rounds'], 'windows');
  eq(modulosDeComando('npm run cockpit:open', catalogo), ['cockpit'], 'npm');
  eq(modulosDeComando('grep -n foo src/council.js', catalogo), [], 'grep');
  eq(modulosDeComando('node otra.js; cat src/council.js', catalogo), [], 'otro comando');
  eq(modulosDeComando('node council-engine.test.js', catalogo), [], 'test');
  eq(modulosDeComando('node src/council.jsx', catalogo), [], 'otro archivo');
  eq(modulosDeComando(undefined, catalogo), [], 'vacío');
});

await check('los nombres de módulos salen de modulos.json, más herramientas sueltas', () => {
  const ids = catalogo.lista.map(m => m.id);
  for (const id of ['bold-rounds', 'council', 'astra', 'brazos', 'roles', 'video-director', 'kickoff', 'research']) assert(ids.includes(id), `falta ${id}`);
  assert(!ids.includes('base'), 'base es interno');
});

await check('un clon viejo sin modulos.json igual reconoce los módulos', async () => {
  const viejo = join(base, 'clon-viejo');
  mkdirSync(viejo, { recursive: true });
  escribir(viejo, 'sesion-vieja', [
    usuario(viejo, D2, '<command-name>/bold-rounds</command-name>'),
    asistente(viejo, D2, 'v1', [1, 1, 1, 1], [herramienta('t-viejo', 'Bash', { command: 'node scripts/bold_rounds.js status' })]),
  ]);
  const rv = await reporteProyecto({ root: viejo, claudeDir });
  assert(rv.modulos.some(m => m.id === 'bold-rounds'), 'bold-rounds usado');
  assert(!rv.nunca_usados.some(m => m.id === 'bold-rounds'), 'no debe salir como nunca usado');
});

await check('el módulo uso se puede importar a un proyecto viejo', () => {
  const destino = join(base, 'destino-import');
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, 'package.json'), JSON.stringify({ name: 'viejo', type: 'module', scripts: {} }));
  const plan = importModules(['uso'], { origen: REPO, destino, dryRun: true });
  for (const f of ['src/uso.js', 'cockpit/public/uso.js', '.claude/commands/uso.md', '.claude/uso-modulos.json']) assert(plan.copied.includes(f), `falta ${f}`);
});

await check('un slash, un comando y una ronda cuentan como uso', () => {
  eq(modulo('kickoff').por_tipo.slash, 1, 'slash');
  eq(modulo('council').por_tipo.comando, 1, 'council');
  eq(modulo('cockpit').por_tipo.comando, 1, 'cockpit');
  eq(modulo('bold-rounds').por_tipo.ronda, 1, 'ronda');
  assert(!modulo('astra'), 'cat no es uso');
});

await check('atribuye: la ronda completa, el subagente lanzado y el resto del turno', () => {
  eq(modulo('bold-rounds').tokens_directos, 1101, 'ronda');
  eq(modulo('kickoff').tokens_directos, 1074, 'subagente del turno de /kickoff');
  eq(modulo('kickoff').tokens_turno, 3060 + 3111, 'turno de /kickoff');
  eq(modulo('council').tokens_turno, 1020 + 1030, 'turno de council');
  assert(r.modulos.reduce((n, m) => n + m.tokens, 0) <= r.totales.total, 'no puede pasarse del total');
  eq(r.tokens_sin_modulo, r.totales.total - r.modulos.reduce((n, m) => n + m.tokens, 0), 'sin módulo');
});

await check('una herramienta de un paso no se lleva el resto del turno', () => {
  // m3 corre el cockpit y ya no hay más llamadas: solo se lleva esa, y no pisa el módulo previo.
  eq(modulo('cockpit').tokens, 3121, 'cockpit');
  eq(modulo('kickoff').tokens_turno, 6171, 'kickoff');
});

await check('nunca usados: incluye lo no tocado y no incluye lo usado ni al propio medidor', () => {
  const ids = r.nunca_usados.map(m => m.id);
  for (const id of ['astra', 'roles', 'video-director']) assert(ids.includes(id), `falta ${id}`);
  for (const id of ['kickoff', 'council', 'bold-rounds', 'uso']) assert(!ids.includes(id), `sobra ${id}`);
  assert(!ids.includes('skill-global-ajena'), 'una skill ajena no es del starter');
});

await check('skills ajenas se cuentan aparte y los nombres raros se descartan', () => {
  eq(r.otras_skills, [{ nombre: 'skill-global-ajena', veces: 1 }], 'otras');
});

await check('costos externos: lee lo registrado y dice sin datos si no hay', async () => {
  eq(r.externos.council, { corridas: 1, usd: 0.04 }, 'council');
  eq(r.externos.astra, { pedidos: 1, imagenes: 2, con_error: 0 }, 'astra');
  const vacio = await reporteProyecto({ root: otro, claudeDir });
  eq(vacio.externos, { council: null, astra: null }, 'nulos');
  const t = textoProyecto(vacio);
  assert(t.includes('Council: sin datos') && t.includes('Astra: sin datos'), t);
});

await check('quemadores en lenguaje simple y sugerencias acotadas', () => {
  assert(r.quemadores.length >= 1 && r.quemadores.length <= 5, 'cantidad');
  assert(r.quemadores[0].total >= r.quemadores[r.quemadores.length - 1].total, 'orden');
  assert(/Conversación principal|Subagente|Ronda/.test(r.quemadores[0].etiqueta), r.quemadores[0].etiqueta);
  assert(r.sugerencias.length <= 3, 'máximo 3');
  const s = sugerencias({
    totales: { total: 100, cache_read: 90 },
    modulos: [{ id: 'bold-rounds', pct: 40 }],
    por_modelo: [{ modelo: 'claude-opus', subagentes_total: 50 }],
    carga_base: { mediana: 80000 },
  });
  eq(s.length, 3, 'tope');
  assert(s[0].includes('bold-rounds') && s[0].includes('40%') && s[0].includes('aproximado'), s[0]);
  eq(sugerencias({ totales: { total: 0 }, modulos: [], por_modelo: [], carga_base: {} }), [], 'sin datos no hay');
});

// ---------------------------------------------------------------------------
// Filtros y `todos`
// ---------------------------------------------------------------------------

await check('--desde filtra llamadas, eventos y carga base', async () => {
  const d = await reporteProyecto({ ...opts, desde: parseDesde('2026-10-15') });
  eq(d.totales.llamadas, 3, 'llamadas');
  assert(!d.modulos.find(m => m.id === 'kickoff'), 'kickoff es anterior');
  eq(d.carga_base.sesiones, 1, 'base');
  eq(d.desde, '2026-10-15', 'desde');
});

await check('parseDesde rechaza fechas malas', () => {
  for (const bad of ['ayer', '2026-13-01', '2026-02-31']) {
    let ok = false;
    try { parseDesde(bad); } catch { ok = true; }
    assert(ok, bad);
  }
});

await check('raizCanonica quita rondas y worktrees', () => {
  eq(raizCanonica('C:\\a\\proy\\rounds\\002\\blind'), 'C:\\a\\proy', 'ronda');
  eq(raizCanonica('/a/proy/.claude/worktrees/agent-1'), '/a/proy', 'worktree');
  eq(raizCanonica('/a/proy'), '/a/proy', 'normal');
});

const todos = await reporteTodos({ starterRoot: proyecto, claudeDir });
await check('todos: solo proyectos del starter, con la carpeta borrada si hay rastro', () => {
  const nombres = todos.proyectos.map(p => p.nombre);
  assert(nombres.includes('mi-proyecto'), 'proyecto');
  assert(nombres.includes('borrado-starter'), 'borrado con rastro');
  assert(!nombres.includes('sin-starter'), 'ajeno vivo');
  assert(!nombres.includes('borrado-ajeno'), 'ajeno borrado');
  assert(todos.proyectos.find(p => p.nombre === 'borrado-starter').borrado, 'marca de borrado');
  assert(!nombres.includes('002'), 'la ronda se suma a su proyecto');
  eq(todos.proyectos[0].total >= todos.proyectos[todos.proyectos.length - 1].total, true, 'orden');
});

await check('todos: rankea módulos y compara con proyectos sin starter', () => {
  assert(todos.modulos.find(m => m.id === 'astra'), 'astra usado en el borrado');
  assert(!todos.nunca_usados.find(m => m.id === 'astra'), 'astra ya no es nunca usado');
  assert(todos.nunca_usados.find(m => m.id === 'roles'), 'roles nunca usado');
  // sin-starter (90001), borrado-ajeno (3) y la carpeta de prefijo parecido (3).
  eq(todos.carga_base_no_starter, { mediana: 3, sesiones: 3 }, 'base de otros');
  assert(textoTodos(todos).includes('carpeta borrada'), 'rotula');
});

await check('sin transcripciones responde sin romperse', async () => {
  const v = await reporteProyecto({ root: otro, claudeDir: join(base, 'no-existe') });
  eq(v.totales.total, 0, 'total');
  assert(textoProyecto(v).includes('Sin datos'), 'texto');
  const t = await reporteTodos({ starterRoot: proyecto, claudeDir: join(base, 'no-existe') });
  eq(t.proyectos, [], 'proyectos');
  assert(textoTodos(t).includes('Sin datos'), 'texto');
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

function sinFugas(texto, donde) {
  assert(!texto.includes(SECRETO), `${donde}: filtró contenido`);
  assert(!texto.includes(CLAVE_ENV), `${donde}: filtró .env`);
  const barras = base.replace(/\\/g, '\\\\');
  assert(!texto.includes(base) && !texto.includes(barras), `${donde}: filtró una ruta`);
}

await check('el reporte nunca lleva contenido, .env ni rutas', () => {
  sinFugas(JSON.stringify(r), 'proyecto');
  sinFugas(JSON.stringify(todos), 'todos');
  sinFugas(textoProyecto(r), 'texto');
  sinFugas(textoTodos(todos), 'texto todos');
});

await check('el código no toca .env ni el cargador de variables', () => {
  const src = readFileSync(join(REPO, 'src', 'uso.js'), 'utf8');
  assert(!/load_env|['"`]\.env/.test(src), 'referencia a .env');
  assert(!/fetch\(|node:http|node:https|node:net/.test(src), 'no debe usar red');
});

await check('CLI: --json, texto y errores, con la misma raíz de transcripciones', () => {
  const env = { ...process.env, USO_CLAUDE_DIR: claudeDir };
  const js = spawnSync(process.execPath, ['src/uso.js', '--proyecto', proyecto, '--json'], { cwd: REPO, env, encoding: 'utf8' });
  eq(js.status, 0, js.stderr);
  eq(JSON.parse(js.stdout).totales.total, r.totales.total, 'json');
  sinFugas(js.stdout, 'cli json');
  const t = spawnSync(process.execPath, ['src/uso.js', 'todos', '--desde', '2026-01-01'], { cwd: REPO, env, encoding: 'utf8' });
  eq(t.status, 0, t.stderr);
  assert(t.stdout.includes('mi-proyecto'), 'todos');
  const mal = spawnSync(process.execPath, ['src/uso.js', '--desde', 'ayer'], { cwd: REPO, env, encoding: 'utf8' });
  eq(mal.status, 1, 'fecha mala');
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function get(port, path, headers = {}) {
  return new Promise((ok, fail) => {
    http.get({ host: '127.0.0.1', port, path, headers }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => ok({ status: res.statusCode, body: b }));
    }).on('error', fail);
  });
}

const { server, port } = await startCockpit({ root: proyecto, port: 0, host: '127.0.0.1', env: {}, usoDir: claudeDir });
await check('server: entrega agregados sin contenido ni rutas', async () => {
  const a = await get(port, '/api/uso');
  eq(a.status, 200, a.body);
  eq(JSON.parse(a.body).totales.total, r.totales.total, 'total');
  sinFugas(a.body, 'api proyecto');
  const b = await get(port, '/api/uso?alcance=todos');
  eq(b.status, 200, b.body);
  assert(JSON.parse(b.body).proyectos.some(p => p.nombre === 'mi-proyecto'), 'nombres de carpeta');
  sinFugas(b.body, 'api todos');
});

await check('server: rechaza fecha mala y un Host que no es local', async () => {
  eq((await get(port, '/api/uso?desde=ayer')).status, 400, 'fecha');
  eq((await get(port, '/api/uso', { Host: 'sitio-malo.example' })).status, 403, 'host');
});

await check('server: guarda el resultado un minuto', async () => {
  const antes = await get(port, '/api/uso');
  appendFileSync(join(claudeDir, slugDe(proyecto), 'sesion-b.jsonl'), `${asistente(proyecto, D2, 'b-nuevo', [1, 1, 1, 1])}\n`);
  eq((await get(port, '/api/uso')).body, antes.body, 'caché');
});

await check('el navegador abre la página: /uso, ruta y botón', () => {
  assert(cockpitUrl(7788, 'uso').endsWith('/#/uso'), 'ruta');
  const md = readFileSync(join(REPO, '.claude', 'commands', 'uso.md'), 'utf8');
  assert(md.includes('node src/cockpit.js open uso'), 'comando');
  const html = readFileSync(join(REPO, 'cockpit', 'public', 'index.html'), 'utf8');
  assert(html.includes('id="btn-uso"') && html.includes('id="view-uso"'), 'botón');
  const caps = JSON.parse(readFileSync(join(REPO, 'cockpit', 'public', 'capacidades.json'), 'utf8'));
  assert(caps.cards.some(c => c.id === 'uso'), 'tarjeta');
  assert(JSON.parse(readFileSync(join(REPO, 'modulos.json'), 'utf8')).modules.uso, 'módulo');
});

await check('fmt: números cortos', () => {
  eq(fmt(950), '950', 'unidades');
  eq(fmt(12400), '12 K', 'miles');
  eq(fmt(3450000), '3,5 M', 'millones');
  eq(fmt(null), 's/d', 'nulo');
});

await new Promise(done => server.close(done));
try { rmSync(base, { recursive: true, force: true }); } catch { /* Windows puede tardar en soltar archivos */ }

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
