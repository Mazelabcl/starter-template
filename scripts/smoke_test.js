// scripts/smoke_test.js
// Smoke test del starter Mazelab v6.
//
// Corre 4 checks secuenciales que validan que el sistema está listo para arrancar
// un proyecto: API keys presentes, memoria, research a Perplexity (con fuentes) y
// generación de imagen real con gpt-image-2.
//
// Uso:
//   node scripts/smoke_test.js              # completo (~30-90s, gasta API credits)
//   node scripts/smoke_test.js --quick      # salta checks 3-4 (sin red costosa)
//   node scripts/smoke_test.js --verbose    # detalle de request/response/paths
//   node scripts/smoke_test.js --help       # imprime uso y sale 0
//
// Exit code: 0 si todo verde, 1 si algo falla.

import {
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

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
    'Smoke test del starter v6. Valida que el sistema está listo para usar.',
    '',
    'Opciones:',
    '  --quick      Salta checks 3 y 4 (Perplexity + gpt-image-2). Útil para validar',
    '               estructura sin gastar API credits. Corre en pocos segundos.',
    '  --verbose    Imprime detalle de cada check (paths, requests, responses).',
    '  --help, -h   Muestra esta ayuda y sale.',
    '',
    'Checks ejecutados:',
    '  1. Variables de entorno (OPENROUTER_API_KEY, OPENAI_API_KEY presentes)',
    '  2. Memoria del proyecto (writeProfile, addAgent, addDecision, summarize)',
    '  3. Perplexity research vía OpenRouter, con fuentes (skipped en --quick)',
    '  4. gpt-image-2 generación + validación de bytes PNG (skipped en --quick)',
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
// CHECK 2 — Memoria del proyecto
// =============================================================================

async function check2_memory() {
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
    skills_activas: ['image-gen'],
    agentes_activos: [],
    sprint_inicial: 'sprint-smoke-0',
  }, tmpDir);

  memMod.addAgent({
    name: 'smoke-bot',
    role: 'verificador',
    model: 'claude-opus-5-5',
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
// CHECK 3 — Perplexity research vía OpenRouter
// =============================================================================
// Importamos research.js dinámicamente. Si OPENROUTER_API_KEY falta, ese módulo
// hace process.exit(1) al cargarse — pero para llegar aquí ya pasó el check 1.

async function check3_perplexity() {
  // Importación dinámica dentro de la función: si falla por falta de key,
  // queremos que el error sea el del check 3, no que el smoke test entero
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
// CHECK 4 — gpt-image-2 generación
// =============================================================================
// El wrapper Python es la forma canónica del repo. Lo invocamos como subprocess
// usando el venv si existe, con fallback a `python` del sistema.

function detectPython() {
  const venvPyWin = join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
  const venvPyUnix = join(REPO_ROOT, '.venv', 'bin', 'python');
  if (platform() === 'win32' && existsSync(venvPyWin)) return venvPyWin;
  if (platform() !== 'win32' && existsSync(venvPyUnix)) return venvPyUnix;
  // Fallback al python del sistema. En Windows suele ser `python`, en Unix `python3`.
  return platform() === 'win32' ? 'python' : 'python3';
}

async function check4_imageGen() {
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
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('--- Smoke Test Mazelab Starter v6 ---');
  if (FLAGS.quick) console.log('Modo: --quick (salta checks 3 y 4, sin gasto de API)');
  if (FLAGS.verbose) console.log('Modo: --verbose');
  console.log('');

  // Carga .env temprano para que los checks que importen módulos con
  // top-level env reads (research.js) tengan la variable disponible.
  loadEnv();

  if (!FLAGS.quick) {
    console.log('Aviso: el check 3 (Perplexity) puede tomar hasta 30 segundos.');
    console.log('Aviso: el check 4 (gpt-image-2) puede tomar hasta 60 segundos.');
    console.log('Para validar sin gastar API credits corre: node scripts/smoke_test.js --quick\n');
  }

  const TOTAL = 4;
  await runCheck(1, TOTAL, 'Variables de entorno', () => withTimeout(check1_envVars(), 1000, 'envVars'));
  await runCheck(2, TOTAL, 'Memoria del proyecto', () => withTimeout(check2_memory(), 5000, 'memory'));
  await runCheck(3, TOTAL, 'Perplexity research', () => withTimeout(check3_perplexity(), 30000, 'perplexity'),
    { skip: FLAGS.quick, skipReason: '--quick' });
  await runCheck(4, TOTAL, 'gpt-image-2 generación', () => withTimeout(check4_imageGen(), 60000, 'image-gen'),
    { skip: FLAGS.quick, skipReason: '--quick' });

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
