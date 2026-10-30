// cockpit/public/app.js
// Frontend del cockpit. Reglas:
//  - XSS-safe: TODO dato del backend entra por textContent / atributos seguros.
//    Nunca innerHTML con datos. El markdown se convierte a nodos DOM a mano.
//  - La key de OpenAI nunca llega aquí: el server entrega un client secret
//    efímero (ek_...) por conversación.
// Idioma: español neutro.

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
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

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

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

const KIND_LABEL = { plan: 'plan', council: 'council', rounds: 'rondas', deliverable: 'entregable', other: 'otro' };
const STATUS_PILL = {
  'sin-feedback': ['sin feedback', 'pill-muted'],
  pendiente: ['feedback pendiente', 'pill-warn'],
  procesado: ['procesado', 'pill-ok'],
};

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

function renderMedia(paths) {
  if (!paths || !paths.length) return null;
  const box = el('div', { class: 'media' });
  for (const p of paths) {
    const src = `/media?path=${encodeURIComponent(p)}`;
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
      box.appendChild(el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src, alt: p, loading: 'lazy' })));
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      box.appendChild(el('video', { src, controls: true, preload: 'metadata' }));
    } else if (['mp3', 'wav'].includes(ext)) {
      box.appendChild(el('audio', { src, controls: true }));
    } else if (ext === 'html') {
      box.appendChild(el('iframe', { src, sandbox: '', title: p, loading: 'lazy' }));
    } else {
      box.appendChild(el('a', { href: src, target: '_blank', rel: 'noopener', text: p }));
    }
  }
  return box;
}

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

async function loadRoadmap() {
  let rm;
  try { rm = await api('/api/roadmap'); } catch { return; }
  const done = $('rm-done');
  const now = $('rm-now');
  const next = $('rm-next');
  clear(done); clear(now); clear(next);

  const past = (rm.done || []).slice().reverse();
  if (!past.length) done.appendChild(el('p', { class: 'rm-empty', text: 'Todavía no hay sprints cerrados.' }));
  for (const s of past) {
    const card = el('div', { class: 'rm-card' }, el('strong', { text: `Sprint ${s.number} · ${s.title}` }));
    if (s.dates) card.appendChild(el('span', { class: 'review-meta', text: s.dates }));
    const items = (s.deliverables || []).slice(0, 3);
    if (items.length) card.appendChild(el('ul', {}, items.map(d => el('li', { text: d }))));
    done.appendChild(card);
  }

  if (rm.now && rm.now.objective) {
    const card = el('div', { class: 'rm-card' }, el('strong', { text: `Sprint ${rm.now.number} · ${rm.now.objective}` }));
    if (rm.now.target_close) card.appendChild(el('span', { class: 'review-meta', text: `Meta: ${rm.now.target_close}` }));
    now.appendChild(card);
    for (const t of rm.now.tasks || []) {
      const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '●' : '○';
      now.appendChild(el('div', { class: `task${t.status === 'completed' ? ' task-done' : ''}` }, el('span', { text: mark }), el('span', { text: t.title })));
    }
  } else {
    now.appendChild(el('p', { class: 'rm-empty', text: 'Sin sprint activo. Se define con /kickoff o /roadmap.' }));
  }

  const upcoming = [...(rm.next?.preview || []), ...(rm.next?.high_priority || [])];
  if (!upcoming.length) next.appendChild(el('p', { class: 'rm-empty', text: 'Nada priorizado todavía.' }));
  for (const n of upcoming.slice(0, 8)) next.appendChild(el('div', { class: 'rm-card', text: n }));
}

// ---------------------------------------------------------------------------
// Lista de revisiones
// ---------------------------------------------------------------------------

async function loadList() {
  const box = $('review-list');
  let list = [];
  try { list = await api('/api/reviews'); } catch (e) { box.textContent = `Error: ${e.message}`; return; }
  clear(box);
  if (!list.length) {
    box.appendChild(el('div', { class: 'empty-state' },
      'Todavía no hay revisiones. El orquestador las publica con ',
      el('code', { text: '/revisar' }),
      ' o con ',
      el('code', { text: 'node src/cockpit.js publish <archivo>' }),
      '.'));
    return;
  }
  for (const r of list) {
    const [label, cls] = STATUS_PILL[r.feedback_status] || STATUS_PILL['sin-feedback'];
    box.appendChild(el('a', { class: 'review-card', href: `#/r/${encodeURIComponent(r.id)}` },
      el('div', { class: 'review-meta' },
        el('span', { class: 'pill pill-accent', text: KIND_LABEL[r.kind] || r.kind }),
        el('span', { class: `pill ${cls}`, text: label })),
      el('h3', { text: r.title }),
      el('div', { class: 'review-meta', text: `${r.item_count} ítems · ${fmtDate(r.created_at)}` })));
  }
}

// ---------------------------------------------------------------------------
// Vista de revisión
// ---------------------------------------------------------------------------

function updateSaveStatus() {
  const total = state.review ? state.review.items.length : 0;
  const voted = Object.values(state.items).filter(v => v.vote).length;
  const parts = [`${voted} de ${total} votados`];
  if (state.conversation.length) parts.push(`${state.conversation.length} turnos de conversación`);
  if (state.dirty) parts.push('cambios sin guardar');
  else if (state.savedAt) parts.push(`guardado ${fmtDate(state.savedAt)}`);
  $('save-status').textContent = parts.join(' · ');
  $('btn-save').disabled = !state.dirty;
}

function markDirty() { state.dirty = true; updateSaveStatus(); }

function renderSummary() {
  const box = $('summary-box');
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

function renderReview() {
  const r = state.review;
  const focus = $('focus');
  clear(focus);
  focus.appendChild(el('h1', { text: r.title }));
  const connects = r.connects_to && r.connects_to.length ? r.connects_to : [];
  focus.appendChild(el('p', {}, 'Ahora revisas ', el('strong', { text: r.title }),
    connects.length ? `, que conecta con ${connects.join(', ')}.` : '.'));
  const meta = el('div', { class: 'connects' },
    el('span', { class: 'pill pill-accent', text: KIND_LABEL[r.kind] || r.kind }),
    el('span', { class: 'pill', text: `${r.items.length} ítems` }),
    el('span', { class: 'pill', text: fmtDate(r.created_at) }));
  focus.appendChild(meta);

  const box = $('items');
  clear(box);
  r.items.forEach((it, idx) => {
    const fb = state.items[it.id] || (state.items[it.id] = { vote: null, comment: '' });
    const card = el('article', { class: 'item', id: `item-${it.id}` });
    const paint = () => {
      card.classList.toggle('voted-up', fb.vote === 'up');
      card.classList.toggle('voted-down', fb.vote === 'down');
      up.setAttribute('aria-pressed', String(fb.vote === 'up'));
      down.setAttribute('aria-pressed', String(fb.vote === 'down'));
    };
    const up = el('button', { class: 'vote vote-up', type: 'button', title: 'Me gusta / aprobar', 'aria-label': 'Aprobar' }, '👍');
    const down = el('button', { class: 'vote vote-down', type: 'button', title: 'No me gusta / cambiar', 'aria-label': 'Rechazar' }, '👎');
    up.addEventListener('click', () => { fb.vote = fb.vote === 'up' ? null : 'up'; paint(); markDirty(); });
    down.addEventListener('click', () => { fb.vote = fb.vote === 'down' ? null : 'down'; paint(); markDirty(); });
    const comment = el('textarea', { class: 'comment', placeholder: 'Comentario (opcional)', rows: 1 });
    comment.value = fb.comment || '';
    comment.addEventListener('input', () => { fb.comment = comment.value; markDirty(); });

    card.appendChild(el('div', { class: 'item-head' },
      el('h3', {}, el('span', { class: 'item-num', text: `${idx + 1}.` }), it.title)));
    if (it.tags && it.tags.length) card.appendChild(el('div', { class: 'tags' }, it.tags.map(t => el('span', { class: 'pill', text: t }))));
    if (it.body_md) card.appendChild(renderMarkdown(it.body_md));
    const media = renderMedia(it.media);
    if (media) card.appendChild(media);
    card.appendChild(el('div', { class: 'item-actions' }, up, down, comment));
    paint();
    box.appendChild(card);
  });
  renderSummary();
  updateSaveStatus();
}

async function openReview(id) {
  $('view-home').hidden = true;
  $('view-review').hidden = false;
  $('savebar').hidden = false;
  $('changed-banner').hidden = true;
  let data;
  try { data = await api(`/api/reviews/${encodeURIComponent(id)}`); } catch (e) {
    clear($('items'));
    clear($('focus'));
    $('focus').appendChild(el('p', { text: `No pude abrir la revisión: ${e.message}` }));
    $('savebar').hidden = true;
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
  renderReview();
  window.scrollTo(0, 0);
}

async function saveFeedback(silent = false) {
  if (!state.review) return;
  const body = { items: state.items, conversation: state.conversation, summary: state.summary };
  try {
    const fb = await api(`/api/feedback/${encodeURIComponent(state.review.id)}`, { method: 'POST', body: JSON.stringify(body) });
    state.dirty = false;
    state.savedAt = fb.saved_at;
    updateSaveStatus();
    if (!silent) toast('Feedback guardado. El orquestador lo leerá al continuar.');
  } catch (e) {
    toast(`No se pudo guardar: ${e.message}`);
  }
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

function currentRoute() {
  const m = /^#\/r\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

async function route() {
  const id = currentRoute();
  if (id) return openReview(id);
  if (state.dirty && state.review && !confirm('Tienes feedback sin guardar. ¿Salir igual?')) {
    history.replaceState(null, '', `#/r/${encodeURIComponent(state.review.id)}`);
    return;
  }
  stopTalkSession();
  setTalkPanel(false);
  state.review = null;
  state.dirty = false;
  $('view-home').hidden = false;
  $('view-review').hidden = true;
  $('savebar').hidden = true;
  loadList();
}

function connectEvents() {
  const pill = $('live-pill');
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => { pill.textContent = 'en vivo'; pill.className = 'pill pill-ok'; });
  es.addEventListener('error', () => { pill.textContent = 'reconectando…'; pill.className = 'pill pill-warn'; });
  es.addEventListener('change', async () => {
    loadRoadmap();
    if (!state.review) { loadList(); return; }
    // Si cambió la revisión abierta y no hay nada sin guardar, recarga sola.
    try {
      const data = await api(`/api/reviews/${encodeURIComponent(state.review.id)}`);
      if (JSON.stringify(data.review) !== JSON.stringify(state.review)) {
        if (state.dirty || state.talk) $('changed-banner').hidden = false;
        else openReview(state.review.id);
      }
    } catch { /* la revisión pudo borrarse */ }
  });
}

async function boot() {
  try { state.status = await api('/api/status'); } catch { state.status = { voice: false, chat: false }; }
  const vp = $('voice-pill');
  vp.textContent = state.status.voice ? 'voz lista' : state.status.chat ? 'solo texto' : 'sin conversación';
  vp.className = `pill ${state.status.voice ? 'pill-ok' : 'pill-muted'}`;

  $('btn-save').addEventListener('click', () => saveFeedback(false));
  $('btn-talk').addEventListener('click', openTalkPanel);
  $('talk-close').addEventListener('click', () => {
    if (state.talk && !confirm('¿Cerrar sin guardar la conversación? (usa "Terminar y guardar" para conservarla)')) return;
    stopTalkSession();
    setTalkPanel(false);
  });
  $('talk-voice').addEventListener('click', startVoice);
  $('talk-text').addEventListener('click', startText);
  $('talk-end').addEventListener('click', endTalk);
  $('reload-review').addEventListener('click', () => state.review && openReview(state.review.id));
  $('talk-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('talk-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addTurn('usuario', text);
    await askGuide();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  loadRoadmap();
  connectEvents();
  route();
}

boot();
