import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import { addSprint } from './memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_ROADMAP_DIR = join(REPO_ROOT, 'roadmap');

const FILE_NAMES = {
  roadmapMd: 'roadmap.md',
  currentSprint: 'current-sprint.json',
};

const PRIORITIES = ['alta', 'media', 'baja', 'sin-priorizar'];
const TASK_STATUSES = ['pending', 'in_progress', 'completed'];

// Section markers in roadmap.md. Editing inside the markers is safe; everything else
// is human-authored prose that we must not rewrite. Keeping these as HTML comments
// means the rendered markdown stays clean for humans.
const MARKERS = {
  tasks: { start: '<!-- tasks-start -->', end: '<!-- tasks-end -->' },
  preview: { start: '<!-- preview-start -->', end: '<!-- preview-end -->' },
  alta: { start: '<!-- prio-alta-start -->', end: '<!-- prio-alta-end -->' },
  media: { start: '<!-- prio-media-start -->', end: '<!-- prio-media-end -->' },
  baja: { start: '<!-- prio-baja-start -->', end: '<!-- prio-baja-end -->' },
  ideas: { start: '<!-- ideas-crudas-start -->', end: '<!-- ideas-crudas-end -->' },
};

export class RoadmapError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'RoadmapError';
    this.details = details;
  }
}

function resolveRoadmapDir(roadmapDir) {
  return resolve(roadmapDir || DEFAULT_ROADMAP_DIR);
}

function pathFor(roadmapDir, key) {
  return join(resolveRoadmapDir(roadmapDir), FILE_NAMES[key]);
}

function nowISO() {
  return new Date().toISOString();
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function nowStamp() {
  // Compact local-friendly stamp YYYY-MM-DD HH:MM (UTC). Used in the markdown view —
  // keeping it human-readable matters more than precision.
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function atomicWrite(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, contents, 'utf8');
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new RoadmapError(`JSON inválido en ${filePath}: ${e.message}`);
  }
}

function blankSprint(number = 1) {
  return {
    number,
    objective: '',
    started_at: '',
    target_close: '',
    tasks: [],
    backlog_added_during_sprint: [],
  };
}

function readSprint(roadmapDir) {
  const path = pathFor(roadmapDir, 'currentSprint');
  const data = readJSON(path);
  if (!data) return blankSprint();
  // Defensive defaults so external edits don't crash callers downstream.
  return {
    number: typeof data.number === 'number' ? data.number : 1,
    objective: data.objective || '',
    started_at: data.started_at || '',
    target_close: data.target_close || '',
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    backlog_added_during_sprint: Array.isArray(data.backlog_added_during_sprint)
      ? data.backlog_added_during_sprint
      : [],
  };
}

function writeSprint(sprint, roadmapDir) {
  const path = pathFor(roadmapDir, 'currentSprint');
  atomicWrite(path, JSON.stringify(sprint, null, 2) + '\n');
  return { path };
}

function readMarkdown(roadmapDir) {
  const path = pathFor(roadmapDir, 'roadmapMd');
  if (!existsSync(path)) {
    throw new RoadmapError(`roadmap.md no existe en ${path}. Inicializa el roadmap antes de operar.`);
  }
  return readFileSync(path, 'utf8');
}

function writeMarkdown(text, roadmapDir) {
  const path = pathFor(roadmapDir, 'roadmapMd');
  atomicWrite(path, text);
  return { path };
}

// Replace the body between start/end markers. We never delete the markers themselves,
// so the file stays editable even if a human writes prose around them.
function replaceSection(md, marker, newBody) {
  const startIdx = md.indexOf(marker.start);
  const endIdx = md.indexOf(marker.end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new RoadmapError(`marcadores no encontrados en roadmap.md: ${marker.start} / ${marker.end}`);
  }
  const before = md.slice(0, startIdx + marker.start.length);
  const after = md.slice(endIdx);
  const body = newBody.length ? `\n${newBody}\n` : '\n';
  return `${before}${body}${after}`;
}

function readSection(md, marker) {
  const startIdx = md.indexOf(marker.start);
  const endIdx = md.indexOf(marker.end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return md.slice(startIdx + marker.start.length, endIdx).trim();
}

function renderTasks(tasks) {
  if (!tasks.length) return '';
  return tasks.map(t => {
    const checked = t.status === 'completed' ? '[x]' : '[ ]';
    const owner = t.owner ? ` _(owner: ${t.owner})_` : '';
    return `- ${checked} ${t.title}${owner}`;
  }).join('\n');
}

function renderIdeasCrudas(items) {
  if (!items.length) return '';
  return items.map(i => `- ${i.timestamp} ${i.idea}`).join('\n');
}

function renderHeader(sprint) {
  const objective = sprint.objective || '(sin objetivo declarado)';
  const inicio = sprint.started_at ? sprint.started_at.slice(0, 10) : '(pendiente)';
  const meta = sprint.target_close ? sprint.target_close.slice(0, 10) : '(pendiente)';
  return [
    `**Sprint ${sprint.number} — ${objective}**`,
    `- Inicio: ${inicio}`,
    `- Meta: ${meta}`,
    `- Estado: en progreso`,
    '',
  ].join('\n');
}

// Replace the sprint header block (the four lines under "## Sprint actual").
// We anchor on "## Sprint actual" up to "### Tareas del sprint" — both are stable
// section titles in the template, so this is safer than guessing line counts.
function replaceSprintHeader(md, sprint) {
  const startTag = '## Sprint actual';
  const endTag = '### Tareas del sprint';
  const startIdx = md.indexOf(startTag);
  const endIdx = md.indexOf(endTag);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return md;
  const before = md.slice(0, startIdx + startTag.length);
  const after = md.slice(endIdx);
  return `${before}\n\n${renderHeader(sprint)}\n${after}`;
}

function rerenderTasksAndIdeas(md, sprint) {
  let next = md;
  next = replaceSection(next, MARKERS.tasks, renderTasks(sprint.tasks));
  const ideas = sprint.backlog_added_during_sprint.filter(b => b.priority === 'sin-priorizar');
  next = replaceSection(next, MARKERS.ideas, renderIdeasCrudas(ideas));
  return next;
}

function rerenderAll(md, sprint) {
  let next = replaceSprintHeader(md, sprint);
  next = rerenderTasksAndIdeas(next, sprint);
  return next;
}

function makeTaskId(existingTasks) {
  const used = new Set(existingTasks.map(t => t.id));
  let i = existingTasks.length + 1;
  while (used.has(`task-${i}`)) i += 1;
  return `task-${i}`;
}

// Idempotency for /idea: same trimmed text inside the same sprint is a no-op.
// Avoids duplicating ideas when the user re-runs the command while exploring.
function ideaAlreadyCaptured(sprint, text) {
  const norm = text.trim().toLowerCase();
  return sprint.backlog_added_during_sprint.some(
    b => (b.idea || '').trim().toLowerCase() === norm,
  );
}

export function readRoadmap(roadmapDir) {
  return {
    markdown: readMarkdown(roadmapDir),
    sprint: readSprint(roadmapDir),
  };
}

export function getCurrentSprint(roadmapDir) {
  return readSprint(roadmapDir);
}

export function addIdea({ text, priority = 'sin-priorizar', context } = {}, roadmapDir) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new RoadmapError('addIdea: text es requerido y no puede estar vacío');
  }
  if (!PRIORITIES.includes(priority)) {
    throw new RoadmapError(`addIdea: priority debe ser uno de [${PRIORITIES.join(', ')}]`);
  }
  const sprint = readSprint(roadmapDir);
  if (ideaAlreadyCaptured(sprint, text)) {
    return { added: false, reason: 'duplicado', idea: text.trim() };
  }
  const entry = {
    timestamp: nowStamp(),
    idea: text.trim(),
    priority,
    ...(context ? { context } : {}),
  };
  sprint.backlog_added_during_sprint.push(entry);
  writeSprint(sprint, roadmapDir);

  let md = readMarkdown(roadmapDir);
  if (priority === 'sin-priorizar') {
    const ideas = sprint.backlog_added_during_sprint.filter(b => b.priority === 'sin-priorizar');
    md = replaceSection(md, MARKERS.ideas, renderIdeasCrudas(ideas));
  } else {
    const marker = MARKERS[priority];
    const current = readSection(md, marker);
    const line = `- ${entry.idea}${context ? ` _(contexto: ${context})_` : ''}`;
    const next = current ? `${current}\n${line}` : line;
    md = replaceSection(md, marker, next);
  }
  writeMarkdown(md, roadmapDir);

  return { added: true, idea: entry };
}

export function addTask({ title, owner } = {}, roadmapDir) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new RoadmapError('addTask: title es requerido y no puede estar vacío');
  }
  const sprint = readSprint(roadmapDir);
  const id = makeTaskId(sprint.tasks);
  const task = {
    id,
    title: title.trim(),
    status: 'pending',
    owner: owner || 'human',
  };
  sprint.tasks.push(task);
  writeSprint(sprint, roadmapDir);

  let md = readMarkdown(roadmapDir);
  md = replaceSection(md, MARKERS.tasks, renderTasks(sprint.tasks));
  writeMarkdown(md, roadmapDir);

  return { added: true, task };
}

export function updateTaskStatus(taskId, status, roadmapDir) {
  if (!taskId) throw new RoadmapError('updateTaskStatus: taskId requerido');
  if (!TASK_STATUSES.includes(status)) {
    throw new RoadmapError(`updateTaskStatus: status debe ser uno de [${TASK_STATUSES.join(', ')}]`);
  }
  const sprint = readSprint(roadmapDir);
  const task = sprint.tasks.find(t => t.id === taskId);
  if (!task) throw new RoadmapError(`updateTaskStatus: task "${taskId}" no encontrada`);
  task.status = status;
  writeSprint(sprint, roadmapDir);

  let md = readMarkdown(roadmapDir);
  md = replaceSection(md, MARKERS.tasks, renderTasks(sprint.tasks));
  writeMarkdown(md, roadmapDir);

  return { taskId, status };
}

export function completeTask(taskId, roadmapDir) {
  return updateTaskStatus(taskId, 'completed', roadmapDir);
}

export function startSprint({ number, objective, target_close } = {}, roadmapDir) {
  if (!objective || typeof objective !== 'string' || !objective.trim()) {
    throw new RoadmapError('startSprint: objective es requerido');
  }
  const current = readSprint(roadmapDir);
  const next = blankSprint(typeof number === 'number' ? number : current.number || 1);
  next.objective = objective.trim();
  next.started_at = nowISO();
  next.target_close = target_close || '';
  writeSprint(next, roadmapDir);

  let md = readMarkdown(roadmapDir);
  md = rerenderAll(md, next);
  writeMarkdown(md, roadmapDir);

  return { sprint: next };
}

export function closeSprint({ lessons = [], deliverables = [] } = {}, roadmapDir, memoryDir) {
  if (!Array.isArray(lessons)) {
    throw new RoadmapError('closeSprint: lessons debe ser array');
  }
  if (!Array.isArray(deliverables)) {
    throw new RoadmapError('closeSprint: deliverables debe ser array');
  }
  const sprint = readSprint(roadmapDir);
  if (!sprint.objective) {
    throw new RoadmapError('closeSprint: sprint actual no tiene objective; nada para cerrar');
  }

  // The closing date defaults to today. start_date stays whatever was recorded.
  const start = sprint.started_at ? sprint.started_at.slice(0, 10) : todayISODate();
  const end = todayISODate();

  // Auto-derive deliverables from completed tasks if caller didn't pass any explicitly.
  // Caller still wins — this just spares them re-typing what's already in tasks.
  const completedFromTasks = sprint.tasks
    .filter(t => t.status === 'completed')
    .map(t => t.title);
  const finalDeliverables = deliverables.length ? deliverables : completedFromTasks;

  addSprint({
    number: sprint.number,
    objective: sprint.objective,
    deliverables: finalDeliverables,
    lessons,
    dates: { start, end },
  }, memoryDir);

  // Roll over: ideas captured during this sprint stay structured in the markdown
  // (they remain in priority sections; only "sin-priorizar" had been written from JSON,
  // and re-rendering with the empty new sprint will clear them — so we preserve them
  // by re-injecting unprioritized ideas as text-only, no JSON tracking next sprint).
  // Decision: after close, "Ideas crudas" is wiped on the markdown side too — the user
  // either prioritized them or accepts they were noise. This keeps the next sprint clean.
  const nextNumber = (sprint.number || 0) + 1;
  const fresh = blankSprint(nextNumber);
  writeSprint(fresh, roadmapDir);

  let md = readMarkdown(roadmapDir);
  md = rerenderAll(md, fresh);
  writeMarkdown(md, roadmapDir);

  return {
    closed_sprint: sprint.number,
    next_sprint: nextNumber,
    deliverables: finalDeliverables,
    lessons,
  };
}

export function prioritizeIdea({ ideaText, newPriority } = {}, roadmapDir) {
  if (!ideaText || typeof ideaText !== 'string') {
    throw new RoadmapError('prioritizeIdea: ideaText requerido');
  }
  if (!['alta', 'media', 'baja'].includes(newPriority)) {
    throw new RoadmapError('prioritizeIdea: newPriority debe ser alta|media|baja');
  }
  const sprint = readSprint(roadmapDir);
  const norm = ideaText.trim().toLowerCase();
  const idea = sprint.backlog_added_during_sprint.find(
    b => (b.idea || '').trim().toLowerCase() === norm,
  );
  if (!idea) {
    throw new RoadmapError(`prioritizeIdea: idea "${ideaText}" no encontrada en backlog del sprint`);
  }
  if (idea.priority === newPriority) {
    return { moved: false, reason: 'misma-prioridad', idea };
  }
  idea.priority = newPriority;
  writeSprint(sprint, roadmapDir);

  let md = readMarkdown(roadmapDir);
  // Refresh "Ideas crudas" (the source of truth-by-rendering for unprioritized).
  const ideas = sprint.backlog_added_during_sprint.filter(b => b.priority === 'sin-priorizar');
  md = replaceSection(md, MARKERS.ideas, renderIdeasCrudas(ideas));
  // Append into the priority section without rewriting humans' prior bullets.
  const marker = MARKERS[newPriority];
  const current = readSection(md, marker);
  const line = `- ${idea.idea}${idea.context ? ` _(contexto: ${idea.context})_` : ''}`;
  // Avoid duplicating if the line is already there literally.
  const exists = current.split('\n').some(l => l.trim() === line.trim());
  const nextBody = exists ? current : (current ? `${current}\n${line}` : line);
  md = replaceSection(md, marker, nextBody);
  writeMarkdown(md, roadmapDir);

  return { moved: true, idea };
}

export function summarize(roadmapDir) {
  const sprint = readSprint(roadmapDir);
  const tasksPending = sprint.tasks.filter(t => t.status !== 'completed').length;
  const tasksCompleted = sprint.tasks.filter(t => t.status === 'completed').length;
  const ideasCapturadas = sprint.backlog_added_during_sprint.length;
  const ideasPriorizadas = sprint.backlog_added_during_sprint.filter(
    b => b.priority !== 'sin-priorizar',
  ).length;
  return {
    sprint_actual: {
      number: sprint.number,
      objective: sprint.objective,
      started_at: sprint.started_at,
      target_close: sprint.target_close,
    },
    tasks_pending: tasksPending,
    tasks_completed: tasksCompleted,
    ideas_capturadas: ideasCapturadas,
    ideas_priorizadas: ideasPriorizadas,
    paths: {
      roadmapMd: pathFor(roadmapDir, 'roadmapMd'),
      currentSprint: pathFor(roadmapDir, 'currentSprint'),
    },
  };
}

export const _internal = { MARKERS, PRIORITIES, TASK_STATUSES, blankSprint };
