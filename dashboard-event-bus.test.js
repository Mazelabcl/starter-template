// dashboard-event-bus.test.js
// Tests para dashboard/public/engine/eventBus.js.
// Cubre: cursor null primer call (ADR-04 opción a), avance por tuple,
// tie-break por index, resetCursor, compareTuple.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  diffEvents,
  resetCursor,
  compareTuple,
  getCursor,
  bus,
} from './dashboard/public/engine/eventBus.js';

// El cursor es módulo-global. Cada test reinicia con resetCursor(null, -1) en
// su primera línea para evitar leakage de orden.

// ---------- compareTuple ----------

test('compareTuple strict-greater por timestamp primero', () => {
  assert.strictEqual(compareTuple(['2026-01-01T00:00:01Z', 0], ['2026-01-01T00:00:00Z', 0]), 1);
  assert.strictEqual(compareTuple(['2026-01-01T00:00:00Z', 0], ['2026-01-01T00:00:01Z', 0]), -1);
});

test('compareTuple tie-break por index cuando timestamp igual', () => {
  assert.strictEqual(compareTuple(['T', 5], ['T', 3]), 2);
  assert.strictEqual(compareTuple(['T', 3], ['T', 5]), -2);
  assert.strictEqual(compareTuple(['T', 4], ['T', 4]), 0);
});

test('compareTuple null timestamp es menor que cualquier real', () => {
  assert.ok(compareTuple(['2026-01-01T00:00:00Z', 0], [null, -1]) > 0);
  assert.ok(compareTuple([null, -1], ['2026-01-01T00:00:00Z', 0]) < 0);
});

// ---------- primer call con cursor null ----------

test('primer call con cursor null + events vacíos → [], cursor sigue null', () => {
  resetCursor(null, -1);
  const out = diffEvents([]);
  assert.deepStrictEqual(out, []);
  const c = getCursor();
  assert.strictEqual(c.timestamp, null);
  assert.strictEqual(c.index, -1);
});

test('primer call con cursor null + 3 events → [], cursor seteado al último', () => {
  resetCursor(null, -1);
  const events = [
    { type: 'task_started', timestamp: '2026-01-01T00:00:01Z' },
    { type: 'task_started', timestamp: '2026-01-01T00:00:02Z' },
    { type: 'task_completed', timestamp: '2026-01-01T00:00:03Z' },
  ];
  const out = diffEvents(events);
  assert.deepStrictEqual(out, []);
  const c = getCursor();
  assert.strictEqual(c.timestamp, '2026-01-01T00:00:03Z');
  assert.strictEqual(c.index, 2);
});

// ---------- avance del cursor ----------

test('segundo call con 1 event nuevo → retorna ese event, cursor avanza', () => {
  resetCursor(null, -1);
  const first = [
    { type: 'task_started', timestamp: '2026-01-01T00:00:01Z' },
    { type: 'task_completed', timestamp: '2026-01-01T00:00:02Z' },
  ];
  diffEvents(first); // setea cursor a (T2, 1).

  const second = [
    ...first,
    { type: 'event_x', timestamp: '2026-01-01T00:00:03Z' },
  ];
  const out = diffEvents(second);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].type, 'event_x');
  const c = getCursor();
  assert.strictEqual(c.timestamp, '2026-01-01T00:00:03Z');
  assert.strictEqual(c.index, 2);
});

test('tercer call con N events nuevos → retorna todos, cursor al último', () => {
  resetCursor(null, -1);
  const first = [{ type: 'a', timestamp: '2026-01-01T00:00:01Z' }];
  diffEvents(first);
  const second = [
    ...first,
    { type: 'b', timestamp: '2026-01-01T00:00:02Z' },
    { type: 'c', timestamp: '2026-01-01T00:00:03Z' },
    { type: 'd', timestamp: '2026-01-01T00:00:04Z' },
  ];
  const out = diffEvents(second);
  assert.deepStrictEqual(out.map(e => e.type), ['b', 'c', 'd']);
  const c = getCursor();
  assert.strictEqual(c.timestamp, '2026-01-01T00:00:04Z');
  assert.strictEqual(c.index, 3);
});

test('call sin events nuevos (mismo array) → [], cursor sin cambio', () => {
  resetCursor(null, -1);
  const events = [
    { type: 'a', timestamp: '2026-01-01T00:00:01Z' },
    { type: 'b', timestamp: '2026-01-01T00:00:02Z' },
  ];
  diffEvents(events);
  const before = getCursor();
  const out = diffEvents(events);
  assert.deepStrictEqual(out, []);
  const after = getCursor();
  assert.deepStrictEqual(after, before);
});

// ---------- tie-break con timestamps idénticos ----------

test('tie-break: 2 events con timestamp idéntico → ambos procesados en orden de array', () => {
  resetCursor(null, -1);
  // Primer batch: settea cursor al evento 0 (timestamp T1).
  diffEvents([{ type: 'baseline', timestamp: '2026-01-01T00:00:00Z' }]);

  // Segundo batch: agregamos dos events con MISMO timestamp T2.
  const events = [
    { type: 'baseline', timestamp: '2026-01-01T00:00:00Z' },
    { type: 'twin_a', timestamp: '2026-01-01T00:00:05Z' },
    { type: 'twin_b', timestamp: '2026-01-01T00:00:05Z' },
  ];
  const out = diffEvents(events);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].type, 'twin_a');
  assert.strictEqual(out[1].type, 'twin_b');
  const c = getCursor();
  assert.strictEqual(c.timestamp, '2026-01-01T00:00:05Z');
  assert.strictEqual(c.index, 2);

  // Tercer call con los mismos 3 events → nada nuevo.
  const again = diffEvents(events);
  assert.deepStrictEqual(again, []);
});

test('tie-break: agregando un 3er twin con mismo timestamp en siguiente batch', () => {
  resetCursor(null, -1);
  const first = [
    { type: 'init', timestamp: '2026-01-01T00:00:00Z' },
    { type: 'twin_a', timestamp: '2026-01-01T00:00:05Z' },
    { type: 'twin_b', timestamp: '2026-01-01T00:00:05Z' },
  ];
  diffEvents(first); // cursor = (T5, 2)

  const second = [
    ...first,
    { type: 'twin_c', timestamp: '2026-01-01T00:00:05Z' },
  ];
  const out = diffEvents(second);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].type, 'twin_c');
  const c = getCursor();
  assert.strictEqual(c.timestamp, '2026-01-01T00:00:05Z');
  assert.strictEqual(c.index, 3);
});

// ---------- resetCursor ----------

test('resetCursor setea timestamp + index correctamente', () => {
  resetCursor('2026-06-01T00:00:00Z', 42);
  const c = getCursor();
  assert.strictEqual(c.timestamp, '2026-06-01T00:00:00Z');
  assert.strictEqual(c.index, 42);
});

test('resetCursor null vuelve a estado inicial (primer call)', () => {
  resetCursor('2026-06-01T00:00:00Z', 42);
  resetCursor(null, -1);
  // Tras reset, un diffEvents con events no vacíos NO debe emitir (ADR-04 opción a).
  const out = diffEvents([
    { type: 'x', timestamp: '2026-01-01T00:00:01Z' },
    { type: 'y', timestamp: '2026-01-01T00:00:02Z' },
  ]);
  assert.deepStrictEqual(out, []);
});

// ---------- bus EventTarget ----------

test('bus es EventTarget funcional', () => {
  resetCursor(null, -1);
  assert.ok(bus instanceof EventTarget);
  let received = null;
  const handler = (ev) => { received = ev.detail; };
  bus.addEventListener('test-event', handler);
  bus.dispatchEvent(new CustomEvent('test-event', { detail: { hello: 'world' } }));
  bus.removeEventListener('test-event', handler);
  assert.deepStrictEqual(received, { hello: 'world' });
});
