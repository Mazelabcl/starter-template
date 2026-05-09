// dashboard/public/app-extras.js
// Sprint 2.3b — extiende el dashboard de 2.3a con tres bloques aditivos:
//   1. Timeline panel inferior con filtros, búsqueda, autoscroll y persistencia.
//   2. Modal de replay con scrubber + play/pause + reconstrucción aproximada del kanban.
//   3. Botón de exportar log (state + history + memoria) como JSON descargable.
//
// Reglas duras:
//   - NO toca app.js. NO redefine variables de UI de 2.3a.
//   - Cero dependencias. Solo APIs nativas (fetch, Blob, URL.createObjectURL, EventSource).
//   - Si los endpoints no responden o no hay datos, el módulo degrada elegantemente.
//
// Estado en memoria (objeto `tx`):
//   - events: Array<Event>   últimos N eventos cargados (history + live).
//   - filters: Set<string>   tipos de evento ocultos (default: todos visibles).
//   - search: string         substring para filtrar.
//   - collapsed: boolean     panel timeline colapsado.
//   - expanded: Set<string>  ids (timestamp+type+idx) de filas con payload abierto.
//   - replay: { open, events, idx, playing, speed, timer }
//
// El módulo se conecta a la misma SSE que 2.3a vía un EventSource propio. La
// duplicación es intencional para no acoplarse a internals de app.js.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- constantes ----------

const STORAGE = {
  collapsed: 'mz.dashboard.timeline.collapsed',
  filters:   'mz.dashboard.timeline.filters',
  search:    'mz.dashboard.timeline.search',
};

const MAX_TIMELINE_ROWS = 50;        // visibles en pantalla; el resto vive en memoria.
const MAX_EVENTS_IN_MEMORY = 2000;   // cap para no quemar RAM en sesiones largas.
const HISTORY_INITIAL_LIMIT = 200;
const HISTORY_REPLAY_LIMIT = 1000;
const HISTORY_EXPORT_LIMIT = 10000;
const REPLAY_SLOW_THRESHOLD = 2000;  // por encima de esto, mostrar spinner.

// Tipos de evento conocidos. Si llega uno desconocido, se renderiza con tipo "otro".
const EVENT_TYPES = [
  { type: 'task_started',       label: 'Tarea iniciada',       icon: 'i-task-start',    color: 'var(--accent-cyan)' },
  { type: 'task_completed',     label: 'Tarea completada',     icon: 'i-task-complete', color: 'var(--accent-green)' },
  { type: 'task_failed',        label: 'Tarea fallida',        icon: 'i-task-failed',   color: 'var(--accent-red)' },
  { type: 'agent_invoked',      label: 'Agente invocado',      icon: 'i-agent',         color: 'var(--accent-violet)' },
  { type: 'skill_invoked',      label: 'Skill invocada',       icon: 'i-skill',         color: '#a78bfa' },
  { type: 'decision_emitted',   label: 'Decisión emitida',     icon: 'i-decision',      color: 'var(--accent-yellow)' },
  { type: 'hand_off_validated', label: 'Hand-off validado',    icon: 'i-handoff',       color: 'var(--accent-cyan)' },
  { type: 'hand_off_failed',    label: 'Hand-off fallido',     icon: 'i-handoff',       color: 'var(--accent-red)' },
  { type: 'council_invoked',    label: 'Council invocado',     icon: 'i-council',       color: '#c4b5fd' },
  { type: 'image_generated',    label: 'Imagen generada',      icon: 'i-image',         color: 'var(--accent-cyan)' },
];
const EVENT_TYPE_MAP = new Map(EVENT_TYPES.map(t => [t.type, t]));

// ---------- estado ----------

const tx = {
  events: [],                       // ordenados desc (más reciente primero).
  knownKeys: new Set(),             // dedup: timestamp|type|hash(payload).
  filters: loadFilters(),           // Set<string> de tipos OCULTOS.
  search: loadSearch(),
  collapsed: loadCollapsed(),
  expanded: new Set(),
  sse: null,
  replay: {
    open: false,
    events: [],
    idx: 0,
    playing: false,
    speed: 1,
    timer: null,
    keydownHandler: null,
  },
};

// ---------- helpers de formato ----------

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  const diff = Math.max(0, now - t);
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

function fmtAbsoluteTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-419', { hour12: false });
  } catch { return iso; }
}

// Resumen de 1 línea según tipo. Defensivo: si payload no trae lo esperado,
// cae a algo legible sin crashear.
function summarizeEvent(ev) {
  const meta = EVENT_TYPE_MAP.get(ev.type);
  const label = meta ? meta.label : (ev.type || 'evento');
  const p = ev.payload || {};
  const parts = [label];
  switch (ev.type) {
    case 'task_started':
    case 'task_completed':
    case 'task_failed': {
      const who = p.agent || p.task_id || p.id;
      const what = p.title || p.task_title || p.task;
      if (who && what) parts.push(`${who} · ${what}`);
      else if (what) parts.push(what);
      else if (who) parts.push(who);
      if (ev.type === 'task_failed' && p.reason) parts.push(`(${p.reason})`);
      break;
    }
    case 'agent_invoked': {
      const who = p.agent || p.name;
      if (who) parts.push(who);
      if (p.role || p.rol_corto) parts.push(p.role || p.rol_corto);
      break;
    }
    case 'skill_invoked': {
      const who = p.skill || p.name;
      if (who) parts.push(who);
      if (p.context) parts.push(p.context);
      break;
    }
    case 'decision_emitted': {
      if (p.decision) parts.push(p.decision);
      else if (p.summary) parts.push(p.summary);
      break;
    }
    case 'hand_off_validated':
    case 'hand_off_failed': {
      const contract = p.contract || p.contract_name;
      const from = p.from_agent || p.from;
      const to = p.to_agent || p.to;
      if (contract) parts.push(contract);
      if (from && to) parts.push(`${from} → ${to}`);
      if (ev.type === 'hand_off_failed' && p.reason) parts.push(`(${p.reason})`);
      break;
    }
    case 'council_invoked': {
      if (p.voices) parts.push(`${p.voices} voces`);
      if (p.topic) parts.push(p.topic);
      break;
    }
    case 'image_generated': {
      if (p.prompt) parts.push(p.prompt.slice(0, 80));
      else if (p.path) parts.push(p.path);
      break;
    }
    default: {
      // Para tipos desconocidos, mostramos las primeras claves.
      const keys = Object.keys(p).slice(0, 2);
      if (keys.length) parts.push(keys.map(k => `${k}=${shortVal(p[k])}`).join(' '));
    }
  }
  return parts.join(': ');
}

function shortVal(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 40) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v).slice(0, 40);
}

function eventKey(ev) {
  const ts = ev.timestamp || '';
  const ty = ev.type || '';
  // hash-lite del payload para distinguir eventos del mismo timestamp+type.
  let h = 0;
  const s = JSON.stringify(ev.payload || {});
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `${ts}|${ty}|${h}`;
}

// ---------- persistencia ----------

function loadCollapsed() {
  try { return localStorage.getItem(STORAGE.collapsed) === 'true'; }
  catch { return false; }
}
function saveCollapsed(v) {
  try { localStorage.setItem(STORAGE.collapsed, v ? 'true' : 'false'); } catch {}
}
function loadFilters() {
  try {
    const raw = localStorage.getItem(STORAGE.filters);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveFilters() {
  try { localStorage.setItem(STORAGE.filters, JSON.stringify([...tx.filters])); } catch {}
}
function loadSearch() {
  try { return localStorage.getItem(STORAGE.search) || ''; } catch { return ''; }
}
function saveSearch(v) {
  try { localStorage.setItem(STORAGE.search, v || ''); } catch {}
}

// ---------- ingest de eventos ----------

function ingest(events, { prepend = false } = {}) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  let added = 0;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const k = eventKey(ev);
    if (tx.knownKeys.has(k)) continue;
    tx.knownKeys.add(k);
    if (prepend) tx.events.unshift(ev);
    else tx.events.push(ev);
    added += 1;
  }
  // Mantener orden desc (más reciente primero).
  tx.events.sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return tb - ta;
  });
  // Cap de memoria.
  if (tx.events.length > MAX_EVENTS_IN_MEMORY) {
    const dropped = tx.events.splice(MAX_EVENTS_IN_MEMORY);
    for (const ev of dropped) tx.knownKeys.delete(eventKey(ev));
  }
  return added;
}

// ---------- bootstrap del timeline ----------

async function bootstrapTimeline() {
  renderFilterChips();
  renderTimeline();

  // Carga inicial desde history.
  try {
    const r = await fetch(`/api/history?limit=${HISTORY_INITIAL_LIMIT}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      ingest(j.events || []);
    }
  } catch (e) {
    console.warn('[2.3b] no pude cargar /api/history inicial:', e.message);
  }

  // Mezclar también eventos del state actual (los recientes en memoria).
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.ok) {
      const s = await r.json();
      ingest(s.events || []);
    }
  } catch {}

  renderTimeline();
  connectSSE();
}

function connectSSE() {
  // SSE propio del módulo extras. Si app.js ya tiene uno, son independientes.
  try {
    if (tx.sse) try { tx.sse.close(); } catch {}
    tx.sse = new EventSource('/api/events');
    tx.sse.addEventListener('state', () => refreshFromState());
    tx.sse.addEventListener('error', () => {
      // Reintenta automático del navegador. Si falla 3 veces seguidas, caemos a polling.
      // Para no duplicar lógica con app.js, dejamos que el navegador maneje retry de SSE.
    });
  } catch {
    // Sin SSE: polling cada 4s (más conservador que 2.3a, no compite).
    setInterval(refreshFromState, 4000);
  }
}

let refreshing = false;
async function refreshFromState() {
  if (refreshing) return;
  refreshing = true;
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.ok) {
      const s = await r.json();
      const added = ingest(s.events || []);
      if (added > 0) renderTimeline();
    }
  } catch {} finally {
    refreshing = false;
  }
}

// ---------- render del timeline ----------

function renderFilterChips() {
  const wrap = $('[data-timeline-filters]');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const t of EVENT_TYPES) {
    const active = !tx.filters.has(t.type);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'timeline-filter';
    chip.dataset.type = t.type;
    chip.dataset.active = String(active);
    chip.setAttribute('aria-pressed', String(active));
    chip.title = `${active ? 'Ocultar' : 'Mostrar'} ${t.label}`;
    chip.innerHTML = `
      <span class="timeline-filter-dot" style="background:${t.color}"></span>
      <span>${escapeHtml(t.label)}</span>
    `;
    chip.addEventListener('click', () => toggleFilter(t.type));
    wrap.appendChild(chip);
  }
}

function toggleFilter(type) {
  if (tx.filters.has(type)) tx.filters.delete(type);
  else tx.filters.add(type);
  saveFilters();
  renderFilterChips();
  renderTimeline();
}

function applyFilters(events) {
  const q = (tx.search || '').trim().toLowerCase();
  let hidden = 0;
  const visible = [];
  for (const ev of events) {
    if (tx.filters.has(ev.type)) { hidden += 1; continue; }
    if (q) {
      const summary = summarizeEvent(ev).toLowerCase();
      const payloadStr = JSON.stringify(ev.payload || {}).toLowerCase();
      if (!summary.includes(q) && !payloadStr.includes(q)) {
        hidden += 1;
        continue;
      }
    }
    visible.push(ev);
  }
  return { visible, hidden };
}

function renderTimeline() {
  const list = $('[data-timeline-list]');
  const empty = $('[data-timeline-empty]');
  const countEl = $('[data-timeline-count]');
  const filteredEl = $('[data-timeline-filtered]');
  if (!list) return;

  const { visible, hidden } = applyFilters(tx.events);

  // Contador total (sin filtrar) — útil para Aldo saber cuánto hay.
  if (countEl) countEl.textContent = `${tx.events.length} eventos`;
  if (filteredEl) {
    if (hidden > 0) {
      filteredEl.hidden = false;
      filteredEl.textContent = `· ${hidden} filtrados`;
    } else {
      filteredEl.hidden = true;
    }
  }

  // Estado vacío.
  if (visible.length === 0) {
    list.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.textContent = tx.events.length === 0
        ? 'Sin eventos aún. Lanza una tarea para empezar a verla aquí.'
        : 'Ningún evento coincide con los filtros activos.';
    }
    return;
  }
  if (empty) empty.hidden = true;

  // Solo render de los primeros MAX_TIMELINE_ROWS — el resto vive en memoria
  // y se ve cuando el usuario scrollea (la lista actual basta para no
  // virtualizar de verdad: 50 rows DOM es trivial). Documentado en README.
  const slice = visible.slice(0, MAX_TIMELINE_ROWS);

  // Dedup contra DOM existente: comparamos por data-key. Esto da animación
  // slide-in solo a las filas realmente nuevas.
  const wantedKeys = new Set();
  const fragment = document.createDocumentFragment();
  for (const ev of slice) {
    const k = eventKey(ev);
    wantedKeys.add(k);
    let row = list.querySelector(`[data-timeline-row][data-key="${cssEscape(k)}"]`);
    if (!row) {
      row = buildTimelineRow(ev, k);
    } else {
      // Actualizar tiempo relativo.
      const timeEl = row.querySelector('.timeline-row-time');
      if (timeEl) timeEl.textContent = fmtRelative(ev.timestamp);
    }
    fragment.appendChild(row);
  }

  // Reemplazar contenido respetando los nodos reusados.
  list.innerHTML = '';
  list.appendChild(fragment);
}

function buildTimelineRow(ev, key) {
  const meta = EVENT_TYPE_MAP.get(ev.type) || { type: ev.type, label: ev.type || 'evento', icon: 'i-clock' };
  const row = document.createElement('li');
  row.className = 'timeline-row';
  row.dataset.timelineRow = '';
  row.dataset.key = key;
  row.dataset.type = ev.type || 'unknown';
  row.dataset.expanded = tx.expanded.has(key) ? 'true' : 'false';
  row.setAttribute('role', 'listitem');
  row.tabIndex = 0;

  const summary = summarizeEvent(ev);
  const absolute = fmtAbsoluteTime(ev.timestamp);
  row.innerHTML = `
    <span class="timeline-row-time" title="${escapeHtml(absolute)}">${escapeHtml(fmtRelative(ev.timestamp))}</span>
    <span class="timeline-row-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><use href="/icons/sprite.svg#${escapeHtml(meta.icon)}"/></svg></span>
    <span class="timeline-row-text" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
    <span class="timeline-row-type">${escapeHtml(ev.type || 'unknown')}</span>
  `;

  if (tx.expanded.has(key)) {
    appendPayload(row, ev);
  }

  const onToggle = () => {
    const isExpanded = tx.expanded.has(key);
    if (isExpanded) {
      tx.expanded.delete(key);
      row.dataset.expanded = 'false';
      const pl = row.querySelector('.timeline-row-payload');
      if (pl) pl.remove();
    } else {
      tx.expanded.add(key);
      row.dataset.expanded = 'true';
      appendPayload(row, ev);
    }
  };
  row.addEventListener('click', onToggle);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  });
  return row;
}

function appendPayload(row, ev) {
  const div = document.createElement('div');
  div.className = 'timeline-row-payload';
  let json;
  try { json = JSON.stringify(ev.payload ?? {}, null, 2); }
  catch { json = String(ev.payload); }
  div.textContent = `[${fmtAbsoluteTime(ev.timestamp)}] ${ev.type}\n${json}`;
  row.appendChild(div);
}

function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  return String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~|])/g, '\\$1');
}

// ---------- colapsar / expandir panel ----------

function applyCollapsedState() {
  const panel = $('[data-timeline]');
  if (!panel) return;
  panel.dataset.collapsed = tx.collapsed ? 'true' : 'false';
  const btn = panel.querySelector('.timeline-collapse');
  if (btn) btn.setAttribute('aria-expanded', tx.collapsed ? 'false' : 'true');
}

function toggleTimelineCollapse() {
  tx.collapsed = !tx.collapsed;
  saveCollapsed(tx.collapsed);
  applyCollapsedState();
}

// ---------- búsqueda ----------

function bindSearch() {
  const input = $('[data-timeline-search]');
  if (!input) return;
  input.value = tx.search;
  let debounce = null;
  input.addEventListener('input', () => {
    tx.search = input.value;
    saveSearch(tx.search);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(renderTimeline, 80);
  });
}

// Tick para refrescar tiempos relativos cada 10s sin re-renderizar todo.
function tickRelativeTimes() {
  const list = $('[data-timeline-list]');
  if (!list) return;
  const rows = $$('[data-timeline-row]', list);
  for (const row of rows) {
    const key = row.dataset.key;
    // Buscar el evento que coincide. tx.events es chico (<= 2000) y MAX_TIMELINE_ROWS
    // hace que esto sea barato. No lazy-map porque las filas cambian cada SSE.
    const ev = tx.events.find(e => eventKey(e) === key);
    if (!ev) continue;
    const timeEl = row.querySelector('.timeline-row-time');
    if (timeEl) timeEl.textContent = fmtRelative(ev.timestamp);
  }
}
setInterval(tickRelativeTimes, 10000);

// ============================================================
// REPLAY MODAL
// ============================================================

function openReplay() {
  const modal = $('[data-replay-modal]');
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  // Reset state UI.
  const loading = $('[data-replay-loading]');
  const empty = $('[data-replay-empty]');
  const snap = $('[data-replay-snapshot]');
  const foot = $('[data-replay-foot]');
  if (loading) loading.hidden = false;
  if (empty) empty.hidden = true;
  if (snap) snap.hidden = true;
  if (foot) foot.hidden = true;

  tx.replay.open = true;
  tx.replay.idx = 0;
  tx.replay.playing = false;
  tx.replay.speed = 1;
  if (tx.replay.timer) { clearInterval(tx.replay.timer); tx.replay.timer = null; }

  // Esc + backdrop close.
  tx.replay.keydownHandler = (e) => { if (e.key === 'Escape') closeReplay(); };
  document.addEventListener('keydown', tx.replay.keydownHandler);

  loadReplayHistory();
}

function closeReplay() {
  const modal = $('[data-replay-modal]');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  tx.replay.open = false;
  tx.replay.playing = false;
  if (tx.replay.timer) { clearInterval(tx.replay.timer); tx.replay.timer = null; }
  if (tx.replay.keydownHandler) {
    document.removeEventListener('keydown', tx.replay.keydownHandler);
    tx.replay.keydownHandler = null;
  }
}

async function loadReplayHistory() {
  let events = [];
  try {
    const r = await fetch(`/api/history?limit=${HISTORY_REPLAY_LIMIT}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      events = Array.isArray(j.events) ? j.events.slice() : [];
    }
  } catch (e) {
    console.warn('[2.3b] replay no pudo cargar history:', e.message);
  }

  // Orden ascendente por timestamp para reproducir cronológicamente.
  events.sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return ta - tb;
  });

  tx.replay.events = events;
  const loading = $('[data-replay-loading]');
  if (loading) loading.hidden = true;

  if (events.length === 0) {
    const empty = $('[data-replay-empty]');
    if (empty) empty.hidden = false;
    return;
  }

  // Para >REPLAY_SLOW_THRESHOLD eventos, ya advertimos al usuario via spinner inicial,
  // pero la primera reconstrucción es O(N) y se hace una sola vez por click en scrubber.
  // Si se ve lento, el límite a HISTORY_REPLAY_LIMIT (1000) ya nos protege.

  const snap = $('[data-replay-snapshot]');
  const foot = $('[data-replay-foot]');
  if (snap) snap.hidden = false;
  if (foot) foot.hidden = false;

  const scrubber = $('[data-replay-scrubber]');
  if (scrubber) {
    scrubber.min = 0;
    scrubber.max = events.length - 1;
    scrubber.value = 0;
  }

  const startEl = $('[data-replay-time-start]');
  const endEl = $('[data-replay-time-end]');
  if (startEl) startEl.textContent = fmtAbsoluteTime(events[0].timestamp);
  if (endEl) endEl.textContent = fmtAbsoluteTime(events[events.length - 1].timestamp);

  tx.replay.idx = 0;
  renderReplayAt(0);
}

// Reconstrucción del kanban en el momento `idx`:
// aplicamos los eventos [0..idx] sobre un mapa de tareas. El kanban resultante
// es aproximado: derivamos status, agente y título de los payloads.
//
// Si un payload no trae info suficiente, la tarea queda con valores parciales
// pero el render no falla. Documentado: la reconstrucción NO replica píxel a
// píxel el state.json original — es una vista "qué pasó" para revisión.
function rebuildSnapshot(events, upTo) {
  const tasks = new Map();
  for (let i = 0; i <= upTo && i < events.length; i++) {
    const ev = events[i];
    const p = ev.payload || {};
    const id = p.id || p.task_id || p.task || null;
    if (!id) continue;
    const cur = tasks.get(id) || {
      id,
      title: p.title || p.task_title || id,
      agent: p.agent || '—',
      status: 'queued',
      started_at: null,
      ended_at: null,
    };
    if (p.title) cur.title = p.title;
    if (p.task_title) cur.title = p.task_title;
    if (p.agent) cur.agent = p.agent;
    switch (ev.type) {
      case 'task_started':
        cur.status = 'running';
        cur.started_at = ev.timestamp;
        break;
      case 'task_completed':
        cur.status = 'completed';
        cur.ended_at = ev.timestamp;
        break;
      case 'task_failed':
        cur.status = 'failed';
        cur.ended_at = ev.timestamp;
        cur.failure_reason = p.reason || p.failure_reason || null;
        break;
    }
    tasks.set(id, cur);
  }
  return Array.from(tasks.values());
}

function renderReplayAt(idx) {
  const events = tx.replay.events;
  if (!events || events.length === 0) return;
  idx = Math.max(0, Math.min(idx, events.length - 1));
  tx.replay.idx = idx;

  const ev = events[idx];
  const tasks = rebuildSnapshot(events, idx);
  const buckets = { queued: [], running: [], completed: [], failed: [] };
  for (const t of tasks) {
    if (buckets[t.status]) buckets[t.status].push(t);
  }

  // Render cada columna.
  for (const status of Object.keys(buckets)) {
    const body = $(`[data-replay-col-body="${status}"]`);
    const cnt = $(`[data-replay-col-count="${status}"]`);
    if (!body) continue;
    body.innerHTML = '';
    if (cnt) cnt.textContent = String(buckets[status].length);
    for (const t of buckets[status]) {
      const div = document.createElement('div');
      div.className = 'replay-mini-task';
      const failPart = t.failure_reason ? `<small style="color:var(--accent-red);">${escapeHtml(t.failure_reason)}</small>` : '';
      div.innerHTML = `
        <div>${escapeHtml(t.title || t.id)}</div>
        <small>${escapeHtml(t.agent || '—')}</small>
        ${failPart}
      `;
      body.appendChild(div);
    }
  }

  // Header del snapshot.
  const tEl = $('[data-replay-snapshot-time]');
  const pEl = $('[data-replay-snapshot-pos]');
  if (tEl) tEl.textContent = fmtAbsoluteTime(ev.timestamp);
  if (pEl) pEl.textContent = `${idx + 1}/${events.length}`;

  // Evento actual (foot).
  const curEl = $('[data-replay-current-event]');
  if (curEl) {
    let payloadStr = '';
    try { payloadStr = JSON.stringify(ev.payload ?? {}, null, 2); }
    catch { payloadStr = String(ev.payload); }
    curEl.textContent = `${ev.type}\n${payloadStr}`;
  }

  // Scrubber.
  const scrubber = $('[data-replay-scrubber]');
  if (scrubber && Number(scrubber.value) !== idx) scrubber.value = String(idx);
}

function bindReplayControls() {
  const scrubber = $('[data-replay-scrubber]');
  if (scrubber) {
    scrubber.addEventListener('input', () => {
      const idx = parseInt(scrubber.value, 10) || 0;
      renderReplayAt(idx);
    });
  }
  const speed = $('[data-replay-speed]');
  if (speed) {
    speed.addEventListener('change', () => {
      tx.replay.speed = parseFloat(speed.value) || 1;
      if (tx.replay.playing) {
        startReplayPlayback();
      }
    });
  }
}

function startReplayPlayback() {
  if (tx.replay.timer) { clearInterval(tx.replay.timer); tx.replay.timer = null; }
  // Avance = 1 evento por (1000/speed) ms. A 5x → 200ms por evento.
  const stepMs = Math.max(60, 1000 / tx.replay.speed);
  tx.replay.timer = setInterval(() => {
    if (!tx.replay.open) { stopReplayPlayback(); return; }
    if (tx.replay.idx >= tx.replay.events.length - 1) {
      stopReplayPlayback();
      return;
    }
    renderReplayAt(tx.replay.idx + 1);
  }, stepMs);
}

function stopReplayPlayback() {
  if (tx.replay.timer) { clearInterval(tx.replay.timer); tx.replay.timer = null; }
  tx.replay.playing = false;
  const btn = $('[data-replay-play]');
  if (btn) btn.textContent = 'play';
}

function toggleReplayPlay() {
  if (!tx.replay.events.length) return;
  tx.replay.playing = !tx.replay.playing;
  const btn = $('[data-replay-play]');
  if (btn) btn.textContent = tx.replay.playing ? 'pause' : 'play';
  if (tx.replay.playing) startReplayPlayback();
  else stopReplayPlayback();
}

// ============================================================
// EXPORT LOG
// ============================================================

async function exportLog() {
  const fb = $('[data-export-feedback]');
  if (fb) { fb.hidden = false; fb.textContent = 'preparando…'; fb.style.color = 'var(--text-muted)'; }
  try {
    const [hist, state] = await Promise.all([
      fetch(`/api/history?limit=${HISTORY_EXPORT_LIMIT}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
      fetch('/api/state', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const memory = state && state.derived && state.derived.memory_snapshot ? state.derived.memory_snapshot : null;
    const projectProfile = memory && memory.has_profile ? {
      project_type: memory.project_type || null,
      description: memory.description || null,
      tags: Array.isArray(memory.tags) ? memory.tags : [],
    } : null;
    const activeTeam = memory && Array.isArray(memory.active_team) ? memory.active_team : [];

    const bundle = {
      exported_at: new Date().toISOString(),
      session_id: state ? state.session_id : null,
      project_profile: projectProfile,
      active_team: activeTeam,
      current_state: state || null,
      history: Array.isArray(hist.events) ? hist.events : [],
    };

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mazelab-dashboard-log-${ts}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Liberar el object URL después de un tick para que la descarga arranque.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (fb) {
      fb.hidden = false;
      fb.style.color = 'var(--accent-green)';
      fb.textContent = `log exportado: ${filename}`;
      setTimeout(() => { if (fb) fb.hidden = true; }, 5000);
    }
  } catch (e) {
    if (fb) {
      fb.hidden = false;
      fb.style.color = 'var(--accent-red)';
      fb.textContent = `error al exportar: ${e.message}`;
    }
  }
}

// ============================================================
// EVENT BINDING
// ============================================================

function bindActions() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    switch (action) {
      case 'toggle-timeline':       toggleTimelineCollapse(); break;
      case 'export-log':            exportLog(); break;
      case 'open-replay':           openReplay(); break;
      case 'close-replay':          closeReplay(); break;
      case 'replay-play-toggle':    toggleReplayPlay(); break;
      case 'replay-step-back':      renderReplayAt(tx.replay.idx - 1); break;
      case 'replay-step-fwd':       renderReplayAt(tx.replay.idx + 1); break;
      case 'replay-restart':        renderReplayAt(0); break;
      case 'replay-end':            renderReplayAt(tx.replay.events.length - 1); break;
    }
  });

  // Click en backdrop cierra el modal.
  const backdrop = $('[data-replay-backdrop]');
  if (backdrop) backdrop.addEventListener('click', closeReplay);
}

// ============================================================
// BOOTSTRAP
// ============================================================

(function init() {
  applyCollapsedState();
  bindActions();
  bindSearch();
  bindReplayControls();
  bootstrapTimeline();
})();
