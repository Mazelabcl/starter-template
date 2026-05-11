// dashboard/public/ui/panel.js
//
// Side panel DOM overlay derecho (fase 6 expandida + fase 7 roadmap). Spec base
// sección 2 + ADR-02.
//
// Tres modos:
//   - 'agent'   → drill-down de un agente: brief, plan, task actual, entregables,
//                 eventos recientes. Si la task tiene phase/epic, se muestran.
//   - 'sprint'  → vista global del sprint: hitos, tareas done (agrupadas por
//                 phase cuando existe), entregables del sprint, métricas.
//   - 'roadmap' → vista macro: render del roadmap.md como texto pixel-art +
//                 historial colapsable de sprints cerrados (memory/sprint-log.md).
//
// Triggers de apertura:
//   - bus 'avatar-clicked' { detail: { name } } → openForAgent(name)
//   - bus 'open-sprint'                         → openSprint()
//   - bus 'open-roadmap'                        → openRoadmap()
//
// Cierre:
//   - botón ×
//   - tecla ESC
//   - click fuera del panel (en el overlay backdrop)
//
// INVARIANTE ADR-02 (XSS): TODO render desde state.json al DOM usa textContent.
// NUNCA innerHTML con datos del state. Esto se enforza por convención + por test
// que hace grep contra `innerHTML\s*=` en este archivo.
//
// Boundaries:
//   - Acá NO se toca Phaser. NO se importa nada del engine/.
//   - La comunicación con el engine es solo vía bus (CustomEvent).
//
// Estructura DOM (mount() la inyecta dentro de <aside id="panel">):
//
//   #panel-overlay   (display:none default; show() activa flex)
//   ├── .panel-backdrop  (click → close)
//   └── #panel-card
//       ├── header  ( × | toggle Sprint/Agente )
//       └── body    (se re-renderiza al cambiar de modo)

import { bus } from '../engine/eventBus.js';

const STATE_URL = '/api/state';
const SPRINT_URL = '/api/sprint';
const ROADMAP_URL = '/api/roadmap';
const HISTORY_URL = '/api/sprints/history';

/** Crea el panel. Devuelve { mount, openForAgent, openSprint, close, getMode }. */
export function createSidePanel(opts) {
  const root = (opts && opts.root) || document.getElementById('panel');
  if (!root) {
    console.warn('[panel] no encuentro <aside id="panel"> — el panel no monta.');
    return makeNoopHandle();
  }

  // Cache del último snapshot recibido por bus. Si el panel se abre antes de
  // que el sync emita por primera vez, fetch directo.
  let lastSnapshot = null;
  let lastSprint = null;
  let lastRoadmap = null;       // { markdown: string }
  let lastSprintHistory = null; // array<sprint>
  // Modo actual. 'agent' | 'sprint' | 'roadmap'. selectedAgent es el name si modo === 'agent'.
  let mode = null;
  let selectedAgent = null;

  // DOM handles. Se llenan en mount().
  let overlay = null;
  let card = null;
  let body = null;
  let titleEl = null;
  let toggleBtn = null;
  let modeAgentBtn = null;
  let modeSprintBtn = null;
  let modeRoadmapBtn = null;

  // Listeners que registramos en mount() para poder limpiarlos.
  const unsubscribers = [];

  function mount() {
    // Suscribirse al bus para mantener snapshot fresco aunque el panel esté cerrado.
    const stateHandler = (e) => {
      if (e && e.detail) {
        lastSnapshot = e.detail;
        // Si el panel está abierto, re-renderiza con los nuevos datos.
        if (isOpen()) rerender();
      }
    };
    bus.addEventListener('state-update', stateHandler);
    unsubscribers.push(() => bus.removeEventListener('state-update', stateHandler));

    const avatarClickHandler = (e) => {
      const name = e && e.detail && e.detail.name;
      if (name) openForAgent(name);
    };
    bus.addEventListener('avatar-clicked', avatarClickHandler);
    unsubscribers.push(() => bus.removeEventListener('avatar-clicked', avatarClickHandler));

    const openSprintHandler = () => openSprint();
    bus.addEventListener('open-sprint', openSprintHandler);
    unsubscribers.push(() => bus.removeEventListener('open-sprint', openSprintHandler));

    const openRoadmapHandler = () => openRoadmap();
    bus.addEventListener('open-roadmap', openRoadmapHandler);
    unsubscribers.push(() => bus.removeEventListener('open-roadmap', openRoadmapHandler));

    // Tecla ESC global.
    const keyHandler = (ev) => {
      if (ev && ev.key === 'Escape' && isOpen()) close();
    };
    document.addEventListener('keydown', keyHandler);
    unsubscribers.push(() => document.removeEventListener('keydown', keyHandler));

    // Construye el DOM una sola vez. Cada apertura solo re-renderiza el body.
    buildSkeleton();
  }

  function buildSkeleton() {
    // Limpia cualquier contenido previo del <aside>.
    while (root.firstChild) root.removeChild(root.firstChild);

    overlay = document.createElement('div');
    overlay.id = 'panel-overlay';
    overlay.style.display = 'none';

    const backdrop = document.createElement('div');
    backdrop.className = 'panel-backdrop';
    backdrop.addEventListener('click', () => close());

    card = document.createElement('div');
    card.id = 'panel-card';
    card.addEventListener('click', (e) => e.stopPropagation());

    // Header con × + toggle.
    const header = document.createElement('div');
    header.className = 'panel-header';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar panel');
    closeBtn.textContent = '×'; // × literal
    closeBtn.addEventListener('click', () => close());

    titleEl = document.createElement('div');
    titleEl.className = 'panel-title';
    titleEl.textContent = '';

    // Tri-mode toggle: Agente / Sprint / Roadmap. El modo activo recibe la clase
    // .panel-mode-active para diferenciarlo visualmente. El toggleBtn legacy queda
    // expuesto para retro-compat con tests existentes (refleja el "siguiente
    // modo" cuando el panel está en agent o sprint), pero el render real usa los
    // 3 botones tri-modal.
    const modeBar = document.createElement('div');
    modeBar.className = 'panel-mode-bar';

    modeAgentBtn = document.createElement('button');
    modeAgentBtn.className = 'panel-mode-btn';
    modeAgentBtn.type = 'button';
    modeAgentBtn.textContent = 'Agente';
    modeAgentBtn.addEventListener('click', () => openLastAgent());

    modeSprintBtn = document.createElement('button');
    modeSprintBtn.className = 'panel-mode-btn';
    modeSprintBtn.type = 'button';
    modeSprintBtn.textContent = 'Sprint';
    modeSprintBtn.addEventListener('click', () => openSprint());

    modeRoadmapBtn = document.createElement('button');
    modeRoadmapBtn.className = 'panel-mode-btn';
    modeRoadmapBtn.type = 'button';
    modeRoadmapBtn.textContent = 'Roadmap';
    modeRoadmapBtn.addEventListener('click', () => openRoadmap());

    modeBar.appendChild(modeAgentBtn);
    modeBar.appendChild(modeSprintBtn);
    modeBar.appendChild(modeRoadmapBtn);

    // Toggle legacy (compat con tests previos que buscan `.panel-toggle`).
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'panel-toggle';
    toggleBtn.type = 'button';
    toggleBtn.style.display = 'none';
    toggleBtn.textContent = 'Sprint';
    toggleBtn.addEventListener('click', () => {
      if (mode === 'sprint') openLastAgent();
      else openSprint();
    });

    header.appendChild(closeBtn);
    header.appendChild(titleEl);
    header.appendChild(modeBar);
    header.appendChild(toggleBtn);

    body = document.createElement('div');
    body.className = 'panel-body';

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(backdrop);
    overlay.appendChild(card);
    root.appendChild(overlay);
  }

  function isOpen() {
    return overlay && overlay.style.display !== 'none';
  }

  function show() {
    if (!overlay) return;
    overlay.style.display = 'flex';
    // Hace visible el <aside> que en style.css está display:none.
    root.style.display = 'block';
  }

  function close() {
    if (!overlay) return;
    overlay.style.display = 'none';
    root.style.display = 'none';
  }

  function openLastAgent() {
    if (selectedAgent) openForAgent(selectedAgent);
    else {
      // Si no hay agente previo, intentamos elegir el primero de active_tasks.
      const snap = lastSnapshot;
      const tasks = (snap && Array.isArray(snap.active_tasks)) ? snap.active_tasks : [];
      const first = tasks.find(t => t && typeof t.agent === 'string' && t.agent);
      if (first) openForAgent(first.agent);
    }
  }

  function openForAgent(name) {
    mode = 'agent';
    selectedAgent = name;
    if (toggleBtn) toggleBtn.textContent = 'Sprint';
    updateModeButtons();
    show();
    ensureSnapshot().then(() => rerender());
  }

  function openSprint() {
    mode = 'sprint';
    if (toggleBtn) toggleBtn.textContent = 'Agente';
    updateModeButtons();
    show();
    Promise.all([ensureSnapshot(), ensureSprint()]).then(() => rerender());
  }

  function openRoadmap() {
    mode = 'roadmap';
    if (toggleBtn) toggleBtn.textContent = 'Agente';
    updateModeButtons();
    show();
    Promise.all([ensureRoadmap(), ensureSprintHistory()]).then(() => rerender());
  }

  function updateModeButtons() {
    const map = [
      [modeAgentBtn, 'agent'],
      [modeSprintBtn, 'sprint'],
      [modeRoadmapBtn, 'roadmap'],
    ];
    for (const [btn, m] of map) {
      if (!btn) continue;
      if (m === mode) btn.classList.add('panel-mode-active');
      else btn.classList.remove('panel-mode-active');
    }
  }

  function rerender() {
    if (mode === 'sprint') {
      renderSprint(body, titleEl, lastSnapshot, lastSprint);
    } else if (mode === 'agent') {
      renderAgent(body, titleEl, lastSnapshot, selectedAgent);
    } else if (mode === 'roadmap') {
      renderRoadmap(body, titleEl, lastRoadmap, lastSprintHistory);
    }
  }

  async function ensureSnapshot() {
    if (lastSnapshot) return lastSnapshot;
    try {
      const res = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        lastSnapshot = await res.json();
      }
    } catch (e) {
      console.warn('[panel] no pude fetch /api/state:', e && e.message ? e.message : e);
    }
    return lastSnapshot;
  }

  async function ensureSprint() {
    try {
      const res = await fetch(SPRINT_URL, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        lastSprint = await res.json();
      }
    } catch (e) {
      console.warn('[panel] no pude fetch /api/sprint:', e && e.message ? e.message : e);
      lastSprint = {};
    }
    return lastSprint;
  }

  async function ensureRoadmap() {
    try {
      const res = await fetch(ROADMAP_URL, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        lastRoadmap = await res.json();
      }
    } catch (e) {
      console.warn('[panel] no pude fetch /api/roadmap:', e && e.message ? e.message : e);
      lastRoadmap = { markdown: '' };
    }
    return lastRoadmap;
  }

  async function ensureSprintHistory() {
    try {
      const res = await fetch(HISTORY_URL, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const json = await res.json();
        lastSprintHistory = Array.isArray(json) ? json : [];
      }
    } catch (e) {
      console.warn('[panel] no pude fetch /api/sprints/history:', e && e.message ? e.message : e);
      lastSprintHistory = [];
    }
    return lastSprintHistory;
  }

  return {
    mount,
    openForAgent,
    openSprint,
    openRoadmap,
    close,
    getMode: () => mode,
  };
}

function makeNoopHandle() {
  return {
    mount() {},
    openForAgent() {},
    openSprint() {},
    openRoadmap() {},
    close() {},
    getMode: () => null,
  };
}

// ---------- helpers de tiempo ----------

function relativeTime(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `hace ${deltaSec}s`;
  if (deltaSec < 3600) return `hace ${Math.floor(deltaSec / 60)} min`;
  if (deltaSec < 86400) return `hace ${Math.floor(deltaSec / 3600)} h`;
  return `hace ${Math.floor(deltaSec / 86400)} d`;
}

function timeOfDay(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------- selección de task representativa de un agente ----------
// El panel agente muestra UNA task como "task actual". Heurística:
//   1. Si hay una 'running', la más reciente.
//   2. Si no, la última por started_at (cualquier estado).
function pickRepresentativeTask(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const running = tasks.filter(t => t && t.status === 'running');
  const pool = running.length ? running : tasks;
  let pick = pool[0];
  let pickTs = Date.parse(pick.started_at || '') || 0;
  for (let i = 1; i < pool.length; i++) {
    const ts = Date.parse(pool[i].started_at || '') || 0;
    if (ts >= pickTs) { pick = pool[i]; pickTs = ts; }
  }
  return pick;
}

// ---------- helpers DOM (todos textContent, ZERO innerHTML) ----------

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
  const wrap = makeEl('div', 'panel-section');
  wrap.appendChild(makeEl('div', 'panel-section-label', label));
  parent.appendChild(wrap);
  return wrap;
}

function keyValueRow(parent, key, value) {
  const row = makeEl('div', 'panel-kv-row');
  row.appendChild(makeEl('span', 'panel-kv-key', key));
  row.appendChild(makeEl('span', 'panel-kv-value', value === null || value === undefined || value === '' ? '—' : String(value)));
  parent.appendChild(row);
}

// ---------- render: agente ----------

export function renderAgent(body, titleEl, snapshot, agentName) {
  clear(body);
  if (titleEl) titleEl.textContent = agentName || 'Agente';

  if (!snapshot || typeof snapshot !== 'object') {
    body.appendChild(makeEl('div', 'panel-empty', 'Snapshot no disponible.'));
    return;
  }
  const tasks = Array.isArray(snapshot.active_tasks) ? snapshot.active_tasks : [];
  const agentTasks = tasks.filter(t => t && t.agent === agentName);
  const task = pickRepresentativeTask(agentTasks);

  // -- Cabecera identidad
  const ident = makeEl('div', 'panel-ident');
  ident.appendChild(makeEl('div', 'panel-agent-name', agentName || ''));
  if (task && (task.role_full || task.agent_role)) {
    ident.appendChild(makeEl('div', 'panel-agent-role', task.role_full || task.agent_role));
  }
  body.appendChild(ident);

  if (!task) {
    body.appendChild(makeEl('div', 'panel-empty', 'Este agente no tiene tareas activas en el snapshot.'));
    return;
  }

  // -- BRIEF: prompt_brief con fallback a summary, fallback a title.
  const briefSec = section(body, 'BRIEF');
  const briefText = task.prompt_brief || task.summary || task.title || '(sin brief declarado)';
  briefSec.appendChild(makeEl('p', 'panel-brief-text', briefText));

  // -- PLAN: plan_steps[] con current_step marcado.
  const planSec = section(body, 'PLAN');
  const planSteps = Array.isArray(task.plan_steps) ? task.plan_steps : [];
  if (planSteps.length === 0) {
    planSec.appendChild(makeEl('div', 'panel-empty-inline', 'Plan no declarado por el agente.'));
  } else {
    const current = Number.isInteger(task.current_step) && task.current_step >= 0 ? task.current_step : 0;
    const ol = makeEl('ol', 'panel-plan-list');
    planSteps.forEach((step, i) => {
      const li = document.createElement('li');
      let marker;
      if (i < current) { li.className = 'plan-step-done'; marker = '✓'; }      // ✓
      else if (i === current) { li.className = 'plan-step-current'; marker = '▶'; } // ▶
      else { li.className = 'plan-step-future'; marker = '○'; }                // ○
      li.appendChild(makeEl('span', 'plan-step-marker', marker));
      li.appendChild(makeEl('span', 'plan-step-text', step));
      ol.appendChild(li);
    });
    planSec.appendChild(ol);
  }

  // -- TASK ACTUAL: metadatos.
  const taskSec = section(body, 'TASK ACTUAL');
  keyValueRow(taskSec, 'id', task.id);
  keyValueRow(taskSec, 'estado', task.status);
  keyValueRow(taskSec, 'gate', task.gate || '—');
  keyValueRow(taskSec, 'origen', task.origin || '—');
  keyValueRow(taskSec, 'tokens', Number.isFinite(task.tokens_estimated) ? task.tokens_estimated.toLocaleString('es') : '0');
  keyValueRow(taskSec, 'iniciada', relativeTime(task.started_at) || '—');

  // -- FASE / ÉPICA (v2.2 — sólo si la task las declara).
  const phase = (typeof task.phase === 'string' && task.phase) ? task.phase : null;
  const epic = (typeof task.epic === 'string' && task.epic) ? task.epic : null;
  if (phase || epic) {
    const orgSec = section(body, 'CONTEXTO ORGANIZATIVO');
    if (phase) keyValueRow(orgSec, 'fase', phase);
    if (epic) keyValueRow(orgSec, 'épica', epic);
  }

  // -- ENTREGABLES: artifacts.
  const artSec = section(body, 'ENTREGABLES');
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  if (artifacts.length === 0) {
    artSec.appendChild(makeEl('div', 'panel-empty-inline', 'Sin entregables todavía.'));
  } else {
    const list = makeEl('ul', 'panel-artifact-list');
    for (const a of artifacts) {
      if (!a || typeof a.path !== 'string') continue;
      const li = document.createElement('li');
      if (a.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'panel-artifact-thumb';
        img.alt = a.title || a.path;
        img.src = '/files/' + a.path.replace(/^\/+/, '');
        li.appendChild(img);
      }
      const link = document.createElement('a');
      link.className = 'panel-artifact-link';
      link.href = a.kind === 'link' ? a.path : '/files/' + a.path.replace(/^\/+/, '');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = a.title || a.path;
      li.appendChild(link);
      list.appendChild(li);
    }
    artSec.appendChild(list);
  }

  // -- EVENTOS RECIENTES (filtrados por agente cuando podemos; fallback a globales)
  const evSec = section(body, 'EVENTOS RECIENTES');
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  // Heurística simple: eventos cuyos payloads referencien task.id o task.agent.
  const related = events.filter(ev => {
    if (!ev || !ev.payload) return false;
    const p = ev.payload;
    return (p.id && agentTasks.some(t => t.id === p.id))
        || (p.agent && p.agent === agentName)
        || (p.agent_role && task && p.agent_role === task.agent_role);
  });
  const recent = (related.length ? related : events).slice(-8).reverse();
  if (recent.length === 0) {
    evSec.appendChild(makeEl('div', 'panel-empty-inline', 'Sin eventos recientes.'));
  } else {
    const ul = makeEl('ul', 'panel-events-list');
    for (const ev of recent) {
      const li = document.createElement('li');
      li.appendChild(makeEl('span', 'panel-event-time', timeOfDay(ev.timestamp)));
      li.appendChild(makeEl('span', 'panel-event-type', String(ev.type || '')));
      ul.appendChild(li);
    }
    evSec.appendChild(ul);
  }
}

// ---------- render: sprint ----------

export function renderSprint(body, titleEl, snapshot, sprint) {
  clear(body);
  const hasSprint = sprint && typeof sprint === 'object' && (sprint.objective || sprint.number);
  if (titleEl) titleEl.textContent = hasSprint && sprint.number ? `Sprint ${sprint.number}` : 'Sprint';

  if (!hasSprint) {
    body.appendChild(makeEl('div', 'panel-empty', 'Sin sprint activo — corre /kickoff o /roadmap.'));
    return;
  }

  // -- Header del sprint.
  const head = makeEl('div', 'panel-sprint-head');
  head.appendChild(makeEl('div', 'panel-sprint-objective', sprint.objective || '(sin objetivo declarado)'));
  const dates = [];
  if (sprint.started_at) dates.push(`Inicio: ${String(sprint.started_at).slice(0, 10)}`);
  if (sprint.target_close) dates.push(`Meta: ${String(sprint.target_close).slice(0, 10)}`);
  if (dates.length) head.appendChild(makeEl('div', 'panel-sprint-dates', dates.join(' · ')));
  body.appendChild(head);

  const allTasks = (snapshot && Array.isArray(snapshot.active_tasks)) ? snapshot.active_tasks : [];

  // -- HITOS PLANIFICADOS (cruzados con tasks)
  const milestonesSec = section(body, 'HITOS PLANIFICADOS');
  const rawMilestones = extractMilestones(sprint);
  const enriched = crossMilestonesWithTasks(rawMilestones, allTasks);
  if (enriched.length === 0) {
    milestonesSec.appendChild(makeEl('div', 'panel-empty-inline', 'No hay hitos declarados en este sprint.'));
  } else {
    const ul = makeEl('ul', 'panel-milestones-list');
    for (const m of enriched) {
      const li = document.createElement('li');
      let marker;
      if (m.status === 'done') { li.className = 'milestone-done'; marker = '✓'; }
      else if (m.status === 'in_progress') { li.className = 'milestone-progress'; marker = '▶'; }
      else { li.className = 'milestone-planned'; marker = '○'; }
      li.appendChild(makeEl('span', 'milestone-marker', marker));
      li.appendChild(makeEl('span', 'milestone-text', m.title));
      ul.appendChild(li);
    }
    milestonesSec.appendChild(ul);
  }

  // -- TAREAS COMPLETADAS (agrupadas por phase cuando alguna las declara)
  const completed = allTasks.filter(t => t && t.status === 'completed');
  const failed = allTasks.filter(t => t && t.status === 'failed');
  const compSec = section(body, `TAREAS COMPLETADAS (${completed.length})`);
  if (completed.length === 0) {
    compSec.appendChild(makeEl('div', 'panel-empty-inline', 'Aún no hay tareas completadas.'));
  } else {
    // Agrupamos por phase sólo si al menos una task la declara. Si ninguna la
    // tiene, mostramos la lista plana legacy.
    const anyPhase = completed.some(t => typeof t.phase === 'string' && t.phase);
    if (anyPhase) {
      const groups = new Map();
      for (const t of completed.slice(-30)) {
        const key = (typeof t.phase === 'string' && t.phase) ? t.phase : '(sin fase)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }
      for (const [phase, tasks] of groups.entries()) {
        const group = makeEl('div', 'panel-phase-group');
        group.appendChild(makeEl('div', 'panel-phase-label', `FASE: ${phase}`));
        const ul = makeEl('ul', 'panel-completed-list');
        for (const t of tasks) {
          const li = document.createElement('li');
          li.appendChild(makeEl('span', 'completed-agent', t.agent || '—'));
          li.appendChild(document.createTextNode(': '));
          li.appendChild(makeEl('span', 'completed-summary', t.summary || t.title || t.id || ''));
          if (typeof t.epic === 'string' && t.epic) {
            li.appendChild(document.createTextNode(' '));
            li.appendChild(makeEl('span', 'completed-epic', `[${t.epic}]`));
          }
          ul.appendChild(li);
        }
        group.appendChild(ul);
        compSec.appendChild(group);
      }
    } else {
      const ul = makeEl('ul', 'panel-completed-list');
      for (const t of completed.slice(-15)) {
        const li = document.createElement('li');
        li.appendChild(makeEl('span', 'completed-agent', t.agent || '—'));
        li.appendChild(document.createTextNode(': '));
        li.appendChild(makeEl('span', 'completed-summary', t.summary || t.title || t.id || ''));
        ul.appendChild(li);
      }
      compSec.appendChild(ul);
    }
  }

  // -- ENTREGABLES DEL SPRINT (todos los artifacts de todas las tasks).
  const artSec = section(body, 'ENTREGABLES DEL SPRINT');
  const allArtifacts = [];
  for (const t of allTasks) {
    if (!t || !Array.isArray(t.artifacts)) continue;
    for (const a of t.artifacts) {
      if (a && typeof a.path === 'string') allArtifacts.push({ ...a, taskId: t.id, agent: t.agent });
    }
  }
  if (allArtifacts.length === 0) {
    artSec.appendChild(makeEl('div', 'panel-empty-inline', 'Sin entregables registrados.'));
  } else {
    const list = makeEl('ul', 'panel-artifact-list');
    for (const a of allArtifacts.slice(0, 30)) {
      const li = document.createElement('li');
      if (a.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'panel-artifact-thumb';
        img.alt = a.title || a.path;
        img.src = '/files/' + a.path.replace(/^\/+/, '');
        li.appendChild(img);
      }
      const link = document.createElement('a');
      link.className = 'panel-artifact-link';
      link.href = a.kind === 'link' ? a.path : '/files/' + a.path.replace(/^\/+/, '');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = a.title || a.path;
      li.appendChild(link);
      list.appendChild(li);
    }
    artSec.appendChild(list);
  }

  // -- MÉTRICAS
  const metSec = section(body, 'MÉTRICAS');
  const metrics = (snapshot && snapshot.metrics) || {};
  const totalTokens = Number.isFinite(metrics.total_tokens_session)
    ? metrics.total_tokens_session
    : allTasks.reduce((acc, t) => acc + (Number.isFinite(t.tokens_estimated) ? t.tokens_estimated : 0), 0);
  keyValueRow(metSec, 'tokens totales', totalTokens.toLocaleString('es'));
  keyValueRow(metSec, 'tareas done', String(completed.length));
  keyValueRow(metSec, 'tareas failed', String(failed.length));
  keyValueRow(metSec, 'tiempo activo', formatUptime(snapshot));
}

function formatUptime(snapshot) {
  if (!snapshot) return '—';
  // Preferimos derived.uptime_seconds del server; sino, derivamos de session_started_at.
  const derived = snapshot.derived && snapshot.derived.uptime_seconds;
  let seconds = Number.isFinite(derived) ? derived : null;
  if (seconds === null && snapshot.session_started_at) {
    const ts = Date.parse(snapshot.session_started_at);
    if (Number.isFinite(ts)) seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  }
  if (seconds === null || seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------- extracción y cruce de hitos ----------

// Extrae milestones del sprint. Como `roadmap/current-sprint.json` actualmente
// no declara un array de milestones formal, aceptamos varias formas:
//   - sprint.milestones  → array de { title, task_id?, status? }
//   - sprint.hitos       → alias en español
//   - como fallback: derivamos de sprint.tasks[] (cada title es un hito).
// Cada milestone resultante tiene al menos { title }. task_id es opcional.
export function extractMilestones(sprint) {
  if (!sprint || typeof sprint !== 'object') return [];
  const raw = Array.isArray(sprint.milestones)
    ? sprint.milestones
    : (Array.isArray(sprint.hitos) ? sprint.hitos : null);
  if (Array.isArray(raw)) {
    return raw
      .map(m => {
        if (typeof m === 'string') return { title: m };
        if (m && typeof m === 'object') {
          return {
            title: String(m.title || m.text || m.id || ''),
            task_id: m.task_id || m.id || null,
            status: m.status || null,
          };
        }
        return null;
      })
      .filter(m => m && m.title);
  }
  // Fallback: tasks del sprint como milestones implícitos.
  if (Array.isArray(sprint.tasks)) {
    return sprint.tasks
      .filter(t => t && (t.title || t.id))
      .map(t => ({
        title: String(t.title || t.id),
        task_id: t.id || null,
        status: t.status === 'completed' ? 'done' : (t.status === 'in_progress' ? 'in_progress' : null),
      }));
  }
  return [];
}

// Función pura: cruza milestones con el array de tasks del state.
// Devuelve milestones enriquecidos con `status: 'done'|'in_progress'|'planned'`.
// Match en orden:
//   1. milestone.task_id === task.id
//   2. milestone.status declarado explícito (lo respetamos: 'done', 'in_progress')
//   3. milestone.title aprox-match contra task.summary || task.title || task.id
//      (lowercase, trim, comparación de igualdad o inclusión)
//   4. Si nada matchea → 'planned'.
export function crossMilestonesWithTasks(milestones, tasks) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const out = [];
  for (const m of (Array.isArray(milestones) ? milestones : [])) {
    if (!m || !m.title) continue;
    let status = 'planned';
    // 1. task_id exacto.
    if (m.task_id) {
      const t = taskList.find(x => x && x.id === m.task_id);
      if (t) {
        status = mapTaskStatus(t);
      }
    }
    // 2. milestone declara su status explícito.
    if (status === 'planned' && (m.status === 'done' || m.status === 'in_progress')) {
      status = m.status;
    }
    // 3. aprox-match por title.
    if (status === 'planned') {
      const needle = String(m.title).trim().toLowerCase();
      if (needle.length > 0) {
        const t = taskList.find(x => {
          if (!x) return false;
          const haystacks = [x.summary, x.title, x.id].filter(s => typeof s === 'string');
          return haystacks.some(h => {
            const hn = h.trim().toLowerCase();
            if (!hn) return false;
            return hn === needle || hn.includes(needle) || needle.includes(hn);
          });
        });
        if (t) status = mapTaskStatus(t);
      }
    }
    out.push({ title: m.title, task_id: m.task_id || null, status });
  }
  return out;
}

function mapTaskStatus(task) {
  if (!task || !task.status) return 'planned';
  if (task.status === 'completed') return 'done';
  if (task.status === 'running' || task.status === 'in_progress') return 'in_progress';
  return 'planned';
}

// ---------- render: roadmap (fase 7) ----------

// Mini-parser markdown XSS-safe. Soporta:
//   - `# H1`, `## H2`, `### H3` → <h1/h2/h3> con textContent
//   - `- bullet` o `* bullet`   → <ul><li> con textContent (bullets consecutivos
//                                  se agrupan en una sola <ul>).
//   - `**bold**` dentro de líneas → <strong> + texto plano (combinado en spans).
//   - Líneas en blanco          → break visual (<div class="md-blank">).
//   - Comentarios HTML `<!-- ... -->` (inline o de línea) → ignorados.
//   - Cualquier otra línea      → <p> con textContent (con bolds intercalados).
// NUNCA usa innerHTML con el contenido. Cada nodo se crea con createElement y
// el texto se setea con textContent. Esto cumple ADR-02.
export function renderMarkdownToDOM(parent, markdown) {
  if (!parent) return;
  const raw = typeof markdown === 'string' ? markdown : '';
  // Stripping de comentarios HTML (los marcadores `<!-- tasks-start -->` etc.
  // del roadmap.md no son contenido para renderizar).
  const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '');
  const lines = cleaned.split(/\r?\n/);
  let currentList = null;
  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\s+$/, '');
    if (!line.trim()) {
      // Cerramos lista abierta y dibujamos blank visual.
      currentList = null;
      parent.appendChild(makeEl('div', 'md-blank'));
      continue;
    }
    // Headers
    let hMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hMatch) {
      currentList = null;
      const level = hMatch[1].length;
      const h = makeEl('h' + level, 'md-h' + level);
      appendInlineWithBold(h, hMatch[2]);
      parent.appendChild(h);
      continue;
    }
    // Bullets
    const bMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bMatch) {
      if (!currentList) {
        currentList = makeEl('ul', 'md-ul');
        parent.appendChild(currentList);
      }
      const li = document.createElement('li');
      li.className = 'md-li';
      appendInlineWithBold(li, bMatch[1]);
      currentList.appendChild(li);
      continue;
    }
    // Cualquier otra línea: párrafo (cierra lista abierta).
    currentList = null;
    const p = makeEl('p', 'md-p');
    appendInlineWithBold(p, line);
    parent.appendChild(p);
  }
}

// Procesa `**bold**` dentro de una línea, creando spans/strong con textContent.
// NO usa innerHTML. Si el contenido tiene comillas, asteriscos sueltos, etc.,
// quedan como texto plano. El parser corta en pares completos de `**...**`;
// asteriscos no balanceados se preservan literales.
function appendInlineWithBold(el, text) {
  if (!text) { el.appendChild(document.createTextNode('')); return; }
  const re = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      el.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
    }
    const strong = makeEl('strong', 'md-strong', m[1]);
    el.appendChild(strong);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
}

export function renderRoadmap(body, titleEl, roadmap, sprintHistory) {
  clear(body);
  if (titleEl) titleEl.textContent = 'Roadmap';

  // -- Sección 1: render del roadmap.md.
  const mdSec = section(body, 'ROADMAP DEL PROYECTO');
  const mdContainer = makeEl('div', 'panel-roadmap-md');
  const md = roadmap && typeof roadmap.markdown === 'string' ? roadmap.markdown : '';
  if (!md.trim()) {
    mdContainer.appendChild(makeEl('div', 'panel-empty-inline', 'Roadmap vacío o no existe roadmap/roadmap.md.'));
  } else {
    renderMarkdownToDOM(mdContainer, md);
  }
  mdSec.appendChild(mdContainer);

  // -- Sección 2: historial de sprints colapsable.
  const histSec = section(body, 'HISTORIAL DE SPRINTS');
  const hist = Array.isArray(sprintHistory) ? sprintHistory : [];
  if (hist.length === 0) {
    histSec.appendChild(makeEl('div', 'panel-empty-inline', 'Sin sprints históricos aún.'));
  } else {
    const wrap = makeEl('div', 'panel-sprint-history');
    for (const s of hist) {
      const details = document.createElement('details');
      details.className = 'panel-sprint-entry';
      const summary = document.createElement('summary');
      summary.className = 'panel-sprint-entry-summary';
      const num = makeEl('span', 'panel-sprint-entry-number', `Sprint ${s.number}`);
      summary.appendChild(num);
      const dateRange = formatSprintRange(s.dates);
      if (dateRange) {
        summary.appendChild(document.createTextNode(' '));
        summary.appendChild(makeEl('span', 'panel-sprint-entry-dates', dateRange));
      }
      details.appendChild(summary);
      const inner = makeEl('div', 'panel-sprint-entry-body');
      if (s.objective) {
        inner.appendChild(makeEl('div', 'panel-sprint-entry-objective', s.objective));
      }
      const deliv = Array.isArray(s.deliverables) ? s.deliverables : [];
      if (deliv.length > 0) {
        inner.appendChild(makeEl('div', 'panel-sprint-entry-label', 'ENTREGABLES'));
        const ul = makeEl('ul', 'panel-sprint-entry-list');
        for (const d of deliv) {
          ul.appendChild(makeEl('li', null, d));
        }
        inner.appendChild(ul);
      }
      const lessons = Array.isArray(s.lessons) ? s.lessons : [];
      if (lessons.length > 0) {
        inner.appendChild(makeEl('div', 'panel-sprint-entry-label', 'LESSONS'));
        const ul = makeEl('ul', 'panel-sprint-entry-list');
        for (const l of lessons) {
          ul.appendChild(makeEl('li', null, l));
        }
        inner.appendChild(ul);
      }
      details.appendChild(inner);
      wrap.appendChild(details);
    }
    histSec.appendChild(wrap);
  }
}

function formatSprintRange(dates) {
  if (!dates || typeof dates !== 'object') return '';
  const s = dates.start ? String(dates.start).slice(0, 10) : '';
  const e = dates.end ? String(dates.end).slice(0, 10) : '';
  if (s && e) return `(${s} → ${e})`;
  if (s) return `(${s})`;
  if (e) return `(${e})`;
  return '';
}
