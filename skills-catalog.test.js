// skills-catalog.test.js
//
// Valida .claude/skills/_catalog/skills-catalog.json — la fuente machine-readable
// del catálogo de skills que el kickoff lee y razona (decisión D9).
//
// Checks:
//   1. El JSON existe y parsea.
//   2. Cada entry tiene los campos requeridos con tipos correctos.
//   3. status ∈ {stub, v1.0}; location ∈ {core, catalog}.
//   4. Sync con disco: TODA skill core + catalog en disco está en el JSON, y
//      el JSON no tiene huérfanos (skills que no existen en disco).
//
// No invoca LLM. Lectura pura del filesystem.
// Correr: node skills-catalog.test.js

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '.claude', 'skills');
const CATALOG_DIR = join(SKILLS_DIR, '_catalog');
const JSON_PATH = join(CATALOG_DIR, 'skills-catalog.json');

let passed = 0;
let failed = 0;
const fails = [];

function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); passed += 1; }
  catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); fails.push(label); failed += 1; }
}

function listDirs(dir, exclude = []) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !exclude.includes(e.name))
    .filter(e => existsSync(join(dir, e.name, 'SKILL.md')))
    .map(e => e.name);
}

let catalog = null;

check('skills-catalog.json existe', () => {
  if (!existsSync(JSON_PATH)) throw new Error(`no existe ${JSON_PATH}`);
});

check('skills-catalog.json parsea como array', () => {
  catalog = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  if (!Array.isArray(catalog)) throw new Error('el JSON raíz no es un array');
  if (catalog.length === 0) throw new Error('el array está vacío');
});

check('cada entry tiene los campos requeridos con tipos correctos', () => {
  if (!catalog) throw new Error('catalog no cargó');
  for (const e of catalog) {
    if (typeof e.name !== 'string' || !e.name) throw new Error('name inválido en una entry');
    if (!['core', 'catalog'].includes(e.location)) throw new Error(`location inválido en ${e.name}: ${e.location}`);
    if (!Array.isArray(e.triggers)) throw new Error(`triggers no es array en ${e.name}`);
    if (typeof e.when_to_use !== 'string' || !e.when_to_use) throw new Error(`when_to_use inválido en ${e.name}`);
    if (typeof e.output !== 'string') throw new Error(`output inválido en ${e.name}`);
    if (!['stub', 'v1.0'].includes(e.status)) throw new Error(`status inválido en ${e.name}: ${e.status}`);
    if (typeof e.cost_hint !== 'string') throw new Error(`cost_hint inválido en ${e.name}`);
  }
});

check('sin nombres duplicados en el catálogo', () => {
  const seen = new Set();
  for (const e of catalog) {
    if (seen.has(e.name)) throw new Error(`nombre duplicado: ${e.name}`);
    seen.add(e.name);
  }
});

check('sync con disco — toda skill en disco está en el JSON (sin faltantes)', () => {
  const coreOnDisk = listDirs(SKILLS_DIR, ['_catalog']);
  const catalogOnDisk = listDirs(CATALOG_DIR);
  const namesInJson = new Set(catalog.map(e => e.name));
  const missing = [];
  for (const s of coreOnDisk) if (!namesInJson.has(s)) missing.push(`core/${s}`);
  for (const s of catalogOnDisk) if (!namesInJson.has(s)) missing.push(`catalog/${s}`);
  if (missing.length) throw new Error(`skills en disco faltantes en el JSON: ${missing.join(', ')}. Corre node scripts/build_skills_catalog.js`);
});

check('sync con disco — el JSON no tiene huérfanos (toda entry existe en disco)', () => {
  const coreOnDisk = new Set(listDirs(SKILLS_DIR, ['_catalog']));
  const catalogOnDisk = new Set(listDirs(CATALOG_DIR));
  const orphans = [];
  for (const e of catalog) {
    const onDisk = e.location === 'core' ? coreOnDisk.has(e.name) : catalogOnDisk.has(e.name);
    if (!onDisk) orphans.push(`${e.location}/${e.name}`);
  }
  if (orphans.length) throw new Error(`entries huérfanas en el JSON (no existen en disco): ${orphans.join(', ')}`);
});

check('client-language y non-technical-cold-reader están catalogadas (F3)', () => {
  const names = new Set(catalog.map(e => e.name));
  for (const s of ['client-language', 'non-technical-cold-reader']) {
    if (!names.has(s)) throw new Error(`falta ${s} en el catálogo`);
  }
});

console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILS: ' + fails.join(', '));
  process.exit(1);
}
process.exit(0);
