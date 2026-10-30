// kickoff-plan.test.js
// Verifica el plan de batalla del kickoff (.claude/skills/kickoff/plan.js):
//   - el borrador de ejemplo produce una revisión válida del cockpit (kind plan)
//   - ítems: 2 TLDR, uno por integrante, brazos, proceso, councils, riesgos
//   - brazos incluye los asignados por el equipo y los comandos connect de lo que falta
//   - councils sugeridos por decisión; context_brief apto para la guía de voz
//   - SKILL.md del kickoff: corto (≤150 líneas) y con el paso del plan
// Sin red: checks simulados, sin `claude mcp list` real.

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPlanReview, validateDraft, chatTldr, PlanError } from './.claude/skills/kickoff/plan.js';
import { publishReview, listReviews } from './src/cockpit.js';

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

check('ítems: TLDRs, equipo, brazos, proceso, councils, riesgos', () => {
  const ids = result.review.items.map(i => i.id);
  for (const id of ['tldr-usuario', 'tldr-orquestador', 'brazos', 'proceso', 'councils', 'riesgos']) assert(ids.includes(id), `falta ${id}`);
  const team = ids.filter(i => i.startsWith('equipo-'));
  assert(team.length === DRAFT.equipo.length, `equipo: ${team.length}`);
  assert(ids.length === 6 + DRAFT.equipo.length, `total ${ids.length}`);
});

check('cada integrante trae actúa como + por qué + entrega; agente nuevo avisa reinicio', () => {
  for (const it of result.review.items.filter(i => i.id.startsWith('equipo-'))) {
    assert(/Actúa como/.test(it.body_md) && /Por qué/.test(it.body_md) && /Entrega/.test(it.body_md), it.id);
  }
  const nuevo = result.review.items.find(i => i.tags.includes('agente-nuevo'));
  assert(nuevo && /reiniciar Claude Code/.test(nuevo.body_md), 'sin aviso de reinicio');
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
  assert(/npm run cockpit/.test(t[4]) && /7788/.test(t[4]), t[4]);
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
  for (const t of ['plan.js build', 'cockpit.js publish', 'cockpit.js pending', 'brazos.js', 'reiniciar Claude Code', 'npm run cockpit']) assert(md.includes(t), `falta "${t}"`);
});

console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
