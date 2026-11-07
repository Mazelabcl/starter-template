// cockpit/public/app.js
// Frontend del cockpit: inicio como línea de tiempo de sprints, revisiones como
// presentación a pantalla completa (una idea por lámina) y ayuda "Qué puedo pedir".
// Reglas:
//  - XSS-safe: TODO dato del backend entra por textContent / atributos seguros.
//    Nunca innerHTML con datos. El markdown se convierte a nodos DOM a mano.
//  - La key de OpenAI nunca llega aquí: el server entrega un client secret
//    efímero (ek_...) por conversación.
// Idioma: español neutro.

import { el, icon, renderVisual, miniVisual, mediaNode, mediaUrl, diagramNode, isTallScreen } from './visuals.js';
import { loadUso } from './uso.js';

const $ = id => document.getElementById(id);

const state = {
  status: null,
  review: null,
  items: {},          // item_id -> { vote, comment }
  conversation: [],   // [{ who: 'usuario'|'guia', text }]
  summary: null,
  dirty: false,
  savedAt: null,
  talk: null,         // sesión de conversación activa
  index: 0,           // lámina actual
  slides: [],         // [{ item, node } | { closing: true, node }]
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------------------------------------------------------------------------
// Markdown mínimo → DOM (seguro)
// ---------------------------------------------------------------------------

function inline(text) {
  const frag = document.createDocumentFragment();
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (m[1]) frag.appendChild(el('code', { text: tok.slice(1, -1) }));
    else if (m[2]) frag.appendChild(el('strong', { text: tok.slice(2, -2) }));
    else if (m[3]) frag.appendChild(el('em', { text: tok.slice(1, -1) }));
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm[2];
      if (/^https?:\/\//i.test(href)) frag.appendChild(el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: lm[1] }));
      else frag.appendChild(document.createTextNode(lm[1]));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

const tableCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

function renderMarkdown(md) {
  const root = el('div', { class: 'md' });
  const lines = String(md || '').split(/\r?\n/);
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) { root.appendChild(el('p', {}, inline(para.join(' ')))); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (/^```/.test(t)) {
      flush();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i += 1; }
      i += 1;
      root.appendChild(el('pre', {}, el('code', { text: code.join('\n') })));
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(t);
    if (h) { flush(); root.appendChild(el(`h${Math.min(4, h[1].length + 1)}`, {}, inline(h[2]))); i += 1; continue; }
    if (/^\|.*\|$/.test(t) && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
      flush();
      const head = el('tr', {}, tableCells(t).map(c => el('th', {}, inline(c))));
      const body = el('tbody');
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        body.appendChild(el('tr', {}, tableCells(lines[i]).map(c => el('td', {}, inline(c)))));
        i += 1;
      }
      root.appendChild(el('div', { class: 'md-table' }, el('table', {}, el('thead', {}, head), body)));
      continue;
    }
    if (/^[-*]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      flush();
      const ordered = /^\d+[.)]\s+/.test(t);
      const list = el(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const lt = lines[i].trim();
        const mm = ordered ? /^\d+[.)]\s+(.+)$/.exec(lt) : /^[-*]\s+(.+)$/.exec(lt);
        if (!mm) break;
        list.appendChild(el('li', {}, inline(mm[1])));
        i += 1;
      }
      root.appendChild(list);
      continue;
    }
    if (!t) { flush(); i += 1; continue; }
    para.push(t);
    i += 1;
  }
  flush();
  return root;
}

// ---------------------------------------------------------------------------
// Inicio: línea de tiempo de sprints con una miniatura por revisión
// ---------------------------------------------------------------------------

function thumbCard(r) {
  const pic = el('div', { class: 'thumb-pic' });
  if (r.cover && r.cover.type === 'image') pic.appendChild(el('img', { src: mediaUrl(r.cover.path), alt: '', loading: 'lazy' }));
  else if (r.cover && r.cover.type === 'diagram') pic.appendChild(diagramNode(r.cover.visual, { layout: 'wide' }));
  else pic.appendChild(el('div', { class: 'thumb-empty' }, icon('image', 40)));
  const total = r.item_count || 1;
  if (r.feedback_status === 'sin-feedback') pic.appendChild(el('span', { class: 'thumb-flag', text: 'Te espera' }));
  else if (r.feedback_status === 'pendiente') pic.appendChild(el('span', { class: 'thumb-flag thumb-flag-wait', text: 'Votada' }));
  else pic.appendChild(el('span', { class: 'thumb-flag thumb-flag-ok', text: 'Aplicada' }));
  const bar = el('div', { class: 'thumb-progress' }, el('span'));
  bar.firstChild.style.width = `${Math.min(100, Math.round(((r.voted_count || 0) / total) * 100))}%`;
  return el('a', { class: 'thumb', href: `#/r/${encodeURIComponent(r.id)}`, title: r.title },
    pic,
    el('div', { class: 'thumb-body' }, el('div', { class: 'thumb-title', text: r.title }), bar));
}

/** Agrupa revisiones por sprint: pasado, actual y lo que sigue. */
function timelineColumns(rm, reviews) {
  const done = new Map((rm.done || []).map(s => [s.number, s]));
  const active = rm.now && rm.now.objective ? rm.now : null;
  const numbers = new Set([...done.keys(), ...reviews.filter(r => r.sprint !== null && r.sprint !== undefined).map(r => r.sprint)]);
  if (active) numbers.add(active.number);
  const open = [...numbers].filter(n => !done.has(n));
  const current = active ? active.number : (open.length ? Math.max(...open) : null);
  const columns = [...numbers].sort((a, b) => a - b).map(n => ({
    number: n,
    state: n === current ? 'now' : n > (current ?? Infinity) ? 'next' : 'past',
    name: done.get(n)?.title || (n === active?.number ? active.objective : ''),
    reviews: reviews.filter(r => r.sprint === n),
  }));
  const loose = reviews.filter(r => r.sprint === null || r.sprint === undefined);
  const nowCol = columns.find(c => c.state === 'now');
  if (nowCol) nowCol.reviews.push(...loose);
  else if (loose.length || !columns.length) columns.push({ number: null, state: 'now', name: '', reviews: loose });
  return columns;
}

function timelineLabel(c) {
  if (c.number === 0) return 'Arranque';
  return c.number === null ? 'Ahora' : `Sprint ${c.number}`;
}

async function loadHome() {
  const [rm, reviews] = await Promise.all([
    api('/api/roadmap').catch(() => ({ done: [], now: null, next: {} })),
    api('/api/reviews').catch(() => []),
  ]);
  const waiting = reviews.filter(r => r.feedback_status === 'sin-feedback').length;
  const title = $('home-title');
  clear(title);
  if (!reviews.length) title.textContent = 'Todavía no hay revisiones';
  else if (waiting) title.append(el('em', { text: String(waiting) }), waiting === 1 ? ' revisión te espera' : ' revisiones te esperan');
  else title.textContent = 'Todo votado';

  const box = $('timeline');
  clear(box);
  for (const c of timelineColumns(rm, reviews)) {
    const col = el('section', { class: `tl-col tl-col-${c.state}${c.reviews.length > 1 ? ' tl-col-wide' : ''}` },
      el('div', { class: 'tl-head' },
        el('span', { class: 'tl-dot' }),
        el('span', { class: 'tl-kicker', text: timelineLabel(c) }),
        c.state === 'now' && c.number !== null ? el('span', { class: 'pill pill-ok', text: 'Ahora' }) : null,
        c.name ? el('span', { class: 'tl-name', text: c.name }) : null),
      el('div', { class: 'tl-cards' }, c.reviews.map(thumbCard)));
    box.appendChild(col);
  }
  const upcoming = [...(rm.next?.preview || []), ...(rm.next?.high_priority || [])].slice(0, 3);
  box.appendChild(el('section', { class: 'tl-col tl-col-next' },
    el('div', { class: 'tl-head' }, el('span', { class: 'tl-dot' }), el('span', { class: 'tl-kicker', text: 'Sigue' })),
    el('div', { class: 'tl-cards' }, upcoming.length
      ? upcoming.map(n => el('div', { class: 'next-chip', text: n }))
      : [el('div', { class: 'next-chip', text: 'Nada priorizado todavía' })])));
  // Con muchos sprints la línea se desborda: parte mostrando el actual.
  const now = box.querySelector('.tl-col-now');
  if (now && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, now.offsetLeft - box.offsetLeft - 24);
}

// ---------------------------------------------------------------------------
// Qué puedo pedir
// ---------------------------------------------------------------------------

function sayRow(phrase, label) {
  const copy = el('button', {
    class: 'say-copy', type: 'button', 'aria-label': 'Copiar la frase', title: 'Copiar la frase',
    onclick: async () => {
      try { await navigator.clipboard.writeText(phrase); toast('Frase copiada. Pégala en tu chat con Claude.'); }
      catch { toast(`Dile a Claude: ${phrase}`); }
    },
  }, icon('copy', 18));
  return el('div', { class: 'say' },
    el('div', { class: 'say-text' }, el('span', { class: 'say-label', text: label || 'Dile a Claude' }), phrase),
    copy);
}

let capabilities = null;
async function loadHelp() {
  const box = $('help-cards');
  if (!capabilities) {
    try { capabilities = await api('/capacidades.json'); }
    catch (e) { box.textContent = `No pude cargar la ayuda: ${e.message}`; return; }
  }
  clear(box);
  for (const c of capabilities.cards || []) {
    const card = el('article', { class: 'help-card', id: `cap-${c.id}` },
      el('h2', { text: c.title }),
      c.tag ? el('p', { class: 'help-tag', text: c.tag }) : null,
      c.diagram ? diagramNode(c.diagram, { layout: isTallScreen() ? 'tall' : 'wide', density: 'compact' }) : null);
    if (Array.isArray(c.modes)) card.appendChild(el('div', { class: 'help-modes' }, c.modes.map(m => sayRow(m.phrase, m.label))));
    else if (c.phrase) card.appendChild(sayRow(c.phrase));
    if (c.more) card.appendChild(el('details', { class: 'help-more' }, el('summary', { text: 'Ver más' }), renderMarkdown(c.more)));
    box.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Feedback: se guarda solo
// ---------------------------------------------------------------------------

const fbOf = id => state.items[id] || (state.items[id] = { vote: null, comment: '' });

/** Opción elegida de un `compare`: la dicen los votos, así el feedback no cambia de forma. */
function pickedOption(item) {
  for (const o of item.visual?.options || []) {
    if (o.item) { if (state.items[o.item]?.vote === 'up') return o.id; }
    else if (state.items[item.id]?.vote === 'up' && (state.items[item.id].comment || '').startsWith(`Elegida: ${o.label}`)) return o.id;
  }
  return null;
}

function pickOption(item, option) {
  const already = pickedOption(item) === option.id;
  const options = item.visual.options;
  for (const o of options) if (o.item) fbOf(o.item).vote = null;
  const own = fbOf(item.id);
  const rest = (own.comment || '').replace(/^Elegida: .*\n?/, '');
  if (options.some(o => !o.item)) { own.vote = null; own.comment = rest; }
  if (!already) {
    if (option.item) fbOf(option.item).vote = 'up';
    else { own.vote = 'up'; own.comment = `Elegida: ${option.label}${rest ? `\n${rest}` : ''}`; }
  }
  markDirty();
  paintBar();
}

function slideVote(item) {
  if (item.visual?.type === 'compare') return pickedOption(item) ? 'up' : null;
  return state.items[item.id]?.vote || null;
}

function votedCount() {
  return state.slides.filter(s => s.item && slideVote(s.item)).length;
}

function updateSaveStatus() {
  const total = state.slides.filter(s => s.item).length;
  const parts = [`${votedCount()} de ${total}`];
  if (state.dirty) parts.push('guardando…');
  else if (state.savedAt) parts.push('guardado');
  $('save-status').textContent = parts.join(' · ');
}

let saveTimer = null;
function markDirty() {
  state.dirty = true;
  updateSaveStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveFeedback(true), 500);
}

function feedbackBody() {
  return JSON.stringify({ items: state.items, conversation: state.conversation, summary: state.summary });
}

async function saveFeedback(silent = false) {
  if (!state.review) return;
  clearTimeout(saveTimer);
  try {
    const fb = await api(`/api/feedback/${encodeURIComponent(state.review.id)}`, { method: 'POST', body: feedbackBody() });
    state.dirty = false;
    state.savedAt = fb.saved_at;
    $('btn-save').hidden = true;
    updateSaveStatus();
    if (!silent) toast('Feedback guardado. El orquestador lo leerá al continuar.');
  } catch (e) {
    $('btn-save').hidden = false;
    toast(`No se pudo guardar: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

function slideHeadline(item) { return item.headline || item.title; }

function slideAsk(item) {
  if (item.ask) return item.ask;
  if (item.visual?.type === 'compare') return 'Elige una';
  return state.review.kind === 'rounds' ? '¿Te gusta?' : '¿Lo apruebas?';
}

function buildItemSlide(item) {
  const text = slideHeadline(item);
  const long = text.split(/\s+/).length > 12;
  const main = el('div', { class: 'slide-main' },
    el('div', { class: 'slide-visual' }, renderVisual(item, {
      pick: option => pickOption(item, option),
      pickedOption: () => pickedOption(item),
    })));
  if (Array.isArray(item.stats) && item.stats.length) {
    main.appendChild(el('div', { class: 'stats' }, item.stats.slice(0, 3).map(s => el('div', { class: 'stat' },
      el('span', { class: 'stat-value', text: String(s.value) }),
      el('span', { class: 'stat-label', text: s.label })))));
  }
  // Lámina de resumen: chip de veredicto, una línea de "qué gana" y botón Probar.
  const tryHref = item.try && state.review
    ? `/probar/${encodeURIComponent(state.review.id)}/${encodeURIComponent(item.id)}/${encodeURIComponent(String(item.try.path).split('/').pop())}`
    : null;
  const extras = (item.gain || tryHref) ? el('div', { class: 'slide-gain-row' },
    item.gain ? el('p', { class: 'slide-gain', text: item.gain }) : null,
    tryHref ? el('a', { class: 'btn btn-primary btn-try', href: tryHref, target: '_blank', rel: 'noopener' }, icon('rocket', 16), item.try.label || 'Probar') : null) : null;
  return el('article', { class: 'slide', hidden: true },
    el('div', { class: 'slide-head' },
      (item.kicker || item.chip) ? el('p', { class: 'kicker' },
        item.kicker || '',
        item.chip ? el('span', { class: `chip chip-${item.chip.tone || 'info'}`, text: item.chip.text }) : null) : null,
      el('h1', { class: `headline${long ? ' headline-long' : ''}`, text }),
      extras),
    main);
}

function renderSummary() {
  const box = $('summary-box');
  if (!box) return;
  clear(box);
  const s = state.summary;
  if (!s) { box.hidden = true; return; }
  box.hidden = false;
  box.appendChild(el('h3', { text: 'Resumen de la conversación' }));
  const sec = (title, arr) => {
    if (!arr || !arr.length) return;
    box.appendChild(el('h4', { text: title }));
    box.appendChild(el('ul', {}, arr.map(x => el('li', { text: x }))));
  };
  sec('Decisiones', s.decisions);
  sec('Preguntas abiertas', s.open_questions);
  sec('Pedidos nuevos', s.requests);
  if (!s.decisions.length && !s.open_questions.length && !s.requests.length) box.appendChild(el('p', { text: 'Sin decisiones registradas.' }));
}

function buildClosing() {
  const node = el('article', { class: 'slide closing', hidden: true });
  const paint = () => {
    clear(node);
    const items = state.slides.filter(s => s.item);
    const voted = votedCount();
    node.appendChild(el('div', { class: 'slide-head' },
      el('p', { class: 'kicker', text: 'Listo' }),
      el('h1', { class: 'headline', text: `${voted} de ${items.length} votadas` })));
    node.appendChild(el('div', { class: 'closing-grid' }, items.map((s, i) => {
      const vote = slideVote(s.item);
      return el('button', {
        class: `closing-tile${vote ? ` closing-${vote}` : ''}`, type: 'button',
        onclick: () => goTo(i),
      },
      el('span', { class: 'closing-pic' }, miniVisual(s.item)),
      el('span', { class: 'closing-foot' },
        el('span', { class: 'closing-mark' }, vote ? icon(vote, 16) : String(i + 1)),
        el('span', { class: 'closing-name', text: slideHeadline(s.item) })));
    })));
    node.appendChild(el('div', { class: 'closing-actions' },
      el('a', { class: 'btn btn-primary btn-top', href: '#/' }, 'Volver al inicio'),
      el('button', { class: 'btn', type: 'button', onclick: openTalkPanel }, 'Conversar por voz')));
    node.appendChild(el('div', { id: 'summary-box', class: 'summary-box', hidden: true }));
    renderSummary();
  };
  return { node, paint };
}

function renderDeck(keepIndex = 0) {
  const r = state.review;
  const stage = $('deck-stage');
  clear(stage);
  const closing = buildClosing();
  state.slides = r.items.map(item => ({ item, node: buildItemSlide(item) }));
  state.slides.push({ closing: true, node: closing.node, paint: closing.paint });
  for (const s of state.slides) stage.appendChild(s.node);

  const dots = $('deck-dots');
  clear(dots);
  state.slides.forEach((s, i) => dots.appendChild(el('button', {
    class: 'dot-btn', type: 'button', role: 'tab', 'aria-label': s.item ? `Lámina ${i + 1}` : 'Resumen final',
    onclick: () => goTo(i),
  })));
  state.index = Math.min(Math.max(0, keepIndex), state.slides.length - 1);
  showSlide(false);
}

function paintBar() {
  const slide = state.slides[state.index];
  const item = slide && slide.item;
  $('deck-actions').classList.toggle('is-empty', !item);
  if (item) {
    const isCompare = item.visual?.type === 'compare';
    const fb = fbOf(item.id);
    $('slide-ask').textContent = slideAsk(item);
    $('vote-up').hidden = isCompare;
    $('vote-down').hidden = isCompare;
    $('vote-up').setAttribute('aria-pressed', String(fb.vote === 'up'));
    $('vote-down').setAttribute('aria-pressed', String(fb.vote === 'down'));
    $('btn-comment').classList.toggle('has-comment', Boolean((fb.comment || '').trim()));
    const hasMore = Boolean(item.body_md && item.body_md.trim()) || extraMedia(item).length > 0 || (item.tags || []).length > 0;
    $('btn-more').hidden = !hasMore;
  }
  [...$('deck-dots').children].forEach((d, i) => {
    const s = state.slides[i];
    const v = s.item ? slideVote(s.item) : null;
    d.className = `dot-btn${v ? ` dot-${v}` : ''}${i === state.index ? ' dot-now' : ''}`;
    d.setAttribute('aria-selected', String(i === state.index));
  });
  $('deck-prev').disabled = state.index === 0;
  $('deck-next').disabled = state.index === state.slides.length - 1;
  updateSaveStatus();
}

function closeOverlays() {
  $('comment-pop').hidden = true;
  $('more-sheet').hidden = true;
  $('btn-more').setAttribute('aria-expanded', 'false');
}

function showSlide(animate = true) {
  state.slides.forEach((s, i) => {
    s.node.hidden = i !== state.index;
    s.node.classList.toggle('slide-enter', animate && i === state.index);
  });
  const s = state.slides[state.index];
  if (s.paint) s.paint();
  const cmp = s.node.querySelector('.cmp');
  if (cmp && cmp.repaint) cmp.repaint();
  closeOverlays();
  paintBar();
}

function goTo(i) {
  const next = Math.min(Math.max(0, i), state.slides.length - 1);
  if (next === state.index) return;
  state.index = next;
  showSlide();
  if (state.review) history.replaceState(null, '', `#/r/${encodeURIComponent(state.review.id)}/${next + 1}`);
}

// Media que no se ve en la lámina (video, html interactivo) o de ítems sin visual.
function extraMedia(item) {
  const media = item.media || [];
  if (!item.visual) return media.length > 1 ? media : [];
  return media.filter(p => !/\.(png|jpe?g|webp|gif|svg)$/i.test(p));
}

function toggleMore() {
  const sheet = $('more-sheet');
  if (!sheet.hidden) { closeOverlays(); return; }
  const item = state.slides[state.index].item;
  if (!item) return;
  $('comment-pop').hidden = true;
  $('more-title').textContent = slideHeadline(item);
  const body = $('more-body');
  clear(body);
  if (item.headline && item.title !== item.headline) body.appendChild(el('p', { text: item.title }));
  if (item.body_md) body.appendChild(renderMarkdown(item.body_md));
  const extra = extraMedia(item);
  if (extra.length) body.appendChild(el('div', { class: 'media' }, extra.map(mediaNode)));
  if (item.tags && item.tags.length) body.appendChild(el('div', { class: 'tags' }, item.tags.map(t => el('span', { class: 'pill', text: t }))));
  sheet.hidden = false;
  $('btn-more').setAttribute('aria-expanded', 'true');
}

function toggleComment() {
  const pop = $('comment-pop');
  if (!pop.hidden) { pop.hidden = true; return; }
  const item = state.slides[state.index].item;
  if (!item) return;
  $('more-sheet').hidden = true;
  const input = $('comment-input');
  input.value = fbOf(item.id).comment || '';
  pop.hidden = false;
  input.focus();
}

function vote(kind) {
  const item = state.slides[state.index].item;
  if (!item) return;
  const fb = fbOf(item.id);
  fb.vote = fb.vote === kind ? null : kind;
  markDirty();
  paintBar();
}

function wireDeckControls() {
  $('vote-up').appendChild(icon('up', 22));
  $('vote-down').appendChild(icon('down', 22));
  $('btn-comment').appendChild(icon('chat', 22));
  $('deck-prev').appendChild(icon('left', 22));
  $('deck-next').appendChild(icon('right', 22));
  $('vote-up').addEventListener('click', () => vote('up'));
  $('vote-down').addEventListener('click', () => vote('down'));
  $('btn-comment').addEventListener('click', toggleComment);
  $('btn-more').addEventListener('click', toggleMore);
  $('more-close').addEventListener('click', closeOverlays);
  $('deck-prev').addEventListener('click', () => goTo(state.index - 1));
  $('deck-next').addEventListener('click', () => goTo(state.index + 1));
  $('comment-input').addEventListener('input', e => {
    const item = state.slides[state.index].item;
    if (!item) return;
    fbOf(item.id).comment = e.target.value;
    $('btn-comment').classList.toggle('has-comment', Boolean(e.target.value.trim()));
    markDirty();
  });

  document.addEventListener('keydown', e => {
    if (!state.review) return;
    if (e.key === 'Escape') { closeOverlays(); return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (!$('more-sheet').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A')) { e.preventDefault(); goTo(state.index + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(state.index - 1); }
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(state.slides.length - 1);
  });

  // Swipe táctil: el slider y las listas con scroll horizontal se marcan .no-swipe.
  const stage = $('deck-stage');
  let start = null;
  stage.addEventListener('pointerdown', e => {
    start = e.pointerType !== 'mouse' && !e.target.closest('.no-swipe') ? { x: e.clientX, y: e.clientY } : null;
  });
  stage.addEventListener('pointercancel', () => { start = null; });
  stage.addEventListener('pointerup', e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(state.index + (dx < 0 ? 1 : -1));
  });
}

async function openReview(id, index = 0) {
  $('changed-banner').hidden = true;
  let data;
  try { data = await api(`/api/reviews/${encodeURIComponent(id)}`); } catch (e) {
    setView('home');
    toast(`No pude abrir la revisión: ${e.message}`);
    history.replaceState(null, '', '#/');
    loadHome();
    return;
  }
  state.review = data.review;
  state.items = {};
  state.conversation = [];
  state.summary = null;
  state.savedAt = null;
  state.dirty = false;
  if (data.feedback) {
    for (const [k, v] of Object.entries(data.feedback.items || {})) state.items[k] = { vote: v.vote || null, comment: v.comment || '' };
    state.conversation = data.feedback.conversation || [];
    state.summary = data.feedback.summary || null;
    state.savedAt = data.feedback.saved_at;
  }
  setView('deck');
  $('top-title').textContent = state.review.title;
  renderDeck(index);
}

// ---------------------------------------------------------------------------
// Conversación (voz con OpenAI Realtime, o texto vía server)
// ---------------------------------------------------------------------------

function addTurn(who, text) {
  // Texto plano: si el modelo igual manda **negritas**, se quitan los asteriscos.
  const t = String(text || '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
  if (!t) return null;
  const turn = { who, text: t };
  state.conversation.push(turn);
  markDirty();
  renderTalkLog();
  return turn;
}

function renderTalkLog(partial) {
  const log = $('talk-log');
  clear(log);
  for (const t of state.conversation) log.appendChild(el('div', { class: `bubble bubble-${t.who}`, text: t.text }));
  if (partial) log.appendChild(el('div', { class: 'bubble bubble-guia bubble-partial', text: partial }));
  log.scrollTop = log.scrollHeight;
}

function setTalkNote(msg) { $('talk-note').textContent = msg || ''; }

function setTalkPanel(open) {
  $('talk').hidden = !open;
  document.body.classList.toggle('talk-open', open);
}

function openTalkPanel() {
  setTalkPanel(true);
  const s = state.status || {};
  $('talk-voice').disabled = !s.voice || !navigator.mediaDevices || !window.RTCPeerConnection;
  $('talk-text').disabled = !s.chat;
  $('talk-mode').textContent = 'elige modo';
  if (!s.voice) setTalkNote('Voz no disponible: falta OPENAI_API_KEY en .env. Puedes usar texto.');
  else if (!navigator.mediaDevices) setTalkNote('Este navegador no da acceso al micrófono. Usa texto.');
  else setTalkNote(`Voz: ${s.voice_model} (${s.voice_name}). Cuesta centavos por minuto; se corta sola a los 20 min.`);
  renderTalkLog();
}

function startTimer(limitMin = 20) {
  const t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('talk-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (s >= limitMin * 60) { toast('Límite de 20 minutos: cerrando la conversación.'); endTalk(); }
  };
  tick();
  return setInterval(tick, 1000);
}

function stopTalkSession() {
  const t = state.talk;
  if (!t) return;
  clearInterval(t.timer);
  if (t.dc) try { t.dc.close(); } catch { /* ignore */ }
  if (t.pc) try { t.pc.close(); } catch { /* ignore */ }
  if (t.stream) t.stream.getTracks().forEach(tr => tr.stop());
  $('voice-orb').hidden = true;
  $('talk-timer').textContent = '';
  state.talk = null;
}

// --- Voz ---

function handleRealtimeEvent(ev) {
  const t = state.talk;
  if (!t) return;
  switch (ev.type) {
    // Orden real de los turnos: reservamos el lugar cuando se crea el ítem.
    case 'conversation.item.added':
    case 'conversation.item.created': {
      const it = ev.item;
      if (it && it.type === 'message' && (it.role === 'user' || it.role === 'assistant') && !t.slots.has(it.id)) {
        const slot = { who: it.role === 'user' ? 'usuario' : 'guia', text: '' };
        t.slots.set(it.id, slot);
        t.order.push(slot);
      }
      break;
    }
    case 'conversation.item.input_audio_transcription.completed':
      fillSlot(ev.item_id, 'usuario', ev.transcript);
      break;
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta':
      t.partial = (t.partial || '') + (ev.delta || '');
      $('voice-orb').classList.add('speaking');
      renderTalkLog(t.partial);
      break;
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done':
      t.partial = '';
      $('voice-orb').classList.remove('speaking');
      fillSlot(ev.item_id, 'guia', ev.transcript);
      break;
    case 'response.done':
      if (ev.response && ev.response.metadata && ev.response.metadata.purpose === 'cockpit_summary' && t.onSummary) {
        const texts = [];
        for (const out of ev.response.output || []) {
          for (const c of out.content || []) if (typeof c.text === 'string') texts.push(c.text);
        }
        t.onSummary(texts.join('\n'));
      }
      break;
    case 'error':
      setTalkNote(`Error de la sesión de voz: ${(ev.error && ev.error.message) || 'desconocido'}`);
      break;
    default:
      break;
  }
}

// Vuelca los turnos ya transcritos (en orden) a state.conversation.
function fillSlot(itemId, who, transcript) {
  const t = state.talk;
  let slot = t.slots.get(itemId);
  if (!slot) {
    slot = { who, text: '' };
    t.slots.set(itemId, slot);
    t.order.push(slot);
  }
  slot.text = String(transcript || '').trim();
  while (t.order.length && t.order[0].text !== '') {
    const s = t.order.shift();
    if (s.text) addTurn(s.who, s.text);
  }
  // Ítems sin texto (audio no transcrito) no deben bloquear la cola para siempre.
  if (t.order.length > 6 && t.order[0].text === '') t.order.shift();
}

async function startVoice() {
  if (!state.review) return;
  stopTalkSession();
  $('talk-mode').textContent = 'voz';
  $('talk-form').hidden = true;
  $('talk-voice').disabled = true;
  $('talk-text').disabled = true;
  setTalkNote('Pidiendo permiso de micrófono…');
  const talk = { mode: 'voz', slots: new Map(), order: [], partial: '' };
  state.talk = talk;
  try {
    talk.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tok = await api(`/api/voice/session/${encodeURIComponent(state.review.id)}`, { method: 'POST', body: '{}' });
    const pc = new RTCPeerConnection();
    talk.pc = pc;
    pc.ontrack = e => { $('talk-audio').srcObject = e.streams[0]; };
    pc.addTrack(talk.stream.getTracks()[0]);
    const dc = pc.createDataChannel('oai-events');
    talk.dc = dc;
    dc.addEventListener('message', e => { try { handleRealtimeEvent(JSON.parse(e.data)); } catch { /* evento no JSON */ } });
    dc.addEventListener('open', () => {
      // La guía abre la conversación sin esperar a que el usuario hable.
      dc.send(JSON.stringify({ type: 'response.create' }));
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch(tok.calls_url, {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${tok.value}`, 'Content-Type': 'application/sdp' },
    });
    if (!sdpRes.ok) throw new Error(`OpenAI respondió HTTP ${sdpRes.status} al conectar`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    talk.timer = startTimer(20);
    $('voice-orb').hidden = false;
    $('talk-end').disabled = false;
    setTalkNote('Conectado. Habla con normalidad; la guía te irá preguntando ítem por ítem.');
  } catch (e) {
    stopTalkSession();
    $('talk-voice').disabled = false;
    $('talk-text').disabled = !(state.status && state.status.chat);
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError');
    setTalkNote(denied ? 'No hay micrófono o no diste permiso. Usa "Usar texto".' : `No se pudo iniciar la voz: ${e.message}. Usa "Usar texto".`);
  }
}

function requestVoiceSummary(talk) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), 20000);
    talk.onSummary = text => { clearTimeout(timeout); resolve(text); };
    try {
      talk.stream.getTracks().forEach(tr => { tr.enabled = false; });
      talk.dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          conversation: 'none',
          output_modalities: ['text'],
          instructions: state.status.summary_instructions,
          metadata: { purpose: 'cockpit_summary' },
        },
      }));
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

function parseSummaryText(text) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    const j = JSON.parse(s.slice(a, b + 1));
    const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []);
    return { decisions: arr(j.decisions), open_questions: arr(j.open_questions), requests: arr(j.requests) };
  } catch {
    return null;
  }
}

// --- Texto ---

async function startText() {
  if (!state.review) return;
  stopTalkSession();
  state.talk = { mode: 'texto' };
  $('talk-mode').textContent = 'texto';
  $('talk-form').hidden = false;
  $('talk-end').disabled = false;
  $('talk-voice').disabled = true;
  $('talk-text').disabled = true;
  setTalkNote('Modo texto. La guía usa el mismo contexto que la voz.');
  $('talk-input').focus();
  if (!state.conversation.length || state.conversation[state.conversation.length - 1].who === 'usuario') await askGuide();
}

async function askGuide() {
  renderTalkLog('…');
  try {
    const r = await api(`/api/chat/${encodeURIComponent(state.review.id)}`, { method: 'POST', body: JSON.stringify({ conversation: state.conversation }) });
    addTurn('guia', r.reply);
  } catch (e) {
    renderTalkLog();
    setTalkNote(`La guía no respondió: ${e.message}`);
  }
}

// --- Cierre común ---

async function endTalk() {
  const talk = state.talk;
  if (!talk || talk.ending) return;
  talk.ending = true;
  $('talk-end').disabled = true;
  setTalkNote('Armando el resumen…');
  let summary = null;
  if (talk.mode === 'voz' && talk.dc && talk.dc.readyState === 'open') {
    summary = parseSummaryText(await requestVoiceSummary(talk));
    // Vuelca lo que quedó en cola aunque falte alguna transcripción.
    for (const s of talk.order) if (s.text) addTurn(s.who, s.text);
    talk.order = [];
  }
  stopTalkSession();
  if (!summary && state.conversation.length) {
    try {
      const r = await api(`/api/summary/${encodeURIComponent(state.review.id)}`, { method: 'POST', body: JSON.stringify({ conversation: state.conversation }) });
      summary = r.summary;
    } catch (e) {
      setTalkNote(`No pude generar el resumen (${e.message}). La conversación se guarda igual.`);
    }
  }
  if (summary) state.summary = summary;
  renderSummary();
  await saveFeedback(true);
  toast('Conversación y resumen guardados como feedback.');
  setTalkNote('Guardado. Puedes cerrar el panel.');
  $('talk-form').hidden = true;
  $('talk-mode').textContent = 'terminada';
  $('talk-voice').disabled = !(state.status && state.status.voice);
  $('talk-text').disabled = !(state.status && state.status.chat);
}

// ---------------------------------------------------------------------------
// Routing, eventos en vivo y arranque
// ---------------------------------------------------------------------------

function setView(name) {
  $('view-home').hidden = name !== 'home';
  $('view-help').hidden = name !== 'help';
  $('view-uso').hidden = name !== 'uso';
  $('view-deck').hidden = name !== 'deck';
  $('btn-talk').hidden = name !== 'deck';
  document.body.classList.toggle('deck-open', name === 'deck');
  if (name !== 'deck') $('top-title').textContent = '';
}

function parseRoute() {
  if (location.hash === '#/ayuda') return { view: 'help' };
  if (location.hash === '#/uso') return { view: 'uso' };
  const m = /^#\/r\/([^/]+)(?:\/(\d+))?$/.exec(location.hash);
  if (m) return { view: 'deck', id: decodeURIComponent(m[1]), slide: m[2] ? Number(m[2]) - 1 : 0 };
  return { view: 'home' };
}

async function leaveReview() {
  if (!state.review) return;
  if (state.dirty) await saveFeedback(true);
  stopTalkSession();
  setTalkPanel(false);
  closeOverlays();
  state.review = null;
  state.dirty = false;
}

async function route() {
  const r = parseRoute();
  if (r.view === 'deck') {
    if (state.review && state.review.id === r.id) { goTo(r.slide); return; }
    await leaveReview();
    await openReview(r.id, r.slide);
    return;
  }
  await leaveReview();
  setView(r.view);
  window.scrollTo(0, 0);
  if (r.view === 'help') loadHelp();
  else if (r.view === 'uso') loadUso($('view-uso'));
  else loadHome();
}

function connectEvents() {
  const pill = $('live-pill');
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => { pill.hidden = true; });
  es.addEventListener('error', () => { pill.hidden = false; });
  es.addEventListener('change', async () => {
    if (!state.review) { if (!$('view-home').hidden) loadHome(); return; }
    // Si cambió la revisión abierta y no hay nada sin guardar, recarga sola.
    try {
      const data = await api(`/api/reviews/${encodeURIComponent(state.review.id)}`);
      if (JSON.stringify(data.review) !== JSON.stringify(state.review)) {
        if (state.dirty || state.talk) $('changed-banner').hidden = false;
        else openReview(state.review.id, state.index);
      }
    } catch { /* la revisión pudo borrarse */ }
  });
}

async function boot() {
  try { state.status = await api('/api/status'); } catch { state.status = { voice: false, chat: false }; }
  if (state.status.project) document.title = `Cockpit · ${state.status.project}`;

  const talkBtn = $('btn-talk');
  talkBtn.append(icon('mic', 18), el('span', { class: 'btn-top-text', text: 'Conversar' }));
  $('btn-help').prepend(icon('help', 18));
  $('btn-save').addEventListener('click', () => saveFeedback(false));
  talkBtn.addEventListener('click', openTalkPanel);
  $('talk-close').addEventListener('click', () => {
    if (state.talk && !confirm('¿Cerrar sin guardar la conversación? (usa "Terminar y guardar" para conservarla)')) return;
    stopTalkSession();
    setTalkPanel(false);
  });
  $('talk-voice').addEventListener('click', startVoice);
  $('talk-text').addEventListener('click', startText);
  $('talk-end').addEventListener('click', endTalk);
  $('reload-review').addEventListener('click', () => state.review && openReview(state.review.id, state.index));
  $('talk-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('talk-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addTurn('usuario', text);
    await askGuide();
  });
  wireDeckControls();
  window.addEventListener('hashchange', route);
  // Si se cierra la pestaña con un cambio en vuelo, igual se guarda.
  window.addEventListener('pagehide', () => {
    if (state.dirty && state.review) {
      fetch(`/api/feedback/${encodeURIComponent(state.review.id)}`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: feedbackBody() }).catch(() => {});
    }
  });
  // Al rotar el celular o angostar la ventana, los diagramas cambian de layout.
  let wasTall = isTallScreen();
  window.addEventListener('resize', () => {
    const tall = isTallScreen();
    if (tall === wasTall) return;
    wasTall = tall;
    if (state.review) renderDeck(state.index);
    else if (!$('view-help').hidden) loadHelp();
  });

  connectEvents();
  route();
}

boot();
