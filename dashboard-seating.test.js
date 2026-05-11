// dashboard-seating.test.js
// Tests para dashboard/public/engine/seating.js.
// Cubre: fnv1a32 hashes conocidos, determinismo, probing lineal, overflow N>8.

import { test } from 'node:test';
import assert from 'node:assert';

import { fnv1a32, seatFor, listSeats } from './dashboard/public/engine/seating.js';

// ---------- fnv1a32 ----------

test('fnv1a32 string vacío → offset basis', () => {
  // FNV-1a 32-bit del string vacío es el offset basis: 0x811c9dc5 = 2166136261.
  assert.strictEqual(fnv1a32(''), 0x811c9dc5);
});

test('fnv1a32 "a" → valor canónico', () => {
  // Valor verificado contra implementación canónica FNV-1a 32-bit.
  // "a" = 0x61 → (0x811c9dc5 ^ 0x61) * 0x01000193 mod 2^32 = 0xe40c292c.
  assert.strictEqual(fnv1a32('a'), 0xe40c292c);
});

test('fnv1a32 "foobar" → valor canónico', () => {
  // Vector de prueba estándar FNV-1a 32-bit.
  assert.strictEqual(fnv1a32('foobar'), 0xbf9cf968);
});

test('fnv1a32 mismo input → mismo output', () => {
  const a = fnv1a32('ArchitectAgent');
  const b = fnv1a32('ArchitectAgent');
  assert.strictEqual(a, b);
});

test('fnv1a32 retorna unsigned 32-bit', () => {
  for (const s of ['', 'a', 'foobar', 'Lorem ipsum dolor', 'AGENT', '🦊']) {
    const h = fnv1a32(s);
    assert.ok(h >= 0, `hash de "${s}" debe ser >=0`);
    assert.ok(h < 2 ** 32, `hash de "${s}" debe caber en 32 bits unsigned`);
  }
});

// ---------- listSeats ----------

test('listSeats retorna 8 slots base', () => {
  const seats = listSeats();
  assert.strictEqual(seats.length, 8);
  for (const s of seats) {
    assert.strictEqual(s.isOverflow, false);
    assert.ok(typeof s.x === 'number');
    assert.ok(typeof s.y === 'number');
  }
});

test('listSeats no incluye overflow', () => {
  const seats = listSeats();
  assert.ok(seats.every(s => s.isOverflow === false));
});

// ---------- seatFor determinismo ----------

test('seatFor mismo nombre → mismo asiento entre calls', () => {
  const a = seatFor('ArchitectAgent');
  const b = seatFor('ArchitectAgent');
  assert.deepStrictEqual(a, b);
});

test('seatFor sin nombre → fallback al primer slot', () => {
  const s = seatFor('');
  assert.strictEqual(s.isOverflow, false);
});

// ---------- probing lineal ----------

test('seatFor con probing lineal: dos nombres colisionando van a slots distintos', () => {
  // Buscamos dos nombres cuyo hash % 8 sea el mismo. Iteramos algunos candidatos.
  // Si no encontramos, usamos un truco: A y un nombre del mismo bucket hasheando.
  const taken = new Set(['ArchitectAgent']);
  const seatA = seatFor('ArchitectAgent');

  // Buscar otro nombre que colisione en el mismo slot base (hash % 8).
  const targetBucket = fnv1a32('ArchitectAgent') % 8;
  let collidingName = null;
  for (let i = 0; i < 5000; i++) {
    const cand = `Bot${i}`;
    if (fnv1a32(cand) % 8 === targetBucket) {
      collidingName = cand;
      break;
    }
  }
  assert.ok(collidingName, 'no encontré nombre colisionado para probar probing');

  const seatB = seatFor(collidingName, taken);
  // Ambos quedan en los 8 slots base.
  assert.strictEqual(seatA.isOverflow, false);
  assert.strictEqual(seatB.isOverflow, false);
  // Pero en slots distintos (xy diferente).
  assert.ok(seatA.x !== seatB.x || seatA.y !== seatB.y,
    `colisión sin probing: ${JSON.stringify(seatA)} vs ${JSON.stringify(seatB)}`);
});

// ---------- overflow N>8 ----------

test('seatFor con N=9 agentes: el 9° retorna isOverflow:true', () => {
  const names = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']; // 8 base
  // Asignamos los 8 secuencialmente, acumulando occupied.
  const occupied = new Set();
  for (const n of names) {
    const s = seatFor(n, occupied);
    assert.strictEqual(s.isOverflow, false, `${n} debería caber en base, dio ${JSON.stringify(s)}`);
    occupied.add(n);
  }
  // El noveno DEBE caer en overflow.
  const ninth = seatFor('A8', occupied);
  assert.strictEqual(ninth.isOverflow, true,
    `el 9° agente debería ser overflow, dio ${JSON.stringify(ninth)}`);
});

test('seatFor con N=12 agentes: 8 base + 4 overflow, todos con xy únicos', () => {
  const names = [];
  for (let i = 0; i < 12; i++) names.push(`AgenteOverflow${i}`);
  const occupied = new Set();
  const seats = [];
  for (const n of names) {
    const s = seatFor(n, occupied);
    seats.push({ name: n, ...s });
    occupied.add(n);
  }
  // 8 base + 4 overflow.
  const overflow = seats.filter(s => s.isOverflow === true);
  const base = seats.filter(s => s.isOverflow === false);
  assert.strictEqual(base.length, 8, `esperaba 8 base, dio ${base.length}`);
  assert.strictEqual(overflow.length, 4, `esperaba 4 overflow, dio ${overflow.length}`);
  // Cada xy debe ser único.
  const xys = new Set(seats.map(s => `${s.x},${s.y}`));
  assert.strictEqual(xys.size, 12, `cada agente debería tener xy único, hay ${xys.size}`);
});

test('seatFor overflow es determinístico: mismo nombre + mismo occupied → mismo seat', () => {
  const occupied = new Set(['B0','B1','B2','B3','B4','B5','B6','B7']);
  const s1 = seatFor('B8', occupied);
  const s2 = seatFor('B8', occupied);
  assert.deepStrictEqual(s1, s2);
  assert.strictEqual(s1.isOverflow, true);
});
