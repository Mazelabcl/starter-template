// .claude/skills/kickoff/plan.js
// Arma el PLAN DE BATALLA del kickoff como revisión del cockpit (kind "plan"), en
// imágenes: una lámina de TLDR, equipo (org), proceso (flow), roadmap (timeline),
// brazos, councils y riesgos (connects). El detalle queda detrás de "Ver más".
//
// El orquestador escribe un borrador corto (lo que requiere criterio: TLDRs,
// equipo, proceso, decisiones, riesgos) y este script completa lo mecánico:
//   - brazos: `suggest` + `status` de src/brazos.js (qué falta y cómo conectarlo)
//   - councils: `suggestTemplates` de src/council.js por cada decisión
//   - context_brief para que la guía de voz recorra el plan
//
// Uso:
//   node .claude/skills/kickoff/plan.js build <borrador.json> [--out memory/plan-de-batalla.json] [--sin-mcp]
//   node src/cockpit.js publish memory/plan-de-batalla.json
//
// Formato del borrador: ver EXAMPLES.md (sección "Borrador del plan") o
// ejemplo-plan-borrador.json en esta carpeta. Idioma: español neutro.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDirectorio, suggest, statusAll, realContext, ESTADOS } from '../../../src/brazos.js';
import { suggestTemplates, formatProposal, loadPersonas, loadTemplates } from '../../../src/council.js';
import { validateReview } from '../../../src/cockpit.js';
import { loadRoles, humanizeId } from '../../../src/roles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export class PlanError extends Error {}

/**
 * Equipo del plan completado con las fichas de roles/. Un integrante con `ficha: <id>`
 * (o con un `id` que ya tiene ficha) solo trae lo que quiera cambiar. Sin equipo en el
 * borrador (plan de un proyecto ya en marcha), el equipo son todas las fichas.
 */
export function resolveEquipo(equipo, { root = REPO_ROOT } = {}) {
  const { roles } = loadRoles({ root });
  const list = Array.isArray(equipo) && equipo.length ? equipo : [...roles.keys()].map(ficha => ({ ficha }));
  return list.map(m => {
    if (!m || typeof m !== 'object') return m;
    if (m.ficha && !roles.has(m.ficha)) throw new PlanError(`El integrante pide la ficha "${m.ficha}", que no existe en roles/ (revisa: node src/roles.js list).`);
    const card = roles.get(m.ficha || m.id);
    if (!card) return m;
    return {
      ...m,
      id: card.id,
      rol: m.rol || humanizeId(card.id),
      actua_como: m.actua_como || card.actua_como,
      por_que: m.por_que || card.objetivo,
      entrega: m.entrega?.length ? m.entrega : [card.objetivo],
      herramientas_restringidas: m.herramientas_restringidas ?? card.herramientas_restringidas,
      origen: m.origen || `ficha roles/${card.id}.md`,
      nuevo: false,
    };
  });
}

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

export function validateDraft(d) {
  const errors = [];
  const str = (v, k) => { if (typeof v !== 'string' || !v.trim()) errors.push(`${k}: texto no vacío`); };
  if (!d || typeof d !== 'object') throw new PlanError('El borrador debe ser un objeto JSON.');
  str(d.proyecto, 'proyecto');
  str(d.descripcion, 'descripcion');
  str(d.tldr_usuario, 'tldr_usuario');
  str(d.tldr_orquestador, 'tldr_orquestador');
  if (!Array.isArray(d.equipo) || !d.equipo.length) errors.push('equipo: al menos 1 integrante');
  else d.equipo.forEach((m, i) => {
    for (const k of ['rol', 'actua_como', 'por_que']) str(m?.[k], `equipo[${i}].${k}`);
    if (!Array.isArray(m?.entrega) || !m.entrega.length) errors.push(`equipo[${i}].entrega: lista con al menos 1 entregable`);
  });
  if (!Array.isArray(d.proceso?.sprints) || !d.proceso.sprints.length) errors.push('proceso.sprints: al menos 1 sprint');
  if (!Array.isArray(d.proceso?.intervenciones) || !d.proceso.intervenciones.length) errors.push('proceso.intervenciones: dónde interviene el usuario');
  if (d.decisiones !== undefined && !Array.isArray(d.decisiones)) errors.push('decisiones: lista de textos');
  if (!Array.isArray(d.riesgos) || !d.riesgos.length) errors.push('riesgos: al menos 1');
  if (errors.length) throw new PlanError(`Borrador inválido:\n- ${errors.join('\n- ')}`);
}

// Corta a pocas palabras: en la lámina el detalle no se lee, queda detrás de "Ver más".
const brief = (s, n = 5) => {
  const words = String(s).replace(/\*\*/g, '').replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
};

function teamOrigin(m) {
  if (m.herramientas_restringidas) return '**Agente fijo:** este rol necesita herramientas restringidas, así que además de su ficha lleva un archivo en `.claude/agents/`, creado con `agent-template`. Hay que reiniciar Claude Code antes de poder invocarlo (`/exit` y luego `claude -c`).';
  if (m.nuevo) return '**Ficha nueva:** se crea en `roles/` al aprobar el plan y funciona al instante, sin reiniciar Claude Code.';
  return `**Origen:** ${m.origen || 'agente o skill existente'}.`;
}

function teamBody(m) {
  const origen = teamOrigin(m);
  const body = [
    `### ${m.rol}`,
    `**Actúa como:** ${m.actua_como}`,
    '',
    `**Por qué este rol:** ${m.por_que}`,
    '',
    '**Entrega:**',
    ...m.entrega.map(e => `- ${e}`),
    '',
    origen,
  ];
  if (m.brazos?.length) body.push('', `**Brazos que usa:** ${m.brazos.map(b => `\`${b}\``).join(', ')}`);
  return body.join('\n');
}

function teamItem(equipo) {
  return {
    id: 'equipo',
    title: 'Equipo: quién hace qué',
    headline: `Tu equipo: ${equipo.length} ${equipo.length === 1 ? 'rol' : 'roles'}`,
    ask: '¿Te sirve este equipo?',
    body_md: equipo.map(teamBody).join('\n\n'),
    tags: ['equipo', ...(equipo.some(m => m.nuevo && !m.herramientas_restringidas) ? ['ficha-nueva'] : []), ...(equipo.some(m => m.herramientas_restringidas) ? ['agente-fijo'] : [])],
    visual: {
      type: 'diagram',
      kind: 'org',
      lead: { label: 'Orquestador', note: 'Tú apruebas', icon: 'user' },
      members: equipo.map(m => ({
        label: m.corto || brief(m.rol),
        icon: m.icono || 'user',
        ...(m.nota ? { note: m.nota } : {}),
        ...(m.herramientas_restringidas ? { badge: 'Agente fijo' } : m.nuevo ? { badge: 'Nuevo' } : {}),
      })),
    },
  };
}

export function brazosSection(descripcion, entries, statusRows, { extra = [], limit = 8 } = {}) {
  const statusById = Object.fromEntries(statusRows.map(r => [r.id, r.estado]));
  const top = suggest(descripcion, entries, { limit, statusById });
  for (const id of extra) {
    if (top.some(s => s.id === id)) continue;
    const e = entries.find(x => x.id === id);
    if (e) top.push({ id, nombre: e.nombre, categoria: e.categoria, razon: `${e.para_que} Lo asignó el orquestador.`, estado: statusById[id] || null, entry: e });
    else throw new PlanError(`El brazo "${id}" no existe en brazos/directorio.json (revisa: node src/brazos.js list).`);
  }
  const rows = top.map(s => `| \`${s.id}\` | ${s.entry.para_que} | ${s.estado || 'sin revisar'} |`);
  const faltan = top.filter(s => s.estado && s.estado !== ESTADOS.conectado);
  const body = [
    'Integraciones que el equipo necesita para **ejecutar**, no solo planear.',
    '',
    '| Brazo | Para qué | Estado |',
    '|---|---|---|',
    ...rows,
  ];
  if (faltan.length) {
    body.push('', '**Lo que falta conectar** (cada comando solo imprime los pasos, no instala nada):');
    for (const s of faltan) body.push(`- \`${s.id}\` (${s.estado}): \`node src/brazos.js connect ${s.id}\`${s.entry.oficial ? '' : ' — no oficial, revisa permisos'}`);
  } else {
    body.push('', 'Todo lo sugerido ya está conectado.');
  }
  body.push('', 'Dime cuáles quieres quitar o agregar. Ninguno se instala sin tu sí.');
  const listos = top.filter(s => s.estado === ESTADOS.conectado);
  const nameOf = s => brief(s.entry.nombre || s.id, 4);
  const shownMissing = faltan.slice(0, 6);
  const shownReady = listos.slice(0, 7 - shownMissing.length);
  const hidden = faltan.length + listos.length - shownMissing.length - shownReady.length;
  const links = [
    ...shownMissing.map(s => ({ label: nameOf(s), state: 'missing' })),
    ...shownReady.map(s => ({ label: nameOf(s), state: 'ok' })),
    ...(hidden > 0 ? [{ label: `${hidden} más en Ver más`, icon: 'more' }] : []),
  ];
  const visual = links.length ? { type: 'diagram', kind: 'connects', center: 'Tu proyecto', center_icon: 'bolt', links } : undefined;
  return {
    item: {
      id: 'brazos',
      title: 'Brazos: qué hay conectado y qué falta',
      headline: faltan.length ? `Faltan ${faltan.length} conexiones` : 'Todo conectado',
      ask: faltan.length ? '¿Conectamos estas?' : '¿Lo apruebas?',
      body_md: body.join('\n'),
      tags: ['brazos'],
      ...(visual ? { visual } : {}),
      stats: [{ value: faltan.length, label: 'por conectar' }, { value: listos.length, label: 'listas' }],
    },
    top,
    faltan,
  };
}

export function councilsSection(decisiones, { templates = loadTemplates(), personas = loadPersonas() } = {}) {
  const lines = [];
  const found = [];
  const links = [];
  for (const d of decisiones) {
    const text = typeof d === 'string' ? d : d.texto;
    const label = typeof d === 'string' ? brief(d) : d.corto || brief(d.texto);
    const sugs = suggestTemplates(text, { templates, limit: 1 });
    if (!sugs.length) {
      lines.push(`- **${text}** → sin council claro; se decide en el sprint con tu opinión.`);
      links.push({ label, icon: 'user' });
      continue;
    }
    const s = sugs[0];
    found.push({ decision: text, template: s.template.id });
    lines.push(`- **${text}** → ${formatProposal(s, personas)}`);
    links.push({ label, icon: 'users', note: s.template.id });
  }
  const body = [
    'Decisiones que van a aparecer y el council que conviene para cada una. **Ninguno corre sin tu sí.**',
    '',
    ...lines,
  ];
  return {
    item: {
      id: 'councils',
      title: 'Councils sugeridos para decisiones que vienen',
      headline: links.length ? `${links.length} decisiones con expertos` : 'Sin decisiones grandes por ahora',
      ask: '¿Son estas?',
      body_md: body.join('\n'),
      tags: ['councils'],
      ...(links.length ? { visual: { type: 'diagram', kind: 'connects', center: 'Council de expertos', center_icon: 'users', links } } : {}),
    },
    found,
  };
}

function processItem(proceso) {
  const body = [];
  for (const s of proceso.sprints) {
    body.push(`**Sprint ${s.numero} — ${s.objetivo}**`);
    for (const e of s.entregables || []) body.push(`- ${e}`);
    if (s.gate) body.push(`- *Gate:* ${s.gate}`);
    body.push('');
  }
  body.push('**Dónde intervienes tú:**', ...proceso.intervenciones.map(x => `- ${x}`));
  const steps = proceso.sprints.flatMap(s => [
    { label: `Sprint ${s.numero}`, note: s.corto || brief(s.objetivo, 4), icon: 'rocket' },
    ...(s.gate ? [{ label: 'Tú apruebas', note: s.gate_corto || undefined, icon: 'up', tone: 'you' }] : []),
  ]);
  const gates = proceso.sprints.filter(s => s.gate).length;
  return {
    id: 'proceso',
    title: 'Proceso: sprints, gates y dónde intervienes',
    headline: gates ? `Construimos, y tú apruebas ${gates} ${gates === 1 ? 'vez' : 'veces'}` : 'Cómo trabajamos',
    ask: '¿Así está bien?',
    body_md: body.join('\n'),
    tags: ['proceso'],
    ...(steps.length >= 2 ? { visual: { type: 'diagram', kind: 'flow', steps } } : {}),
  };
}

function roadmapItem(proceso) {
  const items = [
    { label: 'Kickoff', state: 'past' },
    ...proceso.sprints.map((s, i) => ({ label: s.corto || brief(s.objetivo), note: `Sprint ${s.numero}`, state: i === 0 ? 'current' : 'next' })),
  ];
  return {
    id: 'roadmap',
    title: 'Roadmap: del kickoff al lanzamiento',
    headline: `El camino: ${proceso.sprints.length} ${proceso.sprints.length === 1 ? 'sprint' : 'sprints'}`,
    ask: '¿Es el orden correcto?',
    body_md: proceso.sprints.map(s => `- **Sprint ${s.numero}:** ${s.objetivo}`).join('\n'),
    tags: ['roadmap'],
    visual: { type: 'diagram', kind: 'timeline', items },
  };
}

function risksItem(riesgos) {
  const body = riesgos.map(r => (typeof r === 'string' ? `- ${r}` : `- **${r.riesgo}** → ${r.mitigacion}`));
  return {
    id: 'riesgos',
    title: 'Riesgos y cómo los cubrimos',
    headline: `${riesgos.length} ${riesgos.length === 1 ? 'riesgo cubierto' : 'riesgos cubiertos'}`,
    ask: '¿Falta alguno?',
    body_md: body.join('\n'),
    tags: ['riesgos'],
    visual: {
      type: 'diagram',
      kind: 'connects',
      center: 'Riesgos cubiertos',
      center_icon: 'shield',
      links: riesgos.slice(0, 8).map(r => ({ label: typeof r === 'string' ? brief(r) : r.corto || brief(r.riesgo), icon: 'shield' })),
    },
  };
}

function tldrItem(d, { faltan }) {
  const steps = (d.tldr_pasos?.length ? d.tldr_pasos : d.proceso.sprints.map(s => s.corto || brief(s.objetivo, 4)))
    .slice(0, 6).map(x => (typeof x === 'string' ? { label: x } : x));
  return {
    id: 'tldr',
    title: `Lo que pediste y cómo lo haría: ${d.proyecto}`,
    headline: d.titular || brief(d.proyecto, 10),
    ask: '¿Es esto lo que quieres?',
    body_md: `### Lo que pediste\n${d.tldr_usuario}\n\n### Cómo lo haría el orquestador\n${d.tldr_orquestador}`,
    tags: ['tldr'],
    ...(steps.length >= 2 ? { visual: { type: 'diagram', kind: 'flow', steps } } : {}),
    stats: [
      { value: d.proceso.sprints.length, label: d.proceso.sprints.length === 1 ? 'sprint' : 'sprints' },
      { value: d.equipo.length, label: d.equipo.length === 1 ? 'rol en el equipo' : 'roles en el equipo' },
      { value: faltan.length, label: 'conexiones por hacer' },
    ],
  };
}

export function buildContextBrief(d, { faltan = [], equipo = [] } = {}) {
  return [
    `Plan de batalla del proyecto "${d.proyecto}", recién salido del kickoff. Aldot es novato (vibe coder): explica en simple, sin jerga.`,
    'Él ve cada ítem como una lámina con un diagrama: nombra lo que está viendo. Recórrelo en este orden: 1) el TLDR (qué pidió y cómo lo haría el orquestador), 2) el equipo, un integrante a la vez (rol, por qué, qué entrega), 3) los brazos y lo que falta conectar, 4) el proceso y dónde interviene él, 5) el roadmap, 6) los councils sugeridos, 7) los riesgos.',
    `En cada ítem pregunta si lo aprueba, lo cambia o lo quita. El equipo tiene ${equipo.length} integrantes${equipo.some(m => m.herramientas_restringidas) ? '; los marcados como agente fijo exigen reiniciar Claude Code, los demás funcionan al instante' : ''}.`,
    faltan.length ? `Faltan por conectar: ${faltan.map(s => s.id).join(', ')}. Pregunta cuáles quiere conectar ahora y cuáles después; ninguno se instala sin su sí.` : 'Todos los brazos sugeridos ya están conectados.',
    'No prometas costos ni plazos que no estén escritos en los ítems. Nada empieza hasta que guarde el feedback: el orquestador lo lee y ajusta el plan antes del Sprint 1.',
  ].join(' ');
}

/**
 * Construye la revisión del cockpit. `ctx` permite inyectar checks falsos en
 * tests; `entries`, `templates` y `personas` también son inyectables. `root` es donde
 * se buscan las fichas de roles/.
 */
export function buildPlanReview(input, { ctx = null, entries = null, templates, personas, sinMcp = false, root = REPO_ROOT } = {}) {
  if (!input || typeof input !== 'object') throw new PlanError('El borrador debe ser un objeto JSON.');
  const draft = { ...input, equipo: resolveEquipo(input.equipo, { root }) };
  validateDraft(draft);
  const all = entries || loadDirectorio();
  const c = ctx || realContext({ sinMcp });
  const statusRows = statusAll(all, c);
  // Brazos = los que el orquestador asignó a cada integrante + brazos_extra +
  // las sugerencias por keywords (sin duplicar).
  const extra = [...new Set([...draft.equipo.flatMap(m => m.brazos || []), ...(draft.brazos_extra || [])])];
  const brazos = brazosSection(draft.descripcion, all, statusRows, { extra, limit: 6 });
  const councils = councilsSection(draft.decisiones || [], {
    templates: templates || loadTemplates(),
    personas: personas || loadPersonas(),
  });
  const version = draft.version || 1;
  const review = {
    id: draft.id || `plan-de-batalla-v${version}`,
    title: `Plan de batalla: ${draft.proyecto}${version > 1 ? ` (v${version})` : ''}`,
    kind: 'plan',
    created_at: new Date().toISOString(),
    sprint: 0,
    connects_to: ['memory/project-profile.json', 'roadmap/current-sprint.json (Sprint 1)'],
    context_brief: buildContextBrief(draft, { faltan: brazos.faltan, equipo: draft.equipo }),
    items: [
      tldrItem(draft, brazos),
      teamItem(draft.equipo),
      processItem(draft.proceso),
      roadmapItem(draft.proceso),
      brazos.item,
      councils.item,
      risksItem(draft.riesgos),
    ],
  };
  return { review: validateReview(review), equipo: draft.equipo, brazos: brazos.top.map(s => ({ id: s.id, estado: s.estado })), councils: councils.found };
}

/** Las 5 líneas para el chat (el detalle vive en el cockpit). */
export function chatTldr(draft, result) {
  const faltan = result.brazos.filter(b => b.estado && b.estado !== ESTADOS.conectado).length;
  return [
    `Plan de batalla listo: ${draft.proyecto}.`,
    `Equipo: ${(result.equipo || draft.equipo).map(m => m.rol).join(', ')}.`,
    `Brazos: ${result.brazos.length} sugeridos, ${faltan} por conectar.`,
    `Sprint 1: ${draft.proceso.sprints[0].objetivo}.`,
    'Te abrí el cockpit en el navegador: vota, comenta o conversa por voz y guarda el feedback.',
  ].join('\n');
}

function cliMain(argv) {
  const [cmd, file, ...rest] = argv;
  const flags = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }));
  if (cmd !== 'build' || !file) {
    console.log('Uso: node .claude/skills/kickoff/plan.js build <borrador.json> [--out=memory/plan-de-batalla.json] [--sin-mcp]');
    return cmd ? 1 : 0;
  }
  try {
    const draft = JSON.parse(readFileSync(resolve(file), 'utf8'));
    const result = buildPlanReview(draft, {
      sinMcp: Boolean(flags['sin-mcp']),
      ...(typeof flags.root === 'string' ? { root: resolve(flags.root) } : {}),
    });
    const out = resolve(typeof flags.out === 'string' ? flags.out : join(REPO_ROOT, 'memory', 'plan-de-batalla.json'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result.review, null, 2) + '\n', 'utf8');
    console.log(`Plan escrito en ${out} (${result.review.items.length} ítems).`);
    console.log(`Publícalo con: node src/cockpit.js publish ${out}`);
    console.log('\n--- TLDR para el chat ---');
    console.log(chatTldr(draft, result));
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(cliMain(process.argv.slice(2)));
