// .claude/skills/kickoff/plan.js
// Arma el PLAN DE BATALLA del kickoff como revisión del cockpit (kind "plan").
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export class PlanError extends Error {}

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

function teamItem(m) {
  const id = `equipo-${slug(m.id || m.rol)}`;
  const origen = m.nuevo
    ? '**Agente nuevo:** se crea durante el kickoff con `agent-template`. Hay que reiniciar Claude Code antes de poder invocarlo.'
    : `**Origen:** ${m.origen || 'agente o skill existente'}.`;
  const body = [
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
  return { id, title: `Equipo: ${m.rol}`, body_md: body.join('\n'), tags: ['equipo', m.nuevo ? 'agente-nuevo' : 'existente'] };
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
  return { item: { id: 'brazos', title: 'Brazos: qué hay conectado y qué falta', body_md: body.join('\n'), tags: ['brazos'] }, top, faltan };
}

export function councilsSection(decisiones, { templates = loadTemplates(), personas = loadPersonas() } = {}) {
  const lines = [];
  const found = [];
  for (const text of decisiones) {
    const sugs = suggestTemplates(text, { templates, limit: 1 });
    if (!sugs.length) { lines.push(`- **${text}** → sin council claro; se decide en el sprint con tu opinión.`); continue; }
    const s = sugs[0];
    found.push({ decision: text, template: s.template.id });
    lines.push(`- **${text}** → ${formatProposal(s, personas)}`);
  }
  const body = [
    'Decisiones que van a aparecer y el council que conviene para cada una. **Ninguno corre sin tu sí.**',
    '',
    ...lines,
  ];
  return { item: { id: 'councils', title: 'Councils sugeridos para decisiones que vienen', body_md: body.join('\n'), tags: ['councils'] }, found };
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
  return { id: 'proceso', title: 'Proceso: sprints, gates y dónde intervienes', body_md: body.join('\n'), tags: ['proceso'] };
}

function risksItem(riesgos) {
  const body = riesgos.map(r => (typeof r === 'string' ? `- ${r}` : `- **${r.riesgo}** → ${r.mitigacion}`));
  return { id: 'riesgos', title: 'Riesgos y cómo los cubrimos', body_md: body.join('\n'), tags: ['riesgos'] };
}

export function buildContextBrief(d, { faltan = [], equipo = [] } = {}) {
  return [
    `Plan de batalla del proyecto "${d.proyecto}", recién salido del kickoff. Aldot es novato (vibe coder): explica en simple, sin jerga.`,
    'Recórrelo en este orden: 1) los dos TLDR (qué pidió y cómo lo haría el orquestador), 2) el equipo, un integrante a la vez (rol, por qué, qué entrega), 3) los brazos y lo que falta conectar, 4) el proceso y dónde interviene él, 5) los councils sugeridos, 6) los riesgos.',
    `En cada ítem pregunta si lo aprueba, lo cambia o lo quita. El equipo tiene ${equipo.length} integrantes${equipo.some(m => m.nuevo) ? '; los marcados como agente nuevo exigen reiniciar Claude Code después del kickoff' : ''}.`,
    faltan.length ? `Faltan por conectar: ${faltan.map(s => s.id).join(', ')}. Pregunta cuáles quiere conectar ahora y cuáles después; ninguno se instala sin su sí.` : 'Todos los brazos sugeridos ya están conectados.',
    'No prometas costos ni plazos que no estén escritos en los ítems. Nada empieza hasta que guarde el feedback: el orquestador lo lee y ajusta el plan antes del Sprint 1.',
  ].join(' ');
}

/**
 * Construye la revisión del cockpit. `ctx` permite inyectar checks falsos en
 * tests; `entries`, `templates` y `personas` también son inyectables.
 */
export function buildPlanReview(draft, { ctx = null, entries = null, templates, personas, sinMcp = false } = {}) {
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
    connects_to: ['memory/project-profile.json', 'roadmap/current-sprint.json (Sprint 1)'],
    context_brief: buildContextBrief(draft, { faltan: brazos.faltan, equipo: draft.equipo }),
    items: [
      { id: 'tldr-usuario', title: 'Lo que pediste (TLDR)', body_md: draft.tldr_usuario, tags: ['tldr'] },
      { id: 'tldr-orquestador', title: 'Cómo lo haría el orquestador (TLDR)', body_md: draft.tldr_orquestador, tags: ['tldr'] },
      ...draft.equipo.map(teamItem),
      brazos.item,
      processItem(draft.proceso),
      councils.item,
      risksItem(draft.riesgos),
    ],
  };
  return { review: validateReview(review), brazos: brazos.top.map(s => ({ id: s.id, estado: s.estado })), councils: councils.found };
}

/** Las 5 líneas para el chat (el detalle vive en el cockpit). */
export function chatTldr(draft, result) {
  const faltan = result.brazos.filter(b => b.estado && b.estado !== ESTADOS.conectado).length;
  return [
    `Plan de batalla listo: ${draft.proyecto}.`,
    `Equipo: ${draft.equipo.map(m => m.rol).join(', ')}.`,
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
    const result = buildPlanReview(draft, { sinMcp: Boolean(flags['sin-mcp']) });
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
