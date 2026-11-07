// cockpit/public/uso.js
// Página "Uso": cuántos tokens se gastaron, en qué y qué módulos nunca se usaron.
// Regla XSS del cockpit: los datos entran por textContent o setAttribute, nunca innerHTML.
// Idioma: español neutro.

import { el } from './visuals.js';

const SVG = 'http://www.w3.org/2000/svg';
const PARTES = [
  { clave: 'output', nombre: 'Salida (lo que escribe Claude)', color: 'var(--uso-1)' },
  { clave: 'input', nombre: 'Entrada nueva', color: 'var(--uso-2)' },
  { clave: 'cache_write', nombre: 'Escrituras de caché', color: 'var(--uso-3)' },
  { clave: 'cache_read', nombre: 'Relecturas de caché', color: 'var(--uso-4)' },
];
const GRUPOS = [['modulo', 'Módulos'], ['herramienta', 'Herramientas'], ['skill', 'Skills'], ['catalogo', 'Catálogo opcional']];

const estado = { alcance: 'proyecto', desde: '', turno: 0 };

export function fmt(n) {
  if (n === null || n === undefined) return 's/d';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} mil M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return String(n);
}
const miles = n => Number(n || 0).toLocaleString('es-CL');
const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);

function svg(tag, attrs = {}, ...hijos) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const h of hijos) if (h) node.appendChild(h);
  return node;
}

function tituloSvg(texto) {
  const t = svg('title');
  t.textContent = texto;
  return t;
}

/** Barras horizontales: etiqueta arriba, barra abajo, valor a la derecha. Una sola serie. */
function barras(filas) {
  const max = Math.max(1, ...filas.map(f => f.valor));
  return el('div', { class: 'uso-bars', role: 'list' }, filas.map(f => {
    const ancho = f.valor > 0 ? Math.max(0.8, (f.valor / max) * 100) : 0;
    return el('div', { class: 'uso-bar', role: 'listitem' },
      el('div', { class: 'uso-bar-head' },
        el('span', { class: 'uso-bar-name', text: f.nombre }),
        el('span', { class: 'uso-bar-val', text: f.texto })),
      svg('svg', { class: 'uso-bar-svg', width: '100%', height: 10, 'aria-hidden': 'true' },
        svg('rect', { x: 0, y: 0, width: '100%', height: 10, rx: 4, class: 'uso-bar-bg' }),
        svg('rect', { x: 0, y: 0, width: `${ancho}%`, height: 10, rx: 4, class: 'uso-bar-fill' }, tituloSvg(f.ayuda || `${f.nombre}: ${miles(f.valor)} tokens`))));
  }));
}

/** Barra apilada de las cuatro partes, con leyenda y valores siempre visibles. */
function barraPartes(t) {
  const total = t.total || 1;
  let x = 0;
  const rects = [];
  for (const p of PARTES) {
    const w = (t[p.clave] / total) * 100;
    if (w <= 0) continue;
    rects.push(svg('rect', { x: `${x}%`, y: 0, width: `${w}%`, height: 26, fill: p.color, class: 'uso-seg' }, tituloSvg(`${p.nombre}: ${miles(t[p.clave])} tokens`)));
    x += w;
  }
  const leyenda = el('ul', { class: 'uso-legend' }, PARTES.map(p => {
    const dot = el('span', { class: 'uso-dot' });
    dot.style.background = p.color;
    return el('li', {}, dot, el('span', { text: p.nombre }), el('strong', { text: `${fmt(t[p.clave])} · ${pct(t[p.clave], total)}%` }));
  }));
  return el('div', {}, svg('svg', { class: 'uso-stack', width: '100%', height: 26, role: 'img', 'aria-label': 'Reparto de tokens por tipo' }, ...rects), leyenda);
}

const tile = (valor, etiqueta) => el('div', { class: 'uso-tile' }, el('div', { class: 'uso-tile-n', text: valor }), el('div', { class: 'uso-tile-l', text: etiqueta }));

const tileSinDatos = nombre => el('div', { class: 'uso-tile uso-tile-vacio' }, el('div', { class: 'uso-tile-l', text: `${nombre}: sin datos` }));

function tarjeta(titulo, ...cuerpo) {
  return el('section', { class: 'uso-card' }, el('h2', { text: titulo }), ...cuerpo);
}

function chipsNunca(lista) {
  return GRUPOS.filter(([g]) => lista.some(m => m.grupo === g)).map(([g, nombre]) => el('div', { class: 'uso-group' },
    el('div', { class: 'uso-group-l', text: nombre }),
    el('div', { class: 'uso-chips' }, lista.filter(m => m.grupo === g).map(m => el('span', { class: 'uso-chip', title: m.descripcion || m.id, text: m.id })))));
}

function filasModulos(mods) {
  return mods.slice(0, 12).map(m => ({
    nombre: m.id,
    valor: m.tokens,
    texto: `~${fmt(m.tokens)} · ${m.veces} ${m.veces === 1 ? 'vez' : 'veces'}`,
    ayuda: `${m.id}: unos ${miles(m.tokens)} tokens (aproximado), ${m.pct}% del total`,
  }));
}

function externos(e) {
  const c = e.council;
  const a = e.astra;
  return el('div', { class: 'uso-tiles' },
    c ? tile(`USD ${Number(c.usd).toFixed(2)}`, `Council · ${c.corridas} corridas`) : tileSinDatos('Council'),
    a ? tile(String(a.imagenes), `Imágenes de Astra · ${a.pedidos} pedidos`) : tileSinDatos('Astra'));
}

function detalle(r) {
  const t = r.totales;
  const cuerpo = el('div', { class: 'uso-more' });
  cuerpo.appendChild(el('p', { text: r.aviso_atribucion }));
  cuerpo.appendChild(el('p', { text: r.aviso_limites }));
  cuerpo.appendChild(el('p', { text: 'La carga base incluye a Claude Code, los MCP y tu CLAUDE.md global, no solo al starter.' }));
  cuerpo.appendChild(el('h3', { text: 'Por modelo' }));
  cuerpo.appendChild(barras(r.por_modelo.map(m => ({ nombre: m.modelo, valor: m.total, texto: `${fmt(m.total)} · ${pct(m.total, t.total)}%` }))));
  if (r.subagentes_por_tipo.length) {
    cuerpo.appendChild(el('h3', { text: 'Subagentes por tipo' }));
    cuerpo.appendChild(barras(r.subagentes_por_tipo.slice(0, 8).map(a => ({ nombre: a.tipo, valor: a.total, texto: `${fmt(a.total)} · ${a.agentes}` }))));
  }
  if (r.otras_skills.length) {
    cuerpo.appendChild(el('h3', { text: 'Otras skills usadas (fuera del starter)' }));
    cuerpo.appendChild(el('div', { class: 'uso-chips' }, r.otras_skills.map(s => el('span', { class: 'uso-chip', text: `${s.nombre} · ${s.veces}` }))));
  }
  if (r.lectura.lineas_malas) cuerpo.appendChild(el('p', { text: `Se saltaron ${r.lectura.lineas_malas} líneas dañadas.` }));
  return el('details', { class: 'uso-details' }, el('summary', { text: 'Ver más' }), cuerpo);
}

function pintar(box, r) {
  const t = r.totales;
  const esTodos = r.alcance === 'todos';
  const titulo = box.querySelector('#uso-title');
  while (titulo.firstChild) titulo.removeChild(titulo.firstChild);
  const cuerpo = box.querySelector('#uso-body');
  while (cuerpo.firstChild) cuerpo.removeChild(cuerpo.firstChild);
  if (!t.total) {
    titulo.textContent = 'Todavía no hay datos de uso';
    cuerpo.appendChild(el('p', { class: 'uso-empty', text: 'Se llena solo a medida que trabajas con Claude Code en este proyecto. Medirlo no gasta tokens.' }));
    if (r.nunca_usados.length) cuerpo.appendChild(tarjeta(`Nunca usados: ${r.nunca_usados.length}`, ...chipsNunca(r.nunca_usados)));
    return;
  }
  titulo.append(esTodos ? 'Tus proyectos gastaron ' : 'Este proyecto gastó ', el('em', { text: fmt(t.total) }), ' tokens');
  cuerpo.appendChild(el('div', { class: 'uso-tiles' },
    tile(fmt(t.nuevos), 'sin contar relecturas'),
    tile(fmt(r.carga_base.mediana), 'al abrir cada sesión'),
    tile(`${pct(r.subagentes.total + r.rondas.total, t.total)}%`, 'en subagentes y rondas'),
    esTodos ? tile(String(r.proyectos.length), 'proyectos') : tile(String(r.sesiones.length), r.sesiones.length === 1 ? 'sesión' : 'sesiones')));
  if (r.sugerencias.length) {
    cuerpo.appendChild(el('section', { class: 'uso-card uso-tips' }, el('h2', { text: 'Para gastar menos' }),
      el('ol', {}, r.sugerencias.map(s => el('li', { text: s })))));
  }
  // MCP globales: cargan en cada sesión de cada proyecto (solo nombres; no se cambia tu configuración).
  if ((r.mcp_globales || []).length) {
    cuerpo.appendChild(el('section', { class: 'uso-card uso-tips' }, el('h2', { text: 'MCP que cargan en todos tus proyectos' }),
      el('ul', {}, r.mcp_globales.map(m => el('li', { text: `${m.servidores.join(', ')} (${m.alcance === 'usuario' ? 'tu configuración de usuario' : 'un .mcp.json en una carpeta superior'})` }))),
      el('p', { class: 'uso-note', text: 'Suman tokens en cada sesión. Si solo los usa un proyecto, muévelos al .mcp.json de ese proyecto (la ruta exacta sale en node src/uso.js).' })));
  }
  cuerpo.appendChild(tarjeta('En qué se fue', barraPartes(t)));
  const rejilla = el('div', { class: 'uso-grid' });
  rejilla.appendChild(tarjeta('Lo que más gastó', barras(r.quemadores.map(q => ({ nombre: q.etiqueta, valor: q.total, texto: `${fmt(q.total)} · ${q.pct}%` })))));
  rejilla.appendChild(tarjeta(esTodos ? 'Módulos en proyectos reales' : 'Módulos usados',
    el('p', { class: 'uso-note', text: 'Tokens aproximados.' }),
    r.modulos.length ? barras(filasModulos(r.modulos)) : el('p', { class: 'uso-empty', text: 'Ninguno todavía.' })));
  rejilla.appendChild(tarjeta(`Nunca usados: ${r.nunca_usados.length}`,
    el('p', { class: 'uso-note', text: 'Candidatos a borrar del starter.' }), ...chipsNunca(r.nunca_usados)));
  if (esTodos) {
    rejilla.appendChild(tarjeta('Proyectos', barras(r.proyectos.map(p => ({
      nombre: `${p.nombre}${p.borrado ? ' (carpeta borrada)' : ''}${p.desarrollo_del_starter ? ' (desarrollo del starter)' : ''}`,
      valor: p.total, texto: `${fmt(p.total)} · ${p.pct}%`,
    })))));
  } else {
    rejilla.appendChild(tarjeta('Sesiones', barras(r.sesiones.map(s => ({
      nombre: `${s.fecha} · ${s.etiqueta || `${s.n_subagentes} subagentes`}`,
      valor: s.total, texto: fmt(s.total),
    })))));
  }
  cuerpo.appendChild(rejilla);
  cuerpo.appendChild(tarjeta('Costos externos', externos(r.externos)));
  cuerpo.appendChild(detalle(r));
}

async function cargar(box) {
  const turno = ++estado.turno;
  const cuerpo = box.querySelector('#uso-body');
  while (cuerpo.firstChild) cuerpo.removeChild(cuerpo.firstChild);
  cuerpo.appendChild(el('p', { class: 'uso-empty', text: 'Calculando…' }));
  const q = new URLSearchParams({ alcance: estado.alcance });
  if (estado.desde) q.set('desde', estado.desde);
  try {
    const res = await fetch(`/api/uso?${q}`);
    const data = await res.json();
    if (turno !== estado.turno) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    pintar(box, data);
  } catch (e) {
    if (turno !== estado.turno) return;
    while (cuerpo.firstChild) cuerpo.removeChild(cuerpo.firstChild);
    cuerpo.appendChild(el('p', { class: 'uso-empty', text: `No pude calcular el uso: ${e.message}` }));
  }
}

function pestana(id, texto, box) {
  return el('button', {
    id: `uso-tab-${id}`, type: 'button', class: `uso-tab${estado.alcance === id ? ' uso-tab-on' : ''}`,
    'aria-pressed': String(estado.alcance === id),
    onclick: () => {
      estado.alcance = id;
      for (const b of box.querySelectorAll('.uso-tab')) {
        const on = b.id === `uso-tab-${id}`;
        b.classList.toggle('uso-tab-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      cargar(box);
    },
  }, texto);
}

export function loadUso(box) {
  if (!box.querySelector('#uso-title')) {
    const desde = el('input', {
      id: 'uso-desde', type: 'date', 'aria-label': 'Contar desde esta fecha',
      onchange: e => { estado.desde = e.target.value; cargar(box); },
    });
    box.append(
      el('h1', { id: 'uso-title', class: 'home-title' }),
      el('div', { class: 'uso-bar-top' },
        el('div', { class: 'uso-tabs' }, pestana('proyecto', 'Este proyecto', box), pestana('todos', 'Todos los proyectos', box)),
        el('label', { class: 'uso-from' }, 'Desde ', desde)),
      el('div', { id: 'uso-body' }));
  }
  return cargar(box);
}
