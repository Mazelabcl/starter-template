// image-explorer.test.js
// Tests del explorador multi-modelo (src/image_explorer.js + src/replicate_client.js).
//
// Tests:
//  1. Catálogo MODELS_IMG bien estructurado.
//  2. Validación de API keys (lanza error claro si falta REPLICATE_API_TOKEN
//     y se piden modelos Replicate).
//  3. compareGrid genera HTML válido a partir de un index.json mock.
//  4. pickWinner copia archivos correctamente.
//  5. Live (REPLICATE_API_TOKEN): genera 1 imagen con flux-schnell, archivo > 50KB.
//  6. Live (OPENAI_API_KEY): genera 1 imagen con gpt-image-2 vía script Python.
//
// PASS / FAIL / SKIP por test. exit 0 si nada falló (skips no son fail).

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const EXPLORER_PATH = join(REPO_ROOT, 'src', 'image_explorer.js');
const REPLICATE_PATH = join(REPO_ROOT, 'src', 'replicate_client.js');

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
  try { await fn(); recordPass(label); }
  catch (e) { recordFail(label, e); }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// .env loader (mirror del patrón de openrouter-client.test.js)
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

function isPlaceholder(v) {
  return !v || /pega-aqui-tu-key|your-?key-?here|placeholder|optional-/i.test(v);
}

function hasReplicateKey() {
  return !isPlaceholder(process.env.REPLICATE_API_TOKEN);
}
function hasOpenAIKey() {
  return !isPlaceholder(process.env.OPENAI_API_KEY);
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('--- image-explorer.test.js ---\n');
  loadEnv();

  // -------- Test 1: catálogo MODELS_IMG bien estructurado
  let mod;
  await check('test 1 — catálogo MODELS_IMG estructura correcta', async () => {
    assert(existsSync(EXPLORER_PATH), `no encuentro ${EXPLORER_PATH}`);
    assert(existsSync(REPLICATE_PATH), `no encuentro ${REPLICATE_PATH}`);
    mod = await import(pathToFileURL(EXPLORER_PATH).href);
    assert(typeof mod.explore === 'function', 'explore no es función');
    assert(typeof mod.compareGrid === 'function', 'compareGrid no es función');
    assert(typeof mod.pickWinner === 'function', 'pickWinner no es función');
    assert(typeof mod.validateKeys === 'function', 'validateKeys no es función');
    assert(typeof mod.estimateExplorationCost === 'function', 'estimateExplorationCost no es función');
    assert(mod.MODELS_IMG && typeof mod.MODELS_IMG === 'object', 'MODELS_IMG no es objeto');

    // Modelos requeridos
    const required = ['gpt-image-2', 'flux-1.1-pro', 'flux-schnell', 'imagen-3', 'ideogram-v2', 'recraft-v3'];
    for (const id of required) {
      assert(mod.MODELS_IMG[id], `falta modelo "${id}" en MODELS_IMG`);
    }

    // Campos requeridos por modelo
    const fields = ['id', 'provider', 'cost_estimate_usd', 'capabilities', 'strengths', 'weaknesses', 'output_format'];
    for (const [id, m] of Object.entries(mod.MODELS_IMG)) {
      for (const f of fields) {
        assert(f in m, `modelo ${id} no tiene campo "${f}"`);
      }
      assert(['openai', 'replicate'].includes(m.provider), `provider inválido en ${id}: ${m.provider}`);
      assert(typeof m.cost_estimate_usd === 'number' && m.cost_estimate_usd > 0, `cost_estimate_usd inválido en ${id}`);
      assert(Array.isArray(m.capabilities), `capabilities no es array en ${id}`);
      if (m.provider === 'replicate') {
        assert(typeof m.replicate_model === 'string' && m.replicate_model.includes('/'),
          `${id}: replicate_model debe ser "owner/name", obtuve "${m.replicate_model}"`);
        assert(typeof m.input_builder === 'function', `${id}: replicate model debe tener input_builder()`);
      }
    }

    // estimateExplorationCost sanity
    const cost = mod.estimateExplorationCost({ models: ['flux-schnell', 'flux-1.1-pro'], count: 1 });
    assert(typeof cost.total_usd === 'number' && cost.total_usd > 0, 'estimateExplorationCost.total_usd inválido');
    assert(Array.isArray(cost.breakdown) && cost.breakdown.length === 2, 'breakdown malformado');
  });

  if (!mod) {
    summary();
    process.exit(failed > 0 ? 1 : 0);
  }

  // -------- Test 2: validateKeys lanza error claro
  await check('test 2 — validateKeys lanza error claro si falta key', () => {
    // Forzamos limpieza temporal de env
    const savedReplicate = process.env.REPLICATE_API_TOKEN;
    const savedOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.OPENAI_API_KEY;

    let err = null;
    try {
      mod.validateKeys(['flux-1.1-pro']);
    } catch (e) { err = e; }
    // Restaura ANTES de assertar (defensivo)
    if (savedReplicate !== undefined) process.env.REPLICATE_API_TOKEN = savedReplicate;
    if (savedOpenAI !== undefined) process.env.OPENAI_API_KEY = savedOpenAI;

    assert(err !== null, 'validateKeys con flux-1.1-pro y sin REPLICATE_API_TOKEN no lanzó error');
    assert(err.code === 'missing_keys', `code esperado "missing_keys", obtuve "${err.code}"`);
    assert(/REPLICATE_API_TOKEN/.test(err.message), `mensaje no menciona REPLICATE_API_TOKEN: ${err.message}`);

    // Caso 2: modelo desconocido
    let err2 = null;
    try { mod.validateKeys(['this-model-does-not-exist']); } catch (e) { err2 = e; }
    assert(err2 !== null, 'validateKeys con modelo desconocido no lanzó error');
    assert(/desconocido|Modelo desconocido/i.test(err2.message), `mensaje raro: ${err2.message}`);
  });

  // -------- Test 3: compareGrid genera HTML válido a partir de mock
  await check('test 3 — compareGrid genera HTML standalone válido', async () => {
    const tmpDir = join(tmpdir(), `image-explorer-test-${Date.now()}-grid`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      // Crea un PNG fake (1 byte) para que el src del img exista (no se lee igual)
      const fakePng1 = join(tmpDir, 'flux-schnell.png');
      const fakePng2 = join(tmpDir, 'imagen-3.jpg');
      writeFileSync(fakePng1, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(fakePng2, Buffer.from([0xff, 0xd8, 0xff]));

      const mockIndex = {
        version: 1,
        created_at: new Date().toISOString(),
        prompt: 'a cat reading a book in a sunlit library',
        options: { aspect_ratio: '1:1' },
        output_dir: tmpDir,
        models_requested: ['flux-schnell', 'imagen-3', 'recraft-v3'],
        models_run: ['flux-schnell', 'imagen-3'],
        models_skipped: [{ model: 'recraft-v3', reason: 'falta REPLICATE_API_TOKEN' }],
        count_per_model: 1,
        parallelism: 4,
        results: [
          { ok: true, model: 'flux-schnell', provider: 'replicate', filename: 'flux-schnell.png', path: fakePng1, bytes: 4, cost_usd: 0.003, elapsed_ms: 1234 },
          { ok: true, model: 'imagen-3', provider: 'replicate', filename: 'imagen-3.jpg', path: fakePng2, bytes: 3, cost_usd: 0.05, elapsed_ms: 2345 },
          { ok: false, model: 'fake-fail', provider: 'replicate', filename: 'fake-fail.png', error: 'algo se rompió', elapsed_ms: 100 },
        ],
        summary: {
          total_jobs: 3, successes: 2, failures: 1,
          total_cost_usd_estimated: 0.053, wall_time_ms_max: 2345,
        },
      };
      writeFileSync(join(tmpDir, 'index.json'), JSON.stringify(mockIndex, null, 2));

      const htmlPath = await mod.compareGrid(tmpDir);
      assert(existsSync(htmlPath), 'grid.html no se creó');
      const html = readFileSync(htmlPath, 'utf8');

      // Estructura mínima
      assert(/<!DOCTYPE html>/i.test(html), 'no es HTML5');
      assert(/<title>/i.test(html), 'no tiene title');
      assert(/<style>/i.test(html), 'no tiene <style> embebido (debe ser standalone)');
      // Los 3 modelos deben aparecer
      assert(html.includes('flux-schnell'), 'no menciona flux-schnell');
      assert(html.includes('imagen-3'), 'no menciona imagen-3');
      assert(html.includes('fake-fail'), 'no menciona el modelo fallido');
      // Mensaje de fail visible
      assert(/algo se rompió|FALLO|fail/i.test(html), 'no muestra el error del modelo fallido');
      // Skipped info
      assert(html.includes('recraft-v3'), 'no menciona recraft-v3 en skipped');
      // Sin links externos a CDNs (standalone)
      assert(!/<link rel="stylesheet"\s+href="http/i.test(html), 'tiene CSS externo, debería ser standalone');
      // Source de las imágenes apunta a los filenames locales
      assert(html.includes('flux-schnell.png') || html.includes('flux-schnell.png'.replace(/\./g, '%2E')),
        'no referencia el filename local del PNG');
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // -------- Test 4: pickWinner copia archivos correctamente
  await check('test 4 — pickWinner copia archivos y crea winner.json', async () => {
    const tmpDir = join(tmpdir(), `image-explorer-test-${Date.now()}-pick`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      // Dos PNGs fake con bytes distintos para verificar que copia el correcto
      const a = join(tmpDir, 'flux-1.1-pro.png');
      const b = join(tmpDir, 'imagen-3.jpg');
      const bytesA = Buffer.from('AAA-flux-content');
      const bytesB = Buffer.from('BBB-imagen-content');
      writeFileSync(a, bytesA);
      writeFileSync(b, bytesB);

      const mockIndex = {
        version: 1,
        created_at: new Date().toISOString(),
        prompt: 'test prompt',
        options: {},
        output_dir: tmpDir,
        models_requested: ['flux-1.1-pro', 'imagen-3'],
        models_run: ['flux-1.1-pro', 'imagen-3'],
        models_skipped: [],
        count_per_model: 1,
        parallelism: 4,
        results: [
          { ok: true, model: 'flux-1.1-pro', provider: 'replicate', filename: 'flux-1.1-pro.png', path: a, bytes: bytesA.length, cost_usd: 0.04, elapsed_ms: 1000 },
          { ok: true, model: 'imagen-3', provider: 'replicate', filename: 'imagen-3.jpg', path: b, bytes: bytesB.length, cost_usd: 0.05, elapsed_ms: 1500 },
        ],
        summary: { total_jobs: 2, successes: 2, failures: 0, total_cost_usd_estimated: 0.09, wall_time_ms_max: 1500 },
      };
      writeFileSync(join(tmpDir, 'index.json'), JSON.stringify(mockIndex));

      const meta = await mod.pickWinner(tmpDir, 'imagen-3');
      assert(meta.model === 'imagen-3', `winner.model esperado imagen-3, obtuve ${meta.model}`);
      assert(meta.source_filename === 'imagen-3.jpg', `source_filename incorrecto: ${meta.source_filename}`);

      // winner.png debe existir (canónico)
      const winnerPng = join(tmpDir, 'winner.png');
      assert(existsSync(winnerPng), 'no se creó winner.png');
      // Y debe tener los bytes del imagen-3 (no del flux)
      const copied = readFileSync(winnerPng);
      assert(copied.equals(bytesB), 'winner.png tiene bytes equivocados (no copió imagen-3)');

      // winner.json
      const winnerJsonPath = join(tmpDir, 'winner.json');
      assert(existsSync(winnerJsonPath), 'no se creó winner.json');
      const wj = JSON.parse(readFileSync(winnerJsonPath, 'utf8'));
      assert(wj.model === 'imagen-3', `winner.json.model incorrecto: ${wj.model}`);
      assert(typeof wj.picked_at === 'string', 'winner.json.picked_at falta');

      // pickWinner con modelo no-OK debe fallar limpio
      let err = null;
      try { await mod.pickWinner(tmpDir, 'flux-schnell'); } catch (e) { err = e; }
      assert(err !== null, 'pickWinner con modelo no-presente debería fallar');
      assert(/no hay output/i.test(err.message), `mensaje raro: ${err.message}`);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // -------- Test 5: live flux-schnell (Replicate)
  if (!hasReplicateKey()) {
    recordSkip('test 5 — live flux-schnell (Replicate)', 'sin REPLICATE_API_TOKEN válido');
  } else {
    await check('test 5 — live: flux-schnell genera PNG > 50KB', async () => {
      const tmpDir = join(tmpdir(), `image-explorer-test-${Date.now()}-flux`);
      mkdirSync(tmpDir, { recursive: true });
      try {
        const idx = await mod.explore({
          prompt: 'A simple geometric pattern of red and blue squares on a white background, minimalist',
          models: ['flux-schnell'],
          count: 1,
          output_dir: tmpDir,
          options: { aspect_ratio: '1:1' },
        });
        assert(idx.summary.successes === 1, `esperaba 1 success, obtuve ${idx.summary.successes}. Failures: ${JSON.stringify(idx.results.filter(r => !r.ok))}`);
        const result = idx.results[0];
        assert(result.ok, 'result no OK');
        assert(existsSync(result.path), `archivo no existe: ${result.path}`);
        const sz = statSync(result.path).size;
        assert(sz > 50_000, `archivo solo ${sz} bytes, esperaba > 50KB`);
        // index.json existe
        assert(existsSync(join(tmpDir, 'index.json')), 'no se creó index.json');
        // grid.html existe
        assert(existsSync(join(tmpDir, 'grid.html')), 'no se creó grid.html');
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });
  }

  // -------- Test 6: live gpt-image-2 (OpenAI vía script Python)
  if (!hasOpenAIKey()) {
    recordSkip('test 6 — live gpt-image-2', 'sin OPENAI_API_KEY válida');
  } else if (!existsSync(join(REPO_ROOT, 'scripts', 'openai_images.py'))) {
    recordSkip('test 6 — live gpt-image-2', 'falta scripts/openai_images.py');
  } else {
    // También requiere que el venv tenga `openai` instalado. Si no, el script fallará claro.
    await check('test 6 — live: gpt-image-2 genera PNG > 50KB vía Python', async () => {
      const tmpDir = join(tmpdir(), `image-explorer-test-${Date.now()}-openai`);
      mkdirSync(tmpDir, { recursive: true });
      try {
        const idx = await mod.explore({
          prompt: 'A minimal red circle on a white background',
          models: ['gpt-image-2'],
          count: 1,
          output_dir: tmpDir,
          options: { aspect_ratio: '1:1' },
        });
        assert(idx.summary.successes === 1,
          `esperaba 1 success, obtuve ${idx.summary.successes}. Errores: ${idx.results.filter(r => !r.ok).map(r => r.error).join(' | ')}`);
        const result = idx.results[0];
        assert(existsSync(result.path), `archivo no existe: ${result.path}`);
        const sz = statSync(result.path).size;
        assert(sz > 50_000, `archivo solo ${sz} bytes, esperaba > 50KB`);
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
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
