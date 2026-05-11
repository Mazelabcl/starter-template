// dashboard/public/engine/stateSync.js
//
// Cliente del backend de estado. Único módulo del engine que toca `fetch` y
// `EventSource`. Spec sección 2 + ADR-04.
//
// Flujo:
//   1. GET /api/state inicial → emite 'state-update' por bus con el snapshot.
//   2. Abre EventSource('/api/events').
//   3. En cada evento 'state' del SSE → re-fetch /api/state → emite 'state-update'.
//   4. Backoff exponencial 1s → 2s → 4s → 8s (cap 8s) si la conexión cae.
//
// Exporta `{ getSnapshot, disconnect }`. El último snapshot exitoso se cachea
// en memoria — útil para que un suscriptor que se montó tarde pueda sincronizar
// (ver `bus` en eventBus.js).

import { bus } from './eventBus.js';

const BACKOFF_STEPS = [1000, 2000, 4000, 8000];
const STATE_URL = '/api/state';
const EVENTS_URL = '/api/events';

let latestSnapshot = null;
let eventSource = null;
let disconnected = false;
let reconnectAttempt = 0;
let reconnectTimer = null;

/**
 * Arranca el state sync. Idempotente: llamarlo dos veces no abre dos SSE.
 *
 * @returns {{ getSnapshot: () => object|null, disconnect: () => void }}
 */
export function startStateSync() {
  if (eventSource && !disconnected) {
    return apiHandle();
  }
  disconnected = false;
  reconnectAttempt = 0;

  // Fetch inicial — no bloqueamos en errores, solo logueamos y reintentamos
  // por backoff. Si nunca llega el initial, el primer 'state' del SSE va a
  // disparar un fetch que rellena el snapshot.
  refetchAndEmit().catch(err => {
    console.warn('[stateSync] fetch inicial falló, reintentando vía SSE:', err && err.message ? err.message : err);
  });

  openSSE();
  return apiHandle();
}

function apiHandle() {
  return {
    getSnapshot: () => latestSnapshot,
    disconnect,
  };
}

/**
 * Devuelve el último snapshot cacheado, o null si todavía no llegó ninguno.
 * Útil para suscriptores tardíos al bus que pueden perder el primer dispatch.
 * @returns {object|null}
 */
export function getCachedSnapshot() {
  return latestSnapshot;
}

function disconnect() {
  disconnected = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    try { eventSource.close(); } catch { /* ignore */ }
    eventSource = null;
  }
}

function openSSE() {
  if (disconnected) return;
  if (typeof EventSource === 'undefined') {
    console.warn('[stateSync] EventSource no disponible en este runtime; el dashboard quedará sin updates SSE.');
    return;
  }
  try {
    eventSource = new EventSource(EVENTS_URL);
  } catch (e) {
    console.warn('[stateSync] no pude abrir EventSource:', e && e.message ? e.message : e);
    scheduleReconnect();
    return;
  }

  eventSource.addEventListener('open', () => {
    // Conexión OK — reset backoff.
    reconnectAttempt = 0;
  });

  eventSource.addEventListener('state', () => {
    refetchAndEmit().catch(err => {
      console.warn('[stateSync] re-fetch falló:', err && err.message ? err.message : err);
    });
  });

  eventSource.addEventListener('hello', () => {
    // Greeting del server — no requiere fetch.
  });

  eventSource.addEventListener('error', () => {
    // EventSource auto-reintenta, pero queremos backoff explícito + cierre
    // controlado para evitar tormentas si el server está caído.
    if (eventSource && eventSource.readyState === 2 /* CLOSED */) {
      scheduleReconnect();
    }
    // Si readyState === 0 (CONNECTING) el browser ya está reintentando. No hacemos nada.
  });
}

function scheduleReconnect() {
  if (disconnected) return;
  if (reconnectTimer) return;
  const delay = BACKOFF_STEPS[Math.min(reconnectAttempt, BACKOFF_STEPS.length - 1)];
  reconnectAttempt += 1;
  console.log(`[stateSync] reconectando en ${delay}ms (intento ${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (eventSource) {
      try { eventSource.close(); } catch { /* ignore */ }
      eventSource = null;
    }
    openSSE();
    // Aprovechamos el reconnect para refrescar snapshot también.
    refetchAndEmit().catch(() => { /* ya logueado */ });
  }, delay);
}

async function refetchAndEmit() {
  const res = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`GET ${STATE_URL} → HTTP ${res.status}`);
  const snap = await res.json();
  latestSnapshot = snap;
  try {
    bus.dispatchEvent(new CustomEvent('state-update', { detail: snap }));
  } catch (e) {
    console.debug('[stateSync] dispatch state-update falló:', e && e.message ? e.message : e);
  }
}
