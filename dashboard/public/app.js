// dashboard/public/app.js
// Cliente vanilla del dashboard — Sprint 2.3a (kanban + métricas + sidebar).
//
// Responsabilidades 2.3a:
//   1. Conectar a SSE /api/events. Si falla 3 veces seguidas, cae a polling /api/state cada 2s.
//   2. Render incremental de tarjetas: identificamos cada tarea por data-task-id y
//      actualizamos solo lo que cambió (status, tiempo, tokens, archivos visibles).
//      Las secciones planas (header, sidebar) se re-renderizan completas — su DOM es chico.
//   3. Persistir flags de UI en localStorage (hoy: solo sidebar abierto/cerrado).
//
// Sprint 2.3b agregará: panel inferior con timeline, modal de replay, export-log.
// Esos hooks NO viven acá — 2.3b inserta su propio módulo. Las funciones del kanban
// y métricas que están acá no necesitan tocarse para que 2.3b funcione.
//
// Diseño: estado en `ui` global mínimo, render funcional por sección.

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- estado en memoria ----------
const ui = {
  snapshot: null,             // último /api/state
  conn: 'init',               // init | ok | poll | down
  sseFailures: 0,
  pollTimer: null,
  reconnectTimer: null,
  fileToggles: new Map(),     // task.id -> bool (archivos expandidos)
  uptimeBaseline: null,       // ts del último fetch para drift del contador uptime
};

const STORAGE_KEYS = {
  sidebar: 'mz.dashboard.sidebar',
};

// ---------- helpers de formato ----------
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('es-419', { hour12: false });
  } catch { return iso; }
}
function fmtDuration(ms) {
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function fmtUptime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0s';
  return fmtDuration(seconds * 1000);
}
function fmtTokens(n) {
  if (!isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function projectIconLetters(type) {
  const map = { research: 'rs', build: 'bd', content: 'ct', business: 'bz', personal: 'ps', mixed: 'mx' };
  return map[type] || '··';
}

// ---------- conexión / fetch ----------
async function fetchState() {
  const r = await fetch('/api/state', { cache: 'no-store' });
  if (!r.ok) throw new Error(`/api/state ${r.status}`);
  return r.json();
}

async function refresh() {
  try {
    const snap = await fetchState();
    ui.snapshot = snap;
    ui.uptimeBaseline = Date.now();
    setConn(ui.conn === 'down' ? 'ok' : ui.conn);
    render();
  } catch (e) {
    setConn('down');
    scheduleReconnect();
  }
}

// ---------- conexión SSE ----------
let eventSource = null;

function connectSSE() {
  if (eventSource) {
    try { eventSource.close(); } catch { /* ignore */ }
  }
  setConn('init');
  try {
    eventSource = new EventSource('/api/events');
  } catch (e) {
    fallbackToPolling();
    return;
  }
  eventSource.addEventListener('open',  () => { ui.sseFailures = 0; setConn('ok'); });
  eventSource.addEventListener('hello', () => { ui.sseFailures = 0; setConn('ok'); refresh(); });
  eventSource.addEventListener('state', () => { refresh(); });
  eventSource.addEventListener('error', () => {
    ui.sseFailures += 1;
    // Tras 3 fallos consecutivos, cierro y caigo a polling.
    if (ui.sseFailures >= 3) {
      try { eventSource.close(); } catch {}
      eventSource = null;
      fallbackToPolling();
    } else {
      setConn('down');
      // El navegador reintenta SSE solo; nada que hacer hasta que abra o falle final.
    }
  });
}

function fallbackToPolling() {
  setConn('poll');
  if (ui.pollTimer) clearInterval(ui.pollTimer);
  ui.pollTimer = setInterval(refresh, 2000);
  // Igual intentamos reabrir SSE cada 30s para volver al modo bueno.
  setTimeout(() => {
    if (ui.conn === 'poll') {
      ui.sseFailures = 0;
      connectSSE();
    }
  }, 30000);
}

function scheduleReconnect() {
  if (ui.reconnectTimer) return;
  ui.reconnectTimer = setTimeout(() => {
    ui.reconnectTimer = null;
    if (ui.conn === 'down') {
      ui.sseFailures = 0;
      connectSSE();
      refresh();
    }
  }, 5000);
}

function setConn(state) {
  if (ui.conn === state) return;
  ui.conn = state;
  const el = $('#conn-indicator');
  if (!el) return;
  el.classList.remove('conn-init', 'conn-ok', 'conn-poll', 'conn-down');
  el.classList.add(`conn-${state}`);
  const labels = {
    init: 'conectando…',
    ok:   'SSE en vivo',
    poll: 'polling 2s',
    down: 'servidor caído, reintentando…',
  };
  $('[data-slot="conn-label"]', el).textContent = labels[state] || state;
}

// ---------- render principal ----------
function render() {
  const s = ui.snapshot;
  if (!s) return;

  // Banner vacío: solo cuando no hay actividad real.
  const isEmpty =
    (!s.active_tasks || s.active_tasks.length === 0) &&
    (!s.events || s.events.length === 0) &&
    (s.metrics?.total_tokens_session ?? 0) === 0;
  document.body.dataset.empty = isEmpty ? 'true' : 'false';
  $('#empty-banner').hidden = !isEmpty;

  renderProjectBanner(s);
  renderMetrics(s);
  renderSprint(s);
  renderSkills(s);
  renderTeam(s);
  renderContracts(s);
  renderColumns(s);
  renderUptime(s);
}

function renderProjectBanner(s) {
  const mem = s.derived?.memory_snapshot || {};
  const type = mem.project_type || null;
  const hasProfile = mem.has_profile === true;
  const desc = hasProfile
    ? (mem.description || '(perfil sin descripción)')
    : 'proyecto sin perfil — corre /kickoff para empezar';
  $('[data-slot="project-icon"]').textContent = projectIconLetters(type);
  $('[data-slot="project-icon"]').dataset.type = type || '';
  $('[data-slot="project-desc"]').textContent = desc;

  const tags = Array.isArray(mem.tags) ? mem.tags : [];
  const tagsEl = $('[data-slot="project-tags"]');
  tagsEl.innerHTML = '';
  for (const tag of tags.slice(0, 4)) {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = tag;
    tagsEl.appendChild(span);
  }
}

function renderMetrics(s) {
  const m = s.metrics || {};
  $('[data-slot="metric-tokens"]').textContent   = fmtTokens(m.total_tokens_session || 0);
  $('[data-slot="metric-done"]').textContent     = m.tasks_completed || 0;
  $('[data-slot="metric-failed"]').textContent   = m.tasks_failed || 0;
  $('[data-slot="metric-councils"]').textContent = m.councils_invoked || 0;
  $('[data-slot="metric-images"]').textContent   = m.images_generated || 0;
}

function renderUptime(s) {
  const up = s.derived?.uptime_seconds ?? 0;
  $('[data-slot="metric-uptime"]').textContent = fmtUptime(up);
}

function renderSprint(s) {
  const sp = s.current_sprint || { number: 0, objective: '(sin sprint declarado)' };
  const hasSprint = sp.number && sp.number > 0;
  $('[data-slot="sprint-num"]').textContent = hasSprint ? `Sprint #${sp.number}` : 'ningún sprint activo';
  $('[data-slot="sprint-objective"]').textContent = sp.objective || '(sin objetivo)';

  // Progreso aproximado: completed+failed sobre total.
  const tasks = s.active_tasks || [];
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'completed').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const pending = tasks.filter(t => t.status === 'queued' || t.status === 'running').length;
  const pct = total === 0 ? 0 : Math.round(((done + failed) / total) * 100);

  $('[data-slot="sprint-pending"]').textContent = `${pending} pendientes`;
  $('[data-slot="sprint-progress-fill"]').style.width = `${pct}%`;
  $('[data-slot="sprint-progressbar"]').setAttribute('aria-valuenow', String(pct));
  $('[data-slot="sprint-stats"]').textContent = `${done}/${total} tareas · ${pct}%`;
}

function renderSkills(s) {
  const skills = s.active_skills || [];
  const wrap = $('[data-slot="skills"]');
  wrap.innerHTML = '';
  if (skills.length === 0) {
    wrap.innerHTML = '<span class="chip chip-empty">ninguna activa</span>';
    return;
  }
  for (const sk of skills) {
    const span = document.createElement('span');
    span.className = 'chip chip-skill';
    span.textContent = sk;
    span.title = `Skill: ${sk}`;
    span.tabIndex = 0;
    span.setAttribute('role', 'listitem');
    wrap.appendChild(span);
  }
}

function renderTeam(s) {
  const list = $('[data-slot="team"]');
  list.innerHTML = '';
  // 2.3a: leemos directamente del snapshot.derived.memory_snapshot.active_team.
  // memory.summarize() lo expone de forma aditiva sin romper el contrato anterior.
  const mem = s.derived?.memory_snapshot || {};
  const agents = Array.isArray(mem.active_team) ? mem.active_team : [];

  if (agents.length === 0) {
    list.innerHTML = '<li class="team-empty">sin agentes registrados</li>';
    return;
  }

  // Más usados primero, después por nombre alfabético.
  const sorted = agents.slice().sort((a, b) => {
    const ai = a.total_invocaciones ?? 0;
    const bi = b.total_invocaciones ?? 0;
    if (ai !== bi) return bi - ai;
    return String(a.name).localeCompare(String(b.name));
  });

  for (const a of sorted) {
    const li = document.createElement('li');
    li.className = 'team-item';
    li.innerHTML = `
      <div class="team-item-name" title="${escapeHtml(a.rol_corto || '')}">${escapeHtml(a.name)}</div>
      <div class="team-item-meta">
        <span title="Último uso">${escapeHtml(fmtTime(a.ultimo_uso))}</span>
        <span title="Total de invocaciones">${a.total_invocaciones ?? 0} usos</span>
      </div>
    `;
    list.appendChild(li);
  }
}

function renderContracts(s) {
  const list = $('[data-slot="contracts"]');
  const contracts = s.derived?.declared_contracts || [];
  list.innerHTML = '';
  if (contracts.length === 0) {
    list.innerHTML = '<li class="contract-empty">sin contratos en contracts/declared</li>';
    return;
  }
  for (const c of contracts) {
    const li = document.createElement('li');
    li.textContent = c;
    list.appendChild(li);
  }
}

// ---------- columnas (kanban) — render incremental por id ----------
//
// Estrategia:
//   1. Agrupamos active_tasks por status.
//   2. Para cada columna: marcamos los DOM nodes existentes vivos vs muertos.
//   3. Reutilizamos los vivos (actualizando contenido), creamos los nuevos,
//      eliminamos los muertos.
//   4. Esto evita parpadeo y respeta el animate-in solo en cards realmente nuevas.

function renderColumns(s) {
  const tasks = s.active_tasks || [];
  const buckets = { queued: [], running: [], completed: [], failed: [] };
  for (const t of tasks) {
    if (buckets[t.status]) buckets[t.status].push(t);
  }

  for (const status of Object.keys(buckets)) {
    const col = $(`[data-slot="col-${status}"]`);
    const count = $(`[data-slot="count-${status}"]`);
    count.textContent = buckets[status].length;

    // Orden: completed/failed más recientes primero; queued/running por started_at asc.
    const sorted = buckets[status].slice().sort((a, b) => {
      const ta = new Date(a.started_at || 0).getTime();
      const tb = new Date(b.started_at || 0).getTime();
      return (status === 'completed' || status === 'failed') ? tb - ta : ta - tb;
    });

    upsertCards(col, sorted);
  }
}

function upsertCards(container, tasks) {
  const wantedIds = new Set(tasks.map(t => String(t.id)));
  // 1. Eliminar las tarjetas que ya no aplican a esta columna.
  $$('.task', container).forEach(card => {
    if (!wantedIds.has(card.dataset.taskId)) card.remove();
  });
  // 2. Reordenar / insertar / actualizar.
  let prev = null;
  for (const t of tasks) {
    const id = String(t.id);
    let card = container.querySelector(`.task[data-task-id="${cssEscape(id)}"]`);
    if (!card) {
      card = buildTaskCard(t);
    } else {
      updateTaskCard(card, t);
    }
    // Posicionarla justo después de prev (o al inicio).
    if (prev) {
      if (card.previousElementSibling !== prev) prev.after(card);
    } else {
      if (container.firstElementChild !== card) container.prepend(card);
    }
    prev = card;
  }
}

// CSS.escape no está garantizado en navegadores muy viejos; nos hace falta para
// querySelector con ids arbitrarios (que pueden incluir dots o slashes).
function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  return String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function buildTaskCard(t) {
  const div = document.createElement('article');
  div.className = 'task';
  div.dataset.taskId = String(t.id);
  div.setAttribute('role', 'group');
  div.setAttribute('tabindex', '0');
  div.innerHTML = `
    <h3 class="task-title" data-slot="title"></h3>
    <div class="task-agent" data-slot="agent"></div>
    <span class="task-skill" data-slot="skill" hidden></span>
    <ul class="task-files" data-slot="files" aria-label="Archivos en uso"></ul>
    <button type="button" class="task-files-toggle" data-slot="files-toggle" hidden></button>
    <div class="task-fail-msg" role="alert" data-slot="fail-reason" hidden></div>
    <div class="task-meta">
      <span data-slot="elapsed" title="Tiempo transcurrido">—</span>
      <span data-slot="tokens" title="Tokens estimados">0 tk</span>
    </div>
  `;
  // Listener delegado al toggle de archivos.
  const toggleBtn = div.querySelector('[data-slot="files-toggle"]');
  toggleBtn.addEventListener('click', () => {
    const cur = ui.fileToggles.get(t.id) === true;
    ui.fileToggles.set(t.id, !cur);
    updateTaskCard(div, t);
  });
  updateTaskCard(div, t);
  return div;
}

function updateTaskCard(card, t) {
  // Status como atributo → CSS hace el resto (border pulsante, color, etc.).
  if (card.dataset.status !== t.status) card.dataset.status = t.status;
  card.setAttribute('aria-label', `Tarea ${t.title || t.id}`);

  const titleEl = card.querySelector('[data-slot="title"]');
  titleEl.textContent = t.title || '(sin título)';

  const agentEl = card.querySelector('[data-slot="agent"]');
  agentEl.innerHTML = `
    <strong>${escapeHtml(t.agent || 'agente')}</strong>
    ${t.agent_role ? `<span class="role-tip" tabindex="0" title="${escapeHtml(t.agent_role)}">actúa como…</span>` : ''}
  `;

  const skillEl = card.querySelector('[data-slot="skill"]');
  if (t.skill_invoked) {
    skillEl.hidden = false;
    skillEl.textContent = t.skill_invoked;
    skillEl.title = `Skill invocada: ${t.skill_invoked}`;
  } else {
    skillEl.hidden = true;
    skillEl.textContent = '';
  }

  const files = Array.isArray(t.files_in_use) ? t.files_in_use : [];
  const expanded = ui.fileToggles.get(t.id) === true;
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const filesEl = card.querySelector('[data-slot="files"]');
  filesEl.innerHTML = '';
  if (files.length === 0) {
    filesEl.hidden = true;
  } else {
    filesEl.hidden = false;
    for (const f of visibleFiles) {
      const li = document.createElement('li');
      li.textContent = f;
      filesEl.appendChild(li);
    }
  }
  const toggleBtn = card.querySelector('[data-slot="files-toggle"]');
  if (files.length > 3) {
    toggleBtn.hidden = false;
    toggleBtn.textContent = expanded ? 'ver menos' : `ver más (+${files.length - 3})`;
  } else {
    toggleBtn.hidden = true;
  }

  const failEl = card.querySelector('[data-slot="fail-reason"]');
  if (t.failure_reason) {
    failEl.hidden = false;
    failEl.textContent = t.failure_reason;
    failEl.title = t.failure_reason;
  } else {
    failEl.hidden = true;
    failEl.textContent = '';
  }

  const elapsedMs = (() => {
    if (!t.started_at) return 0;
    const start = new Date(t.started_at).getTime();
    const end = t.ended_at ? new Date(t.ended_at).getTime() : Date.now();
    return end - start;
  })();
  card.querySelector('[data-slot="elapsed"]').textContent = fmtDuration(elapsedMs);
  card.querySelector('[data-slot="tokens"]').textContent  = `${fmtTokens(t.tokens_estimated || 0)} tk`;
}

// ---------- live tick (uptime + duración de tareas running) ----------
function tickLive() {
  if (!ui.snapshot) return;
  const base = ui.snapshot.derived?.uptime_seconds || 0;
  const lastFetch = ui.uptimeBaseline || Date.now();
  const drift = Math.floor((Date.now() - lastFetch) / 1000);
  $('[data-slot="metric-uptime"]').textContent = fmtUptime(base + drift);

  // tareas running: actualizar duraciones cada segundo sin tocar al server.
  for (const card of $$('.task[data-status="running"]')) {
    const id = card.dataset.taskId;
    const task = ui.snapshot.active_tasks?.find(x => String(x.id) === id);
    if (!task || !task.started_at) continue;
    const ms = Date.now() - new Date(task.started_at).getTime();
    const slot = card.querySelector('[data-slot="elapsed"]');
    if (slot) slot.textContent = fmtDuration(ms);
  }
}
setInterval(tickLive, 1000);

// ---------- UI flags persistidos ----------
function applyStoredFlags() {
  const sb = localStorage.getItem(STORAGE_KEYS.sidebar);
  if (sb === 'closed') document.body.dataset.sidebar = 'closed';
}
function toggleSidebar() {
  const cur = document.body.dataset.sidebar === 'closed' ? 'closed' : 'open';
  const next = cur === 'closed' ? 'open' : 'closed';
  document.body.dataset.sidebar = next;
  localStorage.setItem(STORAGE_KEYS.sidebar, next);
}

// ---------- bootstrap ----------
function bindEvents() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle-sidebar') toggleSidebar();
  });

  // Atajos de teclado mínimos (los hooks de 2.3b — replay/export — los agregará 2.3b).
  document.addEventListener('keydown', (e) => {
    // Permite cerrar el banner vacío con Escape (futuro: modales 2.3b).
    if (e.key === 'Escape') {
      const banner = $('#empty-banner');
      if (banner && !banner.hidden) banner.hidden = true;
    }
  });
}

(async function init() {
  applyStoredFlags();
  bindEvents();
  // Inicial: refrescamos primero para tener algo en pantalla, después abrimos SSE.
  await refresh();
  connectSSE();
})();
