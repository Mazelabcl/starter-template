// councils-config.test.js
// Valida los 4 councils predefinidos en councils/*.json (Sprint 4.3).
//
// Tests:
//  1. Los 4 archivos JSON existen y parsean.
//  2. Cada JSON tiene los campos requeridos: name, description, tier_default,
//     personas, rounds, synthesis (dentro de rounds), post_synthesis.
//  3. Cada council tiene EXACTAMENTE 3 personas.
//  4. Cada persona tiene id (snake_case), actua_como (>=100 chars), model
//     (string), tools (array), temperature (number 0..2).
//  5. Los models referenciados existen en MODELS de openrouter_client (vía
//     `id` flatten o como slug literal cuando la persona usa el id directo).
//  6. tier_default es 1, 2 o 3.
//  7. rounds.round1 y rounds.round2 tienen {enabled, instructions} consistentes.
//  8. synthesis tiene {model, instructions} y synthesis.model existe en MODELS.
//
// Salida: PASS / FAIL por test, exit 0 si todos pasan.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const COUNCILS_DIR = join(REPO_ROOT, 'councils');
const CLIENT_PATH = join(REPO_ROOT, 'src', 'openrouter_client.js');

const COUNCIL_FILES = [
  'creative-ideation.json',
  'architecture-decision.json',
  'strategy-calls.json',
  'mazelab-council.json',
];

const REQUIRED_TOP_FIELDS = ['name', 'description', 'tier_default', 'personas', 'rounds', 'post_synthesis'];
const REQUIRED_PERSONA_FIELDS = ['id', 'actua_como', 'model', 'tools', 'temperature'];

let passed = 0;
let failed = 0;
const fails = [];

function recordPass(label) { console.log(`PASS  ${label}`); passed += 1; }
function recordFail(label, err) {
  console.error(`FAIL  ${label}`);
  console.error(`      ${err?.message || err}`);
  fails.push({ label, error: err?.message || String(err) });
  failed += 1;
}

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

function isSnakeCase(s) {
  return typeof s === 'string' && /^[a-z][a-z0-9_]*$/.test(s);
}

function isKebabCase(s) {
  return typeof s === 'string' && /^[a-z][a-z0-9-]*$/.test(s);
}

async function main() {
  console.log('--- councils-config.test.js ---\n');

  // Carga MODELS desde el cliente.
  let MODELS;
  await check('test 0 — import de MODELS desde src/openrouter_client.js', async () => {
    assert(existsSync(CLIENT_PATH), `no encuentro ${CLIENT_PATH}`);
    const mod = await import(pathToFileURL(CLIENT_PATH).href);
    assert(mod.MODELS && typeof mod.MODELS === 'object', 'MODELS no es objeto');
    MODELS = mod.MODELS;
  });

  // Construye set de slugs válidos en el catálogo.
  const validModelIds = new Set();
  if (MODELS) {
    for (const group of Object.values(MODELS)) {
      for (const m of Object.values(group)) {
        if (m && typeof m.id === 'string') validModelIds.add(m.id);
      }
    }
  }

  for (const file of COUNCIL_FILES) {
    const filePath = join(COUNCILS_DIR, file);
    const label = `[${file}]`;

    let raw;
    let cfg;

    await check(`${label} test 1 — archivo existe`, () => {
      assert(existsSync(filePath), `no existe: ${filePath}`);
      raw = readFileSync(filePath, 'utf8');
    });

    await check(`${label} test 2 — JSON válido`, () => {
      cfg = JSON.parse(raw);
      assert(cfg && typeof cfg === 'object', 'JSON parseado no es objeto');
    });

    if (!cfg) continue;

    await check(`${label} test 3 — campos top-level requeridos`, () => {
      for (const field of REQUIRED_TOP_FIELDS) {
        assert(field in cfg, `falta campo top-level "${field}"`);
      }
      assert(typeof cfg.name === 'string' && cfg.name.length > 0, 'name vacío');
      assert(isKebabCase(cfg.name), `name debe ser kebab-case: "${cfg.name}"`);
      assert(typeof cfg.description === 'string' && cfg.description.length >= 30, 'description muy corta o ausente');
    });

    await check(`${label} test 4 — tier_default válido`, () => {
      assert([1, 2, 3].includes(cfg.tier_default), `tier_default debe ser 1, 2 o 3, obtuve ${cfg.tier_default}`);
    });

    await check(`${label} test 5 — exactamente 3 personas`, () => {
      assert(Array.isArray(cfg.personas), 'personas no es array');
      assert(cfg.personas.length === 3, `esperaba 3 personas, obtuve ${cfg.personas.length}`);
    });

    await check(`${label} test 6 — cada persona tiene campos requeridos y formato correcto`, () => {
      const ids = new Set();
      for (let i = 0; i < cfg.personas.length; i += 1) {
        const p = cfg.personas[i];
        for (const field of REQUIRED_PERSONA_FIELDS) {
          assert(field in p, `persona[${i}] falta campo "${field}"`);
        }
        assert(typeof p.id === 'string' && isSnakeCase(p.id), `persona[${i}].id debe ser snake_case: "${p.id}"`);
        assert(!ids.has(p.id), `persona id duplicado: "${p.id}"`);
        ids.add(p.id);

        assert(typeof p.actua_como === 'string', `persona[${i}].actua_como no es string`);
        assert(p.actua_como.length >= 100, `persona[${i}] (${p.id}).actua_como muy genérico (${p.actua_como.length} chars, mínimo 100)`);

        assert(typeof p.model === 'string' && p.model.length > 0, `persona[${i}].model vacío`);
        assert(Array.isArray(p.tools), `persona[${i}].tools no es array`);
        assert(typeof p.temperature === 'number' && p.temperature >= 0 && p.temperature <= 2,
          `persona[${i}].temperature fuera de rango [0,2]: ${p.temperature}`);
      }
    });

    await check(`${label} test 7 — modelos de personas existen en MODELS`, () => {
      for (const p of cfg.personas) {
        assert(validModelIds.has(p.model),
          `persona ${p.id}: model "${p.model}" no existe en MODELS de openrouter_client. Slugs válidos: ${[...validModelIds].join(', ')}`);
      }
    });

    await check(`${label} test 8 — rounds.round1 enabled con instructions`, () => {
      assert(cfg.rounds && typeof cfg.rounds === 'object', 'rounds no es objeto');
      assert(cfg.rounds.round1 && typeof cfg.rounds.round1 === 'object', 'rounds.round1 falta');
      assert(cfg.rounds.round1.enabled === true, 'round1.enabled debe ser true');
      assert(typeof cfg.rounds.round1.instructions === 'string' && cfg.rounds.round1.instructions.length >= 30,
        'round1.instructions muy corta o ausente');
    });

    await check(`${label} test 9 — rounds.round2 estructura correcta`, () => {
      assert(cfg.rounds.round2 && typeof cfg.rounds.round2 === 'object', 'rounds.round2 falta');
      assert(typeof cfg.rounds.round2.enabled === 'boolean', 'round2.enabled debe ser boolean');
      assert(typeof cfg.rounds.round2.instructions === 'string', 'round2.instructions debe estar presente (aunque round2 esté disabled)');
      // Tier 1 → round2 disabled. Tier 2 y 3 → round2 enabled.
      if (cfg.tier_default === 1) {
        assert(cfg.rounds.round2.enabled === false, `tier 1 debería tener round2.enabled=false (council ${cfg.name})`);
      } else {
        assert(cfg.rounds.round2.enabled === true, `tier ${cfg.tier_default} debería tener round2.enabled=true (council ${cfg.name})`);
      }
    });

    await check(`${label} test 10 — synthesis con model válido e instructions`, () => {
      assert(cfg.rounds.synthesis && typeof cfg.rounds.synthesis === 'object', 'rounds.synthesis falta');
      assert(typeof cfg.rounds.synthesis.model === 'string', 'synthesis.model no es string');
      assert(validModelIds.has(cfg.rounds.synthesis.model),
        `synthesis.model "${cfg.rounds.synthesis.model}" no existe en MODELS`);
      assert(typeof cfg.rounds.synthesis.instructions === 'string' && cfg.rounds.synthesis.instructions.length >= 50,
        'synthesis.instructions muy corta o ausente');
    });

    await check(`${label} test 11 — post_synthesis.confidence_loop es boolean`, () => {
      assert(cfg.post_synthesis && typeof cfg.post_synthesis === 'object', 'post_synthesis falta');
      assert(typeof cfg.post_synthesis.confidence_loop === 'boolean',
        'post_synthesis.confidence_loop debe ser boolean');
      // Convención: confidence_loop=true solo en Tier 3.
      if (cfg.post_synthesis.confidence_loop === true) {
        assert(cfg.tier_default === 3,
          `confidence_loop=true solo se recomienda para Tier 3 (council ${cfg.name} es tier ${cfg.tier_default})`);
      }
    });
  }

  // Test final: README y USAGE-EXAMPLES existen.
  await check('test final — councils/README.md existe', () => {
    assert(existsSync(join(COUNCILS_DIR, 'README.md')), 'falta councils/README.md');
  });
  await check('test final — councils/USAGE-EXAMPLES.md existe', () => {
    assert(existsSync(join(COUNCILS_DIR, 'USAGE-EXAMPLES.md')), 'falta councils/USAGE-EXAMPLES.md');
  });

  // Resumen.
  console.log(`\n--- summary ---`);
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\nfailures:');
    for (const f of fails) {
      console.log(`  - ${f.label}: ${f.error}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('test runner crashed:', e);
  process.exit(2);
});
