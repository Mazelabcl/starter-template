// src/uso.js
// Medidor de uso: cuánto gastó cada proyecto del starter y qué módulos se usaron.
// Costo en tokens: CERO. Todo se calcula al leer las transcripciones locales de
// Claude Code (~/.claude/projects/<slug>/*.jsonl y <sesion>/subagents/). No inyecta
// nada en la sesión, no depende de que el modelo anote nada y es retroactivo.
//
// Uso:
//   node src/uso.js                        este proyecto
//   node src/uso.js todos                  todos los proyectos del starter en este PC
//   node src/uso.js --proyecto <carpeta>   otro proyecto
//   --json                                 salida para máquinas
//   --desde YYYY-MM-DD                     solo desde esa fecha
//
// Qué NUNCA hace: subir nada, leer .env, mostrar contenido de mensajes. Del texto de
// los mensajes solo se reconocen nombres de módulos conocidos; lo demás se descarta.
// La atribución de tokens a módulos es una APROXIMACIÓN y se rotula como tal.
// Env: USO_CLAUDE_DIR (carpeta de transcripciones, la usan los tests).
// Idioma: español neutro.

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const AVISO_ATRIBUCION = 'Tokens por módulo: aproximación. Lo más confiable son las rondas y los subagentes lanzados para un módulo; el resto del turno es una estimación.';
export const AVISO_LIMITES = 'Las transcripciones no registran algunas llamadas internas (por ejemplo, títulos automáticos). No se sabe cuánto pesa cada tipo de token en tu límite del plan.';

// Rondas de bold-rounds (`claude -p` dentro de la copia) y worktrees de agentes.
const RONDA_RE = /[\\/]rounds(?:-[^\\/]+)?[\\/]\d+[\\/](?:blind|context)(?:[\\/]|$)/i;
const RAIZ_RE = /^(.*?)[\\/](?:rounds(?:-[^\\/]+)?[\\/]\d+[\\/](?:blind|context)|\.claude[\\/]worktrees[\\/][^\\/]+)(?:[\\/].*)?$/i;
// El repo del starter: se desarrolla a sí mismo, así que su uso no dice qué sirve en un proyecto real.
const STARTER_DEV_RE = /[\\/]starter-template(?:[\\/]|$)/i;
const NOMBRE_SEGURO = /^[\w:.@-]{1,80}$/;

// Herramientas del starter que no están en modulos.json.
const EXTRAS = [
  { id: 'kickoff', descripcion: 'Entrevista inicial y plan de batalla.', comandos: ['.claude/skills/kickoff/plan.js'], skills: ['kickoff'], slash: ['kickoff'] },
  { id: 'research', descripcion: 'Research con fuentes (Perplexity).', comandos: ['src/research.js'], npm: ['research'] },
  { id: 'image-gen', descripcion: 'Imágenes con gpt-image-2.', comandos: ['scripts/openai_images.py', 'scripts/replicate_images.py', 'scripts/gemini_images.py'], skills: ['image-gen'] },
  { id: 'image-explorer', descripcion: 'Comparar un prompt en varios modelos de imagen.', comandos: ['src/image_explorer.js'], skills: ['image-explorer'] },
  { id: 'review-app', descripcion: 'Visor de .md de agentes.', comandos: ['review-app/server.js'], skills: ['review-app'], npm: ['review-app'] },
  { id: 'roadmap', descripcion: 'Roadmap y backlog (/idea, /roadmap).', comandos: ['src/roadmap.js'], slash: ['roadmap', 'idea'] },
  { id: 'memoria', descripcion: 'Memoria del proyecto (decisiones, lecciones).', comandos: ['src/memory.js'] },
  { id: 'resumen', descripcion: 'Resumen visual del proyecto.', comandos: ['scripts/build_resumen.js'], slash: ['resumen'] },
  { id: 'importar-modulo', descripcion: 'Traer módulos a un proyecto viejo.', comandos: ['scripts/importar_modulo.js'], slash: ['importar-modulo'] },
  { id: 'agent-template', descripcion: 'Crear un agente fijo.', skills: ['agent-template'] },
  { id: 'multimodal-validation', descripcion: 'Validar imágenes generadas mirándolas.', skills: ['multimodal-validation'] },
];

// Herramientas de un solo paso: cuentan como uso, pero el trabajo que sigue en el turno
// o un subagente que las toca de pasada no es "gasto de ellas" (solo la llamada que las corre).
const DE_UN_PASO = new Set(['cockpit', 'brazos', 'roadmap', 'memoria', 'agent-template', 'importar-modulo', 'resumen', 'multimodal-validation', 'review-app', 'uso']);

// Comandos que solo existen en el starter: prueban que una carpeta sin marcador fue un proyecto suyo.
const EVIDENCIA = new Set(['cockpit', 'council', 'bold-rounds', 'astra', 'brazos', 'roles', 'kickoff']);

const CONSEJOS = {
  'bold-rounds': 'Pide menos rondas: cada ronda lanza dos variantes completas.',
  council: 'Convoca menos expertos y pásale menos contexto.',
  research: 'Pide el research al hilo principal: un subagente solo para eso relee mucho.',
  kickoff: 'Es un gasto de una vez; si se repite, revisa por qué se relanza.',
  'video-director': 'Aprueba el guion antes de pedir renders nuevos.',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const num = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const isWin = process.platform === 'win32';

function normPath(p) {
  const n = resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return isWin ? n.toLowerCase() : n;
}

/** ¿child es root o está dentro de root? Compara rutas ya resueltas. */
export function estaDentro(child, root) {
  const c = normPath(child);
  const r = normPath(root);
  return c === r || c.startsWith(`${r}/`);
}

/** Nombre de carpeta que Claude Code usa para una ruta. */
export const slugDe = p => resolve(p).replace(/[^a-zA-Z0-9]/g, '-');

/** Raíz real del proyecto para un cwd: quita rounds/NNN/x y .claude/worktrees/x. */
export function raizCanonica(cwd) {
  const m = RAIZ_RE.exec(cwd);
  return m ? m[1] : cwd;
}

/** ¿Es (o contiene directamente) un proyecto del starter? */
export function esCarpetaStarter(dir) {
  // Clones viejos no traen modulos.json ni cockpit, pero sí la skill kickoff.
  const marcada = d => existsSync(join(d, 'modulos.json')) || existsSync(join(d, 'cockpit', 'server.js')) || existsSync(join(d, '.claude', 'skills', 'kickoff', 'SKILL.md'));
  if (marcada(dir)) return true;
  let nombres = [];
  try { nombres = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  return nombres.some(d => d.isDirectory() && marcada(join(dir, d.name)));
}

export function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

export function claudeDirDefault(env = process.env) {
  if (env.USO_CLAUDE_DIR) return resolve(env.USO_CLAUDE_DIR);
  if (env.CLAUDE_CONFIG_DIR) return join(resolve(env.CLAUDE_CONFIG_DIR), 'projects');
  return join(homedir(), '.claude', 'projects');
}

/** Fecha local 'YYYY-MM-DD' → ms; lanza si no es válida. */
export function parseDesde(s) {
  if (s === undefined || s === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const ms = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
  if (Number.isNaN(ms) || new Date(ms).getDate() !== Number(m[3]) || new Date(ms).getMonth() !== Number(m[2]) - 1) throw new Error(`Fecha inválida "${s}". Usa YYYY-MM-DD, por ejemplo 2026-10-30.`);
  return ms;
}

const fechaLocal = ms => {
  if (!ms) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const vacio = () => ({ output: 0, input: 0, cache_write: 0, cache_read: 0, total: 0, nuevos: 0, llamadas: 0 });
function sumar(a, r) {
  a.output += r.output; a.input += r.input; a.cache_write += r.cache_write; a.cache_read += r.cache_read;
  a.total += r.output + r.input + r.cache_write + r.cache_read;
  a.nuevos += r.output + r.input + r.cache_write;
  a.llamadas += 1;
  return a;
}
const contexto = r => r.input + r.cache_write + r.cache_read;
const totalRec = r => contexto(r) + r.output;
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// ---------------------------------------------------------------------------
// Catálogo de módulos: modulos.json + extras + skills presentes
// ---------------------------------------------------------------------------

function leerManifiesto(root) {
  // Un clon viejo no trae modulos.json: entonces vale el del starter donde vive este archivo.
  // Sin esto, un módulo usado aparecería como "nunca usado" por no reconocerlo.
  for (const f of [join(root, 'modulos.json'), join(root, '.claude', 'uso-modulos.json'), join(REPO_ROOT, 'modulos.json'), join(REPO_ROOT, '.claude', 'uso-modulos.json')]) {
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* sigue */ }
  }
  return { modules: {} };
}

const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function regexComando(ruta) {
  const cuerpo = ruta.split('/').map(escapar).join('[\\\\/]');
  return new RegExp(`(?:^|[\\s&;|(])(?:[^\\s&;|]*[\\\\/])?(?:node|node\\.exe|python[\\d.]*|python[\\d.]*\\.exe|py)\\s+(?:[^|&;\\n]*?[\\s"'=/\\\\(])?${cuerpo}(?=$|[\\s"'&|;)])`, 'i');
}

/** Lista de módulos con sus marcadores. La sacamos de modulos.json para no duplicarla. */
export function catalogoModulos(root) {
  const manifest = leerManifiesto(root);
  const mods = new Map();
  const add = (id, data) => {
    const prev = mods.get(id) || { id, descripcion: '', grupo: 'modulo', comandos: [], skills: [], slash: [], npm: [] };
    mods.set(id, {
      ...prev, ...data,
      comandos: [...prev.comandos, ...(data.comandos || [])],
      skills: [...prev.skills, ...(data.skills || [])],
      slash: [...prev.slash, ...(data.slash || [])],
      npm: [...prev.npm, ...(data.npm || [])],
    });
  };
  for (const [id, mod] of Object.entries(manifest.modules || {})) {
    if (mod.internal) continue;
    const rutas = (mod.files || []).flatMap(f => (typeof f === 'string' ? [f] : [f.src, f.dest]));
    const skills = rutas.map(f => /\.claude\/skills\/(?:_catalog\/)?([^/]+)\/SKILL\.md$/.exec(f)?.[1]).filter(Boolean);
    const slash = rutas.map(f => /\.claude\/commands\/([^/]+)\.md$/.exec(f)?.[1]).filter(Boolean);
    // src/uso.js también viaja con el cockpit (su página lo usa), pero el comando es del módulo uso.
    const comandos = rutas.filter(f => /^(src|scripts|cockpit)\/[^/]+\.js$/.test(f) && (f !== 'src/uso.js' || id === 'uso'));
    add(id, {
      descripcion: String(mod.description || '').split(/[.:]/)[0],
      comandos, skills: [...new Set(skills)], slash: [...new Set(slash)],
      npm: Object.keys(mod.scripts || {}).filter(s => !s.startsWith('test')),
    });
  }
  for (const e of EXTRAS) {
    if (mods.has(e.id)) continue;
    add(e.id, { ...e, grupo: 'herramienta' });
  }
  // Skills del proyecto y del catálogo que aún nadie reclama.
  const conocidas = new Set([...mods.values()].flatMap(m => m.skills));
  const raices = [...new Set([resolve(root), REPO_ROOT])];
  for (const [dir, grupo] of raices.flatMap(r => [[join(r, '.claude', 'skills'), 'skill'], [join(r, '.claude', 'skills', '_catalog'), 'catalogo']])) {
    let nombres = [];
    try { nombres = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of nombres) {
      if (!d.isDirectory() || d.name === '_catalog' || conocidas.has(d.name)) continue;
      conocidas.add(d.name);
      add(d.name, { descripcion: grupo === 'catalogo' ? 'Skill opcional del catálogo.' : 'Skill del proyecto.', grupo, skills: [d.name] });
    }
  }
  const lista = [...mods.values()];
  const porSkill = new Map();
  const porSlash = new Map();
  for (const m of lista) {
    for (const s of m.skills) porSkill.set(s, m.id);
    for (const s of m.slash) porSlash.set(s, m.id);
  }
  const reglas = lista.flatMap(m => [
    ...m.comandos.map(c => ({ id: m.id, re: regexComando(c), pista: basename(c) })),
    ...m.npm.map(n => ({ id: m.id, re: new RegExp(`\\bnpm(?:\\.cmd)?\\s+run\\s+${escapar(n)}(?=$|[\\s"'&|;)])`), pista: n })),
  ]);
  return { lista, porSkill, porSlash, reglas };
}

/** Módulos que corre un comando de terminal. grep o cat de un archivo no cuentan. */
export function modulosDeComando(cmd, catalogo) {
  if (typeof cmd !== 'string' || !/node|python|\bpy\b|npm/i.test(cmd)) return [];
  const out = new Set();
  for (const r of catalogo.reglas) if (cmd.includes(r.pista) && r.re.test(cmd)) out.add(r.id);
  return [...out];
}

// ---------------------------------------------------------------------------
// Lectura de transcripciones
// ---------------------------------------------------------------------------

function nuevoColector(catalogo) {
  return {
    catalogo,
    recs: new Map(),
    sesiones: new Map(),
    lanzamientos: new Map(),
    enlaces: new Map(),
    herramientasVistas: new Set(),
    eventos: [],
    otrasSkills: [],
    stats: { archivos: 0, lineas: 0, lineas_malas: 0 },
  };
}

function nuevoAgente(id, tipo) {
  return { id, tipo: tipo || 'desconocido', toolUseId: null, cwd: null, primera: null, hits: new Map(), recs: [] };
}

function agenteDe(sesion, id) {
  if (!sesion.agentes.has(id)) sesion.agentes.set(id, nuevoAgente(id));
  return sesion.agentes.get(id);
}

function textoDe(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

async function leerArchivo(file, sesion, agenteId, col) {
  col.stats.archivos += 1;
  let turno = null;
  let huboAsistente = true;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    col.stats.lineas += 1;
    if (!line) continue;
    if (line[0] !== '{' || line[line.length - 1] !== '}') { col.stats.lineas_malas += 1; continue; }
    // Filtro barato: el 60% de las líneas (bloques de request, adjuntos) no sirve y pesan mucho.
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { col.stats.lineas_malas += 1; continue; }

    // Formato viejo: subagentes dentro del archivo principal con isSidechain.
    const aid = agenteId || (o.isSidechain ? (o.agentId || 'sidechain') : null);
    const agente = aid ? agenteDe(sesion, aid) : null;
    if (agente && !agente.cwd && typeof o.cwd === 'string') agente.cwd = o.cwd;
    const ts = Date.parse(o.timestamp) || 0;

    if (o.type === 'user') {
      const c = o.message && o.message.content;
      if (o.toolUseResult && o.toolUseResult.agentId && Array.isArray(c)) {
        const tr = c.find(b => b && b.type === 'tool_result');
        if (tr) col.enlaces.set(`${sesion.id}:${o.toolUseResult.agentId}`, tr.tool_use_id);
      }
      if (agente || o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) continue;
      const esPrompt = typeof c === 'string' || (Array.isArray(c) && c.some(b => b && b.type === 'text') && !c.some(b => b && b.type === 'tool_result'));
      if (!esPrompt) continue;
      if (huboAsistente) { turno = null; huboAsistente = false; }
      const m = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(textoDe(c));
      const mod = m && col.catalogo.porSlash.get(m[1]);
      if (mod) {
        col.eventos.push({ mod, tipo: 'slash', ts, sesion: sesion.id });
        if (!DE_UN_PASO.has(mod)) turno = mod;
      }
      continue;
    }

    if (o.type !== 'assistant') continue;
    huboAsistente = true;
    const msg = o.message || {};
    const u = msg.usage;
    let rec = null;
    if (u && msg.model !== '<synthetic>') {
      const clave = msg.id || o.requestId || o.uuid;
      const datos = {
        input: num(u.input_tokens), cache_write: num(u.cache_creation_input_tokens),
        cache_read: num(u.cache_read_input_tokens), output: num(u.output_tokens),
      };
      if (clave && totalRec(datos) > 0) {
        rec = col.recs.get(clave);
        if (rec) {
          // El streaming repite el mensaje: se queda el valor final, no se suma.
          for (const k of Object.keys(datos)) rec[k] = Math.max(rec[k], datos[k]);
        } else {
          rec = { ...datos, modelo: msg.model || 'desconocido', ts, sesion: sesion.id, agente: aid, modulo: null };
          col.recs.set(clave, rec);
          if (agente) { if (!agente.primera) agente.primera = rec; } else if (!sesion.primera) sesion.primera = rec;
        }
      }
    }
    if (rec && !agente && turno && !rec.modulo && rec.sesion === sesion.id) rec.modulo = turno;

    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (!b || b.type !== 'tool_use' || !b.id || col.herramientasVistas.has(b.id)) continue;
      col.herramientasVistas.add(b.id);
      const inp = b.input || {};
      const eventos = [];
      if (b.name === 'Skill' && typeof inp.skill === 'string') {
        const nombre = inp.skill.split(':').pop();
        const mod = col.catalogo.porSkill.get(nombre);
        if (mod) eventos.push([mod, 'skill']);
        else if (NOMBRE_SEGURO.test(inp.skill)) col.otrasSkills.push({ nombre, ts, sesion: sesion.id });
      } else if (b.name === 'Agent' || b.name === 'Task') {
        col.lanzamientos.set(b.id, { modulo: turno, padre: aid, sesion: sesion.id });
      } else if (b.name === 'Bash' || b.name === 'PowerShell') {
        for (const mod of modulosDeComando(inp.command, col.catalogo)) eventos.push([mod, 'comando']);
      } else if (b.name === 'Read' && typeof inp.file_path === 'string') {
        const m = /[\\/]skills[\\/](?:_catalog[\\/])?([^\\/]+)[\\/]SKILL\.md$/.exec(inp.file_path);
        const mod = m && col.catalogo.porSkill.get(m[1]);
        if (mod) eventos.push([mod, 'lectura']);
      }
      for (const [mod, tipo] of eventos) {
        col.eventos.push({ mod, tipo, ts, sesion: sesion.id });
        if (agente) agente.hits.set(mod, (agente.hits.get(mod) || 0) + 1);
        else {
          if (!DE_UN_PASO.has(mod)) turno = mod;
          if (rec && !rec.modulo && rec.sesion === sesion.id) rec.modulo = mod;
        }
      }
    }
  }
}

function buscarAgentes(dir, out = []) {
  let nombres = [];
  try { nombres = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of nombres) {
    const p = join(dir, d.name);
    if (d.isDirectory()) buscarAgentes(p, out);
    else if (/^agent-.*\.jsonl$/.test(d.name)) out.push(p);
  }
  return out;
}

function leerMetaAgente(jsonl) {
  try {
    const m = JSON.parse(readFileSync(jsonl.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    // description se ignora a propósito: sale del prompt.
    return { tipo: typeof m.agentType === 'string' && NOMBRE_SEGURO.test(m.agentType) ? m.agentType : null, toolUseId: m.toolUseId || null };
  } catch { return { tipo: null, toolUseId: null }; }
}

/** Primer cwd de una transcripción, sin leerla entera. */
async function primerCwd(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let n = 0;
  let cwd = null;
  for await (const line of rl) {
    if (++n > 400) break;
    if (!line.includes('"cwd"')) continue;
    try { cwd = JSON.parse(line).cwd || null; } catch { continue; }
    if (cwd) break;
  }
  rl.close();
  return typeof cwd === 'string' ? cwd : null;
}

/** Transcripciones principales de una carpeta de ~/.claude/projects. */
function transcripcionesDe(carpeta) {
  let nombres = [];
  try { nombres = readdirSync(carpeta, { withFileTypes: true }); } catch { return []; }
  return nombres
    .filter(d => d.isFile() && d.name.endsWith('.jsonl') && !d.name.startsWith('agent-'))
    .map(d => ({ id: d.name.replace(/\.jsonl$/, ''), file: join(carpeta, d.name), carpeta }));
}

async function leerSesion(s, cwd, col) {
  if (col.sesiones.has(s.id)) return col.sesiones.get(s.id);
  const sesion = { id: s.id, cwd, ronda: RONDA_RE.test(cwd), primera: null, agentes: new Map() };
  col.sesiones.set(s.id, sesion);
  await leerArchivo(s.file, sesion, null, col);
  for (const f of buscarAgentes(join(s.carpeta, s.id))) {
    const id = basename(f).replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const meta = leerMetaAgente(f);
    const a = agenteDe(sesion, id);
    if (meta.tipo) a.tipo = meta.tipo;
    a.toolUseId = meta.toolUseId;
    await leerArchivo(f, sesion, id, col);
  }
  return sesion;
}

// ---------------------------------------------------------------------------
// Atribución y resumen
// ---------------------------------------------------------------------------

function moduloDeAgente(sesion, a, col, vistos = new Set()) {
  if (vistos.has(a.id)) return null;
  vistos.add(a.id);
  if (a.cwd && RONDA_RE.test(a.cwd)) return 'bold-rounds';
  // Lo que el subagente corrió él mismo, sin contar herramientas de un solo paso.
  const hits = [...a.hits.entries()].filter(([m]) => !DE_UN_PASO.has(m)).sort((x, y) => y[1] - x[1]);
  if (hits.length) return hits[0][0];
  const lanz = col.lanzamientos.get(a.toolUseId || col.enlaces.get(`${sesion.id}:${a.id}`));
  if (lanz && lanz.modulo) return lanz.modulo;
  if (lanz && lanz.padre && sesion.agentes.has(lanz.padre)) return moduloDeAgente(sesion, sesion.agentes.get(lanz.padre), col, vistos);
  return null;
}

const corto = id => String(id).slice(0, 8);
const etiquetaRonda = cwd => {
  const m = /[\\/](\d+)[\\/](blind|context)(?:[\\/]|$)/i.exec(cwd);
  return m ? `Ronda ${m[1]} ${m[2].toLowerCase() === 'blind' ? 'ciega' : 'con contexto'}` : 'Ronda';
};

/** Resumen de un conjunto de sesiones. Solo agrega números y nombres: nunca rutas ni texto. */
function resumir(ids, col, { desde, nombre }) {
  const dentro = r => !desde || r.ts >= desde;
  const set = new Set(ids);
  const totales = vacio();
  const principal = vacio();
  const subagentes = vacio();
  const rondas = vacio();
  const porModelo = new Map();
  const porTipo = new Map();
  const sesiones = new Map();
  const agentes = new Map();
  const mods = new Map(col.catalogo.lista.map(m => [m.id, {
    id: m.id, descripcion: m.descripcion, grupo: m.grupo, veces: 0,
    por_tipo: {}, sesionesSet: new Set(), tokens_directos: 0, tokens_turno: 0,
  }]));
  const mod = id => mods.get(id);
  const modOf = new Map();

  for (const r of col.recs.values()) {
    if (!set.has(r.sesion) || !dentro(r)) continue;
    const ses = col.sesiones.get(r.sesion);
    const t = totalRec(r);
    sumar(totales, r);
    if (!porModelo.has(r.modelo)) porModelo.set(r.modelo, { modelo: r.modelo, ...vacio(), subagentes_total: 0 });
    sumar(porModelo.get(r.modelo), r);
    if (!sesiones.has(r.sesion)) {
      sesiones.set(r.sesion, {
        id: corto(r.sesion), fecha: fechaLocal(r.ts), tipo: ses.ronda ? 'ronda' : 'principal',
        etiqueta: ses.ronda ? etiquetaRonda(ses.cwd) : null, ...vacio(), hilo_principal: 0, n_subagentes: 0, tokens_subagentes: 0,
        agentesSet: new Set(),
      });
    }
    const sr = sesiones.get(r.sesion);
    sumar(sr, r);
    if (r.agente) {
      sumar(subagentes, r);
      porModelo.get(r.modelo).subagentes_total += t;
      sr.tokens_subagentes += t;
      sr.agentesSet.add(r.agente);
      const a = ses.agentes.get(r.agente);
      const clave = `${r.sesion}:${r.agente}`;
      if (!modOf.has(clave)) modOf.set(clave, a ? moduloDeAgente(ses, a, col) : null);
      const m = modOf.get(clave) || (ses.ronda ? 'bold-rounds' : null);
      if (m && mod(m)) mod(m).tokens_directos += t;
      if (!agentes.has(clave)) agentes.set(clave, { tipo: a ? a.tipo : 'desconocido', fecha: fechaLocal(r.ts), sesion: corto(r.sesion), modulo: m, total: 0, llamadas: 0 });
      agentes.get(clave).total += t;
      agentes.get(clave).llamadas += 1;
      const tipo = a ? a.tipo : 'desconocido';
      if (!porTipo.has(tipo)) porTipo.set(tipo, { tipo, agentes: new Set(), total: 0 });
      porTipo.get(tipo).total += t;
      porTipo.get(tipo).agentes.add(clave);
    } else if (ses.ronda) {
      sumar(rondas, r);
      sr.hilo_principal += t;
      if (mod('bold-rounds')) mod('bold-rounds').tokens_directos += t;
    } else {
      sumar(principal, r);
      sr.hilo_principal += t;
      if (r.modulo && mod(r.modulo)) mod(r.modulo).tokens_turno += t;
    }
  }

  // Eventos: cuántas veces y en cuántas sesiones.
  const contar = (id, tipo, sesion) => {
    const m = mod(id);
    if (!m) return;
    m.veces += 1;
    m.por_tipo[tipo] = (m.por_tipo[tipo] || 0) + 1;
    m.sesionesSet.add(sesion);
  };
  for (const e of col.eventos) if (set.has(e.sesion) && (!desde || e.ts >= desde)) contar(e.mod, e.tipo, e.sesion);
  for (const id of set) {
    const s = col.sesiones.get(id);
    if (s && s.ronda && sesiones.has(id)) contar('bold-rounds', 'ronda', id);
  }
  const otras = new Map();
  for (const o of col.otrasSkills) {
    if (!set.has(o.sesion) || (desde && o.ts < desde)) continue;
    otras.set(o.nombre, (otras.get(o.nombre) || 0) + 1);
  }

  // Carga base: tokens de la primera request de cada sesión.
  const bases = { principal: [], rondas: [], subagentes: [] };
  for (const id of set) {
    const s = col.sesiones.get(id);
    if (!s) continue;
    if (s.primera && dentro(s.primera)) (s.ronda ? bases.rondas : bases.principal).push(contexto(s.primera));
    for (const a of s.agentes.values()) if (a.primera && dentro(a.primera)) bases.subagentes.push(contexto(a.primera));
  }
  const cargaBase = {
    mediana: mediana(bases.principal), sesiones: bases.principal.length,
    minimo: bases.principal.length ? Math.min(...bases.principal) : null,
    maximo: bases.principal.length ? Math.max(...bases.principal) : null,
    subagentes_mediana: mediana(bases.subagentes), rondas_mediana: mediana(bases.rondas),
  };

  const listaMods = [...mods.values()].map(m => {
    const { sesionesSet, ...resto } = m;
    return { ...resto, sesiones: sesionesSet.size, tokens: m.tokens_directos + m.tokens_turno, pct: pct(m.tokens_directos + m.tokens_turno, totales.total) };
  });
  const usados = listaMods.filter(m => m.veces > 0 || m.tokens > 0).sort((a, b) => b.tokens - a.tokens || b.veces - a.veces);
  const nunca = listaMods.filter(m => m.veces === 0 && m.tokens === 0 && m.id !== 'uso')
    .map(m => ({ id: m.id, descripcion: m.descripcion, grupo: m.grupo }));

  // Quemadores: lo que más gastó, dicho en simple.
  const quemadores = [];
  for (const s of sesiones.values()) {
    if (!s.hilo_principal) continue;
    quemadores.push({
      tipo: s.tipo === 'ronda' ? 'ronda' : 'sesion',
      etiqueta: s.tipo === 'ronda' ? `${s.etiqueta} del ${s.fecha}` : `Conversación principal del ${s.fecha} (${s.id})`,
      total: s.hilo_principal,
    });
  }
  for (const a of agentes.values()) {
    quemadores.push({ tipo: 'subagente', etiqueta: `Subagente ${a.tipo} del ${a.fecha} (sesión ${a.sesion})${a.modulo ? `, para ${a.modulo}` : ''}`, total: a.total });
  }
  quemadores.sort((a, b) => b.total - a.total);

  const listaSes = [...sesiones.values()].map(({ agentesSet, ...s }) => ({ ...s, n_subagentes: agentesSet.size })).sort((a, b) => b.total - a.total);
  const atribuidos = usados.reduce((n, m) => n + m.tokens, 0);
  const reporte = {
    alcance: 'proyecto',
    proyecto: nombre,
    desde: fechaLocal(desde),
    totales,
    principal,
    subagentes,
    rondas,
    por_modelo: [...porModelo.values()].sort((a, b) => b.total - a.total),
    carga_base: cargaBase,
    sesiones: listaSes,
    subagentes_por_tipo: [...porTipo.values()].map(t => ({ tipo: t.tipo, agentes: t.agentes.size, total: t.total })).sort((a, b) => b.total - a.total),
    modulos: usados,
    tokens_sin_modulo: Math.max(0, totales.total - atribuidos),
    nunca_usados: nunca,
    otras_skills: [...otras.entries()].map(([nombre2, veces]) => ({ nombre: nombre2, veces })).sort((a, b) => b.veces - a.veces),
    quemadores: quemadores.slice(0, 5).map(q => ({ ...q, pct: pct(q.total, totales.total) })),
    aviso_atribucion: AVISO_ATRIBUCION,
    aviso_limites: AVISO_LIMITES,
  };
  reporte.sugerencias = sugerencias(reporte);
  return reporte;
}

/** A lo sumo 3 sugerencias, todas salidas de los datos. Sin datos que las sostengan, no hay. */
export function sugerencias(r) {
  const total = r.totales.total;
  if (!total) return [];
  const out = [];
  const top = r.modulos[0];
  if (top && top.pct >= 15) {
    out.push(`${top.id} usó cerca del ${top.pct}% de los tokens (aproximado). ${CONSEJOS[top.id] || 'Revisa si cada uso valió la pena.'}`);
  }
  const relectura = pct(r.totales.cache_read, total);
  if (relectura >= 70) {
    out.push(`El ${relectura}% del total son relecturas: en cada turno Claude vuelve a leer toda la conversación. Una sesión por tarea y /clear al cambiar de tema lo bajan.`);
  }
  const caros = r.por_modelo.filter(m => /opus/i.test(m.modelo)).reduce((n, m) => n + m.subagentes_total, 0);
  if (pct(caros, total) >= 20) {
    out.push(`Los subagentes con Opus gastaron el ${pct(caros, total)}%. Para leer y buscar, pide subagentes con Sonnet o Haiku.`);
  }
  if (r.carga_base.mediana >= 30000) {
    const otros = r.base_otros;
    out.push(otros
      ? `Cada sesión parte con unos ${fmt(r.carga_base.mediana)} tokens; otros proyectos sin starter parten con ${fmt(otros)}. La mayor parte viene de lo global (MCP, skills y agentes), no del starter.`
      : `Cada sesión parte con unos ${fmt(r.carga_base.mediana)} tokens antes de que digas nada. Revisa qué MCP y agentes globales necesitas de verdad.`);
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Reportes públicos
// ---------------------------------------------------------------------------

function externosDe(root, desde) {
  const leerJsons = dir => {
    let nombres = [];
    try { nombres = readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return []; }
    return nombres.flatMap(n => {
      const f = join(dir, n);
      try {
        if (desde && statSync(f).mtimeMs < desde) return [];
        return [JSON.parse(readFileSync(f, 'utf8'))];
      } catch { return []; }
    });
  };
  const councils = leerJsons(join(root, 'councils', 'results'));
  const astra = leerJsons(join(root, 'astra-bridge', 'resultados'));
  return {
    council: councils.length ? {
      corridas: councils.length,
      usd: Number(councils.reduce((n, c) => n + num(c.metadata && c.metadata.cost_usd), 0).toFixed(4)),
    } : null,
    astra: astra.length ? {
      pedidos: astra.length,
      imagenes: astra.reduce((n, a) => n + (Array.isArray(a.archivos) ? a.archivos.length : 0), 0),
      con_error: astra.filter(a => a.estado === 'error').length,
    } : null,
  };
}

/** Carpetas candidatas: el slug del proyecto y sus derivados (rondas, worktrees). */
function carpetasCandidatas(root, dir) {
  let nombres = [];
  try { nombres = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const slug = slugDe(root);
  const igual = s => (isWin ? s.toLowerCase() : s);
  const cand = nombres.filter(n => igual(n) === igual(slug) || igual(n).startsWith(`${igual(slug)}-`));
  return (cand.length ? cand : nombres).map(n => join(dir, n));
}

export async function reporteProyecto({ root = REPO_ROOT, claudeDir = claudeDirDefault(), desde = null } = {}) {
  const raiz = resolve(root);
  const col = nuevoColector(catalogoModulos(raiz));
  const ids = [];
  for (const carpeta of carpetasCandidatas(raiz, claudeDir)) {
    for (const s of transcripcionesDe(carpeta)) {
      if (desde && statSync(s.file).mtimeMs < desde) continue;
      const cwd = await primerCwd(s.file);
      if (!cwd || !estaDentro(cwd, raiz)) continue;
      await leerSesion(s, cwd, col);
      ids.push(s.id);
    }
  }
  const r = resumir(ids, col, { desde, nombre: basename(raiz) });
  r.externos = externosDe(raiz, desde);
  r.lectura = { ...col.stats };
  return r;
}

export async function reporteTodos({ starterRoot = REPO_ROOT, claudeDir = claudeDirDefault(), desde = null } = {}) {
  let carpetas = [];
  try { carpetas = readdirSync(claudeDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(claudeDir, d.name)); } catch { /* sin datos */ }

  // 1) Agrupar por raíz real del proyecto (se saca del cwd, no del slug).
  const porRaiz = new Map();
  const cargasNoStarter = [];
  const raicesNoStarter = new Set();
  for (const carpeta of carpetas) {
    for (const s of transcripcionesDe(carpeta)) {
      if (desde && statSync(s.file).mtimeMs < desde) continue;
      const cwd = await primerCwd(s.file);
      if (!cwd) continue;
      const raiz = raizCanonica(cwd);
      if (!porRaiz.has(raiz)) porRaiz.set(raiz, []);
      porRaiz.get(raiz).push({ ...s, cwd });
    }
  }

  // 2) Clasificar. Carpeta viva: manda el marcador. Carpeta borrada: se decide por sus transcripciones.
  const col = nuevoColector(catalogoModulos(starterRoot));
  const proyectos = [];
  for (const raiz of [...porRaiz.keys()].sort((a, b) => a.length - b.length)) {
    const sesiones = porRaiz.get(raiz);
    const madre = proyectos.find(p => estaDentro(raiz, p.raiz));
    if (madre) {
      for (const s of sesiones) { await leerSesion(s, s.cwd, col); madre.ids.push(s.id); }
      continue;
    }
    const viva = existsSync(raiz);
    const antes = col.eventos.length;
    const ids = [];
    for (const s of sesiones) { await leerSesion(s, s.cwd, col); ids.push(s.id); }
    // Sin marcador (carpeta borrada, movida o vaciada): vale si sus transcripciones corrieron
    // herramientas propias del starter. Un nombre de skill no basta: también existen globales.
    const conRastro = col.eventos.slice(antes).some(e => (e.tipo === 'comando' || e.tipo === 'slash') && EVIDENCIA.has(e.mod));
    if (!(viva && esCarpetaStarter(raiz)) && !conRastro) {
      for (const id of ids) {
        const c = col.sesiones.get(id);
        if (c && c.primera && !c.ronda && (!desde || c.primera.ts >= desde)) cargasNoStarter.push(contexto(c.primera));
      }
      raicesNoStarter.add(raiz);
      continue;
    }
    proyectos.push({ raiz, ids, borrado: !viva, desarrollo: STARTER_DEV_RE.test(`${raiz}/`) });
  }

  // 3) Resumen por proyecto y en conjunto.
  const filas = [];
  for (const p of proyectos) {
    const ids = p.ids.filter(id => col.sesiones.has(id));
    const r = resumir(ids, col, { desde, nombre: basename(p.raiz) });
    if (!r.totales.total && !r.modulos.length) continue;
    filas.push({ p, ids, r, externos: p.borrado ? { council: null, astra: null } : externosDe(p.raiz, desde) });
  }
  const todosIds = filas.flatMap(f => f.ids);
  const global = resumir(todosIds, col, { desde, nombre: 'Todos' });
  const reales = filas.filter(f => !f.p.desarrollo);

  // Módulos: se rankean sobre proyectos reales; el repo del starter se usa a sí mismo mientras se desarrolla.
  const rank = new Map(col.catalogo.lista.map(m => [m.id, { id: m.id, descripcion: m.descripcion, grupo: m.grupo, veces: 0, proyectos: 0, tokens: 0 }]));
  for (const f of reales) {
    for (const m of f.r.modulos) {
      const x = rank.get(m.id);
      if (!x) continue;
      x.veces += m.veces;
      x.tokens += m.tokens;
      x.proyectos += 1;
    }
  }
  const baseReales = reales.reduce((n, f) => n + f.r.totales.total, 0);
  const modulos = [...rank.values()].filter(m => m.veces || m.tokens)
    .map(m => ({ ...m, pct: pct(m.tokens, baseReales) }))
    .sort((a, b) => b.tokens - a.tokens || b.veces - a.veces);
  const nunca = [...rank.values()].filter(m => !m.veces && !m.tokens && m.id !== 'uso')
    .map(m => ({ id: m.id, descripcion: m.descripcion, grupo: m.grupo }));

  const sumaExt = (clave, campos) => {
    const hay = filas.map(f => f.externos[clave]).filter(Boolean);
    if (!hay.length) return null;
    return Object.fromEntries(campos.map(c => [c, Number(hay.reduce((n, h) => n + num(h[c]), 0).toFixed(4))]));
  };
  const nGlobal = global.totales.total;
  const salida = {
    alcance: 'todos',
    desde: fechaLocal(desde),
    totales: global.totales,
    principal: global.principal,
    subagentes: global.subagentes,
    rondas: global.rondas,
    por_modelo: global.por_modelo,
    carga_base: global.carga_base,
    carga_base_no_starter: { mediana: mediana(cargasNoStarter), sesiones: cargasNoStarter.length },
    proyectos: filas.map(f => ({
      nombre: f.r.proyecto,
      borrado: f.p.borrado,
      desarrollo_del_starter: f.p.desarrollo,
      total: f.r.totales.total,
      nuevos: f.r.totales.nuevos,
      pct: pct(f.r.totales.total, nGlobal),
      sesiones: f.r.sesiones.length,
      carga_base: f.r.carga_base.mediana,
      modulos_usados: f.r.modulos.length,
    })).sort((a, b) => b.total - a.total),
    modulos,
    nunca_usados: nunca,
    proyectos_reales: reales.length,
    proyectos_no_starter: raicesNoStarter.size,
    quemadores: global.quemadores,
    otras_skills: global.otras_skills,
    subagentes_por_tipo: global.subagentes_por_tipo,
    externos: {
      council: sumaExt('council', ['corridas', 'usd']),
      astra: sumaExt('astra', ['pedidos', 'imagenes', 'con_error']),
    },
    aviso_atribucion: AVISO_ATRIBUCION,
    aviso_limites: AVISO_LIMITES,
    lectura: { ...col.stats },
  };
  salida.sugerencias = sugerencias({ ...global, modulos, base_otros: salida.carga_base_no_starter.mediana });
  return salida;
}

/** Datos para la página del cockpit: acota listas largas. Sigue sin rutas ni contenido. */
export function paraWeb(r) {
  return { ...r, sesiones: (r.sesiones || []).slice(0, 12), otras_skills: (r.otras_skills || []).slice(0, 15), lectura: r.lectura };
}

// ---------------------------------------------------------------------------
// Texto para la terminal
// ---------------------------------------------------------------------------

export function fmt(n) {
  if (n === null || n === undefined) return 's/d';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} mil M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return String(n);
}

function lineaSplit(t) {
  return `  salida ${fmt(t.output)} · entrada nueva ${fmt(t.input)} · escrituras de caché ${fmt(t.cache_write)} · relecturas de caché ${fmt(t.cache_read)}`;
}

function lineasExternos(e) {
  return [
    `  Council: ${e.council ? `${e.council.corridas ?? 0} corridas, USD ${Number(e.council.usd).toFixed(3)}` : 'sin datos'}`,
    `  Astra: ${e.astra ? `${e.astra.pedidos} pedidos, ${e.astra.imagenes} imágenes` : 'sin datos'}`,
  ];
}

function lineasComunes(r) {
  const out = [];
  out.push('', 'Lo que más gastó:');
  if (!r.quemadores.length) out.push('  (nada todavía)');
  for (const q of r.quemadores) out.push(`  ${String(q.pct).padStart(3)}%  ${fmt(q.total).padStart(8)}  ${q.etiqueta}`);
  if (r.sugerencias.length) {
    out.push('', 'Sugerencias:');
    r.sugerencias.forEach((s, i) => out.push(`  ${i + 1}. ${s}`));
  }
  return out;
}

function lineasNunca(lista) {
  const out = ['', `Nunca usados (${lista.length}):`];
  for (const g of [['modulo', 'Módulos'], ['herramienta', 'Herramientas'], ['skill', 'Skills'], ['catalogo', 'Catálogo']]) {
    const ids = lista.filter(m => m.grupo === g[0]).map(m => m.id);
    if (ids.length) out.push(`  ${g[1]}: ${ids.join(', ')}`);
  }
  return out;
}

export function textoProyecto(r) {
  const t = r.totales;
  const out = [`Uso de ${r.proyecto}${r.desde ? ` desde ${r.desde}` : ''}`, ''];
  if (!t.total) {
    out.push('Sin datos: no hay transcripciones de este proyecto todavía.');
    return out.join('\n');
  }
  out.push(`Total: ${fmt(t.total)} tokens en ${r.sesiones.length} ${r.sesiones.length === 1 ? 'sesión' : 'sesiones'} (${fmt(t.nuevos)} sin contar relecturas de caché)`);
  out.push(lineaSplit(t));
  out.push(`  conversación principal ${fmt(r.principal.total)} (${pct(r.principal.total, t.total)}%) · subagentes ${fmt(r.subagentes.total)} (${pct(r.subagentes.total, t.total)}%) · rondas ${fmt(r.rondas.total)} (${pct(r.rondas.total, t.total)}%)`);
  out.push('', `Carga base al abrir sesión: ${fmt(r.carga_base.mediana)} tokens (mediana de ${r.carga_base.sesiones} ${r.carga_base.sesiones === 1 ? 'sesión' : 'sesiones'}; incluye a Claude Code, MCP y CLAUDE.md global, no solo al starter)`);
  if (r.carga_base.subagentes_mediana !== null) out.push(`  por subagente: ${fmt(r.carga_base.subagentes_mediana)}`);
  out.push('', 'Por modelo:');
  for (const m of r.por_modelo) out.push(`  ${String(pct(m.total, t.total)).padStart(3)}%  ${fmt(m.total).padStart(8)}  ${m.modelo}`);
  out.push('', 'Sesiones (las 10 mayores):');
  for (const s of r.sesiones.slice(0, 10)) {
    out.push(`  ${fmt(s.total).padStart(8)}  ${s.fecha} ${s.id}  ${s.etiqueta || `${s.n_subagentes} subagentes`}`);
  }
  if (r.sesiones.length > 10) out.push(`  y ${r.sesiones.length - 10} más`);
  out.push('', 'Módulos usados (tokens aproximados):');
  if (!r.modulos.length) out.push('  ninguno');
  for (const m of r.modulos) out.push(`  ${String(m.veces).padStart(4)} veces  ~${fmt(m.tokens).padStart(8)} (${m.pct}%)  ${m.id}`);
  out.push(...lineasNunca(r.nunca_usados));
  out.push('', 'Costos externos:', ...lineasExternos(r.externos));
  out.push(...lineasComunes(r));
  out.push('', `Nota: ${r.aviso_atribucion}`, `Nota: ${r.aviso_limites}`);
  if (r.lectura.lineas_malas) out.push(`Nota: ${r.lectura.lineas_malas} líneas dañadas se saltaron.`);
  return out.join('\n');
}

export function textoTodos(r) {
  const t = r.totales;
  const out = [`Uso de todos los proyectos del starter${r.desde ? ` desde ${r.desde}` : ''}`, ''];
  if (!r.proyectos.length) {
    out.push('Sin datos: no encontré transcripciones de proyectos del starter.');
    return out.join('\n');
  }
  out.push(`Total: ${fmt(t.total)} tokens en ${r.proyectos.length} proyectos (${fmt(t.nuevos)} sin contar relecturas de caché)`);
  out.push(lineaSplit(t));
  out.push('', `Carga base al abrir sesión: ${fmt(r.carga_base.mediana)} en proyectos del starter; ${fmt(r.carga_base_no_starter.mediana)} en otros proyectos (${r.carga_base_no_starter.sesiones} sesiones).`);
  out.push('', 'Proyectos:');
  for (const p of r.proyectos) {
    out.push(`  ${String(p.pct).padStart(3)}%  ${fmt(p.total).padStart(8)}  ${p.nombre}${p.borrado ? ' (carpeta borrada)' : ''}${p.desarrollo_del_starter ? ' (desarrollo del starter)' : ''}  base ${fmt(p.carga_base)}`);
  }
  out.push('', `Módulos en ${r.proyectos_reales} proyectos reales (sin contar el desarrollo del starter; tokens aproximados):`);
  if (!r.modulos.length) out.push('  ninguno');
  for (const m of r.modulos) out.push(`  ${String(m.veces).padStart(4)} veces en ${m.proyectos}  ~${fmt(m.tokens).padStart(8)} (${m.pct}%)  ${m.id}`);
  out.push(...lineasNunca(r.nunca_usados));
  out.push('', 'Costos externos:', ...lineasExternos(r.externos));
  out.push(...lineasComunes(r));
  out.push('', `Nota: ${r.aviso_atribucion}`, `Nota: ${r.aviso_limites}`);
  if (r.lectura.lineas_malas) out.push(`Nota: ${r.lectura.lineas_malas} líneas dañadas se saltaron.`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const AYUDA = `Uso:
  node src/uso.js                        este proyecto
  node src/uso.js todos                  todos los proyectos del starter en este PC
  node src/uso.js --proyecto <carpeta>   otro proyecto
Opciones: --json  --desde YYYY-MM-DD`;

async function cli(argv) {
  const flags = { json: false, todos: false, desde: undefined, proyecto: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'todos') flags.todos = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--desde') flags.desde = argv[++i];
    else if (a.startsWith('--desde=')) flags.desde = a.slice(8);
    else if (a === '--proyecto') flags.proyecto = argv[++i];
    else if (a === '--help' || a === '-h') { console.log(AYUDA); return 0; }
    else { console.error(`No entiendo "${a}".\n${AYUDA}`); return 1; }
  }
  let desde;
  try { desde = parseDesde(flags.desde); } catch (e) { console.error(e.message); return 1; }
  if (flags.desde === undefined && argv.includes('--desde')) { console.error(AYUDA); return 1; }
  if (flags.proyecto === undefined) { console.error(AYUDA); return 1; }
  const r = flags.todos
    ? await reporteTodos({ desde })
    : await reporteProyecto({ root: flags.proyecto || REPO_ROOT, desde });
  if (flags.json) console.log(JSON.stringify(r, null, 2));
  else console.log(flags.todos ? textoTodos(r) : textoProyecto(r));
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(e => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
}
