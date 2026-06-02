// Test de los wrappers multi-modelo de imagen (D13): gemini_images.py + replicate_images.py.
// Valida que CADA wrapper nuevo tiene el guard mention-check y el mapeo de mimetype,
// igual que dashboard-image-refs.test.js hace para openai_images.py.
//
// NO llama a las APIs reales ni requiere keys (GEMINI_API_KEY / REPLICATE_API_TOKEN):
// importa cada módulo Python y ejercita solo _mime_for + _assert_refs_mentioned, que
// son funciones puras sin red. Skip explícito si no hay intérprete Python.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WRAPPERS = [
  { name: 'gemini_images.py', path: join(__dirname, 'scripts', 'gemini_images.py') },
  { name: 'replicate_images.py', path: join(__dirname, 'scripts', 'replicate_images.py') },
];

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

// Importa el módulo Python por path y corre un snippet contra él. El snippet NO
// debe instanciar clientes ni tocar la red (solo _mime_for / _assert_refs_mentioned).
function runPy(scriptPath, snippet) {
  const py = `
import importlib.util
spec = importlib.util.spec_from_file_location('mod', r'${scriptPath.replace(/\\/g, '\\\\')}')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
${snippet}
print('OK')
`;
  for (const bin of ['python', 'py', 'python3']) {
    const res = spawnSync(bin, ['-c', py], { encoding: 'utf8' });
    if (res.error && res.error.code === 'ENOENT') continue;
    return res;
  }
  return { status: 127, stdout: '', stderr: 'no python interpreter found' };
}

function expectOk(scriptPath, snippet) {
  const res = runPy(scriptPath, snippet);
  if (res.status !== 0 || !/OK\s*$/.test(res.stdout)) {
    throw new Error(`esperaba OK, status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  }
}

// Smoke: ¿hay intérprete Python? Si no, skip (no failure) — igual que image-refs test.
const probe = runPy(WRAPPERS[0].path, 'pass');
if (probe.status === 127) {
  console.log('SKIP  no hay intérprete Python disponible — guard test omitido');
  console.log(`\nresultado: 0 pasaron, 0 fallaron (skip)`);
  process.exit(0);
}

for (const w of WRAPPERS) {
  check(`${w.name}: _mime_for mapea .webp/.jpg correctamente`, () => {
    expectOk(w.path, `
assert m._mime_for('a.webp') == 'image/webp'
assert m._mime_for('a.JPG') == 'image/jpeg'
assert m._mime_for('a.png') == 'image/png'
assert m._mime_for('a.unknown') == 'image/png'
`);
  });

  check(`${w.name}: mention-check — refs sin "Image 1" → ValueError`, () => {
    expectOk(w.path, `
raised = False
try:
    m._assert_refs_mentioned('a red dog on grass', ['ref.png'])
except ValueError as e:
    raised = True
    assert 'Image 1' in str(e)
assert raised, 'el guard debió lanzar ValueError'
`);
  });

  check(`${w.name}: mention-check — refs + "Image 1" → pasa`, () => {
    expectOk(w.path, `m._assert_refs_mentioned('Image 1: shows the dog. Match EXACTLY.', ['ref.png'])`);
  });

  check(`${w.name}: mention-check — case-insensitive y tolerante a espacios`, () => {
    expectOk(w.path, `m._assert_refs_mentioned('use image  1 here', ['ref.png'])`);
  });

  check(`${w.name}: mention-check — sin refs no exige nada`, () => {
    expectOk(w.path, `m._assert_refs_mentioned('a red dog, no refs', [])`);
  });
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
