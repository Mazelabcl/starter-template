// review-app/public/app.js
// Frontend mínimo. Scroll preservation: NO usamos location.reload — solo updates
// locales + POST async. XSS-safe: TODO contenido del bloque o comments va por
// textContent. NUNCA innerHTML con datos del backend.

const healthEl = document.getElementById('health');
const sprintListEl = document.getElementById('sprint-list');
const emptyEl = document.getElementById('empty');
const blockViewEl = document.getElementById('block-view');
const blockTitleEl = document.getElementById('block-title');
const blockContentEl = document.getElementById('block-content');
const testsEl = document.getElementById('tests');

let activeSprint = null;
let activeBloque = null;

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function loadHealth() {
  try {
    const j = await fetchJSON('/api/health');
    // textContent only — datos del backend.
    healthEl.textContent = `${j.sprints_loaded} sprints · data: ${j.data_dir}`;
  } catch (e) {
    healthEl.textContent = `error: ${e.message}`;
  }
}

async function loadSprints() {
  try {
    const sprints = await fetchJSON('/api/sprints');
    while (sprintListEl.firstChild) sprintListEl.removeChild(sprintListEl.firstChild);
    for (const s of sprints) {
      const li = document.createElement('li');
      li.dataset.sprintId = String(s.id);
      const title = document.createElement('div');
      // textContent only.
      title.textContent = `Sprint ${s.id} — ${s.title}`;
      li.appendChild(title);
      const meta = document.createElement('small');
      meta.style.color = '#64748b';
      meta.textContent = `${s.block_count} bloques`;
      li.appendChild(meta);
      li.addEventListener('click', () => selectSprint(s.id, li));
      sprintListEl.appendChild(li);
    }
  } catch (e) {
    console.error('loadSprints:', e);
  }
}

async function selectSprint(sprintId, li) {
  // Marcar visualmente.
  for (const sib of sprintListEl.children) sib.classList.remove('active');
  if (li) li.classList.add('active');
  activeSprint = sprintId;
  activeBloque = null;
  try {
    const j = await fetchJSON(`/api/sprint/${sprintId}`);
    // Limpia bloques previos.
    let existingBlocks = li.querySelector('.sprint-blocks');
    if (existingBlocks) existingBlocks.remove();
    const ul = document.createElement('ul');
    ul.className = 'sprint-blocks';
    for (const b of j.blocks) {
      const sub = document.createElement('li');
      // textContent only.
      sub.textContent = `Bloque ${b.number} — ${b.filename}`;
      sub.style.cursor = 'pointer';
      sub.addEventListener('click', (e) => { e.stopPropagation(); selectBloque(sprintId, b.number); });
      ul.appendChild(sub);
    }
    li.appendChild(ul);
  } catch (e) {
    console.error('selectSprint:', e);
  }
}

async function selectBloque(sprintId, bloqueNumber) {
  activeBloque = bloqueNumber;
  emptyEl.hidden = true;
  blockViewEl.hidden = false;
  blockTitleEl.textContent = `Sprint ${sprintId} · Bloque ${bloqueNumber}`;
  try {
    const j = await fetchJSON(`/api/bloque/${sprintId}/${bloqueNumber}`);
    // textContent only — bloque markdown raw.
    blockContentEl.textContent = j.content;
    // Tests: detección heurística de checkboxes `- [ ]` o `- [x]`.
    const tests = parseTests(j.content);
    const review = await fetchJSON(`/api/review/${sprintId}/${bloqueNumber}`).catch(() => ({ decisions: [] }));
    renderTests(tests, review.decisions || [], sprintId, bloqueNumber);
  } catch (e) {
    console.error('selectBloque:', e);
    blockContentEl.textContent = `error: ${e.message}`;
  }
}

function parseTests(md) {
  if (typeof md !== 'string') return [];
  const out = [];
  const lines = md.split(/\r?\n/);
  let idx = 0;
  for (const line of lines) {
    const m = /^[-*]\s+\[(\s|x|X)\]\s+(.+)$/.exec(line);
    if (m) {
      out.push({ index: idx, text: m[2].trim() });
      idx += 1;
    }
  }
  return out;
}

function renderTests(tests, decisions, sprintId, bloqueNumber) {
  while (testsEl.firstChild) testsEl.removeChild(testsEl.firstChild);
  if (tests.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = '#64748b';
    empty.textContent = 'no detecté tests checkbox en este bloque.';
    testsEl.appendChild(empty);
    return;
  }
  const decisionByIdx = new Map();
  for (const d of decisions) decisionByIdx.set(d.test_index, d);
  for (const t of tests) {
    const wrap = document.createElement('div');
    wrap.className = 'test-item';
    const prior = decisionByIdx.get(t.index);
    if (prior) wrap.classList.add(prior.status);

    const body = document.createElement('div');
    body.className = 'test-body';
    body.textContent = `[${t.index + 1}] ${t.text}`; // textContent only.
    wrap.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'test-actions';

    const btnOk = document.createElement('button');
    btnOk.className = 'btn btn-ok' + (prior?.status === 'ok' ? ' active' : '');
    btnOk.type = 'button';
    btnOk.textContent = 'OK';

    const btnFb = document.createElement('button');
    btnFb.className = 'btn btn-feedback' + (prior?.status === 'feedback' ? ' active' : '');
    btnFb.type = 'button';
    btnFb.textContent = 'Feedback';

    const input = document.createElement('input');
    input.className = 'comment-input';
    input.type = 'text';
    input.placeholder = 'comentario opcional';
    input.value = prior?.comment || '';

    btnOk.addEventListener('click', () => save(sprintId, bloqueNumber, t.index, 'ok', input.value, wrap, btnOk, btnFb));
    btnFb.addEventListener('click', () => save(sprintId, bloqueNumber, t.index, 'feedback', input.value, wrap, btnOk, btnFb));

    actions.appendChild(btnOk);
    actions.appendChild(btnFb);
    actions.appendChild(input);
    wrap.appendChild(actions);
    testsEl.appendChild(wrap);
  }
}

async function save(sprintId, bloqueNumber, testIndex, status, comment, wrap, btnOk, btnFb) {
  // Scroll preservation: NO reload. POST async + update local.
  const scrollY = window.scrollY;
  try {
    await fetchJSON(`/api/review/${sprintId}/${bloqueNumber}/${testIndex}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, comment }),
    });
    // Update visual local.
    wrap.classList.remove('ok', 'feedback');
    wrap.classList.add(status);
    btnOk.classList.toggle('active', status === 'ok');
    btnFb.classList.toggle('active', status === 'feedback');
  } catch (e) {
    console.error('save:', e);
    alert(`no pude guardar: ${e.message}`);
  } finally {
    window.scrollTo(0, scrollY);
  }
}

await loadHealth();
await loadSprints();
