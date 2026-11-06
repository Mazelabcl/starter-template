// cockpit/public/visuals.js
// Dibuja el `visual` de cada lámina: image, before_after (slider), compare (elegir
// con un clic) y diagram (SVG por código). Regla XSS del cockpit: los datos solo
// entran por textContent o setAttribute, nunca innerHTML.
// Idioma: español neutro.

import { renderDiagram, toDom, iconTree } from './diagrams.js';

export function el(tag, attrs = {}, ...children) {
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

export const mediaUrl = p => `/media?path=${encodeURIComponent(p)}`;

export function icon(name, size = 20) {
  const tree = iconTree(name, size);
  return tree ? toDom(tree) : document.createTextNode('');
}

/** ¿Pantalla angosta o vertical? Decide layout de diagramas e imagen de celular. */
export const isTallScreen = () => window.matchMedia('(max-width: 760px), (max-aspect-ratio: 1/1)').matches;

// ---------------------------------------------------------------------------
// Diagramas
// ---------------------------------------------------------------------------

export function diagramNode(visual, { layout, density } = {}) {
  const box = el('div', { class: 'diagram', 'data-kind': visual.kind });
  try {
    box.appendChild(toDom(renderDiagram(visual, { layout: layout || (isTallScreen() ? 'tall' : 'wide'), density })));
  } catch {
    box.appendChild(el('p', { class: 'visual-error', text: 'Este diagrama trae datos incompletos. Mira "Ver más".' }));
  }
  return box;
}

// ---------------------------------------------------------------------------
// Hotspots: outline + número sobre la imagen "después"
// ---------------------------------------------------------------------------

// El nombre de cada zona va en las pastillas de abajo: sobre la imagen solo el número.
function hotspotLayer(hotspots, { numbers = true } = {}) {
  const layer = el('div', { class: 'hs-layer', 'aria-hidden': 'true' });
  (hotspots || []).forEach((s, i) => {
    const box = el('div', { class: 'hs', 'data-n': i + 1 },
      numbers ? el('span', { class: 'hs-n', text: String(i + 1) }) : null);
    box.style.left = `${s.x * 100}%`;
    box.style.top = `${s.y * 100}%`;
    box.style.width = `${s.w * 100}%`;
    box.style.height = `${s.h * 100}%`;
    layer.appendChild(box);
  });
  return layer;
}

// Números fuera del recorte del deslizador: se ven aunque la zona quede del lado "antes".
// La copia invisible de la imagen da la misma altura que "después", a la que se refieren las zonas.
function hotspotPins(hotspots, afterSrc) {
  const layer = el('div', { class: 'hs-layer', 'aria-hidden': 'true' });
  (hotspots || []).forEach((s, i) => {
    const pin = el('span', { class: 'hs-n hs-pin', text: String(i + 1) });
    pin.style.left = `${s.x * 100}%`;
    pin.style.top = `${s.y * 100}%`;
    layer.appendChild(pin);
  });
  return el('div', { class: 'ba-pins' },
    el('img', { class: 'ba-img', src: afterSrc, alt: '', draggable: 'false' }), layer);
}

// ---------------------------------------------------------------------------
// Antes / después
// ---------------------------------------------------------------------------

const START_POS = 30; // parte mostrando sobre todo el "después", que es lo nuevo

function beforeAfterFrame(view) {
  const before = el('img', { class: 'ba-img ba-before', src: mediaUrl(view.before), alt: 'Antes', draggable: 'false' });
  const after = el('img', { class: 'ba-img', src: mediaUrl(view.after), alt: 'Después', draggable: 'false' });
  const afterWrap = el('div', { class: 'ba-after' }, after, hotspotLayer(view.hotspots, { numbers: false }));
  const pins = hotspotPins(view.hotspots, mediaUrl(view.after));
  const scroll = el('div', { class: 'ba-scroll' }, el('div', { class: 'ba-inner' }, afterWrap, before, pins));
  const handle = el('button', {
    class: 'ba-handle', type: 'button', role: 'slider', 'aria-label': 'Mover la línea entre antes y después',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(START_POS),
  }, icon('left', 16), icon('right', 16));
  const frame = el('div', { class: 'ba-frame no-swipe', 'data-device': view.device || 'desktop' },
    scroll,
    el('span', { class: 'ba-tag ba-tag-before', text: 'Antes' }),
    el('span', { class: 'ba-tag ba-tag-after', text: 'Después' }),
    el('div', { class: 'ba-line' }),
    handle);

  const setPos = p => {
    const pos = Math.min(100, Math.max(0, p));
    frame.style.setProperty('--pos', `${pos}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(pos)));
  };
  setPos(START_POS);
  const first = (view.hotspots || [])[0];
  let scrolled = false;
  const fit = () => {
    // Oculta (otra lámina) mide 0: se ajusta recién cuando se ve y la imagen cargó.
    const afterH = after.getBoundingClientRect().height;
    if (!afterH || !after.complete || !before.complete) return;
    // Imagen más baja que el marco: el marco se ajusta a ella, sin franja vacía.
    const contentH = scroll.firstChild.getBoundingClientRect().height;
    if (contentH < scroll.clientHeight) { frame.style.flex = 'none'; frame.style.height = `${Math.ceil(contentH)}px`; }
    // Si lo primero que cambió queda bajo la pantalla, parte mostrando ese cambio.
    if (first && !scrolled) {
      scrolled = true;
      const top = first.y * afterH;
      if (top > scroll.clientHeight * 0.5) scroll.scrollTop = Math.max(0, top - 56);
    }
  };
  after.addEventListener('load', fit);
  before.addEventListener('load', fit);
  new ResizeObserver(fit).observe(scroll);
  const fromEvent = e => {
    const r = frame.getBoundingClientRect();
    setPos(((e.clientX - r.left) / r.width) * 100);
  };
  let dragging = false;
  frame.addEventListener('pointerdown', e => {
    // La barra de scroll vertical sigue siendo de scroll, no de slider.
    if (e.pointerType === 'mouse' && e.target === scroll && e.offsetX >= scroll.clientWidth) return;
    dragging = true;
    frame.setPointerCapture(e.pointerId);
    fromEvent(e);
  });
  frame.addEventListener('pointermove', e => { if (dragging) fromEvent(e); });
  // Al soltar, las flechas del teclado vuelven a cambiar de lámina.
  const stop = () => { dragging = false; handle.blur(); };
  frame.addEventListener('pointerup', stop);
  frame.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const now = Number(handle.getAttribute('aria-valuenow'));
    setPos(now + (e.key === 'ArrowLeft' ? -5 : 5));
  });
  return { frame, scroll, after, setPos };
}

function chips(view, parts) {
  if (!view.hotspots || !view.hotspots.length) return null;
  const row = el('div', { class: 'hs-chips no-swipe' });
  view.hotspots.forEach((s, i) => {
    row.appendChild(el('button', {
      class: 'hs-chip', type: 'button',
      onclick: () => {
        // Muestra la zona: mueve la línea para ver el "después" y baja hasta ahí.
        parts.setPos(6);
        const top = s.y * parts.after.getBoundingClientRect().height;
        parts.scroll.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' });
        const box = parts.frame.querySelector(`.hs[data-n="${i + 1}"]`);
        if (box) { box.classList.remove('hs-pulse'); void box.offsetWidth; box.classList.add('hs-pulse'); }
      },
    }, el('span', { class: 'hs-n', text: String(i + 1) }), s.label || `Cambio ${i + 1}`));
  });
  return row;
}

function beforeAfterNode(v) {
  const base = { before: v.before, after: v.after, hotspots: v.hotspots, device: v.device, label: v.label };
  const views = Array.isArray(v.views) && v.views.length ? v.views : [base];
  const wrap = el('div', { class: 'ba-wrap' });
  const stage = el('div', { class: 'ba-stage' });
  let tabs = null;
  const show = i => {
    while (stage.firstChild) stage.removeChild(stage.firstChild);
    const parts = beforeAfterFrame(views[i]);
    stage.appendChild(parts.frame);
    const c = chips(views[i], parts);
    if (c) stage.appendChild(c);
    if (tabs) [...tabs.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  };
  if (views.length > 1) {
    tabs = el('div', { class: 'ba-tabs no-swipe' });
    views.forEach((x, i) => tabs.appendChild(el('button', { class: 'ba-tab', type: 'button', text: x.label || `Vista ${i + 1}`, onclick: () => show(i) })));
    wrap.appendChild(tabs);
  }
  wrap.appendChild(stage);
  const preferred = isTallScreen() ? views.findIndex(x => x.device === 'mobile') : -1;
  show(preferred >= 0 ? preferred : 0);
  return wrap;
}

// ---------------------------------------------------------------------------
// Comparar: 2-3 opciones grandes, un clic elige
// ---------------------------------------------------------------------------

function compareNode(v, ctx) {
  const grid = el('div', { class: 'cmp', 'data-count': v.options.length });
  const paint = () => {
    const chosen = ctx.pickedOption ? ctx.pickedOption() : null;
    for (const card of grid.querySelectorAll('.cmp-card')) {
      const on = card.dataset.option === chosen;
      card.classList.toggle('cmp-on', on);
      card.setAttribute('aria-pressed', String(on));
    }
  };
  const tall = isTallScreen();
  for (const o of v.options) {
    const path = (tall && o.image_mobile) || o.image;
    let picture;
    if (Array.isArray(o.images) && o.images.length) {
      picture = el('div', { class: 'cmp-blend' }, o.images.slice(0, 2).map(p => el('img', { src: mediaUrl(p), alt: '', draggable: 'false' })));
    } else if (path) {
      picture = el('img', { class: 'cmp-img', src: mediaUrl(path), alt: o.label, draggable: 'false' });
    } else {
      picture = el('div', { class: 'cmp-icon' }, icon(o.icon || 'flag', 56));
    }
    const plain = !path && !(Array.isArray(o.images) && o.images.length);
    // Líneas cortas (p. ej. Antes → Ahora, Cómo probarlo): la diferencia se ve sin abrir "Ver más".
    const lines = (Array.isArray(o.lines) ? o.lines : []).filter(l => l && l.label && l.text).slice(0, 5);
    const card = el('button', {
      class: `cmp-card${plain ? ' cmp-plain' : ''}${lines.length ? ' cmp-has-lines' : ''}`, type: 'button', 'data-option': o.id, 'aria-pressed': 'false',
      onclick: () => { if (ctx.pick) ctx.pick(o); paint(); },
    },
    el('span', { class: 'cmp-pic' }, picture),
    el('span', { class: 'cmp-label' }, el('span', { class: 'cmp-check' }, icon('check', 16)), o.label),
    ...(lines.length ? [el('span', { class: 'cmp-lines' }, lines.map(l => el('span', { class: 'cmp-line' },
      el('span', { class: 'cmp-line-k', text: l.label }), el('span', { class: 'cmp-line-v', text: l.text }))))] : []));
    const wrap = el('div', { class: 'cmp-cell' }, card);
    if (path) wrap.appendChild(el('a', { class: 'cmp-open', href: mediaUrl(path), target: '_blank', rel: 'noopener', 'aria-label': `Ver ${o.label} en grande`, title: 'Ver en grande' }, icon('expand', 16)));
    grid.appendChild(wrap);
  }
  paint();
  grid.repaint = paint;
  return grid;
}

// ---------------------------------------------------------------------------
// Imagen
// ---------------------------------------------------------------------------

function imageNode(v) {
  const path = (isTallScreen() && v.path_mobile) || v.path;
  const img = el('img', { class: 'vi-img', src: mediaUrl(path), alt: v.alt || '', draggable: 'false' });
  const inner = el('div', { class: 'vi-inner' }, img, hotspotLayer(v.hotspots));
  const box = el('div', { class: 'vi' }, inner);
  // Páginas completas (mucho más altas que anchas): se ven al ancho y con scroll.
  img.addEventListener('load', () => {
    if (img.naturalHeight / img.naturalWidth > 1.25) box.classList.add('vi-tall');
  });
  return box;
}

// ---------------------------------------------------------------------------
// Revisiones viejas (solo media + body_md): deben seguir viéndose
// ---------------------------------------------------------------------------

const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
const extOf = p => (String(p).split('.').pop() || '').toLowerCase();

function plainExcerpt(md, words = 26) {
  const text = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*$/gm, ' ')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const list = text.split(' ').filter(Boolean);
  return list.length > words ? `${list.slice(0, words).join(' ')}…` : list.join(' ');
}

export function mediaNode(p) {
  const src = mediaUrl(p);
  const ext = extOf(p);
  if (IMG_EXT.includes(ext)) return el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src, alt: p, loading: 'lazy' }));
  if (['mp4', 'webm', 'mov'].includes(ext)) return el('video', { src, controls: true, preload: 'metadata' });
  if (['mp3', 'wav'].includes(ext)) return el('audio', { src, controls: true });
  if (ext === 'html') return el('iframe', { src, sandbox: '', title: p, loading: 'lazy' });
  return el('a', { href: src, target: '_blank', rel: 'noopener', text: p });
}

function legacyNode(item) {
  const media = item.media || [];
  const images = media.filter(p => IMG_EXT.includes(extOf(p)));
  if (images.length === 1 && media.length === 1) return imageNode({ path: images[0], alt: item.title });
  if (images.length) {
    const box = el('div', { class: 'legacy-grid no-swipe', 'data-count': Math.min(images.length, 4) });
    for (const p of images.slice(0, 4)) box.appendChild(el('a', { href: mediaUrl(p), target: '_blank', rel: 'noopener' }, el('img', { src: mediaUrl(p), alt: '', loading: 'lazy' })));
    return box;
  }
  const other = media.find(p => ['mp4', 'webm', 'mov', 'mp3', 'wav', 'html'].includes(extOf(p)));
  if (other) return el('div', { class: 'legacy-media no-swipe' }, mediaNode(other));
  const excerpt = plainExcerpt(item.body_md);
  return el('div', { class: 'legacy-card' }, excerpt ? el('p', { text: excerpt }) : icon('flag', 64));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Miniatura de un ítem para la lámina final. */
export function miniVisual(item) {
  const v = item.visual;
  const firstOption = v?.type === 'compare' ? (v.options || []).find(o => o.image || (o.images || []).length) : null;
  const path = v?.type === 'image' ? v.path
    : v?.type === 'before_after' ? v.after
    : firstOption ? firstOption.image || firstOption.images[0]
    : (item.media || []).find(p => IMG_EXT.includes(extOf(p)));
  if (path) return el('img', { src: mediaUrl(path), alt: '', loading: 'lazy' });
  if (v?.type === 'diagram') return diagramNode(v, { layout: 'wide', density: 'compact' });
  return icon(v?.type === 'compare' ? 'flag' : 'image', 34);
}

/**
 * Nodo visual de un ítem. `ctx` = { pick(option), pickedOption() } para `compare`.
 * Datos corruptos nunca rompen la presentación completa: se ve un aviso en esa lámina.
 */
export function renderVisual(item, ctx = {}) {
  const v = item.visual;
  try {
    if (!v) return legacyNode(item);
    if (v.type === 'image') return imageNode(v);
    if (v.type === 'before_after') return beforeAfterNode(v);
    if (v.type === 'compare') return compareNode(v, ctx);
    if (v.type === 'diagram') return diagramNode(v);
  } catch { /* cae al aviso */ }
  return el('p', { class: 'visual-error', text: 'No pude dibujar este visual. Mira "Ver más".' });
}
