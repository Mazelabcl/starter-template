// scripts/build_resumen.js
// Genera un RESUMEN.html autocontenido (DATOS INLINE, sin fetch) a partir del
// estado actual del proyecto. Debe abrir con doble-click — sin servidor, sin CORS.
//
// Lee (todos opcionales, degrada con gracia si falta alguno):
//   - roadmap/current-sprint.json   → sprint vivo + tareas + ideas crudas
//   - memory/decisions.md           → decisiones registradas
//   - dashboard/history/events.log  → totales de tokens y costo USD de APIs
//
// El TLDR narrativo y las "próximas acciones" NO los infiere el script: vienen
// por argv (el orquestador los redacta en lenguaje no técnico). Si no se pasan,
// deja un placeholder claro que el orquestador rellena.
//
// Uso:
//   node scripts/build_resumen.js "<tldr en lenguaje no técnico>"
//   node scripts/build_resumen.js "<tldr>" "<acción 1>" "<acción 2>" ...
//
// Salida: RESUMEN.html en la raíz del repo. Imprime la ruta al terminar.
// Idioma: español neutro.

import {
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CURRENT_SPRINT_PATH = join(REPO_ROOT, 'roadmap', 'current-sprint.json');
const DECISIONS_PATH = join(REPO_ROOT, 'memory', 'decisions.md');
const EVENTS_LOG_PATH = join(REPO_ROOT, 'dashboard', 'history', 'events.log');
const OUTPUT_PATH = join(REPO_ROOT, 'RESUMEN.html');

// Escapa para insertar texto plano como contenido HTML seguro.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

// ---- lectores defensivos (degradan a defaults si falta o está corrupto) ----

function readSprint() {
  if (!existsSync(CURRENT_SPRINT_PATH)) return null;
  try {
    const raw = readFileSync(CURRENT_SPRINT_PATH, 'utf8');
    if (!raw.trim()) return null;
    const data = JSON.parse(raw);
    return {
      number: typeof data.number === 'number' ? data.number : null,
      objective: typeof data.objective === 'string' ? data.objective : '',
      started_at: data.started_at || '',
      target_close: data.target_close || '',
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      ideas: Array.isArray(data.backlog_added_during_sprint) ? data.backlog_added_during_sprint : [],
    };
  } catch {
    return null;
  }
}

// Parsea memory/decisions.md → [{ title, fields: { Decisión, Razón, ... } }].
// El formato lo escribe src/memory.js addDecision(): `## YYYY-MM-DD: title` +
// líneas `**Campo:** valor`.
function readDecisions() {
  if (!existsSync(DECISIONS_PATH)) return [];
  let raw = '';
  try { raw = readFileSync(DECISIONS_PATH, 'utf8'); } catch { return []; }
  const lines = raw.split(/\r?\n/);
  const out = [];
  let current = null;
  for (const line of lines) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      if (current) out.push(current);
      current = { title: h[1].trim(), fields: {} };
      continue;
    }
    if (!current) continue;
    const f = /^\*\*([^:*]+):\*\*\s*(.*)$/.exec(line);
    if (f) current.fields[f[1].trim()] = f[2].trim();
  }
  if (current) out.push(current);
  return out;
}

// Agrega tokens y costo USD desde events.log (NDJSON). Cada línea es
// { timestamp, type, payload }. Sumamos payload.tokens y payload.cost_usd de los
// eventos task_completed. Best-effort: líneas corruptas se saltan.
function readTotalsFromEvents() {
  const totals = { tokens: 0, cost_usd: 0, events_count: 0, has_log: false };
  if (!existsSync(EVENTS_LOG_PATH)) return totals;
  totals.has_log = true;
  let raw = '';
  try { raw = readFileSync(EVENTS_LOG_PATH, 'utf8'); } catch { return totals; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    totals.events_count += 1;
    const p = ev && ev.payload ? ev.payload : {};
    if (Number.isFinite(p.tokens)) totals.tokens += p.tokens;
    if (Number.isFinite(p.cost_usd)) totals.cost_usd += p.cost_usd;
  }
  return totals;
}

// ---- render de secciones (HTML inline, sin fetch) ----

function renderTldr(tldr) {
  const body = tldr
    ? `<p class="lead">${esc(tldr)}</p>`
    : `<p class="lead" style="color:var(--amber)">[PLACEHOLDER — el orquestador rellena el TLDR en lenguaje no técnico al ejecutar este comando.]</p>`;
  return `
  <div class="card tldr">
    <h2>📌 TL;DR</h2>
    ${body}
  </div>`;
}

function renderActions(actions) {
  let items;
  if (actions.length) {
    items = actions.map(a => `<li class="do">${esc(a)}</li>`).join('\n      ');
  } else {
    items = `<li class="do" style="color:var(--amber)">[PLACEHOLDER — el orquestador lista aquí las próximas acciones en lenguaje no técnico.]</li>`;
  }
  return `
  <div class="card action">
    <h2>⚡ Próximas acciones</h2>
    <ul>
      ${items}
    </ul>
  </div>`;
}

function renderSprint(sprint) {
  if (!sprint || (!sprint.objective && !sprint.tasks.length)) {
    return `
  <div class="card">
    <h2>🏃 Sprint</h2>
    <p class="muted">Sin sprint activo o sin objetivo declarado. Corre <code>/kickoff</code> o <code>/roadmap</code> para abrir uno.</p>
  </div>`;
  }
  const head = `<p><b>Sprint ${esc(sprint.number ?? '?')}</b> — ${esc(sprint.objective || '(sin objetivo declarado)')}</p>`;
  const completed = sprint.tasks.filter(t => t && t.status === 'completed');
  const pending = sprint.tasks.filter(t => t && t.status !== 'completed');
  const taskList = sprint.tasks.length
    ? sprint.tasks.map(t => {
        const cls = t.status === 'completed' ? 'ok' : 'do';
        return `<li class="${cls}">${esc(t.title || t.id || '(sin título)')}</li>`;
      }).join('\n      ')
    : '<li class="muted">Sin tareas registradas en este sprint.</li>';
  const ideasBlock = sprint.ideas.length
    ? `<p class="muted" style="margin-top:12px">Ideas crudas capturadas:</p>
       <ul>${sprint.ideas.map(i => `<li>${esc(i.idea || '')}</li>`).join('')}</ul>`
    : '';
  return `
  <div class="card">
    <h2>🏃 Sprint</h2>
    ${head}
    <p class="muted">Tareas: ${completed.length} completadas · ${pending.length} pendientes</p>
    <ul>
      ${taskList}
    </ul>
    ${ideasBlock}
  </div>`;
}

function renderDecisions(decisions) {
  if (!decisions.length) {
    return `
  <div class="card">
    <h2>🧭 Decisiones</h2>
    <p class="muted">Sin decisiones registradas aún en <code>memory/decisions.md</code>.</p>
  </div>`;
  }
  const items = decisions.map(d => {
    const decision = d.fields['Decisión'] || d.fields['Decision'] || '';
    const reason = d.fields['Razón'] || d.fields['Razon'] || '';
    const inner = [
      decision ? `<p><b>Decisión:</b> ${esc(decision)}</p>` : '',
      reason ? `<p class="muted"><b>Razón:</b> ${esc(reason)}</p>` : '',
    ].filter(Boolean).join('\n        ');
    return `<details>
      <summary>${esc(d.title)}</summary>
      <div class="body">
        ${inner || '<p class="muted">(sin detalle)</p>'}
      </div>
    </details>`;
  }).join('\n    ');
  return `
  <div class="card">
    <h2>🧭 Decisiones (${decisions.length})</h2>
    ${items}
  </div>`;
}

function renderTotals(totals) {
  if (!totals.has_log) {
    return `
  <div class="card">
    <h2>📊 Consumo</h2>
    <p class="muted">Sin historial de eventos (<code>dashboard/history/events.log</code> no existe todavía).</p>
  </div>`;
  }
  return `
  <div class="card">
    <h2>📊 Consumo de la sesión</h2>
    <table>
      <tr><td>Tokens</td><td>${esc(totals.tokens.toLocaleString('es'))}</td></tr>
      <tr><td>USD APIs</td><td>$${totals.cost_usd.toFixed(2)} <span class="muted">(solo OpenRouter/Replicate, no los tokens de Claude Code)</span></td></tr>
      <tr><td>Eventos</td><td>${esc(String(totals.events_count))}</td></tr>
    </table>
  </div>`;
}

// ---- template completo (mismo estilo visual que RESUMEN-v4.html) ----

function buildHtml({ tldr, actions, sprint, decisions, totals }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Resumen del proyecto</title>
<style>
  :root{
    --bg:#0e1116; --card:#161b22; --card2:#1c2230; --border:#2a3140;
    --text:#e6edf3; --muted:#9aa7b8; --faint:#6b7888;
    --accent:#5db0ff; --green:#3fb950; --amber:#e3b341; --red:#f47067;
    --radius:14px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    line-height:1.55; padding:32px 16px; max-width:880px; margin:0 auto;
  }
  h1{font-size:26px; margin-bottom:4px}
  .sub{color:var(--faint); font-size:14px; margin-bottom:28px}
  h2{font-size:18px; margin:0 0 14px; display:flex; align-items:center; gap:8px}
  .card{background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:22px 24px; margin-bottom:18px}
  .tldr{background:linear-gradient(135deg,#16202e,#1a1f2e); border-color:#2d3b52}
  .action{background:#1d1a10; border-color:#4a3d18}
  .action h2{color:var(--amber)}
  p{margin-bottom:10px; color:var(--text)}
  .muted{color:var(--muted); font-size:14.5px}
  ul{margin:6px 0 6px 4px; list-style:none}
  li{margin-bottom:10px; padding-left:24px; position:relative; color:var(--text)}
  li::before{content:"›"; position:absolute; left:6px; color:var(--accent); font-weight:bold}
  li.do::before{content:"☐"; color:var(--amber)}
  li.ok::before{content:"✓"; color:var(--green)}
  code{background:#0a0d12; border:1px solid var(--border); border-radius:6px; padding:2px 7px; font-family:"SF Mono",Consolas,monospace; font-size:13px; color:#9ad1ff}
  details{margin-bottom:10px; border:1px solid var(--border); border-radius:10px; background:var(--card2); overflow:hidden}
  summary{padding:13px 16px; cursor:pointer; font-weight:600; user-select:none; list-style:none}
  summary::-webkit-details-marker{display:none}
  summary::before{content:"▸ "; color:var(--accent)}
  details[open] summary::before{content:"▾ "}
  details .body{padding:4px 18px 16px}
  .footer{color:var(--faint); font-size:13px; text-align:center; margin-top:24px}
  b{color:#fff}
  .lead{font-size:16px}
  table{width:100%; border-collapse:collapse; margin:8px 0}
  td{padding:7px 8px; border-bottom:1px solid var(--border); font-size:14px; vertical-align:top}
  td:first-child{color:var(--accent); font-family:monospace; white-space:nowrap; width:120px}
</style>
</head>
<body>

  <h1>Resumen del proyecto</h1>
  <div class="sub">Generado ${esc(nowStamp())} · autocontenido (abre con doble-click)</div>
${renderTldr(tldr)}
${renderActions(actions)}
${renderSprint(sprint)}
${renderDecisions(decisions)}
${renderTotals(totals)}

  <div class="footer">
    Generado por <code>scripts/build_resumen.js</code> · datos inline, sin servidor
  </div>

</body>
</html>
`;
}

function main() {
  const argv = process.argv.slice(2);
  const tldr = argv.length ? argv[0] : '';
  const actions = argv.slice(1);

  const sprint = readSprint();
  const decisions = readDecisions();
  const totals = readTotalsFromEvents();

  const html = buildHtml({ tldr, actions, sprint, decisions, totals });
  writeFileSync(OUTPUT_PATH, html, 'utf8');

  console.log(`[build_resumen] ok: ${OUTPUT_PATH}`);
  if (!tldr) {
    console.log('[build_resumen] aviso: TLDR vacío — el HTML quedó con placeholder. Pásalo como primer argumento.');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}

export { readSprint, readDecisions, readTotalsFromEvents, buildHtml, OUTPUT_PATH };
