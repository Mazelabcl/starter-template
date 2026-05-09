// council-engine.test.js
// Tests del motor de councils (src/council.js).
//
// 5 tests:
//  1. loadCouncilConfig con config válido inline pasa.
//  2. loadCouncilConfig con config inválido (sin personas array) lanza CouncilError claro.
//  3. estimateCouncilCost para un council Tier 1 retorna número razonable (>0, <0.5).
//  4. invoke() live con 2 personas en Claude Haiku, pregunta simple. SKIP si no API key.
//  5. invoke() con persona "rota" (mock vía monkey-patch de chat) continúa con N-1 y marca partial.
//
// PASS / FAIL / SKIP. Exit 0 si nada falló.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const COUNCIL_PATH = join(REPO_ROOT, 'src', 'council.js');

let passed = 0;
let failed = 0;
let skipped = 0;
const fails = [];

function recordPass(label) { console.log(`PASS  ${label}`); passed += 1; }
function recordFail(label, err) {
  console.error(`FAIL  ${label}`);
  console.error(`      ${err?.message || err}`);
  if (err?.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
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
// Helpers
// =============================================================================

function validInlineConfig() {
  return {
    name: 'test-naming',
    description: 'Test council para naming.',
    tier_default: 1,
    personas: [
      {
        id: 'visionary',
        actua_como: 'Eres un visionario. Prefieres nombres ambiciosos y memorables.',
        model: 'anthropic/claude-haiku-4.5',
        temperature: 0.85,
        max_tokens: 300,
      },
      {
        id: 'pragmatic',
        actua_como: 'Eres un pragmático. Prefieres nombres claros, dominio disponible, SEO sólido.',
        model: 'anthropic/claude-haiku-4.5',
        temperature: 0.6,
        max_tokens: 300,
      },
    ],
    rounds: {
      round1: { enabled: true },
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('--- council-engine.test.js ---\n');
  loadEnv();

  // -------- Test 1: import + load config válido
  let mod;
  await check('test 1 — loadCouncilConfig con config válido pasa', async () => {
    assert(existsSync(COUNCIL_PATH), `no encuentro ${COUNCIL_PATH}`);
    mod = await import(pathToFileURL(COUNCIL_PATH).href);
    assert(typeof mod.invoke === 'function', 'invoke no exportado');
    assert(typeof mod.loadCouncilConfig === 'function', 'loadCouncilConfig no exportado');
    assert(typeof mod.estimateCouncilCost === 'function', 'estimateCouncilCost no exportado');
    assert(typeof mod.CouncilError === 'function', 'CouncilError no exportado');

    const config = mod.loadCouncilConfig({ councilConfig: validInlineConfig() });
    assert(config.name === 'test-naming', `name esperado test-naming, obtuve ${config.name}`);
    assert(Array.isArray(config.personas), 'personas no es array');
    assert(config.personas.length === 2, `personas esperadas 2, obtuve ${config.personas.length}`);
  });

  if (!mod) {
    summary();
    process.exit(failed > 0 ? 1 : 0);
  }

  const { invoke, loadCouncilConfig, estimateCouncilCost, CouncilError } = mod;

  // -------- Test 2: load config inválido lanza error claro
  await check('test 2 — config sin personas array lanza CouncilError descriptivo', () => {
    let err = null;
    try {
      loadCouncilConfig({
        councilConfig: {
          name: 'broken',
          rounds: { round1: { enabled: true } },
          // falta personas
        },
      });
    } catch (e) {
      err = e;
    }
    assert(err !== null, 'no lanzó error');
    assert(err instanceof CouncilError, `error no es CouncilError, es ${err?.constructor?.name}`);
    assert(err.code === 'invalid_config', `code esperado invalid_config, obtuve ${err.code}`);
    assert(/persona/i.test(err.message), `mensaje debería mencionar "personas", obtuve: ${err.message}`);

    // También: 1 sola persona debe fallar (minItems=2).
    let err2 = null;
    try {
      loadCouncilConfig({
        councilConfig: {
          name: 'lonely',
          personas: [{ id: 'solo', actua_como: 'Soy solo.', model: 'anthropic/claude-haiku-4.5' }],
          rounds: { round1: { enabled: true } },
        },
      });
    } catch (e) { err2 = e; }
    assert(err2 instanceof CouncilError, 'config con 1 persona debe fallar');

    // Y: IDs duplicados deben fallar.
    let err3 = null;
    try {
      loadCouncilConfig({
        councilConfig: {
          name: 'dupes',
          personas: [
            { id: 'x', actua_como: 'aaaaaaaaaa', model: 'anthropic/claude-haiku-4.5' },
            { id: 'x', actua_como: 'bbbbbbbbbb', model: 'anthropic/claude-haiku-4.5' },
          ],
          rounds: { round1: { enabled: true } },
        },
      });
    } catch (e) { err3 = e; }
    assert(err3 instanceof CouncilError, 'IDs duplicados debe fallar');
    assert(err3.code === 'duplicate_persona_id', `code esperado duplicate_persona_id, obtuve ${err3.code}`);
  });

  // -------- Test 3: estimateCouncilCost razonable
  await check('test 3 — estimateCouncilCost Tier 1 retorna número razonable (>0, <0.5)', () => {
    const config = loadCouncilConfig({ councilConfig: validInlineConfig() });
    const cost = estimateCouncilCost(config, { tier: 1 });
    assert(typeof cost === 'number', `cost no es número: ${typeof cost}`);
    assert(cost > 0, `esperaba cost > 0, obtuve ${cost}`);
    assert(cost < 0.5, `cost ${cost} sospechosamente alto para Tier 1 con 2 haiku`);
  });

  // -------- Test 4: invoke live con 2 personas Haiku
  if (!hasLiveKey()) {
    recordSkip('test 4 — invoke live con 2 personas Haiku', 'sin OPENROUTER_API_KEY válida');
  } else {
    await check('test 4 — invoke live: 2 personas Haiku, pregunta simple', async () => {
      const result = await invoke({
        councilConfig: {
          ...validInlineConfig(),
          // Forzamos síntesis con haiku también para abaratar y acelerar.
          rounds: {
            round1: { enabled: true },
            synthesis: {
              model: 'anthropic/claude-haiku-4.5',
              max_tokens: 1200,
              temperature: 0.2,
            },
          },
        },
        question: '¿Cuál es un buen nombre para una app de productividad para equipos pequeños?',
      });

      assert(result.council_name === 'test-naming', `council_name esperado test-naming, obtuve ${result.council_name}`);
      assert(result.tier_used === 1, `tier_used esperado 1, obtuve ${result.tier_used}`);
      assert(Array.isArray(result.personas_responses.round1), 'round1 no es array');
      assert(result.personas_responses.round1.length === 2, `round1 esperado 2 respuestas, obtuve ${result.personas_responses.round1.length}`);
      for (const r of result.personas_responses.round1) {
        assert(typeof r.persona_id === 'string' && r.persona_id.length > 0, 'persona_id falta');
        assert(typeof r.content === 'string' && r.content.length > 0, `content vacío para ${r.persona_id}`);
      }
      assert(result.personas_responses.round2 === null, 'round2 debe ser null en Tier 1');
      assert(typeof result.synthesis === 'object', 'synthesis no es objeto');
      assert(Array.isArray(result.synthesis.consensus_areas), 'consensus_areas no es array');
      assert(Array.isArray(result.synthesis.tensions), 'tensions no es array');
      assert(Array.isArray(result.synthesis.options), 'options no es array');
      assert(typeof result.synthesis.requires_human_decision === 'boolean', 'requires_human_decision no es boolean');
      assert(result.metadata.total_tokens > 0, `total_tokens esperado > 0, obtuve ${result.metadata.total_tokens}`);
      assert(result.metadata.total_cost_usd >= 0, `total_cost_usd esperado >= 0, obtuve ${result.metadata.total_cost_usd}`);
      assert(result.metadata.personas_alive === 2, `personas_alive esperado 2, obtuve ${result.metadata.personas_alive}`);
      assert(result.metadata.partial === false, `partial esperado false, obtuve ${result.metadata.partial}`);
      assert(typeof result.metadata.duration_seconds === 'number' && result.metadata.duration_seconds > 0, 'duration_seconds inválido');
    });
  }

  // -------- Test 5: persona rota → council continúa partial
  // Estrategia: usamos un MOCK de openrouter_client.chat vía un módulo intercept.
  // Como ESM no soporta monkey-patching de exports importados por terceros, hacemos
  // un test que usa un model id "fake/broken-xyz" que el openrouter_client rechazará
  // antes de llegar a la red — el flag `_custom: true` lo hace ir a HTTP. Como no
  // podemos garantizar offline, usamos una técnica distinta: pasamos un model que el
  // catálogo dice que no soporta tools junto con tools declaradas, lo que hace que
  // chat() lance OpenRouterError code='tools_not_supported' SIN tocar red.
  //
  // Persona rota: deepseek/r1 (supports_tools=false en catálogo) + tools=[perplexity_research].
  // Persona viva: claude-haiku sin tools (simulamos mock devolviendo string fijo
  // mediante un override del módulo... mejor: usamos invoke pero stub la persona viva
  // con un model real solo si hay key. Si no hay key, hacemos test offline puro
  // usando dos personas rotas con tools_not_supported y verificamos que insufficient_personas).
  await check('test 5 — una persona falla → council continúa partial (o insufficient si todas fallan)', async () => {
    if (!hasLiveKey()) {
      // Modo offline: ambas personas con tools en modelo que no las soporta.
      // Esperamos error insufficient_personas porque las dos fallan inmediato.
      let caughtErr = null;
      try {
        await invoke({
          councilConfig: {
            name: 'all-broken',
            personas: [
              {
                id: 'broken1',
                actua_como: 'aaaaaaaaaa',
                model: 'deepseek/deepseek-r1',
                tools: ['perplexity_research'],
              },
              {
                id: 'broken2',
                actua_como: 'bbbbbbbbbb',
                model: 'deepseek/deepseek-r1',
                tools: ['perplexity_research'],
              },
            ],
            rounds: { round1: { enabled: true } },
          },
          question: 'test',
        });
      } catch (e) { caughtErr = e; }
      assert(caughtErr !== null, 'esperaba que invoke fallara con todas las personas rotas');
      assert(caughtErr instanceof CouncilError, `esperaba CouncilError, obtuve ${caughtErr?.constructor?.name}`);
      assert(caughtErr.code === 'insufficient_personas',
        `esperaba code='insufficient_personas', obtuve ${caughtErr.code}`);
      return;
    }

    // Modo online: 1 persona rota (tools en modelo que no soporta) + 1 viva.
    const result = await invoke({
      councilConfig: {
        name: 'one-broken',
        personas: [
          {
            id: 'broken',
            actua_como: 'Esta persona tiene tools en un modelo que no soporta tools, fallará.',
            model: 'deepseek/deepseek-r1',
            tools: ['perplexity_research'],
          },
          {
            id: 'alive_a',
            actua_como: 'Eres un pragmático. Responde corto.',
            model: 'anthropic/claude-haiku-4.5',
            max_tokens: 200,
          },
          {
            id: 'alive_b',
            actua_como: 'Eres un visionario. Responde corto.',
            model: 'anthropic/claude-haiku-4.5',
            max_tokens: 200,
          },
        ],
        rounds: {
          round1: { enabled: true },
          synthesis: {
            model: 'anthropic/claude-haiku-4.5',
            max_tokens: 800,
            temperature: 0.2,
          },
        },
      },
      question: 'Nombrar app de notas en una palabra.',
    });

    assert(result.metadata.partial === true, `esperaba partial=true, obtuve ${result.metadata.partial}`);
    assert(result.metadata.personas_alive === 2, `esperaba 2 vivas, obtuve ${result.metadata.personas_alive}`);
    assert(result.metadata.personas_total === 3, `esperaba 3 totales, obtuve ${result.metadata.personas_total}`);
    assert(result.personas_responses.round1.length === 2, 'round1 debería tener 2 respuestas (la rota no aparece)');
    const ids = result.personas_responses.round1.map(r => r.persona_id);
    assert(!ids.includes('broken'), `persona "broken" no debería estar en round1, ids=${ids.join(',')}`);
  });

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
