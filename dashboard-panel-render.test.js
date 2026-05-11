// dashboard-panel-render.test.js
//
// Tests para dashboard/public/ui/panel.js — render del panel agente y sprint.
//
// Estrategia: instalamos un mock minimal de `document` + globals (no usamos
// jsdom porque la regla del repo dice no añadir deps). El mock cubre:
//   - createElement, createTextNode, getElementById, addEventListener,
//     removeEventListener
//   - Element con textContent, className, style, children, attrs, classList
//   - Click/escape handlers via document.dispatchEvent (sintético)
//
// Solo testeamos lo que importa al invariante:
//   - render con prompt_brief presente
//   - render con prompt_brief ausente → fallback a summary
//   - render con plan_steps + current_step → paso correcto marcado
//   - render con plan_steps vacío → "plan no declarado"
//   - render sprint sin sprint activo → "sin sprint activo"
//   - XSS guard: panel.js no contiene `innerHTML\s*=` con datos del state.
//
// Si llega más DOM API a panel.js que el mock no cubra, los tests fallarán
// claramente — eso es la señal de que hay que ampliar el mock.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = join(__dirname, 'dashboard', 'public', 'ui', 'panel.js');

// ---------- mock DOM ----------

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
    // Concatena recursivamente — los hijos pueden tener textContent.
    if (this._textContent) return this._textContent;
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent || '')).join('');
  }
  set textContent(v) {
    // Limpia hijos y setea texto.
    this.children = [];
    this._textContent = v === null || v === undefined ? '' : String(v);
  }
  appendChild(child) {
    if (child === null || child === undefined) return child;
    if (typeof child === 'string') {
      // Strings se convierten en text nodes implícitos.
      this.children.push({ nodeType: 3, textContent: child, _textContent: child, parentNode: this });
      return child;
    }
    if (child.parentNode && typeof child.parentNode.removeChild === 'function') {
      child.parentNode.removeChild(child);
    }
    try { child.parentNode = this; } catch { /* algunos nodes son frozen */ }
    // Si tengo textContent directo, lo "convierto" a text node implícito.
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
  // Búsqueda recursiva por className. Útil en asserts.
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
}

function installDOM() {
  const documentMock = {
    body: new MockEl('body'),
    _byId: new Map(),
    createElement(tag) { return new MockEl(tag); },
    createTextNode(text) {
      // Devolvemos un nodo-like que apariencia textContent y parentNode pueden setearse.
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
  // Atom DOM completo en globalThis.
  globalThis.document = documentMock;
  globalThis.window = { document: documentMock };
  // EventTarget ya existe en Node 18+, no hace falta polyfill.
  // CustomEvent también existe.
  // fetch lo apagamos — el panel hace fetch en open*; para tests llamamos
  // renderAgent / renderSprint directos para evitar la red.
  globalThis.fetch = async () => { throw new Error('fetch desactivado en test'); };
  return documentMock;
}

function buildAside(documentMock, id = 'panel') {
  const aside = new MockEl('aside');
  aside.setAttribute('id', id);
  documentMock._byId.set(id, aside);
  return aside;
}

// ---------- helpers de assert ----------

function flattenText(el) {
  if (!el) return '';
  if (typeof el === 'string') return el;
  if (el.nodeType === 3) return el.textContent || el._textContent || '';
  if (el._textContent) return el._textContent;
  return (el.children || []).map(c => flattenText(c)).join(' ');
}

// ---------- carga de panel.js ----------

let panelMod;
async function loadPanel() {
  if (panelMod) return panelMod;
  installDOM();
  // cache-bust para asegurar import fresco si se re-corre.
  panelMod = await import('./dashboard/public/ui/panel.js');
  return panelMod;
}

// ---------- tests ----------

test('renderAgent: prompt_brief presente → se muestra como brief', async () => {
  const documentMock = installDOM();
  buildAside(documentMock);
  const mod = await import('./dashboard/public/ui/panel.js?case=brief-present');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  const snapshot = {
    active_tasks: [{
      id: 'demo-1',
      agent: 'ArchitectAgent',
      agent_role: 'Diseña sistema',
      role_full: 'Diseña el sistema completo de auth',
      summary: 'fallback summary que NO debe salir',
      title: 'fallback title',
      prompt_brief: 'Diseñar el sistema de auth con OAuth2',
      plan_steps: [],
      current_step: 0,
      status: 'running',
      started_at: new Date().toISOString(),
      ended_at: null,
      tokens_estimated: 1234,
      artifacts: [],
    }],
    events: [],
  };
  mod.renderAgent(body, titleEl, snapshot, 'ArchitectAgent');
  const brief = body.findByClass('panel-brief-text');
  assert.ok(brief, 'render debió crear .panel-brief-text');
  assert.strictEqual(brief._textContent, 'Diseñar el sistema de auth con OAuth2');
});

test('renderAgent: prompt_brief ausente → fallback a summary', async () => {
  const documentMock = installDOM();
  buildAside(documentMock);
  const mod = await import('./dashboard/public/ui/panel.js?case=brief-fallback');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  const snapshot = {
    active_tasks: [{
      id: 'demo-1',
      agent: 'ArchitectAgent',
      role_full: 'rol',
      summary: 'Este es el summary fallback',
      title: 'titulo',
      prompt_brief: null,
      plan_steps: [],
      current_step: 0,
      status: 'running',
      started_at: new Date().toISOString(),
      artifacts: [],
    }],
    events: [],
  };
  mod.renderAgent(body, titleEl, snapshot, 'ArchitectAgent');
  const brief = body.findByClass('panel-brief-text');
  assert.ok(brief);
  assert.strictEqual(brief._textContent, 'Este es el summary fallback');
});

test('renderAgent: plan_steps + current_step → paso correcto marcado', async () => {
  const documentMock = installDOM();
  buildAside(documentMock);
  const mod = await import('./dashboard/public/ui/panel.js?case=plan-current');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  const snapshot = {
    active_tasks: [{
      id: 'demo-1',
      agent: 'A',
      role_full: 'rol',
      prompt_brief: 'brief',
      plan_steps: ['Paso uno', 'Paso dos', 'Paso tres'],
      current_step: 1,
      status: 'running',
      started_at: new Date().toISOString(),
      artifacts: [],
    }],
    events: [],
  };
  mod.renderAgent(body, titleEl, snapshot, 'A');
  const done = body.findAllByClass('plan-step-done');
  const current = body.findAllByClass('plan-step-current');
  const future = body.findAllByClass('plan-step-future');
  assert.strictEqual(done.length, 1, 'debió haber 1 paso done (i<1)');
  assert.strictEqual(current.length, 1, 'debió haber 1 paso current (i===1)');
  assert.strictEqual(future.length, 1, 'debió haber 1 paso future (i>1)');
  // El current debe ser "Paso dos".
  assert.ok(flattenText(current[0]).includes('Paso dos'));
});

test('renderAgent: plan_steps vacío → "Plan no declarado"', async () => {
  const documentMock = installDOM();
  buildAside(documentMock);
  const mod = await import('./dashboard/public/ui/panel.js?case=plan-empty');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  const snapshot = {
    active_tasks: [{
      id: 'demo-1',
      agent: 'A',
      prompt_brief: 'brief',
      plan_steps: [],
      current_step: 0,
      status: 'running',
      started_at: new Date().toISOString(),
      artifacts: [],
    }],
    events: [],
  };
  mod.renderAgent(body, titleEl, snapshot, 'A');
  const text = flattenText(body);
  assert.ok(/[Pp]lan no declarado/.test(text), `texto del body debió contener "Plan no declarado", obtenido: ${text}`);
});

test('renderSprint: sin sprint activo → "sin sprint activo"', async () => {
  const documentMock = installDOM();
  buildAside(documentMock);
  const mod = await import('./dashboard/public/ui/panel.js?case=sprint-empty');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  // sprint sin objetivo ni número → renderiza vacío.
  mod.renderSprint(body, titleEl, { active_tasks: [], events: [] }, {});
  const text = flattenText(body);
  assert.ok(/[Ss]in sprint activo/.test(text), `body debió contener "sin sprint activo", obtenido: ${text}`);
});

test('renderSprint: con sprint + tasks completadas → renderiza header + sección completed', async () => {
  const documentMock = installDOM();
  buildAside(documentMock);
  const mod = await import('./dashboard/public/ui/panel.js?case=sprint-full');
  const body = new MockEl('div');
  const titleEl = new MockEl('div');
  const snapshot = {
    active_tasks: [
      { id: 't1', agent: 'A1', status: 'completed', summary: 'Hizo X', artifacts: [] },
      { id: 't2', agent: 'A2', status: 'running', summary: 'Haciendo Y', artifacts: [] },
    ],
    events: [],
    metrics: { total_tokens_session: 5000 },
  };
  const sprint = {
    number: 2,
    objective: 'Construir auth',
    started_at: '2026-05-01T00:00:00Z',
  };
  mod.renderSprint(body, titleEl, snapshot, sprint);
  const text = flattenText(body);
  assert.ok(text.includes('Construir auth'), 'debió mostrar el objetivo del sprint');
  assert.ok(/TAREAS COMPLETADAS \(1\)/.test(text), 'debió mostrar contador de completadas = 1');
  assert.strictEqual(titleEl._textContent, 'Sprint 2');
});

// ---------- XSS guard ----------

test('XSS guard: panel.js no usa innerHTML para datos del state', () => {
  const src = readFileSync(PANEL_PATH, 'utf8');
  // Buscamos cualquier asignación `.innerHTML =` (con o sin espacios).
  // Permitimos el string literal en comments — usamos regex que excluye líneas
  // que claramente son comentarios JSDoc/línea (// o *).
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
