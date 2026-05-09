#!/usr/bin/env node
// scripts/dashboard_hook.js
// Wrapper que Claude Code invoca como hook PreToolUse / PostToolUse
// cuando dispara la herramienta "Agent". Lee JSON del hook por stdin,
// extrae el rol del prompt, y llama a scripts/update_state.js para que
// el dashboard refleje en vivo qué agente está corriendo.
//
// Modos (vía argv[2]):
//   pre   → registra task-start con un id nuevo y persiste el id correlado por tool_use_id
//   post  → registra task-complete (o task-fail si tool_response.error) y limpia la correlación
//
// Filosofía fail-safe: si algo falla acá adentro, NO bloqueamos a Claude.
// Salimos con exit 0 y logueamos el error a dashboard/hooks.log.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  renameSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const CACHE_DIR = join(REPO_ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'active-agents.json');
const LOG_DIR = join(REPO_ROOT, 'dashboard');
const LOG_FILE = join(LOG_DIR, 'hooks.log');
const LOG_FILE_ROTATED = join(LOG_DIR, 'hooks.log.1');
const LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

const UPDATE_STATE_SCRIPT = join(REPO_ROOT, 'scripts', 'update_state.js');

// ---------- logging ----------

function rotateLogIfNeeded() {
  try {
    if (!existsSync(LOG_FILE)) return;
    const st = statSync(LOG_FILE);
    if (st.size < LOG_MAX_BYTES) return;
    try { renameSync(LOG_FILE, LOG_FILE_ROTATED); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

function log(level, msg, extra) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    rotateLogIfNeeded();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(extra || {}),
    }) + '\n';
    appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // si no podemos loguear, no hay nada que hacer — fail-safe
  }
}

// ---------- cache de correlación ----------

function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return {};
    const raw = readFileSync(CACHE_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    log('warn', 'cache corrupto, reinicio', { error: e.message });
    return {};
  }
}

function writeCache(obj) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    // expira entradas viejas (> 6h) para que el cache no crezca
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const cleaned = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.created_at === 'number' && v.created_at >= cutoff) {
        cleaned[k] = v;
      }
    }
    writeFileSync(CACHE_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
  } catch (e) {
    log('warn', 'no pude escribir cache', { error: e.message });
  }
}

// ---------- parseo del input del hook ----------

function readStdinSync() {
  try {
    // fd 0 = stdin
    const buf = readFileSync(0, 'utf8');
    return buf || '';
  } catch (e) {
    log('warn', 'no pude leer stdin', { error: e.message });
    return '';
  }
}

function safeParse(raw) {
  if (!raw || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch (e) {
    log('warn', 'stdin no es JSON válido', { error: e.message, sample: raw.slice(0, 200) });
    return null;
  }
}

// Extrae "agent_role" del prompt. Si encuentra "ROL:" o "Rol:" en los
// primeros 200 chars, toma esa frase. Si no, fallback al primer renglón
// no vacío. Trunca a 100 chars.
export function extractRole(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'agente sin rol declarado';
  const head = prompt.slice(0, 400);
  const rolMatch = head.match(/\bROL\s*:\s*([^\n\r.]+)/i);
  if (rolMatch && rolMatch[1]) {
    return rolMatch[1].trim().slice(0, 100);
  }
  // fallback: primer renglón no vacío
  const firstLine = prompt.split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
  if (firstLine) return firstLine.slice(0, 100);
  return 'agente sin rol declarado';
}

export function extractTitle(toolInput) {
  if (!toolInput) return 'tarea sin descripción';
  const desc = (toolInput.description || '').trim();
  if (desc) return desc.slice(0, 120);
  const prompt = (toolInput.prompt || '').trim();
  if (prompt) {
    const firstLine = prompt.split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
    return firstLine.slice(0, 120) || 'tarea sin descripción';
  }
  return 'tarea sin descripción';
}

export function extractAgentName(toolInput) {
  if (!toolInput) return 'agent';
  return (toolInput.subagent_type || toolInput.agent_type || 'agent').toString().slice(0, 60);
}

// Detecta si el tool_response indica error. Claude Code marca la respuesta
// con `error` (string) o `is_error: true` cuando algo falló.
export function detectFailure(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object') return null;
  if (toolResponse.is_error === true || toolResponse.isError === true) {
    const reason = (toolResponse.error || toolResponse.content || 'tool reportó error')
      .toString()
      .slice(0, 200);
    return reason;
  }
  if (typeof toolResponse.error === 'string' && toolResponse.error.trim()) {
    return toolResponse.error.trim().slice(0, 200);
  }
  return null;
}

// ---------- runner ----------

// Construye el comando que vamos a invocar. Exportado para test.
export function buildCommand(mode, payload, cache) {
  if (mode === 'pre') {
    const toolInput = payload.tool_input || {};
    const taskId = `agent-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const agent = extractAgentName(toolInput);
    const role = extractRole(toolInput.prompt);
    const title = extractTitle(toolInput);
    const correlationKey = payload.tool_use_id || `fallback-${taskId}`;
    const newCache = {
      ...cache,
      [correlationKey]: { task_id: taskId, agent, created_at: Date.now() },
    };
    return {
      args: ['task-start', taskId, agent, role, title],
      newCache,
      taskId,
    };
  }

  if (mode === 'post') {
    const correlationKey = payload.tool_use_id;
    const entry = correlationKey ? cache[correlationKey] : null;
    if (!entry) {
      // sin correlación válida → no podemos cerrar nada de forma segura
      return { args: null, newCache: cache, taskId: null, reason: 'no-correlation' };
    }
    const failure = detectFailure(payload.tool_response);
    const { task_id } = entry;
    const newCache = { ...cache };
    delete newCache[correlationKey];
    if (failure) {
      return {
        args: ['task-fail', task_id, failure],
        newCache,
        taskId: task_id,
      };
    }
    return {
      args: ['task-complete', task_id, '0'],
      newCache,
      taskId: task_id,
    };
  }

  return { args: null, newCache: cache, taskId: null, reason: 'unknown-mode' };
}

function runUpdateState(args) {
  try {
    const result = spawnSync(process.execPath, [UPDATE_STATE_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
    if (result.error) {
      log('warn', 'spawn falló', { error: result.error.message, args });
      return false;
    }
    if (result.status !== 0) {
      log('warn', 'update_state.js exit no-cero', {
        status: result.status,
        stderr: (result.stderr || '').slice(0, 400),
        args,
      });
      return false;
    }
    return true;
  } catch (e) {
    log('warn', 'excepción al spawn', { error: e.message, args });
    return false;
  }
}

// ---------- main ----------

function main() {
  const t0 = Date.now();
  const mode = process.argv[2];
  if (mode !== 'pre' && mode !== 'post') {
    log('warn', 'modo inválido o ausente, ignoro', { mode });
    process.exit(0);
    return;
  }

  const raw = readStdinSync();
  const payload = safeParse(raw);
  if (!payload) {
    log('warn', 'sin payload válido, ignoro', { mode });
    process.exit(0);
    return;
  }

  // Filtro defensivo: solo procesamos si tool_name === "Agent".
  // El matcher del settings.json ya filtra, pero lo repetimos por seguridad.
  if (payload.tool_name && payload.tool_name !== 'Agent') {
    log('debug', 'no-Agent, ignoro', { tool_name: payload.tool_name, mode });
    process.exit(0);
    return;
  }

  const cache = readCache();
  const { args, newCache, taskId, reason } = buildCommand(mode, payload, cache);

  if (!args) {
    log('debug', 'sin acción a ejecutar', { mode, reason });
    writeCache(newCache);
    process.exit(0);
    return;
  }

  const ok = runUpdateState(args);
  writeCache(newCache);
  log(ok ? 'info' : 'warn', 'hook ejecutado', {
    mode,
    task_id: taskId,
    cmd: args[0],
    ok,
    duration_ms: Date.now() - t0,
  });

  // SIEMPRE exit 0 — fail-safe. No bloqueamos al Agent jamás.
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isMain) {
  main();
}
