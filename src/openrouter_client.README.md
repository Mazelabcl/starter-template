# `src/openrouter_client.js` — Cliente unificado OpenRouter

Cliente único para todos los LLMs vía OpenRouter (Anthropic, OpenAI, Google, DeepSeek, Qwen, Meta, Perplexity). Es la base para councils multi-modelo (Sprint 4.2) y futuro routing automático.

## Quickstart

```javascript
import { chat, MODELS } from './src/openrouter_client.js';

const response = await chat({
  model: MODELS.anthropic.sonnet,
  messages: [{ role: 'user', content: 'Hola' }],
});
console.log(response.content, response.usage.cost_usd_estimated);
```

Requiere `OPENROUTER_API_KEY` en `.env`. Si la quieres configurar: `npm run setup`.

## Catálogo de modelos

| Slug del catálogo | ID OpenRouter | Tools | Vision | JSON | Tags |
|---|---|---|---|---|---|
| `MODELS.anthropic.opus` | `anthropic/claude-opus-4.5` | yes | yes | no | reasoning, complex, code, long_context |
| `MODELS.anthropic.sonnet` | `anthropic/claude-sonnet-4.5` | yes | yes | no | code, agentic, general, tool_use |
| `MODELS.anthropic.haiku` | `anthropic/claude-haiku-4.5` | yes | yes | no | fast, cheap, tool_use |
| `MODELS.openai.gpt5` | `openai/gpt-5` | yes | yes | yes | reasoning, complex, code, tool_use |
| `MODELS.openai.gpt5_mini` | `openai/gpt-5-mini` | yes | yes | yes | fast, cheap, general, tool_use |
| `MODELS.openai.gpt4o` | `openai/gpt-4o` | yes | yes | yes | general, vision, tool_use |
| `MODELS.google.gemini_pro` | `google/gemini-2.5-pro` | yes | yes | yes | long_context, reasoning, vision, code |
| `MODELS.google.gemini_flash` | `google/gemini-2.5-flash` | yes | yes | yes | fast, cheap, long_context, vision |
| `MODELS.deepseek.r1` | `deepseek/deepseek-r1` | no | no | yes | reasoning, cheap, math, code |
| `MODELS.deepseek.v3` | `deepseek/deepseek-chat` | yes | no | yes | cheap, general, code, tool_use |
| `MODELS.qwen.qwen3` | `qwen/qwen3-235b-a22b` | yes | no | yes | cheap, code, reasoning, tool_use |
| `MODELS.meta.llama4` | `meta-llama/llama-4-maverick` | yes | yes | yes | cheap, general, vision, tool_use |
| `MODELS.perplexity.sonar` | `perplexity/sonar` | no | no | no | research, fast, cheap, web_search |
| `MODELS.perplexity.sonar_pro` | `perplexity/sonar-pro` | no | no | no | research, web_search, general |
| `MODELS.perplexity.sonar_pro_search` | `perplexity/sonar-pro-search` | no | no | no | research, web_search |
| `MODELS.perplexity.sonar_reasoning_pro` | `perplexity/sonar-reasoning-pro` | no | no | no | research, reasoning, web_search |
| `MODELS.perplexity.sonar_deep_research` | `perplexity/sonar-deep-research` | no | no | no | research, deep_research, web_search |

Costos por 1M tokens (input/output) viven en cada entrada como `cost_per_1m_input` / `cost_per_1m_output`. Son **aproximados** — verifica el valor exacto en [openrouter.ai/models](https://openrouter.ai/models).

## Tool calling

```javascript
const tools = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Obtiene el clima.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
}];

const r = await chat({
  model: MODELS.anthropic.sonnet,
  messages: [{ role: 'user', content: '¿Clima en Santiago?' }],
  tools,
});

if (r.tool_calls) {
  for (const tc of r.tool_calls) {
    // tc = { id, type: 'function', function: { name, arguments: <string JSON> } }
    const args = JSON.parse(tc.function.arguments);
    // ... ejecutar tc.function.name con args ...
  }
}
```

Si un modelo no soporta tools (`supports_tools: false` en el catálogo), `chat()` lanza `OpenRouterError` con código `tools_not_supported` y sugiere alternativas. La normalización convierte respuestas Anthropic-style (`tool_use` con `input` objeto) al formato OpenAI estándar para que la salida sea homogénea entre proveedores.

## Cómo elegir modelo

| Tarea | Recomendado | Motivo |
|---|---|---|
| Research con citas web | `MODELS.perplexity.sonar_pro` | Búsqueda web nativa con fuentes. |
| Research profundo | `MODELS.perplexity.sonar_deep_research` | Multi-step reasoning con búsqueda. |
| Código complejo / refactors | `MODELS.anthropic.sonnet` o `MODELS.openai.gpt5` | Tool use sólido y razonamiento. |
| Decisión rápida / clasificación | `MODELS.anthropic.haiku` o `MODELS.google.gemini_flash` | Latencia baja, costo bajo. |
| Decisión muy compleja | `MODELS.anthropic.opus` o `MODELS.openai.gpt5` | Profundidad de razonamiento. |
| Vision (analizar imagen) | `MODELS.openai.gpt4o` o `MODELS.google.gemini_pro` | Vision robusta. |
| Long context (>500k tokens) | `MODELS.google.gemini_pro` | Ventana de 1M. |
| Council barato pero diverso | `haiku` + `gemini_flash` + `qwen3` + `deepseek.v3` | 4 voces distintas a costo bajo. |

Para descubrir programáticamente: `listModels({ tag: 'fast' })`, `listModels({ feature: 'vision' })`, `listModels({ provider: 'anthropic' })`.

## Manejo de errores

Todos los errores son `OpenRouterError` con campos `status`, `code`, `provider_error`, `request_id`:

```javascript
import { chat, OpenRouterError } from './src/openrouter_client.js';

try {
  await chat({ model: 'fake/x', messages: [...] });
} catch (e) {
  if (e instanceof OpenRouterError) {
    if (e.code === 'unauthorized') console.error('Key inválida');
    else if (e.code === 'rate_limited') /* backoff */;
    else if (e.code === 'tools_not_supported') /* cambia modelo */;
    else if (e.status === 404) /* modelo no existe */;
  }
}
```

Códigos comunes: `unauthorized` (401), `rate_limited` (429), `server_error` (5xx), `network_error`, `tools_not_supported`, `no_api_key`, `aborted`.

## Streaming

```javascript
const stream = await chat({ model: MODELS.anthropic.haiku, messages: [...], stream: true });
for await (const chunk of stream) {
  if (chunk.type === 'token') process.stdout.write(chunk.content);
  else if (chunk.type === 'done') console.log('\nfinish:', chunk.finish_reason);
}
```

## Batch paralelo (councils)

```javascript
import { chatBatch, MODELS } from './src/openrouter_client.js';

const results = await chatBatch([
  { model: MODELS.anthropic.sonnet, messages: [...] },
  { model: MODELS.openai.gpt5,      messages: [...] },
  { model: MODELS.google.gemini_pro, messages: [...] },
], { parallelism: 3 });

for (const r of results) {
  if (r.ok) console.log(r.response.content);
  else console.error(r.error.message);
}
```

`results` mantiene el orden de `requests`. Errores no rompen el batch — cada slot indica `{ok, response}` o `{ok: false, error}`.

## Agregar un modelo nuevo al catálogo

1. Verifica el slug en [openrouter.ai/models](https://openrouter.ai/models) (ej. `mistralai/mistral-large-2411`).
2. Edita `src/openrouter_client.js`, sección `MODELS`. Agrega bajo el proveedor correcto:
   ```javascript
   mistral: {
     large: {
       id: 'mistralai/mistral-large-2411',
       provider: 'mistral',
       context_window: 128_000,
       supports_tools: true,
       supports_vision: false,
       supports_json_mode: true,
       cost_per_1m_input: 2.0,
       cost_per_1m_output: 6.0,
       recommended_for: ['general', 'tool_use'],
     },
   },
   ```
3. Si no estás seguro de los flags, marca conservador (`supports_tools: false`). Mejor falso negativo que romper en runtime.
4. Corre `node openrouter-client.test.js` para validar que el catálogo sigue íntegro.
