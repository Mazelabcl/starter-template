// scripts/run_tests.js
// Corre todos los tests del starter (*.test.js y *-test.js en la raíz + memory/test.js)
// uno por uno y muestra un resumen. Uso: npm test
//
// Ojo: algunos tests hacen llamadas reales si encuentran API keys en .env
// (openrouter-client, image-explorer). Cuestan centavos. Sin keys, se saltan solos.
// Idioma: español neutro.

import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const files = readdirSync(REPO_ROOT)
  .filter(f => f.endsWith('.test.js') || f.endsWith('-test.js'))
  .sort();
if (existsSync(join(REPO_ROOT, 'memory', 'test.js'))) files.push('memory/test.js');

const failed = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { cwd: REPO_ROOT, encoding: 'utf8' });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`OK    ${f} (${secs}s)`);
  } else {
    failed.push(f);
    console.log(`FALLA ${f} (${secs}s, exit ${r.status})`);
    const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
    console.log(tail.split('\n').map(l => `      ${l}`).join('\n'));
  }
}

console.log(`\nArchivos de test: ${files.length} | OK: ${files.length - failed.length} | FALLA: ${failed.length}`);
process.exit(failed.length ? 1 : 0);
