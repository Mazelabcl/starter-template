// kickoff-plan.test.js
// Verifica el plan de batalla del kickoff (.claude/skills/kickoff/plan.js):
//   - el borrador de ejemplo produce una revisión válida del cockpit (kind plan)
//   - en imágenes: TLDR con números, equipo (org), proceso (flow), roadmap (timeline),
//     brazos, councils y riesgos (connects), sin avisos de "no es visual"
//   - brazos incluye los asignados por el equipo y los comandos connect de lo que falta
//   - councils sugeridos por decisión; context_brief apto para la guía de voz
//   - SKILL.md del kickoff: corto (≤150 líneas) y con el paso del plan
// Sin red: checks simulados, sin `claude mcp list` real.

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPlanReview, validateDraft, chatTldr, PlanError } from './.claude/skills/kickoff/plan.js';
import { publishReview, listReviews, reviewWarnings } from './src/cockpit.js';

let passed = 0;
let failed = 0;
const fails = [];
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); passed += 1; }
  catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); fails.push(label); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }

const DRAFT = JSON.parse(readFileSync('.claude/skills/kickoff/ejemplo-plan-borrador.json', 'utf8'));
const ctx = {
  env: k => k === 'OPENROUTER_API_KEY',
  mcpList: () => 'claude.ai Canva: x - ✔ Connected\nhiggsfield: x - ! Needs authentication',
  which: () => false,
  exists: p => p.startsWith('src/') || p.startsWith('scripts/'),
  plugin: n => n === 'claude-seo',
};

let result;

check('el borrador de ejemplo valida', () => validateDraft(DRAFT));

check('buildPlanReview produce una revisión válida kind=plan', () => {
  result = buildPlanReview(DRAFT, { ctx });
  assert(result.review.kind === 'plan', result.review.kind);
  assert(result.review.id === 'plan-de-batalla-v1', result.review.id);
});

check('ítems: una lámina por idea', () => {
  const ids = result.review.items.map(i => i.id);
  assert(ids.join(',') === 'tldr,equipo,proceso,roadmap,brazos,councils,riesgos', ids.join(','));
});

check('el plan es visual primero: org, flow, timeline y titulares cortos', () => {
  const by = id => result.review.items.find(i => i.id === id);
  assert(by('equipo').visual.kind === 'org' && by('equipo').visual.members.length === DRAFT.equipo.length, 'org');
  assert(by('proceso').visual.kind === 'flow' && by('proceso').visual.steps.some(s => s.tone === 'you'), 'flow con los pasos del usuario');
  const tl = by('roadmap').visual;
  assert(tl.kind === 'timeline' && tl.items.some(t => t.state === 'current') && tl.items.some(t => t.state === 'next'), 'timeline');
  assert(by('tldr').stats.length === 3, 'TLDR con 3 números');
  assert(reviewWarnings(result.review).length === 0, reviewWarnings(result.review).join(' | '));
  assert(result.review.sprint === 0, 'el plan va en el arranque');
});

check('sin etiquetas cortas igual queda visual: las arma recortando', () => {
  const plain = JSON.parse(JSON.stringify(DRAFT));
  delete plain.titular; delete plain.tldr_pasos;
  plain.equipo.forEach(m => { delete m.corto; delete m.nota; delete m.icono; });
  plain.riesgos.forEach(r => { delete r.corto; });
  plain.decisiones = plain.decisiones.map(d => d.texto);
  const r = buildPlanReview(plain, { ctx }).review;
  assert(reviewWarnings(r).length === 0, reviewWarnings(r).join(' | '));
  const risk = r.items.find(i => i.id === 'riesgos').visual.links[0].label;
  assert(risk.split(/\s+/).length <= 5, risk);
});

check('cada integrante trae actúa como + por qué + entrega detrás de Ver más; agente nuevo avisa reinicio', () => {
  const team = result.review.items.find(i => i.id === 'equipo');
  for (const m of DRAFT.equipo) assert(team.body_md.includes(m.actua_como) && team.body_md.includes(m.por_que), m.rol);
  assert(/Entrega/.test(team.body_md), 'sin entrega');
  assert(team.tags.includes('agente-nuevo') && /reiniciar Claude Code/.test(team.body_md), 'sin aviso de reinicio');
  assert(team.visual.members.some(m => m.badge === 'Nuevo'), 'sin marca de agente nuevo');
});

check('brazos: incluye los del equipo, estados y comandos connect de lo que falta', () => {
  const b = result.review.items.find(i => i.id === 'brazos').body_md;
  for (const id of ['supabase-mcp', 'mercadopago', 'hyperframes', 'vercel-mcp']) assert(b.includes(`\`${id}\``), `falta ${id}`);
  assert(/node src\/brazos\.js connect supabase-mcp/.test(b), 'sin connect');
  assert(/conectado/.test(b) && /falta auth/.test(b), 'sin estados');
});

check('councils: una plantilla por decisión con costo', () => {
  assert(result.councils.length >= 3, `solo ${result.councils.length}`);
  const ids = result.councils.map(c => c.template);
  assert(ids.includes('arquitectura-critica') && ids.includes('contenido-creativo'), ids.join(','));
  assert(/USD/.test(result.review.items.find(i => i.id === 'councils').body_md), 'sin costo');
});

check('context_brief guía el recorrido por voz y menciona lo que falta', () => {
  const cb = result.review.context_brief;
  assert(/novato/.test(cb) && /TLDR/.test(cb) && /Faltan por conectar/.test(cb), cb);
});

check('chatTldr: 5 líneas y comando del cockpit', () => {
  const t = chatTldr(DRAFT, result).split('\n');
  assert(t.length === 5, `${t.length} líneas`);
  assert(/Te abrí el cockpit en el navegador/.test(t[4]) && !/npm run cockpit/.test(t[4]), t[4]);
});

check('borrador incompleto falla con todos los errores juntos', () => {
  try { validateDraft({ proyecto: 'x' }); } catch (e) {
    assert(e instanceof PlanError && /descripcion/.test(e.message) && /equipo/.test(e.message), e.message);
    return;
  }
  throw new Error('no lanzó');
});

check('brazo inexistente en el equipo se reporta', () => {
  const bad = { ...DRAFT, equipo: [{ ...DRAFT.equipo[0], brazos: ['no-existe'] }] };
  try { buildPlanReview(bad, { ctx }); } catch (e) { assert(/no-existe/.test(e.message), e.message); return; }
  throw new Error('no lanzó');
});

check('se publica en el cockpit y aparece en la lista', () => {
  const root = mkdtempSync(join(tmpdir(), 'plan-'));
  try {
    publishReview(result.review, root);
    const list = listReviews(root);
    assert(list.length === 1 && list[0].kind === 'plan', JSON.stringify(list));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

check('SKILL.md del kickoff ≤150 líneas y describe el plan de batalla', () => {
  const md = readFileSync('.claude/skills/kickoff/SKILL.md', 'utf8');
  const lines = md.split('\n').length;
  assert(lines <= 150, `${lines} líneas`);
  for (const t of ['plan.js build', 'cockpit.js publish', 'cockpit.js pending', 'brazos.js', 'reiniciar Claude Code', 'cockpit.js open']) assert(md.includes(t), `falta "${t}"`);
});

console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
