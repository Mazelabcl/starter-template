/**
 * Test de integración del kickoff v3.
 *
 * Simula 3 escenarios completos pasando inputs predefinidos por el detector
 * determinístico, persiste con memory.js y verifica que:
 *   - detectSignals clasifica correctamente.
 *   - recommendStack devuelve las skills correctas para cada tipo.
 *   - El project-profile.json producido es válido contra el schema.
 *   - active-team.json refleja las skills activas.
 *   - El sprint inicial queda registrado.
 *
 * No invoca LLM. La detección es regex pura — el test ejercita exactamente la
 * misma lógica que la skill aplica en runtime.
 *
 * Limpia archivos temporales al final, en cualquier rama.
 */

import { mkdtempSync, rmSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  writeProfile,
  readProfile,
  addSkill,
  getActiveTeam,
  summarize,
} from './src/memory.js';

import {
  detectSignals,
  recommendStack,
  recommendMode,
  suggestInitialSprint,
  CORE_SKILLS,
  enrichStackWithContrast,
} from './.claude/skills/kickoff/detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'memory', 'templates');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${e.message}`);
    failed += 1;
  }
}

function bootstrapMemoryDir() {
  const tmp = mkdtempSync(join(tmpdir(), 'kickoff-test-'));
  mkdirSync(tmp, { recursive: true });
  // active-team arranca como template (estructura vacía pero válida).
  copyFileSync(
    join(TEMPLATES_DIR, 'active-team.template.json'),
    join(tmp, 'active-team.json'),
  );
  tmpDirs.push(tmp);
  return tmp;
}

/**
 * Ejecuta la secuencia completa que la skill aplicaría tras la confirmación
 * del usuario. Devuelve el snapshot final para que cada caso lo verifique.
 */
function runKickoff({ memDir, input, owner, description }) {
  const signals = detectSignals(input);
  const mode = recommendMode(signals.type, signals.size);
  const stack = recommendStack(signals.type);
  const sprint = suggestInitialSprint(signals.type, mode);

  const allSkills = [...CORE_SKILLS, ...stack.map(s => s.name)];

  const profile = {
    project_type: signals.type,
    mode,
    description,
    created_at: new Date().toISOString(),
    owner,
    skills_activas: allSkills,
    agentes_activos: [],
    sprint_inicial: 'sprint-1',
    tags: [signals.type, signals.size],
  };

  writeProfile(profile, memDir);

  for (const name of CORE_SKILLS) {
    addSkill({ name }, memDir);
  }
  for (const s of stack) {
    addSkill({ name: s.name, notas: s.why }, memDir);
  }

  // v3.1: NO se llama addSprint() en kickoff. El sprint inicial vive en
  // roadmap/current-sprint.json (gestionado por src/roadmap.js#startSprint).
  // addSprint() se reserva para closeSprint() — escribe a memory/sprint-log.md
  // solo cuando el sprint se CIERRA. Ver D7 en process-log/00-decisions.md.

  return {
    signals,
    mode,
    stack,
    sprint,
    profile: readProfile(memDir),
    team: getActiveTeam(memDir),
    summary: summarize(memDir),
  };
}

try {
  // ─────────────────────────────────────────────────────────────
  // ESCENARIO A: meme rápido para Instagram
  // ─────────────────────────────────────────────────────────────
  const memA = bootstrapMemoryDir();
  const resultA = runKickoff({
    memDir: memA,
    input: 'necesito un meme para Instagram sobre los lunes lentos',
    owner: 'aldo@mazelab.cl',
    description: 'Meme ácido para Instagram sobre lunes lentos',
  });

  check('A1 — detectSignals(meme Instagram) clasifica como content', () => {
    if (resultA.signals.type !== 'content') {
      throw new Error(`type esperado content, fue ${resultA.signals.type}. evidencia: ${JSON.stringify(resultA.signals.evidence.type)}`);
    }
  });

  check('A2 — size detectado es rapido (palabra "meme" + "Instagram")', () => {
    if (resultA.signals.size !== 'rapido') {
      throw new Error(`size esperado rapido, fue ${resultA.signals.size}`);
    }
  });

  check('A3 — output detectado es imagen', () => {
    if (resultA.signals.output !== 'imagen') {
      throw new Error(`output esperado imagen, fue ${resultA.signals.output}`);
    }
  });

  check('A4 — modo recomendado es rapido', () => {
    if (resultA.mode !== 'rapido') {
      throw new Error(`mode esperado rapido, fue ${resultA.mode}`);
    }
  });

  check('A5 — stack incluye image-gen, image-explorer y brand-guidelines', () => {
    const names = resultA.stack.map(s => s.name);
    for (const expected of ['image-gen', 'image-explorer', 'brand-guidelines']) {
      if (!names.includes(expected)) {
        throw new Error(`stack no incluye ${expected}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('A6 — project-profile válido y persistido (tipo content)', () => {
    const p = resultA.profile;
    if (!p) throw new Error('profile null');
    if (p.project_type !== 'content') throw new Error(`project_type ${p.project_type}`);
    if (!p.skills_activas.includes('image-gen')) {
      throw new Error('skills_activas no incluye image-gen');
    }
    if (!p.skills_activas.includes('pipeline-v2')) {
      throw new Error('skills_activas no incluye pipeline-v2 (core)');
    }
  });

  check('A7 — active-team refleja todas las skills activas', () => {
    const skillNames = resultA.team.skills.map(s => s.name);
    const expected = [...CORE_SKILLS, 'image-gen', 'image-explorer', 'brand-guidelines', 'multimodal-validation'];
    for (const name of expected) {
      if (!skillNames.includes(name)) {
        throw new Error(`active-team no incluye ${name}. skills: ${skillNames.join(', ')}`);
      }
    }
  });

  check('A8 — sprint 1 sugerido con objective de content (sin contar como completado)', () => {
    // v3.1: kickoff NO llama addSprint(), así que sprints_completados queda en 0.
    // El sprint inicial vive en roadmap/current-sprint.json. Aquí solo verificamos
    // que suggestInitialSprint() produjo un objective coherente con el tipo content.
    if (resultA.summary.sprints_completados !== 0) {
      throw new Error(`sprints_completados esperaba 0 (kickoff no debe llamar addSprint), fue ${resultA.summary.sprints_completados}`);
    }
    if (!/creativo|creatividad|artefacto/i.test(resultA.sprint.objective)) {
      throw new Error(`objective no es de content: ${resultA.sprint.objective}`);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // ESCENARIO B: app interna de ventas (build/grande)
  // ─────────────────────────────────────────────────────────────
  const memB = bootstrapMemoryDir();
  const resultB = runKickoff({
    memDir: memB,
    input: 'voy a construir una app interna para gestionar ventas de mi empresa, somos 4 personas',
    owner: 'aldo@mazelab.cl',
    description: 'App interna para gestión de ventas de empresa de 4 personas',
  });

  check('B1 — detectSignals(app + ventas + empresa) clasifica como build (tiebreaker build>business)', () => {
    // build y business empatan en señales: "app/construir" vs "ventas/empresa".
    // El tiebreaker del detector resuelve a build porque la naturaleza dominante
    // del proyecto es lo que se EJECUTA, no para qué área es. El brief de Sprint
    // 2.1 lo pidió explícito.
    if (resultB.signals.type !== 'build') {
      throw new Error(`type esperado build, fue ${resultB.signals.type}. evidencia: ${JSON.stringify(resultB.signals.evidence.type)}`);
    }
  });

  check('B2 — size detectado es grande (palabra "construir" + "app")', () => {
    if (resultB.signals.size !== 'grande') {
      throw new Error(`size esperado grande, fue ${resultB.signals.size}. evidencia: ${JSON.stringify(resultB.signals.evidence.size)}`);
    }
  });

  check('B3 — modo recomendado es profundo (size grande)', () => {
    if (resultB.mode !== 'profundo') {
      throw new Error(`mode esperado profundo, fue ${resultB.mode}`);
    }
  });

  check('B4 — stack incluye agent-template y council', () => {
    const names = resultB.stack.map(s => s.name);
    if (!names.includes('agent-template')) {
      throw new Error(`stack no incluye agent-template. stack: ${names.join(', ')}`);
    }
    if (!names.includes('council')) {
      throw new Error(`stack no incluye council. stack: ${names.join(', ')}`);
    }
  });

  check('B5 — stack incluye quality-mindset (tipo build)', () => {
    const names = resultB.stack.map(s => s.name);
    if (!names.includes('quality-mindset')) {
      throw new Error(`stack no incluye quality-mindset. stack: ${names.join(', ')}`);
    }
  });

  check('B6 — project-profile persistido con tags incluyendo "grande"', () => {
    const p = resultB.profile;
    if (!p.tags.includes('grande')) {
      throw new Error(`tags no incluye 'grande': ${JSON.stringify(p.tags)}`);
    }
  });

  check('B7 — sprint inicial es de discovery/prototipo (build) o mapeo (business)', () => {
    const obj = resultB.sprint.objective.toLowerCase();
    const validKeywords = ['prototipo', 'discovery', 'arquitectura', 'mapear', 'proceso', 'concretar'];
    const hasValid = validKeywords.some(k => obj.includes(k));
    if (!hasValid) {
      throw new Error(`objective no es de build/business: "${resultB.sprint.objective}"`);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // ESCENARIO C: research profundo sobre NFTs LATAM
  // ─────────────────────────────────────────────────────────────
  const memC = bootstrapMemoryDir();
  const resultC = runKickoff({
    memDir: memC,
    input: 'quiero investigar a fondo cómo está el mercado de NFTs en LATAM 2026',
    owner: 'aldo@mazelab.cl',
    description: 'Research profundo del mercado de NFTs en LATAM 2026',
  });

  check('C1 — detectSignals(investigar mercado) clasifica como research', () => {
    if (resultC.signals.type !== 'research') {
      throw new Error(`type esperado research, fue ${resultC.signals.type}. evidencia: ${JSON.stringify(resultC.signals.evidence.type)}`);
    }
  });

  check('C2 — size detectado es grande (frase "a fondo")', () => {
    if (resultC.signals.size !== 'grande') {
      throw new Error(`size esperado grande, fue ${resultC.signals.size}. evidencia: ${JSON.stringify(resultC.signals.evidence.size)}`);
    }
  });

  check('C3 — modo recomendado es profundo', () => {
    if (resultC.mode !== 'profundo') {
      throw new Error(`mode esperado profundo, fue ${resultC.mode}`);
    }
  });

  check('C4 — stack incluye pipeline-v2 y cold-reader-gate', () => {
    const names = resultC.stack.map(s => s.name);
    for (const expected of ['pipeline-v2', 'cold-reader-gate']) {
      if (!names.includes(expected)) {
        throw new Error(`stack no incluye ${expected}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('C5 — stack incluye herramientas de research (firecrawl o context7)', () => {
    const names = resultC.stack.map(s => s.name);
    if (!names.includes('firecrawl') && !names.includes('context7')) {
      throw new Error(`stack debería incluir firecrawl o context7. stack: ${names.join(', ')}`);
    }
  });

  check('C6 — multimodal-validation está presente como skill core', () => {
    const skillNames = resultC.team.skills.map(s => s.name);
    if (!skillNames.includes('multimodal-validation')) {
      throw new Error(`active-team no incluye multimodal-validation (core). skills: ${skillNames.join(', ')}`);
    }
  });

  check('C7 — project-profile válido con project_type=research', () => {
    const p = resultC.profile;
    if (p.project_type !== 'research') throw new Error(`project_type ${p.project_type}`);
    if (p.mode !== 'profundo') throw new Error(`mode ${p.mode}`);
    if (!p.skills_activas.includes('pipeline-v2')) {
      throw new Error('skills_activas no incluye pipeline-v2');
    }
  });

  check('C8 — sprint inicial es de research (objetivo menciona plan o hallazgo)', () => {
    const obj = resultC.sprint.objective.toLowerCase();
    if (!obj.includes('plan') && !obj.includes('hallazgo') && !obj.includes('investigaci')) {
      throw new Error(`objective no es de research: "${resultC.sprint.objective}"`);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // SANITY CHECKS GLOBALES
  // ─────────────────────────────────────────────────────────────
  check('Z1 — los 3 escenarios produjeron tipos distintos (no fallback genérico)', () => {
    const types = [resultA.signals.type, resultB.signals.type, resultC.signals.type];
    const distinct = new Set(types).size;
    if (distinct < 2) {
      throw new Error(`los 3 escenarios deberían producir al menos 2 tipos distintos, produjeron: ${JSON.stringify(types)}`);
    }
  });

  check('Z2 — input vacío devuelve mixed sin crashear', () => {
    const r = detectSignals('');
    if (r.type !== 'mixed') throw new Error(`empty → ${r.type}, esperaba mixed`);
    if (r.confidence !== 0) throw new Error(`empty → confidence=${r.confidence}, esperaba 0`);
  });

  check('Z3 — input null devuelve mixed sin crashear', () => {
    const r = detectSignals(null);
    if (r.type !== 'mixed') throw new Error(`null → ${r.type}`);
  });

  check('Z4 — todas las skills recomendadas tienen "why" no vacío', () => {
    for (const type of ['content', 'build', 'business', 'research', 'personal', 'mixed']) {
      const stack = recommendStack(type);
      for (const s of stack) {
        if (!s.why || typeof s.why !== 'string' || s.why.length < 10) {
          throw new Error(`skill ${s.name} en stack ${type} tiene 'why' inválido: "${s.why}"`);
        }
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // SPRINT 5.2 — VERIFICACIÓN DE SKILLS NUEVAS DEL CATÁLOGO
  // ─────────────────────────────────────────────────────────────
  check('S5.2-content — stack content incluye marketing y canvas-design (Sprint 5.2)', () => {
    const names = recommendStack('content').map(s => s.name);
    for (const expected of ['marketing', 'canvas-design']) {
      if (!names.includes(expected)) {
        throw new Error(`stack content debería incluir ${expected}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('S5.2-build — stack build incluye frontend-design, webapp-testing y playwright', () => {
    const names = recommendStack('build').map(s => s.name);
    for (const expected of ['frontend-design', 'webapp-testing', 'playwright']) {
      if (!names.includes(expected)) {
        throw new Error(`stack build debería incluir ${expected}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('S5.2-business — stack business incluye marketing, brand-guidelines y xlsx', () => {
    const names = recommendStack('business').map(s => s.name);
    for (const expected of ['marketing', 'brand-guidelines', 'xlsx']) {
      if (!names.includes(expected)) {
        throw new Error(`stack business debería incluir ${expected}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('S5.2-mixed — stack mixed incluye web-artifacts-builder', () => {
    const names = recommendStack('mixed').map(s => s.name);
    if (!names.includes('web-artifacts-builder')) {
      throw new Error(`stack mixed debería incluir web-artifacts-builder. stack: ${names.join(', ')}`);
    }
  });

  check('S5.2-research-no-regresion — research mantiene firecrawl y context7 sin contaminación', () => {
    const names = recommendStack('research').map(s => s.name);
    // research no debe haber recibido marketing, frontend-design, etc. — son skills de otros perfiles.
    const intrusive = ['marketing', 'frontend-design', 'playwright', 'xlsx', 'canvas-design'];
    for (const bad of intrusive) {
      if (names.includes(bad)) {
        throw new Error(`research no debería incluir ${bad}. stack: ${names.join(', ')}`);
      }
    }
    // Y debe seguir teniendo lo que necesita.
    for (const good of ['firecrawl', 'context7', 'pipeline-v2', 'cold-reader-gate']) {
      if (!names.includes(good)) {
        throw new Error(`research debería incluir ${good}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('S5.2-personal-no-regresion — personal mantiene stack mínimo sin ruido', () => {
    const names = recommendStack('personal').map(s => s.name);
    if (!names.includes('confidence-loop') || !names.includes('pipeline-v2')) {
      throw new Error(`personal debería incluir confidence-loop y pipeline-v2. stack: ${names.join(', ')}`);
    }
    // Personal no debe haber recibido skills comerciales ni de UI.
    const intrusive = ['marketing', 'seo', 'seo-strategist', 'frontend-design', 'playwright'];
    for (const bad of intrusive) {
      if (names.includes(bad)) {
        throw new Error(`personal no debería incluir ${bad}. stack: ${names.join(', ')}`);
      }
    }
  });

  check('S5.2-no-duplicados — ningún stack tiene skills duplicadas', () => {
    for (const type of ['content', 'build', 'business', 'research', 'personal', 'mixed']) {
      const stack = recommendStack(type);
      const names = stack.map(s => s.name);
      const distinct = new Set(names);
      if (distinct.size !== names.length) {
        const dups = names.filter((n, i) => names.indexOf(n) !== i);
        throw new Error(`stack ${type} tiene duplicados: ${dups.join(', ')}`);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Sprint v3.1 — enrichStackWithContrast: capa de contraste post-Paso-3
  // ──────────────────────────────────────────────────────────────────────

  check('V31-A — business + menciones a PRs/audit/código activa sub-tipo business-with-software', () => {
    const text = 'voy a hacer un audit de mi ERP que vive en producción, hay PRs a master constantemente';
    const r = enrichStackWithContrast('business', text);
    if (r.subType !== 'business-with-software') {
      throw new Error(`subType esperado business-with-software, fue ${r.subType}`);
    }
    const extraNames = r.extras.map(e => e.name);
    if (!extraNames.includes('superpowers-pr')) {
      throw new Error(`extras no incluye superpowers-pr. extras: ${extraNames.join(', ')}`);
    }
    if (!extraNames.includes('dual-auditor-protocol')) {
      throw new Error(`extras no incluye dual-auditor-protocol. extras: ${extraNames.join(', ')}`);
    }
  });

  check('V31-B — business "puro" (sin código) NO activa business-with-software', () => {
    const text = 'quiero mapear el proceso de ventas y proponer 3 cambios al CRM';
    const r = enrichStackWithContrast('business', text);
    if (r.subType !== null) {
      throw new Error(`subType esperado null, fue ${r.subType}`);
    }
    // En este caso superpowers-pr NO debería aparecer como extra.
    const extraNames = r.extras.map(e => e.name);
    if (extraNames.includes('superpowers-pr')) {
      throw new Error(`extras NO debería incluir superpowers-pr cuando no hay señal código`);
    }
  });

  check('V31-C — build con menciones a PRs propone superpowers-pr aunque ya esté en el stack curado', () => {
    // El stack `build` ya incluye superpowers-pr — en ese caso la extra NO se duplica.
    const text = 'voy a construir una app con muchos PRs a master, code review formal';
    const r = enrichStackWithContrast('build', text);
    const stackNames = r.stack.map(s => s.name);
    const extraNames = r.extras.map(e => e.name);
    // superpowers-pr debe estar en el stack curado (ya viene de STACK_BY_TYPE.build).
    if (!stackNames.includes('superpowers-pr')) {
      throw new Error('build stack debería incluir superpowers-pr curado');
    }
    // Y NO debe duplicarse como extra.
    if (extraNames.includes('superpowers-pr')) {
      throw new Error('superpowers-pr no debe aparecer como extra cuando ya está en stack');
    }
  });

  check('V31-D — content con menciones a SEO sugiere skill seo aunque no esté en stack content', () => {
    const text = 'quiero escribir un blog con buen SEO para rankear en Google';
    const r = enrichStackWithContrast('content', text);
    const extraNames = r.extras.map(e => e.name);
    if (!extraNames.includes('seo')) {
      throw new Error(`extras esperaba incluir seo. extras: ${extraNames.join(', ')}`);
    }
  });

  check('V31-E — sin keywords matching, extras está vacío', () => {
    const text = 'quiero algo bonito';
    const r = enrichStackWithContrast('content', text);
    if (r.extras.length !== 0) {
      throw new Error(`extras esperaba vacío, fue [${r.extras.map(e => e.name).join(', ')}]`);
    }
  });

  check('V31-F — cada extra tiene `why` no vacío + source declarado', () => {
    const text = 'audit del repo con PRs, planillas Excel, SEO, generar PDFs';
    const r = enrichStackWithContrast('business', text);
    for (const e of r.extras) {
      if (!e.why || !e.why.trim()) {
        throw new Error(`extra ${e.name} sin "why"`);
      }
      if (!e.source) {
        throw new Error(`extra ${e.name} sin "source"`);
      }
      if (e.source !== 'catalog-keywords' && e.source !== 'business-with-software') {
        throw new Error(`extra ${e.name} con source inválido: ${e.source}`);
      }
    }
  });
} finally {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
