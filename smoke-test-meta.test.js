// smoke-test-meta.test.js
// Meta-test del propio smoke_test.js. Verifica que:
//   1. El archivo parsea sin errores de sintaxis (--help corre y sale 0).
//   2. El texto de --help menciona los modos disponibles.
//   3. Con env fake (no placeholders) + --quick, los checks 1-2-3-4-7-8
//      pasan sin necesitar red real.
//   4. Con .env ausente, el check 1 falla con mensaje accionable.
//   5. Con keys placeholder, el check 1 falla.
//
// No corre los checks 5 y 6 (los que sí gastan API credits) — están skipped por
// --quick. Si alguien quiere validar esos también, debe correr `npm run smoke`
// con keys reales.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, copyFileSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const SMOKE = join(REPO_ROOT, 'scripts', 'smoke_test.js');
const ENV_PATH = join(REPO_ROOT, '.env');

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
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true');
}

function assertContains(haystack, needle, msg) {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(`${msg || 'contains'}: no encontré "${needle}" en output (recortado): ${String(haystack).slice(0, 300)}`);
  }
}

function runSmoke(args, env = {}) {
  const r = spawnSync(process.execPath, [SMOKE, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Backup .env real para que el meta-test no lo destruya. Lo restauramos al final
// pase lo que pase.
function backupEnv() {
  if (!existsSync(ENV_PATH)) return { existed: false, content: null };
  return { existed: true, content: readFileSync(ENV_PATH, 'utf8') };
}
function restoreEnv(backup) {
  if (backup.existed) {
    writeFileSync(ENV_PATH, backup.content, 'utf8');
  } else if (existsSync(ENV_PATH)) {
    rmSync(ENV_PATH, { force: true });
  }
}

function writeFakeEnv(content) {
  writeFileSync(ENV_PATH, content, 'utf8');
}

async function main() {
  console.log('--- smoke-test-meta.test.js ---');
  const envBackup = backupEnv();

  try {
    // ---------- 1. parseo + --help ----------
    await check('--help corre y exit 0', () => {
      const r = runSmoke(['--help']);
      assertEqual(r.code, 0, `exit code (stderr=${r.stderr.slice(0, 200)})`);
      assertContains(r.stdout, 'Uso:', 'help debe contener "Uso:"');
      assertContains(r.stdout, '--quick', 'help debe mencionar --quick');
      assertContains(r.stdout, '--verbose', 'help debe mencionar --verbose');
      assertContains(r.stdout, 'Checks ejecutados', 'help debe listar checks');
    });

    // ---------- 2. -h corto también funciona ----------
    await check('-h alias de --help', () => {
      const r = runSmoke(['-h']);
      assertEqual(r.code, 0, 'exit 0');
      assertContains(r.stdout, 'Uso:', 'help text');
    });

    // ---------- 3. .env ausente → check 1 falla con mensaje accionable ----------
    await check('sin .env el check 1 falla con mensaje claro', () => {
      if (existsSync(ENV_PATH)) rmSync(ENV_PATH, { force: true });
      const r = runSmoke(['--quick']);
      assertEqual(r.code, 1, `exit 1 esperado (stdout=${r.stdout.slice(-300)})`);
      assertContains(r.stdout, 'Variables de entorno', 'menciona el check');
      assertContains(r.stdout, 'FALLÓ', 'reporta FALLÓ');
      // El mensaje debe sugerir cómo arreglarlo:
      assertContains(r.stdout, 'npm run setup', 'mensaje sugiere npm run setup');
    });

    // ---------- 4. keys placeholder → check 1 falla ----------
    await check('keys placeholder fallan check 1', () => {
      writeFakeEnv([
        'OPENROUTER_API_KEY=sk-or-v1-pega-aqui-tu-key',
        'OPENAI_API_KEY=sk-proj-pega-aqui-tu-key',
      ].join('\n'));
      const r = runSmoke(['--quick']);
      assertEqual(r.code, 1, 'exit 1');
      assertContains(r.stdout, 'placeholder', 'menciona placeholder');
    });

    // ---------- 5. fake env válido + --quick: checks 1-4 + 7-8 verdes ----------
    await check('--quick con env fake corre checks 1-4 y 7-8 sin red', () => {
      // Las keys son sintácticamente válidas (no placeholders), pero apuntarían
      // a 401 si llegaran a OpenRouter/OpenAI. --quick salta los checks que
      // realmente pegan red (5 y 6).
      writeFakeEnv([
        'OPENROUTER_API_KEY=sk-or-v1-fake-but-not-placeholder-' + 'x'.repeat(40),
        'OPENAI_API_KEY=sk-proj-fake-but-not-placeholder-' + 'x'.repeat(40),
      ].join('\n'));
      const r = runSmoke(['--quick']);
      // Imprimimos el output completo solo si falla, para diagnóstico.
      if (r.code !== 0) {
        console.error('\n--- DEBUG OUTPUT ---');
        console.error(r.stdout);
        console.error('--- STDERR ---');
        console.error(r.stderr);
        console.error('--- END ---\n');
      }
      assertEqual(r.code, 0, 'exit 0 con --quick + keys fake bien formadas');
      assertContains(r.stdout, 'Sistema verde', 'reporta verde');
      assertContains(r.stdout, '[1/8]', 'corre check 1');
      assertContains(r.stdout, '[8/8]', 'corre check 8');
      // Los lentos deben estar marcados como SKIP:
      assertContains(r.stdout, 'SKIP (--quick)', 'checks 5 y 6 saltados');
    });

    // ---------- 6. --verbose es reconocido (no error) ----------
    // Lo combinamos con --quick + fake env para no gastar credits.
    // Si --verbose causa crash, el exit code lo revela.
    await check('--verbose es reconocido', () => {
      writeFakeEnv([
        'OPENROUTER_API_KEY=sk-or-v1-fake-' + 'y'.repeat(40),
        'OPENAI_API_KEY=sk-proj-fake-' + 'y'.repeat(40),
      ].join('\n'));
      const r = runSmoke(['--quick', '--verbose']);
      assertEqual(r.code, 0, `exit 0 (stderr=${r.stderr.slice(0, 200)})`);
      assertContains(r.stdout, '[verbose]', 'output verbose contiene marcadores [verbose]');
    });

    // ---------- 7. flag desconocido no crashea (lo ignora) ----------
    await check('flag desconocido es ignorado limpiamente', () => {
      writeFakeEnv([
        'OPENROUTER_API_KEY=sk-or-v1-fake-' + 'z'.repeat(40),
        'OPENAI_API_KEY=sk-proj-fake-' + 'z'.repeat(40),
      ].join('\n'));
      const r = runSmoke(['--quick', '--no-existe']);
      // Sigue corriendo --quick correctamente.
      assertEqual(r.code, 0, 'exit 0');
    });

  } finally {
    restoreEnv(envBackup);
  }

  console.log('---');
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('FAILS:');
    for (const f of fails) console.log(`  - ${f.label}: ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
