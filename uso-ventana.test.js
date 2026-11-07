// uso-ventana.test.js
// src/uso.js: calibración de la ventana de 5 h con los cortes por límite de las
// transcripciones (y la utilización real como punto vivo) y el aviso de MCP globales.
// Sin red: transcripciones y carpetas falsas en un directorio temporal. Verifica que
// solo se lean números y nombres (nunca comandos, variables ni claves).
// Idioma: español neutro.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { calibrarVentana, mcpGlobales, lineasMcp, cargaUSD, reporteProyecto, textoProyecto, paraWeb } from './src/uso.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

const AHORA = Date.parse('2026-11-06T20:00:00Z');
const RESET = Date.parse('2026-11-06T16:00:00Z') / 1000; // ventana 11:00-16:00 UTC
const ts = h => new Date(Date.parse('2026-11-06T00:00:00Z') + h * 3600000).toISOString();
const asst = (id, h, model, u) => JSON.stringify({ type: 'assistant', timestamp: ts(h), message: { id, model, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, ...u } } });
const corte = h => JSON.stringify({ type: 'assistant', timestamp: ts(h), apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: { rateLimitType: 'five_hour', resetsAt: RESET } }, message: { id: `lim-${h}`, model: '<synthetic>', content: [{ type: 'text', text: "You've hit your 5-hour limit" }], usage: { input_tokens: 0, output_tokens: 0 } } });

const DIR = mkdtempSync(join(tmpdir(), 'uso-ventana-'));
mkdirSync(join(DIR, 'proy-a', 'ses1', 'subagents'), { recursive: true });
writeFileSync(join(DIR, 'proy-a', 'ses1.jsonl'), [
  asst('a', 9, 'claude-opus-5-5', { input_tokens: 1e6 }), // antes de la ventana: no cuenta
  asst('b', 12, 'claude-opus-5-5', { cache_read_input_tokens: 10e6 }), // 10M * 0,1 * 4 = 4
  asst('b', 12, 'claude-opus-5-5', { cache_read_input_tokens: 10e6 }), // repetido por streaming: una vez
  corte(14),
  corte(14.5), // mismo corte, más tarde: se queda el primero
  asst('d', 15, 'claude-opus-5-5', { output_tokens: 1e6 }), // después del corte: no cuenta
].join('\n'));
writeFileSync(join(DIR, 'proy-a', 'ses1', 'subagents', 'agent-x.jsonl'), asst('c', 13, 'claude-sonnet-5-5', { output_tokens: 1e6 })); // 1M * 5 * 2 = 10

await check('calibrarVentana: suma TODAS las sesiones (subagentes incluidos) entre el inicio de la ventana y el primer corte', async () => {
  const r = await calibrarVentana({ claudeDir: DIR, dias: 14, ahora: AHORA });
  assert(r.cortes.length === 1, JSON.stringify(r.cortes));
  const c = r.cortes[0];
  assert(c.llamadas === 2 && c.tokens.cache_read === 10e6 && c.tokens.output === 1e6, JSON.stringify(c));
  assert(c.carga_usd === 14 && r.ventana.carga_usd === 14 && /estimación/.test(r.ventana.fuente) && /Estimación/.test(r.aviso), JSON.stringify(r.ventana));
});

await check('calibrarVentana: punto vivo = carga de la ventana actual / utilización real', async () => {
  const r = await calibrarVentana({ claudeDir: DIR, dias: 14, ahora: Date.parse('2026-11-06T14:30:00Z'), vivo: { utilization: 0.1, resets_at: RESET } });
  assert(r.vivo && r.vivo.ventana_carga_usd === 140 && r.ventana.carga_usd === 77, JSON.stringify({ vivo: r.vivo, v: r.ventana }));
  const sinVivo = await calibrarVentana({ claudeDir: DIR, ahora: AHORA, vivo: { utilization: 0.01, resets_at: RESET } });
  assert(!sinVivo.vivo, 'con < 5 % el redondeo es demasiado grande');
});

await check('cargaUSD: pondera por precio de lista (Opus 4, Sonnet 2, Haiku 0,1; salida x5; relectura x0,1; caché 5 min x1,25)', () => {
  assert(cargaUSD({ output: 1e6 }, 'claude-haiku-5-5') === 0.5, 'haiku');
  assert(cargaUSD({ cache_write: 1e6, cache_write_5m: 1e6 }, 'sonnet') === 2.5 && cargaUSD({ cache_write: 1e6 }, 'sonnet') === 4, 'escrituras');
});

const HOME = mkdtempSync(join(tmpdir(), 'uso-home-'));
const PROY = join(HOME, 'scratch', 'proyecto');
mkdirSync(PROY, { recursive: true });
writeFileSync(join(HOME, '.mcp.json'), JSON.stringify({ mcpServers: { tradingview: { command: 'node', env: { TV_TOKEN: 'secreto-123' } } } }));
writeFileSync(join(HOME, '.claude.json'), JSON.stringify({ mcpServers: { github: { command: 'gh', env: { GH_TOKEN: 'otro-secreto' } } }, projects: {} }));
writeFileSync(join(PROY, '.mcp.json'), JSON.stringify({ mcpServers: { propio: {} } }));

await check('mcpGlobales: avisa de los MCP de usuario y de carpetas superiores; ignora el del proyecto; nunca valores', () => {
  const l = mcpGlobales({ root: PROY, home: HOME });
  const nombres = l.flatMap(m => m.servidores).sort().join(',');
  assert(nombres === 'github,tradingview', nombres);
  const txt = lineasMcp(l).join('\n') + JSON.stringify(l);
  assert(/TODOS los proyectos/.test(txt) && !/secreto|TV_TOKEN|GH_TOKEN|command/.test(txt), txt);
  assert(lineasMcp([]).length === 0, 'sin MCP globales no hay aviso');
});

await check('/uso: el reporte trae el aviso de MCP globales (terminal con ruta; web solo nombres)', async () => {
  const r = await reporteProyecto({ root: PROY, claudeDir: DIR, home: HOME });
  assert(r.mcp_globales.length === 2, JSON.stringify(r.mcp_globales));
  const web = paraWeb(r);
  assert(web.mcp_globales.every(m => !('origen' in m)), 'la página no muestra rutas');
  const t = textoProyecto({ ...r, totales: { ...r.totales, total: 1 } });
  assert(/MCP que cargan en TODOS los proyectos/.test(t) && t.includes(join(HOME, '.mcp.json')) && /tradingview/.test(t), t.slice(-600));
});

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
