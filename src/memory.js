import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  appendFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SCHEMAS_DIR = join(REPO_ROOT, 'memory', 'schemas');

const FILE_NAMES = {
  profile: 'project-profile.json',
  decisions: 'decisions.md',
  lessons: 'lessons.md',
  team: 'active-team.json',
  sprintLog: 'sprint-log.md',
};

export class MemoryError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'MemoryError';
    this.details = details;
  }
}

let ajvInstance = null;

function getAjv() {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const name of ['project-profile.schema.json', 'active-team.schema.json']) {
    const path = join(SCHEMAS_DIR, name);
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const id = raw.$id || name.replace('.schema.json', '');
    if (!raw.$id) raw.$id = id;
    ajv.addSchema(raw, id);
  }
  ajvInstance = ajv;
  return ajv;
}

function validate(schemaId, data) {
  const ajv = getAjv();
  const validator = ajv.getSchema(schemaId);
  if (!validator) {
    throw new MemoryError(`schema "${schemaId}" no encontrado en memory/schemas/`);
  }
  const ok = validator(data);
  if (ok) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: validator.errors.map(e => ({
      path: e.instancePath || '(root)',
      message: humanError(e),
    })),
  };
}

function humanError(err) {
  const where = err.instancePath || '(root)';
  switch (err.keyword) {
    case 'required':
      return `falta el campo requerido "${err.params.missingProperty}" en ${where}`;
    case 'additionalProperties':
      return `campo no permitido "${err.params.additionalProperty}" en ${where}`;
    case 'enum':
      return `valor inválido en ${where}: se esperaba uno de [${err.params.allowedValues.join(', ')}]`;
    case 'type':
      return `tipo incorrecto en ${where}: se esperaba ${err.params.type}`;
    case 'minLength':
      return `el string en ${where} no puede estar vacío (mínimo ${err.params.limit} caracteres)`;
    case 'format':
      return `formato inválido en ${where}: se esperaba ${err.params.format}`;
    default:
      return `${err.keyword} falló en ${where}: ${err.message}`;
  }
}

// Atomic write protects against half-written files when the process dies mid-write,
// which corrupted memory in an early prototype where we used writeFileSync directly.
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

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function resolveMemoryDir(memoryDir) {
  return resolve(memoryDir || join(REPO_ROOT, 'memory'));
}

function pathFor(memoryDir, key) {
  return join(resolveMemoryDir(memoryDir), FILE_NAMES[key]);
}

function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new MemoryError(`JSON inválido en ${filePath}: ${e.message}`);
  }
}

export function readProfile(memoryDir) {
  return readJSON(pathFor(memoryDir, 'profile'));
}

export function writeProfile(profile, memoryDir) {
  if (!profile || typeof profile !== 'object') {
    throw new MemoryError('writeProfile: profile debe ser un objeto');
  }
  const result = validate('project-profile', profile);
  if (!result.valid) {
    const lines = result.errors.map(e => `  - ${e.message}`).join('\n');
    throw new MemoryError(`project-profile inválido:\n${lines}`, { errors: result.errors });
  }
  const target = pathFor(memoryDir, 'profile');
  atomicWrite(target, JSON.stringify(profile, null, 2) + '\n');
  return { path: target };
}

function ensureMarkdownFile(filePath, header) {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, header, 'utf8');
}

export function addDecision({ title, decision, reasoning, alternatives, reversibility }, memoryDir) {
  if (!title || !decision || !reasoning) {
    throw new MemoryError('addDecision: title, decision y reasoning son requeridos');
  }
  const allowed = ['alta', 'media', 'baja'];
  if (reversibility && !allowed.includes(reversibility)) {
    throw new MemoryError(`addDecision: reversibility debe ser uno de [${allowed.join(', ')}]`);
  }
  const path = pathFor(memoryDir, 'decisions');
  ensureMarkdownFile(path, '# Decisiones del proyecto\n\n');
  const entry = [
    `## ${todayISODate()}: ${title}`,
    '',
    `**Decisión:** ${decision}`,
    `**Razón:** ${reasoning}`,
    `**Alternativas consideradas:** ${alternatives || 'no documentadas'}`,
    `**Reversibilidad:** ${reversibility || 'media'}`,
    '',
    '',
  ].join('\n');
  appendFileSync(path, entry, 'utf8');
  return { path };
}

export function addLesson({ title, context, lesson, application }, memoryDir) {
  if (!title || !context || !lesson) {
    throw new MemoryError('addLesson: title, context y lesson son requeridos');
  }
  const path = pathFor(memoryDir, 'lessons');
  ensureMarkdownFile(path, '# Lessons aprendidas del proyecto\n\n');
  const entry = [
    `## ${title}`,
    '',
    `**Contexto:** ${context}`,
    `**Lección:** ${lesson}`,
    `**Cómo aplicarla:** ${application || 'pendiente de definir'}`,
    `**Fecha:** ${todayISODate()}`,
    '',
    '',
  ].join('\n');
  appendFileSync(path, entry, 'utf8');
  return { path };
}

export function getActiveTeam(memoryDir) {
  const data = readJSON(pathFor(memoryDir, 'team'));
  if (!data) return { agents: [], skills: [] };
  if (!Array.isArray(data.agents)) data.agents = [];
  if (!Array.isArray(data.skills)) data.skills = [];
  return data;
}

function writeActiveTeam(team, memoryDir) {
  const result = validate('active-team', team);
  if (!result.valid) {
    const lines = result.errors.map(e => `  - ${e.message}`).join('\n');
    throw new MemoryError(`active-team inválido:\n${lines}`, { errors: result.errors });
  }
  const target = pathFor(memoryDir, 'team');
  atomicWrite(target, JSON.stringify(team, null, 2) + '\n');
  return { path: target };
}

export function addAgent({ name, role, model, notas }, memoryDir) {
  if (!name || !role || !model) {
    throw new MemoryError('addAgent: name, role y model son requeridos');
  }
  const team = getActiveTeam(memoryDir);
  const now = nowISO();
  const existing = team.agents.find(a => a.name === name);
  if (existing) {
    existing.rol_corto = role;
    existing.modelo_asignado = model;
    existing.ultimo_uso = now;
    if (notas !== undefined) existing.notas = notas;
  } else {
    team.agents.push({
      name,
      rol_corto: role,
      modelo_asignado: model,
      fecha_activacion: now,
      ultimo_uso: now,
      total_invocaciones: 0,
      ...(notas ? { notas } : {}),
    });
  }
  writeActiveTeam(team, memoryDir);
  return { name, updated: !!existing };
}

export function removeAgent(name, memoryDir) {
  if (!name) throw new MemoryError('removeAgent: name requerido');
  const team = getActiveTeam(memoryDir);
  const before = team.agents.length;
  team.agents = team.agents.filter(a => a.name !== name);
  if (team.agents.length === before) return { name, removed: false };
  writeActiveTeam(team, memoryDir);
  return { name, removed: true };
}

export function touchAgent(name, memoryDir) {
  if (!name) throw new MemoryError('touchAgent: name requerido');
  const team = getActiveTeam(memoryDir);
  const agent = team.agents.find(a => a.name === name);
  if (!agent) {
    throw new MemoryError(`touchAgent: agente "${name}" no está en active-team`);
  }
  agent.ultimo_uso = nowISO();
  agent.total_invocaciones = (agent.total_invocaciones || 0) + 1;
  writeActiveTeam(team, memoryDir);
  return { name, total_invocaciones: agent.total_invocaciones };
}

export function addSkill({ name, notas }, memoryDir) {
  if (!name) throw new MemoryError('addSkill: name requerido');
  const team = getActiveTeam(memoryDir);
  const existing = team.skills.find(s => s.name === name);
  if (existing) {
    if (notas !== undefined) existing.notas = notas;
  } else {
    team.skills.push({
      name,
      fecha_activacion: nowISO(),
      ...(notas ? { notas } : {}),
    });
  }
  writeActiveTeam(team, memoryDir);
  return { name, updated: !!existing };
}

export function removeSkill(name, memoryDir) {
  if (!name) throw new MemoryError('removeSkill: name requerido');
  const team = getActiveTeam(memoryDir);
  const before = team.skills.length;
  team.skills = team.skills.filter(s => s.name !== name);
  if (team.skills.length === before) return { name, removed: false };
  writeActiveTeam(team, memoryDir);
  return { name, removed: true };
}

export function addSprint({ number, objective, deliverables = [], lessons = [], dates }, memoryDir) {
  if (number === undefined || number === null || !objective) {
    throw new MemoryError('addSprint: number y objective son requeridos');
  }
  if (!Array.isArray(deliverables)) {
    throw new MemoryError('addSprint: deliverables debe ser array');
  }
  if (!Array.isArray(lessons)) {
    throw new MemoryError('addSprint: lessons debe ser array');
  }
  const path = pathFor(memoryDir, 'sprintLog');
  ensureMarkdownFile(path, '# Sprint log\n\n');
  const fechas = dates && dates.start && dates.end
    ? `${dates.start} a ${dates.end}`
    : todayISODate();
  const lines = [
    `## Sprint ${number} — ${objective}`,
    '',
    `**Fechas:** ${fechas}`,
    `**Objetivo:** ${objective}`,
    '**Entregables:**',
    ...(deliverables.length ? deliverables.map(d => `- ${d}`) : ['- (sin entregables registrados)']),
    '',
    '**Lessons emergentes:**',
    ...(lessons.length ? lessons.map(l => `- ${l}`) : ['- (sin lessons emergentes)']),
    '',
    '',
  ];
  appendFileSync(path, lines.join('\n'), 'utf8');
  return { path, number };
}

// Skip headings inside ``` code fences and inside <!-- ... --> HTML comments
// so the example block in the template does not inflate the count.
function countMarkdownEntries(filePath) {
  if (!existsSync(filePath)) return 0;
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  let count = 0;
  let inFence = false;
  let inComment = false;
  for (const line of lines) {
    if (!inComment && /^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      if (!inComment && /<!--/.test(line)) {
        inComment = !/-->/.test(line);
        continue;
      }
      if (inComment) {
        if (/-->/.test(line)) inComment = false;
        continue;
      }
    }
    if (!inFence && !inComment && /^## /.test(line)) {
      count += 1;
    }
  }
  return count;
}

export function summarize(memoryDir) {
  const profile = readProfile(memoryDir);
  const team = getActiveTeam(memoryDir);
  const decisionsPath = pathFor(memoryDir, 'decisions');
  const lessonsPath = pathFor(memoryDir, 'lessons');
  const sprintLogPath = pathFor(memoryDir, 'sprintLog');

  return {
    has_profile: !!profile,
    project_type: profile?.project_type || null,
    mode: profile?.mode || null,
    description: profile?.description || null,
    tags: Array.isArray(profile?.tags) ? profile.tags : [],
    sprint_inicial: profile?.sprint_inicial || null,
    agentes_count: team.agents.length,
    skills_count: team.skills.length,
    // Listas resueltas para que la UI no necesite otro fetch.
    // Los nombres (active_team, active_skills_resolved) son aditivos:
    // los conteos de arriba siguen siendo el contrato estable que el test asserts.
    active_team: team.agents,
    active_skills_resolved: team.skills,
    decisiones_count: countMarkdownEntries(decisionsPath),
    lecciones_count: countMarkdownEntries(lessonsPath),
    sprints_completados: countMarkdownEntries(sprintLogPath),
    paths: {
      profile: pathFor(memoryDir, 'profile'),
      decisions: decisionsPath,
      lessons: lessonsPath,
      team: pathFor(memoryDir, 'team'),
      sprintLog: sprintLogPath,
    },
  };
}

export const _internal = { FILE_NAMES, REPO_ROOT };
