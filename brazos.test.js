// brazos.test.js
// Verifica el directorio de brazos (brazos/directorio.json) y src/brazos.js:
//   1. El directorio valida contra su schema y tiene la cobertura mínima.
//   2. status con checks simulados (sin red, sin `claude mcp list` real).
//   3. suggest rankea por keywords + categoría.
//   4. connect solo imprime; mcp-json no escribe sin --write y nunca mete keys.
// No gasta plata ni toca la configuración del usuario.

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadDirectorio, validateDirectorio, evaluateEntry, statusAll, formatStatusTable,
  mcpStateFromList, suggest, connectSteps, buildMcpJson, cliMain, ESTADOS,
} from './src/brazos.js';

let passed = 0;
let failed = 0;
const fails = [];
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); passed += 1; }
  catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); fails.push(label); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }

let entries = [];

// ---------- 1. directorio ----------

check('directorio.json valida contra el schema', () => {
  entries = loadDirectorio();
  assert(entries.length >= 30, `solo ${entries.length} entradas`);
});

check('cubre todas las categorías clave', () => {
  const cats = new Set(entries.map(e => e.categoria));
  for (const c of ['web', 'datos', 'research', 'creativo-imagen', 'creativo-video', 'creativo-3d', 'audio', 'marketing', 'trading', 'productividad', 'deploy']) {
    assert(cats.has(c), `falta categoría ${c}`);
  }
});

check('entradas requeridas por el brief existen', () => {
  const ids = new Set(entries.map(e => e.id));
  for (const id of ['playwright-mcp', 'vercel-mcp', 'supabase-mcp', 'context7', 'hyperframes', 'video-effects-library', 'higgsfield', 'blender-mcp', 'meta-ads-pipeboard', 'research-openrouter', 'openai-gpt-image', 'canva']) {
    assert(ids.has(id), `falta ${id}`);
  }
});

check('gotchas conocidos documentados (.vercelignore y DLL jiter)', () => {
  const v = entries.find(e => e.id === 'vercel-mcp');
  assert(/vercelignore/.test(v.riesgos), 'vercel-mcp sin nota de .vercelignore');
  const o = entries.find(e => e.id === 'openai-gpt-image');
  assert(/jiter/.test(o.riesgos), 'openai-gpt-image sin nota de jiter');
});

check('terceros no oficiales están marcados oficial=false', () => {
  for (const id of ['meta-ads-pipeboard', 'blender-mcp']) {
    assert(entries.find(e => e.id === id).oficial === false, `${id} debería ser no oficial`);
  }
});

check('validador detecta errores (id duplicado, tipo inválido, env sin check)', () => {
  const bad = { version: '1', actualizado: '2026-10-30', entradas: [entries[0], { ...entries[0], tipo: 'robot' }] };
  const errs = validateDirectorio(bad);
  assert(errs.some(e => /duplicado/.test(e)), 'no detectó duplicado');
  assert(errs.some(e => /tipo/.test(e)), 'no detectó tipo inválido');
  const e2 = { ...entries[0], id: 'x-env', auth: { necesita: true, credencial: 'k', env_var: 'FOO_KEY' } };
  assert(validateDirectorio({ version: '1', actualizado: '2026-10-30', entradas: [e2] }).some(e => /FOO_KEY/.test(e)), 'no detectó env_var sin check');
});

check('bloques mcp nunca traen valores de keys (solo ${VAR})', () => {
  for (const e of entries.filter(x => x.mcp)) {
    const txt = JSON.stringify(e.mcp);
    assert(!/sk-|fc-[a-z0-9]{6}|ghp_/i.test(txt), `${e.id} parece traer una key literal`);
  }
});

// ---------- 2. status con checks simulados ----------

const MCP_LIST = [
  'Checking MCP server health…',
  'claude.ai Canva: https://mcp.canva.com/mcp - ✔ Connected',
  'higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ! Needs authentication',
  'tradingview: node server.js - ⏸ Pending approval (run `claude` to approve)',
  'playwright: npx @playwright/mcp@latest - ✗ Failed to connect',
].join('\n');

function fakeCtx({ env = {}, path = [], files = [], plugins = [], mcp = MCP_LIST } = {}) {
  return {
    env: k => Boolean(env[k]),
    mcpList: () => mcp,
    which: c => path.includes(c),
    exists: p => files.includes(p),
    plugin: n => plugins.includes(n),
  };
}

check('mcpStateFromList: conectado, auth, pendiente, falla, ausente', () => {
  assert(mcpStateFromList(MCP_LIST, 'canva') === 'ok', 'canva');
  assert(mcpStateFromList(MCP_LIST, 'higgsfield') === 'auth', 'higgsfield');
  assert(mcpStateFromList(MCP_LIST, 'tradingview') === 'auth', 'tradingview');
  assert(mcpStateFromList(MCP_LIST, 'playwright') === 'falla', 'playwright');
  assert(mcpStateFromList(MCP_LIST, 'vercel') === null, 'vercel');
  assert(mcpStateFromList(null, 'vercel') === null, 'null list');
});

check('status: conectado / falta auth / no instalado / revisar', () => {
  const byId = id => entries.find(e => e.id === id);
  const ctx = fakeCtx({ files: ['src/research.js', 'scripts/openai_images.py'], env: { OPENROUTER_API_KEY: 1 }, path: ['vercel'] });
  assert(evaluateEntry(byId('canva'), ctx).estado === ESTADOS.conectado, 'canva conectado');
  assert(evaluateEntry(byId('higgsfield'), ctx).estado === ESTADOS.falta_auth, 'higgsfield falta auth');
  assert(evaluateEntry(byId('research-openrouter'), ctx).estado === ESTADOS.conectado, 'research conectado');
  assert(evaluateEntry(byId('openai-gpt-image'), ctx).estado === ESTADOS.falta_auth, 'openai falta auth');
  assert(evaluateEntry(byId('vercel-mcp'), ctx).estado === ESTADOS.no_instalado, 'vercel-mcp no instalado');
  assert(evaluateEntry(byId('vercel-cli'), ctx).estado === ESTADOS.conectado, 'vercel-cli conectado');
  assert(evaluateEntry(byId('playwright-mcp'), ctx).estado === ESTADOS.revisar, 'playwright falla → revisar');
  assert(evaluateEntry(byId('remotion'), ctx).estado === ESTADOS.revisar, 'remotion manual');
});

check('status sin `claude mcp list` deja los MCP en "revisar a mano"', () => {
  const r = evaluateEntry(entries.find(e => e.id === 'vercel-mcp'), fakeCtx({ mcp: null }));
  assert(r.estado === ESTADOS.revisar, r.estado);
});

check('status nunca imprime valores de variables', () => {
  const ctx = fakeCtx({ env: { OPENROUTER_API_KEY: 'sk-or-v1-SECRETO' } });
  const table = formatStatusTable(statusAll(entries, ctx));
  assert(!table.includes('SECRETO'), 'imprimió el valor');
  assert(/Conectados: \d+/.test(table), 'sin resumen');
});

// ---------- 3. suggest ----------

const CAFE = 'Landing + mini app para una cafetería de barrio en Santiago que quiere pedidos online, con fotos generadas por IA y un video corto para Instagram';

check('suggest (cafetería) trae pagos, datos, imagen y video', () => {
  const ids = suggest(CAFE, entries, { limit: 10 }).map(s => s.id);
  for (const id of ['mercadopago', 'supabase-mcp', 'openai-gpt-image', 'hyperframes']) assert(ids.includes(id), `falta ${id} en ${ids.join(',')}`);
  assert(!ids.includes('tradingview-mcp') && !ids.includes('blender-mcp'), `trajo irrelevantes: ${ids.join(',')}`);
});

check('suggest da razón por entrada y respeta el tope por categoría', () => {
  const top = suggest(CAFE, entries, { limit: 20, perCategory: 2 });
  const counts = {};
  for (const s of top) {
    assert(/Porque/.test(s.razon), `sin razón: ${s.id}`);
    counts[s.categoria] = (counts[s.categoria] || 0) + 1;
  }
  assert(Object.values(counts).every(n => n <= 2), JSON.stringify(counts));
});

check('suggest (trading) prioriza trading y no web', () => {
  const ids = suggest('backtest de bitcoin en tradingview', entries, { limit: 3 }).map(s => s.id);
  assert(ids[0] === 'tradingview-mcp', ids.join(','));
});

check('suggest sin señales devuelve vacío', () => {
  assert(suggest('zzz qqq', entries).length === 0, 'debería ser vacío');
});

// ---------- 4. connect y mcp-json ----------

check('connect imprime pasos, aviso de no-instalación y nota de no verificado', () => {
  const txt = connectSteps(entries.find(e => e.id === 'google-ads-mcp'));
  assert(/no instala nada/.test(txt), 'sin aviso');
  assert(/NO está verificado/.test(txt), 'sin aviso de no verificado');
  assert(/1\. /.test(txt), 'sin pasos numerados');
});

check('buildMcpJson: http, sse, stdio con ${VAR} y salta no-MCP', () => {
  const pick = ids => ids.map(id => entries.find(e => e.id === id));
  const { json, skipped } = buildMcpJson(pick(['vercel-mcp', 'replicate', 'firecrawl', 'canva']));
  assert(json.mcpServers.vercel.type === 'http', 'vercel http');
  assert(json.mcpServers.replicate.type === 'sse', 'replicate sse');
  assert(json.mcpServers.firecrawl.env.FIRECRAWL_API_KEY === '${FIRECRAWL_API_KEY}', 'firecrawl env');
  assert(skipped.includes('canva'), 'canva debía saltarse');
});

check('CLI mcp-json no escribe sin --write y sí con --write (fusiona lo existente)', () => {
  const root = mkdtempSync(join(tmpdir(), 'brazos-'));
  try {
    const out = [];
    const log = s => out.push(s);
    assert(cliMain(['mcp-json', 'vercel-mcp'], { entries, root, log }) === 0, 'exit');
    assert(!existsSync(join(root, '.mcp.json')), 'escribió sin --write');
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { propio: { type: 'http', url: 'https://x.test' } } }));
    assert(cliMain(['mcp-json', 'vercel-mcp', 'notion-mcp', '--write'], { entries, root, log }) === 0, 'exit write');
    const j = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    assert(j.mcpServers.propio && j.mcpServers.vercel && j.mcpServers.notion, JSON.stringify(j));
    assert(cliMain(['mcp-json', 'no-existe'], { entries, root, log }) === 1, 'id inválido debería fallar');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

check('CLI status y suggest --json funcionan con contexto simulado', () => {
  const out = [];
  assert(cliMain(['status'], { entries, ctx: fakeCtx(), log: s => out.push(s) }) === 0, 'status');
  assert(/estado/.test(out[0]), 'tabla sin encabezado');
  const out2 = [];
  assert(cliMain(['suggest', CAFE, '--json'], { entries, ctx: fakeCtx(), log: s => out2.push(s) }) === 0, 'suggest');
  const arr = JSON.parse(out2[0]);
  assert(arr.length && arr[0].connect.startsWith('node src/brazos.js connect'), 'sin comando connect');
  assert(arr.every(s => s.estado), 'sin estado con ctx');
});

console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
