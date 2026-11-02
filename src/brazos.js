// src/brazos.js
// Directorio de "brazos": integraciones que le dan al orquestador capacidad de
// EJECUTAR (API, MCP, CLI, skill, librería, plugin, conector). Lee
// brazos/directorio.json y responde 4 preguntas:
//
//   node src/brazos.js status                 qué está conectado, qué falta auth, qué no está instalado
//   node src/brazos.js suggest "<proyecto>"   qué brazos convienen para este proyecto (top N con razón)
//   node src/brazos.js connect <id>           IMPRIME los pasos para conectarlo (no instala nada)
//   node src/brazos.js mcp-json <ids...>      muestra el .mcp.json del proyecto; con --write lo escribe
//
// Nunca imprime valores de API keys: solo dice si la variable existe.
// `status` llama a `claude mcp list` (tarda ~10-20 s); el resultado se guarda
// 10 minutos en .cache/. Usa --sin-mcp para saltarlo o --refrescar para forzarlo.
// Idioma: español neutro.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { codexStatus } from './astra.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const DIRECTORIO_PATH = join(REPO_ROOT, 'brazos', 'directorio.json');
export const SCHEMA_PATH = join(REPO_ROOT, 'brazos', 'directorio.schema.json');
const MCP_CACHE = join(REPO_ROOT, '.cache', 'brazos-mcp-list.txt');
const MCP_CACHE_MS = 10 * 60 * 1000;

export const ESTADOS = {
  conectado: 'conectado',
  falta_auth: 'falta auth',
  no_instalado: 'no instalado',
  revisar: 'revisar a mano',
};

export class BrazosError extends Error {}

// ---------------------------------------------------------------------------
// Carga y validación
// ---------------------------------------------------------------------------

export function validateDirectorio(data, schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const errors = [];
  if (!validate(data)) {
    for (const e of validate.errors) errors.push(`${e.instancePath || '(raíz)'} ${e.message}`);
  }
  const ids = new Set();
  for (const e of data?.entradas || []) {
    if (ids.has(e.id)) errors.push(`id duplicado: ${e.id}`);
    ids.add(e.id);
    if (e.mcp && !e.mcp.url && !e.mcp.command) errors.push(`${e.id}: mcp necesita url o command`);
    if (e.auth?.env_var && !e.check.some(c => c.tipo === 'env' && c.valor === e.auth.env_var)) {
      errors.push(`${e.id}: auth.env_var ${e.auth.env_var} sin check de tipo env`);
    }
  }
  return errors;
}

export function loadDirectorio(path = DIRECTORIO_PATH) {
  if (!existsSync(path)) throw new BrazosError(`No existe ${path}`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const errors = validateDirectorio(data);
  if (errors.length) throw new BrazosError(`Directorio inválido:\n- ${errors.join('\n- ')}`);
  return data.entradas;
}

// ---------------------------------------------------------------------------
// Checks (inyectables para tests)
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /^(|pega-aqui.*|tu-key.*|xxx+|changeme|sk-\.\.\.)$/i;

function readDotEnv(root) {
  const out = {};
  const p = join(root, '.env');
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function onPath(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [cmd], { encoding: 'utf8', shell: false });
  return r.status === 0;
}

function expandHome(p, home) {
  return p.startsWith('~') ? join(home, p.slice(1)) : p;
}

function pluginInstalled(name, home) {
  const lname = name.toLowerCase();
  const dirs = [
    join(home, '.claude', 'skills'),
    join(home, '.claude', 'plugins', 'data'),
    join(home, '.claude', 'plugins', 'cache'),
  ];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    try {
      if (readdirSync(d).some(n => n.toLowerCase().startsWith(lname))) return true;
    } catch { /* sin permisos: seguimos */ }
  }
  for (const f of [join(home, '.claude', 'settings.json'), join(home, '.claude.json')]) {
    if (!existsSync(f)) continue;
    try {
      const enabled = JSON.parse(readFileSync(f, 'utf8')).enabledPlugins || {};
      if (Object.keys(enabled).some(k => k.toLowerCase().startsWith(`${lname}@`) && enabled[k])) return true;
    } catch { /* JSON grande o roto: seguimos */ }
  }
  return false;
}

/** Lee `claude mcp list` (con caché de 10 min). Devuelve el texto o null si no se pudo. */
export function readMcpList({ refresh = false, root = REPO_ROOT } = {}) {
  const cache = root === REPO_ROOT ? MCP_CACHE : join(root, '.cache', 'brazos-mcp-list.txt');
  if (!refresh && existsSync(cache) && Date.now() - statSync(cache).mtimeMs < MCP_CACHE_MS) {
    return readFileSync(cache, 'utf8');
  }
  const r = spawnSync('claude', ['mcp', 'list'], {
    encoding: 'utf8', timeout: 90_000, shell: process.platform === 'win32',
  });
  if (r.status !== 0 && !r.stdout) return null;
  const text = `${r.stdout || ''}`;
  try { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, text, 'utf8'); } catch { /* sin caché */ }
  return text;
}

/**
 * Busca un servidor en la salida de `claude mcp list`.
 * Devuelve 'ok' | 'auth' | 'falla' | null (no está).
 */
export function mcpStateFromList(listText, name) {
  if (!listText) return null;
  const lname = name.toLowerCase();
  for (const line of listText.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const server = line.slice(0, idx).trim().toLowerCase();
    if (server !== lname && !server.endsWith(` ${lname}`)) continue;
    if (/connected/i.test(line) && !/fail|not connected/i.test(line)) return 'ok';
    if (/needs auth|authenticat|pending approval/i.test(line)) return 'auth';
    return 'falla';
  }
  return null;
}

/** Contexto real (máquina del usuario). Los tests pasan uno falso. */
export function realContext({ root = REPO_ROOT, sinMcp = false, refresh = false } = {}) {
  const dotenv = readDotEnv(root);
  let mcpText;
  let codexSt;
  return {
    env: name => {
      const v = process.env[name] ?? dotenv[name];
      return typeof v === 'string' && !PLACEHOLDER_RE.test(v.trim());
    },
    mcpList: () => {
      if (sinMcp) return null;
      if (mcpText === undefined) mcpText = readMcpList({ refresh, root });
      return mcpText;
    },
    which: onPath,
    exists: p => {
      const full = expandHome(p, homedir());
      return existsSync(isAbsolute(full) ? full : join(root, full));
    },
    plugin: name => pluginInstalled(name, homedir()),
    codex: () => {
      if (codexSt === undefined) {
        try { codexSt = codexStatus(); } catch { codexSt = null; }
      }
      return codexSt;
    },
  };
}

/**
 * Evalúa los checks de una entrada.
 * Reglas: si falla un check de instalación → no instalado; si pasa la
 * instalación pero falta una credencial (env o MCP que pide auth) → falta auth;
 * si todo pasa → conectado. Un check `manual` o un MCP sin `claude mcp list`
 * disponible deja la entrada en "revisar a mano".
 */
export function evaluateEntry(entry, ctx) {
  const notas = [];
  let instalacion = true;
  let auth = true;
  let incierto = false;
  for (const c of entry.check) {
    const rol = c.rol || (c.tipo === 'env' ? 'auth' : 'instalacion');
    let ok;
    switch (c.tipo) {
      case 'env': ok = ctx.env(c.valor); if (!ok) notas.push(`falta ${c.valor} en .env`); break;
      case 'cli': ok = ctx.which(c.valor); if (!ok) notas.push(`"${c.valor}" no está en el PATH`); break;
      case 'file': ok = ctx.exists(c.valor); if (!ok) notas.push(`no existe ${c.valor}`); break;
      case 'plugin': ok = ctx.plugin(c.valor); if (!ok) notas.push(`plugin/skill ${c.valor} no encontrado`); break;
      case 'mcp': {
        const list = ctx.mcpList();
        if (list == null) { incierto = true; notas.push('no se pudo leer `claude mcp list`'); continue; }
        const st = mcpStateFromList(list, c.valor);
        if (st === null) { ok = false; notas.push(`MCP "${c.valor}" no aparece en claude mcp list`); }
        else if (st === 'auth') { auth = false; notas.push('instalado, falta autenticar o aprobar en /mcp'); continue; }
        else if (st === 'falla') { incierto = true; notas.push('instalado pero no conecta'); continue; }
        else ok = true;
        break;
      }
      case 'codex': {
        // Codex (Astra): instalado = instalación; sesión de ChatGPT = auth.
        const st = ctx.codex ? ctx.codex() : null;
        if (!st) { incierto = true; notas.push('no se pudo revisar Codex'); continue; }
        if (!st.instalado) { instalacion = false; notas.push(st.arreglo || 'Codex no instalado'); continue; }
        if (!st.logueado) { auth = false; notas.push(st.arreglo || 'Codex sin sesión'); continue; }
        notas.push(st.detalle);
        continue;
      }
      case 'manual': incierto = true; notas.push(c.valor); continue;
      default: incierto = true; notas.push(`check desconocido: ${c.tipo}`); continue;
    }
    if (!ok) { if (rol === 'auth') auth = false; else instalacion = false; }
  }
  let estado;
  if (!instalacion) estado = ESTADOS.no_instalado;
  else if (!auth) estado = ESTADOS.falta_auth;
  else if (incierto) estado = ESTADOS.revisar;
  else estado = ESTADOS.conectado;
  return { id: entry.id, nombre: entry.nombre, tipo: entry.tipo, categoria: entry.categoria, estado, detalle: notas.join('; ') };
}

export function statusAll(entries, ctx) {
  return entries.map(e => evaluateEntry(e, ctx));
}

export function formatStatusTable(rows) {
  const w = Math.max(4, ...rows.map(r => r.id.length));
  const lines = [`${'id'.padEnd(w)}  ${'estado'.padEnd(14)}  detalle`];
  for (const r of rows) lines.push(`${r.id.padEnd(w)}  ${r.estado.padEnd(14)}  ${r.detalle}`);
  const count = s => rows.filter(r => r.estado === s).length;
  lines.push('', `Conectados: ${count(ESTADOS.conectado)} | Falta auth: ${count(ESTADOS.falta_auth)} | No instalados: ${count(ESTADOS.no_instalado)} | Revisar: ${count(ESTADOS.revisar)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// suggest: ranking por keywords + categoría
// ---------------------------------------------------------------------------

export function normalize(s) {
  return ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').trim()} `;
}

// Señales de texto → categoría probable del proyecto.
export const CATEGORY_SIGNALS = {
  web: ['landing', 'web', 'sitio', 'app', 'aplicacion', 'pagina', 'tienda', 'ecommerce', 'pedidos', 'dashboard', 'formulario', 'frontend', 'backend', 'login'],
  datos: ['base de datos', 'datos', 'tabla', 'pedidos', 'usuarios', 'inventario', 'clientes', 'pagos', 'reservas', 'crm'],
  deploy: ['landing', 'web', 'sitio', 'app', 'publicar', 'deploy', 'online', 'dominio', 'hosting'],
  research: ['investigar', 'research', 'competencia', 'mercado', 'benchmark', 'tendencias', 'fuentes', 'precios'],
  'creativo-imagen': ['foto', 'fotos', 'imagen', 'imagenes', 'ilustracion', 'logo', 'concept art', 'render', 'branding', 'generadas por ia'],
  'creativo-video': ['video', 'videos', 'reel', 'reels', 'animacion', 'motion', 'tiktok', 'clip', 'spot'],
  'creativo-3d': ['3d', 'blender', 'modelo 3d', 'escena 3d'],
  audio: ['voz', 'locucion', 'audio', 'podcast', 'musica', 'narracion', 'doblaje'],
  marketing: ['instagram', 'redes', 'ads', 'anuncios', 'campana', 'seo', 'marketing', 'google', 'meta', 'facebook', 'clientes', 'barrio', 'local'],
  trading: ['trading', 'btc', 'bitcoin', 'cripto', 'acciones', 'tradingview', 'backtest'],
  productividad: ['correo', 'email', 'calendario', 'agenda', 'documentos', 'notion', 'drive', 'notas', 'reunion'],
};

export function inferCategories(text) {
  const norm = normalize(text);
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_SIGNALS)) {
    const hits = kws.filter(k => norm.includes(` ${normalize(k).trim()} `));
    if (hits.length) scores[cat] = hits;
  }
  return scores;
}

/**
 * Rankea entradas para una descripción de proyecto.
 * score = 3 por keyword propia que aparece en el texto + 2 si su categoría fue
 * inferida + 1 si es `recomendado`. Máximo `perCategory` por categoría para no
 * devolver 5 MCPs de lo mismo. Devuelve [{ id, nombre, score, razon, entry }].
 */
export function suggest(text, entries, { limit = 8, perCategory = 3, statusById = null } = {}) {
  const norm = normalize(text);
  const cats = inferCategories(text);
  const scored = entries.map(e => {
    const kwHits = e.keywords.filter(k => norm.includes(` ${normalize(k).trim()} `));
    const catHit = Boolean(cats[e.categoria]);
    let score = kwHits.length * 3 + (catHit ? 2 : 0);
    if (score > 0 && e.recomendado) score += 1;
    const motivos = [];
    if (kwHits.length) motivos.push(`mencionas ${kwHits.slice(0, 3).map(k => `"${k}"`).join(', ')}`);
    if (catHit && !kwHits.length) motivos.push(`el proyecto toca ${e.categoria} (${cats[e.categoria].slice(0, 2).join(', ')})`);
    const estado = statusById?.[e.id];
    return {
      id: e.id, nombre: e.nombre, categoria: e.categoria, score,
      razon: `${e.para_que} Porque ${motivos.join(' y ')}.`,
      estado: estado || null,
      entry: e,
    };
  }).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const perCat = {};
  const out = [];
  for (const s of scored) {
    perCat[s.categoria] = (perCat[s.categoria] || 0) + 1;
    if (perCat[s.categoria] > perCategory) continue;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// connect: SOLO imprime pasos
// ---------------------------------------------------------------------------

export function connectSteps(entry) {
  const lines = [`${entry.nombre} (${entry.tipo}, ${entry.oficial ? 'oficial' : 'NO oficial / comunidad'})`, `Para qué: ${entry.para_que}`, ''];
  let n = 1;
  if (entry.como_conectar.comando) {
    lines.push(`${n++}. En una terminal PowerShell nueva (no dentro de Claude Code), corre:`);
    lines.push(`   ${entry.como_conectar.comando}`);
    lines.push('   (esto registra la integración; no gasta dinero)');
  }
  for (const p of entry.como_conectar.pasos) lines.push(`${n++}. ${p}`);
  if (entry.auth.necesita) {
    lines.push('', `Credencial: ${entry.auth.credencial}${entry.auth.env_var ? ` → guárdala en .env como ${entry.auth.env_var}` : ''}`);
  }
  lines.push(`Costo: ${entry.costo}`);
  if (entry.riesgos) lines.push(`Ojo: ${entry.riesgos}`);
  if (!entry.verificado.ok) lines.push('Aviso: este comando NO está verificado contra la doc oficial; revísalo en el link antes de correrlo.');
  lines.push(`Doc: ${entry.link}`);
  if (entry.tipo === 'mcp') lines.push('', 'Después de instalar un MCP, reinicia Claude Code para que aparezcan sus herramientas.');
  lines.push('', 'Este comando solo imprime los pasos: no instala nada por ti.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// mcp-json: .mcp.json del proyecto (las keys van como ${VAR})
// ---------------------------------------------------------------------------

export function buildMcpJson(entries, existing = null) {
  const out = existing && typeof existing === 'object' ? { ...existing } : {};
  out.mcpServers = { ...(out.mcpServers || {}) };
  const skipped = [];
  for (const e of entries) {
    if (!e.mcp) { skipped.push(e.id); continue; }
    const m = e.mcp;
    const server = m.url ? { type: m.transport || 'http', url: m.url } : { command: m.command, args: m.args || [] };
    if (m.headers) server.headers = m.headers;
    if (m.env) server.env = m.env;
    out.mcpServers[m.nombre] = server;
  }
  return { json: out, skipped };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node src/brazos.js status [--sin-mcp] [--refrescar] [--json]   estado de cada brazo
  node src/brazos.js suggest "<descripción del proyecto>" [--top=8] [--json]
  node src/brazos.js connect <id>                                 imprime los pasos (no instala)
  node src/brazos.js mcp-json <id...> [--write]                   .mcp.json del proyecto (--write lo escribe)
  node src/brazos.js list                                         lista todas las entradas`;

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? true; else rest.push(a);
  }
  return { flags, rest };
}

export function cliMain(argv, { ctx = null, entries = null, root = REPO_ROOT, log = console.log } = {}) {
  const { flags, rest } = parseFlags(argv);
  const [cmd, ...args] = rest;
  try {
    const all = entries || loadDirectorio();
    if (cmd === 'status') {
      const c = ctx || realContext({ root, sinMcp: Boolean(flags['sin-mcp']), refresh: Boolean(flags.refrescar) });
      const rows = statusAll(all, c);
      log(flags.json ? JSON.stringify(rows, null, 2) : formatStatusTable(rows));
      return 0;
    }
    if (cmd === 'suggest') {
      const text = args.join(' ');
      if (!text) { log(USAGE); return 1; }
      let statusById = null;
      if (ctx || flags.estado) {
        const c = ctx || realContext({ root, sinMcp: Boolean(flags['sin-mcp']) });
        statusById = Object.fromEntries(statusAll(all, c).map(r => [r.id, r.estado]));
      }
      const top = suggest(text, all, { limit: Number(flags.top) || 8, statusById });
      if (flags.json) { log(JSON.stringify(top.map(({ entry, ...s }) => ({ ...s, connect: `node src/brazos.js connect ${s.id}` })), null, 2)); return 0; }
      if (!top.length) { log('No encontré brazos claros para esto. Revisa la lista con: node src/brazos.js list'); return 0; }
      top.forEach((s, i) => log(`${i + 1}. ${s.id} [${s.categoria}]${s.estado ? ` (${s.estado})` : ''}: ${s.razon}`));
      log('\nPara conectar uno: node src/brazos.js connect <id>');
      return 0;
    }
    if (cmd === 'connect') {
      const e = all.find(x => x.id === args[0]);
      if (!e) { log(`No existe el brazo "${args[0] || ''}". Lista: node src/brazos.js list`); return 1; }
      log(connectSteps(e));
      return 0;
    }
    if (cmd === 'mcp-json') {
      if (!args.length) { log(USAGE); return 1; }
      const chosen = [];
      for (const id of args) {
        const e = all.find(x => x.id === id);
        if (!e) { log(`No existe el brazo "${id}".`); return 1; }
        chosen.push(e);
      }
      const target = join(root, '.mcp.json');
      const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
      const { json, skipped } = buildMcpJson(chosen, existing);
      const text = JSON.stringify(json, null, 2) + '\n';
      if (skipped.length) log(`Sin bloque MCP (se conectan de otra forma): ${skipped.join(', ')}`);
      if (flags.write) {
        writeFileSync(target, text, 'utf8');
        log(`Escribí ${target}. Reinicia Claude Code y aprueba los servidores cuando te lo pregunte.`);
      } else {
        log(text);
        log('Vista previa: no escribí nada. Si te parece bien, repite el comando con --write.');
      }
      return 0;
    }
    if (cmd === 'list') {
      for (const e of all) log(`${e.id.padEnd(22)} ${e.tipo.padEnd(9)} ${e.categoria.padEnd(16)} ${e.para_que}`);
      return 0;
    }
    log(USAGE);
    return cmd ? 1 : 0;
  } catch (e) {
    log(e.message);
    return 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(cliMain(process.argv.slice(2)));
