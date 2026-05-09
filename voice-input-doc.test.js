// voice-input-doc.test.js
// Sprint 4.5 — valida que docs/voice-input-guide.md existe, tiene el largo
// mínimo esperado (~80 líneas) y contiene las 5 secciones canónicas:
// Windows, macOS, Linux, "Cuándo dictar vs cuándo tipear", "Próximamente".
//
// No valida contenido fino; solo estructura. Si alguien borra una sección
// entera por accidente al editar, este test rompe y avisa.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, 'docs', 'voice-input-guide.md');
const README_PATH = join(__dirname, 'README.md');
const KICKOFF_PATH = join(__dirname, '.claude', 'skills', 'kickoff', 'SKILL.md');

let passed = 0;
let failed = 0;
const fails = [];

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${e.message}`);
    fails.push({ label, error: e.message });
    failed += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 1. El archivo existe.
check('docs/voice-input-guide.md existe', () => {
  assert(existsSync(DOC_PATH), `falta ${DOC_PATH}`);
});

const content = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : '';
const lineCount = content.split('\n').length;

// 2. Largo mínimo razonable (~80 líneas; relajamos a 60 para tolerar ediciones).
check('doc tiene al menos 60 líneas', () => {
  assert(lineCount >= 60, `solo ${lineCount} líneas; mínimo 60`);
});

// 3. Las 5 secciones canónicas están presentes (regex sobre headers markdown).
const SECTION_REGEX = [
  { name: 'Windows', re: /^##\s+Windows/m },
  { name: 'macOS', re: /^##\s+macOS/m },
  { name: 'Linux', re: /^##\s+Linux/m },
  { name: 'Cuándo dictar vs cuándo tipear', re: /^##\s+Cu[aá]ndo dictar/m },
  { name: 'Próximamente — Voz Nivel 2', re: /^##\s+Pr[oó]ximamente/m },
];

for (const { name, re } of SECTION_REGEX) {
  check(`sección "${name}" presente`, () => {
    assert(re.test(content), `no encuentro header para "${name}"`);
  });
}

// 4. Menciona explícitamente Win+H — es el atajo central del doc.
check('menciona atajo Win+H', () => {
  assert(/Win\s*\+\s*H/i.test(content), 'no menciona Win+H');
});

// 5. README enlaza al doc.
check('README enlaza a docs/voice-input-guide.md', () => {
  assert(existsSync(README_PATH), 'falta README.md');
  const readme = readFileSync(README_PATH, 'utf8');
  assert(/voice-input-guide\.md/.test(readme), 'README no enlaza la guía');
});

// 6. Skill kickoff menciona el flujo de voz al cerrar.
check('skill kickoff referencia voice-input-guide.md', () => {
  assert(existsSync(KICKOFF_PATH), 'falta SKILL.md de kickoff');
  const kickoff = readFileSync(KICKOFF_PATH, 'utf8');
  assert(/voice-input-guide\.md/.test(kickoff), 'kickoff no menciona la guía');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFallas:');
  for (const f of fails) console.error(`  - ${f.label}: ${f.error}`);
  process.exit(1);
}
