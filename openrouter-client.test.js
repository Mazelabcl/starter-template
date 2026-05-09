// openrouter-client.test.js
// Test del cliente unificado de OpenRouter (src/openrouter_client.js).
//
// 7 tests:
//  1. Import del módulo no falla.
//  2. MODELS tiene la estructura esperada (>= 5 proveedores con campos requeridos).
//  3. listModels({tag: 'fast'}) retorna >= 1 modelo.
//  4. estimateCost retorna número > 0.
//  5. Live: chat() con claude.haiku, prompt simple. SKIP si no hay API key.
//  6. Live: chat() con tool calling. SKIP si no hay API key.
//  7. error handling: model inválido retorna OpenRouterError con status 4xx.
//
// Tests live skipean limpiamente (no fallan) si OPENROUTER_API_KEY no está.
// Salida: PASS / FAIL / SKIP por test, exit 0 si nada falló (skips no son fail).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const CLIENT_PATH = join(REPO_ROOT, 'src', 'openrouter_client.js');

let passed = 0;
let failed = 0;
let skipped = 0;
const fails = [];

function recordPass(label) { console.log(`PASS  ${label}`); passed += 1; }
function recordFail(label, err) {
  console.error(`FAIL  ${label}`);
  console.error(`      ${err?.message || err}`);
  fails.push({ label, error: err?.message || String(err) });
  failed += 1;
}
function recordSkip(label, reason) { console.log(`SKIP  ${label} — ${reason}`); skipped += 1; }

async function check(label, fn) {
  try {
    await fn();
    recordPass(label);
  } catch (e) {
    recordFail(label, e);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Carga manual de .env (sin depender de dotenv) para el test live.
function loadEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return false;
  const text = readFileSync(envPath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = val;
  }
  return true;
}

function hasLiveKey() {
  const k = process.env.OPENROUTER_API_KEY;
  return !!k && !/pega-aqui-tu-key|your-?key-?here|placeholder/i.test(k);
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('--- openrouter-client.test.js ---\n');
  loadEnv();

  // -------- Test 1: import no falla
  let mod;
  await check('test 1 — import del módulo no falla', async () => {
    assert(existsSync(CLIENT_PATH), `no encuentro ${CLIENT_PATH}`);
    mod = await import(pathToFileURL(CLIENT_PATH).href);
    assert(typeof mod.chat === 'function', 'chat no es función');
    assert(typeof mod.chatBatch === 'function', 'chatBatch no es función');
    assert(typeof mod.estimateCost === 'function', 'estimateCost no es función');
    assert(typeof mod.listModels === 'function', 'listModels no es función');
    assert(mod.MODELS && typeof mod.MODELS === 'object', 'MODELS no es objeto');
    assert(typeof mod.OpenRouterError === 'function', 'OpenRouterError no es clase');
  });

  // Si test 1 falló (mod undefined), el resto no puede correr; reportamos y salimos.
  if (!mod) {
    summary();
    process.exit(failed > 0 ? 1 : 0);
  }

  const { MODELS, listModels, estimateCost, chat, OpenRouterError } = mod;

  // -------- Test 2: estructura de MODELS
  await check('test 2 — MODELS tiene >= 5 proveedores con campos requeridos', () => {
    const providers = Object.keys(MODELS);
    assert(providers.length >= 5, `esperaba >= 5 proveedores, obtuve ${providers.length}: ${providers.join(',')}`);
    const requiredFields = [
      'id', 'provider', 'context_window', 'supports_tools', 'supports_vision',
      'supports_json_mode', 'cost_per_1m_input', 'cost_per_1m_output', 'recommended_for',
    ];
    let modelCount = 0;
    for (const [providerKey, group] of Object.entries(MODELS)) {
      assert(typeof group === 'object', `provider ${providerKey} no es objeto`);
      for (const [modelKey, model] of Object.entries(group)) {
        modelCount += 1;
        for (const f of requiredFields) {
          assert(f in model, `modelo ${providerKey}.${modelKey} sin campo "${f}"`);
        }
        assert(typeof model.id === 'string' && model.id.includes('/'),
          `modelo ${providerKey}.${modelKey} id="${model.id}" debería ser slug provider/name`);
        assert(Array.isArray(model.recommended_for),
          `modelo ${providerKey}.${modelKey} recommended_for no es array`);
      }
    }
    assert(modelCount >= 10, `esperaba >= 10 modelos en total, obtuve ${modelCount}`);
  });

  // -------- Test 3: listModels({tag: 'fast'})
  await check("test 3 — listModels({tag: 'fast'}) retorna >= 1", () => {
    const fast = listModels({ tag: 'fast' });
    assert(Array.isArray(fast), 'listModels no retornó array');
    assert(fast.length >= 1, `esperaba >= 1 modelo con tag "fast", obtuve ${fast.length}`);
    for (const m of fast) {
      assert(m.recommended_for.includes('fast'), `modelo ${m.id} listado pero sin tag fast`);
    }
  });

  // -------- Test 4: estimateCost > 0
  await check('test 4 — estimateCost retorna número > 0', () => {
    const cost = estimateCost({
      model: MODELS.anthropic.sonnet,
      input_tokens: 1000,
      output_tokens: 500,
    });
    assert(typeof cost === 'number', `cost no es número: ${typeof cost}`);
    assert(cost > 0, `cost esperado > 0, obtuve ${cost}`);
    // Sanity: 1k input * 3/1M + 500 out * 15/1M = 0.003 + 0.0075 = 0.0105 USD aprox.
    assert(cost < 1, `cost ${cost} sospechosamente alto para 1500 tokens`);

    // También testeamos que estimateCost por slug string funcione.
    const cost2 = estimateCost({ model: 'anthropic/claude-sonnet-4.5', input_tokens: 1000, output_tokens: 500 });
    assert(cost2 === cost, `estimateCost por slug debería igualar al objeto: ${cost2} vs ${cost}`);
  });

  // -------- Test 5: live chat() simple
  if (!hasLiveKey()) {
    recordSkip('test 5 — live chat() con claude.haiku', 'sin OPENROUTER_API_KEY válida');
  } else {
    await check('test 5 — live chat() con claude.haiku, prompt simple', async () => {
      const response = await chat({
        model: MODELS.anthropic.haiku,
        messages: [{ role: 'user', content: 'Di hola en 5 palabras.' }],
        max_tokens: 50,
        temperature: 0.5,
      });
      assert(typeof response.content === 'string', 'response.content no es string');
      assert(response.content.length > 0, 'response.content vacío');
      assert(response.usage && typeof response.usage === 'object', 'response.usage falta');
      assert(typeof response.usage.prompt_tokens === 'number', 'usage.prompt_tokens no es número');
      assert(typeof response.usage.completion_tokens === 'number', 'usage.completion_tokens no es número');
      assert(typeof response.usage.cost_usd_estimated === 'number', 'usage.cost_usd_estimated no es número');
      assert(typeof response.model_used === 'string', 'model_used falta');
    });
  }

  // -------- Test 6: live chat() con tools
  if (!hasLiveKey()) {
    recordSkip('test 6 — live chat() con tool calling', 'sin OPENROUTER_API_KEY válida');
  } else {
    await check('test 6 — live chat() con tool calling', async () => {
      const tools = [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Obtiene el clima actual de una ciudad.',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'Nombre de la ciudad' },
            },
            required: ['city'],
          },
        },
      }];
      const response = await chat({
        model: MODELS.anthropic.haiku,
        messages: [
          { role: 'user', content: '¿Qué clima hace en Santiago de Chile? Usa la herramienta get_weather.' },
        ],
        tools,
        max_tokens: 200,
      });
      // El modelo idealmente decide invocar. Si no lo hace, no fallamos duro;
      // verificamos que al menos respondió algo coherente (content o tool_calls).
      const hasToolCall = Array.isArray(response.tool_calls) && response.tool_calls.length > 0;
      const hasContent = typeof response.content === 'string' && response.content.length > 0;
      assert(hasToolCall || hasContent, 'sin tool_calls ni content — respuesta vacía');
      if (hasToolCall) {
        const tc = response.tool_calls[0];
        assert(tc.type === 'function', `tool_call.type esperado "function", obtuve ${tc.type}`);
        assert(tc.function && typeof tc.function.name === 'string', 'tool_call.function.name falta');
        assert(typeof tc.function.arguments === 'string', 'tool_call.function.arguments no es string (debería estar normalizado)');
        // arguments debe parsear como JSON.
        let parsed;
        try { parsed = JSON.parse(tc.function.arguments); } catch (e) {
          throw new Error(`arguments no parsea como JSON: ${tc.function.arguments}`);
        }
        assert(parsed && typeof parsed === 'object', 'arguments parseado no es objeto');
      }
    });
  }

  // -------- Test 7: error handling con model inválido
  if (!hasLiveKey()) {
    recordSkip('test 7 — error handling con model inválido', 'sin OPENROUTER_API_KEY válida (requiere red real)');
  } else {
    await check('test 7 — model inválido retorna OpenRouterError con status 4xx', async () => {
      let err = null;
      try {
        await chat({
          model: 'fake-provider/this-model-does-not-exist-xyz',
          messages: [{ role: 'user', content: 'hola' }],
          max_tokens: 10,
        });
      } catch (e) {
        err = e;
      }
      assert(err !== null, 'chat() con modelo inválido NO lanzó error');
      assert(err instanceof OpenRouterError, `error no es OpenRouterError, es ${err?.constructor?.name}`);
      assert(typeof err.status === 'number', 'OpenRouterError.status no es número');
      assert(err.status >= 400 && err.status < 500, `status esperado 4xx, obtuve ${err.status}`);
      assert(typeof err.code === 'string' && err.code.length > 0, 'OpenRouterError.code vacío');
    });
  }

  summary();
  process.exit(failed > 0 ? 1 : 0);
}

function summary() {
  console.log('');
  console.log(`Resultado: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  if (failed > 0) {
    console.log('Fallos:');
    for (const f of fails) console.log(`  - ${f.label}: ${f.error}`);
  }
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
