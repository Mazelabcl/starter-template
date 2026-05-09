// Test conceptual de la skill quality-mindset.
// Verifica que SKILL.md tenga estructura, frontmatter, las 4 disciplinas,
// 3 ejemplos end-to-end y al menos 5 anti-patrones.
// No prueba comportamiento de runtime — la skill es un .md, no código.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '.claude', 'skills', 'quality-mindset');
const SKILL_PATH = join(SKILL_DIR, 'SKILL.md');
const CHANGELOG_PATH = join(SKILL_DIR, 'CHANGELOG.md');

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Parses simple YAML frontmatter at top of a markdown file. Returns {fm, body}.
// Only supports key: value pairs (one line each), enough for skill frontmatter.
function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { fm: null, body: text };
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body: match[2] };
}

function getH2Headers(body) {
  const headers = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) headers.push(m[1]);
  }
  return headers;
}

function getH3Headers(body) {
  const headers = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) headers.push(m[1]);
  }
  return headers;
}

// 1. SKILL.md exists
check('SKILL.md existe en .claude/skills/quality-mindset/', () => {
  assert(existsSync(SKILL_PATH), `no encontrado: ${SKILL_PATH}`);
});

// 2. CHANGELOG.md exists
check('CHANGELOG.md existe en la misma carpeta', () => {
  assert(existsSync(CHANGELOG_PATH), `no encontrado: ${CHANGELOG_PATH}`);
});

const raw = readFileSync(SKILL_PATH, 'utf8');
const { fm, body } = parseFrontmatter(raw);

// 3. Frontmatter válido
check('Frontmatter válido con name y description', () => {
  assert(fm !== null, 'no se detectó bloque de frontmatter --- ... ---');
  assert(fm.name === 'quality-mindset', `name esperado "quality-mindset", obtuve "${fm.name}"`);
  assert(typeof fm.description === 'string' && fm.description.length > 30,
    'description debe ser un string descriptivo (>30 chars)');
});

// 4. Triggers presentes en description
check('Description contiene triggers identificables', () => {
  const desc = (fm?.description || '').toLowerCase();
  const hasTrigger = /trigger|invoca|/u.test(desc) ||
    desc.includes('vamos a hacer') ||
    desc.includes('/quality-mindset') ||
    desc.includes('al iniciar') ||
    desc.includes('al detectar') ||
    desc.includes('al pedir');
  assert(hasTrigger, 'description debe mencionar al menos un trigger');
});

const h2 = getH2Headers(body);
const h3 = getH3Headers(body);

// 5. Secciones top-level esperadas
check('Tiene las secciones H2 esperadas', () => {
  const expected = [
    'Cuándo aplica esta skill',
    'Las 4 disciplinas',
    'Disciplina Git baseline',
    'Cómo se conecta con karpathy-rules',
    'Cómo se conecta con pipeline-v2',
    'Anti-patrones',
    'Ejemplos end-to-end',
    'Integración con memoria',
  ];
  for (const e of expected) {
    assert(h2.includes(e), `falta sección H2: "${e}". H2 encontrados: ${JSON.stringify(h2)}`);
  }
});

// 6. Las 4 disciplinas presentes y nombradas
check('Las 4 disciplinas están presentes con nombres correctos', () => {
  const disciplinas = [
    /Spec mínimo/i,
    /Plan visible/i,
    /Ejecución con validación intermedia/i,
    /Cierre validado/i,
  ];
  for (const re of disciplinas) {
    const found = h3.some(h => re.test(h));
    assert(found, `no se encontró H3 que matchee ${re}. H3 encontrados: ${JSON.stringify(h3)}`);
  }
});

// 7. 3 escenarios end-to-end presentes
check('3 escenarios end-to-end presentes (A, B, C)', () => {
  const scenarios = [/Escenario A/i, /Escenario B/i, /Escenario C/i];
  for (const re of scenarios) {
    const found = h3.some(h => re.test(h));
    assert(found, `no se encontró H3 que matchee ${re}`);
  }
});

// 8. Anti-patrones tiene >=5 entradas
check('Sección Anti-patrones tiene al menos 5 puntos', () => {
  // Capture from "## Anti-patrones" until next ## header.
  const m = body.match(/##\s+Anti-patrones[\s\S]*?(?=\n##\s+|$)/);
  assert(m, 'no se encontró bloque "## Anti-patrones"');
  const block = m[0];
  // Count rows in markdown table (lines starting with | that aren't separator).
  const rows = block
    .split('\n')
    .filter(l => l.startsWith('|'))
    .filter(l => !/^\|[\s:|-]+\|[\s:|-]*\|?$/.test(l));
  // First row of a markdown table is header — discount it.
  const dataRows = Math.max(0, rows.length - 1);
  assert(dataRows >= 5,
    `Anti-patrones debe tener >=5 entradas en la tabla, encontré ${dataRows}`);
});

// 9. Tabla de commits buenos vs malos con 5-7 ejemplos
check('Tabla de commits buenos vs malos tiene 5-7 ejemplos', () => {
  const m = body.match(/Mensajes de commit[\s\S]*?(?=\n##\s+|\n###\s+|$)/i);
  assert(m, 'no se encontró sección "Mensajes de commit"');
  const block = m[0];
  const rows = block
    .split('\n')
    .filter(l => l.startsWith('|'))
    .filter(l => !/^\|[\s:|-]+\|[\s:|-]*\|?$/.test(l));
  const dataRows = Math.max(0, rows.length - 1);
  assert(dataRows >= 5 && dataRows <= 10,
    `Tabla de commits debe tener 5-10 entradas, encontré ${dataRows}`);
});

// 10. Mención a addDecision y addLesson en sección de memoria
check('Sección "Integración con memoria" menciona addDecision y addLesson', () => {
  const m = body.match(/##\s+Integración con memoria[\s\S]*?(?=\n##\s+|$)/);
  assert(m, 'no se encontró sección "Integración con memoria"');
  const block = m[0];
  assert(/addDecision/.test(block), 'falta mención a addDecision');
  assert(/addLesson/.test(block), 'falta mención a addLesson');
});

// 11. Conexiones explícitas con karpathy-rules y pipeline-v2
check('Conexiones explícitas con karpathy-rules y pipeline-v2', () => {
  assert(/karpathy-rules/i.test(body), 'falta mención a karpathy-rules');
  assert(/pipeline-v2/i.test(body), 'falta mención a pipeline-v2');
});

// 12. Versión declarada
check('Versión v1.0 declarada en SKILL.md', () => {
  assert(/v1\.0/.test(body), 'falta declaración de versión v1.0');
});

console.log('');
console.log(`Resultado: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
