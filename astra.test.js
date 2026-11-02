// astra.test.js
// Verifica src/astra.js (puente automático con Codex) SIN llamar a Codex:
// el proceso `codex exec` y el estado de sesión se simulan (execCodex/status).
//   1. Validación del pedido, nombres de salida, instrucción y argumentos.
//   2. pedir(): caso feliz, renombrado, rescate desde generated_images, timeout.
//   3. Errores claros cuando Codex no está instalado o no tiene sesión.
//   4. lote() respeta la concurrencia; CLI estado/pedir.
//   5. Integración: brazos detecta Codex, .gitignore, skill ≤ 80 líneas.
// No gasta plata ni toca la configuración del usuario.

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizarPedido, nombresSalida, buildInstruction, buildCodexArgs, parseEvents,
  pedir, lote, codexStatus, findCodex, cliMain, isPng, AstraError,
} from './src/astra.js';
import { evaluateEntry, loadDirectorio, ESTADOS } from './src/brazos.js';

let passed = 0;
let failed = 0;
const fails = [];
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; }
  catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); fails.push(label); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const OK_STATUS = { instalado: true, logueado: true, version: '0.0.0-test', bin: 'codex-falso', detalle: 'ok', arreglo: null };
const tmps = [];
function tmpRoot() { const d = mkdtempSync(join(tmpdir(), 'astra-test-')); tmps.push(d); return d; }
const events = thread => `${JSON.stringify({ type: 'thread.started', thread_id: thread })}\n${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'listo' } })}\n`;
/** Codex falso: escribe los nombres que pide la instrucción en cwd. */
function fakeExec({ write = 'expected', thread = 'th-1', codexHome = null, timedOut = false, calls = null } = {}) {
  return async ({ args, input, cwd }) => {
    calls?.push({ args, input, cwd });
    const names = [...input.matchAll(/^- (\S+\.png)$/gm)].map(m => m[1]);
    if (write === 'expected') for (const n of names) writeFileSync(join(cwd, n), PNG);
    if (write === 'otro') writeFileSync(join(cwd, 'otro-nombre.png'), PNG);
    if (write === 'home') {
      const d = join(codexHome, 'generated_images', thread);
      mkdirSync(d, { recursive: true });
      names.forEach((_, i) => writeFileSync(join(d, `exec-${i}.png`), PNG));
    }
    return { code: timedOut ? null : 0, stdout: events(thread), stderr: '', timedOut };
  };
}

try {
  // ---------- 1. pedido ----------
  await check('normalizarPedido valida prompt, out, n, size y refs', () => {
    const root = tmpRoot();
    const bad = [{ out: 'x' }, { prompt: 'p' }, { prompt: 'p', out: 'x', n: 9 }, { prompt: 'p', out: 'x', size: '5:7' }, { prompt: 'p', out: 'x', refs: 'no-existe.png' }];
    for (const o of bad) {
      let threw = false;
      try { normalizarPedido(o, { root }); } catch (e) { threw = e instanceof AstraError; }
      assert(threw, `debió fallar: ${JSON.stringify(o)}`);
    }
    writeFileSync(join(root, 'ref.png'), PNG);
    const p = normalizarPedido({ prompt: 'p', out: 'assets/astra/Logo Café/', refs: 'ref.png', n: '2', size: '16:9' }, { root });
    assert(p.slug === 'logo-cafe', p.slug);
    assert(p.tipo === 'crear-con-refs' && p.cantidad === 2 && p.refs[0] === join(root, 'ref.png'));
  });

  await check('nombresSalida sigue la convención del puente manual y no sobrescribe', () => {
    const p = { slug: 'logo', cantidad: 1 };
    assert(nombresSalida(p, [])[0] === 'logo_v1.png');
    assert(nombresSalida(p, ['logo_v1.png', 'logo_v2-b.png'])[0] === 'logo_v3.png');
    const multi = nombresSalida({ slug: 'logo', cantidad: 3 }, []);
    assert(multi.join(',') === 'logo_v1-a.png,logo_v1-b.png,logo_v1-c.png', multi.join(','));
  });

  await check('instrucción y argumentos de codex exec', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'a.png'), PNG);
    const p = normalizarPedido({ prompt: 'a flat orange circle', out: 'o', refs: 'a.png', size: '9:16' }, { root });
    const ins = buildInstruction(p, ['o_v1.png']);
    assert(ins.includes('a flat orange circle') && ins.includes('- o_v1.png') && ins.includes('Image 1 = a.png') && ins.includes('vertical 9:16'));
    const args = buildCodexArgs(p);
    for (const a of ['exec', '--json', '--skip-git-repo-check', 'workspace-write', '-C', p.out, '-i', join(root, 'a.png')]) assert(args.includes(a), `falta ${a}`);
    assert(args[args.length - 1] === '-', 'el prompt va por stdin');
    assert(!args.includes('--dangerously-bypass-approvals-and-sandbox'), 'nunca sin sandbox');
  });

  await check('parseEvents lee thread, mensajes y errores', () => {
    const ev = parseEvents(`${events('abc')}basura\n{"type":"error","message":"usage limit reached"}\n`);
    assert(ev.threadId === 'abc' && ev.mensajes[0] === 'listo' && /usage limit/.test(ev.errores[0]));
  });

  // ---------- 2. pedir ----------
  await check('pedir: caso feliz escribe PNG, pedido y resultado', async () => {
    const root = tmpRoot();
    const calls = [];
    const r = await pedir({ prompt: 'circle', out: 'assets/astra/circ/', n: 2 }, { root, status: OK_STATUS, execCodex: fakeExec({ calls }), codexHome: join(root, 'home') });
    assert(r.estado === 'ok', JSON.stringify(r));
    assert(r.archivos.length === 2 && r.archivos.every(a => isPng(join(root, a))), r.archivos.join(','));
    assert(calls.length === 1 && calls[0].cwd === join(root, 'assets', 'astra', 'circ'));
    const res = JSON.parse(readFileSync(join(root, 'astra-bridge', 'resultados', `${r.id}.json`), 'utf8'));
    const ped = JSON.parse(readFileSync(join(root, 'astra-bridge', 'pedidos', `${r.id}.json`), 'utf8'));
    assert(res.estado === 'ok' && res.codex.thread_id === 'th-1' && typeof res.duracion_s === 'number');
    assert(ped.estado === 'entregado' && ped.out === 'assets/astra/circ' && ped.prompt === 'circle');
  });

  await check('pedir: renombra si Codex usó otro nombre', async () => {
    const root = tmpRoot();
    const r = await pedir({ prompt: 'x', out: 'o' }, { root, status: OK_STATUS, execCodex: fakeExec({ write: 'otro' }), codexHome: join(root, 'h') });
    assert(r.estado === 'ok' && r.archivos[0] === 'o/o_v1.png' && r.notas.length === 1, JSON.stringify(r));
    assert(!existsSync(join(root, 'o', 'otro-nombre.png')));
  });

  await check('pedir: rescata desde ~/.codex/generated_images/<thread> si Codex no copió', async () => {
    const root = tmpRoot();
    const home = join(root, 'codex-home');
    const r = await pedir({ prompt: 'x', out: 'o', n: 2 }, { root, status: OK_STATUS, execCodex: fakeExec({ write: 'home', thread: 't9', codexHome: home }), codexHome: home });
    assert(r.estado === 'ok' && r.archivos.length === 2, JSON.stringify(r));
    assert(/rescatado/.test(r.notas[0]));
  });

  await check('pedir: timeout queda como error con mensaje claro', async () => {
    const root = tmpRoot();
    const r = await pedir({ prompt: 'x', out: 'o', timeout: 1 }, { root, status: OK_STATUS, execCodex: fakeExec({ write: 'nada', timedOut: true }), codexHome: join(root, 'h') });
    assert(r.estado === 'error' && /tiempo/.test(r.error), JSON.stringify(r));
    const ped = JSON.parse(readFileSync(join(root, 'astra-bridge', 'pedidos', `${r.id}.json`), 'utf8'));
    assert(ped.estado === 'error');
  });

  await check('pedir: nunca sobrescribe una versión anterior', async () => {
    const root = tmpRoot();
    const deps = { root, status: OK_STATUS, execCodex: fakeExec(), codexHome: join(root, 'h') };
    const a = await pedir({ prompt: 'x', out: 'o', id: 'uno' }, deps);
    const b = await pedir({ prompt: 'x', out: 'o', id: 'dos' }, deps);
    assert(a.archivos[0] === 'o/o_v1.png' && b.archivos[0] === 'o/o_v2.png', `${a.archivos} ${b.archivos}`);
  });

  // ---------- 3. errores de instalación / sesión ----------
  await check('sin Codex o sin sesión: AstraError con el comando para arreglarlo', async () => {
    const root = tmpRoot();
    const noInst = codexStatus({ bin: null });
    const noSes = codexStatus({ bin: 'C:\\Program Files\\Codex\\codex.exe', run: a => (a[0] === '--version' ? { code: 0, out: 'codex-cli 1.2.3' } : { code: 1, out: 'Not logged in' }) });
    assert(!noInst.instalado && /npm i -g @openai\/codex/.test(noInst.arreglo));
    assert(noSes.instalado && !noSes.logueado && noSes.version === '1.2.3');
    assert(noSes.arreglo.includes('& "C:\\Program Files\\Codex\\codex.exe" login'), noSes.arreglo);
    for (const [st, code] of [[noInst, 'no-instalado'], [noSes, 'sin-sesion']]) {
      let err = null;
      try { await pedir({ prompt: 'x', out: 'o' }, { root, status: st, execCodex: () => { throw new Error('no debía llamar'); } }); } catch (e) { err = e; }
      assert(err instanceof AstraError && err.codigo === code && err.arreglo, `esperaba ${code}`);
    }
    const ok = codexStatus({ bin: 'codex', run: a => (a[0] === '--version' ? { code: 0, out: 'codex-cli 0.166.0' } : { code: 0, out: 'Logged in using ChatGPT' }) });
    assert(ok.logueado && /ChatGPT/.test(ok.detalle));
  });

  await check('findCodex: env > PATH > app de escritorio', () => {
    const yes = () => true;
    assert(findCodex({ env: { ASTRA_CODEX_BIN: 'X:/c.exe' }, which: () => 'p', appx: () => 'a', exists: yes }) === 'X:/c.exe');
    assert(findCodex({ env: {}, which: () => 'C:/npm/codex.cmd', appx: () => 'a', exists: yes }) === 'C:/npm/codex.cmd');
    assert(findCodex({ env: {}, which: () => null, appx: () => 'C:/WA/OpenAI.Codex', exists: yes }) === join('C:/WA/OpenAI.Codex', 'app', 'resources', 'codex.exe'));
    assert(findCodex({ env: {}, which: () => null, appx: () => null, exists: yes }) === null);
  });

  // ---------- 4. lote y CLI ----------
  await check('lote: respeta la concurrencia y sigue si un pedido falla', async () => {
    const root = tmpRoot();
    let activos = 0;
    let max = 0;
    const base = fakeExec();
    const exec = async (o) => { activos++; max = Math.max(max, activos); await new Promise(r => setTimeout(r, 20)); const r = await base(o); activos--; return r; };
    const pedidos = [1, 2, 3, 4].map(i => ({ prompt: `p${i}`, out: `o${i}`, id: `l${i}` })).concat([{ out: 'sin-prompt' }]);
    const rs = await lote(pedidos, { concurrencia: 2, root, status: OK_STATUS, execCodex: exec, codexHome: join(root, 'h') });
    assert(max === 2, `concurrencia máxima ${max}`);
    assert(rs.filter(r => r.estado === 'ok').length === 4 && rs[4].estado === 'error');
  });

  await check('CLI: estado y pedir con dependencias simuladas', async () => {
    const root = tmpRoot();
    const out = [];
    const log = s => out.push(String(s));
    assert(await cliMain(['estado'], { root, status: OK_STATUS, log }) === 0, out.join('\n'));
    assert(await cliMain(['pedir', '--prompt', 'circle icon', '--out', 'a/b', '--id', 'cli1'], { root, status: OK_STATUS, execCodex: fakeExec(), codexHome: join(root, 'h'), log }) === 0, out.join('\n'));
    assert(out.some(l => /^OK en/.test(l)), out.join('\n'));
    assert(await cliMain(['estado', 'cli1'], { root, status: OK_STATUS, log }) === 0);
    const sin = { ...OK_STATUS, logueado: false, detalle: 'sin sesión', arreglo: 'corre codex login' };
    assert(await cliMain(['pedir', '--prompt', 'x', '--out', 'o'], { root, status: sin, log }) === 1);
    assert(out.some(l => /Cómo arreglarlo: corre codex login/.test(l)));
  });

  // ---------- 5. integración ----------
  await check('brazos: entrada astra-codex existe y el check codex se evalúa', () => {
    const e = loadDirectorio().find(x => x.id === 'astra-codex');
    assert(e && e.check.some(c => c.tipo === 'codex'), 'falta astra-codex con check codex');
    const ctx = st => ({ codex: () => st });
    assert(evaluateEntry(e, ctx(OK_STATUS)).estado === ESTADOS.conectado);
    assert(evaluateEntry(e, ctx({ ...OK_STATUS, logueado: false })).estado === ESTADOS.falta_auth);
    assert(evaluateEntry(e, ctx({ instalado: false, logueado: false })).estado === ESTADOS.no_instalado);
    assert(evaluateEntry(e, {}).estado === ESTADOS.revisar);
  });

  await check('.gitignore ignora pedidos/resultados pero conserva README y .gitkeep', () => {
    const gi = readFileSync('.gitignore', 'utf8');
    assert(gi.includes('astra-bridge/pedidos/*') && gi.includes('astra-bridge/resultados/*'));
    for (const f of ['astra-bridge/README.md', 'astra-bridge/pedidos/.gitkeep', 'astra-bridge/resultados/.gitkeep']) assert(existsSync(f), `falta ${f}`);
  });

  await check('skill astra existe y tiene ≤ 80 líneas', () => {
    const md = readFileSync('.claude/skills/astra/SKILL.md', 'utf8');
    const n = md.split(/\r?\n/).length;
    assert(n <= 80, `${n} líneas`);
    assert(/name: astra/.test(md) && /image-gen/.test(md));
  });
} finally {
  for (const d of tmps) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
