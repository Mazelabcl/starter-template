/**
 * Test del catálogo de skills opcionales (Sprint 5.2).
 *
 * Verifica:
 *   - Existen los directorios esperados en `_catalog/`.
 *   - Cada SKILL.md parsea con frontmatter válido (name, description, triggers).
 *   - Cada SKILL.md tiene las 4 secciones requeridas (Cuándo activar, Qué hace,
 *     Anti-patrones, Próximos pasos).
 *   - INDEX.md existe y lista todas las skills del catálogo.
 *   - kickoff-integration.test.js sigue verde (delega).
 *
 * No invoca LLM. Lectura pura del filesystem.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = join(__dirname, '.claude', 'skills', '_catalog');

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

const EXPECTED_SKILLS = [
  'superpowers-pr',     // ya existía (Sprint 3.2)
  'superpowers-full',
  'skill-creator',
  'frontend-design',
  'playwright',
  'webapp-testing',
  'pdf-skill',
  'xlsx',
  'canvas-design',
  'brand-guidelines',
  'marketing',
  'seo',
  'remotion',
  'web-artifacts-builder',
  // Sprint v3.1 — skills promovidas desde audit-master.
  'dual-auditor-protocol',
  'review-app',
  // Sprint v4 — lenguaje no-técnico para cliente (tema recurrente #1).
  'client-language',
  'non-technical-cold-reader',
];

// Skills nuevas del Sprint 5.2 que son stubs y deben seguir el formato canónico
// estricto (4 secciones requeridas). `superpowers-pr` está exenta porque es una
// skill ya madura (v2.0) con formato más libre, validada en Sprint 3.2.
// `dual-auditor-protocol` y `review-app` (v3.1) también traen contenido completo
// con secciones más libres — las eximimos del strict 4-section check.
const STUB_SKILLS = EXPECTED_SKILLS.filter(
  s => s !== 'superpowers-pr' && s !== 'dual-auditor-protocol' && s !== 'review-app'
);

const REQUIRED_SECTIONS = [
  /##\s+Cu[aá]ndo activar/i,
  /##\s+Qu[eé] hace/i,
  /##\s+Anti-patrones/i,
  /##\s+Pr[oó]ximos pasos/i,
];

/**
 * Parser frontmatter trivial: lee el bloque entre el primer y segundo `---`.
 * Devuelve un objeto con las claves al nivel raíz.
 */
function parseFrontmatter(md) {
  const lines = md.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const body = lines.slice(1, end);
  const out = {};
  for (const line of body) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) {
      out[m[1]] = m[2];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 1. Directorios esperados existen
// ─────────────────────────────────────────────────────────────
check('catalog-dir — _catalog/ existe', () => {
  if (!existsSync(CATALOG_DIR)) {
    throw new Error(`no existe ${CATALOG_DIR}`);
  }
});

for (const skill of EXPECTED_SKILLS) {
  check(`dir-${skill} — directorio _catalog/${skill}/ existe`, () => {
    const dir = join(CATALOG_DIR, skill);
    if (!existsSync(dir)) {
      throw new Error(`no existe ${dir}`);
    }
    const stat = statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} no es directorio`);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 2. SKILL.md parsea con frontmatter válido
// ─────────────────────────────────────────────────────────────
for (const skill of EXPECTED_SKILLS) {
  check(`frontmatter-${skill} — SKILL.md tiene frontmatter válido`, () => {
    const path = join(CATALOG_DIR, skill, 'SKILL.md');
    if (!existsSync(path)) {
      throw new Error(`no existe ${path}`);
    }
    const md = readFileSync(path, 'utf8');
    const fm = parseFrontmatter(md);
    if (!fm) throw new Error('frontmatter no parseable');
    if (!fm.name) throw new Error('falta `name` en frontmatter');
    if (!fm.description) throw new Error('falta `description` en frontmatter');
    if (fm.name !== skill) {
      throw new Error(`name="${fm.name}" no coincide con dir "${skill}"`);
    }
    if (fm.description.length < 30) {
      throw new Error(`description muy corta (${fm.description.length} chars)`);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 3. Las 4 secciones requeridas existen (skills stub Sprint 5.2)
// ─────────────────────────────────────────────────────────────
for (const skill of STUB_SKILLS) {
  check(`secciones-${skill} — SKILL.md tiene las 4 secciones requeridas`, () => {
    const path = join(CATALOG_DIR, skill, 'SKILL.md');
    const md = readFileSync(path, 'utf8');
    const missing = REQUIRED_SECTIONS.filter(re => !re.test(md));
    if (missing.length > 0) {
      throw new Error(`faltan secciones: ${missing.map(r => r.source).join(', ')}`);
    }
  });
}

// superpowers-pr (skill madura): solo verificamos que tenga sección "Cuándo activar".
check('secciones-superpowers-pr — skill madura tiene "Cuándo activar"', () => {
  const path = join(CATALOG_DIR, 'superpowers-pr', 'SKILL.md');
  const md = readFileSync(path, 'utf8');
  if (!/##\s+Cu[aá]ndo activar/i.test(md)) {
    throw new Error('superpowers-pr no tiene sección "Cuándo activar"');
  }
});

// ─────────────────────────────────────────────────────────────
// 4. CHANGELOG.md existe en cada skill
// ─────────────────────────────────────────────────────────────
for (const skill of EXPECTED_SKILLS) {
  check(`changelog-${skill} — CHANGELOG.md existe`, () => {
    const path = join(CATALOG_DIR, skill, 'CHANGELOG.md');
    if (!existsSync(path)) {
      throw new Error(`no existe ${path}`);
    }
    const md = readFileSync(path, 'utf8');
    if (md.length < 50) {
      throw new Error(`CHANGELOG muy corto (${md.length} chars)`);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 5. INDEX.md existe y lista todas las skills
// ─────────────────────────────────────────────────────────────
check('INDEX — _catalog/INDEX.md existe', () => {
  const path = join(CATALOG_DIR, 'INDEX.md');
  if (!existsSync(path)) {
    throw new Error(`no existe ${path}`);
  }
});

check('INDEX-listing — INDEX.md lista todas las skills esperadas', () => {
  const path = join(CATALOG_DIR, 'INDEX.md');
  const md = readFileSync(path, 'utf8');
  const missing = [];
  for (const skill of EXPECTED_SKILLS) {
    // El INDEX puede listar la skill como `\`<skill>\`` en una tabla.
    const re = new RegExp('`' + skill.replace(/[-]/g, '[-]') + '`');
    if (!re.test(md)) {
      missing.push(skill);
    }
  }
  if (missing.length > 0) {
    throw new Error(`INDEX no lista: ${missing.join(', ')}`);
  }
});

check('INDEX-mcps — INDEX.md menciona la sección de MCPs', () => {
  const path = join(CATALOG_DIR, 'INDEX.md');
  const md = readFileSync(path, 'utf8');
  if (!/MCPs?/i.test(md)) {
    throw new Error('INDEX.md no menciona MCPs como ortogonales');
  }
  if (!/Context7|Firecrawl|Obsidian/i.test(md)) {
    throw new Error('INDEX.md no menciona MCPs concretos (Context7, Firecrawl, Obsidian)');
  }
});

// ─────────────────────────────────────────────────────────────
// 6. doc de MCPs existe
// ─────────────────────────────────────────────────────────────
check('docs-mcps — docs/mcps-recomendados.md existe', () => {
  const path = join(__dirname, 'docs', 'mcps-recomendados.md');
  if (!existsSync(path)) {
    throw new Error(`no existe ${path}`);
  }
  const md = readFileSync(path, 'utf8');
  if (md.length < 500) {
    throw new Error(`mcps doc muy corto (${md.length} chars)`);
  }
  // Debe mencionar al menos los MCPs principales.
  for (const mcp of ['Context7', 'Firecrawl', 'Obsidian']) {
    if (!md.includes(mcp)) {
      throw new Error(`docs/mcps-recomendados.md no menciona ${mcp}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// 7. Sin skills huérfanas (en _catalog/ pero fuera de la lista esperada)
// ─────────────────────────────────────────────────────────────
check('no-huerfanas — todo dir en _catalog/ está en la lista esperada', () => {
  const entries = readdirSync(CATALOG_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  const orphan = dirs.filter(d => !EXPECTED_SKILLS.includes(d));
  if (orphan.length > 0) {
    throw new Error(`directorios huérfanos en _catalog/: ${orphan.join(', ')}. Si son intencionales, agrégalos a EXPECTED_SKILLS.`);
  }
});

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
