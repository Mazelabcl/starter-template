/**
 * Test del Sprint 3.2 — split de superpowers-lite a _catalog/superpowers-pr.
 *
 * Verifica:
 *   1. .claude/skills/_catalog/superpowers-pr/SKILL.md existe y parsea bien.
 *   2. .claude/skills/superpowers-lite/ ya NO existe (movida).
 *   3. SKILL.md tiene la sección "Cuándo activar esta skill" con los 4 criterios.
 *   4. Frontmatter tiene name `superpowers-pr` y los triggers correctos.
 *   5. NO hay referencias huérfanas a `superpowers-lite` en archivos del repo
 *      (excepto en changelogs o en este test).
 *
 * No invoca LLM. Lectura/parsing puro.
 *
 * Salida: PASS/FAIL por aserción + total al final. Exit code != 0 si algo falla.
 */

import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    failures.push({ label, detail });
    console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

// --- 1. Path de la skill movida existe -----------------------------------

const skillDir = join(REPO, '.claude', 'skills', '_catalog', 'superpowers-pr');
const skillFile = join(skillDir, 'SKILL.md');

assert(
  '1.1 — directorio .claude/skills/_catalog/superpowers-pr/ existe',
  existsSync(skillDir) && statSync(skillDir).isDirectory(),
);

assert(
  '1.2 — SKILL.md existe en _catalog/superpowers-pr/',
  existsSync(skillFile) && statSync(skillFile).isFile(),
);

// --- 2. La skill vieja NO existe ----------------------------------------

const oldSkillDir = join(REPO, '.claude', 'skills', 'superpowers-lite');

assert(
  '2.1 — .claude/skills/superpowers-lite/ ya NO existe (movida limpiamente)',
  !existsSync(oldSkillDir),
);

// --- 3. Parseo del SKILL.md ---------------------------------------------

let skillRaw = '';
let frontmatter = '';
let body = '';

if (existsSync(skillFile)) {
  skillRaw = readFileSync(skillFile, 'utf8');
  // Frontmatter parseo simple: --- ... ---
  const fmMatch = skillRaw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = fmMatch[1];
    body = fmMatch[2];
  }
}

assert(
  '3.1 — SKILL.md tiene frontmatter parseable',
  frontmatter.length > 0 && body.length > 0,
);

// --- 4. Frontmatter: name correcto ---------------------------------------

const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
const skillName = nameMatch ? nameMatch[1].trim() : '';

assert(
  '4.1 — frontmatter `name` = superpowers-pr',
  skillName === 'superpowers-pr',
  skillName ? `name detectado: "${skillName}"` : 'name no encontrado',
);

// --- 5. Frontmatter: triggers correctos ---------------------------------

const REQUIRED_TRIGGERS = [
  '/superpowers-pr',
  'antes de PR',
  'code review formal',
  'merge a main',
];

const triggersMatch = frontmatter.match(/^triggers:\s*(.+)$/m);
const triggersRaw = triggersMatch ? triggersMatch[1] : '';

REQUIRED_TRIGGERS.forEach((t, i) => {
  assert(
    `5.${i + 1} — trigger "${t}" presente en frontmatter`,
    triggersRaw.includes(t),
    triggersRaw ? `triggers raw: ${triggersRaw}` : 'triggers no encontrados',
  );
});

// Triggers genéricos del nombre viejo NO deben aparecer.
const FORBIDDEN_TRIGGERS = ['/superpowers-lite'];
FORBIDDEN_TRIGGERS.forEach((t, i) => {
  assert(
    `5.${REQUIRED_TRIGGERS.length + i + 1} — trigger antiguo "${t}" NO está`,
    !triggersRaw.includes(t),
  );
});

// --- 6. Sección "Cuándo activar esta skill" con 4 criterios -------------

const sectionMatch = body.match(
  /##\s+Cuándo activar esta skill[\s\S]*?(?=\n##\s+|\n---\n|$)/i,
);
const seccion = sectionMatch ? sectionMatch[0] : '';

assert(
  '6.1 — sección "Cuándo activar esta skill" presente en el body',
  seccion.length > 0,
);

const CRITERIOS = [
  { label: 'equipo colaborando', test: /equipo\s+colaborando/i },
  { label: 'GitHub flow con PRs formales', test: /GitHub\s+flow/i },
  { label: 'open source con conventional commits', test: /conventional\s+commits/i },
  { label: 'CI\\/CD que depende de PRs', test: /CI\/CD/i },
];

CRITERIOS.forEach((c, i) => {
  assert(
    `6.${i + 2} — criterio "${c.label}" presente en la sección`,
    c.test.test(seccion),
  );
});

assert(
  '6.6 — la sección menciona usar `quality-mindset` cuando NO aplica',
  /quality-mindset/i.test(seccion),
);

// --- 7. Description aclara scope ---------------------------------------

const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
const description = descMatch ? descMatch[1].trim() : '';

assert(
  '7.1 — description menciona "Git/PR" o flujo PR formal',
  /\b(PR|pull request|code review)\b/i.test(description) &&
    /formal|equipo|GitHub flow|CI\/CD/i.test(description),
  description ? `description: ${description}` : 'description no encontrada',
);

// --- 8. Cero referencias huérfanas a superpowers-lite ------------------

// Buscamos toda referencia textual a "superpowers-lite" en el repo.
// Permitidas: changelogs, este test, node_modules.
function walk(dir, filelist = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, filelist);
    } else if (e.isFile()) {
      // Solo escaneamos texto plano razonable
      if (
        e.name.endsWith('.md') ||
        e.name.endsWith('.js') ||
        e.name.endsWith('.json') ||
        e.name.endsWith('.txt') ||
        e.name === 'CLAUDE.md' ||
        e.name === 'README.md'
      ) {
        filelist.push(full);
      }
    }
  }
  return filelist;
}

const allFiles = walk(REPO);
const orphanRefs = [];

for (const file of allFiles) {
  // Excepciones: este test mismo y todos los CHANGELOG.md (referencias históricas válidas).
  if (file.endsWith('superpowers-pr-test.js')) continue;
  if (file.endsWith('CHANGELOG.md')) continue;
  // process-log/v3-plan.md tiene referencia histórica controlada (sucesora conceptual).
  // La permitimos solo si está acotada a una mención breve por línea.
  const content = readFileSync(file, 'utf8');
  if (!content.includes('superpowers-lite')) continue;

  // Si llegamos acá, es referencia no permitida.
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('superpowers-lite')) {
      orphanRefs.push(`${file}:${idx + 1}: ${line.trim()}`);
    }
  });
}

// Trazabilidad histórica permitida (referencias documentales al rename, no usos activos):
//   - process-log/v3-plan.md (líneas que documentan el split y la reformulación)
//   - .claude/skills/quality-mindset/SKILL.md (ejemplo ilustrativo de mensaje de commit
//     que precisamente demuestra el estilo "explica el WHY del cambio que importa en 6 meses")
const ALLOWED_HISTORICAL = [
  ['process-log', 'v3-plan.md'],
  ['quality-mindset', 'SKILL.md'],
];

function isAllowedHistorical(refLine) {
  return ALLOWED_HISTORICAL.some((parts) =>
    parts.every((p) => refLine.includes(p)),
  );
}

const realOrphans = orphanRefs.filter((ref) => !isAllowedHistorical(ref));

assert(
  '8.1 — no hay referencias huérfanas a `superpowers-lite` fuera de changelogs / trazabilidad histórica',
  realOrphans.length === 0,
  realOrphans.length
    ? `referencias detectadas:\n      ${realOrphans.join('\n      ')}`
    : '',
);

// --- 9. README del catálogo y CHANGELOG existen -------------------------

assert(
  '9.1 — _catalog/README.md existe',
  existsSync(join(REPO, '.claude', 'skills', '_catalog', 'README.md')),
);

assert(
  '9.2 — _catalog/superpowers-pr/CHANGELOG.md existe',
  existsSync(join(skillDir, 'CHANGELOG.md')),
);

// --- Cierre -------------------------------------------------------------

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
if (failed > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log(`  - ${f.label}${f.detail ? `\n    ${f.detail}` : ''}`);
  }
  process.exit(1);
}
process.exit(0);
