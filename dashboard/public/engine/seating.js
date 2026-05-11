// dashboard/public/engine/seating.js
//
// Asignación determinística de asientos para agentes. Spec sección 2 + ADR-03
// + Fix 5 (overflow N>8).
//
// Reglas:
//   - 8 slots base catalogados (matchea exactamente los escritorios que dibuja
//     OfficeScene). scene.js los importa para no duplicar coordenadas.
//   - Hash FNV-1a 32-bit % 8 → slot inicial.
//   - Colisión: probing lineal dentro de los 8 slots base.
//   - Overflow N>8: si ningún slot base queda libre, el agente se asigna a un
//     "overflow row" debajo de la oficina principal (Y fuera de la fila base).
//     Los X de overflow son ilimitados, espaciados cada 64 px lógicos (post-scale
//     resultará en 128 px de separación a scale=2, pero el catálogo ya está en
//     px de pantalla porque scene.js trabaja en post-scale). Sin error, sin
//     warning bloqueante.
//
// El parámetro `occupiedNames` es opcional: si no se pasa, se infiere "ningún
// asiento ocupado" y se aplica solo el hash directo. Si se pasa, se respeta la
// posición previamente asignada a cada nombre conocido (recalculando con el
// mismo algoritmo, dado que el algoritmo es determinístico — el hash es estable).
//
// Coord. de los 8 slots base — copiadas de OfficeScene.create() para que las
// dos vistas (escena estática + asignador de avatares) sean consistentes.
// Si scene.js cambia las posiciones de los escritorios, mover acá también.
//
// Origen: deskRow1Y = 260, deskRow2Y = 480, deskStartX = 256, deskGapX = 256.
// El "asiento" del avatar queda justo encima del centro del escritorio
// (y - tileRendered/2 - 4), donde tileRendered = 32 a scale=2.

const BASE_SEATS = Object.freeze([
  // Fila 1 (Y = 260 → asiento Y = 260 - 32/2 - 4 = 240).
  { x: 256,  y: 240, isOverflow: false },
  { x: 512,  y: 240, isOverflow: false },
  { x: 768,  y: 240, isOverflow: false },
  { x: 1024, y: 240, isOverflow: false },
  // Fila 2 (Y = 480 → asiento Y = 480 - 32/2 - 4 = 460).
  { x: 256,  y: 460, isOverflow: false },
  { x: 512,  y: 460, isOverflow: false },
  { x: 768,  y: 460, isOverflow: false },
  { x: 1024, y: 460, isOverflow: false },
]);

// Overflow row: Y fija fuera de la fila base de escritorios. 656 está sobre la
// fila de plantas decorativas pero por debajo de los escritorios de fila 2.
// Si hace falta más espacio vertical, otra fila más abajo (Y=700+) podría
// agregarse — fuera de scope MVP.
const OVERFLOW_Y = 640;
const OVERFLOW_X_START = 64;
const OVERFLOW_X_GAP = 64;

/**
 * FNV-1a 32-bit hash. Stable cross-runtime. Exportado para que el test pueda
 * validar el algoritmo independientemente.
 *
 * @param {string} str
 * @returns {number}  hash en rango [0, 2^32).
 */
export function fnv1a32(str) {
  let hash = 0x811c9dc5; // offset basis 32-bit
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiplicación por FNV prime (16777619) en aritmética 32-bit unsigned.
    // Usamos Math.imul para evitar pérdida de precisión en JS.
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Retorna el catálogo de los 8 slots base. Cada slot es inmutable.
 * El overflow row no se cataloga (capacidad ilimitada).
 *
 * @returns {ReadonlyArray<{x:number,y:number,isOverflow:false}>}
 */
export function listSeats() {
  return BASE_SEATS;
}

/**
 * Asigna asiento determinísticamente a un nombre.
 *
 * @param {string} agentName
 * @param {Iterable<string>} [occupiedNames]  Iterable de nombres ya colocados.
 *                                            Si está, sus asientos se "consumen"
 *                                            antes de buscar uno libre para el
 *                                            nombre nuevo.
 * @returns {{x:number,y:number,isOverflow:boolean}}
 */
export function seatFor(agentName, occupiedNames) {
  if (typeof agentName !== 'string' || agentName.length === 0) {
    // Sin nombre no podemos hashear. Caemos al primer slot base como fallback
    // explícito — no rompemos el render por un agente sin nombre.
    return { ...BASE_SEATS[0] };
  }

  const occupied = toSet(occupiedNames);

  // Si el propio nombre ya está marcado como ocupado, lo tratamos como "ya
  // tenía asiento" — re-calculamos su asiento sin contarlo a sí mismo.
  // (Esto previene el degenerado de seatFor('A', ['A']) que reservaría el slot
  // de A para nadie y devolvería el siguiente.)
  const selfExcluded = new Set(occupied);
  selfExcluded.delete(agentName);

  // 1) Resolver los slots base ocupados a partir de los nombres ocupados.
  //    Aplicamos el mismo algoritmo recursivamente — pero usando solo los nombres
  //    ya colocados (sin el actual), de forma que el set de slots ocupados es
  //    derivable. Para evitar recursión infinita y mantener el coste lineal,
  //    asignamos los nombres ocupados en algún orden estable (orden de inserción
  //    del Set) sobre una copia de los 8 slots base, marcando overflow si saturan.
  const slotMap = new Map(); // name -> seat
  const baseTaken = new Set();
  let overflowCounter = 0;

  for (const occName of selfExcluded) {
    if (typeof occName !== 'string' || occName.length === 0) continue;
    const seat = placeOnce(occName, baseTaken, overflowCounter);
    slotMap.set(occName, seat);
    if (seat.isOverflow) overflowCounter += 1;
    else baseTaken.add(seatKey(seat));
  }

  // 2) Asignar el nombre actual con el mismo algoritmo, respetando lo ya
  //    ocupado por los otros.
  const mySeat = placeOnce(agentName, baseTaken, overflowCounter);
  return mySeat;
}

/**
 * Helper: pone un nombre en el primer slot base libre (probing lineal desde el
 * hash) o en overflow si todos los 8 base están ocupados.
 */
function placeOnce(name, baseTaken, overflowCounter) {
  if (baseTaken.size >= BASE_SEATS.length) {
    // Todos los 8 base están ocupados → overflow.
    return makeOverflowSeat(name, overflowCounter);
  }
  const start = fnv1a32(name) % BASE_SEATS.length;
  for (let step = 0; step < BASE_SEATS.length; step++) {
    const idx = (start + step) % BASE_SEATS.length;
    const seat = BASE_SEATS[idx];
    const k = seatKey(seat);
    if (!baseTaken.has(k)) {
      return { x: seat.x, y: seat.y, isOverflow: false };
    }
  }
  // Defensivo: en teoría no se llega acá porque el size-check de arriba lo
  // cubre, pero si pasara, caemos a overflow igual.
  return makeOverflowSeat(name, overflowCounter);
}

/**
 * Construye un asiento en la overflow row para un nombre. El X se deriva del
 * hash del nombre para mantener determinismo + del contador para diferenciar
 * cuando varios nombres comparten hash.
 */
function makeOverflowSeat(name, counter) {
  // X determinístico por hash, pero offset por counter para evitar colisiones
  // visuales si dos overflow caen al mismo X derivado del hash.
  const slot = (fnv1a32(name) + counter * 17) % 1000; // máx 1000 slots virtuales
  const x = OVERFLOW_X_START + slot * OVERFLOW_X_GAP;
  return { x, y: OVERFLOW_Y, isOverflow: true };
}

function seatKey(seat) {
  return `${seat.x},${seat.y}`;
}

function toSet(iterable) {
  if (!iterable) return new Set();
  if (iterable instanceof Set) return iterable;
  return new Set(iterable);
}
