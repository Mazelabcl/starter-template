// roles.test.js
// Verifica las fichas de rol (src/roles.js, roles/):
//   - formato: frontmatter a mano, ida y vuelta, errores que dicen qué corregir
//   - validación con schema: modelo, id, contexto seguro (nunca .env, .git ni "..")
//   - CLI real: crear, list, prompt (texto y --json), sin sobrescribir
//   - registro en active-team.json con el contrato de memory/
//   - camino del kickoff con archivos reales en carpeta temporal: plan → aprobación →
//     fichas → prompt → org del plan leyendo las fichas, sin .claude/agents/
// Sin red. Idioma: español neutro.

import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCard, serializeCard, validateRole, loadRoles, getRole, createRole, composePrompt, buildInvocation,
  isSafeContextPath, humanizeId, RoleError, DEFAULT_BODY, LANGUAGE_RULE, GENERIC_AGENT,
} from './src/roles.js';
import { getActiveTeam } from './src/memory.js';
import { buildPlanReview, chatTldr, PlanError, resolveEquipo } from './.claude/skills/kickoff/plan.js';
import { publishReview, reviewWarnings } from './src/cockpit.js';
import { renderDiagram, svgString } from './cockpit/public/diagrams.js';

const REPO = dirname(fileURLToPath(import.meta.url));
const CLI = join(REPO, 'src', 'roles.js');
let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }
function assertThrows(fn, re) {
  try { fn(); } catch (e) { assert(re.test(e.message), `error inesperado: ${e.message}`); return e; }
  throw new Error(`no lanzó error (esperaba ${re})`);
}
const tempRoot = () => mkdtempSync(join(tmpdir(), 'roles-test-'));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const CARD = {
  id: 'seo-local',
  actua_como: 'Local SEO specialist, 10 years with neighborhood shops: obsessed with "map pack" rankings.',
  objetivo: 'Make the landing rank for neighborhood searches.',
  modelo: 'sonnet',
  contexto: ['content/principles.md', '.claude/skills/council/SKILL.md'],
  herramientas_restringidas: false,
  body: '- Do not invent search volumes.',
};

check('formato: una ficha escrita a mano se lee bien', () => {
  const { data, body } = parseCard([
    '---', '# comentario', 'id: seo-local', 'actua_como: Local SEO specialist with years of practice in shops', "objetivo: 'Rank for neighborhood searches'",
    'modelo:', 'contexto:', '  - content/a.md', '  - "content/b.md"', 'herramientas_restringidas: true', '---', '', 'Instrucciones: uno.', '',
  ].join('\r\n'));
  assert(data.id === 'seo-local' && data.objetivo === 'Rank for neighborhood searches' && data.modelo === '', JSON.stringify(data));
  assert(data.contexto.join() === 'content/a.md,content/b.md' && data.herramientas_restringidas === true, JSON.stringify(data));
  assert(body === 'Instrucciones: uno.', body);
  assert(parseCard('---\ncontexto: [a.md, "b.md"]\n---\nx').data.contexto.join() === 'a.md,b.md', 'lista en línea');
});

check('formato: ida y vuelta conserva dos puntos y comillas', () => {
  const { data, body } = parseCard(serializeCard(CARD));
  assert(JSON.stringify({ ...data, body }) === JSON.stringify(CARD), JSON.stringify(data));
  assert(parseCard(serializeCard({ ...CARD, contexto: [], modelo: '' })).data.contexto.length === 0, 'contexto vacío');
});

check('formato: los errores dicen qué corregir', () => {
  assertThrows(() => parseCard('id: x'), /debe empezar/);
  assertThrows(() => parseCard('---\nid: x'), /cierra el frontmatter/);
  assertThrows(() => parseCard('---\nesto no es clave\n---\n'), /línea 2/);
  assertThrows(() => parseCard('---\nactua_como: >\n  largo\n---\n'), /una sola línea/);
  assertThrows(() => parseCard('---\nid: "x\n---\n'), /comillas/);
});

check('schema: acepta modelo vacío o válido; rechaza lo demás con todos los errores', () => {
  assert(validateRole(CARD).ok, validateRole(CARD).errors.join());
  assert(validateRole({ ...CARD, modelo: '' }).ok, 'modelo vacío');
  const v = validateRole({ ...CARD, id: 'Con Espacios', modelo: 'gpt', objetivo: 'x', herramientas_restringidas: 'no', extra: 1, body: ' ' });
  for (const re of [/id/, /modelo/, /objetivo/, /herramientas_restringidas/, /additional/, /cuerpo/]) assert(v.errors.some(e => re.test(e)), `${re}: ${v.errors.join(' | ')}`);
});

check('contexto: nunca fuera del proyecto ni secretos', () => {
  for (const bad of ['../fuera.md', 'a/../../b.md', '.env', 'config/.env.local', '.git/config', 'C:\\Windows\\x.md', '/etc/passwd', '']) assert(!isSafeContextPath(bad), bad);
  for (const ok of ['content/a.md', '.claude/skills/x/SKILL.md', 'roles/README.md']) assert(isSafeContextPath(ok), ok);
  assert(!validateRole({ ...CARD, contexto: ['.env'] }).ok, '.env pasó');
});

check('prompt: compone rol, objetivo, instrucciones, contexto, tarea y regla de idioma', () => {
  const root = tempRoot();
  mkdirSync(join(root, 'content'));
  writeFileSync(join(root, 'content', 'principles.md'), 'x');
  const p = composePrompt(CARD, 'Revisa los títulos', { root });
  const order = ['# Role', CARD.actua_como, '# Objective', CARD.objetivo, '# Instructions', CARD.body, '# Context files', root, '- content/principles.md', '# Task', 'Revisa los títulos', '# Output language', LANGUAGE_RULE];
  let last = -1;
  for (const part of order) { const i = p.indexOf(part); assert(i > last, `orden o falta: ${part}`); last = i; }
  assert(!p.includes('principles.md (not found'), 'marcó como faltante uno que existe');
  assert(p.includes('SKILL.md (not found'), 'no marcó el faltante');
  assert(/neutral Spanish/.test(LANGUAGE_RULE) && /voseo/.test(LANGUAGE_RULE), 'regla de idioma');
  assertThrows(() => composePrompt(CARD, '  ', { root }), /Falta la tarea/);
  rmSync(root, { recursive: true, force: true });
});

check('invocación: agente general con el modelo; con restricción, el agente fijo', () => {
  const a = buildInvocation(CARD, 'x', { root: REPO });
  assert(a.subagent_type === GENERIC_AGENT && a.model === 'sonnet' && a.prompt.includes('# Task'), JSON.stringify(a).slice(0, 200));
  assert(!('model' in buildInvocation({ ...CARD, modelo: '' }, 'x', { root: REPO })), 'model vacío debe omitirse');
  assert(buildInvocation({ ...CARD, herramientas_restringidas: true }, 'x', { root: REPO }).subagent_type === 'seo-local', 'agente fijo');
});

check('CLI: crear, list y prompt de punta a punta en carpeta temporal', () => {
  const root = tempRoot();
  const empty = cli('list', '--root', root);
  assert(empty.status === 0 && /Sin fichas/.test(empty.stdout), empty.stdout + empty.stderr);

  const made = cli('crear', '--root', root, '--id', 'revisor', '--actua-como', 'Senior code reviewer, 15 years, obsessed with small diffs.', '--objetivo', 'Catch real bugs before merge.', '--modelo', 'haiku', '--contexto', 'content/a.md, content/b.md');
  assert(made.status === 0, made.stderr);
  assert(/sin reiniciar/.test(made.stdout) && !/claude -c/.test(made.stdout), made.stdout);
  const card = getRole('revisor', { root });
  assert(card.modelo === 'haiku' && card.contexto.join() === 'content/a.md,content/b.md' && card.body === DEFAULT_BODY, JSON.stringify(card));

  const listed = cli('list', '--root', root);
  assert(listed.status === 0 && /revisor \[haiku\]: Catch real bugs/.test(listed.stdout), listed.stdout);

  const prompt = cli('prompt', 'revisor', 'Revisa', 'este', 'cambio', '--root', root);
  assert(prompt.status === 0 && prompt.stdout.includes('Revisa este cambio') && prompt.stdout.includes('Senior code reviewer'), prompt.stderr);
  assert(/subagent_type=general-purpose, model=haiku/.test(prompt.stderr), prompt.stderr);

  const json = JSON.parse(cli('prompt', 'revisor', 'Revisa', '--root', root, '--json').stdout);
  assert(json.subagent_type === 'general-purpose' && json.model === 'haiku' && json.prompt.includes('# Task'), JSON.stringify(json).slice(0, 200));

  const again = cli('crear', '--root', root, '--id', 'revisor', '--actua-como', 'Otra persona distinta para el mismo id de ficha', '--objetivo', 'No debe sobrescribir nunca.');
  assert(again.status === 1 && /no la sobrescribo/.test(again.stderr), again.stderr);
  assert(getRole('revisor', { root }).modelo === 'haiku', 'sobrescribió');

  const bad = cli('crear', '--root', root, '--id', 'mala', '--actua-como', 'corta', '--objetivo', 'x', '--modelo', 'gpt', '--contexto', '.env');
  assert(bad.status === 1 && /modelo/.test(bad.stderr) && /\.env/.test(bad.stderr), bad.stderr);
  assert(!existsSync(join(root, 'roles', 'mala.md')), 'creó una ficha inválida');

  const missing = cli('prompt', 'nadie', 'tarea', '--root', root);
  assert(missing.status === 1 && /No existe la ficha "nadie".*revisor/.test(missing.stderr), missing.stderr);
  rmSync(root, { recursive: true, force: true });
});

check('CLI: con herramientas restringidas avisa reinicio con /exit y claude -c, y prompt lo advierte', () => {
  const root = tempRoot();
  const made = cli('crear', '--root', root, '--id', 'auditor', '--actua-como', 'Read-only security auditor, 12 years in fintech.', '--objetivo', 'Find risks without touching any file.', '--herramientas-restringidas');
  assert(made.status === 0 && /agent-template/.test(made.stdout) && /\/exit y luego claude -c/.test(made.stdout), made.stdout);
  assert(getRole('auditor', { root }).herramientas_restringidas === true, 'flag');
  const p = cli('prompt', 'auditor', 'Audita', '--root', root);
  assert(/subagent_type=auditor/.test(p.stderr) && /NO quedan restringidas/.test(p.stderr), p.stderr);
  assert(/auditor \[hereda modelo, agente fijo\]/.test(cli('list', '--root', root).stdout), 'list');
  rmSync(root, { recursive: true, force: true });
});

check('list: una ficha rota se reporta y no tapa a las demás; README y schema no son fichas', () => {
  const root = tempRoot();
  createRole(CARD, { root });
  mkdirSync(join(root, 'roles'), { recursive: true });
  writeFileSync(join(root, 'roles', 'README.md'), '# no es ficha');
  writeFileSync(join(root, 'roles', 'rota.md'), 'sin frontmatter');
  writeFileSync(join(root, 'roles', 'otro-nombre.md'), serializeCard({ ...CARD, id: 'distinto' }));
  const { roles, invalid } = loadRoles({ root });
  assert([...roles.keys()].join() === 'seo-local', [...roles.keys()].join());
  assert(invalid.map(x => x.file).join() === 'otro-nombre.md,rota.md', JSON.stringify(invalid));
  const r = cli('list', '--root', root);
  assert(r.status === 1 && /seo-local/.test(r.stdout) && /INVÁLIDA rota\.md/.test(r.stderr), r.stderr);
  assertThrows(() => getRole('rota', { root }), /inválida/);
  rmSync(root, { recursive: true, force: true });
});

check('active-team: crear registra la ficha y prompt suma una invocación', () => {
  const root = tempRoot();
  const { teamWarning } = createRole({ ...CARD, modelo: '' }, { root });
  assert(!teamWarning, teamWarning);
  const memDir = join(root, 'memory');
  const agent = getActiveTeam(memDir).agents[0];
  assert(agent.name === 'seo-local' && agent.modelo_asignado === 'hereda' && agent.total_invocaciones === 0 && /roles\/seo-local\.md/.test(agent.notas), JSON.stringify(agent));
  assert(cli('prompt', 'seo-local', 'x', '--root', root).status === 0, 'prompt');
  assert(getActiveTeam(memDir).agents[0].total_invocaciones === 1, 'no contó la invocación');
  const long = createRole({ ...CARD, id: 'largo', actua_como: 'x'.repeat(400) }, { root });
  assert(!long.teamWarning, `rol_corto debe caber en el schema: ${long.teamWarning}`);
  rmSync(root, { recursive: true, force: true });
});

// ---------- Camino del kickoff con archivos reales ----------
const DRAFT = JSON.parse(readFileSync(join(REPO, '.claude', 'skills', 'kickoff', 'ejemplo-plan-borrador.json'), 'utf8'));
const ctx = { env: () => false, mcpList: () => '', which: () => false, exists: () => false, plugin: () => false };

check('kickoff: plan aprobado → fichas → prompt, sin .claude/agents/ ni reinicio', () => {
  const root = tempRoot();
  // 1. El plan se publica antes de que exista ninguna ficha: nada se persiste aún.
  const before = buildPlanReview(DRAFT, { ctx, root });
  assert(!existsSync(join(root, 'roles')), 'persistió antes de aprobar');
  publishReview(before.review, root, { estricto: true });
  const org = before.review.items.find(i => i.id === 'equipo').visual;
  assert(org.kind === 'org' && org.members.length === DRAFT.equipo.length, 'org antes de aprobar');

  // 2. Aprobado: cada integrante se vuelve ficha (paso 9), con persona en inglés.
  for (const m of DRAFT.equipo) {
    const made = cli('crear', '--root', root, '--id', m.id, '--actua-como', `Specialist for ${m.id}, ten years of practice in this exact field.`, '--objetivo', `Deliver ${m.id} results for this project.`, '--modelo', 'sonnet');
    assert(made.status === 0, made.stderr);
    assert(!/claude -c/.test(made.stdout), `${m.id} pidió reiniciar`);
  }
  assert(!existsSync(join(root, '.claude', 'agents')), 'creó archivos de agente');
  assert(readdirSync(join(root, 'roles')).length === DRAFT.equipo.length, 'fichas');
  assert(getActiveTeam(join(root, 'memory')).agents.length === DRAFT.equipo.length, 'active-team');

  // 3. Un integrante se usa al instante: prompt listo para la herramienta Agent.
  const first = DRAFT.equipo[0].id;
  const inv = JSON.parse(cli('prompt', first, 'Arma la landing', '--root', root, '--json').stdout);
  assert(inv.subagent_type === 'general-purpose' && inv.model === 'sonnet' && inv.prompt.includes('Arma la landing'), 'invocación');

  // 4. Un plan posterior lee el equipo desde las fichas, sin repetirlo en el borrador.
  const { equipo, ...sinEquipo } = DRAFT;
  const later = buildPlanReview(sinEquipo, { ctx, root });
  const team = later.review.items.find(i => i.id === 'equipo');
  assert(team.visual.members.length === DRAFT.equipo.length && !team.visual.members.some(m => m.badge), JSON.stringify(team.visual.members));
  assert(team.body_md.includes(`roles/${first}.md`), 'origen de la ficha');
  for (const layout of ['wide', 'tall']) assert(svgString(renderDiagram(team.visual, { layout })).startsWith('<svg'), layout);
  assert(reviewWarnings(later.review).length === 0, reviewWarnings(later.review).join());
  assert(chatTldr(sinEquipo, later).includes(humanizeId(first)), chatTldr(sinEquipo, later));
  rmSync(root, { recursive: true, force: true });
});

check('kickoff: un integrante puede apuntar a una ficha y cambiar solo lo que quiera', () => {
  const root = tempRoot();
  createRole(CARD, { root });
  const [m] = resolveEquipo([{ ficha: 'seo-local', corto: 'SEO', por_que: 'Porque el barrio busca en mapas.' }], { root });
  assert(m.actua_como === CARD.actua_como && m.entrega[0] === CARD.objetivo && m.por_que.startsWith('Porque') && m.rol === 'Seo local' && m.corto === 'SEO', JSON.stringify(m));
  const [same] = resolveEquipo([{ id: 'seo-local', nuevo: true, rol: 'SEO', actua_como: 'a', por_que: 'b', entrega: ['c'] }], { root });
  assert(same.nuevo === false, 'si la ficha ya existe no es nueva');
  const e = assertThrows(() => resolveEquipo([{ ficha: 'nadie' }], { root }), /no existe en roles/);
  assert(e instanceof PlanError, 'PlanError');
  assertThrows(() => buildPlanReview({ ...DRAFT, equipo: [] }, { ctx, root: tempRoot() }), /al menos 1 integrante/);
  rmSync(root, { recursive: true, force: true });
});

check('documentación: kickoff y agent-template deciden ficha primero; CLAUDE.md la menciona', () => {
  const kick = readFileSync(join(REPO, '.claude', 'skills', 'kickoff', 'SKILL.md'), 'utf8');
  assert(kick.includes('node src/roles.js crear') && kick.includes('/exit y luego claude -c') && /herramientas_restringidas: true/.test(kick), 'kickoff');
  const tpl = readFileSync(join(REPO, '.claude', 'skills', 'agent-template', 'SKILL.md'), 'utf8');
  assert(tpl.indexOf('Primero decide') < tpl.indexOf('Plantilla obligatoria') && /Por defecto, ficha de rol/.test(tpl), 'agent-template');
  const claude = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
  assert(/"Crea un agente para X" \| ficha en `roles\/`, sin reiniciar/.test(claude), 'CLAUDE.md');
  assert(!/\b(vos|tenés|podés|decime|mirá|che)\b/i.test(readFileSync(join(REPO, 'roles', 'README.md'), 'utf8')), 'voseo');
  assert(new RoleError('x', { code: 'y' }).code === 'y', 'RoleError');
});

console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
