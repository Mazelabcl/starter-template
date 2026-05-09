import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  emitOutput,
  consumeInput,
  declareContract,
  ContractViolation,
  assertFileExists,
} from './contracts/helpers.js';

import {
  writeProfile,
  addAgent,
  touchAgent,
  addDecision,
  addLesson,
  addSprint,
  summarize,
  getActiveTeam,
} from './src/memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'memory', 'templates');

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
  const tmp = mkdtempSync(join(tmpdir(), 'pipeline-v2-mem-'));
  mkdirSync(tmp, { recursive: true });
  copyFileSync(join(TEMPLATES_DIR, 'active-team.template.json'), join(tmp, 'active-team.json'));
  return tmp;
}

function bootstrapOutputsDir() {
  const tmp = mkdtempSync(join(tmpdir(), 'pipeline-v2-out-'));
  mkdirSync(join(tmp, 'architect'), { recursive: true });
  mkdirSync(join(tmp, 'critic'), { recursive: true });
  mkdirSync(join(tmp, 'cold-reader'), { recursive: true });
  return tmp;
}

function bootstrapPrinciplesFile(memDir) {
  const principlesPath = join(memDir, 'principles.md');
  writeFileSync(principlesPath, '# Principios\n\nP01 — Cero voseo.\nP02 — Tono directo.\n', 'utf8');
  return principlesPath;
}

const memDir = bootstrapMemoryDir();
const outDir = bootstrapOutputsDir();

try {
  // Setup mínimo del proyecto: perfil válido para que summarize() refleje un proyecto inicializado
  writeProfile({
    project_type: 'content',
    mode: 'profundo',
    description: 'Test integración pipeline-v2',
    created_at: new Date().toISOString(),
    owner: 'test@mazelab.cl',
    skills_activas: ['pipeline-v2'],
    agentes_activos: [],
    sprint_inicial: 'sprint-1-fundamentos',
  }, memDir);

  const principlesPath = bootstrapPrinciplesFile(memDir);

  check('Capa 0 — summarize lee perfil del proyecto inicializado', () => {
    const snap = summarize(memDir);
    if (!snap.has_profile) throw new Error('has_profile debería ser true');
    if (snap.project_type !== 'content') throw new Error(`project_type fue ${snap.project_type}`);
    if (snap.agentes_count !== 0) throw new Error(`agentes_count esperaba 0, fue ${snap.agentes_count}`);
  });

  check('Capa 0 — assertFileExists detecta principles.md inexistente', () => {
    let caught = null;
    try {
      assertFileExists('principles', join(memDir, 'no-existe.md'));
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof ContractViolation)) {
      throw new Error('debería haber lanzado ContractViolation');
    }
    assertFileExists('principles', principlesPath);
  });

  check('Capa 1 — architect declara contract, se registra en team y emite output válido', () => {
    declareContract({
      agent: 'architect-test',
      inputs: [{ schema: 'research-output', path: 'content/research/topic.json', optional: true }],
      outputs: [{ schema: 'architect-output', path: 'content/architect/cap03.json' }],
      preconditions: ['principles.md existe'],
      postconditions: ['proposal con al menos 1 section'],
    });

    addAgent({
      name: 'architect-test',
      role: 'crea propuestas estructurales',
      model: 'claude-opus-4-7',
    }, memDir);
    touchAgent('architect-test', memDir);

    const proposal = {
      agent: 'architect-test',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      artifact_kind: 'capitulo',
      title: 'Cap 03 — El Espejo',
      summary: 'Capítulo de prueba para integración.',
      sections: [
        { id: 's1', heading: 'Apertura', intent: 'tono y locación' },
        { id: 's2', heading: 'Conflicto', intent: 'detonante', depends_on: ['s1'] },
      ],
      references: [{ kind: 'principles', path: principlesPath }],
    };

    const meta = emitOutput(
      'architect-test',
      'architect-output',
      proposal,
      join(outDir, 'architect', 'cap03.json'),
    );
    if (!existsSync(meta.path)) throw new Error('output no se escribió a disco');

    const team = getActiveTeam(memDir);
    const agent = team.agents.find(a => a.name === 'architect-test');
    if (!agent) throw new Error('architect-test no quedó en active-team');
    if (agent.total_invocaciones !== 1) {
      throw new Error(`total_invocaciones esperaba 1, fue ${agent.total_invocaciones}`);
    }
  });

  check('Hand-off Capa 1 → Capa 2 — critic consume architect-output validado', () => {
    const consumed = consumeInput(
      'critic-test',
      'architect-output',
      join(outDir, 'architect', 'cap03.json'),
    );
    if (consumed.title !== 'Cap 03 — El Espejo') {
      throw new Error('consumeInput devolvió data inconsistente');
    }
    if (consumed.sections.length !== 2) {
      throw new Error('sections del proposal no se preservaron');
    }
  });

  check('Capa 2 — critic emite critic-output con verdict pass', () => {
    addAgent({ name: 'critic-test', role: 'evalúa propuestas', model: 'claude-opus-4-7' }, memDir);
    touchAgent('critic-test', memDir);

    const critique = {
      agent: 'critic-test',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      target_artifact: join(outDir, 'architect', 'cap03.json'),
      scores: [
        { criterion: 'estructura', score: 88, rationale: 'secciones claras' },
        { criterion: 'tono', score: 92, rationale: 'consistente con principios' },
      ],
      issues: [],
      verdict: 'pass',
    };

    emitOutput('critic-test', 'critic-output', critique, join(outDir, 'critic', 'cap03.json'));
  });

  check('Hand-off Capa 2 → Capa 3 — cold-reader consume el architect-output original (no el critic)', () => {
    const consumed = consumeInput(
      'cold-reader',
      'architect-output',
      join(outDir, 'architect', 'cap03.json'),
    );
    if (!consumed.title) throw new Error('cold-reader no recibió el deliverable');
  });

  check('Capa 3 — cold-reader emite vote=GO con cold-reader-output válido', () => {
    addAgent({ name: 'cold-reader', role: 'gate independiente', model: 'claude-opus-4-7' }, memDir);
    touchAgent('cold-reader', memDir);

    const vote = {
      agent: 'cold-reader',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      target_artifact: join(outDir, 'architect', 'cap03.json'),
      vote: 'GO',
    };

    emitOutput('cold-reader', 'cold-reader-output', vote, join(outDir, 'cold-reader', 'cap03.json'));
  });

  check('Hand-off Capa 3 → Capa 4 — humano consume cold-reader-output con vote=GO', () => {
    const consumed = consumeInput(
      'humano',
      'cold-reader-output',
      join(outDir, 'cold-reader', 'cap03.json'),
    );
    if (consumed.vote !== 'GO') throw new Error(`esperaba GO, vino ${consumed.vote}`);
  });

  check('Capa 4 — humano registra cierre del flujo en memoria (decision + lesson + sprint)', () => {
    addDecision({
      title: 'Cap 03 aprobado en R1',
      decision: 'Publicar Cap 03 sin revisión adicional',
      reasoning: 'Critic dio pass y cold-reader dio GO; lectura humana sin objeciones.',
      alternatives: 'Pedir R2 por refinamiento de tono.',
      reversibility: 'alta',
    }, memDir);

    addLesson({
      title: 'Architect responde mejor con principles cargado primero',
      context: 'En R1 el architect citó P01 explícitamente.',
      lesson: 'Pegar principles.md literal al tope reduce drift.',
      application: 'Mantener regla en briefs futuros.',
    }, memDir);

    addSprint({
      number: 1,
      objective: 'Test integración pipeline-v2',
      deliverables: ['cap03.json'],
      lessons: ['principles literal al tope reduce drift'],
      dates: { start: '2026-05-09', end: '2026-05-09' },
    }, memDir);

    const snap = summarize(memDir);
    if (snap.decisiones_count !== 1) {
      throw new Error(`decisiones_count esperaba 1, fue ${snap.decisiones_count}`);
    }
    if (snap.lecciones_count !== 1) {
      throw new Error(`lecciones_count esperaba 1, fue ${snap.lecciones_count}`);
    }
    if (snap.sprints_completados !== 1) {
      throw new Error(`sprints_completados esperaba 1, fue ${snap.sprints_completados}`);
    }
    if (snap.agentes_count !== 3) {
      throw new Error(`agentes_count esperaba 3, fue ${snap.agentes_count}`);
    }
  });

  check('Caso fallo contractual — architect produce output sin sections, emitOutput frena antes de escribir', () => {
    const broken = {
      agent: 'architect-test',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      artifact_kind: 'capitulo',
      title: 'Cap roto',
    };

    const brokenPath = join(outDir, 'architect', 'cap-roto.json');
    let caught = null;
    try {
      emitOutput('architect-test', 'architect-output', broken, brokenPath);
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof ContractViolation)) {
      throw new Error(`error esperado ContractViolation, recibido ${caught?.constructor.name || 'ninguno'}`);
    }
    if (existsSync(brokenPath)) {
      throw new Error('emitOutput escribió archivo a pesar de que la validación falló');
    }
    if (!/sections/.test(caught.message)) {
      throw new Error(`mensaje de error no menciona "sections": ${caught.message}`);
    }
  });

  check('Caso fallo contractual — consumeInput rechaza archivo editado a mano (campo faltante)', () => {
    const tamperedPath = join(outDir, 'architect', 'cap-tampered.json');
    writeFileSync(tamperedPath, JSON.stringify({
      agent: 'architect-test',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      artifact_kind: 'capitulo',
      title: 'editado a mano',
    }), 'utf8');

    let caught = null;
    try {
      consumeInput('critic-test', 'architect-output', tamperedPath);
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof ContractViolation)) {
      throw new Error('debería haber lanzado ContractViolation');
    }
    if (caught.details?.phase !== 'consume') {
      throw new Error(`phase esperaba 'consume', fue ${caught.details?.phase}`);
    }
  });

  check('Caso fallo contractual — cold-reader con NO-GO sin reason es rechazado por el schema', () => {
    const badVote = {
      agent: 'cold-reader',
      model: 'claude-opus-4-7',
      produced_at: new Date().toISOString(),
      target_artifact: 'content/architect/cap03.json',
      vote: 'NO-GO',
    };

    let caught = null;
    try {
      emitOutput('cold-reader', 'cold-reader-output', badVote, join(outDir, 'cold-reader', 'sin-reason.json'));
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof ContractViolation)) {
      throw new Error('debería haber lanzado ContractViolation por NO-GO sin reason');
    }
  });
} finally {
  rmSync(memDir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
