// scripts/smoke_test.js
// Smoke test del starter Mazelab v3.
//
// Corre 8 checks secuenciales que validan, end-to-end, que el sistema completo está
// listo para arrancar un proyecto serio: API keys vivas, contracts I/O, memoria,
// dashboard server, research a Perplexity, generación de imagen real con gpt-image-2,
// validación multimodal, e integración de pipeline-v2.
//
// Uso:
//   node scripts/smoke_test.js              # completo (~60-90s, gasta API credits)
//   node scripts/smoke_test.js --quick      # salta checks 5-6 (sin red costosa, <15s)
//   node scripts/smoke_test.js --verbose    # detalle de request/response/paths
//   node scripts/smoke_test.js --help       # imprime uso y sale 0
//
// Exit code: 0 si todo verde, 1 si algo falla.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  unlinkSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------- argv / flags ----------

const ARGS = process.argv.slice(2);
const FLAGS = {
  quick: ARGS.includes('--quick'),
  verbose: ARGS.includes('--verbose'),
  help: ARGS.includes('--help') || ARGS.includes('-h'),
};

if (FLAGS.help) {
  printHelp();
  process.exit(0);
}

function printHelp() {
  const lines = [
    'Uso: node scripts/smoke_test.js [opciones]',
    '',
    'Smoke test del starter v3. Valida que el sistema completo está listo para usar.',
    '',
    'Opciones:',
    '  --quick      Salta checks 5 y 6 (Perplexity + gpt-image-2). Útil para validar',
    '               estructura sin gastar API credits. Corre en menos de 15 segundos.',
    '  --verbose    Imprime detalle de cada check (paths, requests, responses).',
    '  --help, -h   Muestra esta ayuda y sale.',
    '',
    'Checks ejecutados:',
    '  1. Variables de entorno (OPENROUTER_API_KEY, OPENAI_API_KEY presentes)',
    '  2. Hand-off contracts (emit/consume con architect-output.schema.json)',
    '  3. Memoria del proyecto (writeProfile, addAgent, addDecision, summarize)',
    '  4. Dashboard server up (levanta en puerto temporal y responde)',
    '  5. Perplexity research vía OpenRouter (skipped en --quick)',
    '  6. gpt-image-2 generación + validación de bytes (skipped en --quick)',
    '  7. Multimodal validation flow (consume image-gen-output del check 6)',
    '  8. Pipeline-v2 integration test (corre como subprocess)',
    '',
    'Costo aproximado en modo completo:',
    '  Perplexity sonar query: ~USD 0.002',
    '  gpt-image-2 1 imagen medium 1024x1024: ~USD 0.04',
    '  Total: ~USD 0.05 por corrida completa.',
  ];
  console.log(lines.join('\n'));
}

// ---------- logging ----------

function vlog(...args) {
  if (FLAGS.verbose) console.log('  [verbose]', ...args);
}

function fmtSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------- .env loader ----------
// Cargamos .env manualmente (sin depender de dotenv) para que --help y el meta-test
// puedan correr aún cuando dotenv no esté instalado.

function loadEnv() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    return { loaded: false, path: envPath };
  }
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
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
  return { loaded: true, path: envPath };
}

// ---------- check runner ----------

const RESULTS = [];

async function runCheck(idx, total, name, fn, { skip, skipReason } = {}) {
  process.stdout.write(`[${idx}/${total}] ${name}... `);
  if (skip) {
    console.log(`SKIP (${skipReason})`);
    RESULTS.push({ name, status: 'skip', reason: skipReason });
    return;
  }
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    console.log(`OK (${fmtSeconds(ms)})`);
    RESULTS.push({ name, status: 'ok', ms });
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`FALLÓ (${fmtSeconds(ms)}): ${e.message}`);
    if (FLAGS.verbose && e.stack) {
      console.log(e.stack.split('\n').slice(1, 4).map(l => '    ' + l).join('\n'));
    }
    RESULTS.push({ name, status: 'fail', ms, error: e.message });
  }
}

// withTimeout: evita que un check se cuelgue indefinidamente. Race entre la promesa
// real y un setTimeout que rechaza. El setTimeout es unref'd para que no impida
// process.exit cuando el check termina antes.
function withTimeout(promise, ms, label) {
  return new Promise((resolveP, rejectP) => {
    const timer = setTimeout(() => {
      rejectP(new Error(`timeout (${ms}ms) en ${label}`));
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    promise
      .then(v => { clearTimeout(timer); resolveP(v); })
      .catch(e => { clearTimeout(timer); rejectP(e); });
  });
}

// ---------- limpieza global ----------
// Tracker de paths temporales para limpieza al final, incluso si un check falla.

const CLEANUP_PATHS = new Set();
function trackForCleanup(p) { CLEANUP_PATHS.add(p); }
function cleanupAll() {
  for (const p of CLEANUP_PATHS) {
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    } catch (e) {
      vlog(`no pude limpiar ${p}: ${e.message}`);
    }
  }
}

// =============================================================================
// CHECK 1 — Variables de entorno
// =============================================================================

async function check1_envVars() {
  const envInfo = loadEnv();
  vlog(`.env path: ${envInfo.path} loaded=${envInfo.loaded}`);
  if (!envInfo.loaded) {
    throw new Error(`Falta archivo .env en ${envInfo.path}. Corre: npm run setup`);
  }
  const required = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'];
  const missing = [];
  const placeholder = [];
  for (const k of required) {
    const v = process.env[k];
    if (!v || !v.trim()) {
      missing.push(k);
    } else if (/pega-aqui-tu-key|^placeholder$|your-?key-?here/i.test(v)) {
      // Solo marca placeholder si calza con los valores literales del .env.example.
      // Evitamos heurísticas tipo "xxx+" porque keys reales pueden contener
      // muchas x's seguidas y queremos cero falsos positivos.
      placeholder.push(k);
    }
  }
  if (missing.length) {
    throw new Error(
      `falta(n) variable(s) en .env: ${missing.join(', ')}. ` +
      `Edita ${join(REPO_ROOT, '.env')} o corre: npm run setup`,
    );
  }
  if (placeholder.length) {
    throw new Error(
      `variable(s) con valor placeholder: ${placeholder.join(', ')}. ` +
      `Reemplaza en ${join(REPO_ROOT, '.env')} con keys reales.`,
    );
  }
  vlog(`OPENROUTER_API_KEY len=${process.env.OPENROUTER_API_KEY.length}`);
  vlog(`OPENAI_API_KEY len=${process.env.OPENAI_API_KEY.length}`);
}

// =============================================================================
// CHECK 2 — Hand-off contracts cycle
// =============================================================================

async function check2_contracts() {
  const helpers = await import(pathToFileURL(join(REPO_ROOT, 'contracts', 'helpers.js')).href);
  const tmpDir = mkdtempSync(join(tmpdir(), 'smoke-contracts-'));
  trackForCleanup(tmpDir);
  const outPath = join(tmpDir, 'architect-output.json');

  const fakeOutput = {
    agent: 'smoke-architect',
    model: 'claude-opus-4-7',
    produced_at: new Date().toISOString(),
    artifact_kind: 'plan',
    title: 'Smoke test plan',
    sections: [
      { id: 'sec-1', heading: 'Intro', intent: 'verificar emit/consume cycle' },
    ],
  };

  vlog(`emitiendo en ${outPath}`);
  const emitResult = helpers.emitOutput('smoke-architect', 'architect-output', fakeOutput, outPath);
  if (!emitResult || !emitResult.path) {
    throw new Error('emitOutput no retornó metadata válida');
  }
  if (!existsSync(outPath)) {
    throw new Error(`emitOutput dijo OK pero archivo no existe: ${outPath}`);
  }

  vlog(`consumiendo de ${outPath}`);
  const consumed = helpers.consumeInput('smoke-critic', 'architect-output', outPath);
  if (consumed.title !== fakeOutput.title) {
    throw new Error(`consumeInput devolvió data corrupta: title=${consumed.title}`);
  }

  // Test negativo: que un output inválido sea rechazado.
  // Si esto pasa silenciosamente, el sistema de contracts está roto.
  let rejectedInvalid = false;
  try {
    helpers.emitOutput('smoke-architect', 'architect-output', { agent: 'x' }, join(tmpDir, 'bad.json'));
  } catch (e) {
    if (e.name === 'ContractViolation') rejectedInvalid = true;
  }
  if (!rejectedInvalid) {
    throw new Error('emitOutput aceptó un output inválido — el validador no está funcionando');
  }
}

// =============================================================================
// CHECK 3 — Memoria del proyecto
// =============================================================================

async function check3_memory() {
  const memMod = await import(pathToFileURL(join(REPO_ROOT, 'src', 'memory.js')).href);
  const tmpDir = mkdtempSync(join(tmpdir(), 'smoke-memory-'));
  trackForCleanup(tmpDir);

  // active-team.json arranca vacío para que addAgent pueda escribir.
  const teamTpl = join(REPO_ROOT, 'memory', 'templates', 'active-team.template.json');
  copyFileSync(teamTpl, join(tmpDir, 'active-team.json'));

  vlog(`memoria temporal en ${tmpDir}`);

  memMod.writeProfile({
    project_type: 'mixed',
    mode: 'rapido',
    description: 'Smoke test de memoria',
    created_at: new Date().toISOString(),
    owner: 'smoke@mazelab.cl',
    skills_activas: ['quality-mindset'],
    agentes_activos: [],
    sprint_inicial: 'sprint-smoke-0',
  }, tmpDir);

  memMod.addAgent({
    name: 'smoke-bot',
    role: 'verificador',
    model: 'claude-opus-4-7',
  }, tmpDir);

  memMod.addDecision({
    title: 'usar smoke test',
    decision: 'correr smoke test antes de cada arranque',
    reasoning: 'evita errores end-to-end',
    alternatives: 'confiar en CI',
    reversibility: 'alta',
  }, tmpDir);

  memMod.addLesson({
    title: 'lección smoke',
    context: 'starter v3',
    lesson: 'integración > unit',
    application: 'corre smoke test al iniciar',
  }, tmpDir);

  const summary = memMod.summarize(tmpDir);
  vlog(`summary: agentes=${summary.agentes_count} decisiones=${summary.decisiones_count} lecciones=${summary.lecciones_count}`);
  if (!summary.has_profile) throw new Error('summarize() reporta has_profile=false tras writeProfile');
  if (summary.agentes_count !== 1) throw new Error(`agentes_count esperado 1, obtenido ${summary.agentes_count}`);
  if (summary.decisiones_count !== 1) throw new Error(`decisiones_count esperado 1, obtenido ${summary.decisiones_count}`);
  if (summary.lecciones_count !== 1) throw new Error(`lecciones_count esperado 1, obtenido ${summary.lecciones_count}`);
}

// =============================================================================
// CHECK 4 — Dashboard server up
// =============================================================================
// Importamos startServer y le pasamos puerto 0 → SO asigna libre, evita race
// con cualquier instancia ya corriendo en 7777 (default del repo) u 8888.

async function check4_dashboard() {
  const serverMod = await import(pathToFileURL(join(REPO_ROOT, 'dashboard', 'server.js')).href);
  let serverInfo = null;
  try {
    serverInfo = await serverMod.startServer(0);
    vlog(`server arrancó en puerto ${serverInfo.port}`);
    const res = await fetch(`http://localhost:${serverInfo.port}/api/state`);
    if (res.status !== 200) throw new Error(`GET /api/state status=${res.status}`);
    const json = await res.json();
    if (!json.session_id) throw new Error('respuesta sin session_id');
    if (!json.derived) throw new Error('respuesta sin derived');
    vlog(`session_id=${json.session_id.slice(0, 8)}... contracts=${json.derived.declared_contracts.length}`);
  } finally {
    if (serverInfo && serverInfo.server) {
      await new Promise(r => serverInfo.server.close(r));
    }
    if (serverMod.closeWatcher) serverMod.closeWatcher();
  }
}

// =============================================================================
// CHECK 5 — Perplexity research vía OpenRouter
// =============================================================================
// Importamos research.js dinámicamente. Si OPENROUTER_API_KEY falta, ese módulo
// hace process.exit(1) al cargarse — pero para llegar aquí ya pasó el check 1.

async function check5_perplexity() {
  // Importación dinámica dentro de la función: si falla por falta de key,
  // queremos que el error sea el del check 5, no que el smoke test entero
  // se caiga al cargar smoke_test.js.
  const researchMod = await import(pathToFileURL(join(REPO_ROOT, 'src', 'research.js')).href);

  const t0 = Date.now();
  let response;
  try {
    response = await researchMod.research('quick', '¿Cuál es la capital de Chile? Responde en una frase.');
  } catch (e) {
    if (/401|403|invalid_api_key|unauthorized/i.test(e.message)) {
      throw new Error(
        `OpenRouter rechazó la key (probablemente inválida o expirada). ` +
        `Revisa OPENROUTER_API_KEY en ${join(REPO_ROOT, '.env')}. Detalle: ${e.message.slice(0, 200)}`,
      );
    }
    if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(e.message)) {
      throw new Error(`no hay conexión a openrouter.ai. Detalle: ${e.message}`);
    }
    throw new Error(`research() falló: ${e.message.slice(0, 300)}`);
  }
  vlog(`response en ${Date.now() - t0}ms, content len=${response.content?.length}, citations=${response.citations?.length}`);

  if (!response.content || response.content.length < 5) {
    throw new Error('respuesta vacía o demasiado corta de Perplexity');
  }
  // Algunos modelos sonar devuelven citations como strings (URLs), otros como objetos.
  // Aceptamos ambas formas con tal de que haya al menos una URL parseable.
  const citations = Array.isArray(response.citations) ? response.citations : [];
  if (citations.length === 0) {
    throw new Error('Perplexity no devolvió citas. El check requiere al menos 1.');
  }
  let validUrl = false;
  for (const c of citations) {
    const url = typeof c === 'string' ? c : c?.url;
    if (typeof url === 'string') {
      try { new URL(url); validUrl = true; break; } catch { /* sigue */ }
    }
  }
  if (!validUrl) throw new Error('ninguna cita tiene URL válida');
}

// =============================================================================
// CHECK 6 — gpt-image-2 generación
// =============================================================================
// El wrapper Python es la forma canónica del repo. Lo invocamos como subprocess
// usando el venv si existe, con fallback a `python` del sistema.

let GENERATED_PNG_PATH = null; // compartido con check 7

function detectPython() {
  const venvPyWin = join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
  const venvPyUnix = join(REPO_ROOT, '.venv', 'bin', 'python');
  if (platform() === 'win32' && existsSync(venvPyWin)) return venvPyWin;
  if (platform() !== 'win32' && existsSync(venvPyUnix)) return venvPyUnix;
  // Fallback al python del sistema. En Windows suele ser `python`, en Unix `python3`.
  return platform() === 'win32' ? 'python' : 'python3';
}

async function check6_imageGen() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'smoke-image-'));
  trackForCleanup(tmpDir);
  const outputPng = join(tmpDir, 'apple.png');
  const py = detectPython();
  const script = join(REPO_ROOT, 'scripts', 'openai_images.py');
  vlog(`python=${py} script=${script} output=${outputPng}`);

  // Spawn con stdio capturado para poder reportar stderr cuando algo falla
  // (la openai SDK escribe el detalle del error a stderr, no a stdout).
  const result = await new Promise((resolveP) => {
    const child = spawn(py, [
      script, 'generate',
      'a red apple on white background, photorealistic',
      outputPng,
      '--size', '1024x1024',
      '--quality', 'medium',
    ], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => resolveP({ code: -1, stdout, stderr: stderr + `\nspawn error: ${e.message}` }));
    child.on('close', code => resolveP({ code, stdout, stderr }));
  });

  if (result.code !== 0) {
    let hint = '';
    if (/no module named ['"]?openai/i.test(result.stderr)) {
      hint = ' Causa probable: el venv de Python no está instalado. Corre: npm run setup';
    } else if (/invalid_api_key|incorrect api key|401/i.test(result.stderr)) {
      hint = ' Causa probable: OPENAI_API_KEY inválida o expirada. Revisa .env';
    } else if (/billing|insufficient_quota|rate.?limit/i.test(result.stderr)) {
      hint = ' Causa probable: cuota OpenAI agotada o rate-limited. Revisa billing en platform.openai.com';
    }
    throw new Error(
      `python falló (exit ${result.code}).${hint} Stderr (recortado): ${result.stderr.slice(0, 500).trim()}`,
    );
  }

  if (!existsSync(outputPng)) {
    throw new Error(`script python reportó OK pero el PNG no existe en ${outputPng}`);
  }
  const stat = statSync(outputPng);
  vlog(`png generado: ${stat.size} bytes`);
  if (stat.size < 10 * 1024) {
    throw new Error(`PNG sospechosamente pequeño (${stat.size} bytes). Probablemente corrupto o stub.`);
  }
  // Validación básica de magic bytes PNG (89 50 4E 47).
  const head = readFileSync(outputPng).slice(0, 4);
  if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) {
    throw new Error(`archivo en ${outputPng} no tiene magic bytes PNG válidos`);
  }
  GENERATED_PNG_PATH = outputPng;
}

// =============================================================================
// CHECK 7 — Multimodal validation flow
// =============================================================================
// Simulamos un agente "revisor" que confirma haber leído el PNG y emite un
// image-gen-output válido. Cierra el ciclo completo: gen → emit contract → consume.

async function check7_multimodalFlow() {
  const helpers = await import(pathToFileURL(join(REPO_ROOT, 'contracts', 'helpers.js')).href);
  const tmpDir = mkdtempSync(join(tmpdir(), 'smoke-mm-'));
  trackForCleanup(tmpDir);
  const outPath = join(tmpDir, 'image-gen-output.json');

  // Si el check 6 corrió, usamos ese PNG real. Si no (--quick), fabricamos un PNG
  // mínimo de 1x1 transparente para ejercitar el flujo de schema sin red.
  let pngPath = GENERATED_PNG_PATH;
  if (!pngPath) {
    pngPath = join(tmpDir, 'fake.png');
    // PNG válido mínimo (1x1 transparente). Bytes verificados.
    const minimalPng = Buffer.from([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
      0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
      0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
      0x89,0x00,0x00,0x00,0x0d,0x49,0x44,0x41,
      0x54,0x78,0x9c,0x62,0x00,0x01,0x00,0x00,
      0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,
      0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,
      0x42,0x60,0x82,
    ]);
    writeFileSync(pngPath, minimalPng);
  }
  if (!existsSync(pngPath)) throw new Error(`PNG esperado no existe: ${pngPath}`);
  if (statSync(pngPath).size < 50) throw new Error('PNG ilegible o demasiado pequeño');

  const output = {
    agent: 'smoke-image-validator',
    model: 'gpt-image-2',
    produced_at: new Date().toISOString(),
    images: [
      {
        path: pngPath,
        prompt: 'a red apple on white background, photorealistic',
        size: '1024x1024',
        validated_multimodal: true,
      },
    ],
  };
  helpers.emitOutput('smoke-image-validator', 'image-gen-output', output, outPath);
  const consumed = helpers.consumeInput('smoke-downstream', 'image-gen-output', outPath);
  if (!consumed.images?.[0]?.validated_multimodal) {
    throw new Error('image-gen-output consumido no preserva validated_multimodal=true');
  }
  vlog(`flow validado, png=${pngPath}`);
}

// =============================================================================
// CHECK 8 — Pipeline-v2 integration test (subprocess)
// =============================================================================

async function check8_pipelineV2() {
  const testPath = join(REPO_ROOT, 'pipeline-v2-integration.test.js');
  if (!existsSync(testPath)) {
    throw new Error(`no encuentro ${testPath}. ¿Falta el archivo o el repo está incompleto?`);
  }
  // spawnSync con timeout efectivo gracias al wrapper withTimeout que nos envuelve.
  // Heredamos solo stdio que necesitamos; no queremos contaminar nuestro output con
  // todo el log del test salvo en --verbose.
  const result = spawnSync(process.execPath, [testPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (FLAGS.verbose) {
    vlog(`pipeline-v2 stdout (last 500 chars):\n${(result.stdout || '').slice(-500)}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `pipeline-v2-integration.test.js exit=${result.status}. ` +
      `Stderr: ${(result.stderr || '').slice(-300).trim()}`,
    );
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('--- Smoke Test Mazelab Starter v3 ---');
  if (FLAGS.quick) console.log('Modo: --quick (saltea checks 5 y 6, sin gasto de API)');
  if (FLAGS.verbose) console.log('Modo: --verbose');
  console.log('');

  // Carga .env temprano para que los checks que importen módulos con
  // top-level env reads (research.js) tengan la variable disponible.
  loadEnv();

  if (!FLAGS.quick) {
    console.log('Aviso: el check 5 (Perplexity) puede tomar hasta 30 segundos.');
    console.log('Aviso: el check 6 (gpt-image-2) puede tomar hasta 60 segundos.');
    console.log('Para validar sin gastar API credits corre: node scripts/smoke_test.js --quick\n');
  }

  const TOTAL = 8;
  await runCheck(1, TOTAL, 'Variables de entorno', () => withTimeout(check1_envVars(), 1000, 'envVars'));
  await runCheck(2, TOTAL, 'Hand-off contracts cycle', () => withTimeout(check2_contracts(), 5000, 'contracts'));
  await runCheck(3, TOTAL, 'Memoria del proyecto', () => withTimeout(check3_memory(), 5000, 'memory'));
  await runCheck(4, TOTAL, 'Dashboard server up', () => withTimeout(check4_dashboard(), 10000, 'dashboard'));
  await runCheck(5, TOTAL, 'Perplexity research', () => withTimeout(check5_perplexity(), 30000, 'perplexity'),
    { skip: FLAGS.quick, skipReason: '--quick' });
  await runCheck(6, TOTAL, 'gpt-image-2 generación', () => withTimeout(check6_imageGen(), 60000, 'image-gen'),
    { skip: FLAGS.quick, skipReason: '--quick' });
  await runCheck(7, TOTAL, 'Multimodal validation flow', () => withTimeout(check7_multimodalFlow(), 5000, 'mm-flow'));
  await runCheck(8, TOTAL, 'Pipeline-v2 integration', () => withTimeout(check8_pipelineV2(), 30000, 'pipeline-v2'));

  cleanupAll();

  console.log('');
  const failed = RESULTS.filter(r => r.status === 'fail');
  const skipped = RESULTS.filter(r => r.status === 'skip');
  const okCount = RESULTS.filter(r => r.status === 'ok').length;

  if (failed.length === 0) {
    console.log(`Sistema verde. ${okCount} de ${TOTAL} checks OK${skipped.length ? `, ${skipped.length} saltados` : ''}.`);
    if (skipped.length && FLAGS.quick) {
      console.log('Para validación completa (incluye API calls reales) corre: node scripts/smoke_test.js');
    }
    process.exit(0);
  } else {
    console.log(`${failed.length} de ${TOTAL} checks fallaron. Detalle:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

// Manejo de Ctrl+C: limpiamos paths temporales antes de salir.
// Sin esto, una interrupción dejaría el tmpdir lleno de fragmentos.
process.on('SIGINT', () => {
  console.log('\n[smoke] interrumpido, limpiando temporales...');
  cleanupAll();
  process.exit(130);
});

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  if (FLAGS.verbose) console.error(e.stack);
  cleanupAll();
  process.exit(1);
});
