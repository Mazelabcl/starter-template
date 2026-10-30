// dashboard-load-env.test.js
//
// Verifica que `src/load_env.js` carga `.env` correctamente desde un script
// standalone — replicando el escenario que rompía dual_auditor_b.js en
// audit-master (feedback 2026-05-12).
//
// Casos cubiertos:
//   1. parseEnv parsea KEY=value, KEY="quoted", comentarios, líneas vacías.
//   2. Un script Node hijo que importa `src/load_env.js` ve las vars de `.env`.
//   3. Idempotente: importar dos veces no duplica trabajo ni rompe.
//   4. Override: vars ya presentes en process.env NO se sobreescriben por default.
//   5. .env ausente: no rompe el script.
//
// Para no contaminar el `.env` real del repo, los tests crean un dir temporal y
// spawnean un Node hijo con ese dir como cwd.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { parseEnv, loadEnv } from './src/load_env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const LOAD_ENV_PATH = join(REPO_ROOT, 'src', 'load_env.js');

let passed = 0;
let failed = 0;
const fails = [];

function check(label, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`PASS  ${label}`); passed += 1; })
    .catch(e => {
      console.error(`FAIL  ${label}`);
      console.error(`      ${e.message}`);
      fails.push({ label, error: e.message });
      failed += 1;
    });
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'assertEqual'}: esperado ${e}, obtenido ${a}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true');
}

const tmp = mkdtempSync(join(tmpdir(), 'load-env-test-'));

try {
  await check('parseEnv: KEY=value, KEY="quoted", comentarios', () => {
    const text = [
      '# comentario',
      'KEY_PLAIN=value1',
      'KEY_QUOTED="hello world"',
      "KEY_SINGLE='single quotes'",
      'KEY_EMPTY=',
      '',
      'KEY_INLINE_COMMENT=value2 # comentario inline',
      'BAD LINE WITHOUT EQUALS',
      'KEY_EQUALS_IN_VALUE=foo=bar',
    ].join('\n');
    const parsed = parseEnv(text);
    assertEqual(parsed.KEY_PLAIN, 'value1', 'KEY_PLAIN');
    assertEqual(parsed.KEY_QUOTED, 'hello world', 'KEY_QUOTED');
    assertEqual(parsed.KEY_SINGLE, 'single quotes', 'KEY_SINGLE');
    assertEqual(parsed.KEY_EMPTY, '', 'KEY_EMPTY');
    assertEqual(parsed.KEY_INLINE_COMMENT, 'value2', 'KEY_INLINE_COMMENT');
    assertEqual(parsed.KEY_EQUALS_IN_VALUE, 'foo=bar', 'KEY_EQUALS_IN_VALUE');
    assertTrue(!('BAD LINE WITHOUT EQUALS' in parsed), 'bad line ignored');
  });

  await check('parseEnv: input no-string retorna {}', () => {
    assertEqual(parseEnv(null), {}, 'null');
    assertEqual(parseEnv(undefined), {}, 'undefined');
    assertEqual(parseEnv(123), {}, 'number');
  });

  await check('script standalone que importa load_env.js ve las vars de .env', () => {
    const dir = join(tmp, 'standalone');
    mkdirSync(dir, { recursive: true });
    const envPath = join(dir, '.env');
    writeFileSync(envPath, [
      'TEST_KEY_FROM_DOTENV=hello_from_dotenv',
      'TEST_NUMBER=42',
    ].join('\n'), 'utf8');

    const scriptPath = join(dir, 'standalone-script.mjs');
    // El script importa load_env.js (con path absoluto) e imprime las env vars.
    const loadEnvUrl = 'file:///' + LOAD_ENV_PATH.replace(/\\/g, '/');
    writeFileSync(scriptPath, [
      `import '${loadEnvUrl}';`,
      `console.log(JSON.stringify({`,
      `  fromEnv: process.env.TEST_KEY_FROM_DOTENV || null,`,
      `  num: process.env.TEST_NUMBER || null,`,
      `}));`,
    ].join('\n'), 'utf8');

    // Lanzamos el script hijo con cwd=dir (donde está el .env real). Pasamos un
    // env limpio sin nuestras vars de test, para garantizar que las leyó del .env.
    const cleanEnv = { ...process.env };
    delete cleanEnv.TEST_KEY_FROM_DOTENV;
    delete cleanEnv.TEST_NUMBER;
    const r = spawnSync(process.execPath, [scriptPath], {
      cwd: dir,
      env: cleanEnv,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(`child exited ${r.status}: stderr=${r.stderr}`);
    }
    const parsed = JSON.parse(r.stdout.trim().split('\n').pop());
    assertEqual(parsed.fromEnv, 'hello_from_dotenv', 'TEST_KEY_FROM_DOTENV cargada');
    assertEqual(parsed.num, '42', 'TEST_NUMBER cargada');
  });

  await check('loadEnv idempotente: importar dos veces NO sobreescribe', () => {
    const dir = join(tmp, 'idempotent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), 'TEST_IDEMPOTENT=first\n', 'utf8');

    // Llamada 1.
    const r1 = loadEnv({ paths: [join(dir, '.env')], force: true });
    assertTrue(r1.loaded.length === 1, 'primera llamada lee el archivo');
    assertEqual(process.env.TEST_IDEMPOTENT, 'first', 'value set');

    // Cambiar el archivo y NO usar force: no debe re-cargar.
    writeFileSync(join(dir, '.env'), 'TEST_IDEMPOTENT=second\n', 'utf8');
    const r2 = loadEnv({ paths: [join(dir, '.env')] });
    assertTrue(r2.loaded.length === 0, 'segunda llamada sin force es noop');
    assertEqual(process.env.TEST_IDEMPOTENT, 'first', 'sigue siendo first');

    delete process.env.TEST_IDEMPOTENT;
  });

  await check('loadEnv respeta vars ya presentes en process.env (no override por default)', () => {
    const dir = join(tmp, 'respects');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), 'TEST_PREEXISTING=from_dotenv\n', 'utf8');

    process.env.TEST_PREEXISTING = 'from_shell';
    const r = loadEnv({ paths: [join(dir, '.env')], force: true });
    assertEqual(process.env.TEST_PREEXISTING, 'from_shell', 'shell gana sobre .env');
    assertTrue(!r.keys.includes('TEST_PREEXISTING'), 'key no listada como "cargada"');
    delete process.env.TEST_PREEXISTING;
  });

  await check('loadEnv: .env ausente no rompe', () => {
    const dir = join(tmp, 'missing');
    mkdirSync(dir, { recursive: true });
    // No creamos .env
    const r = loadEnv({ paths: [join(dir, '.env')], force: true });
    assertEqual(r.loaded, [], 'ningún archivo cargado');
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
if (failed > 0) {
  console.error('\nFallos:');
  for (const f of fails) console.error(`  - ${f.label}: ${f.error}`);
}
process.exit(failed === 0 ? 0 : 1);
