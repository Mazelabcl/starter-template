// src/openrouter_client.js
// Cliente unificado para OpenRouter (Anthropic, OpenAI, Google, DeepSeek, Qwen,
// Meta, Perplexity). Pensado como base para councils multi-modelo (Sprint 4.2)
// y futuro routing automático.
//
// Diseño:
//  - Cero dependencias externas, fetch nativo de Node 18+.
//  - API homogénea: `chat({model, messages, tools?, ...})` retorna un objeto
//    normalizado independiente del proveedor.
//  - Catálogo de modelos con flags de capacidades y costos estimados (tags
//    para filtrar: "research", "code", "vision", "fast", "cheap", etc.).
//  - Tool calling normalizado al formato OpenAI (id + function {name, arguments}).
//    Si OpenRouter pasa Anthropic-style, lo convertimos.
//  - Errores estructurados vía `OpenRouterError` con status, code y provider_error.
//  - `chatBatch` con límite de paralelismo para councils.
//  - Streaming opcional con async iterator de tokens.
//
// Notas:
//  - Los costos del catálogo son APROXIMADOS (USD por 1M tokens). OpenRouter
//    cambia precios y los modelos rotan; consulta openrouter.ai/models para el
//    valor exacto. El flag `cost_per_1m_input` y `cost_per_1m_output` sirve
//    para estimación, no para facturación.
//  - Los slugs de modelo son los públicos de OpenRouter al momento de escribir;
//    si OpenRouter renombra alguno, basta con actualizar `MODELS` aquí.

import process from 'node:process';

// =============================================================================
// Config
// =============================================================================

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 120_000;

// HTTP-Referer y X-Title son recomendados por OpenRouter para tracking del
// origen de la llamada. Si están en .env, los enviamos. Si no, omitimos.
function buildHeaders(apiKey) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = process.env.OPENROUTER_REFERER || process.env.OPENROUTER_HTTP_REFERER;
  const title = process.env.OPENROUTER_TITLE || process.env.OPENROUTER_X_TITLE;
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-Title'] = title;
  return headers;
}

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new OpenRouterError(
      'Falta OPENROUTER_API_KEY. Corre `npm run setup` o usa `/setup-openrouter`.',
      { status: 0, code: 'no_api_key' },
    );
  }
  return key;
}

// =============================================================================
// OpenRouterError
// =============================================================================

export class OpenRouterError extends Error {
  constructor(message, { status = 0, code = 'unknown', provider_error = null, request_id = null } = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.code = code;
    this.provider_error = provider_error;
    this.request_id = request_id;
  }
}

// =============================================================================
// Catálogo de modelos
// =============================================================================
// Costos: USD por 1M tokens (input/output). Aproximados — actualizar si OpenRouter
// cambia pricing. Tags en `recommended_for` ayudan al routing futuro.
//
// Convención: cada proveedor es una sub-clave; cada modelo es a su vez sub-clave
// con shape estable. `id` es el slug que viaja en el body de la request.

export const MODELS = {
  anthropic: {
    opus: {
      id: 'anthropic/claude-opus-4.5',
      provider: 'anthropic',
      context_window: 200_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: false,
      cost_per_1m_input: 15.0,
      cost_per_1m_output: 75.0,
      recommended_for: ['reasoning', 'complex', 'code', 'long_context'],
    },
    sonnet: {
      id: 'anthropic/claude-sonnet-4.5',
      provider: 'anthropic',
      context_window: 200_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: false,
      cost_per_1m_input: 3.0,
      cost_per_1m_output: 15.0,
      recommended_for: ['code', 'agentic', 'general', 'tool_use'],
    },
    haiku: {
      id: 'anthropic/claude-haiku-4.5',
      provider: 'anthropic',
      context_window: 200_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: false,
      cost_per_1m_input: 1.0,
      cost_per_1m_output: 5.0,
      recommended_for: ['fast', 'cheap', 'tool_use'],
    },
  },

  openai: {
    gpt5: {
      id: 'openai/gpt-5',
      provider: 'openai',
      context_window: 400_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: true,
      cost_per_1m_input: 1.25,
      cost_per_1m_output: 10.0,
      recommended_for: ['reasoning', 'complex', 'code', 'tool_use'],
    },
    gpt5_mini: {
      id: 'openai/gpt-5-mini',
      provider: 'openai',
      context_window: 400_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: true,
      cost_per_1m_input: 0.25,
      cost_per_1m_output: 2.0,
      recommended_for: ['fast', 'cheap', 'general', 'tool_use'],
    },
    gpt4o: {
      id: 'openai/gpt-4o',
      provider: 'openai',
      context_window: 128_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: true,
      cost_per_1m_input: 2.5,
      cost_per_1m_output: 10.0,
      recommended_for: ['general', 'vision', 'tool_use'],
    },
  },

  google: {
    gemini_pro: {
      id: 'google/gemini-2.5-pro',
      provider: 'google',
      context_window: 1_000_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: true,
      cost_per_1m_input: 1.25,
      cost_per_1m_output: 10.0,
      recommended_for: ['long_context', 'reasoning', 'vision', 'code'],
    },
    gemini_flash: {
      id: 'google/gemini-2.5-flash',
      provider: 'google',
      context_window: 1_000_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: true,
      cost_per_1m_input: 0.30,
      cost_per_1m_output: 2.5,
      recommended_for: ['fast', 'cheap', 'long_context', 'vision'],
    },
  },

  deepseek: {
    r1: {
      id: 'deepseek/deepseek-r1',
      provider: 'deepseek',
      context_window: 128_000,
      supports_tools: false,
      supports_vision: false,
      supports_json_mode: true,
      cost_per_1m_input: 0.55,
      cost_per_1m_output: 2.19,
      recommended_for: ['reasoning', 'cheap', 'math', 'code'],
    },
    v3: {
      id: 'deepseek/deepseek-chat',
      provider: 'deepseek',
      context_window: 64_000,
      supports_tools: true,
      supports_vision: false,
      supports_json_mode: true,
      cost_per_1m_input: 0.27,
      cost_per_1m_output: 1.10,
      recommended_for: ['cheap', 'general', 'code', 'tool_use'],
    },
  },

  qwen: {
    qwen3: {
      id: 'qwen/qwen3-235b-a22b',
      provider: 'qwen',
      context_window: 131_000,
      supports_tools: true,
      supports_vision: false,
      supports_json_mode: true,
      cost_per_1m_input: 0.20,
      cost_per_1m_output: 0.60,
      recommended_for: ['cheap', 'code', 'reasoning', 'tool_use'],
    },
  },

  meta: {
    llama4: {
      id: 'meta-llama/llama-4-maverick',
      provider: 'meta',
      context_window: 256_000,
      supports_tools: true,
      supports_vision: true,
      supports_json_mode: true,
      cost_per_1m_input: 0.27,
      cost_per_1m_output: 0.85,
      recommended_for: ['cheap', 'general', 'vision', 'tool_use'],
    },
  },

  perplexity: {
    sonar: {
      id: 'perplexity/sonar',
      provider: 'perplexity',
      context_window: 127_000,
      supports_tools: false,
      supports_vision: false,
      supports_json_mode: false,
      cost_per_1m_input: 1.0,
      cost_per_1m_output: 1.0,
      recommended_for: ['research', 'fast', 'cheap', 'web_search'],
    },
    sonar_pro: {
      id: 'perplexity/sonar-pro',
      provider: 'perplexity',
      context_window: 200_000,
      supports_tools: false,
      supports_vision: false,
      supports_json_mode: false,
      cost_per_1m_input: 3.0,
      cost_per_1m_output: 15.0,
      recommended_for: ['research', 'web_search', 'general'],
    },
    sonar_pro_search: {
      id: 'perplexity/sonar-pro-search',
      provider: 'perplexity',
      context_window: 200_000,
      supports_tools: false,
      supports_vision: false,
      supports_json_mode: false,
      cost_per_1m_input: 3.0,
      cost_per_1m_output: 15.0,
      recommended_for: ['research', 'web_search'],
    },
    sonar_reasoning_pro: {
      id: 'perplexity/sonar-reasoning-pro',
      provider: 'perplexity',
      context_window: 127_000,
      supports_tools: false,
      supports_vision: false,
      supports_json_mode: false,
      cost_per_1m_input: 2.0,
      cost_per_1m_output: 8.0,
      recommended_for: ['research', 'reasoning', 'web_search'],
    },
    sonar_deep_research: {
      id: 'perplexity/sonar-deep-research',
      provider: 'perplexity',
      context_window: 127_000,
      supports_tools: false,
      supports_vision: false,
      supports_json_mode: false,
      cost_per_1m_input: 2.0,
      cost_per_1m_output: 8.0,
      recommended_for: ['research', 'deep_research', 'web_search'],
    },
  },
};

// =============================================================================
// Helpers de catálogo
// =============================================================================

// Itera todas las entradas del catálogo flatten, retornando `{groupKey, modelKey, model}`.
function* iterCatalog() {
  for (const [groupKey, group] of Object.entries(MODELS)) {
    for (const [modelKey, model] of Object.entries(group)) {
      yield { groupKey, modelKey, model };
    }
  }
}

// Resuelve un argumento `model` a su entrada del catálogo (o null si es un slug
// custom no listado). Acepta:
//  - String slug ("anthropic/claude-sonnet-4.5") — busca en catálogo, si no está
//    devuelve un wrapper genérico (sin flags de capacidades).
//  - Objeto {id, ...} ya-shape de catálogo — pasa directo.
function resolveModel(input) {
  if (input && typeof input === 'object' && typeof input.id === 'string') {
    return input;
  }
  if (typeof input !== 'string') {
    throw new OpenRouterError(
      `Parámetro "model" inválido: esperaba string slug u objeto del catálogo, recibí ${typeof input}.`,
      { status: 0, code: 'invalid_model_arg' },
    );
  }
  for (const { model } of iterCatalog()) {
    if (model.id === input) return model;
  }
  // Fallback: slug custom. Capacidades desconocidas → asumimos restrictivo.
  return {
    id: input,
    provider: input.split('/')[0] || 'unknown',
    context_window: null,
    supports_tools: null,
    supports_vision: null,
    supports_json_mode: null,
    cost_per_1m_input: null,
    cost_per_1m_output: null,
    recommended_for: [],
    _custom: true,
  };
}

// Lista modelos del catálogo, opcionalmente filtrados por:
//  - tag: string que debe estar en recommended_for
//  - feature: una de "tools" | "vision" | "json_mode" — exige supports_X === true
//  - provider: nombre del proveedor (anthropic, openai, ...)
export function listModels(filter = {}) {
  const out = [];
  for (const { groupKey, modelKey, model } of iterCatalog()) {
    if (filter.provider && model.provider !== filter.provider) continue;
    if (filter.tag && !model.recommended_for?.includes(filter.tag)) continue;
    if (filter.feature) {
      const flag = {
        tools: 'supports_tools',
        vision: 'supports_vision',
        json_mode: 'supports_json_mode',
      }[filter.feature];
      if (!flag || model[flag] !== true) continue;
    }
    out.push({ group: groupKey, key: modelKey, ...model });
  }
  return out;
}

export function estimateCost({ model, input_tokens = 0, output_tokens = 0 }) {
  const m = resolveModel(model);
  const inCost = m.cost_per_1m_input;
  const outCost = m.cost_per_1m_output;
  if (inCost == null || outCost == null) return 0; // modelo sin precio conocido
  return (input_tokens / 1_000_000) * inCost + (output_tokens / 1_000_000) * outCost;
}

// =============================================================================
// Normalización de tool_calls
// =============================================================================
// OpenAI estándar:
//   { id, type: "function", function: { name, arguments: <string JSON> } }
// Anthropic (vía OpenRouter en algunos casos) puede llegar como:
//   { id, type: "tool_use", name, input: {...} }
// Algunos providers ya retornan formato OpenAI (OpenRouter normaliza bastante).
// Acá hacemos defensa en profundidad.
function normalizeToolCalls(rawCalls) {
  if (!Array.isArray(rawCalls)) return undefined;
  return rawCalls.map((tc, idx) => {
    // Caso OpenAI estándar
    if (tc.function && typeof tc.function === 'object') {
      let args = tc.function.arguments;
      if (typeof args !== 'string') {
        // Algunos modelos retornan arguments como objeto. Estandarizamos a string.
        try { args = JSON.stringify(args ?? {}); } catch { args = '{}'; }
      }
      return {
        id: tc.id || `call_${idx}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: args,
        },
      };
    }
    // Caso Anthropic-style (tool_use con input objeto)
    if (tc.type === 'tool_use' || (tc.name && tc.input !== undefined)) {
      let args;
      try { args = JSON.stringify(tc.input ?? {}); } catch { args = '{}'; }
      return {
        id: tc.id || `call_${idx}`,
        type: 'function',
        function: {
          name: tc.name,
          arguments: args,
        },
      };
    }
    // Fallback: pasamos lo que haya, marcado como function sin args parseados.
    return {
      id: tc.id || `call_${idx}`,
      type: 'function',
      function: {
        name: tc.name || tc.function?.name || 'unknown',
        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
      },
    };
  });
}

// =============================================================================
// chat()
// =============================================================================

export async function chat({
  model,
  messages,
  tools,
  tool_choice,
  temperature,
  max_tokens,
  response_format,
  system,
  stream = false,
  signal,
  timeout_ms = DEFAULT_TIMEOUT_MS,
  extra = {},
} = {}) {
  if (!Array.isArray(messages) && !system) {
    throw new OpenRouterError(
      'chat() requiere `messages` (array) o al menos un `system` string.',
      { status: 0, code: 'invalid_messages' },
    );
  }

  const resolved = resolveModel(model);

  // Validación dura: si el catálogo dice que el modelo no soporta tools y el
  // caller pasa tools, error claro y accionable. Si el flag es null (modelo
  // custom) confiamos en el caller.
  if (tools && Array.isArray(tools) && tools.length > 0 && resolved.supports_tools === false) {
    const alternativas = listModels({ feature: 'tools' })
      .slice(0, 3)
      .map(m => m.id)
      .join(', ');
    throw new OpenRouterError(
      `Modelo ${resolved.id} no soporta tool calling. Usa un modelo con supports_tools=true (ej: ${alternativas}).`,
      { status: 0, code: 'tools_not_supported' },
    );
  }

  // Construcción de messages: si vino `system`, lo prependemos como mensaje role:system.
  // OpenRouter acepta `system` top-level para algunos providers, pero es más portable
  // vía mensaje. Mantenemos los mensajes que ya vinieron del caller.
  const finalMessages = [];
  if (system && typeof system === 'string') {
    finalMessages.push({ role: 'system', content: system });
  }
  if (Array.isArray(messages)) {
    for (const m of messages) finalMessages.push(m);
  }

  const body = {
    model: resolved.id,
    messages: finalMessages,
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof max_tokens === 'number' ? { max_tokens } : {}),
    ...(response_format ? { response_format } : {}),
    ...(stream ? { stream: true } : {}),
    ...extra,
  };

  const apiKey = getApiKey();
  const headers = buildHeaders(apiKey);

  // AbortSignal: combinamos signal del caller con un timeout interno.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeout_ms}ms`)), timeout_ms);
  if (timer.unref) timer.unref();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new OpenRouterError(`Request abortada: ${e.message}`, { status: 0, code: 'aborted' });
    }
    if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(e.message)) {
      throw new OpenRouterError(
        `No hay conexión a openrouter.ai. Revisa tu red. Detalle: ${e.message}`,
        { status: 0, code: 'network_error' },
      );
    }
    throw new OpenRouterError(`Fetch falló: ${e.message}`, { status: 0, code: 'fetch_error' });
  }

  if (!res.ok) {
    clearTimeout(timer);
    const text = await safeReadText(res);
    let provErr = null;
    try { provErr = JSON.parse(text); } catch { /* texto plano */ }
    const code = httpStatusToCode(res.status);
    const message = formatHttpError(res.status, code, resolved.id, text);
    throw new OpenRouterError(message, {
      status: res.status,
      code,
      provider_error: provErr,
      request_id: res.headers.get('x-request-id'),
    });
  }

  if (stream) {
    clearTimeout(timer);
    return streamResponse(res, resolved);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw new OpenRouterError(
      `Respuesta no es JSON válido: ${e.message}`,
      { status: res.status, code: 'invalid_response' },
    );
  }
  clearTimeout(timer);

  return normalizeResponse(data, resolved);
}

function normalizeResponse(data, resolved) {
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  const content = typeof msg.content === 'string' ? msg.content
    : Array.isArray(msg.content) ? msg.content.map(p => (typeof p === 'string' ? p : p.text || '')).join('')
    : '';
  const tool_calls = normalizeToolCalls(msg.tool_calls);

  const usage = data.usage || {};
  const prompt_tokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completion_tokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const cost_usd_estimated = estimateCost({
    model: resolved,
    input_tokens: prompt_tokens,
    output_tokens: completion_tokens,
  });

  return {
    content,
    tool_calls,
    finish_reason: choice?.finish_reason ?? null,
    usage: {
      prompt_tokens,
      completion_tokens,
      total_tokens: usage.total_tokens ?? (prompt_tokens + completion_tokens),
      cost_usd_estimated,
    },
    model_used: data.model ?? resolved.id,
    citations: data.citations ?? null,
    raw: data,
  };
}

// Streaming: devolvemos un async iterator que emite tokens de delta + un evento
// final con la respuesta agregada normalizada.
//
// Formato OpenRouter (SSE OpenAI-compatible): cada chunk `data: {json}\n\n`,
// cierra con `data: [DONE]`.
async function* streamResponse(res, resolved) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let aggregatedContent = '';
  const aggregatedToolCalls = [];
  let finishReason = null;
  let usage = null;
  let modelUsed = resolved.id;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = event.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }
      if (parsed.model) modelUsed = parsed.model;
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        aggregatedContent += delta.content;
        yield { type: 'token', content: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? aggregatedToolCalls.length;
          if (!aggregatedToolCalls[i]) aggregatedToolCalls[i] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) aggregatedToolCalls[i].id = tc.id;
          if (tc.function?.name) aggregatedToolCalls[i].function.name += tc.function.name;
          if (tc.function?.arguments) aggregatedToolCalls[i].function.arguments += tc.function.arguments;
        }
      }
      if (parsed.choices?.[0]?.finish_reason) {
        finishReason = parsed.choices[0].finish_reason;
      }
    }
  }

  const prompt_tokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const completion_tokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  yield {
    type: 'done',
    content: aggregatedContent,
    tool_calls: aggregatedToolCalls.length ? normalizeToolCalls(aggregatedToolCalls) : undefined,
    finish_reason: finishReason,
    usage: {
      prompt_tokens,
      completion_tokens,
      total_tokens: usage?.total_tokens ?? (prompt_tokens + completion_tokens),
      cost_usd_estimated: estimateCost({ model: resolved, input_tokens: prompt_tokens, output_tokens: completion_tokens }),
    },
    model_used: modelUsed,
  };
}

async function safeReadText(res) {
  try { return await res.text(); } catch { return ''; }
}

function httpStatusToCode(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'request_timeout';
  if (status === 422) return 'unprocessable_entity';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'server_error';
  if (status >= 400 && status < 500) return 'client_error';
  return 'http_error';
}

function formatHttpError(status, code, modelId, text) {
  const snippet = (text || '').slice(0, 300).trim();
  if (status === 401) return `OpenRouter 401 (key inválida o ausente). Revisa OPENROUTER_API_KEY. Detalle: ${snippet}`;
  if (status === 402) return `OpenRouter 402 (sin créditos suficientes). Recarga en openrouter.ai. Detalle: ${snippet}`;
  if (status === 404) return `OpenRouter 404: modelo "${modelId}" no encontrado o no disponible. Detalle: ${snippet}`;
  if (status === 429) return `OpenRouter 429 (rate limit). Reintenta con backoff. Detalle: ${snippet}`;
  if (status >= 500) return `OpenRouter ${status} (error del proveedor). Reintenta. Detalle: ${snippet}`;
  return `OpenRouter ${status} (${code}) modelo=${modelId}. Detalle: ${snippet}`;
}

// =============================================================================
// chatBatch()
// =============================================================================
// Corre N llamadas en paralelo con límite. Retorna un array en el mismo orden
// que `requests`. Cada slot es {ok: true, response} | {ok: false, error}.

export async function chatBatch(requests, { parallelism = 5 } = {}) {
  if (!Array.isArray(requests)) {
    throw new OpenRouterError('chatBatch requiere array de requests', { code: 'invalid_input' });
  }
  const results = new Array(requests.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= requests.length) return;
      try {
        const response = await chat(requests[i]);
        results[i] = { ok: true, response };
      } catch (e) {
        results[i] = { ok: false, error: e instanceof OpenRouterError ? e : new OpenRouterError(e.message, { code: 'wrapped' }) };
      }
    }
  }

  const workers = Array.from({ length: Math.min(parallelism, requests.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// =============================================================================
// Default export object para acceso ergonómico
// =============================================================================

export default {
  chat,
  chatBatch,
  estimateCost,
  listModels,
  MODELS,
  OpenRouterError,
};
