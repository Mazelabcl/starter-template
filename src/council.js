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
//                           [--mode multimodel] [--files a.md,b.md] [--redteam]
//                           [--context "..."] [--yes] [--dry-run]

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
const TYPE_LABEL = { threat: 'amenaza', opportunity: 'oportunidad', idea: 'idea' };

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
    '  "integrated_proposal_md": "markdown, 150-350 words: the improved proposal with concrete steps. Tag each step with the voices that inspired it, e.g. [A] or [B,C].",',
    '  "contributions": [{"text": "one distinct point", "voice": "A" (or "A,C" if several voices saw it), "type": "threat|opportunity|idea", "adopted": true, "why": "why it was adopted or not"}],',
    '  "tensions": [{"between": ["A", "B"], "issue": "what they disagree on", "suggested_resolution": "how the proposal resolves it"}],',
    '  "recommendation": "1-3 sentences, concrete, never null",',
    '  "confidence": "alta|media|baja",',
    '  "what_would_change_it": "what new fact would change the recommendation"',
    '}',
    'Rules: deduplicate similar points into one contribution (list all voices that saw it). 6-16 contributions. Include every voice at least once.',
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
    return { id: `t${i + 1}`, between, between_names: between.map(nameOf), issue: named(t.issue), suggested_resolution: named(t.suggested_resolution) };
  });
  return {
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

export function resolveCouncilPlan({ template, personas: personaIds, mode, redteam, personasMap = loadPersonas(), templates } = {}) {
  let tpl = null;
  if (template) {
    tpl = (templates || loadTemplates({ personas: personasMap })).find(t => t.id === template);
    if (!tpl) throw new CouncilError(`Plantilla "${template}" no existe. Mira: node src/council.js list`, { code: 'template_not_found' });
  }
  const ids = personaIds && personaIds.length ? personaIds : tpl?.personas;
  if (!ids || ids.length < 2) throw new CouncilError('Hacen falta al menos 2 personas (usa --template o --personas a,b).', { code: 'invalid_personas' });
  if (ids.length > 6) throw new CouncilError('Máximo 6 personas por council.', { code: 'invalid_personas' });
  const missing = ids.filter(id => !personasMap.has(id));
  if (missing.length) throw new CouncilError(`Personas desconocidas: ${missing.join(', ')}`, { code: 'invalid_personas' });
  const finalMode = mode || tpl?.mode || 'personas';
  const assignments = assignModels(ids.map(id => personasMap.get(id)), finalMode);
  if (finalMode === 'multimodel') {
    const fams = new Set(assignments.map(a => a.family)).size;
    if (fams < Math.min(3, ids.length)) throw new CouncilError('multimodel necesita al menos 3 familias de modelos.', { code: 'invalid_mode' });
  }
  return { template: tpl, mode: finalMode, redteam: redteam ?? tpl?.redteam ?? false, assignments };
}

export async function invoke({
  question,
  template,
  personas: personaIds,
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
  const plan = resolveCouncilPlan({ template, personas: personaIds, mode, redteam, personasMap });
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
    const contrarian = personasMap.get('contrarian');
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

  const merge = reattribute(mergeAnon, map, personasMap);
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

// Contrato fijo del cockpit (Sprint 2): saveResult() lo publica con
// publishReview() de src/cockpit.js, que lo valida y lo escribe de forma atómica.
export function toCockpitReview(result) {
  const m = result.merge;
  const items = [{
    id: 'propuesta',
    title: 'Propuesta integrada',
    body_md: `${m.integrated_proposal_md}\n\n**Recomendación:** ${m.recommendation}\n\n**Confianza:** ${m.confidence}. **Cambiaría si:** ${m.what_would_change_it}`,
    media: [],
    tags: ['propuesta', `confianza-${m.confidence}`],
  }];
  for (const c of m.contributions) {
    const seen = c.also_seen_by.length ? ` (también lo vio: ${c.also_seen_by.join(', ')})` : '';
    items.push({
      id: c.id,
      title: `${c.persona_name}: ${TYPE_LABEL[c.type]}`,
      body_md: `${c.text}\n\n${c.adopted ? 'Adoptado' : 'No adoptado'} en la propuesta: ${c.why}${seen}`,
      media: [],
      tags: [c.persona, c.type, c.adopted ? 'adoptado' : 'no-adoptado', ...(c.source === 'redteam' ? ['redteam'] : [])],
    });
  }
  for (const t of m.tensions) {
    items.push({
      id: t.id,
      title: `Tensión: ${t.between_names.join(' vs ')}`,
      body_md: `${t.issue}\n\n**Resolución sugerida:** ${t.suggested_resolution}`,
      media: [],
      tags: ['tension', ...t.between],
    });
  }
  const who = result.personas.map(p => p.name).join(', ');
  const topTension = m.tensions[0] ? ` La tensión principal es entre ${m.tensions[0].between_names.join(' y ')}: ${m.tensions[0].issue}` : '';
  return {
    id: result.id,
    title: `Council: ${trunc(result.question, 90)}`,
    kind: 'council',
    created_at: result.created_at,
    connects_to: [`councils/results/${result.id}.json`, ...(result.template ? [`councils/templates/${result.template}.json`] : [])],
    context_brief:
      `Council de expertos (${result.mode}) sobre: "${result.question}". Participaron ${who}. ` +
      `Cada persona opinó por separado y luego se fusionó lo mejor de cada una. ` +
      `Recomendación: ${m.recommendation} (confianza ${m.confidence}).${topTension} ` +
      `Hay ${m.contributions.length} aportes atribuidos para votar con pulgar arriba o abajo; ` +
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
// CLI
// =============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
      else { args[a.slice(2)] = next; i += 1; }
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
    '  --personas a,b,c         personas a mano (reemplaza las de la plantilla)',
    '  --mode multimodel        modelos fuertes de >=3 familias (requiere --yes)',
    '  --files a.md,b.md        archivos extra de contexto',
    '  --context "..."          contexto extra en texto',
    '  --redteam                el contrarian ataca la propuesta y se parcha',
    '  --yes                    confirma el costo (obligatorio en multimodel o > USD 0.50)',
    '  --dry-run                solo muestra costo y tiempo estimados',
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
    return;
  }

  if (cmd !== 'run' || !args.question || args.question === true) {
    console.error(cliUsage());
    process.exit(cmd ? 1 : 0);
  }

  const root = args.root ? resolve(args.root) : REPO_ROOT;
  const opts = {
    question: args.question,
    template: typeof args.template === 'string' ? args.template : undefined,
    personas: list(args.personas),
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
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch(e => {
    console.error(`[council] ${e.message}`);
    process.exit(1);
  });
}

export default { invoke, suggestTemplates, toCockpitReview, saveResult, loadPersonas, loadTemplates, CouncilError };
