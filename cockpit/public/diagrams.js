// cockpit/public/diagrams.js
// Diagramas por código: datos estructurados → SVG, sin dependencias ni servicios.
// Es un módulo puro: construye un árbol { tag, attrs, children } que el navegador
// convierte a nodos con toDom() (setAttribute + textContent, nunca innerHTML) y que
// los tests convierten a texto con svgString().
//
// Tipos: flow (pasos con flechas), org (equipo), timeline (pasado/ahora/sigue),
// connects (con qué se conecta). Cada uno tiene dos layouts: 'wide' para pantallas
// anchas y 'tall' para celular, así el texto nunca queda diminuto.
// Idioma: español neutro.

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHAR_W = 0.56; // ancho promedio de un carácter respecto del tamaño de fuente

// ---------------------------------------------------------------------------
// Árbol y salida
// ---------------------------------------------------------------------------

export function h(tag, attrs = {}, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) };
}

const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Árbol → texto SVG con todo escapado (lo usan tests y exportaciones). */
export function svgString(node) {
  if (typeof node === 'string' || typeof node === 'number') return escapeXml(node);
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  const inner = node.children.map(svgString).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/** Árbol → nodos DOM. Los datos solo entran como texto o atributo: es XSS-safe. */
export function toDom(node) {
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));
  const el = document.createElementNS(SVG_NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, String(v));
  for (const c of node.children) el.appendChild(toDom(c));
  return el;
}

// ---------------------------------------------------------------------------
// Íconos (trazos 24x24)
// ---------------------------------------------------------------------------

export const ICONS = {
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
  camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M21 15l-5-5L5 21'],
  check: ['M20 6L9 17l-5-5'],
  copy: ['M10 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeoff: ['M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9', 'M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2', 'M1 1l22 22'],
  brain: ['M9 3a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1 2.2A3 3 0 0 0 6 16a3 3 0 0 0 3 3 2 2 0 0 0 3 1V4a2 2 0 0 0-3-1z', 'M15 3a3 3 0 0 1 3 3 3 3 0 0 1 3 3 3 3 0 0 1-1 2.2A3 3 0 0 1 18 16a3 3 0 0 1-3 3 2 2 0 0 1-3 1'],
  flag: ['M4 22V4s1.500-1 5-1 5 2 8 2 3-1 3-1v11s-1 1-3 1-5-2-8-2-5 1-5 1'],
  rocket: ['M5 15c-1.500 1.300-2 5-2 5s3.700-.5 5-2c.7-.8.7-2.100-.1-2.900-.8-.8-2.100-.8-2.900-.1z', 'M12 15l-3-3a22 22 0 0 1 2-4A13 13 0 0 1 22 2c0 2.700-.8 7.500-6 11a22 22 0 0 1-4 2z', 'M9 12H4s.6-3 2-4c1.600-1.100 5-1 5-1', 'M12 15v5s3-.6 4-2c1.100-1.600 1-5 1-5'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  bolt: ['M13 2L3 14h9l-1 8 10-12h-9z'],
  film: ['M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 3v18', 'M17 3v18', 'M2 12h20', 'M2 7.500h5', 'M2 16.500h5', 'M17 7.500h5', 'M17 16.500h5'],
  plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v4a6 6 0 0 1-12 0z', 'M12 18v4'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  coin: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M15 8.500c-.6-1-1.700-1.500-3-1.500-1.900 0-3.500 1-3.500 2.500S10 12 12 12s3.500 1 3.500 2.500S13.900 17 12 17c-1.300 0-2.400-.5-3-1.500', 'M12 5v2', 'M12 17v2'],
  up: ['M7 10v12', 'M15 5.900 14 10h5.800a2 2 0 0 1 1.900 2.500l-2.300 8a2 2 0 0 1-2 1.500H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.800a2 2 0 0 0 1.800-1.100L12 2a3 3 0 0 1 3 3.900z'],
  down: ['M17 14V2', 'M9 18.100 10 14H4.200a2 2 0 0 1-1.900-2.500l2.300-8a2 2 0 0 1 2-1.500H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.800a2 2 0 0 0-1.800 1.100L12 22a3 3 0 0 1-3-3.900z'],
  merge: ['M6 21V9a9 9 0 0 0 9 9', 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  sparkles: ['M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900z', 'M19 15l.8 2.200L22 18l-2.200.8L19 21l-.8-2.200L16 18l2.200-.8z'],
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  box: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  pencil: ['M17 3a2.800 2.800 0 0 1 4 4L7.500 20.500 2 22l1.500-5.500z'],
  alert: ['M10.300 3.900 1.800 18a2 2 0 0 0 1.700 3h17a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z', 'M12 9v4', 'M12 17h.01'],
  left: ['M15 18l-6-6 6-6'],
  right: ['M9 18l6-6-6-6'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.100 9a3 3 0 0 1 5.800 1c0 2-3 3-3 3', 'M12 17h.01'],
  home: ['M3 10.500 12 3l9 7.500V21H3z', 'M9 21v-7h6v7'],
  expand: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  more: ['M12 5v14', 'M5 12h14'],
  link: ['M10 13a5 5 0 0 0 7.500.5l3-3a5 5 0 0 0-7-7l-1.700 1.700', 'M14 11a5 5 0 0 0-7.500-.5l-3 3a5 5 0 0 0 7 7l1.700-1.700'],
};

/** Ícono como árbol. Nombre desconocido → null (el diagrama funciona igual sin él). */
export function iconTree(name, size = 24, extra = {}) {
  const paths = ICONS[name];
  if (!paths) return null;
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', class: 'dg-icon', 'aria-hidden': 'true', ...extra },
    paths.map(d => h('path', { d })));
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Corta en líneas por palabras. Lo que no cabe termina en "…", nunca se desborda. */
export function wrapText(text, maxChars, maxLines = 3) {
  const limit = Math.max(4, Math.floor(maxChars));
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  let overflow = false;
  for (let word of words) {
    while (word.length > limit) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, limit - 1) + '-');
      word = word.slice(limit - 1);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= limit) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; overflow = true; }
  if (overflow) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.length >= limit ? last.slice(0, limit - 1) : last}…`;
  }
  return lines;
}

function textLines(lines, { x, y, fs, lh, cls, anchor = 'middle' }) {
  return lines.map((line, i) => h('text', { x, y: round(y + i * lh + fs * 0.8), 'font-size': fs, class: cls, 'text-anchor': anchor }, line));
}

const round = n => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Tarjeta: mide lo que necesita y se dibuja
// ---------------------------------------------------------------------------

function measure(o) {
  const fs = o.fs || 20;
  const lh = Math.round(fs * 1.22);
  const noteFs = Math.max(13, Math.round(fs * 0.74));
  const noteLh = Math.round(noteFs * 1.25);
  const pad = o.pad ?? 12;
  const row = o.layout === 'row';
  const iconSize = o.icon ? (o.iconSize || Math.round(fs * 1.5)) : 0;
  const textW = o.w - pad * 2 - (row && iconSize ? iconSize + 10 : 0);
  const lines = wrapText(o.label, textW / (fs * CHAR_W), o.maxLines || 3);
  const notes = o.note ? wrapText(o.note, textW / (noteFs * CHAR_W), o.maxNoteLines || 2) : [];
  const textH = lines.length * lh + (notes.length ? 4 + notes.length * noteLh : 0);
  const contentH = row ? Math.max(textH, iconSize) : textH + (iconSize ? iconSize + 8 : 0);
  return { fs, lh, noteFs, noteLh, pad, row, iconSize, lines, notes, textH, contentH, need: contentH + pad * 2 };
}

function card(o) {
  const m = measure(o);
  const H = o.h ?? m.need;
  const tone = o.tone ? ` dg-tone-${o.tone}` : '';
  const parts = [h('rect', { x: o.x, y: o.y, width: o.w, height: H, rx: 14, class: `dg-card${tone}` })];
  let tx, ty, anchor;
  if (m.row) {
    const ix = o.x + m.pad;
    if (m.iconSize) parts.push(placedIcon(o.icon, ix, o.y + (H - m.iconSize) / 2, m.iconSize));
    tx = ix + (m.iconSize ? m.iconSize + 10 : 0);
    ty = o.y + (H - m.textH) / 2;
    anchor = 'start';
  } else {
    let cy = o.y + (H - m.contentH) / 2;
    if (m.iconSize) { parts.push(placedIcon(o.icon, o.x + (o.w - m.iconSize) / 2, cy, m.iconSize)); cy += m.iconSize + 8; }
    tx = o.x + o.w / 2;
    ty = cy;
    anchor = 'middle';
  }
  parts.push(textLines(m.lines, { x: round(tx), y: ty, fs: m.fs, lh: m.lh, cls: 'dg-label', anchor }));
  if (m.notes.length) parts.push(textLines(m.notes, { x: round(tx), y: ty + m.lines.length * m.lh + 4, fs: m.noteFs, lh: m.noteLh, cls: 'dg-note', anchor }));
  if (o.badge) {
    const bw = Math.min(o.w - 12, o.badge.length * 13 * CHAR_W + 16);
    parts.push(h('rect', { x: round(o.x + o.w - bw - 6), y: o.y - 11, width: round(bw), height: 22, rx: 11, class: 'dg-badge' }));
    parts.push(h('text', { x: round(o.x + o.w - 6 - bw / 2), y: o.y + 4, 'font-size': 13, 'text-anchor': 'middle', class: 'dg-badge-text' }, o.badge));
  }
  return h('g', { class: `dg-node${tone}` }, parts);
}

function placedIcon(name, x, y, size) {
  return iconTree(name, size, { x: round(x), y: round(y) });
}

function arrow(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 9;
  const hx = x2 - Math.cos(a) * s, hy = y2 - Math.sin(a) * s;
  const px = Math.sin(a) * s * 0.65, py = -Math.cos(a) * s * 0.65;
  return [
    h('line', { x1: round(x1), y1: round(y1), x2: round(hx), y2: round(hy), class: 'dg-line' }),
    h('path', { d: `M${round(x2)} ${round(y2)}L${round(hx + px)} ${round(hy + py)}L${round(hx - px)} ${round(hy - py)}z`, class: 'dg-arrow' }),
  ];
}

function root(W, H, label, children, { maxScale = 1.5 } = {}) {
  return h('svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    class: 'dg',
    role: 'img',
    'aria-label': label,
    style: `max-width:${Math.round(W * maxScale)}px`,
  }, children);
}

const stepLabel = s => s.label || (s.parallel || []).map(p => p.label).join(' + ');

// ---------------------------------------------------------------------------
// flow
// ---------------------------------------------------------------------------

function flowWide(data, compact) {
  const steps = data.steps;
  const perRow = steps.length <= 6 ? steps.length : Math.ceil(steps.length / 2);
  const cardW = compact ? (perRow >= 5 ? 128 : 150) : perRow <= 3 ? 270 : perRow === 4 ? 220 : 190;
  const fs = compact ? 16 : perRow <= 4 ? 22 : 20;
  const gap = compact ? 26 : 46;
  const W = perRow * cardW + (perRow - 1) * gap;
  const sub = { w: cardW, fs: fs - 2, pad: 8, maxLines: 2 };
  let cardH = 0;
  for (const s of steps) {
    if (s.parallel) cardH = Math.max(cardH, s.parallel.reduce((sum, p) => sum + measure({ ...sub, label: p.label, icon: p.icon, layout: 'row' }).need + 8, -8));
    else cardH = Math.max(cardH, measure({ w: cardW, fs, label: s.label, note: s.note, icon: s.icon || 'check', maxLines: 4 }).need);
  }
  cardH = Math.max(cardH, compact ? 88 : 120);
  const rowGap = 64;
  const rows = Math.ceil(steps.length / perRow);
  const H = rows * cardH + (rows - 1) * rowGap + 14;
  const parts = [];
  steps.forEach((s, i) => {
    const r = Math.floor(i / perRow), c = i % perRow;
    const x = c * (cardW + gap), y = 12 + r * (cardH + rowGap);
    if (s.parallel) {
      const subH = (cardH - 8 * (s.parallel.length - 1)) / s.parallel.length;
      s.parallel.forEach((p, k) => parts.push(card({ ...sub, x, y: y + k * (subH + 8), h: subH, label: p.label, note: p.note, icon: p.icon, tone: p.tone || s.tone, layout: 'row' })));
    } else {
      parts.push(card({ x, y, w: cardW, h: cardH, fs, label: s.label, note: s.note, icon: s.icon, tone: s.tone, badge: s.badge, maxLines: 4 }));
    }
    if (i < steps.length - 1) {
      if (c < perRow - 1) parts.push(arrow(x + cardW + 5, y + cardH / 2, x + cardW + gap - 5, y + cardH / 2));
      else {
        const midY = y + cardH + rowGap / 2;
        const ex = cardW / 2, ey = y + cardH + rowGap - 4;
        parts.push(h('path', { d: `M${x + cardW / 2} ${y + cardH + 4}V${midY}H${ex}V${ey - 8}`, class: 'dg-line' }));
        parts.push(arrow(ex, ey - 9, ex, ey));
      }
    }
  });
  return root(W, H, `Flujo: ${steps.map(stepLabel).join(' → ')}`, parts);
}

function flowTall(data) {
  const W = 340;
  const fs = 17;
  const parts = [];
  let y = 8;
  data.steps.forEach((s, i) => {
    if (s.parallel) {
      const n = s.parallel.length;
      const w = (W - 10 * (n - 1)) / n;
      const needs = s.parallel.map(p => measure({ w, fs: 15, pad: 8, label: p.label, icon: p.icon, maxLines: 3 }).need);
      const H = Math.max(...needs, 76);
      s.parallel.forEach((p, k) => parts.push(card({ x: k * (w + 10), y, w, h: H, fs: 15, pad: 8, label: p.label, icon: p.icon, tone: p.tone || s.tone, maxLines: 3 })));
      y += H;
    } else {
      const m = measure({ w: W, fs, label: s.label, note: s.note, icon: s.icon, layout: 'row', maxLines: 3 });
      const H = Math.max(m.need, 56);
      parts.push(card({ x: 0, y, w: W, h: H, fs, label: s.label, note: s.note, icon: s.icon, tone: s.tone, badge: s.badge, layout: 'row', maxLines: 3 }));
      y += H;
    }
    if (i < data.steps.length - 1) { parts.push(arrow(W / 2, y + 3, W / 2, y + 21)); y += 24; }
  });
  return root(W, y + 8, `Flujo: ${data.steps.map(stepLabel).join(' → ')}`, parts, { maxScale: 1.3 });
}

// ---------------------------------------------------------------------------
// org
// ---------------------------------------------------------------------------

function orgLayout(data, { W, perRow, cardW, fs, gap, leadW }) {
  const members = data.members;
  const lead = data.lead;
  const rowsN = Math.ceil(members.length / perRow);
  let cardH = 0;
  for (const m of members) cardH = Math.max(cardH, measure({ w: cardW, fs, label: m.label, note: m.note, icon: m.icon || 'user', maxLines: 3, maxNoteLines: 3 }).need);
  const parts = [];
  let y = 14;
  let busY = y;
  if (lead) {
    const m = measure({ w: leadW, fs: fs + 1, label: lead.label, note: lead.note, icon: lead.icon, maxLines: 2 });
    parts.push(card({ x: (W - leadW) / 2, y, w: leadW, h: m.need, fs: fs + 1, label: lead.label, note: lead.note, icon: lead.icon, tone: lead.tone || 'accent', maxLines: 2 }));
    y += m.need;
    busY = y + 22;
    parts.push(h('line', { x1: W / 2, y1: y, x2: W / 2, y2: busY, class: 'dg-line' }));
    y += 44;
  }
  for (let r = 0; r < rowsN; r++) {
    const row = members.slice(r * perRow, (r + 1) * perRow);
    const rowW = row.length * cardW + (row.length - 1) * gap;
    const x0 = (W - rowW) / 2;
    const yr = y + r * (cardH + 34);
    if (lead) {
      const centers = row.map((_, i) => x0 + i * (cardW + gap) + cardW / 2);
      const busHere = r === 0 ? busY : yr - 17;
      if (r > 0) parts.push(h('line', { x1: W / 2, y1: busY, x2: W / 2, y2: busHere, class: 'dg-line' }));
      parts.push(h('line', { x1: Math.min(W / 2, centers[0]), y1: busHere, x2: Math.max(W / 2, centers[centers.length - 1]), y2: busHere, class: 'dg-line' }));
      for (const c of centers) parts.push(h('line', { x1: c, y1: busHere, x2: c, y2: yr, class: 'dg-line' }));
    }
    row.forEach((m, i) => parts.push(card({
      x: x0 + i * (cardW + gap), y: yr, w: cardW, h: cardH, fs,
      label: m.label, note: m.note, icon: m.icon || 'user', tone: m.tone, badge: m.badge, maxLines: 3, maxNoteLines: 3,
    })));
  }
  const H = y + rowsN * cardH + (rowsN - 1) * 34 + 10;
  const label = `Equipo: ${lead ? `${lead.label} con ` : ''}${members.map(m => m.label).join(', ')}`;
  return { W, H, label, parts };
}

function orgDiagram(data, layout) {
  if (layout === 'tall') {
    const r = orgLayout(data, { W: 340, perRow: 2, cardW: 164, fs: 15, gap: 12, leadW: 220 });
    return root(r.W, r.H, r.label, r.parts, { maxScale: 1.3 });
  }
  const n = data.members.length;
  const perRow = n <= 4 ? n : n <= 6 ? 3 : 4;
  const cardW = perRow <= 3 ? 280 : 240;
  const gap = 24;
  const W = Math.max(perRow * cardW + (perRow - 1) * gap, 320);
  const r = orgLayout(data, { W, perRow, cardW, fs: 21, gap, leadW: 340 });
  return root(r.W, r.H, r.label, r.parts);
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

const STATE_CAPTION = { past: 'Hecho', current: 'Ahora', next: 'Sigue' };

function node(state, cx, cy) {
  if (state === 'current') {
    return [
      h('circle', { cx, cy, r: 20, class: 'dg-tl-halo' }),
      h('circle', { cx, cy, r: 12, class: 'dg-tl-now' }),
    ];
  }
  if (state === 'past') {
    return [
      h('circle', { cx, cy, r: 12, class: 'dg-tl-past' }),
      h('path', { d: `M${cx - 5} ${cy}l3.500 3.500 6.500-7`, class: 'dg-tl-check' }),
    ];
  }
  return [h('circle', { cx, cy, r: 11, class: 'dg-tl-next' })];
}

function timelineWide(data) {
  const items = data.items;
  const n = items.length;
  const cellW = n <= 3 ? 300 : n <= 5 ? 230 : 180;
  const fs = n <= 5 ? 22 : 19;
  const W = n * cellW;
  const railY = 62;
  const parts = [];
  for (let i = 0; i < n - 1; i++) {
    const x1 = i * cellW + cellW / 2, x2 = x1 + cellW;
    const dashed = items[i + 1].state === 'next' ? ' dg-line-next' : '';
    parts.push(h('line', { x1, y1: railY, x2, y2: railY, class: `dg-line${dashed}` }));
  }
  let maxBottom = railY + 30;
  items.forEach((it, i) => {
    const cx = i * cellW + cellW / 2;
    parts.push(h('text', { x: cx, y: 26, 'font-size': 15, 'text-anchor': 'middle', class: `dg-caption dg-caption-${it.state}` }, STATE_CAPTION[it.state] || ''));
    parts.push(node(it.state, cx, railY));
    const lines = wrapText(it.label, (cellW - 20) / (fs * CHAR_W), 3);
    const lh = Math.round(fs * 1.22);
    parts.push(textLines(lines, { x: cx, y: railY + 34, fs, lh, cls: `dg-label${it.state === 'next' ? ' dg-label-next' : ''}` }));
    let bottom = railY + 34 + lines.length * lh;
    if (it.note) {
      const nl = wrapText(it.note, (cellW - 20) / (15 * CHAR_W), 2);
      parts.push(textLines(nl, { x: cx, y: bottom + 4, fs: 15, lh: 19, cls: 'dg-note' }));
      bottom += 4 + nl.length * 19;
    }
    maxBottom = Math.max(maxBottom, bottom);
  });
  return root(W, maxBottom + 10, `Línea de tiempo: ${items.map(i => `${STATE_CAPTION[i.state] || ''} ${i.label}`).join(', ')}`, parts);
}

function timelineTall(data) {
  const W = 340;
  const railX = 26;
  const fs = 18;
  const lh = 22;
  const parts = [];
  let y = 10;
  const rows = data.items.map(it => {
    const lines = wrapText(it.label, (W - 66) / (fs * CHAR_W), 3);
    const notes = it.note ? wrapText(it.note, (W - 66) / (14 * CHAR_W), 2) : [];
    return { it, lines, notes, H: Math.max(70, 22 + lines.length * lh + notes.length * 18 + 16) };
  });
  const ys = [];
  for (const r of rows) { ys.push(y); y += r.H; }
  rows.forEach((r, i) => {
    const cy = ys[i] + 22;
    if (i < rows.length - 1) {
      const dashed = rows[i + 1].it.state === 'next' ? ' dg-line-next' : '';
      parts.push(h('line', { x1: railX, y1: cy, x2: railX, y2: ys[i + 1] + 22, class: `dg-line${dashed}` }));
    }
  });
  rows.forEach((r, i) => {
    const cy = ys[i] + 22;
    parts.push(node(r.it.state, railX, cy));
    parts.push(h('text', { x: 60, y: ys[i] + 12, 'font-size': 13, class: `dg-caption dg-caption-${r.it.state}` }, STATE_CAPTION[r.it.state] || ''));
    parts.push(textLines(r.lines, { x: 60, y: ys[i] + 16, fs, lh, cls: `dg-label${r.it.state === 'next' ? ' dg-label-next' : ''}`, anchor: 'start' }));
    if (r.notes.length) parts.push(textLines(r.notes, { x: 60, y: ys[i] + 18 + r.lines.length * lh, fs: 14, lh: 18, cls: 'dg-note', anchor: 'start' }));
  });
  return root(W, y + 6, `Línea de tiempo: ${data.items.map(i => `${STATE_CAPTION[i.state] || ''} ${i.label}`).join(', ')}`, parts, { maxScale: 1.3 });
}

// ---------------------------------------------------------------------------
// connects
// ---------------------------------------------------------------------------

const LINK_ICON = { ok: 'check', missing: 'plug' };
const LINK_TONE = { ok: 'ok', missing: 'missing' };

function connectsWide(data, compact) {
  const links = data.links;
  const n = links.length;
  const cardW = compact ? 180 : 300;
  const centerW = compact ? 170 : 250;
  const midGap = compact ? 46 : 110;
  const W = n <= 3 ? centerW + midGap + cardW : cardW * 2 + centerW + midGap * 2;
  const leftN = n <= 3 ? 0 : Math.floor(n / 2);
  const left = links.slice(0, leftN);
  const right = links.slice(leftN);
  const fs = compact ? 16 : 19;
  const measureLink = l => Math.max(compact ? 50 : 62, measure({ w: cardW, fs, label: l.label, note: l.note, icon: l.icon || LINK_ICON[l.state], layout: 'row', maxLines: 2, maxNoteLines: 1 }).need);
  const rowH = Math.max(...links.map(measureLink));
  const gap = 12;
  const col = list => list.length * rowH + (list.length - 1) * gap;
  const H = Math.max(col(left), col(right), compact ? 90 : 150) + 12;
  const centerFs = compact ? 18 : 23;
  const cm = measure({ w: centerW, fs: centerFs, label: data.center, icon: data.center_icon || 'bolt', maxLines: 3 });
  const cH = Math.max(cm.need, compact ? 80 : 110);
  const cx = n <= 3 ? 0 : cardW + midGap;
  const cy = (H - cH) / 2;
  const parts = [];
  const place = (list, x, side) => {
    const y0 = (H - col(list)) / 2;
    list.forEach((l, i) => {
      const y = y0 + i * (rowH + gap);
      const midY = y + rowH / 2;
      const fromX = side === 'left' ? x + cardW : x;
      const toX = side === 'left' ? cx : cx + centerW;
      const toY = H / 2;
      const c = (fromX + toX) / 2;
      parts.push(h('path', { d: `M${fromX} ${round(midY)}C${c} ${round(midY)} ${c} ${round(toY)} ${toX} ${round(toY)}`, class: `dg-line${l.state === 'missing' ? ' dg-line-next' : ''}` }));
      parts.push(card({ x, y, w: cardW, h: rowH, fs, label: l.label, note: l.note, icon: l.icon || LINK_ICON[l.state], tone: l.tone || LINK_TONE[l.state], layout: 'row', maxLines: 2, maxNoteLines: 1 }));
    });
  };
  place(left, 0, 'left');
  place(right, n <= 3 ? centerW + midGap : cardW + centerW + midGap * 2, 'right');
  parts.push(card({ x: cx, y: cy, w: centerW, h: cH, fs: centerFs, label: data.center, icon: data.center_icon || 'bolt', tone: 'accent', maxLines: 3 }));
  return root(W, H, `${data.center} conecta con: ${links.map(l => l.label).join(', ')}`, parts);
}

function connectsTall(data) {
  const W = 340;
  const fs = 16;
  const parts = [];
  const cm = measure({ w: 260, fs: 19, label: data.center, icon: data.center_icon || 'bolt', maxLines: 2 });
  parts.push(card({ x: 40, y: 8, w: 260, h: cm.need, fs: 19, label: data.center, icon: data.center_icon || 'bolt', tone: 'accent', maxLines: 2 }));
  let y = 8 + cm.need;
  const railTop = y;
  const railX = 16;
  y += 18;
  const centers = [];
  const rows = [];
  for (const l of data.links) {
    const icon = l.icon || LINK_ICON[l.state];
    const m = measure({ w: W - 36, fs, label: l.label, note: l.note, icon, layout: 'row', maxLines: 2, maxNoteLines: 1, pad: 10 });
    const H = Math.max(m.need, 50);
    rows.push(card({ x: 36, y, w: W - 36, h: H, fs, label: l.label, note: l.note, icon, tone: l.tone || LINK_TONE[l.state], layout: 'row', maxLines: 2, maxNoteLines: 1, pad: 10 }));
    centers.push({ y: y + H / 2, state: l.state });
    y += H + 8;
  }
  parts.push(h('path', { d: `M60 ${railTop}V${railTop + 8}H${railX}V${round(centers[centers.length - 1].y)}`, class: 'dg-line' }));
  for (const c of centers) parts.push(h('line', { x1: railX, y1: round(c.y), x2: 36, y2: round(c.y), class: `dg-line${c.state === 'missing' ? ' dg-line-next' : ''}` }));
  parts.push(rows);
  return root(W, y + 2, `${data.center} conecta con: ${data.links.map(l => l.label).join(', ')}`, parts, { maxScale: 1.3 });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Datos de un visual `diagram` → árbol SVG. `layout`: 'wide' | 'tall'.
 * `density: 'compact'` achica flow y connects para tarjetas pequeñas (ayuda).
 * Si los datos no sirven, lanza Error: el llamador muestra un respaldo de texto.
 */
export function renderDiagram(data, { layout = 'wide', density } = {}) {
  const tall = layout === 'tall';
  const compact = density === 'compact';
  switch (data && data.kind) {
    case 'flow':
      if (!Array.isArray(data.steps) || !data.steps.length) throw new Error('flow sin steps');
      return tall ? flowTall(data) : flowWide(data, compact);
    case 'org':
      if (!Array.isArray(data.members) || !data.members.length) throw new Error('org sin members');
      return orgDiagram(data, layout);
    case 'timeline':
      if (!Array.isArray(data.items) || !data.items.length) throw new Error('timeline sin items');
      return tall ? timelineTall(data) : timelineWide(data);
    case 'connects':
      if (!Array.isArray(data.links) || !data.links.length) throw new Error('connects sin links');
      return tall ? connectsTall(data) : connectsWide(data, compact);
    default:
      throw new Error(`diagrama desconocido: ${data && data.kind}`);
  }
}
