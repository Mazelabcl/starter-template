// dashboard-roadmap-render.test.js
//
// Tests para el modo Roadmap del side panel (fase 7).
//
// Cubre:
//   - Mini-parser markdown XSS-safe: H1/H2/H3 + bullets + bold + comentarios HTML.
//   - Sprints históricos colapsables: cada entry es <details><summary>.
//   - Roadmap vacío: muestra empty inline, sin crash.
//   - XSS guard: panel.js sigue sin usar innerHTML para datos del state.
//
// Estrategia idéntica a dashboard-panel-render.test.js: mock DOM minimal
// instalado en globalThis. Sin deps nuevas.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = join(__dirname, 'dashboard', 'public', 'ui', 'panel.js');

// ---------- mock DOM (igual al de dashboard-panel-render.test.js) ----------

class MockClassList {
  constructor() { this._set = new Set(); }
  add(...c) { for (const x of c) this._set.add(x); }
  remove(...c) { for (const x of c) this._set.delete(x); }
  contains(c) { return this._set.has(c); }
  toString() { return Array.from(this._set).join(' '); }
}

class MockEl {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.classList = new MockClassList();
    this._listeners = {};
    this._attrs = {};
    this._className = '';
    this._textContent = '';
  }
  get className() { return this._className; }
  set className(v) { this._className = String(v || ''); }
  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent || '')).join('');
  }
  set textContent(v) {
    this.children = [];
    this._textContent = v === null || v === undefined ? '' : String(v);
  }
  appendChild(child) {
    if (child === null || child === undefined) return child;
    if (typeof child === 'string') {
      this.children.push({ nodeType: 3, textContent: child, _textContent: child, parentNode: this });
      return child;
    }
    if (child.parentNode && typeof child.parentNode.removeChild === 'function') {
      child.parentNode.removeChild(child);
    }
    try { child.parentNode = this; } catch { /* frozen */ }
    if (this._textContent) {
      this.children.push({ nodeType: 3, textContent: this._textContent, _textContent: this._textContent, parentNode: this });
      this._textContent = '';
    }
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    if (child && typeof child === 'object') child.parentNode = null;
    return child;
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  addEventListener(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
  }
  removeEventListener(evt, fn) {
    const arr = this._listeners[evt];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatchEvent(ev) {
    const arr = this._listeners[ev.type] || [];
    for (const fn of arr.slice()) fn(ev);
    return true;
  }
  findByClass(c) {
    if (this._className === c || (this._className || '').split(/\s+/).includes(c)) return this;
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      const hit = child.findByClass && child.findByClass(c);
      if (hit) return hit;
    }
    return null;
  }
  findAllByClass(c, acc) {
    acc = acc || [];
    if (this._className === c || (this._className || '').split(/\s+/).includes(c)) acc.push(this);
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      if (child.findAllByClass) child.findAllByClass(c, acc);
    }
    return acc;
  }
  findByTag(tag) {
    if (this.tagName === tag.toUpperCase()) return this;
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      const hit = child.findByTag && child.findByTag(tag);
      if (hit) return hit;
    }
    return null;
  }
  findAllByTag(tag, acc) {
    acc = acc || [];
    if (this.tagName === tag.toUpperCase()) acc.push(this);
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      if (child.findAllByTag) child.findAllByTag(tag, acc);
    }
    return acc;
  }
}

function installDOM() {
  const documentMock = {
    body: new MockEl('body'),
    _byId: new Map(),
    createElement(tag) { return new MockEl(tag); },
    createTextNode(text) {
      const t = String(text === undefined || text === null ? '' : text);
      return {
        nodeType: 3,
        parentNode: null,
        textContent: t,
        get _textContent() { return t; },
      };
    },
    getElementById(id) { return documentMock._byId.get(id) || null; },
    _docListeners: {},
    addEventListener(evt, fn) {
      if (!documentMock._docListeners[evt]) documentMock._docListeners[evt] = [];
      documentMock._docListeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      const arr = documentMock._docListeners[evt];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent(ev) {
      const arr = documentMock._docListeners[ev.type] || [];
      for (const fn of arr.slice()) fn(ev);
    },
  };
  globalThis.document = documentMock;
  globalThis.window = { document: documentMock };
  globalThis.fetch = async () => { throw new Error('fetch desactivado en test'); };
  return documentMock;
}

function flattenText(el) {
  if (!el) return '';
  if (typeof el === 'string') return el;
  if (el.nodeType === 3) return el.textContent || el._textContent || '';
  if (el._textContent) return el._textContent;
  return (el.children || []).map(c => flattenText(c)).join(' ');
}

// ---------- tests del mini-parser markdown ----------

test('renderMarkdownToDOM: parsea H1/H2/H3 a tags correctos', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=md-headers');
  const parent = new MockEl('div');
  mod.renderMarkdownToDOM(parent, '# Título\n## Sub\n### Sub-sub\n');
  const h1 = parent.findByTag('h1');
  const h2 = parent.findByTag('h2');
  const h3 = parent.findByTag('h3');
  assert.ok(h1, 'debe crear <h1>');
  assert.ok(h2, 'debe crear <h2>');
  assert.ok(h3, 'debe crear <h3>');
  assert.ok(flattenText(h1).includes('Título'));
  assert.ok(flattenText(h2).includes('Sub'));
  assert.ok(flattenText(h3).includes('Sub-sub'));
});

test('renderMarkdownToDOM: parsea bullets a <ul><li>', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=md-bullets');
  const parent = new MockEl('div');
  mod.renderMarkdownToDOM(parent, '- uno\n- dos\n- tres\n');
  const uls = parent.findAllByTag('ul');
  assert.strictEqual(uls.length, 1, 'una sola <ul> para bullets consecutivos');
  const lis = uls[0].findAllByTag('li');
  assert.strictEqual(lis.length, 3, 'tres <li>');
  assert.ok(flattenText(lis[0]).includes('uno'));
  assert.ok(flattenText(lis[2]).includes('tres'));
});

test('renderMarkdownToDOM: bold **texto** crea <strong>', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=md-bold');
  const parent = new MockEl('div');
  mod.renderMarkdownToDOM(parent, 'Esto es **importante** y esto **también**.\n');
  const strongs = parent.findAllByTag('strong');
  assert.strictEqual(strongs.length, 2, 'dos <strong>');
  assert.ok(flattenText(strongs[0]).includes('importante'));
  assert.ok(flattenText(strongs[1]).includes('también'));
});

test('renderMarkdownToDOM: comentarios HTML se ignoran', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=md-comments');
  const parent = new MockEl('div');
  const md = '# Header\n<!-- tasks-start -->\n- visible\n<!-- tasks-end -->\n';
  mod.renderMarkdownToDOM(parent, md);
  const text = flattenText(parent);
  assert.ok(!text.includes('tasks-start'), 'el comentario no debe aparecer en el render');
  assert.ok(!text.includes('tasks-end'), 'el comentario no debe aparecer en el render');
  assert.ok(text.includes('visible'), 'el bullet sí debe aparecer');
});

test('renderMarkdownToDOM: roadmap.md template inicial se renderiza sin error', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=md-roadmap-template');
  const parent = new MockEl('div');
  // Réplica fiel al roadmap.md template del repo (con marcadores vacíos).
  const md = `# Roadmap del proyecto

Documento vivo. Sprint actual + backlog + ideas capturadas.

## Sprint actual

**Sprint 1 — (sin objetivo declarado)**
- Inicio: (pendiente)
- Meta: (pendiente)
- Estado: en progreso

### Tareas del sprint

<!-- tasks-start -->
<!-- tasks-end -->

## Backlog priorizado

### Alta prioridad

<!-- prio-alta-start -->
<!-- prio-alta-end -->
`;
  // No debe lanzar excepción.
  mod.renderMarkdownToDOM(parent, md);
  const text = flattenText(parent);
  assert.ok(text.includes('Roadmap del proyecto'), 'render contiene el título');
  assert.ok(text.includes('Sprint actual'), 'render contiene la sección Sprint actual');
  assert.ok(!text.includes('tasks-start'), 'render no contiene los marcadores HTML');
});

test('renderMarkdownToDOM: markdown vacío no crashea (puede emitir blank)', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=md-empty');
  const parent = new MockEl('div');
  // No debe lanzar excepción. Puede emitir 1 div blank (línea vacía) o 0 nodos.
  mod.renderMarkdownToDOM(parent, '');
  assert.ok(parent.children.length <= 1, `parent debe quedar vacío o con 1 nodo blank, no más. Got: ${parent.children.length}`);
});

// ---------- tests del render completo de Roadmap ----------

test('renderRoadmap: con roadmap.md y sin sprints históricos → muestra empty hint', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=roadmap-no-history');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  mod.renderRoadmap(body, titleEl, { markdown: '# Roadmap\n' }, []);
  const text = flattenText(body);
  assert.strictEqual(titleEl._textContent, 'Roadmap');
  assert.ok(text.includes('Roadmap'), 'render contiene el header');
  assert.ok(/[Ss]in sprints/.test(text), `debe avisar "sin sprints" cuando history=[]: ${text}`);
});

test('renderRoadmap: roadmap vacío + sin history → 2 empty hints, sin crash', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=roadmap-empty');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  mod.renderRoadmap(body, titleEl, { markdown: '' }, []);
  const text = flattenText(body);
  assert.ok(/[Rr]oadmap vacío|no existe/.test(text), `debe avisar roadmap vacío: ${text}`);
});

test('renderRoadmap: con sprints históricos → genera <details> colapsables', async () => {
  installDOM();
  const mod = await import('./dashboard/public/ui/panel.js?case=roadmap-history');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  const sprints = [
    {
      number: 3,
      objective: 'Auth con OAuth2',
      dates: { start: '2026-04-15', end: '2026-04-30' },
      deliverables: ['endpoint /login', 'middleware'],
      lessons: ['OAuth2 + state cookie es suficiente'],
    },
    {
      number: 2,
      objective: 'Memoria del proyecto',
      dates: { start: '2026-04-01', end: '2026-04-14' },
      deliverables: ['memory/'],
      lessons: [],
    },
  ];
  mod.renderRoadmap(body, titleEl, { markdown: '# Roadmap\n' }, sprints);
  const details = body.findAllByTag('details');
  assert.strictEqual(details.length, 2, 'dos <details> para dos sprints');
  const summaries = body.findAllByTag('summary');
  assert.strictEqual(summaries.length, 2);
  assert.ok(flattenText(summaries[0]).includes('Sprint 3'));
  assert.ok(flattenText(summaries[0]).includes('2026-04-15'));
  assert.ok(flattenText(summaries[0]).includes('2026-04-30'));
  // El body del primer details debe contener objetivo, entregables y lessons.
  const text0 = flattenText(details[0]);
  assert.ok(text0.includes('Auth con OAuth2'));
  assert.ok(text0.includes('endpoint /login'));
  assert.ok(text0.includes('OAuth2 + state cookie'));
});

// ---------- XSS guard (reforzado en fase 7) ----------

test('XSS guard fase 7: panel.js sigue sin usar innerHTML con datos del state', () => {
  const src = readFileSync(PANEL_PATH, 'utf8');
  const lines = src.split(/\r?\n/);
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const trimmed = ln.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (/\.innerHTML\s*=/.test(ln)) offenders.push(`L${i + 1}: ${ln}`);
  }
  assert.strictEqual(offenders.length, 0,
    `panel.js no debe usar .innerHTML = ... (ADR-02). Offenders:\n${offenders.join('\n')}`);
});
