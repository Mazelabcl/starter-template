// src/astra.js
// Puente automático con Astra (OpenAI Codex instalado en este computador).
// Genera imágenes con la cuota del plan de ChatGPT, sin API key y sin que
// Aldot copie y pegue nada: escribe el pedido en astra-bridge/pedidos/, corre
// `codex exec` en modo no interactivo, valida los PNG y deja el resultado en
// astra-bridge/resultados/.
//
//   node src/astra.js pedir --prompt "..." --out assets/astra/<slug>/ [--refs a.png,b.png] [--n 2] [--size 16:9]
//   node src/astra.js lote <archivo.json> [--concurrencia 1]
//   node src/astra.js estado [<id>]
//
// Requisitos: Codex instalado (app de escritorio o `npm i -g @openai/codex`)
// y sesión iniciada con la cuenta de ChatGPT (`codex login`).
// Nunca imprime tokens ni el contenido de ~/.codex/auth.json.
// Idioma: español neutro.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, renameSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join, resolve, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const DEFAULT_TIMEOUT_S = 600;
export const MAX_N = 4;
export const MAX_CONCURRENCIA = 3;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class AstraError extends Error {
  constructor(message, { codigo = 'error', arreglo = null } = {}) {
    super(message);
    this.codigo = codigo;
    this.arreglo = arreglo;
  }
}

export function bridgePaths(root = REPO_ROOT) {
  const base = join(root, 'astra-bridge');
  return { base, pedidos: join(base, 'pedidos'), resultados: join(base, 'resultados') };
}

// ---------------------------------------------------------------------------
// Detección de Codex
// ---------------------------------------------------------------------------

function defaultWhich(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [cmd], { encoding: 'utf8', shell: false });
  if (r.status !== 0) return null;
  const lines = String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // En Windows preferimos el .exe/.cmd real (npm deja codex y codex.cmd).
  return lines.find(l => /\.(exe|cmd)$/i.test(l)) || lines[0] || null;
}

function defaultAppxLocation() {
  if (process.platform !== 'win32') return null;
  // La carpeta WindowsApps no se puede listar (EPERM): se pregunta a Windows.
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation'],
  { encoding: 'utf8', timeout: 20_000 });
  const loc = String(r.stdout || '').trim();
  return loc || null;
}

/**
 * Busca el ejecutable de Codex. Orden: ASTRA_CODEX_BIN, PATH (`codex`),
 * CLI incluida en la app de escritorio (paquete OpenAI.Codex de Microsoft Store).
 */
export function findCodex({ env = process.env, which = defaultWhich, appx = defaultAppxLocation, exists = existsSync } = {}) {
  if (env.ASTRA_CODEX_BIN && exists(env.ASTRA_CODEX_BIN)) return env.ASTRA_CODEX_BIN;
  const onPath = which('codex');
  if (onPath) return onPath;
  const loc = appx();
  if (loc) {
    const bin = join(loc, 'app', 'resources', 'codex.exe');
    if (exists(bin)) return bin;
  }
  return null;
}

function quoteBin(bin) {
  return /\s/.test(bin) ? `& "${bin}"` : bin;
}

/** Devuelve { instalado, logueado, version, bin, detalle, arreglo }. `run` es inyectable. */
export function codexStatus({ bin = undefined, run = null, find = findCodex } = {}) {
  const b = bin === undefined ? find() : bin;
  if (!b) {
    return {
      instalado: false, logueado: false, version: null, bin: null,
      detalle: 'Codex no está instalado (ni en el PATH ni como app de escritorio).',
      arreglo: 'Instala la app Codex desde Microsoft Store, o en PowerShell: npm i -g @openai/codex  (luego: codex login)',
    };
  }
  const exec = run || ((args) => {
    const r = spawnSync(b, args, { encoding: 'utf8', timeout: 30_000, shell: /\.cmd$/i.test(b) });
    return { code: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}` };
  });
  const v = exec(['--version']);
  const version = (String(v.out).match(/\d+\.\d+\.\d+[\w.-]*/) || [null])[0];
  if (v.code !== 0) {
    return { instalado: false, logueado: false, version: null, bin: b, detalle: `Codex no responde (${b}).`, arreglo: 'Reinstala Codex o define ASTRA_CODEX_BIN con la ruta correcta a codex.exe.' };
  }
  const s = exec(['login', 'status']);
  const logueado = s.code === 0 && /logged in/i.test(s.out) && !/not logged in/i.test(s.out);
  const conChatGPT = /chatgpt/i.test(s.out);
  return {
    instalado: true, logueado, version, bin: b,
    detalle: logueado ? `Codex ${version || ''} con sesión ${conChatGPT ? 'de ChatGPT' : 'iniciada (no es ChatGPT: puede cobrar por API)'}`.trim() : 'Codex instalado pero sin sesión iniciada.',
    arreglo: logueado ? null : `En una terminal PowerShell nueva corre: ${quoteBin(b)} login   (abre el navegador; entra con tu cuenta de ChatGPT)`,
  };
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imagen';
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const FORMATOS = { '1:1': 'square (1:1)', '16:9': 'landscape 16:9', '9:16': 'vertical 9:16', '4:3': 'landscape 4:3', '3:4': 'portrait 3:4', '3:2': 'landscape 3:2', '2:3': 'portrait 2:3' };

/** Normaliza y valida las opciones de un pedido. No toca disco. */
export function normalizarPedido(opts, { root = REPO_ROOT, now = new Date() } = {}) {
  const prompt = String(opts.prompt || '').trim();
  if (!prompt) throw new AstraError('Falta --prompt.', { codigo: 'uso' });
  if (!opts.out) throw new AstraError('Falta --out (carpeta destino, por ejemplo assets/astra/logo/).', { codigo: 'uso' });
  const n = Number(opts.n ?? opts.cantidad ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > MAX_N) throw new AstraError(`--n debe ser un entero entre 1 y ${MAX_N}.`, { codigo: 'uso' });
  const formato = String(opts.size || opts.formato || '1:1').trim();
  if (!FORMATOS[formato] && !/^\d{3,4}x\d{3,4}$/.test(formato)) {
    throw new AstraError(`--size inválido: "${formato}". Usa 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 o AnchoxAlto (1536x1024).`, { codigo: 'uso' });
  }
  const refsIn = Array.isArray(opts.refs) ? opts.refs : String(opts.refs || '').split(',');
  const refs = refsIn.map(r => String(r).trim()).filter(Boolean).map(r => (isAbsolute(r) ? r : resolve(root, r)));
  for (const r of refs) if (!existsSync(r)) throw new AstraError(`No existe la referencia ${r}.`, { codigo: 'uso' });
  const outAbs = isAbsolute(opts.out) ? opts.out : resolve(root, opts.out);
  const slug = slugify(opts.slug || basename(outAbs));
  const id = opts.id ? slugify(opts.id) : `${slug}-${stamp(now)}`;
  return {
    id, slug, tipo: refs.length ? 'crear-con-refs' : 'crear',
    prompt, intencion: opts.intencion || null, evitar: opts.evitar || null,
    formato, cantidad: n, refs, out: outAbs,
    creado: now.toISOString(), estado: 'pendiente',
  };
}

/** Nombres de salida estilo puente manual: <slug>_v<N>.png o <slug>_v<N>-a.png... sin sobrescribir. */
export function nombresSalida(pedido, existentes = []) {
  const re = new RegExp(`^${pedido.slug.replace(/[-]/g, '\\-')}_v(\\d+)(?:-[a-z])?\\.png$`, 'i');
  let v = 0;
  for (const f of existentes) { const m = f.match(re); if (m) v = Math.max(v, Number(m[1])); }
  v += 1;
  if (pedido.cantidad === 1) return [`${pedido.slug}_v${v}.png`];
  return Array.from({ length: pedido.cantidad }, (_, i) => `${pedido.slug}_v${v}-${String.fromCharCode(97 + i)}.png`);
}

/** Instrucción precisa para Codex (en inglés: rinde mejor). */
export function buildInstruction(pedido, nombres) {
  const fmt = FORMATOS[pedido.formato] || `${pedido.formato} pixels`;
  const lines = [
    'You are an image generation worker. Do not write code, do not modify any file other than the images below, do not ask questions.',
    `Use your built-in image generation tool to generate exactly ${nombres.length} image(s).`,
    '',
    'PROMPT (use it as-is, do not rewrite or "improve" it):',
    pedido.prompt,
    '',
    `Format: ${fmt}.`,
  ];
  if (pedido.intencion) lines.push(`Intent (context only): ${pedido.intencion}`);
  if (pedido.evitar) lines.push(`Avoid: ${pedido.evitar}`);
  lines.push('Global rules: no text, letters, logos or watermarks inside the image unless the prompt asks for exact text; no borders or frames.');
  if (pedido.refs.length) {
    lines.push('', 'Reference images are attached in this order and must be passed to the image tool as references:');
    pedido.refs.forEach((r, i) => lines.push(`- Image ${i + 1} = ${basename(r)}`));
  }
  if (nombres.length > 1) lines.push('', 'Generate each image as a separate generation (distinct variations of the same prompt).');
  lines.push('', `Save the results as PNG files in the current working directory (${pedido.out}) with these exact names:`);
  nombres.forEach(n => lines.push(`- ${n}`));
  lines.push('', 'Never overwrite existing files. When done, reply only with the list of saved file paths. If the tool refuses the prompt, reply with "NO-PUDE: <reason>".');
  return lines.join('\n');
}

export function buildCodexArgs(pedido) {
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral',
    '-s', 'workspace-write', '-C', pedido.out,
    '-c', 'model_reasoning_effort="low"'];
  for (const r of pedido.refs) args.push('-i', r);
  args.push('-');
  return args;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/** Corre codex con el prompt por stdin. Devuelve { code, stdout, stderr, timedOut }. */
export function defaultExecCodex({ bin, args, input, cwd, timeoutMs }) {
  return new Promise((resolveP) => {
    const child = spawn(bin, args, { cwd, shell: /\.cmd$/i.test(bin), windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); resolveP({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolveP({ code, stdout, stderr, timedOut }); });
    child.stdin.end(input);
  });
}

/** Lee los eventos JSONL de `codex exec --json`. */
export function parseEvents(stdout) {
  const out = { threadId: null, mensajes: [], errores: [], usage: null };
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'thread.started') out.threadId = ev.thread_id || null;
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') out.mensajes.push(String(ev.item.text || ''));
    if (ev.type === 'error' || ev.type === 'turn.failed') out.errores.push(ev.message || ev.error?.message || JSON.stringify(ev).slice(0, 300));
    if (ev.type === 'turn.completed') out.usage = ev.usage || null;
  }
  return out;
}

export function isPng(path) {
  try {
    if (statSync(path).size < 100) return false;
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(8);
    readSync(fd, buf, 0, 8, 0);
    closeSync(fd);
    return buf.equals(PNG_SIG);
  } catch { return false; }
}

function listPngs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /\.png$/i.test(f));
}

/**
 * Asegura que existan los PNG esperados. Si Codex los guardó con otro nombre,
 * los renombra; si no los copió (falla conocida en Windows), los rescata de
 * ~/.codex/generated_images/<thread>/.
 */
export function recolectar({ pedido, nombres, antes, threadId, codexHome, desdeMs }) {
  const notas = [];
  const faltan = nombres.filter(n => !isPng(join(pedido.out, n)));
  if (!faltan.length) return { archivos: nombres.map(n => join(pedido.out, n)), notas };
  const nuevos = listPngs(pedido.out).filter(f => !antes.includes(f) && !nombres.includes(f) && isPng(join(pedido.out, f)));
  let fuentes = nuevos.map(f => ({ path: join(pedido.out, f), mover: true }));
  if (threadId && codexHome) {
    const dir = join(codexHome, 'generated_images', threadId);
    const gen = listPngs(dir).map(f => join(dir, f))
      .filter(p => isPng(p) && statSync(p).mtimeMs >= desdeMs - 5000)
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
    fuentes = fuentes.concat(gen.map(p => ({ path: p, mover: false })));
  }
  for (const n of faltan) {
    const src = fuentes.shift();
    if (!src) break;
    const dst = join(pedido.out, n);
    if (src.mover) renameSync(src.path, dst); else copyFileSync(src.path, dst);
    notas.push(`${n} ${src.mover ? 'renombrado desde' : 'rescatado de'} ${basename(src.path)}`);
  }
  return { archivos: nombres.map(n => join(pedido.out, n)).filter(isPng), notas };
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function rel(root, p) {
  const r = p.startsWith(root) ? p.slice(root.length + 1) : p;
  return r.replace(/\\/g, '/');
}

/**
 * Flujo completo de un pedido. Devuelve el resultado (también escrito en
 * astra-bridge/resultados/<id>.json). Lanza AstraError solo por errores de uso
 * o de instalación/sesión; los fallos de generación quedan en el resultado.
 */
export async function pedir(opts, {
  root = REPO_ROOT, status = null, execCodex = defaultExecCodex,
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  now = () => new Date(), log = () => {},
} = {}) {
  const pedido = normalizarPedido(opts, { root, now: now() });
  const st = status || codexStatus();
  if (!st.instalado) throw new AstraError(st.detalle, { codigo: 'no-instalado', arreglo: st.arreglo });
  if (!st.logueado) throw new AstraError(st.detalle, { codigo: 'sin-sesion', arreglo: st.arreglo });

  const paths = bridgePaths(root);
  const pedidoPath = join(paths.pedidos, `${pedido.id}.json`);
  const resultadoPath = join(paths.resultados, `${pedido.id}.json`);
  mkdirSync(pedido.out, { recursive: true });
  const antes = listPngs(pedido.out);
  const nombres = nombresSalida(pedido, antes);
  const instruccion = buildInstruction(pedido, nombres);
  const timeoutS = Number(opts.timeout || opts['timeout-s'] || DEFAULT_TIMEOUT_S);

  const guardado = { ...pedido, refs: pedido.refs.map(r => rel(root, r)), out: rel(root, pedido.out), archivos_esperados: nombres, estado: 'en-curso' };
  writeJson(pedidoPath, guardado);
  log(`Astra: pedido ${pedido.id} (${nombres.length} imagen(es)). Esto toma ~1 min por imagen...`);

  const t0 = Date.now();
  const r = await execCodex({ bin: st.bin, args: buildCodexArgs(pedido), input: instruccion, cwd: pedido.out, timeoutMs: timeoutS * 1000 });
  const ev = parseEvents(r.stdout);
  const { archivos, notas } = recolectar({ pedido, nombres, antes, threadId: ev.threadId, codexHome, desdeMs: t0 });
  const duracion = Math.round((Date.now() - t0) / 100) / 10;

  let estado = 'ok';
  let error = null;
  if (archivos.length === 0) {
    estado = 'error';
    const noPude = ev.mensajes.find(m => /NO-PUDE/i.test(m));
    if (r.timedOut) error = `Se acabó el tiempo (${timeoutS} s). Sube --timeout o revisa que Codex responda.`;
    else if (noPude) error = noPude.trim();
    else if (ev.errores.length) error = ev.errores.join(' | ');
    else if (r.code !== 0) error = `codex terminó con código ${r.code}: ${String(r.stderr || '').trim().split(/\r?\n/).slice(-3).join(' ')}`;
    else error = 'Codex terminó sin dejar imágenes.';
    if (/usage limit|rate limit|quota/i.test(`${error} ${r.stderr}`)) error += ' (parece la cuota del plan de ChatGPT: espera a que se renueve o usa la skill image-gen con la API)';
  } else if (archivos.length < nombres.length) {
    estado = 'parcial';
    error = `Llegaron ${archivos.length} de ${nombres.length} imágenes.`;
  }

  const resultado = {
    id: pedido.id, estado, archivos: archivos.map(a => rel(root, a)),
    esperadas: nombres.length, duracion_s: duracion, error, notas,
    codex: { version: st.version || null, thread_id: ev.threadId, exit_code: r.code, timeout: r.timedOut, usage: ev.usage },
    salida_codex: ev.mensajes.join('\n').slice(-1500),
    terminado: now().toISOString(),
  };
  writeJson(resultadoPath, resultado);
  writeJson(pedidoPath, { ...guardado, estado: estado === 'error' ? 'error' : 'entregado' });
  return resultado;
}

/** Corre varios pedidos con concurrencia acotada (por defecto 1: la cuota es por cuenta). */
export async function lote(pedidos, { concurrencia = 1, ...deps } = {}) {
  const c = Math.max(1, Math.min(MAX_CONCURRENCIA, Number(concurrencia) || 1));
  const st = deps.status || codexStatus();
  if (!st.instalado) throw new AstraError(st.detalle, { codigo: 'no-instalado', arreglo: st.arreglo });
  if (!st.logueado) throw new AstraError(st.detalle, { codigo: 'sin-sesion', arreglo: st.arreglo });
  const out = new Array(pedidos.length);
  let next = 0;
  async function worker() {
    while (next < pedidos.length) {
      const i = next++;
      try {
        out[i] = await pedir(pedidos[i], { ...deps, status: st });
      } catch (e) {
        out[i] = { id: pedidos[i].id || `pedido-${i + 1}`, estado: 'error', archivos: [], error: e.message };
      }
      deps.log?.(`Astra: ${i + 1}/${pedidos.length} ${out[i].estado} ${out[i].id}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(c, pedidos.length) }, worker));
  return out;
}

/** Resumen del puente: estado de Codex + conteo de pedidos/resultados. */
export function estadoPuente({ root = REPO_ROOT, status = null } = {}) {
  const st = status || codexStatus();
  const { pedidos, resultados } = bridgePaths(root);
  const leer = dir => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : []);
  const res = leer(resultados).map(f => { try { return JSON.parse(readFileSync(join(resultados, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  const porEstado = {};
  for (const r of res) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;
  return { codex: st, pedidos: leer(pedidos).length, resultados: res.length, por_estado: porEstado };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node src/astra.js pedir --prompt "..." --out assets/astra/<slug>/ [--refs a.png,b.png] [--n 1-4] [--size 1:1|16:9|9:16|1536x1024]
                          [--intencion "..."] [--evitar "..."] [--id <id>] [--timeout 600]
  node src/astra.js lote <archivo.json> [--concurrencia 1-3]     (archivo: array de pedidos con las mismas claves)
  node src/astra.js estado [<id>] [--json]`;

export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) { rest.push(a); continue; }
    if (m[2] !== undefined) flags[m[1]] = m[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[m[1]] = argv[++i];
    else flags[m[1]] = true;
  }
  return { flags, rest };
}

function printError(e, log) {
  log(`Error: ${e.message}`);
  if (e.arreglo) log(`Cómo arreglarlo: ${e.arreglo}`);
}

export async function cliMain(argv, { log = console.log, ...deps } = {}) {
  const { flags, rest } = parseArgs(argv);
  const [cmd, ...args] = rest;
  const root = deps.root || REPO_ROOT;
  try {
    if (cmd === 'pedir') {
      const r = await pedir(flags, { ...deps, log });
      log(flags.json ? JSON.stringify(r, null, 2) : `${r.estado.toUpperCase()} en ${r.duracion_s} s: ${r.archivos.join(', ') || '(sin archivos)'}${r.error ? `\n${r.error}` : ''}`);
      log(`Resultado: astra-bridge/resultados/${r.id}.json`);
      return r.estado === 'error' ? 1 : 0;
    }
    if (cmd === 'lote') {
      if (!args[0]) { log(USAGE); return 1; }
      const file = isAbsolute(args[0]) ? args[0] : resolve(root, args[0]);
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const pedidos = Array.isArray(data) ? data : data.pedidos;
      if (!Array.isArray(pedidos) || !pedidos.length) throw new AstraError('El archivo del lote debe ser un array de pedidos (o { "pedidos": [...] }).', { codigo: 'uso' });
      const rs = await lote(pedidos, { ...deps, concurrencia: flags.concurrencia, log });
      for (const r of rs) log(`${r.estado.padEnd(8)} ${r.id}  ${(r.archivos || []).join(', ')}${r.error ? `  (${r.error})` : ''}`);
      const ok = rs.filter(r => r.estado === 'ok').length;
      log(`\nOK: ${ok} de ${rs.length}`);
      return ok === rs.length ? 0 : 1;
    }
    if (cmd === 'estado') {
      if (args[0]) {
        const p = join(bridgePaths(root).resultados, `${slugify(args[0])}.json`);
        if (!existsSync(p)) { log(`No hay resultado para "${args[0]}" (aún corre o no existe).`); return 1; }
        log(readFileSync(p, 'utf8').trim());
        return 0;
      }
      const e = estadoPuente({ root, status: deps.status });
      if (flags.json) { log(JSON.stringify(e, null, 2)); return 0; }
      log(`Codex: ${e.codex.detalle}${e.codex.bin ? `\nEjecutable: ${e.codex.bin}` : ''}`);
      if (e.codex.arreglo) log(`Cómo arreglarlo: ${e.codex.arreglo}`);
      log(`Pedidos: ${e.pedidos} | Resultados: ${e.resultados} ${JSON.stringify(e.por_estado)}`);
      return e.codex.instalado && e.codex.logueado ? 0 : 1;
    }
    log(USAGE);
    return cmd ? 1 : 0;
  } catch (e) {
    printError(e, log);
    return 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) cliMain(process.argv.slice(2)).then(code => process.exit(code));
