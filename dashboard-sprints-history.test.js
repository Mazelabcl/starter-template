// dashboard-sprints-history.test.js
//
// Tests para el parser de memory/sprint-log.md (endpoint GET /api/sprints/history).
//
// Cubre:
//   - Archivo no existe → array vacío.
//   - 1 sprint con shape canónico → array de 1 con campos parseados.
//   - 2 sprints → orden descendente por número, parseo independiente.
//   - Headers y bullets variantes → parser robusto.
//   - Endpoint HTTP /api/sprints/history retorna 200 + JSON correcto.
//
// Sin red, sin deps nuevas.

import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const SPRINT_LOG_PATH = join(REPO_ROOT, 'memory', 'sprint-log.md');

import { parseSprintLogMarkdown, readSprintHistory, startServer } from './dashboard/server.js';

function backupSprintLog() {
  return existsSync(SPRINT_LOG_PATH) ? readFileSync(SPRINT_LOG_PATH, 'utf8') : null;
}

function restoreSprintLog(backup) {
  if (backup === null) {
    if (existsSync(SPRINT_LOG_PATH)) unlinkSync(SPRINT_LOG_PATH);
  } else {
    mkdirSync(dirname(SPRINT_LOG_PATH), { recursive: true });
    writeFileSync(SPRINT_LOG_PATH, backup, 'utf8');
  }
}

// ---------- parser unitario ----------

test('parseSprintLogMarkdown: string vacío → []', () => {
  assert.deepStrictEqual(parseSprintLogMarkdown(''), []);
  assert.deepStrictEqual(parseSprintLogMarkdown('   \n\n'), []);
  assert.deepStrictEqual(parseSprintLogMarkdown(null), []);
});

test('parseSprintLogMarkdown: archivo sin headers Sprint → []', () => {
  const md = '# Algún título\n\nTexto cualquiera sin headers Sprint.\n';
  assert.deepStrictEqual(parseSprintLogMarkdown(md), []);
});

test('parseSprintLogMarkdown: 1 sprint con shape canónico se parsea bien', () => {
  const md = `# Sprint log

## Sprint 1 — Fundamentos del pipeline

**Fechas**
- inicio: 2026-05-01
- fin: 2026-05-08

**Entregables**
- contracts/
- memory/
- src/memory.js

**Lessons**
- schemas compartidos evitan reescribir validación
- atomic writes previenen state corrupto
`;
  const sprints = parseSprintLogMarkdown(md);
  assert.strictEqual(sprints.length, 1, 'un sprint');
  const s = sprints[0];
  assert.strictEqual(s.number, 1);
  assert.strictEqual(s.objective, 'Fundamentos del pipeline');
  assert.strictEqual(s.dates.start, '2026-05-01');
  assert.strictEqual(s.dates.end, '2026-05-08');
  assert.deepStrictEqual(s.deliverables, ['contracts/', 'memory/', 'src/memory.js']);
  assert.strictEqual(s.lessons.length, 2);
  assert.ok(s.lessons[0].includes('schemas compartidos'));
});

test('parseSprintLogMarkdown: 2 sprints → orden descendente por número', () => {
  const md = `## Sprint 1 — Fundamentos

**Entregables**
- memory/

**Lessons**
- lección uno

## Sprint 2 — Dashboard v3

**Fechas**
- inicio: 2026-05-09
- fin: 2026-05-11

**Entregables**
- dashboard/public/engine/
- dashboard/public/ui/

**Lessons**
- Phaser sobre canvas
- side panel DOM nativo
`;
  const sprints = parseSprintLogMarkdown(md);
  assert.strictEqual(sprints.length, 2);
  // Orden DESC: Sprint 2 primero.
  assert.strictEqual(sprints[0].number, 2);
  assert.strictEqual(sprints[1].number, 1);
  assert.strictEqual(sprints[0].objective, 'Dashboard v3');
  assert.strictEqual(sprints[0].deliverables.length, 2);
  assert.strictEqual(sprints[0].lessons.length, 2);
});

test('parseSprintLogMarkdown: sub-headers con ### también funcionan', () => {
  const md = `## Sprint 3 — Test alt headers

### Entregables
- algo

### Lessons
- algo aprendido
`;
  const sprints = parseSprintLogMarkdown(md);
  assert.strictEqual(sprints.length, 1);
  assert.deepStrictEqual(sprints[0].deliverables, ['algo']);
  assert.deepStrictEqual(sprints[0].lessons, ['algo aprendido']);
});

test('parseSprintLogMarkdown: bullets con * también funcionan', () => {
  const md = `## Sprint 4 — Bullets variantes

**Entregables**
* uno
* dos
`;
  const sprints = parseSprintLogMarkdown(md);
  assert.strictEqual(sprints.length, 1);
  assert.deepStrictEqual(sprints[0].deliverables, ['uno', 'dos']);
});

test('parseSprintLogMarkdown: header sin objetivo inline → objective vacío o desde sub-bloque', () => {
  const md = `## Sprint 5

**Objetivo**
Cerrar todo lo pendiente

**Entregables**
- a
`;
  const sprints = parseSprintLogMarkdown(md);
  assert.strictEqual(sprints.length, 1);
  assert.strictEqual(sprints[0].objective, 'Cerrar todo lo pendiente');
});

// ---------- helper readSprintHistory contra el disco ----------

test('readSprintHistory: archivo no existe → []', () => {
  const backup = backupSprintLog();
  try {
    if (existsSync(SPRINT_LOG_PATH)) unlinkSync(SPRINT_LOG_PATH);
    const result = readSprintHistory();
    assert.deepStrictEqual(result, []);
  } finally {
    restoreSprintLog(backup);
  }
});

test('readSprintHistory: archivo con 1 sprint → array de 1', () => {
  const backup = backupSprintLog();
  try {
    mkdirSync(dirname(SPRINT_LOG_PATH), { recursive: true });
    writeFileSync(SPRINT_LOG_PATH, `## Sprint 99 — Test fixture

**Fechas**
- inicio: 2026-05-01
- fin: 2026-05-02

**Entregables**
- test-output

**Lessons**
- una lección
`, 'utf8');
    const result = readSprintHistory();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].number, 99);
    assert.strictEqual(result[0].objective, 'Test fixture');
  } finally {
    restoreSprintLog(backup);
  }
});

// ---------- endpoint HTTP /api/sprints/history ----------

test('GET /api/sprints/history retorna 200 + JSON array', async () => {
  const backup = backupSprintLog();
  let serverInfo = null;
  try {
    // Reset estado: sin archivo → endpoint debe retornar [].
    if (existsSync(SPRINT_LOG_PATH)) unlinkSync(SPRINT_LOG_PATH);
    serverInfo = await startServer(0);
    const baseUrl = `http://localhost:${serverInfo.port}`;
    const r = await fetch(`${baseUrl}/api/sprints/history`);
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j), 'respuesta es array');
    assert.strictEqual(j.length, 0, 'sin sprint-log.md → array vacío');

    // Ahora con un sprint.
    mkdirSync(dirname(SPRINT_LOG_PATH), { recursive: true });
    writeFileSync(SPRINT_LOG_PATH, `## Sprint 42 — Endpoint test

**Fechas**
- inicio: 2026-05-11
- fin: 2026-05-11

**Entregables**
- endpoint listo

**Lessons**
- HTTP nativo basta
`, 'utf8');
    const r2 = await fetch(`${baseUrl}/api/sprints/history`);
    assert.strictEqual(r2.status, 200);
    const j2 = await r2.json();
    assert.strictEqual(j2.length, 1);
    assert.strictEqual(j2[0].number, 42);
    assert.strictEqual(j2[0].objective, 'Endpoint test');
  } finally {
    if (serverInfo && serverInfo.server) {
      await new Promise(r => serverInfo.server.close(r));
    }
    restoreSprintLog(backup);
  }
});

// ---------- endpoint HTTP /api/roadmap ----------

test('GET /api/roadmap retorna 200 + { markdown }', async () => {
  let serverInfo = null;
  try {
    serverInfo = await startServer(0);
    const baseUrl = `http://localhost:${serverInfo.port}`;
    const r = await fetch(`${baseUrl}/api/roadmap`);
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.ok(typeof j.markdown === 'string', 'markdown es string');
    // El repo tiene roadmap/roadmap.md por defecto, así que debería ser no-vacío.
    // No asertamos contenido exacto (cambia con el tiempo); solo que sea string.
  } finally {
    if (serverInfo && serverInfo.server) {
      await new Promise(r => serverInfo.server.close(r));
    }
  }
});
