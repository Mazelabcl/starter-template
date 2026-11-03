// src/roles.js
// Fichas de rol: un archivo Markdown en roles/ + el agente general integrado =
// especialista al instante. Claude Code carga .claude/agents/*.md solo al iniciar la
// sesión; una ficha no necesita reiniciar porque su contenido viaja en el prompt.
// Un archivo fijo de agente solo hace falta si hay que restringir herramientas.
//
// CLI:
//   node src/roles.js list
//   node src/roles.js crear --id x --actua-como "..." --objetivo "..." [--modelo sonnet]
//                           [--contexto a.md,b.md] [--instrucciones "..."]
//                           [--herramientas-restringidas]
//   node src/roles.js prompt <id> "tarea" [--json]
// Todos aceptan --root <carpeta> (por defecto, la raíz de este proyecto).
//
// Instrucciones de las fichas en inglés; todo lo que ve el usuario, en español neutro.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import Ajv from 'ajv';

import { addAgent, touchAgent } from './memory.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(REPO_ROOT, 'roles', 'role.schema.json');
const NOT_CARDS = new Set(['README.md']);

export const GENERIC_AGENT = 'general-purpose';
export const LANGUAGE_RULE = 'Write everything you return to the orchestrator or the user in neutral Spanish (tuteo: tú, tienes, puedes). Never use voseo or Rioplatense words (vos, tenés, podés, decime, che). Code, commands and file names stay as they are.';
export const DEFAULT_BODY = [
  '- Stay inside the objective; if the task needs something else, say so instead of doing it.',
  '- If something is ambiguous, ask one question before changing anything.',
  '- Do not invent real-world data (prices, statistics, competitors): mark it as needing research.',
  '- Finish with what you did, the files you touched and what you could not verify.',
].join('\n');

export class RoleError extends Error {
  constructor(message, { code = 'unknown' } = {}) {
    super(message);
    this.name = 'RoleError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Formato de la ficha: frontmatter simple (clave: valor y listas) + cuerpo
// ---------------------------------------------------------------------------

function parseScalar(raw, lineNo) {
  const v = raw.trim();
  if (v === '' || v === 'null' || v === '~') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('"')) {
    try { return JSON.parse(v); } catch { throw new RoleError(`línea ${lineNo}: comillas mal cerradas: ${v}`, { code: 'invalid_card' }); }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Texto de la ficha → { data, body }. Los errores dicen en qué línea está el problema. */
export function parseCard(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') throw new RoleError('la ficha debe empezar con una línea "---"', { code: 'invalid_card' });
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) throw new RoleError('falta la línea "---" que cierra el frontmatter', { code: 'invalid_card' });
  const data = {};
  let listKey = null;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      if (!listKey) throw new RoleError(`línea ${lineNo}: item de lista sin clave`, { code: 'invalid_card' });
      data[listKey].push(parseScalar(item[1], lineNo));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!kv) throw new RoleError(`línea ${lineNo}: se esperaba "clave: valor" (${line.trim()})`, { code: 'invalid_card' });
    const [, key, rawValue = ''] = kv;
    const value = rawValue.trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      throw new RoleError(`línea ${lineNo}: ${key} debe ir en una sola línea`, { code: 'invalid_card' });
    }
    listKey = null;
    if (key === 'contexto' && value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map(s => parseScalar(s, lineNo)) : [];
    } else {
      data[key] = parseScalar(value, lineNo);
    }
  }
  return { data, body: lines.slice(end + 1).join('\n').trim() };
}

/** Ficha → texto. Los textos van entre comillas JSON: dos puntos o comillas no la rompen. */
export function serializeCard({ id, actua_como, objetivo, modelo = '', contexto = [], herramientas_restringidas = false, body = DEFAULT_BODY }) {
  return [
    '---',
    `id: ${id}`,
    `actua_como: ${JSON.stringify(actua_como)}`,
    `objetivo: ${JSON.stringify(objetivo)}`,
    `modelo: ${modelo}`.trimEnd(),
    ...(contexto.length ? ['contexto:', ...contexto.map(c => `  - ${JSON.stringify(c)}`)] : ['contexto: []']),
    `herramientas_restringidas: ${herramientas_restringidas}`,
    '---',
    '',
    body.trim(),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

let _validator = null;
function schemaValidator() {
  if (!_validator) _validator = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
  return _validator;
}

// El agente va a leer estos archivos: nunca fuera del proyecto, ni secretos, ni .git.
export function isSafeContextPath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  if (isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  return p.split(/[\\/]+/).every(seg => seg && seg !== '..' && seg !== '.' && !/^\.env/i.test(seg) && seg.toLowerCase() !== '.git');
}

export function validateRole(card) {
  const { body, ...data } = card || {};
  const v = schemaValidator();
  const errors = v(data) ? [] : v.errors.map(e => `${e.instancePath || '(raíz)'} ${e.message}`);
  for (const p of Array.isArray(data.contexto) ? data.contexto : []) {
    if (!isSafeContextPath(p)) errors.push(`/contexto ruta no permitida: ${p} (relativa al proyecto, sin "..", sin .env ni .git)`);
  }
  if (typeof body !== 'string' || !body.trim()) errors.push('el cuerpo de la ficha no puede estar vacío');
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Carga y creación
// ---------------------------------------------------------------------------

export const rolesDir = (root = REPO_ROOT) => join(root, 'roles');

/** { roles: Map<id, ficha>, invalid: [{ file, errors }] }. Una ficha mala no tapa a las demás. */
export function loadRoles({ root = REPO_ROOT } = {}) {
  const dir = rolesDir(root);
  const roles = new Map();
  const invalid = [];
  if (!existsSync(dir)) return { roles, invalid };
  for (const file of readdirSync(dir).filter(f => f.endsWith('.md') && !NOT_CARDS.has(f)).sort()) {
    try {
      const { data, body } = parseCard(readFileSync(join(dir, file), 'utf8'));
      const card = { ...data, body };
      const v = validateRole(card);
      if (!v.ok) invalid.push({ file, errors: v.errors });
      else if (`${card.id}.md` !== file) invalid.push({ file, errors: [`el id "${card.id}" no coincide con el nombre del archivo`] });
      else roles.set(card.id, card);
    } catch (e) {
      invalid.push({ file, errors: [e.message] });
    }
  }
  return { roles, invalid };
}

export function getRole(id, { root = REPO_ROOT } = {}) {
  const { roles, invalid } = loadRoles({ root });
  if (roles.has(id)) return roles.get(id);
  const bad = invalid.find(x => x.file === `${id}.md`);
  if (bad) throw new RoleError(`La ficha ${bad.file} es inválida: ${bad.errors.join('; ')}`, { code: 'invalid_card' });
  const known = [...roles.keys()].join(', ') || 'ninguna todavía';
  throw new RoleError(`No existe la ficha "${id}". Fichas disponibles: ${known}.`, { code: 'not_found' });
}

/** "cafe-fullstack-dev" → "Cafe fullstack dev". Etiqueta cuando el plan no trae una. */
export function humanizeId(id) {
  const text = String(id).replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Crea roles/<id>.md y lo registra en memory/active-team.json. Nunca sobrescribe. */
export function createRole(input, { root = REPO_ROOT } = {}) {
  const card = {
    id: input.id,
    actua_como: input.actua_como,
    objetivo: input.objetivo,
    modelo: input.modelo ?? '',
    contexto: (input.contexto || []).map(p => String(p).replace(/\\/g, '/')),
    herramientas_restringidas: Boolean(input.herramientas_restringidas),
    body: input.body?.trim() ? input.body : DEFAULT_BODY,
  };
  const v = validateRole(card);
  if (!v.ok) throw new RoleError(`Ficha inválida:\n- ${v.errors.join('\n- ')}`, { code: 'invalid_card' });
  mkdirSync(rolesDir(root), { recursive: true });
  const path = join(rolesDir(root), `${card.id}.md`);
  try {
    writeFileSync(path, serializeCard(card), { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') throw new RoleError(`Ya existe ${path}; no la sobrescribo.`, { code: 'role_exists' });
    throw e;
  }
  // La ficha ya sirve aunque falle el registro: se avisa, no se pierde.
  let teamWarning = null;
  try {
    addAgent({
      name: card.id,
      role: card.actua_como.slice(0, 200),
      model: card.modelo || 'hereda',
      notas: `Ficha: roles/${card.id}.md${card.herramientas_restringidas ? ' (requiere agente fijo)' : ''}`,
    }, join(root, 'memory'));
  } catch (e) {
    teamWarning = e.message;
  }
  return { path, card, teamWarning };
}

// ---------------------------------------------------------------------------
// Prompt compuesto
// ---------------------------------------------------------------------------

export function composePrompt(card, task, { root = REPO_ROOT } = {}) {
  if (typeof task !== 'string' || !task.trim()) throw new RoleError('Falta la tarea.', { code: 'invalid_task' });
  const missing = card.contexto.filter(p => !existsSync(join(root, p)));
  const contextLines = card.contexto.length
    ? card.contexto.map(p => `- ${p}${missing.includes(p) ? ' (not found when this prompt was composed; report it if you need it)' : ''}`)
    : ['(none)'];
  return [
    '# Role',
    `You are acting as: ${card.actua_como}`,
    '',
    '# Objective',
    card.objetivo,
    '',
    '# Instructions',
    card.body.trim(),
    '',
    '# Context files',
    `Project root: ${root}`,
    'Read these files before you start (paths are relative to the project root):',
    ...contextLines,
    '',
    '# Task',
    task.trim(),
    '',
    '# Output language',
    LANGUAGE_RULE,
    '',
  ].join('\n');
}

/**
 * Lo que el orquestador pasa a su herramienta Agent. Con herramientas restringidas el
 * agente correcto es el fijo; el general tendría todas las herramientas.
 */
export function buildInvocation(card, task, { root = REPO_ROOT } = {}) {
  return {
    subagent_type: card.herramientas_restringidas ? card.id : GENERIC_AGENT,
    ...(card.modelo ? { model: card.modelo } : {}),
    prompt: composePrompt(card, task, { root }),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(['json', 'herramientas-restringidas']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

const USAGE = [
  'Uso:',
  '  node src/roles.js list                         lista las fichas de roles/',
  '  node src/roles.js crear --id <id> --actua-como "..." --objetivo "..." [opciones]',
  '      --modelo haiku|sonnet|opus                 vacío: hereda el del orquestador',
  '      --contexto a.md,b.md                       archivos que lee antes de empezar',
  '      --instrucciones "..."                      cuerpo de la ficha, en inglés',
  '      --herramientas-restringidas                además necesita agente fijo y reiniciar',
  '  node src/roles.js prompt <id> "tarea" [--json] imprime el prompt compuesto',
  'Todos aceptan --root <carpeta>.',
].join('\n');

const text = v => (typeof v === 'string' ? v : '');

function cmdList(root) {
  const { roles, invalid } = loadRoles({ root });
  if (!roles.size && !invalid.length) {
    console.log('Sin fichas todavía. Crea una con: node src/roles.js crear --id <id> --actua-como "..." --objetivo "..."');
    return 0;
  }
  for (const r of roles.values()) {
    const tags = [r.modelo || 'hereda modelo', ...(r.herramientas_restringidas ? ['agente fijo'] : [])].join(', ');
    console.log(`${r.id} [${tags}]: ${r.objetivo}`);
  }
  for (const x of invalid) console.error(`INVÁLIDA ${x.file}: ${x.errors.join('; ')}`);
  return invalid.length ? 1 : 0;
}

function cmdCrear(args, root) {
  const { path, card, teamWarning } = createRole({
    id: text(args.id),
    actua_como: text(args['actua-como']),
    objetivo: text(args.objetivo),
    modelo: text(args.modelo),
    contexto: text(args.contexto).split(',').map(s => s.trim()).filter(Boolean),
    herramientas_restringidas: args['herramientas-restringidas'] === true,
    body: text(args.instrucciones),
  }, { root });
  console.log(`Ficha creada: ${path}`);
  if (teamWarning) console.error(`[roles] La ficha sirve, pero no pude registrarla en memory/active-team.json: ${teamWarning}`);
  if (card.herramientas_restringidas) {
    console.log('Pide herramientas restringidas: crea también el agente fijo con la skill agent-template.');
    console.log('Después hay que reiniciar Claude Code: escribe /exit y luego claude -c (retoma esta conversación).');
  } else {
    console.log(`Lista para usar, sin reiniciar: node src/roles.js prompt ${card.id} "tarea"`);
  }
  return 0;
}

function cmdPrompt(args, root) {
  const [id, ...taskWords] = args._.slice(1);
  if (!id || !taskWords.length) { console.error(USAGE); return 1; }
  const card = getRole(id, { root });
  const invocation = buildInvocation(card, taskWords.join(' '), { root });
  try { touchAgent(card.id, join(root, 'memory')); } catch { /* una ficha sin registrar funciona igual */ }
  if (args.json) {
    console.log(JSON.stringify(invocation, null, 2));
  } else {
    console.log(invocation.prompt);
    console.error(`[roles] Agent: subagent_type=${invocation.subagent_type}${card.modelo ? `, model=${card.modelo}` : ''}`);
  }
  if (card.herramientas_restringidas) {
    console.error(`[roles] Esta ficha restringe herramientas: usa el agente fijo "${card.id}" (carga tras reiniciar). Con ${GENERIC_AGENT} NO quedan restringidas.`);
  }
  return 0;
}

export function runCli(argv) {
  const args = parseArgs(argv);
  const root = typeof args.root === 'string' ? resolve(args.root) : REPO_ROOT;
  try {
    switch (args._[0]) {
      case 'list': return cmdList(root);
      case 'crear': return cmdCrear(args, root);
      case 'prompt': return cmdPrompt(args, root);
      case undefined: console.log(USAGE); return 0;
      default: console.error(USAGE); return 1;
    }
  } catch (e) {
    if (!(e instanceof RoleError)) throw e;
    console.error(`[roles] ${e.message}`);
    return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = runCli(process.argv.slice(2));
