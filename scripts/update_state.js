// scripts/update_state.js
// Helper CLI para que cualquier agente (o el orquestador) actualice dashboard/state.json
// de forma atómica. Si el servidor está vivo en DASHBOARD_PORT, también notifica vía POST.
//
// Comandos:
//   task-start    <task-id> <agent> <agent-role> <title> [files...]
//   task-update   <task-id> <json-patch>            (v2: parche parcial sobre la tarea)
//   task-artifact <task-id> <path> [kind] [title]   (v2: registra entregable y dispara review-worthy)
//   task-complete <task-id> [tokens]
//   task-fail     <task-id> <reason>
//   task-review-seen <task-id>                       (v2: marca como visto por humano)
//   event         <type> <json-payload>
//   skill-add     <skill-name>
//   skill-remove  <skill-name>
//
// v2 — campos opcionales en cada task (aditivos, retro-compatibles):
//   role_full      string      Rol del agente sin truncar (preservado al lanzarlo).
//   summary        string      1 línea de contexto humano para la card.
//   origin         string      "council:<name>" | "sprint:<num>" | "decision:..." | etc.
//   gate           string      "cold-reader" | "critic" | null
//   artifacts      array<obj>  [{ path, kind: "image"|"file"|"link", title?, mime? }]
//   review_worthy  boolean     true cuando vale la pena que el humano la vea.
//   review_reason  string      por qué se marcó (auto o manual).
//   review_seen    boolean     true cuando el humano ya la revisó.
//
// v2.1 (fase 6 expandida) — drill-down opcional para el side panel:
//   prompt_brief   string      Brief en lenguaje humano del prompt completo del agente.
//   plan_steps     string[]    Pasos planificados que el agente declara seguir.
//   current_step   integer     Índice 0-based del paso actual en plan_steps.
//
// v2.2 (fase 7) — agrupación organizativa para roadmap macro:
//   phase          string|null Fase del proyecto en que vive la task (ej. "design", "build", "validate").
//   epic           string|null Épica que agrupa varias tasks bajo un objetivo mayor (ej. "dashboard-v3").
//   Ambos opcionales, default null. El panel los muestra cuando están presentes y
//   permite agrupar visualmente cuando el sprint cruza muchas tasks de épicas distintas.
//
// v2.3 (Sprint v3.1) — asociación al sprint vivo:
//   sprint_number  integer|null Número del sprint en que vive la task. Auto-poblado
//                  desde roadmap/current-sprint.json al hacer task-start si hay
//                  sprint activo. Si no hay sprint activo, queda null. Permite al
//                  panel agrupar tasks por sprint y distinguir sprints terminados
//                  de actuales (feedback 2026-05-12).
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
const CURRENT_SPRINT_PATH = join(REPO_ROOT, 'roadmap', 'current-sprint.json');

const PORT = parseInt(process.env.DASHBOARD_PORT || '7777', 10);

// v2.3 (Sprint v3.1): lee el número del sprint vivo desde roadmap/current-sprint.json.
// Si no existe, está vacío o es inválido, devuelve null. Best-effort — no falla
// al usuario si no hay sprint activo (caso típico al iniciar el proyecto antes
// del kickoff).
function readCurrentSprintNumber() {
  if (!existsSync(CURRENT_SPRINT_PATH)) return null;
  try {
    const raw = readFileSync(CURRENT_SPRINT_PATH, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.number !== 'number' || !Number.isInteger(parsed.number) || parsed.number <= 0) {
      return null;
    }
    // Un sprint sin objective declarado no es un sprint "real" — es un placeholder
    // post-closeSprint. No asociamos tasks a sprints fantasma.
    if (!parsed.objective || typeof parsed.objective !== 'string' || !parsed.objective.trim()) {
      return null;
    }
    return parsed.number;
  } catch {
    return null;
  }
}

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

// v2: completa los campos opcionales de cada task con defaults seguros para
// que las tasks viejas (sin estos campos) sigan funcionando sin tocarlas en disco.
function ensureTaskV2Fields(task) {
  if (!task || typeof task !== 'object') return task;
  if (task.role_full === undefined) task.role_full = task.agent_role || null;
  if (task.summary === undefined) task.summary = null;
  if (task.origin === undefined) task.origin = null;
  if (task.gate === undefined) task.gate = null;
  if (!Array.isArray(task.artifacts)) task.artifacts = [];
  if (typeof task.review_worthy !== 'boolean') task.review_worthy = false;
  if (task.review_reason === undefined) task.review_reason = null;
  if (typeof task.review_seen !== 'boolean') task.review_seen = false;
  // v2.1 (fase 6 expandida): drill-down opcional.
  if (task.prompt_brief === undefined) task.prompt_brief = null;
  if (!Array.isArray(task.plan_steps)) task.plan_steps = [];
  if (typeof task.current_step !== 'number' || !Number.isInteger(task.current_step) || task.current_step < 0) {
    task.current_step = 0;
  }
  // v2.2 (fase 7): agrupación organizativa por fase y épica.
  if (task.phase === undefined) task.phase = null;
  if (task.epic === undefined) task.epic = null;
  // v2.3 (Sprint v3.1): asociación al sprint vivo. Default null = task creada
  // sin sprint activo (legacy o running fuera de un sprint).
  if (task.sprint_number === undefined) task.sprint_number = null;
  if (task.sprint_number !== null && (!Number.isInteger(task.sprint_number) || task.sprint_number < 0)) {
    task.sprint_number = null;
  }
  return task;
}

function readState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    if (!raw.trim()) return emptyState();
    const parsed = JSON.parse(raw);
    const base = emptyState();
    const tasks = Array.isArray(parsed.active_tasks) ? parsed.active_tasks : [];
    return {
      session_id: parsed.session_id || base.session_id,
      session_started_at: parsed.session_started_at || base.session_started_at,
      active_tasks: tasks.map(ensureTaskV2Fields),
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

// ---------- helpers de heurística para review-worthy (v2) ----------

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|bmp|tiff?)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|flac|aac|m4a)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv)$/i;

function inferArtifactKind(p, mime) {
  if (mime && typeof mime === 'string') {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
  }
  if (typeof p !== 'string') return 'file';
  if (/^https?:\/\//i.test(p)) return 'link';
  if (IMAGE_EXT_RE.test(p)) return 'image';
  if (AUDIO_EXT_RE.test(p)) return 'audio';
  if (VIDEO_EXT_RE.test(p)) return 'video';
  return 'file';
}

// Decide si una task es review-worthy y por qué. Heurística:
//   1. Origin council:* → siempre.
//   2. Gate cold-reader → siempre.
//   3. Tiene artifacts binarios (image/audio/video) → siempre.
//   4. review_worthy explícito → respeta el override manual.
// NOTA: removida la heurística "first-of-agent" (2026-05-11) porque saturaba el
// dashboard de halos amarillos en uso normal. El halo debe significar "hay algo
// serio que mirar", no "es un agente nuevo".
function computeReviewWorthy(task, state) {
  if (task.review_worthy === true && task.review_reason) {
    return { worthy: true, reason: task.review_reason };
  }
  if (typeof task.origin === 'string' && task.origin.startsWith('council:')) {
    return { worthy: true, reason: 'council' };
  }
  if (task.gate === 'cold-reader') {
    return { worthy: true, reason: 'cold-reader' };
  }
  const arts = Array.isArray(task.artifacts) ? task.artifacts : [];
  if (arts.some(a => a && (a.kind === 'image' || a.kind === 'audio' || a.kind === 'video'))) {
    return { worthy: true, reason: 'binary-artifact' };
  }
  return { worthy: false, reason: null };
}

function refreshReviewWorthy(task, state) {
  const decision = computeReviewWorthy(task, state);
  if (decision.worthy) {
    task.review_worthy = true;
    if (!task.review_reason) task.review_reason = decision.reason;
  }
}

// v2.1: separa flags --prompt, --plan-step (repetible), --current-step de los
// positional args. Devuelve { positionals, flags } sin tocar el orden de los
// positionals. Permite que el call site siga usando [files...] como antes.
function extractTaskStartFlags(rawArgs) {
  const positionals = [];
  const flags = { prompt: null, planSteps: [], currentStep: null, phase: null, epic: null, sprintNumber: null };
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--prompt') {
      flags.prompt = rawArgs[i + 1] || null; i += 1;
    } else if (a === '--plan-step') {
      const v = rawArgs[i + 1]; i += 1;
      if (typeof v === 'string' && v.length > 0) flags.planSteps.push(v);
    } else if (a === '--current-step') {
      const v = rawArgs[i + 1]; i += 1;
      const n = parseInt(v, 10);
      if (Number.isInteger(n) && n >= 0) flags.currentStep = n;
    } else if (a === '--phase') {
      const v = rawArgs[i + 1]; i += 1;
      if (typeof v === 'string' && v.length > 0) flags.phase = v;
    } else if (a === '--epic') {
      const v = rawArgs[i + 1]; i += 1;
      if (typeof v === 'string' && v.length > 0) flags.epic = v;
    } else if (a === '--sprint-number') {
      const v = rawArgs[i + 1]; i += 1;
      const n = parseInt(v, 10);
      if (Number.isInteger(n) && n >= 0) flags.sprintNumber = n;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function cmdTaskStart(args) {
  const { positionals, flags } = extractTaskStartFlags(args);
  const [taskId, agent, agentRole, title, ...files] = positionals;
  if (!taskId || !agent || !agentRole || !title) {
    fail('uso: task-start <task-id> <agent> <agent-role> <title> [files...] [--prompt "<brief>"] [--plan-step "paso"]... [--current-step <n>] [--phase <name>] [--epic <name>] [--sprint-number <n>]');
  }
  const state = readState();
  // Si ya existe una tarea con ese ID, la reseteamos a running (idempotencia útil).
  state.active_tasks = state.active_tasks.filter(t => t.id !== taskId);

  // v2.3 (Sprint v3.1): auto-poblar sprint_number desde current-sprint.json
  // si no se pasó por flag y hay sprint activo. Override por --sprint-number gana.
  const autoSprint = flags.sprintNumber !== null ? flags.sprintNumber : readCurrentSprintNumber();

  const task = {
    id: taskId,
    title,
    agent,
    agent_role: agentRole,
    role_full: agentRole, // v2: backup del rol completo, sin truncar a futuro.
    status: 'running',
    files_in_use: files,
    started_at: nowISO(),
    ended_at: null,
    tokens_estimated: 0,
    skill_invoked: null,
    // v2 fields (defaults seguros)
    summary: null,
    origin: null,
    gate: null,
    artifacts: [],
    review_worthy: false,
    review_reason: null,
    review_seen: false,
    // v2.1 fields (defaults seguros)
    prompt_brief: flags.prompt,
    plan_steps: flags.planSteps.length ? flags.planSteps : [],
    current_step: flags.currentStep !== null ? flags.currentStep : 0,
    // v2.2 fields (defaults null)
    phase: flags.phase,
    epic: flags.epic,
    // v2.3 fields (auto-poblado desde current-sprint o flag)
    sprint_number: autoSprint,
  };
  state.active_tasks.push(task);
  refreshReviewWorthy(task, state);
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
  refreshReviewWorthy(task, state);
  pushEvent(state, 'task_completed', { id: taskId, tokens });
  return state;
}

// v2: parche parcial sobre una task existente. Acepta JSON con campos opcionales:
// title, summary, origin, gate, role_full, artifacts (reemplaza), review_worthy,
// review_reason, skill_invoked, files_in_use (reemplaza).
function cmdTaskUpdate(args) {
  const [taskId, ...rest] = args;
  if (!taskId) fail('uso: task-update <task-id> <json-patch>');
  const raw = rest.join(' ').trim();
  if (!raw) fail('task-update: el patch JSON no puede estar vacío');
  let patch;
  try { patch = JSON.parse(raw); }
  catch (e) { fail(`task-update: patch JSON inválido: ${e.message}`); }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('task-update: el patch debe ser un objeto JSON');
  }
  const state = readState();
  const task = state.active_tasks.find(t => t.id === taskId);
  if (!task) fail(`task-update: no existe tarea con id "${taskId}"`);

  const ALLOWED = [
    'title', 'summary', 'origin', 'gate', 'role_full', 'agent_role',
    'artifacts', 'review_worthy', 'review_reason', 'review_seen',
    'skill_invoked', 'files_in_use',
    // v2.1 (fase 6 expandida): drill-down opcional para el side panel.
    'prompt_brief', 'plan_steps', 'current_step',
    // v2.2 (fase 7): agrupación organizativa por fase y épica.
    'phase', 'epic',
    // v2.3 (Sprint v3.1): asociación al sprint vivo.
    'sprint_number',
  ];
  for (const k of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      // artifacts: aceptamos array. Normalizamos cada entrada a la forma esperada.
      if (k === 'artifacts' && Array.isArray(patch.artifacts)) {
        task.artifacts = patch.artifacts
          .filter(a => a && typeof a === 'object' && typeof a.path === 'string')
          .map(a => ({
            path: a.path,
            kind: a.kind || inferArtifactKind(a.path, a.mime),
            title: a.title || null,
            mime: a.mime || null,
          }));
      } else if (k === 'plan_steps') {
        // plan_steps: aceptamos array de strings; descartamos entradas no-string.
        task.plan_steps = Array.isArray(patch.plan_steps)
          ? patch.plan_steps.filter(s => typeof s === 'string' && s.length > 0)
          : [];
      } else if (k === 'current_step') {
        const n = parseInt(patch.current_step, 10);
        task.current_step = Number.isInteger(n) && n >= 0 ? n : 0;
      } else if (k === 'prompt_brief') {
        task.prompt_brief = patch.prompt_brief === null
          ? null
          : (typeof patch.prompt_brief === 'string' ? patch.prompt_brief : null);
      } else if (k === 'phase' || k === 'epic') {
        // v2.2: phase y epic son string|null. Cualquier otro tipo → null defensivo.
        task[k] = patch[k] === null
          ? null
          : (typeof patch[k] === 'string' && patch[k].length > 0 ? patch[k] : null);
      } else if (k === 'sprint_number') {
        // v2.3: integer|null. Cualquier otra cosa → null defensivo.
        if (patch.sprint_number === null) {
          task.sprint_number = null;
        } else {
          const n = parseInt(patch.sprint_number, 10);
          task.sprint_number = Number.isInteger(n) && n >= 0 ? n : null;
        }
      } else {
        task[k] = patch[k];
      }
    }
  }
  refreshReviewWorthy(task, state);
  pushEvent(state, 'task_updated', { id: taskId, fields: Object.keys(patch) });
  return state;
}

// v2: agrega un artifact a la task. kind se infiere si no se da.
function cmdTaskArtifact(args) {
  const [taskId, path, kindArg, ...titleParts] = args;
  if (!taskId || !path) fail('uso: task-artifact <task-id> <path> [kind] [title]');
  const title = titleParts.join(' ').trim() || null;
  const kind = kindArg || inferArtifactKind(path);
  const state = readState();
  const task = state.active_tasks.find(t => t.id === taskId);
  if (!task) fail(`task-artifact: no existe tarea con id "${taskId}"`);
  if (!Array.isArray(task.artifacts)) task.artifacts = [];
  // Dedup por path.
  if (!task.artifacts.some(a => a && a.path === path)) {
    task.artifacts.push({ path, kind, title, mime: null });
  }
  refreshReviewWorthy(task, state);
  pushEvent(state, 'artifact_emitted', { id: taskId, path, kind, title });
  return state;
}

// v2: marca la task como vista por humano (apaga el badge "REVIEW").
function cmdTaskReviewSeen(args) {
  const [taskId] = args;
  if (!taskId) fail('uso: task-review-seen <task-id>');
  const state = readState();
  const task = state.active_tasks.find(t => t.id === taskId);
  if (!task) fail(`task-review-seen: no existe tarea con id "${taskId}"`);
  task.review_seen = true;
  pushEvent(state, 'task_review_seen', { id: taskId });
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

// Sprint v3.1: chat público orquestador ↔ agentes.
// Comando: `say <from> <to> <message>`. POSTea a /api/chat (best-effort) y
// además escribe local a dashboard/chat-log.jsonl (silencioso si server caído).
// La writethrough es importante para no perder narrativa cuando el dashboard
// está apagado.
const CHAT_LOG_PATH_LOCAL = join(REPO_ROOT, 'dashboard', 'chat-log.jsonl');

async function cmdSay(args) {
  const [from, to, ...msgParts] = args;
  const message = msgParts.join(' ').trim();
  if (!from || !to || !message) {
    fail('uso: say <from> <to> <message>');
  }
  const entry = {
    from: String(from).slice(0, 80),
    to: String(to).slice(0, 80),
    message: String(message).slice(0, 4000),
    timestamp: nowISO(),
  };

  // 1) Persistir local SIEMPRE (incluso si el server no está).
  try {
    mkdirSync(dirname(CHAT_LOG_PATH_LOCAL), { recursive: true });
    appendFileSync(CHAT_LOG_PATH_LOCAL, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.warn(`[update_state] aviso: no pude escribir chat-log.jsonl: ${e.message}`);
  }

  // 2) Notificar al server (mejor effort).
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 500);
    const res = await fetch(`http://localhost:${PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      // Posible duplicado (el server también persiste si recibe). Mensaje suave.
      console.warn(`[update_state] aviso: /api/chat respondió ${res.status}`);
    }
  } catch {
    // Server no levantado: el log local ya está hecho.
  }
  // No retornamos state: `say` no modifica state.json, escribe a chat-log aparte.
  return null;
}

const COMMANDS = {
  'task-start': cmdTaskStart,
  'task-update': cmdTaskUpdate,
  'task-artifact': cmdTaskArtifact,
  'task-review-seen': cmdTaskReviewSeen,
  'task-complete': cmdTaskComplete,
  'task-fail': cmdTaskFail,
  'event': cmdEvent,
  'skill-add': cmdSkillAdd,
  'skill-remove': cmdSkillRemove,
  'say': cmdSay,
};

// Comandos que NO modifican state.json — solo escriben a logs aparte y/o
// disparan eventos en el dashboard. Si el comando devuelve null, no escribimos
// state. (Mantiene atómica la escritura del state.)
const COMMANDS_WITHOUT_STATE = new Set(['say']);

function printUsage() {
  console.error('Uso:');
  console.error('  node scripts/update_state.js task-start       <task-id> <agent> <agent-role> <title> [files...] [--prompt "<brief>"] [--plan-step "paso"]... [--current-step <n>] [--phase <name>] [--epic <name>] [--sprint-number <n>]');
  console.error('  node scripts/update_state.js task-update      <task-id> <json-patch>');
  console.error('  node scripts/update_state.js task-artifact    <task-id> <path> [kind] [title]');
  console.error('  node scripts/update_state.js task-review-seen <task-id>');
  console.error('  node scripts/update_state.js task-complete    <task-id> [tokens]');
  console.error('  node scripts/update_state.js task-fail        <task-id> <reason>');
  console.error('  node scripts/update_state.js event            <type> <json-payload>');
  console.error('  node scripts/update_state.js skill-add        <skill-name>');
  console.error('  node scripts/update_state.js skill-remove     <skill-name>');
  console.error('  node scripts/update_state.js say              <from> <to> <message>');
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
    // Algunos comandos son async (ej. say hace fetch al server). Aceptamos
    // promesa o valor sincrónico.
    newState = await COMMANDS[cmd](args);
  } catch (e) {
    fail(e.message);
  }
  if (!COMMANDS_WITHOUT_STATE.has(cmd) && newState) {
    writeStateAtomic(newState);
    await notifyServer(newState);
  }
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
  cmdTaskUpdate,
  cmdTaskArtifact,
  cmdTaskReviewSeen,
  cmdTaskComplete,
  cmdTaskFail,
  cmdEvent,
  cmdSkillAdd,
  cmdSkillRemove,
  cmdSay,
  ensureTaskV2Fields,
  inferArtifactKind,
  computeReviewWorthy,
  STATE_PATH,
  HISTORY_LOG,
  CHAT_LOG_PATH_LOCAL,
};
