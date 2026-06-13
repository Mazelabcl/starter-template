// dashboard/public/app.js
//
// Dashboard v3 — frontend HTML plano (v4). Reemplaza el frontend Phaser
// pixel-art (~2.700 LOC) por una tabla de estado simple + pestañas
// Sprint / Roadmap / Chat. Lee /api/state y se suscribe a SSE (/api/events)
// para refrescar en vivo.
//
// INVARIANTE XSS (heredada de ADR-02): TODO render de datos al DOM usa
// textContent. NUNCA innerHTML con datos del state/sprint/roadmap/chat.
// El único innerHTML permitido sería con strings literales del propio código,
// pero acá ni eso usamos: todo es createElement + textContent.
//
// Endpoints consumidos:
//   GET  /api/state           → snapshot (active_tasks, metrics, events, ...)
//   GET  /api/events          → SSE: evento 'state' (refresca) + 'chat-msg'
//   GET  /api/sprint          → roadmap/current-sprint.json
//   GET  /api/roadmap         → { markdown }
//   GET  /api/sprints/history → array de sprints cerrados
//   GET  /api/chat/history    → { messages }

const STATE_URL = '/api/state';
const EVENTS_URL = '/api/events';
const SPRINT_URL = '/api/sprint';
const ROADMAP_URL = '/api/roadmap';
const HISTORY_URL = '/api/sprints/history';
const CHAT_HISTORY_URL = '/api/chat/history';
const CHAT_IN_MEMORY_LIMIT = 200;

let lastSnapshot = null;
let chatMessages = [];
let chatLoaded = false;
let activeTab = 'tasks';

// ---------- helpers DOM (todos textContent, ZERO innerHTML con datos) ----------

function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null && text !== '') el.textContent = String(text);
  return el;
}

function section(parent, label) {
  const wrap = makeEl('div', 'section');
  wrap.appendChild(makeEl('div', 'section-label', label));
  parent.appendChild(wrap);
  return wrap;
}

function timeOfDay(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtTokens(n) {
  return Number.isFinite(n) ? n.toLocaleString('es') : '0';
}

// Heurística: el modelo de una task. Soporta varios campos opcionales del schema.
function modelOf(task) {
  return task.model || task.model_used || (task.gate ? null : null) || '—';
}

// ---------- vista: tareas ----------

function renderTasks() {
  const tbody = document.getElementById('tasks-body');
  const empty = document.getElementById('tasks-empty');
  if (!tbody) return;
  clear(tbody);

  const tasks = (lastSnapshot && Array.isArray(lastSnapshot.active_tasks))
    ? lastSnapshot.active_tasks : [];

  if (tasks.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Orden: running primero, luego por started_at descendente.
  const sorted = [...tasks].sort((a, b) => {
    const ra = a.status === 'running' ? 0 : 1;
    const rb = b.status === 'running' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (Date.parse(b.started_at || '') || 0) - (Date.parse(a.started_at || '') || 0);
  });

  for (const t of sorted) {
    if (!t || typeof t !== 'object') continue;
    const tr = document.createElement('tr');
    tr.appendChild(makeEl('td', 'col-agent', t.agent || '—'));
    const statusTd = makeEl('td', 'col-status');
    const badge = makeEl('span', `status-badge status-${(t.status || 'unknown').replace(/[^a-z_-]/gi, '')}`, t.status || '—');
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);
    tr.appendChild(makeEl('td', 'col-model', modelOf(t)));
    tr.appendChild(makeEl('td', 'col-tokens', fmtTokens(t.tokens_estimated)));
    tr.appendChild(makeEl('td', 'col-summary', t.summary || t.title || t.prompt_brief || '—'));
    tbody.appendChild(tr);
  }
}

function renderMetrics() {
  const bar = document.getElementById('metrics-bar');
  if (!bar) return;
  clear(bar);
  const m = (lastSnapshot && lastSnapshot.metrics) || {};
  // "USD APIs" cubre solo costo de APIs externas (OpenRouter/Replicate), NO los
  // tokens de Claude Code. Etiqueta explícita para no confundir el alcance.
  const costUsd = Number.isFinite(m.total_cost_usd_session) ? m.total_cost_usd_session : 0;
  const pairs = [
    ['Tokens', fmtTokens(m.total_tokens_session)],
    ['USD APIs', `$${costUsd.toFixed(2)}`],
    ['Done', String(m.tasks_completed || 0)],
    ['Failed', String(m.tasks_failed || 0)],
    ['Councils', String(m.councils_invoked || 0)],
  ];
  for (const [k, v] of pairs) {
    const chip = makeEl('span', 'metric-chip');
    chip.appendChild(makeEl('span', 'metric-key', k));
    chip.appendChild(makeEl('span', 'metric-val', v));
    bar.appendChild(chip);
  }
}

// ---------- vista: sprint ----------

function renderSprint(sprint) {
  const view = document.getElementById('view-sprint');
  if (!view) return;
  clear(view);

  const hasSprint = sprint && typeof sprint === 'object' && (sprint.objective || sprint.number);
  if (!hasSprint) {
    view.appendChild(makeEl('div', 'empty', 'Sin sprint activo — corre /kickoff o /roadmap.'));
    return;
  }

  const head = makeEl('div', 'sprint-head');
  head.appendChild(makeEl('div', 'sprint-number', sprint.number ? `Sprint ${sprint.number}` : 'Sprint'));
  head.appendChild(makeEl('div', 'sprint-objective', sprint.objective || '(sin objetivo declarado)'));
  const dates = [];
  if (sprint.started_at) dates.push(`Inicio: ${String(sprint.started_at).slice(0, 10)}`);
  if (sprint.target_close) dates.push(`Meta: ${String(sprint.target_close).slice(0, 10)}`);
  if (dates.length) head.appendChild(makeEl('div', 'sprint-dates', dates.join(' · ')));
  view.appendChild(head);

  // Tareas del sprint: filtra por sprint_number cuando alguna task lo declara.
  const rawTasks = (lastSnapshot && Array.isArray(lastSnapshot.active_tasks)) ? lastSnapshot.active_tasks : [];
  const sprintNum = typeof sprint.number === 'number' ? sprint.number : null;
  const anySprintNumber = rawTasks.some(t => t && typeof t.sprint_number === 'number');
  const tasks = (anySprintNumber && sprintNum !== null)
    ? rawTasks.filter(t => t && t.sprint_number === sprintNum)
    : rawTasks;

  const completed = tasks.filter(t => t && t.status === 'completed');
  const failed = tasks.filter(t => t && t.status === 'failed');

  const compSec = section(view, `TAREAS COMPLETADAS (${completed.length})`);
  if (completed.length === 0) {
    compSec.appendChild(makeEl('div', 'empty-inline', 'Aún no hay tareas completadas.'));
  } else {
    const ul = makeEl('ul', 'plain-list');
    for (const t of completed.slice(-30)) {
      const li = document.createElement('li');
      li.appendChild(makeEl('span', 'completed-agent', t.agent || '—'));
      li.appendChild(document.createTextNode(': '));
      li.appendChild(makeEl('span', 'completed-summary', t.summary || t.title || t.id || ''));
      ul.appendChild(li);
    }
    compSec.appendChild(ul);
  }

  const metSec = section(view, 'MÉTRICAS');
  const metrics = (lastSnapshot && lastSnapshot.metrics) || {};
  const totalTokens = Number.isFinite(metrics.total_tokens_session)
    ? metrics.total_tokens_session
    : tasks.reduce((acc, t) => acc + (Number.isFinite(t.tokens_estimated) ? t.tokens_estimated : 0), 0);
  kvRow(metSec, 'tokens totales', fmtTokens(totalTokens));
  kvRow(metSec, 'tareas done', String(completed.length));
  kvRow(metSec, 'tareas failed', String(failed.length));
}

function kvRow(parent, key, value) {
  const row = makeEl('div', 'kv-row');
  row.appendChild(makeEl('span', 'kv-key', key));
  row.appendChild(makeEl('span', 'kv-value', (value === null || value === undefined || value === '') ? '—' : String(value)));
  parent.appendChild(row);
}

// ---------- mini-parser markdown XSS-safe (portado de panel.js) ----------
// Soporta # H1-H3, bullets, **bold**. Todo via createElement + textContent.

function renderMarkdownToDOM(parent, markdown) {
  if (!parent) return;
  const raw = typeof markdown === 'string' ? markdown : '';
  const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '');
  const lines = cleaned.split(/\r?\n/);
  let currentList = null;
  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\s+$/, '');
    if (!line.trim()) { currentList = null; parent.appendChild(makeEl('div', 'md-blank')); continue; }
    const hMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hMatch) {
      currentList = null;
      const level = hMatch[1].length;
      const h = makeEl('h' + level, 'md-h' + level);
      appendInlineWithBold(h, hMatch[2]);
      parent.appendChild(h);
      continue;
    }
    const bMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bMatch) {
      if (!currentList) { currentList = makeEl('ul', 'md-ul'); parent.appendChild(currentList); }
      const li = makeEl('li', 'md-li');
      appendInlineWithBold(li, bMatch[1]);
      currentList.appendChild(li);
      continue;
    }
    currentList = null;
    const p = makeEl('p', 'md-p');
    appendInlineWithBold(p, line);
    parent.appendChild(p);
  }
}

function appendInlineWithBold(el, text) {
  if (!text) { el.appendChild(document.createTextNode('')); return; }
  const re = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) el.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
    el.appendChild(makeEl('strong', 'md-strong', m[1]));
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) el.appendChild(document.createTextNode(text.slice(lastIdx)));
}

// ---------- vista: roadmap ----------

function renderRoadmap(roadmap, sprintHistory) {
  const view = document.getElementById('view-roadmap');
  if (!view) return;
  clear(view);

  const mdSec = section(view, 'ROADMAP DEL PROYECTO');
  const md = roadmap && typeof roadmap.markdown === 'string' ? roadmap.markdown : '';
  const mdContainer = makeEl('div', 'roadmap-md');
  if (!md.trim()) {
    mdContainer.appendChild(makeEl('div', 'empty-inline', 'Roadmap vacío o no existe roadmap/roadmap.md.'));
  } else {
    renderMarkdownToDOM(mdContainer, md);
  }
  mdSec.appendChild(mdContainer);

  const histSec = section(view, 'HISTORIAL DE SPRINTS');
  const hist = Array.isArray(sprintHistory) ? sprintHistory : [];
  if (hist.length === 0) {
    histSec.appendChild(makeEl('div', 'empty-inline', 'Sin sprints históricos aún.'));
  } else {
    for (const s of hist) {
      const details = document.createElement('details');
      details.className = 'sprint-entry';
      const summary = document.createElement('summary');
      summary.appendChild(makeEl('span', 'sprint-entry-number', `Sprint ${s.number}`));
      if (s.objective) {
        summary.appendChild(document.createTextNode(' — '));
        summary.appendChild(makeEl('span', 'sprint-entry-obj', s.objective));
      }
      details.appendChild(summary);
      const deliv = Array.isArray(s.deliverables) ? s.deliverables : [];
      if (deliv.length) {
        details.appendChild(makeEl('div', 'sprint-entry-label', 'ENTREGABLES'));
        const ul = makeEl('ul', 'plain-list');
        for (const d of deliv) ul.appendChild(makeEl('li', null, d));
        details.appendChild(ul);
      }
      histSec.appendChild(details);
    }
  }
}

// ---------- vista: chat ----------

function renderChat() {
  const view = document.getElementById('view-chat');
  if (!view) return;
  clear(view);

  const msgs = Array.isArray(chatMessages) ? chatMessages : [];
  if (msgs.length === 0) {
    view.appendChild(makeEl('div', 'empty', 'Sin mensajes aún — los agentes reportan vía node scripts/update_state.js say <from> <to> <message>.'));
    return;
  }

  const wrap = makeEl('div', 'chat-feed');
  const sorted = [...msgs].sort((a, b) => (Date.parse(a.timestamp || '') || 0) - (Date.parse(b.timestamp || '') || 0));
  for (const m of sorted) {
    if (!m || typeof m.message !== 'string') continue;
    const row = makeEl('div', 'chat-msg');
    const meta = makeEl('div', 'chat-meta');
    meta.appendChild(makeEl('span', 'chat-from', m.from || '?'));
    meta.appendChild(document.createTextNode(' → '));
    meta.appendChild(makeEl('span', 'chat-to', m.to || '?'));
    meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(makeEl('span', 'chat-time', timeOfDay(m.timestamp)));
    row.appendChild(meta);
    // XSS: el body SIEMPRE por textContent.
    row.appendChild(makeEl('div', 'chat-body', m.message));
    wrap.appendChild(row);
  }
  view.appendChild(wrap);
  setTimeout(() => { view.scrollTop = view.scrollHeight || 0; }, 0);
}

// ---------- fetch helpers ----------

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn(`[dashboard] no pude fetch ${url}:`, e && e.message ? e.message : e);
  }
  return null;
}

async function refreshState() {
  const snap = await fetchJSON(STATE_URL);
  if (snap) {
    lastSnapshot = snap;
    renderMetrics();
    if (activeTab === 'tasks') renderTasks();
    if (activeTab === 'sprint') refreshSprintView();
  }
}

async function refreshSprintView() {
  const sprint = await fetchJSON(SPRINT_URL);
  renderSprint(sprint || {});
}

async function refreshRoadmapView() {
  const [roadmap, history] = await Promise.all([fetchJSON(ROADMAP_URL), fetchJSON(HISTORY_URL)]);
  renderRoadmap(roadmap || { markdown: '' }, Array.isArray(history) ? history : []);
}

async function ensureChat() {
  if (chatLoaded) { renderChat(); return; }
  const json = await fetchJSON(CHAT_HISTORY_URL);
  const arr = Array.isArray(json && json.messages) ? json.messages : [];
  chatMessages = arr.filter(m => m && typeof m === 'object'
    && typeof m.from === 'string' && typeof m.to === 'string'
    && typeof m.message === 'string' && typeof m.timestamp === 'string');
  if (chatMessages.length > CHAT_IN_MEMORY_LIMIT) chatMessages = chatMessages.slice(-CHAT_IN_MEMORY_LIMIT);
  chatLoaded = true;
  renderChat();
}

// ---------- tabs ----------

function switchTab(tab) {
  activeTab = tab;
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('tab-active', btn.dataset.tab === tab);
  }
  for (const view of document.querySelectorAll('.view')) {
    view.classList.toggle('view-active', view.id === `view-${tab}`);
  }
  if (tab === 'tasks') renderTasks();
  else if (tab === 'sprint') refreshSprintView();
  else if (tab === 'roadmap') refreshRoadmapView();
  else if (tab === 'chat') ensureChat();
}

function wireTabs() {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
}

// ---------- SSE ----------

function connectSSE() {
  const dot = document.getElementById('conn-dot');
  let es;
  try {
    es = new EventSource(EVENTS_URL);
  } catch (e) {
    console.warn('[dashboard] EventSource no disponible:', e && e.message);
    return;
  }
  es.addEventListener('open', () => { if (dot) dot.classList.add('conn-live'); });
  es.addEventListener('error', () => { if (dot) dot.classList.remove('conn-live'); });
  es.addEventListener('state', () => { refreshState(); });
  es.addEventListener('chat-msg', (ev) => {
    let entry;
    try { entry = JSON.parse(ev.data); } catch { return; }
    if (!entry || typeof entry.from !== 'string' || typeof entry.to !== 'string'
        || typeof entry.message !== 'string' || typeof entry.timestamp !== 'string') return;
    chatMessages.push(entry);
    if (chatMessages.length > CHAT_IN_MEMORY_LIMIT) chatMessages = chatMessages.slice(-CHAT_IN_MEMORY_LIMIT);
    if (activeTab === 'chat') renderChat();
  });
}

// ---------- boot ----------

function boot() {
  wireTabs();
  refreshState();
  connectSSE();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
