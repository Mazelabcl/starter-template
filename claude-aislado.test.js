// claude-aislado.test.js
// Tests de src/claude_aislado.js (sesiones hijas aisladas) y src/presupuesto.js.
// Sin red y sin Claude real: el proceso hijo se simula con un EventEmitter que emite
// líneas de stream-json. Verifica flags de aislamiento, esfuerzo explícito, medición
// (contexto inicial/pico, total del resultado, ventana), límite de uso, timeout que
// mata el árbol de procesos y el presupuesto visible. Idioma: español neutro.

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AISLAMIENTO, buildArgs, childEnv, detectaLimite, nuevoMedidor, runAislado, killTree, resolveClaudeBin,
} from './src/claude_aislado.js';
import { sesion, presupuestoRondas, presupuestoEntrevista, textoPresupuesto, PERFILES } from './src/presupuesto.js';
import { ventanaCalibrada, cargaUSD } from './src/uso.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

const LIMIT_TEXT = "You've hit your 5-hour limit · resets 1pm (America/Santiago)";
const asst = (id, ctx, out, content = [{ type: 'text', text: 'ok' }]) => JSON.stringify({
  type: 'assistant', message: { id, model: 'claude-sonnet-5-5', content, usage: { input_tokens: 2, cache_creation_input_tokens: ctx - 2, cache_read_input_tokens: 0, output_tokens: out } },
});
const STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read'], mcp_servers: [], model: 'claude-sonnet-5-5', apiKeySource: 'none' }),
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1794016800 } } } }),
  asst('m1', 6000, 16, [{ type: 'tool_use', name: 'Read' }]),
  asst('m1', 6000, 16, [{ type: 'tool_use', name: 'Read' }]),
  asst('m2', 9000, 3),
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: 1794016800 } } } }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: 'Titular: algo', total_cost_usd: 0.05, usage: { input_tokens: 4, cache_creation_input_tokens: 9000, cache_read_input_tokens: 5996, output_tokens: 2400 } }),
];

/** Hijo falso: emite `lines` y cierra con `code`, salvo `hang` (no termina hasta que lo maten). */
function fakeSpawn({ lines = STREAM, code = 0, hang = false, calls = [] } = {}) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = data => { calls.push({ cmd, args, opts, stdin: data }); };
    child.kill = () => {};
    if (!hang) {
      setTimeout(() => {
        // Llega en trozos que cortan líneas a la mitad, como en la vida real.
        const all = `${lines.join('\n')}\n`;
        const mid = Math.floor(all.length / 2);
        child.stdout.emit('data', Buffer.from(all.slice(0, mid)));
        child.stdout.emit('data', Buffer.from(all.slice(mid)));
        child.emit('close', code);
      }, 5);
    } else child.die = () => child.emit('close', null);
    return child;
  };
}

const bin = { cmd: 'claude.exe', shell: false };

await check('buildArgs: aislamiento verificado (--safe-mode, --strict-mcp-config), herramientas, turnos y esfuerzo', () => {
  const a = buildArgs({ model: 'opus', tools: ['Read'], effort: 'high', maxTurns: 6, systemPromptFile: 'sp.md', addDirs: ['shots'] });
  for (const f of AISLAMIENTO) assert(a.includes(f), `falta ${f}`);
  assert(!a.includes('--bare'), '--bare no autentica con login de suscripción');
  assert(a[a.indexOf('--tools') + 1] === 'Read', 'herramientas');
  assert(a[a.indexOf('--max-turns') + 1] === '6' && a[a.indexOf('--effort') + 1] === 'high', 'turnos/esfuerzo');
  assert(a.includes('--system-prompt-file') && a.includes('--add-dir') && a.includes('stream-json') && a.includes('--verbose'), JSON.stringify(a));
  const sin = buildArgs({ model: 'haiku', tools: [] });
  assert(sin[sin.indexOf('--tools') + 1] === '', 'sin herramientas = --tools ""');
  let msg = '';
  try { buildArgs({ model: 'opus', effort: 'altisimo' }); } catch (e) { msg = e.message; }
  assert(/effort inválido/.test(msg), msg);
});

await check('childEnv: la hija no hereda CLAUDE_EFFORT de la sesión madre', () => {
  const e = childEnv({ CLAUDE_EFFORT: 'max', PATH: 'x' });
  assert(!('CLAUDE_EFFORT' in e) && e.PATH === 'x', JSON.stringify(e));
});

await check('detectaLimite: reconoce el aviso real de Weddi y no confunde texto normal', () => {
  assert(detectaLimite(`algo\n${LIMIT_TEXT}\nmás`) === LIMIT_TEXT, 'aviso real');
  assert(detectaLimite('API Error: usage_limit_reached'), 'código de error');
  assert(!detectaLimite('Respeta el límite de 5 cambios por ronda'), 'falso positivo');
});

await check('medidor: contexto inicial y pico del stream; totales del resultado (la salida del stream es parcial)', () => {
  const m = nuevoMedidor();
  STREAM.forEach(l => m.feed(l));
  const s = m.summary();
  assert(s.requests === 2 && s.usage.first_context === 6000 && s.usage.peak_context === 9000, JSON.stringify(s.usage));
  assert(s.usage.output === 2400 && s.usage.total === 4 + 9000 + 5996 + 2400, `total del resultado: ${JSON.stringify(s.usage)}`);
  assert(s.window.first === 0.1 && s.window.last === 0.12 && s.window.resets_at === 1794016800, JSON.stringify(s.window));
  assert(s.num_turns === 3 && s.cost_usd === 0.05 && !s.limit.hit && s.init.tools[0] === 'Read', JSON.stringify(s));
});

await check('runAislado: prompt por stdin, sin shell, ok con métricas y log del stream', async () => {
  const calls = [];
  const dir = mkdtempSync(join(tmpdir(), 'aislado-'));
  const log = join(dir, 'log.jsonl');
  const r = await runAislado({ prompt: 'hola', model: 'sonnet', tools: ['Read'], bin, spawnFn: fakeSpawn({ calls }), logFile: log, env: {} });
  assert(r.ok && r.usage.first_context === 6000 && r.result === 'Titular: algo', JSON.stringify(r));
  assert(calls[0].stdin === 'hola' && calls[0].cmd === 'claude.exe' && calls[0].args.includes('--safe-mode') && !calls[0].opts.shell, JSON.stringify(calls[0]));
  await new Promise(res => setTimeout(res, 20));
  assert(readFileSync(log, 'utf8').includes('"rate_limit_event"'), 'log del stream');
});

await check('runAislado: límite de uso → ok=false y limit.hit (para reintentar, no rechazar)', async () => {
  const lines = [
    JSON.stringify({ type: 'assistant', apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: { resetsAt: 1793980800 } }, error: 'rate_limit', isApiErrorMessage: true, message: { id: 'x', model: '<synthetic>', content: [{ type: 'text', text: LIMIT_TEXT }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, result: LIMIT_TEXT, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } }),
  ];
  const r = await runAislado({ prompt: 'x', model: 'opus', bin, spawnFn: fakeSpawn({ lines }), env: {} });
  assert(!r.ok && r.limit.hit && r.limit.resets_at === 1793980800 && /hit your 5-hour limit/.test(r.limit.message), JSON.stringify(r.limit));
});

await check('runAislado: timeout real → mata el árbol de procesos y marca timed_out', async () => {
  let killed = null;
  let child;
  const spawnFn = (...a) => { child = fakeSpawn({ hang: true })(...a); return child; };
  const killFn = c => { killed = c.pid; c.die(); };
  const r = await runAislado({ prompt: 'x', model: 'opus', bin, spawnFn, killFn, timeoutMs: 30, env: {} });
  assert(killed === 4242 && r.timed_out && !r.ok, JSON.stringify({ killed, t: r.timed_out }));
});

await check('killTree: en Windows usa taskkill /T /F (child.kill deja nietos vivos)', () => {
  const calls = [];
  killTree({ pid: 77, kill() {} }, { platform: 'win32', run: (c, a) => calls.push([c, ...a]) });
  assert(calls[0].join(' ') === 'taskkill /pid 77 /T /F', JSON.stringify(calls));
});

await check('resolveClaudeBin: en Windows lanza el claude.exe del shim npm (sin shell)', () => {
  const env = { PATH: ['C:\\x', 'C:\\npm'].join(';') };
  const exists = p => p === join('C:\\npm', 'claude.cmd') || p === join('C:\\npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  const r = resolveClaudeBin({ env, platform: 'win32', exists });
  assert(r.cmd.endsWith('claude.exe') && !r.shell, JSON.stringify(r));
  assert(resolveClaudeBin({ env: { CLAUDE_BIN: 'C:\\otro\\claude.cmd' } }).shell, 'override .cmd necesita shell');
});

// ---------------------------------------------------------------- presupuesto
await check('presupuesto: sesión con contexto creciente (Σ contexto + salida)', () => {
  const s = sesion({ requests: 3, first: 1000, growth: 100, output: 50 });
  assert(s.total === 1000 + 1100 + 1200 + 50 && s.cache_write === 1200 && s.cache_read === 3300 - 1200, JSON.stringify(s));
});

await check('presupuesto de rondas: por variante muy por debajo de Weddi y con % de la ventana', () => {
  const v = { carga_usd: 100, tokens: 100e6, fuente: 'test' };
  const p = presupuestoRondas({ rondas: 3, ventana: v });
  assert(p.por_variante.tokens * 10 < p.weddi_por_variante.tokens, JSON.stringify(p.por_variante));
  assert(p.pct_ventana > 0 && p.pct_ventana < 100 && p.partes.length === 3, JSON.stringify(p));
  const t = textoPresupuesto(p);
  assert(/ESTIMACIÓN/.test(t) && /% de una ventana de 5 h/.test(t) && /Weddi/.test(t), t);
  // Opus para construir cuesta más que Sonnet (el usuario elige, pero lo ve).
  assert(presupuestoRondas({ modeloConstruir: 'opus', ventana: v }).carga_usd > presupuestoRondas({ modeloConstruir: 'sonnet', ventana: v }).carga_usd, 'opus > sonnet');
});

await check('presupuesto de entrevista: separa tokens del plan y USD de OpenRouter', () => {
  const v = { carga_usd: 100, tokens: 100e6, fuente: 'test' };
  const p = presupuestoEntrevista({ coaches: 2, audiencia: 2, rutaCoaches: 'claude', rutaAudiencia: 'openrouter', precioOpenRouter: () => 0.001, ventana: v });
  assert(p.plan.length === 1 && p.openrouter.length === 1 && p.usd_openrouter === 0.004 && p.llamadas === 8 && p.sesiones_completas_antes === 11, JSON.stringify(p));
  assert(/OpenRouter/.test(textoPresupuesto(p)), 'muestra el USD aparte');
});

await check('ventana: usa el archivo calibrado si existe; si no, el valor por defecto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ventana-'));
  const f = join(dir, 'uso-ventana.json');
  assert(ventanaCalibrada(f).carga_usd > 0, 'por defecto');
  writeFileSync(f, JSON.stringify({ carga_usd: 77, tokens: 1e6, fuente: 'x' }));
  assert(ventanaCalibrada(f).carga_usd === 77, 'archivo');
  assert(Math.abs(cargaUSD({ input: 1e6 }, 'claude-opus-5-5') - 4) < 1e-9 && cargaUSD({ cache_read: 1e6 }, 'sonnet') === 0.2, 'pesos');
});

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
// Perfiles exportados (los usa la doc): que existan los cuatro.
void PERFILES;
