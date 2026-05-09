// src/council.js
// Motor de councils multi-modelo. Orquesta personas con perspectivas distintas
// que debaten una pregunta y producen una síntesis estructurada.
//
// Diseño:
//  - Reusa src/openrouter_client.js (chat, chatBatch, estimateCost). Cero deps nuevas.
//  - Carga config desde councils/<name>.json o inline. Valida con AJV contra
//    councils/templates/council.schema.json.
//  - Tiers (1/2/3) controlan qué rondas corren y si hay confidence loop final.
//  - Tools de personas (perplexity_research, image_reference, code_simulation) se
//    enchufan SOLO si la persona las declara en su config.
//  - Cross-pollination en Ronda 2: cada persona ve transcripciones LITERALES de
//    las OTRAS personas (sin la propia, sin moderador, sin notas inventadas).
//  - Síntesis: una llamada extra a un "moderador" con TODAS las respuestas. La
//    salida es JSON estructurado (consensus, tensions, options, recommendation,
//    requires_human_decision) — eso es lo que hace al council útil vs prosa libre.
//  - Si una persona falla con retry, el council continúa con N-1 personas y marca
//    `partial: true` en metadata. Council con menos de 2 personas vivas falla
//    porque sin 2 voces no hay debate.
//  - Eventos al dashboard vía scripts/update_state.js (best-effort, no bloquean).
//  - Decisiones con `recommendation` no nulo y `requires_human_decision: false`
//    se persisten automáticamente en memory.addDecision().
//
// CLI:
//   node src/council.js --council <name> --question "..." [--tier N]
//                        [--context "..."] [--output result.json]
//                        [--confirm-expensive] [--memory-dir <path>]

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { chat, chatBatch, estimateCost, OpenRouterError, MODELS } from './openrouter_client.js';
import { addDecision } from './memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const COUNCILS_DIR = join(REPO_ROOT, 'councils');
const SCHEMA_PATH = join(COUNCILS_DIR, 'templates', 'council.schema.json');
const UPDATE_STATE_SCRIPT = join(REPO_ROOT, 'scripts', 'update_state.js');

const TIER_TIMEOUTS_MS = { 1: 5 * 60_000, 2: 10 * 60_000, 3: 20 * 60_000 };
const COST_CONFIRMATION_THRESHOLD_USD = 5;
const DEFAULT_SYNTHESIS_MODEL = 'anthropic/claude-opus-4.5';

// =============================================================================
// CouncilError
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
// AJV setup
// =============================================================================

let _ajv = null;
function getAjv() {
  if (_ajv) return _ajv;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  if (existsSync(SCHEMA_PATH)) {
    const raw = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    ajv.addSchema(raw, 'council-config');
  }
  _ajv = ajv;
  return ajv;
}

function humanizeAjvError(err) {
  const where = err.instancePath || '(root)';
  switch (err.keyword) {
    case 'required':
      return `falta el campo requerido "${err.params.missingProperty}" en ${where}`;
    case 'minItems':
      return `el array en ${where} debe tener al menos ${err.params.limit} elementos`;
    case 'maxItems':
      return `el array en ${where} no puede tener más de ${err.params.limit} elementos`;
    case 'enum':
      return `valor inválido en ${where}: se esperaba uno de [${err.params.allowedValues.join(', ')}]`;
    case 'pattern':
      return `formato inválido en ${where}: no coincide con el patrón`;
    case 'type':
      return `tipo incorrecto en ${where}: se esperaba ${err.params.type}`;
    case 'additionalProperties':
      return `campo no permitido "${err.params.additionalProperty}" en ${where}`;
    case 'minLength':
      return `string en ${where} demasiado corto (mínimo ${err.params.limit})`;
    default:
      return `${err.keyword} falló en ${where}: ${err.message}`;
  }
}

// =============================================================================
// loadCouncilConfig — carga + valida
// =============================================================================

export function loadCouncilConfig({ councilConfig, councilName, councilsDir = COUNCILS_DIR } = {}) {
  let config;
  let source;

  if (councilConfig && typeof councilConfig === 'object') {
    config = councilConfig;
    source = '<inline>';
  } else if (typeof councilName === 'string' && councilName.length > 0) {
    const path = join(councilsDir, `${councilName}.json`);
    if (!existsSync(path)) {
      throw new CouncilError(
        `Council "${councilName}" no encontrado en ${path}. ¿Existe el archivo? ¿Está en councils/?`,
        { code: 'council_not_found', details: { path } },
      );
    }
    try {
      config = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new CouncilError(
        `Council "${councilName}" tiene JSON inválido: ${e.message}`,
        { code: 'invalid_json', details: { path } },
      );
    }
    source = path;
  } else {
    throw new CouncilError(
      'loadCouncilConfig requiere councilConfig (objeto) o councilName (string).',
      { code: 'invalid_input' },
    );
  }

  // Validación AJV
  const ajv = getAjv();
  const validate = ajv.getSchema('council-config');
  if (!validate) {
    throw new CouncilError(
      `Schema council-config no cargado. Verifica que ${SCHEMA_PATH} exista.`,
      { code: 'schema_missing' },
    );
  }
  const ok = validate(config);
  if (!ok) {
    const lines = validate.errors.map(e => `  - ${humanizeAjvError(e)}`).join('\n');
    throw new CouncilError(
      `Council "${config.name || source}" inválido:\n${lines}`,
      { code: 'invalid_config', details: { errors: validate.errors, source } },
    );
  }

  // Validación semántica adicional: IDs de personas únicos
  const ids = new Set();
  for (const p of config.personas) {
    if (ids.has(p.id)) {
      throw new CouncilError(
        `IDs de persona duplicados en council "${config.name}": "${p.id}".`,
        { code: 'duplicate_persona_id' },
      );
    }
    ids.add(p.id);
  }

  return config;
}

// =============================================================================
// estimateCouncilCost — costo total estimado de invocar un council
// =============================================================================

const TOKENS_BUDGET_PER_PERSONA = {
  // Estimación gruesa para presupuestar antes de invocar. Si el caller pasa
  // overrides (max_tokens en personas), respetamos esos.
  round1_input: 800,
  round1_output: 700,
  round2_input: 2000,  // round2 ve outputs de los demás
  round2_output: 700,
  synthesis_input_per_persona: 900,
  synthesis_output: 1500,
};

export function estimateCouncilCost(config, { tier } = {}) {
  const t = tier || config.tier_default || detectTierFromConfig(config);
  const personas = config.personas || [];
  const round1On = config.rounds?.round1?.enabled !== false;
  const round2On = (config.rounds?.round2?.enabled === true) && t >= 2;
  const synthOn = personas.length > 0;
  const synthModel = config.rounds?.synthesis?.model || DEFAULT_SYNTHESIS_MODEL;

  let total = 0;
  for (const p of personas) {
    if (round1On) {
      total += estimateCost({
        model: p.model,
        input_tokens: TOKENS_BUDGET_PER_PERSONA.round1_input,
        output_tokens: p.max_tokens || TOKENS_BUDGET_PER_PERSONA.round1_output,
      });
    }
    if (round2On) {
      total += estimateCost({
        model: p.model,
        input_tokens: TOKENS_BUDGET_PER_PERSONA.round2_input,
        output_tokens: p.max_tokens || TOKENS_BUDGET_PER_PERSONA.round2_output,
      });
    }
  }
  if (synthOn) {
    total += estimateCost({
      model: synthModel,
      input_tokens: TOKENS_BUDGET_PER_PERSONA.synthesis_input_per_persona * personas.length * (round2On ? 2 : 1),
      output_tokens: TOKENS_BUDGET_PER_PERSONA.synthesis_output,
    });
  }
  // Confidence loop estimado: hasta 3 iteraciones extra de síntesis
  if (t === 3 && config.post_synthesis?.confidence_loop) {
    total += estimateCost({
      model: synthModel,
      input_tokens: 2500,
      output_tokens: 1500,
    }) * 3;
  }
  return total;
}

function detectTierFromConfig(config) {
  if (config.tier_default) return config.tier_default;
  if (config.post_synthesis?.confidence_loop) return 3;
  if (config.rounds?.round2?.enabled) return 2;
  return 1;
}

// =============================================================================
// Tools — definiciones JSON Schema
// =============================================================================
// Estas son las tools que las personas pueden invocar. Solo se exponen si la
// persona las declara en su config (cero inflación de prompt si no las usa).

const TOOL_DEFINITIONS = {
  perplexity_research: {
    type: 'function',
    function: {
      name: 'perplexity_research',
      description: 'Busca información actualizada en internet con citas. Úsalo cuando necesites datos que no están en tu training (precios, eventos recientes, tendencias).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Pregunta de búsqueda en lenguaje natural.' },
          depth: { type: 'string', enum: ['quick', 'pro'], description: 'quick = rápido, pro = más completo (default: quick).' },
        },
        required: ['query'],
      },
    },
  },
  image_reference: {
    type: 'function',
    function: {
      name: 'image_reference',
      description: 'Registra una imagen que querrías ver para apoyar tu argumento. NO genera la imagen — solo describe qué imagen sería útil. Útil para councils de diseño/branding.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Qué imagen sería útil ver.' },
          why: { type: 'string', description: 'Por qué es relevante para tu argumento.' },
        },
        required: ['description'],
      },
    },
  },
  code_simulation: {
    type: 'function',
    function: {
      name: 'code_simulation',
      description: 'Simula la ejecución mental de un snippet de código. NO ejecuta código real — pide al moderador que razone qué pasaría. Útil para councils de arquitectura.',
      parameters: {
        type: 'object',
        properties: {
          snippet: { type: 'string', description: 'El código a simular.' },
          language: { type: 'string', description: 'Lenguaje (js, python, ts, etc.)' },
          question: { type: 'string', description: '¿Qué quieres saber del comportamiento?' },
        },
        required: ['snippet', 'question'],
      },
    },
  },
};

function buildToolsForPersona(persona) {
  const declared = Array.isArray(persona.tools) ? persona.tools : [];
  if (declared.length === 0) return undefined;
  const tools = [];
  for (const name of declared) {
    if (TOOL_DEFINITIONS[name]) tools.push(TOOL_DEFINITIONS[name]);
  }
  return tools.length > 0 ? tools : undefined;
}

// =============================================================================
// Ejecución de tool calls
// =============================================================================

async function executeToolCall(tc, persona) {
  let args;
  try {
    args = JSON.parse(tc.function.arguments || '{}');
  } catch {
    return { ok: false, error: `arguments no parsean: ${tc.function.arguments}` };
  }
  const name = tc.function.name;

  if (name === 'perplexity_research') {
    try {
      // Import diferido: research.js carga dotenv y valida key al importar.
      // Si no hay key, no rompemos el council — devolvemos error como tool result.
      const { research } = await import('./research.js');
      const depth = args.depth === 'pro' ? 'pro' : 'quick';
      const r = await research(depth, args.query);
      return {
        ok: true,
        result: {
          content: r.content,
          citations: r.citations,
          model: r.model,
        },
      };
    } catch (e) {
      return { ok: false, error: `research falló: ${e.message}` };
    }
  }

  if (name === 'image_reference') {
    // No genera; solo registra. La persona la verá referenciada en su segunda iteración.
    return {
      ok: true,
      result: {
        registered: true,
        description: args.description,
        why: args.why || null,
        nota: 'Imagen registrada en la respuesta. Sprint 5.1 generará realmente.',
      },
    };
  }

  if (name === 'code_simulation') {
    // Simulación con otro modelo barato (haiku) que razona qué haría el snippet.
    try {
      const sim = await chat({
        model: MODELS.anthropic.haiku,
        system: 'Eres un simulador de ejecución mental. Lee el código, razona paso a paso qué haría, y reporta el resultado esperado o errores. NO ejecutas código real, solo simulas.',
        messages: [{
          role: 'user',
          content: `Lenguaje: ${args.language || 'desconocido'}\nPregunta: ${args.question}\n\nCódigo:\n\`\`\`\n${args.snippet}\n\`\`\``,
        }],
        max_tokens: 600,
        temperature: 0.2,
      });
      return { ok: true, result: { simulation: sim.content } };
    } catch (e) {
      return { ok: false, error: `simulación falló: ${e.message}` };
    }
  }

  return { ok: false, error: `tool desconocida: ${name}` };
}

// =============================================================================
// chatPersonaWithTools — llama a una persona con loop de tool use
// =============================================================================
// Si la persona invoca tools, ejecutamos, devolvemos resultados, y reentramos
// hasta MAX_TOOL_HOPS o hasta que devuelva contenido sin tool_calls.

const MAX_TOOL_HOPS = 3;

async function chatPersonaWithTools({ persona, system, userContent, timeout_ms }) {
  const tools = buildToolsForPersona(persona);
  const messages = [{ role: 'user', content: userContent }];
  let finalResponse = null;
  const toolUses = [];
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, cost_usd_estimated: 0 };

  for (let hop = 0; hop < MAX_TOOL_HOPS + 1; hop += 1) {
    const r = await chat({
      model: persona.model,
      system,
      messages,
      tools,
      temperature: persona.temperature,
      max_tokens: persona.max_tokens,
      timeout_ms,
    });
    totalUsage.prompt_tokens += r.usage?.prompt_tokens || 0;
    totalUsage.completion_tokens += r.usage?.completion_tokens || 0;
    totalUsage.cost_usd_estimated += r.usage?.cost_usd_estimated || 0;

    const calls = Array.isArray(r.tool_calls) ? r.tool_calls : [];
    if (calls.length === 0 || hop === MAX_TOOL_HOPS) {
      finalResponse = r;
      break;
    }

    // Agregamos el assistant message con tool_calls al historial y los tool results.
    messages.push({
      role: 'assistant',
      content: r.content || '',
      tool_calls: calls,
    });
    for (const tc of calls) {
      const exec = await executeToolCall(tc, persona);
      toolUses.push({ tool: tc.function.name, ok: exec.ok, error: exec.error || null });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(exec.ok ? exec.result : { error: exec.error }),
      });
    }
  }

  return {
    content: finalResponse?.content || '',
    tool_calls: toolUses.length > 0 ? toolUses : undefined,
    usage: totalUsage,
    model_used: finalResponse?.model_used || persona.model,
  };
}

// =============================================================================
// Briefing y prompts
// =============================================================================

function buildBriefing({ question, context, councilName, tier }) {
  const lines = [
    `# Pregunta del council`,
    '',
    question,
    '',
  ];
  if (context && typeof context === 'string' && context.trim()) {
    lines.push('# Contexto adicional', '', context.trim(), '');
  }
  lines.push(
    `# Reglas del council`,
    '',
    `- Council: ${councilName} (tier ${tier})`,
    `- Tu rol está definido en tu system prompt — respétalo, no salgas de personaje.`,
    `- Idioma: español neutro estricto. Sin voseo, sin regionalismos rioplatenses.`,
    `- Si no sabes algo, dilo. No inventes datos.`,
    `- Sé específico: prefiere ejemplos concretos sobre abstracciones vagas.`,
  );
  return lines.join('\n');
}

function buildRound1Prompt({ briefing, rounds }) {
  const instr = rounds?.round1?.instructions ||
    'Da tu opinión inicial sobre la pregunta. Responde como tu personaje, ' +
    'desde tu perspectiva única. Estructura: (1) tu posición en una frase, ' +
    '(2) 2-3 argumentos clave, (3) qué riesgo o tradeoff ves que otros podrían ignorar.';
  return `${briefing}\n\n# Tu turno (Ronda 1 — opinión inicial)\n\n${instr}`;
}

function buildRound2Prompt({ briefing, rounds, otherResponses, myId }) {
  const instr = rounds?.round2?.instructions ||
    'Lee las opiniones de las otras personas. Reacciona: (1) ¿con quién coincides ' +
    'y por qué?, (2) ¿con quién discrepas y por qué?, (3) ¿hay algún punto que nadie ' +
    'mencionó y que crees crítico? Mantén tu personaje.';
  const transcripts = otherResponses
    .filter(r => r.persona_id !== myId && r.content)
    .map(r => `## ${r.persona_id}\n\n${r.content.trim()}`)
    .join('\n\n---\n\n');
  return [
    briefing,
    '',
    '# Lo que dijeron las otras personas en Ronda 1',
    '',
    transcripts || '(sin respuestas de otras personas — eres la única voz viva)',
    '',
    `# Tu turno (Ronda 2 — cross-pollination)`,
    '',
    instr,
  ].join('\n');
}

function buildSynthesisPrompt({ briefing, round1, round2, councilName }) {
  const r1 = round1
    .map(r => `## ${r.persona_id} (Ronda 1)\n\n${(r.content || '').trim()}`)
    .join('\n\n---\n\n');
  const r2 = round2 && round2.length > 0
    ? round2.map(r => `## ${r.persona_id} (Ronda 2)\n\n${(r.content || '').trim()}`)
        .join('\n\n---\n\n')
    : '(no hubo Ronda 2)';

  return [
    `Eres el moderador de un council multi-modelo llamado "${councilName}".`,
    'Tu trabajo es producir una síntesis estructurada de lo que dijeron las personas.',
    'NO opines tú. NO mezcles tu juicio. Solo destila lo que dijeron, identifica acuerdos,',
    'tensiones reales (no aparentes), opciones concretas con tradeoffs, y si hay UNA',
    'recomendación clara o si requiere decisión humana.',
    '',
    briefing,
    '',
    '# Ronda 1',
    '',
    r1,
    '',
    '# Ronda 2',
    '',
    r2,
    '',
    '# Tu output (solo JSON, sin markdown ni texto extra)',
    '',
    'Devuelve EXACTAMENTE un objeto JSON con este shape:',
    '',
    '{',
    '  "consensus_areas": ["áreas donde todas las personas coincidieron, en frases cortas"],',
    '  "tensions": [{"topic": "string", "positions": [{"persona_id": "string", "stance": "string"}]}],',
    '  "options": [{"title": "string", "description": "string", "tradeoffs": "string", "supporting_personas": ["persona_id"]}],',
    '  "recommendation": "string o null si no hay clara",',
    '  "requires_human_decision": true|false,',
    '  "rationale": "string explicando por qué esta síntesis (1-3 frases)"',
    '}',
    '',
    'Reglas:',
    '- Si hay tensiones reales no resueltas, requires_human_decision = true y recommendation = null.',
    '- Si todas convergieron en una opción, recommendation = esa opción y requires_human_decision = false.',
    '- "tensions" SOLO si hay desacuerdo real (no diferencias de tono).',
    '- Devuelve JSON puro, sin ```json ni texto antes/después.',
  ].join('\n');
}

// =============================================================================
// parseSynthesisJson — robusto a wrappers ```json
// =============================================================================

function parseSynthesisJson(content) {
  if (!content || typeof content !== 'string') {
    throw new CouncilError('Síntesis vacía del moderador.', { code: 'empty_synthesis' });
  }
  let text = content.trim();
  // Limpia fences markdown si el modelo los puso a pesar de las instrucciones.
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();
  // Algunos modelos prependen "Aquí está el JSON:" — buscamos primer { y último }.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CouncilError(
      `Síntesis del moderador no es JSON válido: ${e.message}. Inicio: ${text.slice(0, 200)}`,
      { code: 'invalid_synthesis_json', details: { raw: content } },
    );
  }

  // Normalización defensiva (el modelo puede omitir campos).
  return {
    consensus_areas: Array.isArray(parsed.consensus_areas) ? parsed.consensus_areas : [],
    tensions: Array.isArray(parsed.tensions) ? parsed.tensions : [],
    options: Array.isArray(parsed.options) ? parsed.options : [],
    recommendation: typeof parsed.recommendation === 'string' && parsed.recommendation.trim()
      ? parsed.recommendation.trim() : null,
    requires_human_decision: parsed.requires_human_decision !== false, // default true (conservador)
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
  };
}

// =============================================================================
// Eventos al dashboard
// =============================================================================

function emitEvent(type, payload, onProgress) {
  // Callback in-process
  try {
    if (typeof onProgress === 'function') {
      onProgress({ type, payload, timestamp: new Date().toISOString() });
    }
  } catch { /* el callback no debe romper el council */ }

  // Spawn de scripts/update_state.js best-effort. No bloqueamos.
  if (!existsSync(UPDATE_STATE_SCRIPT)) return;
  try {
    const child = spawn(
      process.execPath,
      [UPDATE_STATE_SCRIPT, 'event', type, JSON.stringify(payload || {})],
      { stdio: 'ignore', detached: false },
    );
    child.on('error', () => { /* silenciamos: el state.json se escribirá igual */ });
    if (child.unref) child.unref();
  } catch { /* sin dashboard, no fatal */ }
}

// =============================================================================
// Reintento de personas
// =============================================================================

async function callPersonaWithRetry({ persona, system, userContent, timeout_ms, label }) {
  const attempts = 2;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await chatPersonaWithTools({ persona, system, userContent, timeout_ms });
      return { ok: true, response: r };
    } catch (e) {
      lastErr = e;
      // Solo retry en errores transitorios. tools_not_supported, no_api_key, etc. no.
      if (e instanceof OpenRouterError) {
        if (['unauthorized', 'tools_not_supported', 'no_api_key', 'invalid_messages', 'invalid_model_arg'].includes(e.code)) {
          break;
        }
      }
    }
  }
  return { ok: false, error: lastErr, label };
}

// =============================================================================
// invoke() — entrypoint principal
// =============================================================================

export async function invoke({
  councilConfig,
  councilName,
  question,
  context,
  tier,
  onProgress,
  confirmExpensive = false,
  memoryDir,
  councilsDir,
  parallelism = 5,
} = {}) {
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new CouncilError('council.invoke requiere `question` (string no vacío).', { code: 'invalid_question' });
  }

  const t0 = Date.now();

  // ---- 1. Cargar y validar config
  const config = loadCouncilConfig({ councilConfig, councilName, councilsDir });
  const tierUsed = tier || config.tier_default || detectTierFromConfig(config);
  if (![1, 2, 3].includes(tierUsed)) {
    throw new CouncilError(`Tier inválido: ${tierUsed}. Debe ser 1, 2 o 3.`, { code: 'invalid_tier' });
  }
  const timeoutMs = TIER_TIMEOUTS_MS[tierUsed];

  // ---- 2. Cost gate
  const estCost = estimateCouncilCost(config, { tier: tierUsed });
  if (estCost > COST_CONFIRMATION_THRESHOLD_USD && !confirmExpensive) {
    throw new CouncilError(
      `Council "${config.name}" tier ${tierUsed} estimado en ~$${estCost.toFixed(2)} USD ` +
      `(supera $${COST_CONFIRMATION_THRESHOLD_USD}). Pasa { confirmExpensive: true } si lo aceptas.`,
      { code: 'cost_confirmation_required', details: { estimated_cost_usd: estCost } },
    );
  }

  // ---- 3. Briefing
  const briefing = buildBriefing({
    question,
    context,
    councilName: config.name,
    tier: tierUsed,
  });

  emitEvent('council_invoked', {
    name: config.name,
    tier: tierUsed,
    question,
    estimated_cost_usd: Number(estCost.toFixed(4)),
    personas: config.personas.map(p => p.id),
  }, onProgress);

  // ---- 4. Ronda 1
  emitEvent('council_round_started', { name: config.name, round: 1 }, onProgress);

  const round1Prompt = buildRound1Prompt({ briefing, rounds: config.rounds });

  // chatBatch maneja paralelismo, pero queremos retry por persona y agregar tool_calls,
  // así que disparamos cada persona con su propio retry y las corremos en paralelo manualmente.
  const round1Results = await runPersonasInParallel({
    personas: config.personas,
    onPersona: (persona) => callPersonaWithRetry({
      persona,
      system: persona.actua_como,
      userContent: round1Prompt,
      timeout_ms: timeoutMs,
      label: `${persona.id}/round1`,
    }),
    parallelism,
  });

  for (let i = 0; i < round1Results.length; i += 1) {
    const persona = config.personas[i];
    const r = round1Results[i];
    if (r.ok) {
      emitEvent('council_persona_responded', {
        name: config.name,
        round: 1,
        persona_id: persona.id,
        tokens: r.response.usage.prompt_tokens + r.response.usage.completion_tokens,
        cost_usd: Number((r.response.usage.cost_usd_estimated || 0).toFixed(4)),
      }, onProgress);
    } else {
      emitEvent('council_persona_failed', {
        name: config.name,
        round: 1,
        persona_id: persona.id,
        error: r.error?.message || 'desconocido',
      }, onProgress);
    }
  }

  const round1Responses = [];
  const personasAlive = [];
  for (let i = 0; i < config.personas.length; i += 1) {
    const persona = config.personas[i];
    const r = round1Results[i];
    if (r.ok) {
      round1Responses.push({
        persona_id: persona.id,
        content: r.response.content,
        tool_calls: r.response.tool_calls,
        usage: r.response.usage,
        model_used: r.response.model_used,
      });
      personasAlive.push(persona);
    }
  }

  if (personasAlive.length < 2) {
    throw new CouncilError(
      `Council "${config.name}" no puede continuar: menos de 2 personas vivas en Ronda 1 ` +
      `(${personasAlive.length}/${config.personas.length}). Sin debate no hay council.`,
      { code: 'insufficient_personas', details: { round1Results } },
    );
  }

  const partial = personasAlive.length < config.personas.length;

  // ---- 5. Ronda 2 (si tier >= 2 y enabled)
  let round2Responses = null;
  const round2Enabled = (config.rounds?.round2?.enabled === true) && tierUsed >= 2;
  if (round2Enabled) {
    emitEvent('council_round_started', { name: config.name, round: 2 }, onProgress);

    const round2Results = await runPersonasInParallel({
      personas: personasAlive,
      onPersona: (persona) => callPersonaWithRetry({
        persona,
        system: persona.actua_como,
        userContent: buildRound2Prompt({
          briefing,
          rounds: config.rounds,
          otherResponses: round1Responses,
          myId: persona.id,
        }),
        timeout_ms: timeoutMs,
        label: `${persona.id}/round2`,
      }),
      parallelism,
    });

    round2Responses = [];
    for (let i = 0; i < personasAlive.length; i += 1) {
      const persona = personasAlive[i];
      const r = round2Results[i];
      if (r.ok) {
        round2Responses.push({
          persona_id: persona.id,
          content: r.response.content,
          tool_calls: r.response.tool_calls,
          usage: r.response.usage,
          model_used: r.response.model_used,
        });
        emitEvent('council_persona_responded', {
          name: config.name,
          round: 2,
          persona_id: persona.id,
          tokens: r.response.usage.prompt_tokens + r.response.usage.completion_tokens,
          cost_usd: Number((r.response.usage.cost_usd_estimated || 0).toFixed(4)),
        }, onProgress);
      } else {
        emitEvent('council_persona_failed', {
          name: config.name,
          round: 2,
          persona_id: persona.id,
          error: r.error?.message || 'desconocido',
        }, onProgress);
      }
    }
  }

  // ---- 6. Síntesis
  const synthesisModel = config.rounds?.synthesis?.model || DEFAULT_SYNTHESIS_MODEL;
  const synthesisInstructions = config.rounds?.synthesis?.instructions; // opcional, no usado por defecto
  const synthesisPrompt = buildSynthesisPrompt({
    briefing,
    round1: round1Responses,
    round2: round2Responses,
    councilName: config.name,
  });

  let synthesisResponse;
  try {
    synthesisResponse = await chat({
      model: synthesisModel,
      system: synthesisInstructions || 'Eres un moderador objetivo. Sintetizas debates en JSON estructurado.',
      messages: [{ role: 'user', content: synthesisPrompt }],
      max_tokens: config.rounds?.synthesis?.max_tokens || 2500,
      temperature: typeof config.rounds?.synthesis?.temperature === 'number' ? config.rounds.synthesis.temperature : 0.3,
      timeout_ms: timeoutMs,
    });
  } catch (e) {
    throw new CouncilError(
      `Síntesis del moderador falló: ${e.message}. Las respuestas crudas de personas están disponibles.`,
      { code: 'synthesis_failed', details: { round1: round1Responses, round2: round2Responses } },
    );
  }

  let synthesis;
  try {
    synthesis = parseSynthesisJson(synthesisResponse.content);
  } catch (e) {
    throw new CouncilError(
      `Síntesis no parsea: ${e.message}`,
      { code: 'invalid_synthesis_json', details: { raw_synthesis: synthesisResponse.content } },
    );
  }

  // ---- 7. Confidence loop (Tier 3 opcional)
  let confidenceScore = null;
  let loopIterations = 0;
  if (tierUsed === 3 && config.post_synthesis?.confidence_loop) {
    const targetScore = config.post_synthesis.target_score || 95;
    const maxIter = config.post_synthesis.max_loop_iterations || 3;
    const looped = await runConfidenceLoop({
      synthesis,
      synthesisModel,
      briefing,
      round1: round1Responses,
      round2: round2Responses,
      targetScore,
      maxIter,
      timeoutMs,
      onProgress,
      councilName: config.name,
    });
    synthesis = looped.synthesis;
    confidenceScore = looped.score;
    loopIterations = looped.iterations;
  }

  emitEvent('council_synthesis_done', {
    name: config.name,
    tier: tierUsed,
    has_recommendation: synthesis.recommendation !== null,
    requires_human_decision: synthesis.requires_human_decision,
    confidence_score: confidenceScore,
  }, onProgress);

  // ---- 8. Métricas
  const totalUsage = sumUsage([
    ...round1Responses.map(r => r.usage),
    ...(round2Responses || []).map(r => r.usage),
    synthesisResponse.usage,
  ]);
  const duration_seconds = Number(((Date.now() - t0) / 1000).toFixed(2));

  // ---- 9. Persistencia automática a memoria si la decisión es firme
  let decisionPersisted = false;
  if (!synthesis.requires_human_decision && synthesis.recommendation) {
    try {
      addDecision({
        title: `Council ${config.name}: ${question.slice(0, 80)}`,
        decision: synthesis.recommendation,
        reasoning: synthesis.rationale || `Síntesis de council ${config.name} (tier ${tierUsed}) con ${personasAlive.length} personas vivas.`,
        alternatives: synthesis.options.map(o => o.title).join('; ') || 'no documentadas',
        reversibility: 'media',
      }, memoryDir);
      decisionPersisted = true;
    } catch {
      // memory.addDecision es best-effort. Si falla, el council igual retorna su resultado.
    }
  }

  return {
    council_name: config.name,
    tier_used: tierUsed,
    question,
    context: context || null,
    personas_responses: {
      round1: round1Responses,
      round2: round2Responses,
    },
    synthesis,
    metadata: {
      total_tokens: totalUsage.prompt_tokens + totalUsage.completion_tokens,
      prompt_tokens: totalUsage.prompt_tokens,
      completion_tokens: totalUsage.completion_tokens,
      total_cost_usd: Number(totalUsage.cost_usd_estimated.toFixed(4)),
      estimated_cost_usd: Number(estCost.toFixed(4)),
      duration_seconds,
      personas_total: config.personas.length,
      personas_alive: personasAlive.length,
      partial,
      synthesis_model: synthesisModel,
      confidence_score: confidenceScore,
      confidence_loop_iterations: loopIterations,
      decision_persisted: decisionPersisted,
    },
  };
}

function sumUsage(usages) {
  let p = 0, c = 0, cost = 0;
  for (const u of usages) {
    if (!u) continue;
    p += u.prompt_tokens || 0;
    c += u.completion_tokens || 0;
    cost += u.cost_usd_estimated || 0;
  }
  return { prompt_tokens: p, completion_tokens: c, cost_usd_estimated: cost };
}

// =============================================================================
// runPersonasInParallel — wrapper de paralelismo manual con retry por persona
// =============================================================================

async function runPersonasInParallel({ personas, onPersona, parallelism }) {
  const results = new Array(personas.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= personas.length) return;
      try {
        results[i] = await onPersona(personas[i]);
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(parallelism, personas.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// =============================================================================
// runConfidenceLoop — itera la síntesis hasta target_score o max
// =============================================================================

async function runConfidenceLoop({
  synthesis,
  synthesisModel,
  briefing,
  round1,
  round2,
  targetScore,
  maxIter,
  timeoutMs,
  onProgress,
  councilName,
}) {
  let current = synthesis;
  let score = null;
  let iter = 0;

  while (iter < maxIter) {
    iter += 1;
    // 1. Score la síntesis actual
    const judgePrompt = [
      'Eres un evaluador objetivo de síntesis de councils. Lee la pregunta original,',
      'las respuestas de las personas, y la síntesis. Evalúa la síntesis del 0 al 100',
      'en estos criterios:',
      '- Fidelidad: ¿refleja con precisión lo que dijeron las personas?',
      '- Estructura: ¿identifica consensus/tensions/options reales?',
      '- Accionabilidad: ¿la recomendación o el "requires_human_decision" es claro?',
      '- Concisión: ¿sin relleno, denso, útil?',
      '',
      briefing,
      '',
      '# Síntesis a evaluar',
      '',
      JSON.stringify(current, null, 2),
      '',
      'Devuelve SOLO un JSON con shape: {"score": 0-100, "weakness": "string explicando qué falta para llegar a 95+ o vacío si ya está"}',
    ].join('\n');

    let judgeR;
    try {
      judgeR = await chat({
        model: synthesisModel,
        system: 'Eres un juez de síntesis de councils. Devuelves JSON puro.',
        messages: [{ role: 'user', content: judgePrompt }],
        max_tokens: 500,
        temperature: 0.1,
        timeout_ms: timeoutMs,
      });
    } catch {
      break; // Si el juez falla, devolvemos la síntesis actual sin score.
    }

    let judged;
    try {
      const text = judgeR.content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      judged = JSON.parse(text.slice(start, end + 1));
    } catch {
      break;
    }
    score = typeof judged.score === 'number' ? judged.score : null;

    emitEvent('council_confidence_iter', {
      name: councilName,
      iteration: iter,
      score,
      weakness: judged.weakness || null,
    }, onProgress);

    if (score === null || score >= targetScore) break;
    if (!judged.weakness) break;

    // 2. Reescribir síntesis abordando la debilidad
    const reviseR = await chat({
      model: synthesisModel,
      system: 'Eres un moderador que mejora síntesis de councils. Devuelves JSON puro con el mismo shape.',
      messages: [{
        role: 'user',
        content: [
          'La síntesis actual obtuvo score ' + score + '/100. Debilidad detectada:',
          judged.weakness,
          '',
          'Pregunta original y debate:',
          briefing,
          '',
          '# Round 1',
          round1.map(r => `## ${r.persona_id}\n${r.content || ''}`).join('\n\n---\n\n'),
          round2 ? '\n# Round 2\n' + round2.map(r => `## ${r.persona_id}\n${r.content || ''}`).join('\n\n---\n\n') : '',
          '',
          '# Síntesis a mejorar',
          JSON.stringify(current, null, 2),
          '',
          'Devuelve SOLO el JSON mejorado, mismo shape: {consensus_areas, tensions, options, recommendation, requires_human_decision, rationale}.',
        ].join('\n'),
      }],
      max_tokens: 2500,
      temperature: 0.3,
      timeout_ms: timeoutMs,
    });
    try {
      current = parseSynthesisJson(reviseR.content);
    } catch {
      break; // si el revisor rompió el JSON, salimos con la última válida.
    }
  }

  return { synthesis: current, score, iterations: iter };
}

// =============================================================================
// CLI
// =============================================================================

function parseCliArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function cliUsage() {
  return [
    'Uso: node src/council.js --council <name> --question "..." [opciones]',
    '',
    'Opciones:',
    '  --council <name>            Nombre del council (busca councils/<name>.json)',
    '  --config <path>             Path a un council config inline (alternativa a --council)',
    '  --question "..."            Pregunta a debatir (requerido)',
    '  --context "..."             Contexto adicional opcional',
    '  --tier <1|2|3>              Override del tier_default del config',
    '  --output <path>             Guarda el resultado JSON en path',
    '  --confirm-expensive         Acepta councils con costo estimado > $5',
    '  --memory-dir <path>         Path al directorio de memoria del proyecto',
    '  --silent                    Sin logs intermedios',
  ].join('\n');
}

async function runCli() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || args.h || (!args.council && !args.config) || !args.question) {
    console.error(cliUsage());
    process.exit(args.help ? 0 : 1);
  }

  let councilConfig;
  if (args.config) {
    const p = isAbsolute(args.config) ? args.config : resolve(process.cwd(), args.config);
    if (!existsSync(p)) {
      console.error(`Config no encontrada: ${p}`);
      process.exit(1);
    }
    try {
      councilConfig = JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      console.error(`Config no es JSON válido: ${e.message}`);
      process.exit(1);
    }
  }

  const tier = args.tier ? parseInt(args.tier, 10) : undefined;
  if (args.tier && ![1, 2, 3].includes(tier)) {
    console.error(`--tier debe ser 1, 2 o 3, recibí: ${args.tier}`);
    process.exit(1);
  }

  const silent = !!args.silent;
  const log = silent ? () => {} : (msg) => console.error(msg);

  const onProgress = silent ? undefined : (ev) => {
    const t = ev.type;
    const p = ev.payload || {};
    if (t === 'council_invoked') {
      log(`[council] invocando "${p.name}" tier ${p.tier}, ${p.personas?.length || 0} personas, ~$${p.estimated_cost_usd}`);
    } else if (t === 'council_round_started') {
      log(`[council] iniciando ronda ${p.round}`);
    } else if (t === 'council_persona_responded') {
      log(`[council]   ${p.persona_id} respondió (${p.tokens} tokens, $${p.cost_usd})`);
    } else if (t === 'council_persona_failed') {
      log(`[council]   ${p.persona_id} FALLÓ: ${p.error}`);
    } else if (t === 'council_synthesis_done') {
      log(`[council] síntesis lista. recomendación=${p.has_recommendation}, requires_human=${p.requires_human_decision}`);
    } else if (t === 'council_confidence_iter') {
      log(`[council] confidence iter ${p.iteration}: score ${p.score}`);
    }
  };

  let result;
  try {
    result = await invoke({
      councilConfig,
      councilName: args.council,
      question: args.question,
      context: args.context,
      tier,
      onProgress,
      confirmExpensive: !!args['confirm-expensive'],
      memoryDir: args['memory-dir'],
    });
  } catch (e) {
    console.error(`[council] FAIL: ${e.message}`);
    if (e instanceof CouncilError && e.details) {
      try { console.error(JSON.stringify(e.details, null, 2).slice(0, 2000)); } catch { /* */ }
    }
    process.exit(1);
  }

  if (args.output) {
    const out = isAbsolute(args.output) ? args.output : resolve(process.cwd(), args.output);
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
    log(`[council] resultado guardado en ${out}`);
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch(e => {
    console.error(`fatal: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  });
}

// =============================================================================
// Default export
// =============================================================================

export default {
  invoke,
  loadCouncilConfig,
  estimateCouncilCost,
  CouncilError,
};
