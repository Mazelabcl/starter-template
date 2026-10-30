// setup-ci.test.js
// v6 fix e: `setup.js` corre en postinstall. En Vercel / CI / Netlify / GitHub
// Actions debe salir con exit 0 ANTES de cualquier prompt o chequeo (reportado
// por el consumer amanda-paz: el deploy a Vercel fallaba en `npm install`).
//
// Corre `node setup.js` como subproceso con cada variable y verifica exit 0 +
// el mensaje específico de CI (no el de "sin TTY", que es otro camino).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(fileURLToPath(import.meta.url));
const SETUP = join(REPO, 'setup.js');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`);
    failed += 1;
  }
}

// Entorno base sin ninguna variable de CI (por si el test corre dentro de un CI real).
const baseEnv = { ...process.env };
for (const k of ['VERCEL', 'CI', 'NETLIFY', 'GITHUB_ACTIONS']) delete baseEnv[k];

function runSetup(extraEnv) {
  return spawnSync(process.execPath, [SETUP], {
    cwd: REPO,
    env: { ...baseEnv, ...extraEnv },
    encoding: 'utf8',
    timeout: 15000,
  });
}

for (const [name, value] of [['VERCEL', '1'], ['CI', 'true'], ['NETLIFY', 'true'], ['GITHUB_ACTIONS', 'true']]) {
  check(`${name}=${value} → setup.js sale con exit 0 y mensaje de CI`, () => {
    const r = runSetup({ [name]: value });
    if (r.status !== 0) throw new Error(`exit ${r.status}. stderr: ${(r.stderr || '').slice(0, 200)}`);
    if (!/Entorno de deploy\/CI detectado/.test(r.stdout)) {
      throw new Error(`no imprimió el mensaje de CI. stdout: ${(r.stdout || '').slice(0, 200)}`);
    }
  });
}

check('sin variables de CI y sin TTY → no toma el camino de CI (sale por el chequeo de TTY)', () => {
  const r = runSetup({});
  if (r.status !== 0) throw new Error(`exit ${r.status}`);
  if (/Entorno de deploy\/CI detectado/.test(r.stdout)) throw new Error('detectó CI sin variables de CI');
});

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
