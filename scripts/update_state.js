// scripts/update_state.js
// Helper CLI para que cualquier agente (o el orquestador) actualice dashboard/state.json
// de forma atómica. Si el servidor está vivo en DASHBOARD_PORT, también notifica vía POST.
//
// Comandos:
//   task-start    <task-id> <agent> <agent-role> <title> [files...]
//   task-complete <task-id> [tokens]
//   task-fail     <task-id> <reason>
//   event         <type> <json-payload>
//   skill-add     <skill-name>
//   skill-remove  <skill-name>
//
// Exit code: 0 = ok, 1 = fallo. Mensajes en español neutro.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const STATE_PATH = join(REPO_ROOT, 'dashboard', 'state.json');
const HISTORY_DIR = join(REPO_ROOT, 'dashboard', 'history');
const HISTORY_LOG = join(HISTORY_DIR, 'events.log');

const PORT = parseInt(process.env.DASHBOARD_PORT || '7777', 10);

function nowISO() { return new Date().toISOString(); }

function fail(msg, code = 1) {
  console.error(`[update_state] error: ${msg}`);
  process.exit(code);
}

function emptyState() {
  return {
    session_id: randomUUID(),
    session_started_at: nowISO(),
    active_tasks: [],
    events: [],
    metrics: {
      total_tokens_session: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      councils_invoked: 0,
      images_generated: 0,
    },
    active_skills: [],
    current_sprint: { number: 0, objective: '(sin sprint declarado)' },
  };
}

function readState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    if (!raw.trim()) return emptyState();
    const parsed = JSON.parse(raw);
    const base = emptyState();
    return {
      session_id: parsed.session_id || base.session_id,
      session_started_at: parsed.session_started_at || base.session_started_at,
      active_tasks: Array.isArray(parsed.active_tasks) ? parsed.active_tasks : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      metrics: { ...base.metrics, ...(parsed.metrics || {}) },
      active_skills: Array.isArray(parsed.active_skills) ? parsed.active_skills : [],
      current_sprint: parsed.current_sprint || base.current_sprint,
    };
  } catch (e) {
    fail(`state.json corrupto, no se puede actualizar (${e.message}). Repara o elimínalo.`);
  }
}

function writeStateAtomic(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    renameSync(tmp, STATE_PATH);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    fail(`no pude escribir state.json: ${e.message}`);
  }
}

function appendHistoryEvent(ev) {
  mkdirSync(HISTORY_DIR, { recursive: true });
  appendFileSync(HISTORY_LOG, JSON.stringify(ev) + '\n', 'utf8');
}

function pushEvent(state, type, payload) {
  const ev = { timestamp: nowISO(), type, payload: payload || {} };
  state.events.push(ev);
  // Mantener cola en memoria razonable; history log persiste todo.
  if (state.events.length > 200) {
    state.events = state.events.slice(-200);
  }
  appendHistoryEvent(ev);
  return ev;
}

async function notifyServer(state) {
  // Best-effort: si el server no está vivo, silenciamos.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 500);
    const res = await fetch(`http://localhost:${PORT}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      // No es fatal: state.json ya está escrito en disco.
      console.warn(`[update_state] aviso: server respondió ${res.status} (state.json ya persistido en disco)`);
    }
  } catch {
    // Server no levantado: el filewatch lo recogerá cuando arranque, o el cliente
    // hará polling. No es fatal.
  }
}

// ---------- comandos ----------

function cmdTaskStart(args) {
  const [taskId, agent, agentRole, title, ...files] = args;
  if (!taskId || !agent || !agentRole || !title) {
    fail('uso: task-start <task-id> <agent> <agent-role> <title> [files...]');
  }
  const state = readState();
  // Si ya existe una tarea con ese ID, la reseteamos a running (idempotencia útil).
  state.active_tasks = state.active_tasks.filter(t => t.id !== taskId);
  const task = {
    id: taskId,
    title,
    agent,
    agent_role: agentRole,
    status: 'running',
    files_in_use: files,
    started_at: nowISO(),
    ended_at: null,
    tokens_estimated: 0,
    skill_invoked: null,
  };
  state.active_tasks.push(task);
  pushEvent(state, 'task_started', { id: taskId, agent, agent_role: agentRole, title, files });
  return state;
}

function cmdTaskComplete(args) {
  const [taskId, tokensRaw] = args;
  if (!taskId) fail('uso: task-complete <task-id> [tokens]');
  const tokens = tokensRaw ? parseInt(tokensRaw, 10) : 0;
  if (Number.isNaN(tokens)) fail('tokens debe ser un entero');
  const state = readState();
  const task = state.active_tasks.find(t => t.id === taskId);
  if (!task) fail(`task-complete: no existe tarea con id "${taskId}"`);
  task.status = 'completed';
  task.ended_at = nowISO();
  task.tokens_estimated = (task.tokens_estimated || 0) + tokens;
  state.metrics.tasks_completed = (state.metrics.tasks_completed || 0) + 1;
  state.metrics.total_tokens_session = (state.metrics.total_tokens_session || 0) + tokens;
  pushEvent(state, 'task_completed', { id: taskId, tokens });
  return state;
}

function cmdTaskFail(args) {
  const [taskId, ...reasonParts] = args;
  const reason = reasonParts.join(' ').trim();
  if (!taskId || !reason) fail('uso: task-fail <task-id> <reason>');
  const state = readState();
  const task = state.active_tasks.find(t => t.id === taskId);
  if (!task) fail(`task-fail: no existe tarea con id "${taskId}"`);
  task.status = 'failed';
  task.ended_at = nowISO();
  task.failure_reason = reason;
  state.metrics.tasks_failed = (state.metrics.tasks_failed || 0) + 1;
  pushEvent(state, 'task_failed', { id: taskId, reason });
  return state;
}

function cmdEvent(args) {
  const [type, ...rest] = args;
  if (!type) fail('uso: event <type> <json-payload>');
  const payloadRaw = rest.join(' ').trim() || '{}';
  let payload;
  try { payload = JSON.parse(payloadRaw); }
  catch (e) { fail(`payload no es JSON válido: ${e.message}`); }
  const state = readState();
  pushEvent(state, type, payload);
  // Métricas auto-derivadas para tipos conocidos.
  if (type === 'council_invoked') {
    state.metrics.councils_invoked = (state.metrics.councils_invoked || 0) + 1;
  }
  if (type === 'image_generated') {
    state.metrics.images_generated = (state.metrics.images_generated || 0) + 1;
  }
  return state;
}

function cmdSkillAdd(args) {
  const [skill] = args;
  if (!skill) fail('uso: skill-add <skill-name>');
  const state = readState();
  if (!state.active_skills.includes(skill)) {
    state.active_skills.push(skill);
  }
  pushEvent(state, 'skill_invoked', { skill, action: 'add' });
  return state;
}

function cmdSkillRemove(args) {
  const [skill] = args;
  if (!skill) fail('uso: skill-remove <skill-name>');
  const state = readState();
  state.active_skills = state.active_skills.filter(s => s !== skill);
  pushEvent(state, 'skill_invoked', { skill, action: 'remove' });
  return state;
}

const COMMANDS = {
  'task-start': cmdTaskStart,
  'task-complete': cmdTaskComplete,
  'task-fail': cmdTaskFail,
  'event': cmdEvent,
  'skill-add': cmdSkillAdd,
  'skill-remove': cmdSkillRemove,
};

function printUsage() {
  console.error('Uso:');
  console.error('  node scripts/update_state.js task-start    <task-id> <agent> <agent-role> <title> [files...]');
  console.error('  node scripts/update_state.js task-complete <task-id> [tokens]');
  console.error('  node scripts/update_state.js task-fail     <task-id> <reason>');
  console.error('  node scripts/update_state.js event         <type> <json-payload>');
  console.error('  node scripts/update_state.js skill-add     <skill-name>');
  console.error('  node scripts/update_state.js skill-remove  <skill-name>');
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || !COMMANDS[cmd]) {
    if (cmd) console.error(`[update_state] comando desconocido: "${cmd}"`);
    printUsage();
    process.exit(1);
  }
  let newState;
  try {
    newState = COMMANDS[cmd](args);
  } catch (e) {
    fail(e.message);
  }
  writeStateAtomic(newState);
  await notifyServer(newState);
  console.log(`[update_state] ok: ${cmd}`);
  process.exit(0);
}

// Permitir uso programático (tests) sin ejecutar el main.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}

export {
  readState,
  writeStateAtomic,
  cmdTaskStart,
  cmdTaskComplete,
  cmdTaskFail,
  cmdEvent,
  cmdSkillAdd,
  cmdSkillRemove,
  STATE_PATH,
  HISTORY_LOG,
};
