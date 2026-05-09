import { mkdtempSync, rmSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readRoadmap,
  getCurrentSprint,
  addIdea,
  addTask,
  completeTask,
  updateTaskStatus,
  closeSprint,
  prioritizeIdea,
  startSprint,
  summarize,
  RoadmapError,
} from './src/roadmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname);
const TEMPLATES_DIR = join(REPO_ROOT, 'memory', 'templates');
const ROADMAP_TEMPLATE = join(REPO_ROOT, 'roadmap', 'roadmap.md');
const SPRINT_TEMPLATE = join(REPO_ROOT, 'roadmap', 'current-sprint.json');

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

function bootstrapRoadmapDir() {
  const tmp = mkdtempSync(join(tmpdir(), 'roadmap-test-'));
  mkdirSync(tmp, { recursive: true });
  copyFileSync(ROADMAP_TEMPLATE, join(tmp, 'roadmap.md'));
  copyFileSync(SPRINT_TEMPLATE, join(tmp, 'current-sprint.json'));
  return tmp;
}

function bootstrapMemoryDir() {
  const tmp = mkdtempSync(join(tmpdir(), 'roadmap-mem-'));
  mkdirSync(tmp, { recursive: true });
  copyFileSync(
    join(TEMPLATES_DIR, 'sprint-log.template.md'),
    join(tmp, 'sprint-log.md'),
  );
  return tmp;
}

const roadmapDir = bootstrapRoadmapDir();
const memoryDir = bootstrapMemoryDir();

try {
  check('readRoadmap inicial: markdown + sprint vacíos', () => {
    const r = readRoadmap(roadmapDir);
    if (typeof r.markdown !== 'string') throw new Error('markdown no es string');
    if (!/Sprint actual/.test(r.markdown)) throw new Error('markdown no tiene sección "Sprint actual"');
    if (r.sprint.tasks.length !== 0) throw new Error('tasks debería iniciar vacío');
    if (r.sprint.backlog_added_during_sprint.length !== 0) throw new Error('backlog debería iniciar vacío');
  });

  check('startSprint setea objective + número en JSON y MD', () => {
    startSprint({ number: 1, objective: 'Sistema de roadmap operativo' }, roadmapDir);
    const sprint = getCurrentSprint(roadmapDir);
    if (sprint.objective !== 'Sistema de roadmap operativo') {
      throw new Error(`objective inesperado: ${sprint.objective}`);
    }
    if (!sprint.started_at) throw new Error('started_at no se seteó');
    const md = readFileSync(join(roadmapDir, 'roadmap.md'), 'utf8');
    if (!/Sistema de roadmap operativo/.test(md)) {
      throw new Error('objective no se reflejó en roadmap.md');
    }
  });

  check('addTask agrega 3 tasks al sprint, ambos archivos sincronizados', () => {
    addTask({ title: 'Crear src/roadmap.js' }, roadmapDir);
    addTask({ title: 'Crear slash command /idea', owner: 'human' }, roadmapDir);
    addTask({ title: 'Escribir tests integración' }, roadmapDir);
    const sprint = getCurrentSprint(roadmapDir);
    if (sprint.tasks.length !== 3) throw new Error(`esperaba 3 tasks, hay ${sprint.tasks.length}`);
    const md = readFileSync(join(roadmapDir, 'roadmap.md'), 'utf8');
    if (!/Crear src\/roadmap\.js/.test(md)) throw new Error('task no se renderizó en .md');
    if (!/\[ \] Crear slash command/.test(md)) throw new Error('checkbox pending no apareció');
  });

  check('completeTask marca task como completed en JSON y MD', () => {
    completeTask('task-1', roadmapDir);
    completeTask('task-2', roadmapDir);
    const sprint = getCurrentSprint(roadmapDir);
    const completados = sprint.tasks.filter(t => t.status === 'completed');
    if (completados.length !== 2) throw new Error(`esperaba 2 completed, hay ${completados.length}`);
    const md = readFileSync(join(roadmapDir, 'roadmap.md'), 'utf8');
    if (!/\[x\] Crear src\/roadmap\.js/.test(md)) {
      throw new Error('checkbox marcado [x] no apareció en .md');
    }
  });

  check('updateTaskStatus a in_progress funciona', () => {
    updateTaskStatus('task-3', 'in_progress', roadmapDir);
    const sprint = getCurrentSprint(roadmapDir);
    const t = sprint.tasks.find(x => x.id === 'task-3');
    if (t.status !== 'in_progress') throw new Error(`esperaba in_progress, fue ${t.status}`);
  });

  check('addIdea captura 4 ideas: 2 sin priorizar, 1 alta, 1 media', () => {
    addIdea({ text: 'agregar dark mode al dashboard' }, roadmapDir);
    addIdea({ text: 'auto-generar changelog desde sprint-log.md' }, roadmapDir);
    addIdea({ text: 'integrar con Linear vía webhook', priority: 'alta' }, roadmapDir);
    addIdea({ text: 'soportar emojis en titles', priority: 'media', context: 'feedback usuario' }, roadmapDir);

    const sprint = getCurrentSprint(roadmapDir);
    if (sprint.backlog_added_during_sprint.length !== 4) {
      throw new Error(`esperaba 4 ideas, hay ${sprint.backlog_added_during_sprint.length}`);
    }
    const sinPriorizar = sprint.backlog_added_during_sprint.filter(i => i.priority === 'sin-priorizar');
    if (sinPriorizar.length !== 2) {
      throw new Error(`esperaba 2 sin-priorizar, hay ${sinPriorizar.length}`);
    }

    const md = readFileSync(join(roadmapDir, 'roadmap.md'), 'utf8');
    if (!/agregar dark mode al dashboard/.test(md)) throw new Error('idea sin-priorizar no apareció en .md');
    if (!/integrar con Linear/.test(md)) throw new Error('idea alta no apareció en .md');
    if (!/contexto: feedback usuario/.test(md)) throw new Error('contexto no se renderizó');
  });

  check('addIdea idempotente: misma idea no se duplica', () => {
    const before = getCurrentSprint(roadmapDir).backlog_added_during_sprint.length;
    const r = addIdea({ text: 'agregar dark mode al dashboard' }, roadmapDir);
    if (r.added) throw new Error('addIdea debería haber retornado added=false por duplicado');
    const after = getCurrentSprint(roadmapDir).backlog_added_during_sprint.length;
    if (before !== after) throw new Error('idea duplicada se agregó al JSON');
  });

  check('addIdea con texto vacío rechaza con RoadmapError claro', () => {
    let caught = null;
    try {
      addIdea({ text: '' }, roadmapDir);
    } catch (e) {
      caught = e;
    }
    if (!caught) throw new Error('debería haber lanzado RoadmapError');
    if (!(caught instanceof RoadmapError)) throw new Error(`error tipo inesperado: ${caught.constructor.name}`);
    if (!/text/.test(caught.message)) throw new Error(`mensaje no menciona "text": ${caught.message}`);

    let caught2 = null;
    try {
      addIdea({ text: '   ' }, roadmapDir);
    } catch (e) {
      caught2 = e;
    }
    if (!caught2) throw new Error('debería rechazar text con solo whitespace');
  });

  check('prioritizeIdea mueve idea cruda a sección "media"', () => {
    prioritizeIdea({ ideaText: 'agregar dark mode al dashboard', newPriority: 'media' }, roadmapDir);
    const sprint = getCurrentSprint(roadmapDir);
    const idea = sprint.backlog_added_during_sprint.find(i => i.idea === 'agregar dark mode al dashboard');
    if (idea.priority !== 'media') throw new Error(`esperaba media, fue ${idea.priority}`);

    const md = readFileSync(join(roadmapDir, 'roadmap.md'), 'utf8');
    // La idea ya no debería estar en "Ideas crudas".
    const ideasCrudasMatch = md.match(/<!-- ideas-crudas-start -->([\s\S]*?)<!-- ideas-crudas-end -->/);
    if (ideasCrudasMatch && /agregar dark mode al dashboard/.test(ideasCrudasMatch[1])) {
      throw new Error('idea sigue en "Ideas crudas" después de priorizar');
    }
  });

  check('summarize devuelve conteos correctos antes de cerrar', () => {
    const s = summarize(roadmapDir);
    if (s.tasks_completed !== 2) throw new Error(`tasks_completed esperaba 2, fue ${s.tasks_completed}`);
    if (s.tasks_pending !== 1) throw new Error(`tasks_pending esperaba 1, fue ${s.tasks_pending}`);
    if (s.ideas_capturadas !== 4) throw new Error(`ideas_capturadas esperaba 4, fue ${s.ideas_capturadas}`);
    // 1 alta + 1 media original + dark mode movido a media = 3 priorizadas
    if (s.ideas_priorizadas !== 3) throw new Error(`ideas_priorizadas esperaba 3, fue ${s.ideas_priorizadas}`);
    if (s.sprint_actual.number !== 1) throw new Error(`sprint number esperaba 1, fue ${s.sprint_actual.number}`);
  });

  check('closeSprint mueve a sprint-log.md y resetea current-sprint.json', () => {
    const result = closeSprint({
      lessons: ['Markers HTML mantienen el .md humano-editable', 'Idempotencia con normalize lower+trim'],
      deliverables: ['src/roadmap.js', 'roadmap/roadmap.md', '.claude/commands/idea.md'],
    }, roadmapDir, memoryDir);

    if (result.closed_sprint !== 1) throw new Error(`closed_sprint esperaba 1, fue ${result.closed_sprint}`);
    if (result.next_sprint !== 2) throw new Error(`next_sprint esperaba 2, fue ${result.next_sprint}`);

    // Verifica que se escribió a sprint-log.md
    const sprintLog = readFileSync(join(memoryDir, 'sprint-log.md'), 'utf8');
    if (!/## Sprint 1 — Sistema de roadmap operativo/.test(sprintLog)) {
      throw new Error('sprint-log.md no contiene el sprint cerrado');
    }
    if (!/Markers HTML mantienen el \.md humano-editable/.test(sprintLog)) {
      throw new Error('lessons no aparecen en sprint-log.md');
    }
    if (!/src\/roadmap\.js/.test(sprintLog)) {
      throw new Error('deliverables no aparecen en sprint-log.md');
    }

    // Verifica que current-sprint.json se reseteó al sprint 2 vacío.
    const next = getCurrentSprint(roadmapDir);
    if (next.number !== 2) throw new Error(`next sprint number esperaba 2, fue ${next.number}`);
    if (next.tasks.length !== 0) throw new Error('tasks no se limpiaron al cerrar');
    if (next.backlog_added_during_sprint.length !== 0) throw new Error('backlog no se limpió al cerrar');
    if (next.objective !== '') throw new Error('objective no se limpió al cerrar');
  });

  check('closeSprint deriva entregables de tasks completadas si caller no pasa lista', () => {
    // Setup: nuevo sprint con 2 tasks, ambas completadas
    startSprint({ number: 2, objective: 'Sprint con auto-deliverables' }, roadmapDir);
    addTask({ title: 'Tarea A' }, roadmapDir);
    addTask({ title: 'Tarea B' }, roadmapDir);
    completeTask('task-1', roadmapDir);
    completeTask('task-2', roadmapDir);

    const result = closeSprint({
      lessons: ['lección única'],
      // sin deliverables explícitos → debe usar las tasks completadas
    }, roadmapDir, memoryDir);

    if (!result.deliverables.includes('Tarea A')) {
      throw new Error('auto-derivación de deliverables falló: no incluye "Tarea A"');
    }
    if (!result.deliverables.includes('Tarea B')) {
      throw new Error('auto-derivación de deliverables falló: no incluye "Tarea B"');
    }

    const sprintLog = readFileSync(join(memoryDir, 'sprint-log.md'), 'utf8');
    if (!/## Sprint 2 — Sprint con auto-deliverables/.test(sprintLog)) {
      throw new Error('sprint 2 no quedó en sprint-log.md');
    }
  });

  check('closeSprint sin objective rechaza con error claro', () => {
    // Tras cerrar 2 sprints, current-sprint está limpio (objective="")
    let caught = null;
    try {
      closeSprint({ lessons: [], deliverables: [] }, roadmapDir, memoryDir);
    } catch (e) {
      caught = e;
    }
    if (!caught) throw new Error('debería rechazar cerrar sprint sin objective');
    if (!(caught instanceof RoadmapError)) {
      throw new Error(`error tipo inesperado: ${caught.constructor.name}`);
    }
  });

  check('roadmap.md sigue legible para humanos tras todas las ops (sin JSON crudo embebido)', () => {
    const md = readFileSync(join(roadmapDir, 'roadmap.md'), 'utf8');
    // No debería haber bloques JSON gigantes — verifica con un heurístico simple
    if (/"backlog_added_during_sprint"/.test(md)) {
      throw new Error('roadmap.md contiene JSON crudo del current-sprint — debería ser solo prosa');
    }
    if (!/## Sprint actual/.test(md)) throw new Error('estructura de secciones se perdió');
    if (!/## Backlog priorizado/.test(md)) throw new Error('sección de backlog se perdió');
  });
} finally {
  if (existsSync(roadmapDir)) rmSync(roadmapDir, { recursive: true, force: true });
  if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
