// dashboard/public/engine/eventBus.js
//
// Diff de eventos por (timestamp, index) tuple + EventTarget global como bus.
// Spec sección 2 + Fix 1 (tie-break por tuple) + ADR-04 opción (a).
//
// Reglas:
//   - Cursor interno: { timestamp: string|null, index: number }.
//   - Primer call con cursor null:
//       * events vacío  → retorna [], cursor sigue null.
//       * events no vacío → settea cursor al último (timestamp, index), retorna [].
//   - Calls subsiguientes: retorna eventos cuya tuple (timestamp, index)
//     es estrictamente mayor a la del cursor. Actualiza cursor al último.
//   - Tie-break: dos eventos con timestamp idéntico se ordenan por su index en
//     el array. El cursor avanza por ambos en orden.
//
// El bus `EventTarget` se exporta directamente. Suscriptores hacen
// `bus.addEventListener('state-update', ...)` (state-sync) o
// `bus.addEventListener('avatar-clicked', ...)` (panel UI).

const cursor = { timestamp: null, index: -1 };

/**
 * Compara dos tuples (timestamp, index). Devuelve >0 si a>b, <0 si a<b, 0 si =.
 * Strict-greater por timestamp primero (comparación lexicográfica ISO funciona),
 * tie-break por index numérico.
 *
 * Exportado para que el test pueda validarlo aisladamente.
 *
 * @param {[string|null, number]} a
 * @param {[string|null, number]} b
 * @returns {number}
 */
export function compareTuple(a, b) {
  const [ta, ia] = a;
  const [tb, ib] = b;
  if (ta === tb) return ia - ib;
  // null cursor → cualquier timestamp real es mayor. (No deberíamos llegar acá
  // porque diffEvents maneja null antes, pero defensivo.)
  if (ta === null) return -1;
  if (tb === null) return 1;
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

/**
 * Diff strict-greater por tuple. Mutación interna del cursor.
 *
 * @param {Array<{timestamp:string, type?:string, payload?:object}>} events
 * @returns {Array<{timestamp:string, type?:string, payload?:object}>}
 */
export function diffEvents(events) {
  if (!Array.isArray(events)) return [];

  // Primer call: cursor null.
  if (cursor.timestamp === null) {
    if (events.length === 0) {
      // Nada que setear todavía.
      return [];
    }
    // ADR-04 opción (a): no emitir nada, settear al último.
    const lastIdx = events.length - 1;
    cursor.timestamp = String(events[lastIdx].timestamp);
    cursor.index = lastIdx;
    return [];
  }

  // Calls subsiguientes: filtrar > cursor por tuple.
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const cmp = compareTuple([String(ev.timestamp), i], [cursor.timestamp, cursor.index]);
    if (cmp > 0) {
      out.push(ev);
    }
  }
  // Avanzar cursor al último (timestamp, index) que vimos en este batch.
  // Importante: usar el index global del array (que puede haber crecido), no
  // el index dentro de `out`. Si `out` tiene elementos, el último corresponde
  // al último event nuevo del array.
  if (out.length > 0) {
    // Encontrar el i original del último elemento de `out` (es el último que
    // pasó el filtro). Recorrimos en orden, así que es el último i visto.
    let lastI = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      const cmp = compareTuple([String(ev.timestamp), i], [cursor.timestamp, cursor.index]);
      if (cmp > 0) { lastI = i; break; }
    }
    if (lastI >= 0) {
      cursor.timestamp = String(events[lastI].timestamp);
      cursor.index = lastI;
    }
  }
  return out;
}

/**
 * Setea manualmente el cursor. Útil para reconnect SSE o reset entre sesiones.
 *
 * @param {string|null} toTimestamp
 * @param {number} toIndex
 */
export function resetCursor(toTimestamp, toIndex) {
  cursor.timestamp = toTimestamp === null ? null : String(toTimestamp);
  cursor.index = Number.isFinite(toIndex) ? toIndex : -1;
}

/**
 * Snapshot del cursor actual (para debug + tests).
 */
export function getCursor() {
  return { timestamp: cursor.timestamp, index: cursor.index };
}

/**
 * Bus global. Eventos canónicos:
 *   - 'state-update'      { detail: snapshot }   ← stateSync emite
 *   - 'avatar-clicked'    { detail: { name } }   ← avatar.js emite, panel.js consume
 *   - 'event-clicked'     { detail: { type, payload } } (fase 6)
 *   - 'ephemeral-event'   { detail: ephemeralEvent } (fase 5)
 */
export const bus = new EventTarget();
