import { mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readProfile,
  writeProfile,
  addDecision,
  addLesson,
  getActiveTeam,
  addAgent,
  removeAgent,
  touchAgent,
  addSkill,
  removeSkill,
  addSprint,
  summarize,
  MemoryError,
} from '../src/memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(REPO_ROOT, 'memory', 'templates');

let passed = 0;
let failed = 0;

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
  const tmp = mkdtempSync(join(tmpdir(), 'memory-test-'));
  mkdirSync(tmp, { recursive: true });
  copyFileSync(
    join(TEMPLATES_DIR, 'project-profile.template.json'),
    join(tmp, 'project-profile.json'),
  );
  copyFileSync(
    join(TEMPLATES_DIR, 'active-team.template.json'),
    join(tmp, 'active-team.json'),
  );
  copyFileSync(
    join(TEMPLATES_DIR, 'decisions.template.md'),
    join(tmp, 'decisions.md'),
  );
  copyFileSync(
    join(TEMPLATES_DIR, 'lessons.template.md'),
    join(tmp, 'lessons.md'),
  );
  copyFileSync(
    join(TEMPLATES_DIR, 'sprint-log.template.md'),
    join(tmp, 'sprint-log.md'),
  );
  return tmp;
}

const memDir = bootstrapMemoryDir();

try {
  check('writeProfile rechaza perfil sin campos requeridos', () => {
    let caught = null;
    try {
      writeProfile({ project_type: 'research' }, memDir);
    } catch (e) {
      caught = e;
    }
    if (!caught) throw new Error('debería haber lanzado MemoryError');
    if (!(caught instanceof MemoryError)) {
      throw new Error(`error esperado MemoryError, recibido ${caught.constructor.name}`);
    }
    if (!/required|requerido/i.test(caught.message)) {
      throw new Error(`mensaje no menciona campo requerido: ${caught.message}`);
    }
  });

  check('writeProfile + readProfile redondo con perfil válido', () => {
    const profile = {
      project_type: 'research',
      mode: 'profundo',
      description: 'test project — research',
      created_at: new Date().toISOString(),
      owner: 'aldo@mazelab.cl',
      skills_activas: ['kickoff', 'pipeline-v2'],
      agentes_activos: ['architect-alpha'],
      sprint_inicial: 'sprint-0-discovery',
      tags: ['test'],
    };
    writeProfile(profile, memDir);
    const back = readProfile(memDir);
    if (!back) throw new Error('readProfile devolvió null');
    if (back.description !== profile.description) {
      throw new Error('description round-trip falló');
    }
    if (back.skills_activas.length !== 2) {
      throw new Error('skills_activas no preservó longitud');
    }
  });

  check('writeProfile es idempotente (dos veces con mismo input no rompe)', () => {
    const profile = readProfile(memDir);
    writeProfile(profile, memDir);
    writeProfile(profile, memDir);
    const back = readProfile(memDir);
    if (back.description !== profile.description) {
      throw new Error('round-trip idempotente falló');
    }
  });

  check('addDecision agrega 2 decisiones al log', () => {
    addDecision({
      title: 'Adoptar pipeline-v2 por defecto',
      decision: 'Todo deliverable de contenido pasa por pipeline-v2.',
      reasoning: 'Critic solo no atajó dos errores que cold-reader sí cazó.',
      alternatives: 'Mantener critic solo; saltar critic.',
      reversibility: 'alta',
    }, memDir);
    addDecision({
      title: 'Memoria del proyecto separada de CLAUDE.md',
      decision: 'memory/ es para estado mutable; CLAUDE.md para reglas estables.',
      reasoning: 'Mezclar reglas con estado obliga a re-leer todo en cada sesión.',
      alternatives: 'Volcar todo en CLAUDE.md.',
      reversibility: 'media',
    }, memDir);
    const text = readFileSync(join(memDir, 'decisions.md'), 'utf8');
    const count = (text.match(/^## \d{4}-\d{2}-\d{2}: /gm) || []).length;
    if (count < 2) throw new Error(`esperaba >=2 entries, encontré ${count}`);
  });

  check('addLesson agrega 1 lessons al log', () => {
    addLesson({
      title: 'Las refs del prompt deben mencionarse en el texto',
      context: 'Cargamos 4 refs pero el modelo ignoró 3.',
      lesson: 'Cada Image N tiene que estar nombrada literal en el prompt.',
      application: 'Antes de enviar, releer el prompt y verificar.',
    }, memDir);
    const text = readFileSync(join(memDir, 'lessons.md'), 'utf8');
    if (!/Las refs del prompt/.test(text)) {
      throw new Error('lección no aparece en el archivo');
    }
  });

  check('addAgent + addSkill + idempotencia + touchAgent', () => {
    addAgent({ name: 'architect-alpha', role: 'crea propuestas', model: 'claude-opus-4-7' }, memDir);
    addAgent({ name: 'critic-beta', role: 'evalúa propuestas', model: 'claude-opus-4-7' }, memDir);
    addAgent({ name: 'architect-alpha', role: 'crea propuestas v2', model: 'claude-opus-4-7' }, memDir);

    addSkill({ name: 'pipeline-v2' }, memDir);
    addSkill({ name: 'kickoff' }, memDir);

    touchAgent('architect-alpha', memDir);
    touchAgent('architect-alpha', memDir);

    const team = getActiveTeam(memDir);
    if (team.agents.length !== 2) {
      throw new Error(`esperaba 2 agentes, encontré ${team.agents.length}`);
    }
    const arch = team.agents.find(a => a.name === 'architect-alpha');
    if (arch.total_invocaciones !== 2) {
      throw new Error(`total_invocaciones debería ser 2, es ${arch.total_invocaciones}`);
    }
    if (arch.rol_corto !== 'crea propuestas v2') {
      throw new Error('addAgent no actualizó rol_corto en re-registro');
    }
    if (team.skills.length !== 2) {
      throw new Error(`esperaba 2 skills, encontré ${team.skills.length}`);
    }
  });

  check('removeAgent y removeSkill funcionan idempotentes', () => {
    const r1 = removeAgent('critic-beta', memDir);
    if (!r1.removed) throw new Error('removeAgent debería haber removido critic-beta');
    const r2 = removeAgent('critic-beta', memDir);
    if (r2.removed) throw new Error('removeAgent segunda vez no debería remover nada');

    removeSkill('kickoff', memDir);
    const team = getActiveTeam(memDir);
    if (team.skills.find(s => s.name === 'kickoff')) {
      throw new Error('removeSkill no quitó kickoff');
    }
    if (team.agents.length !== 1) {
      throw new Error(`esperaba 1 agente, hay ${team.agents.length}`);
    }
  });

  check('addSprint registra 1 sprint cerrado', () => {
    addSprint({
      number: 1,
      objective: 'Fundamentos del pipeline',
      deliverables: ['contracts/', 'memory/', 'src/memory.js'],
      lessons: ['schemas compartidos evitan reescribir validación'],
      dates: { start: '2026-05-01', end: '2026-05-08' },
    }, memDir);
    const text = readFileSync(join(memDir, 'sprint-log.md'), 'utf8');
    if (!/Sprint 1 — Fundamentos/.test(text)) {
      throw new Error('sprint no aparece en el archivo');
    }
  });

  check('summarize devuelve conteos correctos', () => {
    const s = summarize(memDir);
    if (!s.has_profile) throw new Error('has_profile debería ser true');
    if (s.project_type !== 'research') throw new Error(`project_type esperaba research, fue ${s.project_type}`);
    if (s.agentes_count !== 1) throw new Error(`agentes_count esperaba 1, fue ${s.agentes_count}`);
    if (s.skills_count !== 1) throw new Error(`skills_count esperaba 1, fue ${s.skills_count}`);
    if (s.decisiones_count !== 2) throw new Error(`decisiones_count esperaba 2, fue ${s.decisiones_count}`);
    if (s.lecciones_count !== 1) throw new Error(`lecciones_count esperaba 1, fue ${s.lecciones_count}`);
    if (s.sprints_completados !== 1) throw new Error(`sprints_completados esperaba 1, fue ${s.sprints_completados}`);
  });

  check('readProfile sobre dir sin perfil devuelve null', () => {
    const empty = mkdtempSync(join(tmpdir(), 'memory-empty-'));
    try {
      const p = readProfile(empty);
      if (p !== null) throw new Error(`esperaba null, recibí ${typeof p}`);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
} finally {
  if (existsSync(memDir)) {
    rmSync(memDir, { recursive: true, force: true });
  }
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
