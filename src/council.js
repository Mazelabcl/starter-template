// src/council.js
// Council de expertos: varias personas (CTO, devops, PM, usuario novato...)
// opinan por separado sobre una tarea y un integrador FUSIONA lo mejor de cada
// una en una propuesta mejorada, con cada aporte atribuido a quien lo vio.
//
// Flujo:
//   Fase 1  personas en paralelo, independientes (no se ven entre sí).
//           Cada una devuelve JSON {persona, threats, opportunities, ideas,
//           key_concern, would_change_mind_if}.
//   Fase 2  integrador (de otra familia de modelo que la mayoría) recibe las
//           respuestas ANONIMIZADAS (Voz A, B, C...) y devuelve una propuesta
//           integrada + aportes + tensiones + recomendación (nunca null).
//           Después se re-atribuye cada aporte a su persona.
//   Fase 3  opcional (--redteam): el contrarian ataca la propuesta; si hay
//           ataques de severidad alta o media, el integrador la parcha. Si solo
//           hay ataques menores, se corta ahí (parada temprana).
//
// Modos:
//   personas    (default) modelos baratos de varias familias. ~USD 0.02-0.05.
//   multimodel  modelos fuertes repartidos en >=3 familias. Para arquitectura
//               crítica. Requiere confirmación de costo.
//
// Nunca escribe en memory/. Guarda el resultado en councils/results/<id>.json
// y una revisión para el cockpit en cockpit/reviews/<id>.json.
//
// CLI (ver cliUsage() abajo):
//   node src/council.js suggest "texto de la tarea"
//   node src/council.js list
//   node src/council.js run --question "..." [--template id] [--personas a,b]
//                           [--crear "Rol: foco"]... [--guardar]
//                           [--mode multimodel] [--files a.md,b.md] [--redteam]
//                           [--context "..."] [--yes] [--dry-run]
//   Motor agentes (sin llamar modelos; los corren subagentes de Claude Code):
//   node src/council.js prepare --question "..." [--formato entrevista --audiencia "Rol: perfil"...]
//   node src/council.js siguiente <id>   |   node src/council.js registrar <id>

import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import Ajv from 'ajv';

import { chat as openrouterChat, OpenRouterError } from './openrouter_client.js';
import { publishReview } from './cockpit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const COUNCILS_DIR = join(REPO_ROOT, 'councils');
export const PERSONAS_DIR = join(COUNCILS_DIR, 'personas');
export const TEMPLATES_DIR = join(COUNCILS_DIR, 'templates');
const SCHEMAS_DIR = join(COUNCILS_DIR, 'schemas');

// =============================================================================
// Modelos (ids y precios verificados en openrouter.ai/api/v1/models, 2026-10-30)
// USD por 1M tokens. Si OpenRouter devuelve usage.cost, se usa ese valor real.
// =============================================================================

export const MODEL_CATALOG = {
  'anthropic/claude-haiku-5.5': { family: 'anthropic', in: 0.10, out: 0.50 },
  'anthropic/claude-sonnet-5.5': { family: 'anthropic', in: 2.00, out: 10.00 },
  'anthropic/claude-opus-5.5': { family: 'anthropic', in: 4.00, out: 20.00 },
  'openai/gpt-6-luna': { family: 'openai', in: 0.10, out: 0.50 },
  'openai/gpt-6.1-terra': { family: 'openai', in: 1.00, out: 5.00 },
  'openai/gpt-6.1-sol': { family: 'openai', in: 2.00, out: 10.00 },
  'google/gemini-3.5-flash-lite': { family: 'google', in: 0.30, out: 2.50 },
  'google/gemini-3.8-flash': { family: 'google', in: 0.83, out: 4.13 },
  'google/gemini-4-argon': { family: 'google', in: 2.00, out: 10.00 },
  'deepseek/deepseek-v4.1-flash': { family: 'deepseek', in: 0.04, out: 0.50 },
  'x-ai/grok-4.7': { family: 'x-ai', in: 2.00, out: 6.00 },
};

// Por modo: un modelo por familia (orden = preferencia en empates).
const MODE_POOLS = {
  personas: {
    anthropic: 'anthropic/claude-haiku-5.5',
    openai: 'openai/gpt-6-luna',
    google: 'google/gemini-3.5-flash-lite',
    deepseek: 'deepseek/deepseek-v4.1-flash',
  },
  multimodel: {
    anthropic: 'anthropic/claude-sonnet-5.5',
    openai: 'openai/gpt-6.1-sol',
    google: 'google/gemini-4-argon',
    'x-ai': 'x-ai/grok-4.7',
  },
};

// Candidatos a integrador: se elige el de la familia MENOS usada por las personas.
const SYNTH_CANDIDATES = {
  personas: ['openai/gpt-6.1-terra', 'anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash'],
  multimodel: ['anthropic/claude-opus-5.5', 'openai/gpt-6.1-sol', 'google/gemini-4-argon'],
};

const LIMITS = {
  personas: { persona_max_tokens: 1800, merge_max_tokens: 5000, timeout_ms: 180_000 },
  multimodel: { persona_max_tokens: 5000, merge_max_tokens: 8000, timeout_ms: 360_000 },
};

const CONTEXT_CAPS = { principles: 4000, decisions: 3000, per_file: 5000, total: 14000 };
const COST_CONFIRM_THRESHOLD_USD = 0.5;

// =============================================================================
// Errores
// =============================================================================

export class CouncilError extends Error {
  constructor(message, { code = 'unknown', details = null } = {}) {
    super(message);
    this.name = 'CouncilError';
    this.code = code;
    this.details = details;
  }
}

// =============================================================================
// Schemas (AJV)
// =============================================================================

let _ajv = null;
function ajv() {
  if (_ajv) return _ajv;
  const a = new Ajv({ allErrors: true, strict: false });
  for (const f of ['persona', 'template', 'persona-answer', 'merge']) {
    a.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, `${f}.schema.json`), 'utf8')), f);
  }
  _ajv = a;
  return a;
}

function runSchema(name, obj) {
  const v = ajv().getSchema(name);
  const ok = v(obj);
  return { ok, errors: ok ? [] : v.errors.map(e => `${e.instancePath || '(raíz)'} ${e.message}`) };
}

export const validatePersona = p => runSchema('persona', p);
export const validateTemplate = t => runSchema('template', t);
export const validatePersonaAnswer = a => runSchema('persona-answer', a);

// Valida la salida del integrador. Además del schema, exige recomendación real.
export function validateMerge(m) {
  const r = runSchema('merge', m);
  const errors = [...r.errors];
  if (!m || typeof m.recommendation !== 'string' || !m.recommendation.trim()) {
    errors.push('recommendation no puede ser null ni vacía');
  } else if (/^(null|n\/a|ninguna|requiere decisi[oó]n humana)\.?$/i.test(m.recommendation.trim())) {
    errors.push('recommendation debe ser una recomendación concreta, no una evasiva');
  }
  return { ok: errors.length === 0, errors };
}

// =============================================================================
// Carga de personas y plantillas
// =============================================================================

function readJsonDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({ file: f, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

export function loadPersonas({ dir = PERSONAS_DIR } = {}) {
  const map = new Map();
  for (const { file, data } of readJsonDir(dir)) {
    const v = validatePersona(data);
    if (!v.ok) throw new CouncilError(`Persona inválida (${file}): ${v.errors.join('; ')}`, { code: 'invalid_persona' });
    map.set(data.id, data);
  }
  return map;
}

export function loadTemplates({ dir = TEMPLATES_DIR, personas = loadPersonas() } = {}) {
  const out = [];
  for (const { file, data } of readJsonDir(dir)) {
    const v = validateTemplate(data);
    if (!v.ok) throw new CouncilError(`Plantilla inválida (${file}): ${v.errors.join('; ')}`, { code: 'invalid_template' });
    const missing = data.personas.filter(id => !personas.has(id));
    if (missing.length) {
      throw new CouncilError(`Plantilla ${data.id} usa personas que no existen: ${missing.join(', ')}`, { code: 'invalid_template' });
    }
    out.push(data);
  }
  return out;
}

// =============================================================================
// Personas a mano: alias y personas creadas al vuelo (--crear)
// =============================================================================

// Nombres cómodos para ids reales. Un id real con ese nombre siempre gana.
export const PERSONA_ALIASES = { 'steve-jobs': 'visionario' };

function slugify(text) {
  const slug = String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 48 ? slug.slice(0, 48).replace(/-[^-]*$/, '') : slug;
}

// "Experta en aforo: mira seguridad" -> { role: 'Experta en aforo', focus: 'mira seguridad' }
export function parseCrear(spec) {
  const text = typeof spec === 'string' ? spec.trim() : '';
  const i = text.indexOf(':');
  const role = i > 0 ? text.slice(0, i).trim() : '';
  const focus = i > 0 ? text.slice(i + 1).trim() : '';
  if (role.length < 2 || focus.length < 3 || !slugify(role)) {
    throw new CouncilError(
      `--crear necesita el formato "Rol: foco", por ejemplo --crear "Experta en aforo de eventos: mira seguridad y permisos". Recibí: ${text || '(vacío)'}`,
      { code: 'invalid_crear' },
    );
  }
  return { role, focus };
}

// Misma estructura que councils/personas/*.json. Sin model_preference: entra a la
// rotación de modelos del modo (assignModels) y no gasta más que las demás.
export function buildAdhocPersona({ role, focus }, id = slugify(role)) {
  const topic = focus.replace(/^(mira|revisa|cuida|analiza|eval[uú]a|enf[oó]cate en)\s+/i, '') || focus;
  const lowerRole = /^\p{Lu}\p{Lu}/u.test(role) ? role : role.charAt(0).toLowerCase() + role.slice(1);
  return {
    id,
    name: role,
    category: 'comodin',
    actua_como: `Actúas como ${lowerRole}, con años de experiencia práctica en ese campo. Te convocaron a este council por una razón concreta: ${focus}. Miras cada propuesta desde ahí, señalas lo que los demás pasan por alto y aterrizas tu opinión en pasos concretos, sin salirte de tu especialidad.`,
    obsessions: [topic, 'lo que falta definir en tu especialidad antes de decidir'],
    ignores: ['temas fuera de tu especialidad', 'preferencias de estilo que no cambian el resultado'],
    blind_spots: ['puede sobredimensionar su especialidad frente al resto del proyecto', 'tiende a ver riesgos de su campo donde otros ven detalles menores'],
    typical_questions: [`¿Qué puede salir mal con ${topic}?`, `¿Qué falta definir sobre ${topic} antes de decidir?`, '¿Cuál es el paso más pequeño que reduce ese riesgo?'],
  };
}

// Agrega al mapa las personas de --crear. No toca el disco.
// Si el id ya existe con otro contenido usa un sufijo (-2, -3); si es idéntica
// (ya guardada o repetida en la misma corrida) reutiliza la que hay.
export function withAdhocPersonas(crear = [], personasMap = loadPersonas()) {
  const map = new Map(personasMap);
  const adhoc = [];
  const ids = [];
  for (const spec of crear) {
    const parsed = parseCrear(spec);
    const base = slugify(parsed.role);
    let id = base;
    for (let n = 2; map.has(id) && JSON.stringify(map.get(id)) !== JSON.stringify(buildAdhocPersona(parsed, id)); n += 1) {
      id = `${base}-${n}`;
    }
    if (!map.has(id)) {
      const persona = buildAdhocPersona(parsed, id);
      const v = validatePersona(persona);
      if (!v.ok) throw new CouncilError(`Persona creada inválida (${id}): ${v.errors.join('; ')}`, { code: 'invalid_crear' });
      map.set(id, persona);
      adhoc.push(persona);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { personasMap: map, adhoc, ids };
}

// Persiste una persona creada para reutilizarla (--guardar). Nunca sobrescribe.
export function savePersona(persona, { dir = PERSONAS_DIR } = {}) {
  const v = validatePersona(persona);
  if (!v.ok) throw new CouncilError(`Persona inválida (${persona?.id}): ${v.errors.join('; ')}`, { code: 'invalid_persona' });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${persona.id}.json`);
  try {
    writeFileSync(path, `${JSON.stringify(persona, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') throw new CouncilError(`Ya existe ${path}; no la sobrescribo.`, { code: 'persona_exists' });
    throw e;
  }
  return path;
}

// =============================================================================
// Sugerencia de council (keywords + fallback LLM opcional)
// =============================================================================

export function normalizeText(s) {
  return ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').trim()} `;
}

export function suggestTemplates(text, { templates = loadTemplates(), limit = 2 } = {}) {
  const norm = normalizeText(text);
  const scored = templates.map(t => {
    const matched = [];
    let score = 0;
    for (const kw of t.keywords) {
      const k = normalizeText(kw).trim();
      if (!k) continue;
      const re = new RegExp(`\\s${k.replace(/ /g, '\\s')}(s|es)?\\s`);
      if (re.test(norm)) {
        matched.push(kw);
        score += k.includes(' ') ? 2 : 1;
      }
    }
    return { template: t, score, matched };
  }).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, limit).filter((s, i) => i === 0 || s.score >= scored[0].score * 0.5);
  return top.map(s => ({
    ...s,
    justification: `${s.template.description} (señales: ${s.matched.slice(0, 4).join(', ')})`,
  }));
}

export async function suggestWithLlm(text, { templates = loadTemplates(), chatFn = openrouterChat } = {}) {
  const list = templates.map(t => `- ${t.id}: ${t.description}`).join('\n');
  const r = await chatFn({
    model: 'anthropic/claude-haiku-5.5',
    system: 'You route a task to the most useful expert-council template. Reply with ONE JSON object only.',
    messages: [{
      role: 'user',
      content: `Templates:\n${list}\n\nTask (Spanish): ${text}\n\nReturn {"template_id": "<one id from the list, or none>", "why": "<one short sentence in neutral Spanish>"}`,
    }],
    max_tokens: 200,
    temperature: 0,
    timeout_ms: 60_000,
  });
  const parsed = parseJsonLoose(r.content);
  const t = templates.find(x => x.id === parsed?.template_id);
  return t ? [{ template: t, score: 0, matched: [], justification: parsed.why || t.description, via: 'llm' }] : [];
}

// Frase literal para proponer el council al usuario.
export function formatProposal(suggestion, personas = loadPersonas()) {
  const t = suggestion.template;
  const names = t.personas.map(id => personas.get(id)?.name || id).join(' + ');
  const assignments = assignModels(t.personas.map(id => personas.get(id)), t.mode);
  const est = estimateCouncilCost({ assignments, mode: t.mode, redteam: t.redteam });
  return `Para esto te sirve un council de ${names} (plantilla "${t.id}", ~USD ${est.usd.toFixed(2)}, ~${est.seconds[0]}-${est.seconds[1]} s). ¿Lo armo?`;
}

// =============================================================================
// Asignación de modelos
// =============================================================================

export function familyOf(model) {
  return MODEL_CATALOG[model]?.family || String(model).split('/')[0];
}

export function assignModels(personas, mode = 'personas') {
  const pool = MODE_POOLS[mode];
  if (!pool) throw new CouncilError(`Modo inválido: ${mode}. Usa "personas" o "multimodel".`, { code: 'invalid_mode' });
  const families = Object.keys(pool);
  const cap = Math.ceil(personas.length / families.length);
  const counts = Object.fromEntries(families.map(f => [f, 0]));
  const out = new Array(personas.length);

  // 1. Preferencias, sin pasar el tope por familia (así se mantiene la mezcla).
  personas.forEach((p, i) => {
    const pref = p.model_preference;
    if (pref && pool[pref] && counts[pref] < cap) {
      out[i] = { persona: p, model: pool[pref], family: pref };
      counts[pref] += 1;
    }
  });
  // 2. El resto va a la familia menos usada.
  personas.forEach((p, i) => {
    if (out[i]) return;
    const fam = families.reduce((best, f) => (counts[f] < counts[best] ? f : best), families[0]);
    out[i] = { persona: p, model: pool[fam], family: fam };
    counts[fam] += 1;
  });
  return out;
}

export function pickSynthModel(assignments, mode = 'personas') {
  const counts = {};
  for (const a of assignments) counts[a.family] = (counts[a.family] || 0) + 1;
  const cands = SYNTH_CANDIDATES[mode];
  return cands.reduce((best, m) => ((counts[familyOf(m)] || 0) < (counts[familyOf(best)] || 0) ? m : best), cands[0]);
}

function pickRedteamModel(synthModel, mode) {
  const pool = MODE_POOLS[mode];
  const fam = Object.keys(pool).find(f => f !== familyOf(synthModel));
  return pool[fam];
}

// =============================================================================
// Contexto del proyecto
// =============================================================================

function cap(text, n, { tail = false } = {}) {
  if (text.length <= n) return { text, truncated: false };
  return { text: tail ? `[...]\n${text.slice(-n)}` : `${text.slice(0, n)}\n[...]`, truncated: true };
}

export function buildProjectContext({ root = REPO_ROOT, files = [], extra = '' } = {}) {
  const parts = [];
  const sources = [];
  let budget = CONTEXT_CAPS.total;

  const add = (label, path, raw, limit, opts) => {
    if (budget <= 200) { sources.push({ path: label, skipped: 'sin presupuesto de contexto' }); return; }
    const c = cap(raw.trim(), Math.min(limit, budget), opts);
    budget -= c.text.length;
    parts.push(`## ${label}\n\n${c.text}`);
    sources.push({ path: label, chars: c.text.length, truncated: c.truncated });
  };

  const principles = join(root, 'content', 'principles.md');
  if (existsSync(principles)) add('content/principles.md', principles, readFileSync(principles, 'utf8'), CONTEXT_CAPS.principles);

  const decisions = join(root, 'memory', 'decisions.md');
  if (existsSync(decisions)) {
    const raw = readFileSync(decisions, 'utf8');
    // Solo si hay decisiones reales (entradas "## fecha: título"), no la plantilla vacía.
    if (/^## \d{4}-\d{2}-\d{2}/m.test(raw)) {
      add('memory/decisions.md (recientes)', decisions, raw, CONTEXT_CAPS.decisions, { tail: true });
    }
  }

  for (const f of files) {
    const p = isAbsolute(f) ? f : resolve(root, f);
    const label = relative(root, p).replace(/\\/g, '/') || f;
    if (!existsSync(p)) { sources.push({ path: label, missing: true }); continue; }
    add(label, p, readFileSync(p, 'utf8'), CONTEXT_CAPS.per_file);
  }

  if (extra && extra.trim()) add('contexto adicional', null, extra, 2000);
  return { text: parts.join('\n\n'), sources };
}

// =============================================================================
// Costo y latencia estimados
// =============================================================================

function priceOf(model, inTok, outTok) {
  const m = MODEL_CATALOG[model];
  if (!m) return 0;
  return (inTok / 1e6) * m.in + (outTok / 1e6) * m.out;
}

export function estimateCouncilCost({ assignments, mode = 'personas', redteam = false, contextChars = 6000 }) {
  const lim = LIMITS[mode];
  const synth = pickSynthModel(assignments, mode);
  const ctxTok = Math.ceil(contextChars / 3.5);
  const outTok = Math.round(lim.persona_max_tokens * 0.6);
  let usd = 0;
  for (const a of assignments) usd += priceOf(a.model, 900 + ctxTok, outTok);
  const mergeIn = 1500 + ctxTok + assignments.length * 700;
  usd += priceOf(synth, mergeIn, Math.round(lim.merge_max_tokens * 0.6));
  if (redteam) {
    usd += priceOf(pickRedteamModel(synth, mode), 2500, 800);
    usd += priceOf(synth, mergeIn + 3000, Math.round(lim.merge_max_tokens * 0.6));
  }
  const base = mode === 'multimodel' ? [90, 240] : [40, 100];
  const seconds = redteam ? [base[0] + 30, base[1] + 90] : base;
  return { usd: Number(usd.toFixed(4)), seconds, synth_model: synth };
}

// =============================================================================
// JSON robusto + llamada con reintentos
// =============================================================================

export function parseJsonLoose(content) {
  if (typeof content !== 'string') return null;
  let t = content.trim();
  const fence = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

function usageCost(r, model) {
  const raw = r?.raw?.usage?.cost;
  if (typeof raw === 'number') return { usd: raw, real: true };
  return { usd: priceOf(model, r?.usage?.prompt_tokens || 0, r?.usage?.completion_tokens || 0), real: false };
}

const NO_RETRY = ['unauthorized', 'no_api_key', 'invalid_messages', 'invalid_model_arg', 'payment_required'];

// Llama al modelo, parsea JSON y valida. 2 intentos por error de red; 1 intento
// de reparación si el JSON no cumple el schema.
async function callJson({ chatFn, model, system, user, validate, max_tokens, timeout_ms, temperature = 0.7 }) {
  const costs = [];
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const messages = [{ role: 'user', content: user }];
      let r = await chatFn({ model, system, messages, max_tokens, temperature, timeout_ms, extra: { usage: { include: true } } });
      costs.push(usageCost(r, model));
      let data = parseJsonLoose(r.content);
      let v = data ? validate(data) : { ok: false, errors: ['la respuesta no es JSON'] };
      if (!v.ok) {
        messages.push({ role: 'assistant', content: r.content || '' });
        messages.push({ role: 'user', content: `Your answer is not valid: ${v.errors.slice(0, 5).join('; ')}. Return ONLY the corrected JSON object.` });
        r = await chatFn({ model, system, messages, max_tokens, temperature: 0.2, timeout_ms, extra: { usage: { include: true } } });
        costs.push(usageCost(r, model));
        data = parseJsonLoose(r.content);
        v = data ? validate(data) : { ok: false, errors: ['la respuesta no es JSON'] };
      }
      if (v.ok) return { ok: true, data, costs, model_used: r.model_used || model };
      lastErr = new CouncilError(`JSON inválido de ${model}: ${v.errors.join('; ')}`, { code: 'invalid_json', details: { raw: r.content } });
    } catch (e) {
      lastErr = e;
      if (e instanceof OpenRouterError && NO_RETRY.includes(e.code)) break;
    }
  }
  return { ok: false, error: lastErr, costs };
}

async function runParallel(items, fn, parallelism) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = { ok: false, error: e, costs: [] }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallelism, items.length) }, worker));
  return results;
}

// =============================================================================
// Prompts (instrucciones en inglés; todo el contenido de salida en español neutro)
// =============================================================================

const SPANISH_RULE = 'Write every string value in neutral Spanish (tuteo: tú, tienes, puedes). Never use voseo or Rioplatense words (vos, tenés, podés, decime, che).';

function personaSystem(p) {
  return [
    'You are one member of an expert council. Stay fully in character.',
    `ROLE: ${p.actua_como}`,
    `You obsess about: ${p.obsessions.join('; ')}.`,
    `You deliberately ignore: ${p.ignores.join('; ')}.`,
    `Your known blind spots (be aware of them): ${p.blind_spots.join('; ')}.`,
    `Questions you typically ask: ${p.typical_questions.join(' | ')}`,
    '',
    'Rules:',
    '- Answer independently; you cannot see the other members.',
    '- Be concrete and specific to THIS project and question. Use the project context when it is relevant.',
    '- Do not invent real-world data (prices, statistics, competitors). If something needs research, say so.',
    `- ${SPANISH_RULE}`,
    '- Output ONLY one JSON object. No markdown fences, no text before or after.',
  ].join('\n');
}

function personaUser({ question, contextText, persona }) {
  return [
    '# Pregunta del council',
    question,
    '',
    '# Contexto del proyecto',
    contextText || '(sin contexto de proyecto disponible)',
    '',
    '# Your output',
    'Return exactly this JSON shape (2-4 items per list, one sentence each, max ~35 words):',
    `{"persona": "${persona.id}", "threats": ["..."], "opportunities": ["..."], "ideas": ["..."], "key_concern": "the single thing you care most about here", "would_change_mind_if": "what evidence would change your view"}`,
  ].join('\n');
}

const MERGE_SYSTEM = [
  'You are the integrator of an expert council. You do NOT pick a winner and you do NOT rank voices.',
  'You MERGE: collect the threats, opportunities and ideas every voice saw, and build one improved, integrated proposal that keeps the best of each.',
  'Voices are anonymous (A, B, C...). Judge each point on its merit, never on who said it.',
  'You MUST always give a concrete recommendation, even under uncertainty; express uncertainty through "confidence", never by withholding the recommendation.',
  SPANISH_RULE,
  'Output ONLY one JSON object. No markdown fences.',
].join('\n');

function mergeUser({ question, contextText, voices }) {
  const block = voices.map(v => `## Voz ${v.voice}\n${JSON.stringify(v.answer, null, 1)}`).join('\n\n');
  return [
    '# Pregunta del council', question, '',
    '# Contexto del proyecto (resumen)', (contextText || '(sin contexto)').slice(0, 5000), '',
    '# Respuestas independientes (anonimizadas)', block, '',
    '# Your output',
    'Return exactly this JSON shape:',
    '{',
    '  "titular": "the recommendation as a slide headline: what to do, MAX 10 words",',
    '  "pasos": ["2-5 steps of the proposal for a diagram, MAX 5 words each"],',
    '  "integrated_proposal_md": "markdown, 150-350 words: the improved proposal with concrete steps. Tag each step with the voices that inspired it, e.g. [A] or [B,C].",',
    '  "contributions": [{"titular": "the point itself, MAX 10 words", "text": "one distinct point", "voice": "A" (or "A,C" if several voices saw it), "type": "threat|opportunity|idea", "adopted": true, "why": "why it was adopted or not"}],',
    '  "tensions": [{"titular": "the decision at stake, MAX 10 words", "between": ["A", "B"], "posturas": [{"voice": "A", "postura": "what this side wants, MAX 6 words"}, {"voice": "B", "postura": "..."}], "issue": "what they disagree on", "suggested_resolution": "how the proposal resolves it", "resolucion_corta": "that resolution, MAX 6 words"}],',
    '  "recommendation": "1-3 sentences, concrete, never null",',
    '  "confidence": "alta|media|baja",',
    '  "what_would_change_it": "what new fact would change the recommendation"',
    '}',
    'Rules: deduplicate similar points into one contribution (list all voices that saw it). 6-10 contributions, only the ones that matter. Include every voice at least once.',
    'Every "titular" is read alone on a big slide by a novice: it must state the actual content in plain words, not its category. Wrong: "Amenaza de costos". Right: "La voz puede triplicar el costo mensual". Never mention voices or roles inside a "titular", "pasos" or "postura".',
    '"adopted" must be honest: false when the proposal does not act on the point (deferred, rejected, out of scope). Do not adopt everything by default; explain in "why".',
    'Tensions: only real disagreements (can be empty). "between" lists only the voices on opposite sides, usually 2.',
    'Inside any free-text field, refer to a voice ONLY as "Voz A", "Voz B"... (never a bare letter like "A propone").',
  ].join('\n');
}

function redteamUser({ question, merge }) {
  return [
    '# Pregunta del council', question, '',
    '# Propuesta integrada a atacar', merge.integrated_proposal_md, '',
    `# Recomendación\n${merge.recommendation}`, '',
    'Attack this proposal. Find the hidden assumptions, failure modes and the simpler alternative that was dismissed.',
    'Return exactly: {"attacks": [{"issue": "...", "severity": "alta|media|baja", "fix": "what to change to survive it"}]} with 1-4 attacks. Severity "alta" only if it can sink the proposal.',
  ].join('\n');
}

function validateRedteam(d) {
  const ok = d && Array.isArray(d.attacks) && d.attacks.length > 0 && d.attacks.every(a =>
    a && typeof a.issue === 'string' && typeof a.fix === 'string' && ['alta', 'media', 'baja'].includes(a.severity));
  return { ok, errors: ok ? [] : ['attacks debe ser array de {issue, severity: alta|media|baja, fix}'] };
}

function patchUser({ question, mergeAnon, attacks }) {
  return [
    '# Pregunta del council', question, '',
    '# Síntesis actual (voces anonimizadas)', JSON.stringify(mergeAnon, null, 1), '',
    '# Ataques del red team (voz R)', JSON.stringify(attacks, null, 1), '',
    'Patch the integrated proposal so it survives the attacks with severity "alta" or "media". Keep everything that still holds.',
    'Add the red-team points you adopt as contributions with voice "R". Return the FULL JSON with the same shape as before; recommendation never null.',
  ].join('\n');
}

// =============================================================================
// Anonimización y re-atribución
// =============================================================================

const LETTERS = 'ABCDEFGHIJKLMNOPQ';

// Quita del texto los ids y nombres de las personas (ej. "Como CTO, ...") para
// que el integrador juzgue el aporte y no a quién lo dijo.
function scrubNames(value, terms) {
  if (typeof value === 'string') {
    return terms.reduce((s, t) => s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), 'esta voz'), value);
  }
  if (Array.isArray(value)) return value.map(v => scrubNames(v, terms));
  return value;
}

export function anonymize(answers, { shuffle = true } = {}) {
  // Ids que son palabras comunes ("datos", "cliente", "ventas") NO se borran:
  // solo nombres visibles, siglas (cto, sre, pm, cfo) e ids con guion.
  const terms = [...new Set(answers.flatMap(a => [
    a.persona_name,
    ...(a.persona_id && (a.persona_id.length <= 3 || a.persona_id.includes('-')) ? [a.persona_id, a.persona_id.replace(/-/g, ' ')] : []),
  ]).filter(t => t && t.length > 1))].sort((x, y) => y.length - x.length);
  const order = answers.map((_, i) => i);
  if (shuffle) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const map = {};
  const voices = order.map((idx, k) => {
    const a = answers[idx];
    const { persona, ...rest } = a.answer; // quita el nombre de la persona
    map[LETTERS[k]] = a.persona_id;
    const clean = Object.fromEntries(Object.entries(rest).map(([key, v]) => [key, scrubNames(v, terms)]));
    return { voice: LETTERS[k], answer: clean };
  });
  return { voices, map };
}

function splitVoices(v) {
  return String(v || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
}

export function reattribute(merge, map, personas) {
  const nameOf = id => personas.get(id)?.name || id;
  const resolveVoice = v => (v === 'R' ? 'contrarian' : map[v] || null);
  // "Voz A" / "la voz B" / "[A, C]" en texto libre -> nombre de la persona.
  const named = text => String(text || '')
    // Se absorbe el artículo ("la Voz A" -> "CTO") para no dejar "la CTO".
    .replace(/\b(?:[Ll]a |[Ee]l )?[Vv]oz ([A-Z])\b/g, (m, v) => (resolveVoice(v) ? nameOf(resolveVoice(v)) : m))
    .replace(/\[([A-Z](?:\s*[,+y]\s*[A-Z])*)\]/g, (m, inner) => {
      const names = splitVoices(inner).map(resolveVoice).filter(Boolean).map(nameOf);
      return names.length ? `[${names.join(', ')}]` : m;
    });
  const contributions = merge.contributions.map((c, i) => {
    const ids = splitVoices(c.voice).map(resolveVoice).filter(Boolean);
    const persona = ids[0] || 'desconocida';
    return {
      id: `c${i + 1}`,
      titular: named(c.titular),
      text: named(c.text),
      persona,
      persona_name: nameOf(persona),
      also_seen_by: ids.slice(1),
      type: c.type,
      adopted: c.adopted,
      why: named(c.why),
      source: splitVoices(c.voice).includes('R') ? 'redteam' : 'council',
    };
  });
  const tensions = merge.tensions.map((t, i) => {
    const between = t.between.flatMap(splitVoices).map(resolveVoice).filter(Boolean);
    const posturas = (t.posturas || []).flatMap(p => {
      const persona = splitVoices(p.voice).map(resolveVoice).find(Boolean);
      return persona ? [{ persona, persona_name: nameOf(persona), postura: named(p.postura) }] : [];
    });
    return {
      id: `t${i + 1}`,
      titular: named(t.titular),
      between,
      between_names: between.map(nameOf),
      posturas,
      issue: named(t.issue),
      suggested_resolution: named(t.suggested_resolution),
      resolucion_corta: named(t.resolucion_corta),
    };
  });
  return {
    titular: named(merge.titular),
    pasos: (merge.pasos || []).map(named),
    integrated_proposal_md: named(merge.integrated_proposal_md),
    recommendation: named(merge.recommendation).trim(),
    confidence: merge.confidence,
    what_would_change_it: named(merge.what_would_change_it),
    contributions,
    tensions,
  };
}

function agreementScore(answers) {
  const sets = answers.map(a => new Set(normalizeText(a.answer.key_concern).trim().split(' ').filter(w => w.length > 3)));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const inter = [...sets[i]].filter(w => sets[j].has(w)).length;
      const union = new Set([...sets[i], ...sets[j]]).size || 1;
      sum += inter / union;
      n += 1;
    }
  }
  return n ? Number((sum / n).toFixed(2)) : 0;
}

// =============================================================================
// invoke()
// =============================================================================

export function makeCouncilId(date = new Date()) {
  return `council-${date.toISOString().replace(/[:.]/g, '-')}`;
}

export function resolveCouncilPlan({ template, personas: personaIds, crear = [], mode, redteam, personasMap = loadPersonas(), templates } = {}) {
  let tpl = null;
  if (template) {
    tpl = (templates || loadTemplates({ personas: personasMap })).find(t => t.id === template);
    if (!tpl) throw new CouncilError(`Plantilla "${template}" no existe. Mira: node src/council.js list`, { code: 'template_not_found' });
  }
  // Se valida antes de mezclar con --crear: la lista de ids válidos es la de la biblioteca.
  const baseIds = (personaIds && personaIds.length ? personaIds : tpl?.personas || [])
    .map(id => (!personasMap.has(id) && PERSONA_ALIASES[id]) || id);
  const missing = baseIds.filter(id => !personasMap.has(id));
  if (missing.length) {
    throw new CouncilError(`Personas desconocidas: ${missing.join(', ')}. Ids válidos: ${[...personasMap.keys(), ...Object.keys(PERSONA_ALIASES)].join(', ')}`, { code: 'invalid_personas' });
  }
  const { personasMap: allPersonas, adhoc, ids: adhocIds } = withAdhocPersonas(crear, personasMap);
  const ids = [...new Set([...baseIds, ...adhocIds])];
  if (ids.length < 2) throw new CouncilError('Hacen falta al menos 2 personas (usa --template, --personas a,b o --crear "Rol: foco").', { code: 'invalid_personas' });
  if (ids.length > 6) throw new CouncilError('Máximo 6 personas por council.', { code: 'invalid_personas' });
  const finalMode = mode || tpl?.mode || 'personas';
  const assignments = assignModels(ids.map(id => allPersonas.get(id)), finalMode);
  if (finalMode === 'multimodel') {
    const fams = new Set(assignments.map(a => a.family)).size;
    if (fams < Math.min(3, ids.length)) throw new CouncilError('multimodel necesita al menos 3 familias de modelos.', { code: 'invalid_mode' });
  }
  return { template: tpl, mode: finalMode, redteam: redteam ?? tpl?.redteam ?? false, assignments, adhoc, personasMap: allPersonas };
}

export async function invoke({
  question,
  template,
  personas: personaIds,
  crear = [],
  mode,
  redteam,
  files = [],
  context = '',
  root = REPO_ROOT,
  confirmCost = false,
  chatFn = openrouterChat,
  onProgress = () => {},
  parallelism = 6,
  personasMap = loadPersonas(),
  now = new Date(),
} = {}) {
  if (!question || !String(question).trim()) throw new CouncilError('Falta la pregunta del council.', { code: 'invalid_question' });
  const t0 = Date.now();
  const plan = resolveCouncilPlan({ template, personas: personaIds, crear, mode, redteam, personasMap });
  const lim = LIMITS[plan.mode];
  const ctx = buildProjectContext({ root, files, extra: context });
  const est = estimateCouncilCost({ assignments: plan.assignments, mode: plan.mode, redteam: plan.redteam, contextChars: ctx.text.length });

  if ((plan.mode === 'multimodel' || est.usd > COST_CONFIRM_THRESHOLD_USD) && !confirmCost) {
    throw new CouncilError(
      `Este council (${plan.mode}) cuesta ~USD ${est.usd.toFixed(2)}. Confirma el costo y vuelve a correrlo con --yes.`,
      { code: 'cost_confirmation_required', details: { estimated_cost_usd: est.usd } },
    );
  }
  const synthModel = est.synth_model;
  const costs = [];
  onProgress({ type: 'start', estimate: est, personas: plan.assignments.map(a => `${a.persona.id} (${a.model})`) });

  // ---- Fase 1: respuestas independientes en paralelo
  const phase1 = await runParallel(plan.assignments, a => callJson({
    chatFn,
    model: a.model,
    system: personaSystem(a.persona),
    user: personaUser({ question, contextText: ctx.text, persona: a.persona }),
    validate: validatePersonaAnswer,
    max_tokens: lim.persona_max_tokens,
    timeout_ms: lim.timeout_ms,
  }), parallelism);

  const answers = [];
  const failed = [];
  phase1.forEach((r, i) => {
    const a = plan.assignments[i];
    costs.push(...(r.costs || []));
    if (r.ok) {
      answers.push({ persona_id: a.persona.id, persona_name: a.persona.name, model: a.model, answer: { ...r.data, persona: a.persona.id } });
      onProgress({ type: 'persona_ok', persona: a.persona.id });
    } else {
      failed.push({ persona: a.persona.id, model: a.model, error: r.error?.message || 'desconocido' });
      onProgress({ type: 'persona_failed', persona: a.persona.id, error: r.error?.message });
    }
  });
  if (answers.length < 2) {
    throw new CouncilError(`Solo respondieron ${answers.length} personas; hacen falta 2. Fallas: ${failed.map(f => `${f.persona}: ${f.error}`).join(' | ')}`,
      { code: 'insufficient_personas', details: { failed } });
  }

  // ---- Fase 2: fusión con voces anonimizadas
  const { voices, map } = anonymize(answers);
  const mergeR = await callJson({
    chatFn,
    model: synthModel,
    system: MERGE_SYSTEM,
    user: mergeUser({ question, contextText: ctx.text, voices }),
    validate: validateMerge,
    max_tokens: lim.merge_max_tokens,
    timeout_ms: lim.timeout_ms,
    temperature: 0.3,
  });
  costs.push(...mergeR.costs);
  if (!mergeR.ok) {
    throw new CouncilError(`La fusión falló: ${mergeR.error?.message}`, { code: 'merge_failed', details: { answers } });
  }
  let mergeAnon = mergeR.data;
  onProgress({ type: 'merge_ok' });

  // ---- Fase 3: red team opcional (con parada temprana)
  let redteamOut = null;
  if (plan.redteam) {
    const contrarian = plan.personasMap.get('contrarian');
    const rtModel = pickRedteamModel(synthModel, plan.mode);
    const rt = await callJson({
      chatFn,
      model: rtModel,
      system: personaSystem(contrarian),
      user: redteamUser({ question, merge: mergeAnon }),
      validate: validateRedteam,
      max_tokens: 1500,
      timeout_ms: lim.timeout_ms,
    });
    costs.push(...rt.costs);
    if (!rt.ok) {
      redteamOut = { model: rtModel, attacks: [], patched: false, note: `red team falló: ${rt.error?.message}` };
    } else {
      const serious = rt.data.attacks.filter(a => a.severity !== 'baja');
      redteamOut = { model: rtModel, attacks: rt.data.attacks, patched: false };
      if (serious.length === 0) {
        redteamOut.note = 'Solo ataques menores: la propuesta se mantiene (parada temprana).';
      } else {
        const patch = await callJson({
          chatFn,
          model: synthModel,
          system: MERGE_SYSTEM,
          user: patchUser({ question, mergeAnon, attacks: rt.data.attacks }),
          validate: validateMerge,
          max_tokens: lim.merge_max_tokens,
          timeout_ms: lim.timeout_ms,
          temperature: 0.3,
        });
        costs.push(...patch.costs);
        if (patch.ok) { mergeAnon = patch.data; redteamOut.patched = true; } else {
          redteamOut.note = `No se pudo parchar: ${patch.error?.message}. Se mantiene la propuesta anterior.`;
        }
      }
    }
    onProgress({ type: 'redteam_done', patched: redteamOut.patched });
  }

  const merge = reattribute(mergeAnon, map, plan.personasMap);
  const realCost = costs.every(c => c.real);
  const id = makeCouncilId(now);
  return {
    id,
    kind: 'council',
    created_at: now.toISOString(),
    question,
    mode: plan.mode,
    template: plan.template?.id || null,
    redteam_requested: plan.redteam,
    personas: plan.assignments.map(a => ({ id: a.persona.id, name: a.persona.name, model: a.model, family: a.family })),
    adhoc_personas: plan.adhoc,
    context_sources: ctx.sources,
    answers,
    merge,
    redteam: redteamOut,
    metadata: {
      synth_model: synthModel,
      cost_usd: Number(costs.reduce((s, c) => s + c.usd, 0).toFixed(4)),
      cost_source: realCost ? 'openrouter' : 'estimado',
      estimated_cost_usd: est.usd,
      duration_seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
      personas_total: plan.assignments.length,
      personas_alive: answers.length,
      partial: failed.length > 0,
      failed,
      drafts_agreement: agreementScore(answers),
      anonymized: true,
    },
  };
}

// =============================================================================
// Presentación: TLDR, línea resumen y revisión para el cockpit
// =============================================================================

function trunc(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// Títulos visibles del cockpit: máximo 10 palabras; el detalle va en body_md.
const TITLE_MAX_WORDS = 10;

export function capWords(text, max = TITLE_MAX_WORDS) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  return words.length > max ? `${words.slice(0, max).join(' ')}…` : words.join(' ');
}

export function summaryLine(result) {
  const m = result.merge;
  const adopted = m.contributions.filter(c => c.adopted).length;
  return `Council listo: ${result.metadata.personas_alive}/${result.metadata.personas_total} personas, ` +
    `${adopted}/${m.contributions.length} aportes adoptados, ${m.tensions.length} tensiones, confianza ${m.confidence}, ` +
    `USD ${result.metadata.cost_usd.toFixed(3)}, ${Math.round(result.metadata.duration_seconds)} s.`;
}

export function buildTldr(result) {
  const m = result.merge;
  const adopted = m.contributions.filter(c => c.adopted);
  const highlights = adopted.slice(0, 2).map(c => `${trunc(c.text, 70)} (lo vio ${c.persona_name})`).join('; ');
  const tension = m.tensions[0];
  return [
    `1. Recomendación: ${trunc(m.recommendation, 220)}`,
    `2. Confianza ${m.confidence}. Cambiaría si: ${trunc(m.what_would_change_it, 140)}`,
    `3. Aportes clave: ${highlights || 'sin aportes adoptados'}`,
    `4. Tensión principal: ${tension ? `${tension.between_names.join(' vs ')}: ${trunc(tension.issue, 120)}` : 'ninguna relevante'}`,
    `5. ${adopted.length}/${m.contributions.length} aportes adoptados · USD ${result.metadata.cost_usd.toFixed(3)} · ${Math.round(result.metadata.duration_seconds)} s · vota cada aporte en el cockpit (cockpit/reviews/${result.id}.json)`,
  ].join('\n');
}

// Titular de lámina: el del integrador o, en resultados viejos que no lo traen, la
// primera frase del texto largo. Nunca pasa de 10 palabras; el resto queda en body_md.
function titularOf(short, long) {
  if (typeof short === 'string' && short.trim()) return capWords(short);
  const clean = String(long || '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  return capWords(clean.split(/(?<=[.!?:;])\s/)[0]);
}

const CONTRIBUTION_LOOK = {
  threat: { label: 'Amenaza', icon: 'alert' },
  opportunity: { label: 'Oportunidad', icon: 'rocket' },
  idea: { label: 'Idea', icon: 'sparkles' },
};

function tldrSlide(result) {
  const m = result.merge;
  const adopted = m.contributions.filter(c => c.adopted).length;
  const pasos = (m.pasos || []).filter(Boolean).slice(0, 5).map(p => ({ label: capWords(p, 6) }));
  const steps = pasos.length >= 2 ? pasos : [
    { label: 'Tu pregunta', icon: 'chat', tone: 'you' },
    { label: `${result.metadata.personas_alive} expertos`, icon: 'users' },
    { label: 'Propuesta integrada', icon: 'merge' },
    { label: 'Tú decides', icon: 'up', tone: 'you' },
  ];
  return {
    id: 'propuesta',
    title: 'Recomendación del council',
    kicker: 'Recomendación del council',
    headline: titularOf(m.titular, m.recommendation),
    ask: '¿La aplicamos?',
    visual: { type: 'diagram', kind: 'flow', steps },
    stats: [
      { value: m.confidence.charAt(0).toUpperCase() + m.confidence.slice(1), label: 'confianza' },
      { value: `${adopted}/${m.contributions.length}`, label: 'aportes adoptados' },
      { value: m.tensions.length, label: m.tensions.length === 1 ? 'tensión' : 'tensiones' },
    ],
    body_md: `**Pregunta:** ${result.question}\n\n${m.integrated_proposal_md}\n\n**Recomendación:** ${m.recommendation}\n\n**Confianza:** ${m.confidence}. **Cambiaría si:** ${m.what_would_change_it}`,
    media: [],
    tags: ['propuesta', `confianza-${m.confidence}`],
  };
}

function participantsSlide(result) {
  const m = result.merge;
  const failed = new Set((result.metadata.failed || []).map(f => f.persona));
  const members = result.personas.map(p => {
    const mine = m.contributions.filter(c => c.persona === p.id || c.also_seen_by.includes(p.id));
    const used = mine.filter(c => c.adopted).length;
    return failed.has(p.id)
      ? { label: p.name, note: 'Sin respuesta', icon: 'user', tone: 'missing' }
      : { label: p.name, note: `${mine.length} ${mine.length === 1 ? 'aporte' : 'aportes'}, ${used} ${used === 1 ? 'adoptado' : 'adoptados'}`, icon: 'user' };
  });
  if (result.redteam && !result.personas.some(p => p.id === 'contrarian')) {
    members.push({ label: 'Contrarian', note: 'Atacó la propuesta', icon: 'shield' });
  }
  const alive = result.metadata.personas_alive;
  return {
    id: 'participantes',
    title: 'Quién participó',
    kicker: 'Quién participó',
    headline: result.formato === 'entrevista' ? `${alive} coaches entrevistaron y propusieron por separado` : `${alive} expertos opinaron cada uno por separado`,
    ask: '¿Faltó alguien?',
    visual: { type: 'diagram', kind: 'org', lead: { label: 'Integrador', note: 'Fusiona lo mejor de cada uno', icon: 'merge' }, members },
    stats: result.engine === 'agentes'
      ? [{ value: 'Plan', label: 'subagentes de Claude Code, sin API' }, { value: alive, label: result.formato === 'entrevista' ? 'coaches' : 'expertos' }]
      : [
        { value: `$${result.metadata.cost_usd.toFixed(3)}`, label: 'costo en USD' },
        { value: `${Math.round(result.metadata.duration_seconds)} s`, label: 'duración' },
      ],
    body_md: [
      'El integrador recibió las respuestas sin nombres, para juzgar cada punto por lo que dice y no por quién lo dijo.',
      '',
      ...result.personas.map(p => `- **${p.name}** (\`${p.model}\`)${failed.has(p.id) ? ': no respondió' : ''}`),
      '',
      `**Integrador:** \`${result.metadata.synth_model}\``,
    ].join('\n'),
    media: [],
    tags: ['participantes'],
  };
}

// Entrevista: a quién se entrevistó (audiencia ficticia) y cuánto se preguntó.
function interviewSlide(result) {
  const iv = result.interview;
  return {
    id: 'entrevistados',
    title: 'A quién entrevistó el panel',
    kicker: 'Entrevista · audiencia ficticia',
    headline: capWords(`${iv.audience.length} personas ficticias respondieron cada una por separado`),
    ask: '¿Se parecen a tus usuarios reales?',
    visual: {
      type: 'diagram', kind: 'org',
      lead: { label: 'Panel de coaches', note: capWords(result.personas.map(p => p.name).join(', '), 8), icon: 'users' },
      members: iv.audience.map(a => ({ label: a.name, note: capWords(a.perfil, 8), icon: 'user' })),
    },
    stats: [
      { value: (iv.questions || []).length, label: 'preguntas' },
      { value: (iv.followups || []).length, label: 'repreguntas' },
    ],
    body_md: `Son personas ficticias: sirven para encontrar preguntas e ideas, no reemplazan una prueba con usuarios reales.\n\n${iv.transcript_md}`,
    media: [],
    tags: ['entrevista'],
  };
}

function tensionSlide(t) {
  const sides = (t.posturas || []).slice(0, 2);
  const shortFix = titularOf(t.resolucion_corta, t.suggested_resolution);
  const visual = sides.length === 2
    ? {
      type: 'compare',
      options: [
        ...sides.map((s, i) => ({ id: i === 0 ? 'a' : 'b', label: `${s.persona_name}: ${s.postura}`, icon: 'user' })),
        { id: 'propuesta', label: `Propuesta: ${shortFix}`, icon: 'merge' },
      ],
    }
    : {
      type: 'diagram',
      kind: 'flow',
      steps: [
        { label: t.between_names[0] || 'Un lado', icon: 'user' },
        { label: shortFix, note: 'Propuesta', icon: 'merge', tone: 'you' },
        { label: t.between_names[1] || 'Otro lado', icon: 'user' },
      ],
    };
  return {
    id: t.id,
    title: titularOf(t.titular, t.issue),
    kicker: capWords(`Tensión: ${t.between_names.map(n => capWords(n, 4)).join(' vs ')}`),
    headline: titularOf(t.titular, t.issue),
    ask: sides.length === 2 ? '¿Con cuál te quedas?' : '¿Te sirve esta resolución?',
    visual,
    body_md: `**Entre:** ${t.between_names.join(' y ')}\n\n${t.issue}\n\n**Resolución sugerida:** ${t.suggested_resolution}`,
    media: [],
    tags: ['tension', ...t.between],
  };
}

function contributionSlide(c, nameOf) {
  const look = CONTRIBUTION_LOOK[c.type];
  const also = c.also_seen_by.map(nameOf);
  const seen = also.length ? ` (también lo vio: ${also.join(', ')})` : '';
  return {
    id: c.id,
    title: titularOf(c.titular, c.text),
    kicker: `${capWords(c.persona_name, 5)} · ${look.label}`,
    headline: titularOf(c.titular, c.text),
    ask: c.adopted ? '¿Te convence?' : '¿Lo sumamos igual?',
    visual: {
      type: 'diagram',
      kind: 'flow',
      steps: [
        { label: c.persona_name, ...(also.length ? { note: `También: ${also.join(', ')}` } : {}), icon: 'user' },
        { label: look.label, icon: look.icon },
        c.adopted ? { label: 'Adoptado', icon: 'check', tone: 'ok' } : { label: 'No adoptado', icon: 'close', tone: 'missing' },
      ],
    },
    body_md: `${c.text}\n\n${c.adopted ? 'Adoptado' : 'No adoptado'} en la propuesta: ${c.why}${seen}`,
    media: [],
    tags: [c.persona, c.type, c.adopted ? 'adoptado' : 'no-adoptado', ...(c.source === 'redteam' ? ['redteam'] : [])],
  };
}

// Revisión visual para el cockpit (cockpit/README.md): recomendación, quién participó,
// una lámina por tensión y un aporte por lámina, los adoptados primero. saveResult() la
// publica con publishReview() de src/cockpit.js, que la valida y la escribe de forma atómica.
export function toCockpitReview(result) {
  const m = result.merge;
  const names = new Map(result.personas.map(p => [p.id, p.name]));
  const nameOf = id => names.get(id) || id;
  const contributions = [...m.contributions.filter(c => c.adopted), ...m.contributions.filter(c => !c.adopted)];
  const items = [
    tldrSlide(result),
    participantsSlide(result),
    ...(result.interview ? [interviewSlide(result)] : []),
    ...m.tensions.map(tensionSlide),
    ...contributions.map(c => contributionSlide(c, nameOf)),
  ];
  const who = result.personas.map(p => p.name).join(', ');
  const topTension = m.tensions[0] ? ` La tensión principal es entre ${m.tensions[0].between_names.join(' y ')}: ${m.tensions[0].issue}` : '';
  return {
    id: result.id,
    title: `Council: ${titularOf(m.titular, result.question).split(' ').slice(0, TITLE_MAX_WORDS - 1).join(' ')}`,
    kind: 'council',
    created_at: result.created_at,
    connects_to: [`councils/results/${result.id}.json`, ...(result.template ? [`councils/templates/${result.template}.json`] : [])],
    context_brief:
      `Council de expertos (${result.mode}) sobre: "${result.question}". Participaron ${who}. ` +
      `Cada persona opinó por separado y luego se fusionó lo mejor de cada una. ` +
      `Recomendación: ${m.recommendation} (confianza ${m.confidence}).${topTension} ` +
      `Aldot ve cada ítem como una lámina con un titular y un diagrama: nombra lo que está viendo. Hay ${m.contributions.length} aportes atribuidos para votar con pulgar arriba o abajo; ` +
      'guía al usuario aporte por aporte, explicando en palabras simples qué vio cada persona y por qué se adoptó o no.',
    items,
  };
}

export function saveResult(result, { root = REPO_ROOT } = {}) {
  const resultsDir = join(root, 'councils', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const resultPath = join(resultsDir, `${result.id}.json`);
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const { path: reviewPath } = publishReview(toCockpitReview(result), root);
  return { resultPath, reviewPath };
}

// =============================================================================
// Motor "agentes": cada persona corre como subagente de Claude Code (herramienta
// Agent, en paralelo) en vez de OpenRouter. Este archivo NO llama modelos: prepara
// los prompts por fase, valida lo que escribieron los subagentes y registra el
// resultado en el mismo formato que `run` (councils/results/<id>.json + cockpit).
//
// Formatos:
//   council     respuestas (personas) -> integrar -> registrar
//   entrevista  preguntas (coaches) -> respuestas (audiencia) -> repreguntas (coaches,
//               una por persona: pimponeo) -> respuestas2 (audiencia) -> hallazgos
//               (coaches) -> integrar -> registrar
// =============================================================================

export const AGENT_MODEL = 'claude-code-subagente';
export const AGENT_FORMATS = ['council', 'entrevista'];
export const INTERVIEW_LIMITS = { coaches: [3, 5], audience: [3, 6], questions: 12 };
const PHASES = {
  council: ['respuestas', 'integrar'],
  entrevista: ['preguntas', 'respuestas', 'repreguntas', 'respuestas2', 'hallazgos', 'integrar'],
};

export const agentRunsDir = (root = REPO_ROOT) => join(root, 'councils', 'runs');

// "Novia práctica: 29 años, organiza sola" -> persona ficticia de audiencia.
export function parseAudience(spec) {
  const text = typeof spec === 'string' ? spec.trim() : '';
  const i = text.indexOf(':');
  const role = i > 0 ? text.slice(0, i).trim() : '';
  const perfil = i > 0 ? text.slice(i + 1).trim() : '';
  if (role.length < 2 || perfil.length < 5 || !slugify(role)) {
    throw new CouncilError(
      `--audiencia necesita el formato "Rol: perfil", por ejemplo --audiencia "Novia práctica: 29 años, organiza sola, presupuesto ajustado". Recibí: ${text || '(vacío)'}`,
      { code: 'invalid_audiencia' },
    );
  }
  return { id: `aud-${slugify(role)}`, name: role, perfil };
}

function writeJsonInstruction(path, shape) {
  return [
    '',
    '# How to deliver',
    `Write ONLY one JSON object to this file with the Write tool: ${path}`,
    `Shape: ${shape}`,
    'No markdown fences, no text outside the JSON. Do not read or write any other file of this council (answer independently).',
    'When the file is written, reply with one word: listo.',
  ].join('\n');
}

const AUDIENCE_RULE = 'You are a FICTIONAL member of the target audience, not an expert. Speak in first person, from concrete past experiences (what you did, what went wrong, what you paid), not opinions about features. If something does not apply to you, say so. Never invent real brands, prices or statistics as facts.';

function audienceSystem(a) {
  return [
    `ROLE: Actúas como ${a.name.charAt(0).toLowerCase()}${a.name.slice(1)}, una persona ficticia: ${a.perfil}.`,
    AUDIENCE_RULE,
    SPANISH_RULE,
  ].join('\n');
}

// En el motor agentes la salida va a un archivo: se quita la regla de 'responde solo JSON'.
const forFile = s => s
  .replace(/\n?- Output ONLY one JSON object\. No markdown fences, no text before or after\./, '')
  .replace(/\nOutput ONLY one JSON object\. No markdown fences\./, '');

function coachSystem(p) {
  return forFile(personaSystem(p))
    .replace('You are one member of an expert council. Stay fully in character.', 'You are one coach of an interview panel that studies real users before innovating. Stay fully in character (you may be inspired by a real person, never claim to BE them).');
}

function readPhaseJson(path) {
  if (!existsSync(path)) return { exists: false, data: null };
  return { exists: true, data: parseJsonLoose(readFileSync(path, 'utf8')) };
}

const isStr = (s, min = 3) => typeof s === 'string' && s.trim().length >= min;
const validateQuestions = d => {
  const ok = d && Array.isArray(d.questions) && d.questions.length >= 2 && d.questions.length <= 5 && d.questions.every(q => isStr(q, 8));
  return { ok, errors: ok ? [] : ['questions: de 2 a 5 preguntas (texto)'] };
};
const validateAudienceAnswers = d => {
  const ok = d && Array.isArray(d.answers) && d.answers.length >= 1 && d.answers.every(a => a && isStr(a.q, 1) && isStr(a.answer));
  return { ok, errors: ok ? [] : ['answers: [{q, answer}] con al menos una respuesta'] };
};
const validateFollowups = (d, audIds) => {
  const ok = d && Array.isArray(d.followups) && d.followups.length >= 1 && d.followups.every(f => f && audIds.includes(f.to) && isStr(f.question, 8));
  return { ok, errors: ok ? [] : [`followups: [{to: ${audIds.join('|')}, question}]`] };
};
const validateAnswers2 = d => {
  const ok = d && Array.isArray(d.answers) && d.answers.every(a => a && isStr(a.from, 1) && isStr(a.answer));
  return { ok, errors: ok ? [] : ['answers: [{from, answer}]'] };
};

// Preguntas de todos los coaches, numeradas Q1..Qn, repartidas en ronda (máx. 12).
export function collectQuestions(byCoach, max = INTERVIEW_LIMITS.questions) {
  const lists = byCoach.map(({ coach, questions }) => questions.map(text => ({ by: coach, text: String(text).trim() })));
  const seen = new Set();
  const out = [];
  for (let i = 0; out.length < max && lists.some(l => l[i]); i += 1) {
    for (const l of lists) {
      const q = l[i];
      if (!q || out.length >= max) continue;
      const key = normalizeText(q.text).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `Q${out.length + 1}`, ...q });
    }
  }
  return out;
}

function phaseFile(dir, phase, who) { return join(dir, `${phase}-${who}.json`); }
function promptFile(dir, phase, who) { return join(dir, `prompt-${phase}-${who}.md`); }

/** Transcripción legible de la entrevista hasta donde haya respuestas. */
export function buildTranscript(plan, dir) {
  const qs = plan.questions || [];
  const nameOf = id => plan.coaches.find(c => c.id === id)?.name || id;
  const lines = [`# Entrevista: ${plan.question}`, ''];
  for (const a of plan.audience) {
    lines.push(`## ${a.name} (${a.perfil})`);
    const r1 = readPhaseJson(phaseFile(dir, 'respuestas', a.id)).data;
    for (const ans of r1?.answers || []) {
      const q = qs.find(x => x.id === ans.q);
      lines.push(`- **${ans.q}${q ? ` (${nameOf(q.by)}): ${q.text}` : ''}**`, `  ${a.name}: ${ans.answer}`);
    }
    const r2 = readPhaseJson(phaseFile(dir, 'respuestas2', a.id)).data;
    for (const ans of r2?.answers || []) {
      const f = (plan.followups || []).find(x => x.to === a.id && x.from === ans.from);
      lines.push(`- **Repregunta de ${nameOf(ans.from)}${f ? `: ${f.question}` : ''}**`, `  ${a.name}: ${ans.answer}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Prompts de una fase: [{ who, prompt_path, output_path }] (los escribe en disco). */
function writePhase(plan, dir, phase) {
  const tasks = [];
  const add = (who, prompt) => {
    const prompt_path = promptFile(dir, phase, who);
    writeFileSync(prompt_path, `${prompt}\n`, 'utf8');
    tasks.push({ who, prompt_path, output_path: phase === 'integrar' ? join(dir, 'merge.json') : phaseFile(dir, phase, who) });
  };
  const ctx = plan.context_text || '(sin contexto de proyecto disponible)';
  const audienceList = (plan.audience || []).map(a => `- ${a.id}: ${a.name} (${a.perfil})`).join('\n');
  if (plan.formato === 'council' && phase === 'respuestas') {
    for (const p of plan.personas) {
      add(p.id, [forFile(personaSystem(p)), '', personaUser({ question: plan.question, contextText: ctx, persona: p }),
        writeJsonInstruction(phaseFile(dir, phase, p.id), 'the JSON shape above')].join('\n'));
    }
  }
  if (phase === 'preguntas') {
    for (const c of plan.coaches) {
      add(c.id, [coachSystem(c), '', '# Tema de la entrevista', plan.question, '', '# Contexto del proyecto', ctx, '',
        '# A quién entrevistamos (personas ficticias de la audiencia)', audienceList, '',
        'Write 2-4 key questions from YOUR angle. Ask about past behavior and real moments ("la última vez que...", "qué hiciste cuando..."), never "¿te gustaría X?". One question per item, in neutral Spanish.',
        writeJsonInstruction(phaseFile(dir, phase, c.id), `{"coach": "${c.id}", "questions": ["...", "..."]}`)].join('\n'));
    }
  }
  if (plan.formato === 'entrevista' && phase === 'respuestas') {
    const qs = plan.questions.map(q => `${q.id}. ${q.text}`).join('\n');
    for (const a of plan.audience) {
      add(a.id, [audienceSystem(a), '', '# Contexto (lo que te cuentan del producto)', plan.question, '', '# Preguntas del panel', qs, '',
        'Answer every question in 1-3 sentences each, as yourself. Concrete stories beat opinions.',
        writeJsonInstruction(phaseFile(dir, phase, a.id), `{"persona": "${a.id}", "answers": [{"q": "Q1", "answer": "..."}]}`)].join('\n'));
    }
  }
  if (phase === 'repreguntas') {
    const transcript = buildTranscript(plan, dir);
    for (const c of plan.coaches) {
      add(c.id, [coachSystem(c), '', '# Transcripción hasta ahora', transcript, '',
        `Ask exactly ONE follow-up to each interviewee (${plan.audience.map(a => a.id).join(', ')}): dig into the most revealing or contradictory thing they said, from your angle.`,
        writeJsonInstruction(phaseFile(dir, phase, c.id), `{"coach": "${c.id}", "followups": [{"to": "${plan.audience[0].id}", "question": "..."}]}`)].join('\n'));
    }
  }
  if (phase === 'respuestas2') {
    for (const a of plan.audience) {
      const mine = (plan.followups || []).filter(f => f.to === a.id);
      const r1 = readPhaseJson(phaseFile(dir, 'respuestas', a.id)).data;
      add(a.id, [audienceSystem(a), '', '# Lo que ya respondiste', JSON.stringify(r1?.answers || [], null, 1), '',
        '# Repreguntas del panel (responde cada una en 1-3 frases)', mine.map(f => `- de ${f.from}: ${f.question}`).join('\n') || '- (sin repreguntas: responde con un array vacío)',
        writeJsonInstruction(phaseFile(dir, phase, a.id), `{"persona": "${a.id}", "answers": [{"from": "<coach id>", "answer": "..."}]}`)].join('\n'));
    }
  }
  if (phase === 'hallazgos') {
    const transcript = buildTranscript(plan, dir);
    for (const c of plan.coaches) {
      add(c.id, [coachSystem(c), '', '# Pregunta del council', plan.question, '', '# Contexto del proyecto', ctx, '', '# Transcripción completa de la entrevista', transcript, '',
        'From YOUR angle, turn what the interviewees said into findings. "ideas" are product innovations (a capability, decision or outcome for the end user), each citing who motivated it, e.g. "(lo dijo Novia práctica)". 2-4 items per list, one sentence each.',
        writeJsonInstruction(phaseFile(dir, phase, c.id), `{"persona": "${c.id}", "threats": ["..."], "opportunities": ["..."], "ideas": ["..."], "key_concern": "...", "would_change_mind_if": "..."}`)].join('\n'));
    }
  }
  if (phase === 'integrar') {
    const members = plan.formato === 'entrevista' ? plan.coaches : plan.personas;
    const src = plan.formato === 'entrevista' ? 'hallazgos' : 'respuestas';
    const answers = members.map(p => ({
      persona_id: p.id, persona_name: p.name, answer: { ...readPhaseJson(phaseFile(dir, src, p.id)).data, persona: p.id },
    }));
    const { voices, map } = anonymize(answers);
    plan.voice_map = map;
    const contextText = plan.formato === 'entrevista' ? `${buildTranscript(plan, dir)}\n\n${ctx}` : ctx;
    add('integrador', [forFile(MERGE_SYSTEM), '', mergeUser({ question: plan.question, contextText, voices }),
      writeJsonInstruction(join(dir, 'merge.json'), 'the JSON shape above')].join('\n'));
  }
  return tasks;
}

function phaseValidator(plan, phase) {
  if (phase === 'preguntas') return validateQuestions;
  if (phase === 'respuestas') return plan.formato === 'council' ? validatePersonaAnswer : validateAudienceAnswers;
  if (phase === 'repreguntas') return d => validateFollowups(d, plan.audience.map(a => a.id));
  if (phase === 'respuestas2') return validateAnswers2;
  if (phase === 'hallazgos') return validatePersonaAnswer;
  return validateMerge;
}

function phaseMembers(plan, phase) {
  if (phase === 'integrar') return ['integrador'];
  if (plan.formato === 'council') return plan.personas.map(p => p.id);
  return ['preguntas', 'repreguntas', 'hallazgos'].includes(phase) ? plan.coaches.map(c => c.id) : plan.audience.map(a => a.id);
}

/** Estado de la fase actual: qué salidas faltan o son inválidas. */
export function phaseStatus(plan, dir) {
  const phase = plan.phase;
  const validate = phaseValidator(plan, phase);
  const problems = [];
  for (const who of phaseMembers(plan, phase)) {
    const out = phase === 'integrar' ? join(dir, 'merge.json') : phaseFile(dir, phase, who);
    const { exists, data } = readPhaseJson(out);
    if (!exists) { problems.push({ who, output_path: out, prompt_path: promptFile(dir, phase, who), error: 'falta' }); continue; }
    const v = data ? validate(data) : { ok: false, errors: ['no es JSON'] };
    if (!v.ok) problems.push({ who, output_path: out, prompt_path: promptFile(dir, phase, who), error: v.errors.join('; ') });
  }
  return { phase, done: problems.length === 0, problems };
}

const planPath = dir => join(dir, 'plan.json');
function loadAgentPlan(id, root) {
  const dir = join(agentRunsDir(root), id);
  if (!existsSync(planPath(dir))) throw new CouncilError(`No existe la corrida de agentes ${id} en ${agentRunsDir(root)}`, { code: 'run_not_found' });
  return { dir, plan: JSON.parse(readFileSync(planPath(dir), 'utf8')) };
}
const saveAgentPlan = (dir, plan) => writeFileSync(planPath(dir), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

/**
 * Prepara una corrida del motor agentes (no llama modelos). Escribe plan.json y los
 * prompts de la primera fase en councils/runs/<id>/.
 */
export function prepareAgentRun({
  question, formato = 'council', template, personas: personaIds, crear = [], audiencia = [],
  files = [], context = '', root = REPO_ROOT, personasMap = loadPersonas(), now = new Date(), dryRun = false,
} = {}) {
  if (!question || !String(question).trim()) throw new CouncilError('Falta la pregunta del council.', { code: 'invalid_question' });
  if (!AGENT_FORMATS.includes(formato)) throw new CouncilError(`Formato inválido: ${formato}. Usa council | entrevista.`, { code: 'invalid_formato' });
  const plan0 = resolveCouncilPlan({ template, personas: personaIds, crear, mode: 'personas', personasMap });
  const members = plan0.assignments.map(a => a.persona);
  const audience = audiencia.map(parseAudience);
  if (formato === 'entrevista') {
    const [cMin, cMax] = INTERVIEW_LIMITS.coaches;
    const [aMin, aMax] = INTERVIEW_LIMITS.audience;
    if (members.length < cMin || members.length > cMax) throw new CouncilError(`La entrevista necesita de ${cMin} a ${cMax} coaches (tiene ${members.length}).`, { code: 'invalid_personas' });
    if (audience.length < aMin || audience.length > aMax) throw new CouncilError(`La entrevista necesita de ${aMin} a ${aMax} personas de audiencia con --audiencia "Rol: perfil" (tiene ${audience.length}).`, { code: 'invalid_audiencia' });
    if (new Set(audience.map(a => a.id)).size !== audience.length) throw new CouncilError('Hay personas de audiencia repetidas: usa roles distintos.', { code: 'invalid_audiencia' });
  }
  const ctx = buildProjectContext({ root, files, extra: context });
  const id = makeCouncilId(now);
  const plan = {
    id, engine: 'agentes', formato, question, created_at: now.toISOString(), template: plan0.template?.id || null,
    ...(formato === 'entrevista' ? { coaches: members, audience } : { personas: members }),
    adhoc_personas: plan0.adhoc, context_text: ctx.text, context_sources: ctx.sources,
    phase: PHASES[formato][0],
  };
  const panel = {
    id, formato,
    members: members.map(p => ({ id: p.id, name: p.name, adhoc: plan0.adhoc.some(a => a.id === p.id) })),
    audience,
    subagents: formato === 'entrevista' ? members.length * 3 + audience.length * 2 + 1 : members.length + 1,
  };
  if (dryRun) return { plan, panel, tasks: [], dir: null };
  const dir = join(agentRunsDir(root), id);
  mkdirSync(dir, { recursive: true });
  const tasks = writePhase(plan, dir, plan.phase);
  saveAgentPlan(dir, plan);
  return { plan, panel, tasks, dir };
}

/**
 * Avanza la corrida: si la fase actual está completa, escribe los prompts de la
 * siguiente. Si falta algo, devuelve qué falta (para relanzar solo esos subagentes).
 */
export function advanceAgentRun(id, { root = REPO_ROOT } = {}) {
  const { dir, plan } = loadAgentPlan(id, root);
  if (plan.phase === 'registrado') return { status: 'registrado', phase: plan.phase, tasks: [] };
  const st = phaseStatus(plan, dir);
  if (!st.done) return { status: 'esperando', phase: st.phase, problems: st.problems, tasks: [] };
  const order = PHASES[plan.formato];
  const i = order.indexOf(plan.phase);
  if (i === order.length - 1) return { status: 'listo', phase: plan.phase, tasks: [] };
  // Datos derivados de la fase que se cierra.
  if (plan.phase === 'preguntas') {
    plan.questions = collectQuestions(plan.coaches.map(c => ({ coach: c.id, questions: readPhaseJson(phaseFile(dir, 'preguntas', c.id)).data.questions })));
  }
  if (plan.phase === 'repreguntas') {
    plan.followups = plan.coaches.flatMap(c => readPhaseJson(phaseFile(dir, 'repreguntas', c.id)).data.followups
      .map(f => ({ from: c.id, to: f.to, question: String(f.question).trim() })));
  }
  plan.phase = order[i + 1];
  const tasks = writePhase(plan, dir, plan.phase);
  saveAgentPlan(dir, plan);
  return { status: 'nueva-fase', phase: plan.phase, tasks };
}

/** Archivo de hallazgos (markdown corto) para alimentar la variante CONTEXTO de bold-rounds. */
export function findingsMarkdown(result) {
  const m = result.merge;
  const lines = [
    `# Hallazgos del council ${result.id}${result.formato === 'entrevista' ? ' (entrevista)' : ''}`,
    '', `Pregunta: ${result.question}`, `Recomendación: ${m.recommendation} (confianza ${m.confidence})`, '',
    '## Hallazgos adoptados',
    ...m.contributions.filter(c => c.adopted).map(c => `- ${c.titular || trunc(c.text, 90)}: ${trunc(c.text, 240)} (lo vio ${c.persona_name})`),
  ];
  const rejected = m.contributions.filter(c => !c.adopted);
  if (rejected.length) lines.push('', '## Descartados (no insistir sin evidencia nueva)', ...rejected.map(c => `- ${c.titular || trunc(c.text, 90)}: ${trunc(c.why, 160)}`));
  if (m.tensions.length) lines.push('', '## Tensiones', ...m.tensions.map(t => `- ${t.titular || t.issue}: ${trunc(t.suggested_resolution, 200)}`));
  if (result.interview) {
    lines.push('', '## Lo que dijo la audiencia (ficticia: validar con usuarios reales)');
    for (const a of result.interview.audience) lines.push(`- ${a.name}: "${trunc(a.first_answer || '', 220)}"`);
  }
  return `${lines.join('\n')}\n`;
}

/** Registra la corrida: valida merge.json, re-atribuye y guarda resultado + revisión del cockpit + hallazgos. */
export function recordAgentRun(id, { root = REPO_ROOT, personasMap = loadPersonas(), now = new Date() } = {}) {
  const { dir, plan } = loadAgentPlan(id, root);
  if (plan.phase !== 'integrar') throw new CouncilError(`La corrida está en la fase "${plan.phase}". Corre primero: node src/council.js siguiente ${id}`, { code: 'phase_not_ready' });
  const st = phaseStatus(plan, dir);
  if (!st.done) throw new CouncilError(`Falta o es inválido merge.json: ${st.problems.map(p => p.error).join('; ')}`, { code: 'merge_failed' });
  const members = plan.formato === 'entrevista' ? plan.coaches : plan.personas;
  const map = new Map(personasMap);
  for (const p of members) map.set(p.id, p);
  const merge = reattribute(readPhaseJson(join(dir, 'merge.json')).data, plan.voice_map || {}, map);
  const src = plan.formato === 'entrevista' ? 'hallazgos' : 'respuestas';
  const answers = members.map(p => ({ persona_id: p.id, persona_name: p.name, model: AGENT_MODEL, answer: { ...readPhaseJson(phaseFile(dir, src, p.id)).data, persona: p.id } }));
  const transcript = plan.formato === 'entrevista' ? buildTranscript(plan, dir) : null;
  const result = {
    id: plan.id,
    kind: 'council',
    engine: 'agentes',
    formato: plan.formato,
    created_at: plan.created_at,
    question: plan.question,
    mode: 'agentes',
    template: plan.template,
    redteam_requested: false,
    personas: members.map(p => ({ id: p.id, name: p.name, model: AGENT_MODEL, family: 'anthropic' })),
    adhoc_personas: plan.adhoc_personas || [],
    context_sources: plan.context_sources || [],
    answers,
    merge,
    redteam: null,
    ...(transcript ? {
      interview: {
        audience: plan.audience.map(a => ({ ...a, first_answer: readPhaseJson(phaseFile(dir, 'respuestas', a.id)).data?.answers?.[0]?.answer || '' })),
        questions: plan.questions || [],
        followups: plan.followups || [],
        transcript_md: transcript,
      },
    } : {}),
    metadata: {
      synth_model: AGENT_MODEL,
      cost_usd: 0,
      cost_source: 'plan de Claude Code (sin API)',
      estimated_cost_usd: 0,
      duration_seconds: Number(((now.getTime() - new Date(plan.created_at).getTime()) / 1000).toFixed(1)),
      personas_total: members.length,
      personas_alive: members.length,
      partial: false,
      failed: [],
      drafts_agreement: agreementScore(answers),
      anonymized: true,
    },
  };
  const saved = saveResult(result, { root });
  const findingsPath = join(root, 'councils', 'results', `${result.id}-hallazgos.md`);
  writeFileSync(findingsPath, findingsMarkdown(result), 'utf8');
  plan.phase = 'registrado';
  saveAgentPlan(dir, plan);
  return { result, ...saved, findingsPath };
}

function printTasks(tasks, root, id) {
  const rel = p => relative(root, p).replace(/\\/g, '/');
  console.log(`Lanza UN mensaje con ${tasks.length} llamadas Agent (general-purpose) en paralelo; cada una recibe el contenido EXACTO de su prompt:`);
  for (const t of tasks) console.log(`  - ${t.who}: ${rel(t.prompt_path)}  ->  escribe ${rel(t.output_path)}`);
  console.log(`Cuando terminen: node src/council.js siguiente ${id}`);
}

// =============================================================================
// CLI
// =============================================================================

const REPEATABLE_ARGS = new Set(['crear', 'audiencia']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const value = next === undefined || next.startsWith('--') ? true : next;
      if (value !== true) i += 1;
      if (REPEATABLE_ARGS.has(key)) (args[key] ||= []).push(value);
      else args[key] = value;
    } else args._.push(a);
  }
  return args;
}

const list = v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

function cliUsage() {
  return [
    'Uso:',
    '  node src/council.js suggest "texto de la tarea" [--llm]   propone qué council conviene',
    '  node src/council.js list                                 lista plantillas y personas',
    '  node src/council.js run --question "..." [opciones]      corre un council',
    '',
    'Opciones de run:',
    '  --template <id>          plantilla (ej. nueva-funcionalidad)',
    '  --personas a,b,c         personas a mano, sin plantilla (reemplaza las de la plantilla)',
    '  --crear "Rol: foco"      crea un experto solo para esta corrida; se repite y se combina con --personas',
    '  --guardar                guarda en councils/personas/ los expertos de --crear para reutilizarlos',
    '  --mode multimodel        modelos fuertes de >=3 familias (requiere --yes)',
    '  --files a.md,b.md        archivos extra de contexto',
    '  --context "..."          contexto extra en texto',
    '  --redteam                el contrarian ataca la propuesta y se parcha',
    '  --yes                    confirma el costo (obligatorio en multimodel o > USD 0.50)',
    '  --dry-run                solo muestra costo y tiempo estimados',
    '',
    'Motor agentes (subagentes de Claude Code en paralelo; sin API ni costo extra):',
    '  node src/council.js prepare --question "..." [--template|--personas|--crear] [--files] [--context] [--dry-run]',
    '      [--formato entrevista --audiencia "Rol: perfil" (3-6 veces)]   entrevista: 3-5 coaches entrevistan a la audiencia',
    '  node src/council.js siguiente <id>    valida la fase actual y escribe los prompts de la siguiente',
    '  node src/council.js registrar <id>    guarda councils/results/<id>.json, la revisión del cockpit y <id>-hallazgos.md',
  ].join('\n');
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'suggest') {
    const text = args._.slice(1).join(' ');
    if (!text) { console.error(cliUsage()); process.exit(1); }
    const personas = loadPersonas();
    let sugs = suggestTemplates(text, { templates: loadTemplates({ personas }) });
    if (!sugs.length && args.llm) sugs = await suggestWithLlm(text);
    if (!sugs.length) {
      console.log('No veo un council claro para esto. Si igual quieres uno, prueba: --template estrategia');
      return;
    }
    sugs.forEach((s, i) => {
      console.log(`${i + 1}. ${s.template.id}: ${s.justification}`);
      console.log(`   ${formatProposal(s, personas)}`);
    });
    return;
  }

  if (cmd === 'list') {
    const personas = loadPersonas();
    console.log('Plantillas:');
    for (const t of loadTemplates({ personas })) {
      console.log(`  ${t.id} [${t.mode}${t.redteam ? ', redteam' : ''}]: ${t.personas.join(' + ')}  ${t.description}`);
    }
    console.log('\nPersonas:');
    for (const p of personas.values()) console.log(`  ${p.id}: ${p.name}`);
    console.log(`\nAlias: ${Object.entries(PERSONA_ALIASES).map(([a, id]) => `${a} -> ${id}`).join(', ')}`);
    return;
  }

  // ---- Motor agentes (subagentes de Claude Code; este script no llama modelos)
  if (cmd === 'prepare') {
    if (!args.question || args.question === true) { console.error(cliUsage()); process.exit(1); }
    const root = args.root ? resolve(args.root) : REPO_ROOT;
    const personasMap = root === REPO_ROOT ? loadPersonas() : new Map([...loadPersonas(), ...loadPersonas({ dir: join(root, 'councils', 'personas') })]);
    const r = prepareAgentRun({
      question: args.question,
      formato: typeof args.formato === 'string' ? args.formato : 'council',
      template: typeof args.template === 'string' ? args.template : undefined,
      personas: list(args.personas), crear: args.crear || [], audiencia: (args.audiencia || []).filter(a => a !== true),
      files: list(args.files), context: typeof args.context === 'string' ? args.context : '',
      root, personasMap, dryRun: !!args['dry-run'],
    });
    const who = r.panel.formato === 'entrevista' ? 'Coaches' : 'Expertos';
    console.log(`Council motor agentes (${r.panel.formato}), ~${r.panel.subagents} subagentes, sin costo de API (usa tu plan de Claude Code):`);
    console.log(`  ${who}: ${r.panel.members.map(m => `${m.name}${m.adhoc ? ' (creado)' : ''}`).join(', ')}`);
    if (r.panel.audience.length) console.log(`  Audiencia ficticia: ${r.panel.audience.map(a => `${a.name} (${a.perfil})`).join('; ')}`);
    if (args['dry-run']) { console.log('(dry-run: no se escribió nada)'); return; }
    console.log(`Corrida: councils/runs/${r.plan.id} · fase: ${r.plan.phase}`);
    printTasks(r.tasks, root, r.plan.id);
    return;
  }

  if (cmd === 'siguiente' || cmd === 'registrar') {
    const id = args._[1];
    if (!id) { console.error(`Uso: node src/council.js ${cmd} <id>`); process.exit(1); }
    const root = args.root ? resolve(args.root) : REPO_ROOT;
    if (cmd === 'siguiente') {
      const r = advanceAgentRun(id, { root });
      if (r.status === 'esperando') {
        console.log(`Fase "${r.phase}" incompleta. Relanza solo estos subagentes (mismo prompt) y vuelve a correr siguiente:`);
        for (const p of r.problems) console.log(`  - ${p.who}: ${relative(root, p.prompt_path).replace(/\\/g, '/')} (${p.error})`);
        process.exitCode = 2;
      } else if (r.status === 'listo') {
        console.log(`Integración lista. Registra el resultado: node src/council.js registrar ${id}`);
      } else if (r.status === 'registrado') {
        console.log(`Ya registrado: councils/results/${id}.json`);
      } else {
        console.log(`Fase nueva: ${r.phase}`);
        printTasks(r.tasks, root, id);
      }
      return;
    }
    const personasMap = root === REPO_ROOT ? loadPersonas() : new Map([...loadPersonas(), ...loadPersonas({ dir: join(root, 'councils', 'personas') })]);
    const r = recordAgentRun(id, { root, personasMap });
    console.log(`\n${summaryLine(r.result)}`);
    console.log(`\n${buildTldr(r.result)}`);
    console.log(`\nResultado: ${relative(root, r.resultPath)}\nRevisión cockpit: ${relative(root, r.reviewPath)}\nHallazgos para bold-rounds (--hallazgos): ${relative(root, r.findingsPath)}`);
    return;
  }

  if (cmd === 'run' && args.motor === 'agentes') {
    console.error('El motor agentes no corre con "run": usa node src/council.js prepare --question "..." [--formato entrevista] (ver la skill council).');
    process.exit(1);
  }

  if (cmd !== 'run' || !args.question || args.question === true) {
    console.error(cliUsage());
    process.exit(cmd ? 1 : 0);
  }

  const root = args.root ? resolve(args.root) : REPO_ROOT;
  // Con --root, las personas guardadas en ese proyecto se suman a la biblioteca.
  const personasDir = join(root, 'councils', 'personas');
  const personasMap = root === REPO_ROOT ? loadPersonas() : new Map([...loadPersonas(), ...loadPersonas({ dir: personasDir })]);
  const opts = {
    question: args.question,
    template: typeof args.template === 'string' ? args.template : undefined,
    personas: list(args.personas),
    crear: args.crear || [],
    personasMap,
    mode: typeof args.mode === 'string' ? args.mode : undefined,
    redteam: args.redteam ? true : undefined,
    files: list(args.files),
    context: typeof args.context === 'string' ? args.context : '',
    root,
  };

  const plan = resolveCouncilPlan(opts);
  const ctx = buildProjectContext({ root, files: opts.files, extra: opts.context });
  const est = estimateCouncilCost({ assignments: plan.assignments, mode: plan.mode, redteam: plan.redteam, contextChars: ctx.text.length });
  console.log(`Council ${plan.mode}${plan.redteam ? ' + red team' : ''}: ${plan.assignments.map(a => `${a.persona.name} (${a.model})`).join(', ')}`);
  console.log(`Integrador: ${est.synth_model}. Contexto: ${ctx.sources.map(s => s.path + (s.missing ? ' (no existe)' : '')).join(', ') || 'ninguno'}`);
  console.log(`Costo estimado: ~USD ${est.usd.toFixed(3)} · tiempo estimado: ${est.seconds[0]}-${est.seconds[1]} s`);
  if (plan.adhoc.length) {
    const ids = plan.adhoc.map(p => p.id).join(', ');
    console.log(args.guardar ? `Expertos creados (se guardan al terminar en councils/personas/): ${ids}` : `Expertos creados solo para esta corrida (no se guardan; agrega --guardar para conservarlos): ${ids}`);
  } else if (args.guardar) {
    console.log('--guardar: no hay expertos nuevos que guardar.');
  }
  if (args['dry-run']) return;

  const result = await invoke({
    ...opts,
    confirmCost: !!args.yes,
    onProgress: ev => {
      if (ev.type === 'persona_ok') console.error(`  ok   ${ev.persona}`);
      if (ev.type === 'persona_failed') console.error(`  FALLA ${ev.persona}: ${ev.error}`);
      if (ev.type === 'merge_ok') console.error('  fusión lista');
      if (ev.type === 'redteam_done') console.error(`  red team listo (parche: ${ev.patched ? 'sí' : 'no'})`);
    },
  });
  const { resultPath, reviewPath } = saveResult(result, { root });
  console.log(`\n${summaryLine(result)}`);
  console.log(`\n${buildTldr(result)}`);
  console.log(`\nResultado: ${relative(root, resultPath)}\nRevisión cockpit: ${relative(root, reviewPath)}`);
  // Al final a propósito: si falla el guardado, el council ya pagado queda intacto.
  if (args.guardar) {
    for (const p of plan.adhoc) {
      try {
        console.log(`Experto guardado: ${relative(root, savePersona(p, { dir: personasDir }))} (reutilízalo con --personas ${p.id})`);
      } catch (e) {
        console.error(`[council] No pude guardar ${p.id}: ${e.message}`);
      }
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch(e => {
    console.error(`[council] ${e.message}`);
    process.exit(1);
  });
}

export default { invoke, suggestTemplates, toCockpitReview, saveResult, loadPersonas, loadTemplates, CouncilError };
