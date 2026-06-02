// Test del guard de refs en scripts/openai_images.py (BUG fix D12).
// No llama al API real: importa el módulo Python y ejercita _mime_for +
// _assert_refs_mentioned (mention-check guard) con un sub-proceso Python.
//
// Por qué Python desde un test JS: el resto de la suite del starter es JS y
// `npm run` orquesta tests JS, pero la causa raíz vivía en Python. Este puente
// mantiene el guard cubierto en CI sin gastar créditos de OpenAI.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, 'scripts', 'openai_images.py');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${e.message}`);
    failed += 1;
  }
}

// Corre un snippet Python que importa el módulo y devuelve "OK" o lanza.
// El snippet NO debe instanciar clientes ni tocar el API.
function runPy(snippet) {
  const py = `
import importlib.util
spec = importlib.util.spec_from_file_location('oi', r'${scriptPath.replace(/\\/g, '\\\\')}')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
${snippet}
print('OK')
`;
  for (const bin of ['python', 'py', 'python3']) {
    const res = spawnSync(bin, ['-c', py], { encoding: 'utf8' });
    if (res.error && res.error.code === 'ENOENT') continue; // intérprete no existe, probar el siguiente
    return res;
  }
  return { status: 127, stdout: '', stderr: 'no python interpreter found' };
}

function expectOk(snippet) {
  const res = runPy(snippet);
  if (res.status !== 0 || !/OK\s*$/.test(res.stdout)) {
    throw new Error(`esperaba OK, status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  }
}

// Smoke: ¿hay intérprete Python? Si no, marcamos skip explícito (no failure).
const probe = runPy('pass');
if (probe.status === 127) {
  console.log('SKIP  no hay intérprete Python disponible — guard test omitido');
  console.log(`\nresultado: 0 pasaron, 0 fallaron (skip)`);
  process.exit(0);
}

check('_mime_for mapea extensiones (.webp/.jpg ya no caen a png crudo)', () => {
  expectOk(`
assert m._mime_for('a.webp') == 'image/webp'
assert m._mime_for('a.JPG') == 'image/jpeg'
assert m._mime_for('a.jpeg') == 'image/jpeg'
assert m._mime_for('a.png') == 'image/png'
assert m._mime_for('a.gif') == 'image/gif'
assert m._mime_for('a.unknown') == 'image/png'
`);
});

check('mention-check: refs cargadas sin "Image 1" en el prompt → ValueError', () => {
  expectOk(`
raised = False
try:
    m._assert_refs_mentioned('a red dog on grass', ['ref.png'])
except ValueError as e:
    raised = True
    assert 'Image 1' in str(e)
assert raised, 'el guard debió lanzar ValueError'
`);
});

check('mention-check: refs + "Image 1" mencionado → pasa', () => {
  expectOk(`m._assert_refs_mentioned('Image 1: shows the totem. Match EXACTLY.', ['ref.png'])`);
});

check('mention-check: case-insensitive y tolerante a espacios', () => {
  expectOk(`m._assert_refs_mentioned('use image  1 here please', ['ref.png'])`);
});

check('mention-check: sin refs → no exige nada', () => {
  expectOk(`m._assert_refs_mentioned('a red dog, no references at all', [])`);
});

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
