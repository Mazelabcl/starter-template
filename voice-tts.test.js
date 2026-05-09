// voice-tts.test.js
// Tests para scripts/voice_tts.js — Sprint 4.6 (Voz Nivel 2).
//
// Corre con: node voice-tts.test.js
//
// Tests 1-3 son unitarios y no tocan red.
// Test 4 es live (golpea OpenAI TTS) y se SKIPea si OPENAI_API_KEY no existe.
// Test 5 valida cache dedup — segunda corrida con mismo texto no debe llamar API.
//
// Exit code: 0 si todo PASS o SKIP, 1 si algún FAIL.

import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = __dirname;
const SCRIPT = join(REPO_ROOT, 'scripts', 'voice_tts.js');

// ---------- runner ----------

const RESULTS = [];
let currentTest = null;
const CLEANUP = new Set();

function track(p) { CLEANUP.add(p); }
function cleanupAll() {
  for (const p of CLEANUP) {
    try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function test(name, fn, { skip, skipReason } = {}) {
  currentTest = name;
  process.stdout.write(`[test] ${name}... `);
  if (skip) {
    console.log(`SKIP (${skipReason})`);
    RESULTS.push({ name, status: 'skip', reason: skipReason });
    return;
  }
  try {
    await fn();
    console.log('PASS');
    RESULTS.push({ name, status: 'pass' });
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(1, 4).map(l => '    ' + l).join('\n'));
    RESULTS.push({ name, status: 'fail', error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion falló');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'no coincide'}: esperado=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

// ---------- env loader ----------

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

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('--- voice_tts.js tests ---\n');

  // Importamos el módulo. Como voice_tts.js solo corre main() cuando es entry
  // point, importarlo expone parseArgs, chunkText, stripCodeBlocks, detectPlayer,
  // cacheKey sin efectos colaterales.
  const mod = await import(pathToFileURL(SCRIPT).href);

  // -------------------------------------------------------------------------
  // Test 1: parseo de CLI args
  // -------------------------------------------------------------------------
  await test('1. parseArgs maneja flags básicas correctamente', () => {
    const args = mod.parseArgs([
      '--text', 'hola',
      '--voice', 'onyx',
      '--model', 'tts-1-hd',
      '--speed', '1.5',
      '--no-play',
    ]);
    assertEq(args.text, 'hola', 'text');
    assertEq(args.voice, 'onyx', 'voice');
    assertEq(args.model, 'tts-1-hd', 'model');
    assertEq(args.speed, 1.5, 'speed');
    assertEq(args.play, false, 'play=false con --no-play');

    // Defaults
    const def = mod.parseArgs(['--text', 'x']);
    assertEq(def.voice, 'nova', 'voice default nova');
    assertEq(def.model, 'tts-1', 'model default tts-1');
    assertEq(def.speed, 1.0, 'speed default 1.0');
    assertEq(def.play, true, 'play=true default cuando no hay --output');

    // --output sin --play => play=false
    const withOut = mod.parseArgs(['--text', 'x', '--output', 'a.mp3']);
    assertEq(withOut.play, false, 'play=false cuando hay --output sin --play');

    // --output --play => play=true
    const withBoth = mod.parseArgs(['--text', 'x', '--output', 'a.mp3', '--play']);
    assertEq(withBoth.play, true, 'play=true cuando --output --play');

    // --clear-cache
    const clear = mod.parseArgs(['--clear-cache']);
    assertEq(clear.clearCache, true, 'clearCache=true');

    // --help
    const help = mod.parseArgs(['--help']);
    assertEq(help.help, true, 'help=true');
  });

  // -------------------------------------------------------------------------
  // Test 2: división de texto en chunks respeta oraciones
  // -------------------------------------------------------------------------
  await test('2. chunkText respeta límites de oración y párrafo', () => {
    // Texto corto: un solo chunk.
    assertEq(mod.chunkText('hola mundo', 2000).length, 1, 'texto corto = 1 chunk');

    // Texto vacío: 0 chunks.
    assertEq(mod.chunkText('', 2000).length, 0, 'texto vacío = 0 chunks');
    assertEq(mod.chunkText('   \n\n   ', 2000).length, 0, 'texto solo whitespace = 0 chunks');

    // Texto con párrafos: cada chunk no excede el límite.
    const para1 = 'Esta es la primera oración del párrafo uno. Aquí va la segunda. Y la tercera, un poco más larga, para llenar bytes.';
    const para2 = 'Segundo párrafo arranca acá. Tiene varias oraciones. Cada una termina con punto. La última también termina con punto.';
    const para3 = 'Tercer párrafo. Más oraciones. Otra más. Cierre.';
    const longText = [para1, para2, para3].join('\n\n');
    const chunks = mod.chunkText(longText, 150);
    assert(chunks.length >= 2, `esperaba al menos 2 chunks, obtuve ${chunks.length}`);
    for (const c of chunks) {
      assert(c.length <= 250, `chunk excede el límite con margen razonable: ${c.length} chars`);
      // Cada chunk debería terminar con un signo de cierre o ser parte final.
      const tail = c.trim().slice(-1);
      assert(['.', '!', '?'].includes(tail), `chunk no termina en signo de cierre: "${c.slice(-30)}"`);
    }

    // Reconstrucción: la unión de chunks debe contener todo el texto original.
    const joined = chunks.join(' ').replace(/\s+/g, ' ');
    const orig = longText.replace(/\s+/g, ' ');
    assert(joined.length >= orig.length * 0.95, 'chunks pierden contenido al reunir');
  });

  // -------------------------------------------------------------------------
  // Test 2.5 (extra): stripCodeBlocks
  // -------------------------------------------------------------------------
  await test('2b. stripCodeBlocks remueve bloques ``` y código inline', () => {
    const input = 'Mira este código:\n```js\nconst x = 1;\n```\nY este `inline` también.';
    const out = mod.stripCodeBlocks(input);
    assert(!out.includes('const x = 1'), 'no debería incluir el código del bloque');
    assert(!out.includes('`inline`'), 'no debería incluir backticks de inline');
    assert(out.includes('Mira este código'), 'debería conservar el texto antes del bloque');
    assert(out.includes('omitido'), 'debería marcar el bloque como omitido');
  });

  // -------------------------------------------------------------------------
  // Test 3: detección de plataforma retorna comando esperado
  // -------------------------------------------------------------------------
  await test('3. detectPlayer retorna el comando correcto por plataforma', () => {
    const win = mod.detectPlayer('win32');
    assert(win, 'win32 debe tener player');
    assertEq(win.cmd, 'cmd', 'win32 cmd=cmd');
    assert(win.args.includes('start'), 'win32 args debe incluir start');

    const mac = mod.detectPlayer('darwin');
    assert(mac, 'darwin debe tener player');
    assertEq(mac.cmd, 'afplay', 'darwin cmd=afplay');

    // Linux: depende de qué binario haya. Aceptamos null o cmd válido.
    const lin = mod.detectPlayer('linux');
    if (lin !== null) {
      assert(['mpg123', 'aplay', 'ffplay'].includes(lin.cmd),
        `linux cmd inesperado: ${lin.cmd}`);
    }

    // Plataforma desconocida: null.
    const unknown = mod.detectPlayer('aix');
    assertEq(unknown, null, 'plataforma desconocida = null');
  });

  // -------------------------------------------------------------------------
  // Setup para tests 4 y 5: cargar .env, decidir skip por OPENAI_API_KEY
  // -------------------------------------------------------------------------
  loadEnv();
  const hasKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  const tmpCacheDir = mkdtempSync(join(tmpdir(), 'voice-tts-test-'));
  track(tmpCacheDir);

  // -------------------------------------------------------------------------
  // Test 4 (LIVE): genera audio "hola mundo" y verifica MP3 > 1KB
  // -------------------------------------------------------------------------
  await test('4. (live) genera MP3 de "hola mundo" con voz nova',
    async () => {
      const result = spawnSync(process.execPath, [
        SCRIPT,
        '--text', 'hola mundo, esto es un test',
        '--voice', 'nova',
        '--model', 'tts-1',
        '--no-play',
        '--cache-dir', tmpCacheDir,
      ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 60000,
      });
      if (result.status !== 0) {
        throw new Error(
          `script salió con code ${result.status}. stderr: ${(result.stderr || '').slice(-500)}`,
        );
      }
      // Buscamos el MP3 en el cache.
      const files = readdirSync(tmpCacheDir).filter(f => f.endsWith('.mp3'));
      assert(files.length >= 1, `esperaba al menos 1 MP3 en ${tmpCacheDir}, hay ${files.length}`);
      const fpath = join(tmpCacheDir, files[0]);
      const size = statSync(fpath).size;
      assert(size > 1024, `MP3 sospechosamente pequeño: ${size} bytes`);
    },
    { skip: !hasKey, skipReason: 'OPENAI_API_KEY no presente — test live skipeado' },
  );

  // -------------------------------------------------------------------------
  // Test 5 (LIVE pero usa cache del test 4): segunda llamada con mismo texto
  // no debe golpear API.
  // -------------------------------------------------------------------------
  await test('5. cache dedup — segundo run con mismo texto reutiliza cache',
    async () => {
      // Listamos archivos antes.
      const before = readdirSync(tmpCacheDir).filter(f => f.endsWith('.mp3'));
      assert(before.length >= 1, 'precondición: debe haber al menos 1 MP3 del test 4');
      const beforeMtime = statSync(join(tmpCacheDir, before[0])).mtimeMs;

      // Borramos OPENAI_API_KEY del subproceso para forzar fallo si intenta llamar API.
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      // Pero como el script carga .env por su cuenta, también necesitamos un .env vacío.
      // Truco: pasamos cwd a un dir sin .env y el cache-dir absoluto.
      const isolatedDir = mkdtempSync(join(tmpdir(), 'voice-tts-iso-'));
      track(isolatedDir);

      const result = spawnSync(process.execPath, [
        SCRIPT,
        '--text', 'hola mundo, esto es un test',
        '--voice', 'nova',
        '--model', 'tts-1',
        '--no-play',
        '--cache-dir', tmpCacheDir,
      ], {
        cwd: isolatedDir,
        env,
        encoding: 'utf8',
        timeout: 30000,
      });
      // Si todo fue cache hit, exit 0 sin necesitar API key.
      if (result.status !== 0) {
        throw new Error(
          `segundo run falló con code ${result.status}. ` +
          `stdout: ${(result.stdout || '').slice(-400)}\nstderr: ${(result.stderr || '').slice(-500)}`,
        );
      }
      assert(/cache HIT/i.test(result.stdout), 'stdout debería mencionar "cache HIT"');

      // Mismo número de archivos antes y después (no se generó uno nuevo).
      const after = readdirSync(tmpCacheDir).filter(f => f.endsWith('.mp3'));
      assertEq(after.length, before.length, 'cache no debió crecer en el segundo run');

      // Mismo mtime (no se sobrescribió).
      const afterMtime = statSync(join(tmpCacheDir, after[0])).mtimeMs;
      assertEq(afterMtime, beforeMtime, 'mtime cambió — el archivo fue reescrito en lugar de reusado');
    },
    { skip: !hasKey, skipReason: 'depende del test 4 (que está skipeado sin OPENAI_API_KEY)' },
  );

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
  cleanupAll();

  console.log('');
  const pass = RESULTS.filter(r => r.status === 'pass').length;
  const fail = RESULTS.filter(r => r.status === 'fail').length;
  const skip = RESULTS.filter(r => r.status === 'skip').length;
  console.log(`Resultado: ${pass} PASS, ${fail} FAIL, ${skip} SKIP de ${RESULTS.length} total.`);
  if (fail > 0) {
    console.log('\nFAILS:');
    for (const r of RESULTS.filter(r => r.status === 'fail')) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\n[test] interrumpido, limpiando...');
  cleanupAll();
  process.exit(130);
});

main().catch(e => {
  console.error(`fatal en test runner: ${e.message}`);
  if (e.stack) console.error(e.stack);
  cleanupAll();
  process.exit(1);
});
