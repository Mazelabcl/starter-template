// final-system-check.test.js
// Suite final de verificación de integridad estructural del starter v3.
//
// Verifica que TODOS los componentes principales existen y son funcionales:
//   - Cada skill core tiene SKILL.md con frontmatter parseable.
//   - Cada src/*.js módulo se puede importar sin error.
//   - Cada councils/*.json (definidos + templates) parsea como JSON.
//   - dashboard/server.js levanta y responde HTTP.
//   - memory/, roadmap/, contracts/, content/ existen con sus READMEs/templates.
//   - Slash commands en .claude/commands/ tienen frontmatter mínimo.
//
// No corre lógica de negocio — esto es el "smoke estructural" que confirma que
// el repo está completo después de v3.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { spawn } from 'node:child_process';

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
  'agent-template', 'cold-reader-gate', 'confidence-loop', 'council',
  'image-explorer', 'image-gen', 'karpathy-rules', 'kickoff',
  'multimodal-validation', 'pipeline-v2', 'quality-mindset', 'voice-mode',
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
  'webapp-testing', 'xlsx',
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
  'setup-openai', 'setup-openrouter',
  'voz-leer', 'voz-off', 'voz-on',
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
  'image_explorer.js', 'replicate_client.js', 'research.js',
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

await check('councils — todos los .json predefinidos parsean', () => {
  const dir = join(ROOT, 'councils');
  const expected = ['creative-ideation', 'architecture-decision', 'strategy-calls', 'mazelab-council'];
  for (const name of expected) {
    const path = join(dir, `${name}.json`);
    assert(existsSync(path), `falta councils/${name}.json`);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert(parsed && typeof parsed === 'object', `councils/${name}.json no es objeto`);
    assert(parsed.tier_default, `councils/${name}.json sin tier_default`);
    assert(Array.isArray(parsed.personas) && parsed.personas.length >= 3, `councils/${name}.json personas insuficientes`);
  }
});

await check('councils/templates — schema y persona template existen y parsean', () => {
  const dir = join(ROOT, 'councils', 'templates');
  for (const f of ['council.schema.json', 'persona-template.json']) {
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

await check('contracts/ — README.md, validator.js, helpers.js, schemas/, declared/', () => {
  const dir = join(ROOT, 'contracts');
  for (const f of ['README.md', 'validator.js', 'helpers.js', 'test.js']) {
    assert(existsSync(join(dir, f)), `falta contracts/${f}`);
  }
  const schemas = readdirSync(join(dir, 'schemas')).filter(f => f.endsWith('.schema.json'));
  assert(schemas.length >= 5, `contracts/schemas/ tiene ${schemas.length} schemas, se esperan al menos 5`);
});

await check('content/ — templates de principles e INDEX existen', () => {
  const dir = join(ROOT, 'content');
  // Los archivos finales se generan con /kickoff. Acá solo deben existir los templates.
  assert(existsSync(join(dir, 'principles.template.md')), 'falta content/principles.template.md');
  assert(existsSync(join(dir, 'INDEX.template.md')), 'falta content/INDEX.template.md');
});

// ---------- 7. dashboard server up ----------

await check('dashboard/server.js — levanta en puerto temporal y responde GET /api/state', async () => {
  const port = 50000 + Math.floor(Math.random() * 5000);
  const child = spawn(process.execPath, [join(ROOT, 'dashboard', 'server.js')], {
    env: { ...process.env, DASHBOARD_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Esperar a que el server reporte que está escuchando.
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('timeout esperando boot del dashboard')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('escuchando')) {
        clearTimeout(timer);
        res();
      }
    });
  });

  // Hacer GET.
  const status = await new Promise((res, rej) => {
    http.get(`http://localhost:${port}/api/state`, (r) => {
      // Drena para liberar el socket.
      r.resume();
      res(r.statusCode);
    }).on('error', rej);
  });

  child.kill();
  // Esperar que el process realmente cierre antes de continuar.
  await new Promise((res) => child.on('exit', res));

  assert(status === 200, `GET /api/state respondió ${status}, se esperaba 200`);
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

await check('scripts/ — smoke_test.js, voice_tts.js, update_state.js, openai_images.py', () => {
  for (const f of ['smoke_test.js', 'voice_tts.js', 'update_state.js', 'openai_images.py']) {
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
