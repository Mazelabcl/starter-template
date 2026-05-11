// dashboard-sprint-cross.test.js
//
// Tests para las funciones puras que cruzan milestones con tasks del state:
//   - extractMilestones(sprint)
//   - crossMilestonesWithTasks(milestones, tasks)
//
// No requieren DOM. Aceptan el shape "real" de roadmap/current-sprint.json
// (que NO tiene milestones[] formal) y el shape extendido (cuando un agente lo
// declara explícito).

import { test } from 'node:test';
import assert from 'node:assert';

// Activamos un mock minimal de document para que panel.js pueda importarse
// (el cuerpo del módulo solo declara funciones, no toca document a nivel top).
globalThis.document = {
  createElement: () => ({ appendChild() {}, addEventListener() {}, setAttribute() {} }),
  createTextNode: () => ({}),
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  body: {},
};
globalThis.window = { document: globalThis.document };
globalThis.fetch = async () => { throw new Error('fetch desactivado'); };

const { extractMilestones, crossMilestonesWithTasks } = await import('./dashboard/public/ui/panel.js');

// ---------- extractMilestones ----------

test('extractMilestones: sprint con milestones[] objetos', () => {
  const sprint = {
    milestones: [
      { title: 'Hito uno', task_id: 't1' },
      { title: 'Hito dos' },
    ],
  };
  const out = extractMilestones(sprint);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].title, 'Hito uno');
  assert.strictEqual(out[0].task_id, 't1');
  assert.strictEqual(out[1].title, 'Hito dos');
});

test('extractMilestones: sprint con hitos[] (alias español)', () => {
  const sprint = {
    hitos: ['Solo string', { title: 'Con objeto' }],
  };
  const out = extractMilestones(sprint);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].title, 'Solo string');
  assert.strictEqual(out[1].title, 'Con objeto');
});

test('extractMilestones: sprint sin milestones formales → fallback a tasks[] (shape real)', () => {
  // Este es el shape REAL del current-sprint.json del repo: sprint.tasks[]
  // como hitos implícitos.
  const sprint = {
    number: 1,
    objective: 'demo',
    tasks: [
      { id: 'task-1', title: 'Hacer X', status: 'completed' },
      { id: 'task-2', title: 'Hacer Y', status: 'pending' },
    ],
  };
  const out = extractMilestones(sprint);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].title, 'Hacer X');
  assert.strictEqual(out[0].task_id, 'task-1');
  assert.strictEqual(out[0].status, 'done', 'completed → done');
  assert.strictEqual(out[1].status, null, 'pending sin match → null');
});

test('extractMilestones: sprint vacío → []', () => {
  assert.deepStrictEqual(extractMilestones({}), []);
  assert.deepStrictEqual(extractMilestones(null), []);
  assert.deepStrictEqual(extractMilestones(undefined), []);
});

// ---------- crossMilestonesWithTasks ----------

test('crossMilestonesWithTasks: match por task_id exacto', () => {
  const milestones = [{ title: 'M1', task_id: 't1' }];
  const tasks = [{ id: 't1', status: 'completed' }];
  const out = crossMilestonesWithTasks(milestones, tasks);
  assert.strictEqual(out[0].status, 'done');
});

test('crossMilestonesWithTasks: task en running → in_progress', () => {
  const milestones = [{ title: 'M1', task_id: 't1' }];
  const tasks = [{ id: 't1', status: 'running' }];
  const out = crossMilestonesWithTasks(milestones, tasks);
  assert.strictEqual(out[0].status, 'in_progress');
});

test('crossMilestonesWithTasks: sin task_id, match por title aprox', () => {
  const milestones = [{ title: 'Implementar auth' }];
  const tasks = [{ id: 'x', status: 'completed', summary: 'Implementar auth con OAuth2' }];
  const out = crossMilestonesWithTasks(milestones, tasks);
  assert.strictEqual(out[0].status, 'done', 'debió matchear por inclusión de title en summary');
});

test('crossMilestonesWithTasks: status explícito del milestone se respeta si no hay match', () => {
  const milestones = [{ title: 'Algo que no matchea nada', status: 'in_progress' }];
  const tasks = [{ id: 'otra', status: 'completed', summary: 'cosa distinta' }];
  const out = crossMilestonesWithTasks(milestones, tasks);
  assert.strictEqual(out[0].status, 'in_progress');
});

test('crossMilestonesWithTasks: sin match → planned', () => {
  const milestones = [{ title: 'Hito sin contraparte' }];
  const tasks = [{ id: 'x', status: 'running', summary: 'otra cosa' }];
  const out = crossMilestonesWithTasks(milestones, tasks);
  assert.strictEqual(out[0].status, 'planned');
});

test('crossMilestonesWithTasks: tolera tasks/milestones nulos o vacíos', () => {
  assert.deepStrictEqual(crossMilestonesWithTasks([], []), []);
  assert.deepStrictEqual(crossMilestonesWithTasks(null, null), []);
  // milestones válidos sin tasks → todos planned.
  const out = crossMilestonesWithTasks([{ title: 'X' }], []);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, 'planned');
});

test('crossMilestonesWithTasks: prioridad — task_id gana sobre title aprox', () => {
  // El milestone tiene title que matchearía con t2, pero task_id apunta a t1.
  // Debe ganar t1.
  const milestones = [{ title: 'Hacer X', task_id: 't1' }];
  const tasks = [
    { id: 't1', status: 'running', summary: 'algo distinto' },
    { id: 't2', status: 'completed', summary: 'Hacer X' },
  ];
  const out = crossMilestonesWithTasks(milestones, tasks);
  assert.strictEqual(out[0].status, 'in_progress', 'task_id manda sobre title');
});

// Integración: el shape real del repo (tasks[] como milestones implícitos) cruza
// con un state.json que tiene la misma task como completed → status done.
test('integración: sprint shape real → milestones → cross con state', () => {
  const sprint = {
    number: 1,
    objective: 'demo',
    tasks: [
      { id: 'task-1', title: 'Hacer X', status: 'pending' },
      { id: 'task-2', title: 'Hacer Y', status: 'pending' },
    ],
  };
  const state = {
    active_tasks: [
      { id: 'task-1', status: 'completed', summary: 'Hacer X' },
    ],
  };
  const milestones = extractMilestones(sprint);
  const enriched = crossMilestonesWithTasks(milestones, state.active_tasks);
  assert.strictEqual(enriched.length, 2);
  assert.strictEqual(enriched[0].status, 'done', 'task-1 está completed en state → done');
  assert.strictEqual(enriched[1].status, 'planned', 'task-2 no aparece en state → planned');
});
