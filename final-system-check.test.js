// final-system-check.test.js
// Suite final de verificación de integridad estructural del starter (v6).
//
// Verifica que TODOS los componentes principales existen y son funcionales:
//   - Cada skill core tiene SKILL.md con frontmatter parseable.
//   - Cada src/*.js módulo se puede importar sin error.
//   - Cada councils/*.json (definidos + templates) parsea como JSON.
//   - memory/, roadmap/, content/ existen con sus READMEs/templates.
//   - Lo eliminado en v6 (dashboard, voz, contracts, pipeline-v2) no vuelve.
//   - Slash commands en .claude/commands/ tienen frontmatter mínimo.
//
// No corre lógica de negocio — esto es el "smoke estructural" que confirma que
// el repo está completo.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

let pass = 0;
let fail = 0;
const failures = [];

function ok(name) {
  console.log(`PASS  ${name}`);
  pass++;
}

function bad(name, msg) {
  console.error(`FAIL  ${name}\n      ${msg}`);
  fail++;
  failures.push({ name, msg });
}

async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    bad(name, e?.message ?? String(e));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hasFrontmatter(path) {
  const txt = readFileSync(path, 'utf8');
  return /^---\s*\n[\s\S]+?\n---\s*\n/.test(txt);
}

// ---------- 1. Skills core ----------

const CORE_SKILLS_EXPECTED = [
  'agent-template', 'bold-rounds', 'council', 'image-explorer', 'image-gen', 'kickoff',
  'multimodal-validation',
];

await check('skills core — todas presentes con SKILL.md y frontmatter', () => {
  for (const slug of CORE_SKILLS_EXPECTED) {
    const dir = join(ROOT, '.claude', 'skills', slug);
    assert(existsSync(dir), `falta carpeta ${dir}`);
    const skillMd = join(dir, 'SKILL.md');
    assert(existsSync(skillMd), `falta SKILL.md en ${slug}`);
    assert(hasFrontmatter(skillMd), `SKILL.md de ${slug} sin frontmatter`);
  }
});

// ---------- 2. Skills catálogo ----------

const CATALOG_SKILLS_EXPECTED = [
  'brand-guidelines', 'canvas-design', 'frontend-design', 'marketing',
  'pdf-skill', 'playwright', 'remotion', 'seo', 'skill-creator',
  'superpowers-full', 'superpowers-pr', 'web-artifacts-builder',
  'webapp-testing', 'xlsx', 'confidence-loop', 'cold-reader-gate',
];

await check('skills catálogo — todas presentes con SKILL.md y frontmatter', () => {
  for (const slug of CATALOG_SKILLS_EXPECTED) {
    const dir = join(ROOT, '.claude', 'skills', '_catalog', slug);
    assert(existsSync(dir), `falta carpeta ${dir}`);
    const skillMd = join(dir, 'SKILL.md');
    assert(existsSync(skillMd), `falta SKILL.md en _catalog/${slug}`);
    assert(hasFrontmatter(skillMd), `SKILL.md de _catalog/${slug} sin frontmatter`);
  }
  const indexMd = join(ROOT, '.claude', 'skills', '_catalog', 'INDEX.md');
  assert(existsSync(indexMd), 'falta _catalog/INDEX.md');
  const readmeMd = join(ROOT, '.claude', 'skills', '_catalog', 'README.md');
  assert(existsSync(readmeMd), 'falta _catalog/README.md');
});

// ---------- 3. Slash commands ----------

const COMMANDS_EXPECTED = [
  'council', 'idea', 'kickoff', 'roadmap',
  'setup-openai', 'setup-openrouter', 'resumen', 'revisar', 'bold-rounds',
];

await check('slash commands — todos presentes con frontmatter', () => {
  for (const c of COMMANDS_EXPECTED) {
    const path = join(ROOT, '.claude', 'commands', `${c}.md`);
    assert(existsSync(path), `falta /${c}.md`);
    assert(hasFrontmatter(path), `comando /${c} sin frontmatter`);
  }
});

// ---------- 4. src/*.js módulos importables ----------

const SRC_MODULES = [
  'memory.js', 'roadmap.js', 'openrouter_client.js', 'council.js',
  'image_explorer.js', 'replicate_client.js', 'research.js', 'cockpit.js',
  'brazos.js',
];

await check('src — cada módulo importa sin lanzar', async () => {
  for (const m of SRC_MODULES) {
    const path = join(ROOT, 'src', m);
    assert(existsSync(path), `falta src/${m}`);
    // Importar usando file URL (Windows-safe).
    const url = 'file:///' + path.replace(/\\/g, '/');
    try {
      await import(url);
    } catch (e) {
      throw new Error(`import('${m}') lanzó: ${e.message}`);
    }
  }
});

// ---------- 5. Councils JSON parseable ----------

await check('councils — personas y plantillas parsean', () => {
  for (const sub of ['personas', 'templates']) {
    const dir = join(ROOT, 'councils', sub);
    assert(existsSync(dir), `falta councils/${sub}/`);
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    assert(files.length >= 5, `councils/${sub}/ tiene solo ${files.length} archivos`);
    for (const f of files) JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
});

await check('councils/schemas — los 4 schemas existen y parsean', () => {
  const dir = join(ROOT, 'councils', 'schemas');
  for (const f of ['persona.schema.json', 'template.schema.json', 'persona-answer.schema.json', 'merge.schema.json']) {
    const path = join(dir, f);
    assert(existsSync(path), `falta ${path}`);
    JSON.parse(readFileSync(path, 'utf8'));
  }
});

// ---------- 6. memory/, roadmap/, contracts/, content/ ----------

await check('memory/ — README.md, schemas, templates, test.js', () => {
  const dir = join(ROOT, 'memory');
  for (const f of ['README.md', 'test.js']) {
    assert(existsSync(join(dir, f)), `falta memory/${f}`);
  }
  assert(existsSync(join(dir, 'schemas', 'project-profile.schema.json')), 'falta memory/schemas/project-profile.schema.json');
  assert(existsSync(join(dir, 'schemas', 'active-team.schema.json')), 'falta memory/schemas/active-team.schema.json');
  assert(existsSync(join(dir, 'templates')), 'falta memory/templates/');
});

await check('roadmap/ — README.md, roadmap.md, current-sprint.json', () => {
  const dir = join(ROOT, 'roadmap');
  for (const f of ['README.md', 'roadmap.md', 'current-sprint.json']) {
    assert(existsSync(join(dir, f)), `falta roadmap/${f}`);
  }
  // current-sprint.json debe parsear.
  JSON.parse(readFileSync(join(dir, 'current-sprint.json'), 'utf8'));
});

await check('content/ — templates de principles e INDEX existen', () => {
  const dir = join(ROOT, 'content');
  // Los archivos finales se generan con /kickoff. Acá solo deben existir los templates.
  assert(existsSync(join(dir, 'principles.template.md')), 'falta content/principles.template.md');
  assert(existsSync(join(dir, 'INDEX.template.md')), 'falta content/INDEX.template.md');
});

// ---------- 7. lo eliminado en v6 no vuelve ----------

await check('v6 — dashboard, voz, contracts, pipeline-v2 y skills de disciplina ya no existen', () => {
  const gone = [
    'dashboard', 'contracts', 'scripts/dashboard_hook.js', 'scripts/update_state.js',
    'scripts/voice_tts.js', '.claude/skills/voice-mode', '.claude/skills/pipeline-v2',
    '.claude/skills/quality-mindset', '.claude/skills/karpathy-rules',
    '.claude/commands/voz-on.md', '.claude/commands/voz-off.md', '.claude/commands/voz-leer.md',
  ];
  const back = gone.filter(p => existsSync(join(ROOT, p)));
  assert(back.length === 0, `volvieron: ${back.join(', ')}`);
  const settings = readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8');
  assert(!/dashboard_hook/.test(settings), 'settings.json todavía llama dashboard_hook.js');
});

// ---------- 8. docs core presentes ----------

await check('docs core — README.md, CLAUDE.md, docs/QUICKSTART.md existen', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'docs/QUICKSTART.md']) {
    const path = join(ROOT, f);
    assert(existsSync(path), `falta ${f}`);
    const stat = statSync(path);
    assert(stat.size > 500, `${f} tiene ${stat.size} bytes, parece truncado`);
  }
});

// ---------- 9. scripts core ----------

await check('scripts/ — smoke_test.js, run_tests.js, session_brief.js, openai_images.py', () => {
  for (const f of ['smoke_test.js', 'run_tests.js', 'session_brief.js', 'openai_images.py']) {
    assert(existsSync(join(ROOT, 'scripts', f)), `falta scripts/${f}`);
  }
});

// ---------- 10. process-log ----------

await check('process-log/ — 00-decisions.md, v3-plan.md, findings-for-template.md existen', () => {
  for (const f of ['00-decisions.md', 'v3-plan.md', 'findings-for-template.md']) {
    assert(existsSync(join(ROOT, 'process-log', f)), `falta process-log/${f}`);
  }
});

// ---------- resultado ----------

console.log(`\n--- final-system-check ---`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);

if (fail > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.msg}`);
  process.exit(1);
}
