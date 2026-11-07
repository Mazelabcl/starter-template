// src/claude_aislado.js
// Sesiones hijas de Claude Code (`claude -p`) AISLADAS y medidas. Lo usan bold-rounds
// (idear / construir) y council (coaches e integrador por la ruta "claude").
//
// Por qué: una sesión hija normal hereda skills, plugins, CLAUDE.md global, MCP y hooks
// del usuario. Medido el 2026-11-06 en este PC (claude 2.1.319, primera petición):
//   sin aislar ......................................... 52.143 tokens
//   --safe-mode ........................................ 23.915
//   --safe-mode --strict-mcp-config + 5 herramientas ...  6.777
//   igual, sin herramientas ............................  3.549
//   igual + --system-prompt-file propio ................    767-975
// `--bare` NO sirve con login de suscripción (solo acepta ANTHROPIC_API_KEY), por eso
// se usa `--safe-mode` (CLAUDE.md, skills, plugins, hooks, MCP y agentes apagados;
// login, modelo y herramientas internas funcionan normal).
//
// Además: `--max-turns` (existe aunque no sale en --help), `--effort` explícito (si no,
// se hereda CLAUDE_EFFORT de la sesión madre), timeout real que mata el árbol de
// procesos en Windows, y detección del aviso de límite de uso ("hit your limit").
//
// Uso desde código:
//   import { runAislado } from './claude_aislado.js';
//   const r = await runAislado({ prompt, cwd, model: 'opus', tools: ['Read'], maxTurns: 6, timeoutMs: 360000 });
//   r.usage.first_context, r.usage.peak_context, r.usage.total, r.requests, r.limit.hit ...
// CLI (medición rápida):
//   node src/claude_aislado.js medir [--model haiku] [--sin-aislar]
// Idioma: español neutro.

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** Flags de aislamiento verificados en este PC (ver cabecera). */
export const AISLAMIENTO = ['--safe-mode', '--strict-mcp-config'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Avisos de límite de uso que se vieron en transcripciones reales (Weddi, 2026-11-06)
// y variantes razonables. Si aparece, la tarea se REINTENTA: no es un fallo de calidad.
export const LIMIT_RE = /hit your (?:\d+-hour |weekly |session |usage )?limit|usage[ _]limit[ _](?:reached|exceeded)|usage_limit_reached|limit (?:reached|will reset)|resets \d{1,2}(?::\d{2})?\s?(?:am|pm)/i;

/** ¿El texto trae un aviso de límite de uso? Devuelve la línea o null. */
export function detectaLimite(text) {
  const s = String(text || '');
  const m = LIMIT_RE.exec(s);
  if (!m) return null;
  const start = s.lastIndexOf('\n', m.index) + 1;
  const end = s.indexOf('\n', m.index);
  return s.slice(start, end < 0 ? undefined : end).trim().slice(0, 200);
}

/**
 * Ejecutable de Claude Code. En Windows `claude` es un shim .cmd que necesita shell;
 * se busca el claude.exe que llama, para lanzarlo sin shell (comillas seguras y un PID
 * real que se puede matar). Env CLAUDE_BIN lo fuerza.
 */
export function resolveClaudeBin({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (env.CLAUDE_BIN) return { cmd: env.CLAUDE_BIN, shell: /\.(cmd|bat)$/i.test(env.CLAUDE_BIN) };
  if (platform !== 'win32') return { cmd: 'claude', shell: false };
  for (const dir of String(env.PATH || env.Path || '').split(delimiter).filter(Boolean)) {
    const exe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (exists(join(dir, 'claude.cmd')) && exists(exe)) return { cmd: exe, shell: false };
    if (exists(join(dir, 'claude.exe'))) return { cmd: join(dir, 'claude.exe'), shell: false };
  }
  return { cmd: 'claude', shell: true };
}

/**
 * Argumentos de `claude -p` aislado. `tools: []` = sin herramientas.
 * `systemPromptFile`: reemplaza el system prompt por defecto (ideal para texto puro).
 */
export function buildArgs({
  model, tools = [], effort, maxTurns, systemPromptFile, appendSystemPromptFile,
  permissionMode, addDirs = [], aislar = true, outputFormat = 'stream-json',
} = {}) {
  if (!model) throw new Error('buildArgs: falta model');
  if (effort && !EFFORTS.includes(effort)) throw new Error(`effort inválido: ${effort} (usa ${EFFORTS.join(' | ')})`);
  const args = ['-p', '--model', model];
  if (aislar) args.push(...AISLAMIENTO, '--tools', tools.join(','));
  if (effort) args.push('--effort', effort);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (systemPromptFile) args.push('--system-prompt-file', systemPromptFile);
  if (appendSystemPromptFile) args.push('--append-system-prompt-file', appendSystemPromptFile);
  if (permissionMode) args.push('--permission-mode', permissionMode);
  for (const d of addDirs) args.push('--add-dir', d);
  args.push('--output-format', outputFormat);
  if (outputFormat === 'stream-json') args.push('--verbose');
  return args;
}

/** Entorno de la hija: sin el esfuerzo heredado de la sesión madre. */
export function childEnv(env = process.env) {
  const out = { ...env };
  delete out.CLAUDE_EFFORT;
  return out;
}

const n0 = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ctxOf = u => n0(u.input_tokens) + n0(u.cache_creation_input_tokens) + n0(u.cache_read_input_tokens);

/** Acumulador de métricas de un stream-json (una línea JSON por evento). */
export function nuevoMedidor() {
  const msgs = new Map();
  const m = {
    msgs, result: null, window: { first: null, last: null, resets_at: null },
    limit: { hit: false, resets_at: null, message: null }, init: null, errors: [],
  };
  m.feed = line => {
    const t = String(line || '').trim();
    if (!t || t[0] !== '{') return;
    let o;
    try { o = JSON.parse(t); } catch { return; }
    if (o.type === 'system' && o.subtype === 'init') {
      m.init = { tools: o.tools || [], mcp_servers: (o.mcp_servers || []).map(s => s.name || s), model: o.model || null, apiKeySource: o.apiKeySource || null };
    } else if (o.type === 'rate_limit_event') {
      const info = o.rate_limit_info || {};
      const fh = info.unifiedWindows?.five_hour || (info.rateLimitType === 'five_hour' ? info : null);
      if (fh && typeof fh.utilization === 'number') {
        if (m.window.first === null) m.window.first = fh.utilization;
        m.window.last = fh.utilization;
      }
      if (fh?.resetsAt) m.window.resets_at = fh.resetsAt;
      if (info.status === 'rejected') { m.limit.hit = true; m.limit.resets_at = info.resetsAt || m.limit.resets_at; }
    } else if (o.type === 'assistant' && o.message) {
      const msg = o.message;
      const text = (Array.isArray(msg.content) ? msg.content : []).filter(c => c && c.type === 'text').map(c => c.text).join('\n');
      if (msg.model === '<synthetic>' || o.error || o.isApiErrorMessage) {
        const lim = o.apiError === 'usage_limit_reached' || detectaLimite(text);
        if (lim) {
          m.limit.hit = true;
          m.limit.message = detectaLimite(text) || 'usage_limit_reached';
          m.limit.resets_at = o.apiErrorParams?.rate_limit_info?.resetsAt || m.limit.resets_at;
        } else if (text) m.errors.push(text.slice(0, 200));
        return;
      }
      const u = msg.usage;
      if (!u) return;
      const key = msg.id || o.uuid || String(msgs.size);
      const prev = msgs.get(key);
      const rec = {
        input: n0(u.input_tokens), cache_write: n0(u.cache_creation_input_tokens),
        cache_read: n0(u.cache_read_input_tokens), output: n0(u.output_tokens), order: prev ? prev.order : msgs.size,
      };
      if (prev) for (const k of ['input', 'cache_write', 'cache_read', 'output']) rec[k] = Math.max(prev[k], rec[k]);
      msgs.set(key, rec);
    } else if (o.type === 'result') {
      m.result = o;
      if (detectaLimite(o.result) || o.subtype === 'error_rate_limit') {
        m.limit.hit = true;
        m.limit.message = m.limit.message || detectaLimite(o.result);
      }
    }
  };
  m.summary = () => {
    const list = [...msgs.values()].sort((a, b) => a.order - b.order);
    const ctx = r => r.input + r.cache_write + r.cache_read;
    const tot = list.reduce((s, r) => ({
      input: s.input + r.input, cache_write: s.cache_write + r.cache_write,
      cache_read: s.cache_read + r.cache_read, output: s.output + r.output,
    }), { input: 0, cache_write: 0, cache_read: 0, output: 0 });
    // El usage agregado del resultado manda: en stream-json los eventos `assistant` traen la
    // salida PARCIAL (medido: 507 en el stream vs 5.294 reales). El stream solo da el
    // contexto de cada petición (inicial y pico).
    if (m.result?.usage) {
      const u = m.result.usage;
      Object.assign(tot, { input: n0(u.input_tokens), cache_write: n0(u.cache_creation_input_tokens), cache_read: n0(u.cache_read_input_tokens), output: n0(u.output_tokens) });
    }
    const first = list.length ? ctx(list[0]) : (m.result?.usage ? ctxOf(m.result.usage) : 0);
    return {
      requests: list.length || (m.result ? 1 : 0),
      num_turns: m.result?.num_turns ?? null,
      usage: {
        first_context: first,
        peak_context: list.length ? Math.max(...list.map(ctx)) : first,
        ...tot,
        total: tot.input + tot.cache_write + tot.cache_read + tot.output,
      },
      cost_usd: typeof m.result?.total_cost_usd === 'number' ? Number(m.result.total_cost_usd.toFixed(5)) : null,
      subtype: m.result?.subtype || null,
      is_error: m.result ? !!m.result.is_error : true,
      result: typeof m.result?.result === 'string' ? m.result.result : '',
      window: { ...m.window },
      limit: { ...m.limit },
      init: m.init,
      errors: m.errors.slice(0, 5),
    };
  };
  return m;
}

/** Mata el proceso y sus hijos. En Windows `taskkill /T /F` (child.kill deja nietos vivos). */
export function killTree(child, { platform = process.platform, run = spawnSync } = {}) {
  if (!child || !child.pid) return false;
  try {
    if (platform === 'win32') {
      run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
    return true;
  } catch {
    try { child.kill('SIGKILL'); } catch { /* ya terminó */ }
    return false;
  }
}

let tmpCount = 0;
/** Escribe un texto en un archivo temporal (system prompt) y devuelve su ruta. */
export function tempFile(text, { dir = join(tmpdir(), 'mazelab-claude'), name } = {}) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name || `sp-${process.pid}-${Date.now()}-${tmpCount++}.md`);
  writeFileSync(p, text, 'utf8');
  return p;
}

/**
 * Corre una sesión hija aislada. Nunca lanza: devuelve { ok, timed_out, limit, usage, ... }.
 * El prompt va por stdin. `logFile` guarda el stream crudo (jsonl) para medir después.
 * `spawnFn` y `killFn` se inyectan en los tests (sin llamadas reales).
 */
export function runAislado({
  prompt, cwd = process.cwd(), model, tools = [], effort, maxTurns, timeoutMs = 15 * 60000,
  systemPrompt, systemPromptFile, appendSystemPromptFile, permissionMode, addDirs = [],
  logFile, aislar = true, spawnFn = spawn, killFn = killTree, bin = resolveClaudeBin(), env = childEnv(), onLine,
} = {}) {
  const spFile = systemPromptFile || (systemPrompt ? tempFile(systemPrompt) : undefined);
  const args = buildArgs({ model, tools, effort, maxTurns, systemPromptFile: spFile, appendSystemPromptFile, permissionMode, addDirs, aislar });
  const t0 = Date.now();
  const medidor = nuevoMedidor();
  let log = null;
  if (logFile) { mkdirSync(dirname(resolve(logFile)), { recursive: true }); log = createWriteStream(logFile, { encoding: 'utf8' }); }
  return new Promise(done => {
    let child;
    try {
      const cmd = bin.shell ? [bin.cmd, ...args.map(a => (/[\s"&|<>^]/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a))].join(' ') : bin.cmd;
      child = bin.shell
        ? spawnFn(cmd, { cwd, shell: true, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        : spawnFn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) {
      if (log) log.end();
      done({ ok: false, error: e.message, timed_out: false, secs: 0, args, ...medidor.summary() });
      return;
    }
    let buf = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    const timer = setTimeout(() => { timedOut = true; killFn(child); }, timeoutMs);
    const eat = chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (log) log.write(`${line}\n`);
        medidor.feed(line);
        if (onLine) onLine(line);
      }
    };
    child.stdout.on('data', d => eat(String(d)));
    child.stderr.on('data', d => { stderr += String(d); });
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (buf) { if (log) log.write(buf); medidor.feed(buf); }
      if (log) { if (stderr) log.write(`\n--- stderr ---\n${stderr}`); log.end(); }
      const s = medidor.summary();
      const lim = s.limit.hit ? s.limit : (detectaLimite(stderr) ? { hit: true, resets_at: null, message: detectaLimite(stderr) } : s.limit);
      done({
        ...s, limit: lim, code, timed_out: timedOut, secs: Math.round((Date.now() - t0) / 1000),
        ok: !timedOut && !lim.hit && code === 0 && !s.is_error,
        stderr: stderr.slice(-2000), args, ...(error ? { error } : {}),
      });
    };
    child.on('error', e => finish(null, e.message));
    child.on('close', code => finish(code));
    child.stdin.on('error', () => { /* la hija cerró stdin antes de tiempo */ });
    child.stdin.end(String(prompt || ''));
  });
}

// ---------------------------------------------------------------------------
// CLI: medir el contexto inicial (aislado vs sin aislar)
// ---------------------------------------------------------------------------

async function cli(argv) {
  const [cmd] = argv;
  if (cmd !== 'medir') {
    console.log('Uso: node src/claude_aislado.js medir [--model haiku] [--sin-aislar]\n(corre "Responde solo: ok" y muestra el contexto de la primera petición)');
    return cmd ? 1 : 0;
  }
  const i = argv.indexOf('--model');
  const model = i >= 0 ? argv[i + 1] : 'haiku';
  const aislar = !argv.includes('--sin-aislar');
  const r = await runAislado({ prompt: 'Responde solo: ok', model, aislar, tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'], effort: 'low', maxTurns: 1, timeoutMs: 120000 });
  console.log(JSON.stringify({
    aislado: aislar, modelo: model, ok: r.ok, contexto_inicial: r.usage.first_context,
    herramientas: r.init?.tools?.length ?? null, mcp: r.init?.mcp_servers ?? null, ventana_5h: r.window.last, segundos: r.secs,
  }, null, 2));
  return r.ok ? 0 : 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) cli(process.argv.slice(2)).then(c => { process.exitCode = c; });
