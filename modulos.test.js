// modulos.test.js
//
// Verifica modulos.json y scripts/importar_modulo.js (/importar-modulo):
//   1. Cada archivo listado en modulos.json existe en el starter.
//   2. Dependencias entre módulos coherentes (bold-rounds requiere cockpit,
//      orden con dependencias primero, sin ciclos) y que los imports reales
//      de cada módulo apunten a archivos de sus módulos o de sus requires.
//   3. Importación real a un proyecto "viejo" temporal: no sobrescribe
//      (reporta conflictos), mezcla package.json, .gitignore idempotente,
//      corta si el proyecto es CommonJS y corre la verificación de brazos y
//      cockpit (sin abrir navegador, puerto libre).
// Idioma: español neutro.

import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

import {
  loadManifest, fileEntries, resolveOrder, hasExport, importModules, installDeps, runVerify, ImportError,
} from './scripts/importar_modulo.js';

const REPO = dirname(fileURLToPath(import.meta.url));
const manifest = loadManifest(REPO);

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1;
  }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }

await check('modulos.json: incluye los 5 módulos pedidos', () => {
  for (const m of ['bold-rounds', 'cockpit', 'council', 'brazos', 'video-director']) assert(manifest.modules[m], `falta ${m}`);
});

await check('modulos.json: todos los archivos listados existen', () => {
  const missing = [];
  for (const [name, mod] of Object.entries(manifest.modules)) {
    for (const { src } of fileEntries(mod)) if (!existsSync(join(REPO, src))) missing.push(`${name}: ${src}`);
    for (const t of mod.tests || []) if (!existsSync(join(REPO, t))) missing.push(`${name} (test): ${t}`);
    for (const f of Object.keys(mod.requires_exports || {})) if (!existsSync(join(REPO, f))) missing.push(`${name} (exports): ${f}`);
  }
  assert(!missing.length, missing.join(', '));
});

await check('modulos.json: requires válidos y bold-rounds requiere cockpit', () => {
  for (const [name, mod] of Object.entries(manifest.modules)) {
    for (const r of mod.requires || []) assert(manifest.modules[r], `${name} requiere ${r}, que no existe`);
  }
  assert(manifest.modules['bold-rounds'].requires.includes('cockpit'), 'bold-rounds → cockpit');
  const order = resolveOrder(manifest, ['bold-rounds']);
  assert(order.indexOf('base') < order.indexOf('cockpit') && order.indexOf('cockpit') < order.indexOf('bold-rounds'), order.join(','));
});

await check('modulos.json: los imports relativos de cada módulo están cubiertos', () => {
  const problems = [];
  for (const name of Object.keys(manifest.modules)) {
    const order = resolveOrder(manifest, [name]);
    const covered = new Set(order.flatMap(n => fileEntries(manifest.modules[n]).map(e => e.dest)));
    for (const { src, dest } of fileEntries(manifest.modules[name])) {
      if (!src.endsWith('.js')) continue;
      const code = readFileSync(join(REPO, src), 'utf8');
      const re = /(?:^|\n)\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
      let m;
      while ((m = re.exec(code))) {
        const target = posix.normalize(posix.join(posix.dirname(dest), m[1] || m[2]));
        if (!covered.has(target)) problems.push(`${name}: ${dest} importa ${target}`);
      }
    }
  }
  assert(!problems.length, problems.join('; '));
});

await check('hasExport detecta export function/const/class y export { a as b }', () => {
  const s = 'export function a() {}\nexport const b = 1;\nexport class C {}\nconst x = 1; export { x as _internal };\nexport default a;';
  for (const n of ['a', 'b', 'C', '_internal', 'default']) assert(hasExport(s, n), n);
  assert(!hasExport(s, 'x') && !hasExport(s, 'zzz'), 'falsos positivos');
});

await check('el comando /importar-modulo existe y usa el manifiesto', () => {
  const md = readFileSync(join(REPO, '.claude', 'commands', 'importar-modulo.md'), 'utf8');
  assert(/^---\ndescription: /.test(md.replace(/\r\n/g, '\n')), 'frontmatter');
  for (const t of ['modulos.json', 'importar_modulo.js', '--dry-run', 'CommonJS', 'conflict']) assert(md.includes(t), `falta "${t}"`);
});

// ---------------------------------------------------------------------------
// Importación real a un proyecto viejo temporal
// ---------------------------------------------------------------------------

const tmpDirs = [];
function oldProject(pkg) {
  const d = mkdtempSync(join(tmpdir(), 'importar-viejo-'));
  tmpDirs.push(d);
  writeFileSync(join(d, 'package.json'), JSON.stringify(pkg, null, 2));
  writeFileSync(join(d, '.gitignore'), 'node_modules/\n.env\n');
  return d;
}
function freePort() {
  return new Promise((ok, fail) => {
    const s = net.createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

await check('proyecto CommonJS: se detiene sin copiar nada', () => {
  const d = oldProject({ name: 'viejo-cjs', scripts: {} });
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'viejo.js'), "const fs = require('fs');\nmodule.exports = {};\n");
  try { importModules(['brazos'], { origen: REPO, destino: d }); } catch (e) {
    assert(e instanceof ImportError && /CommonJS/.test(e.message) && /src\/viejo\.js/.test(e.message), e.message);
    assert(!existsSync(join(d, 'src', 'brazos.js')), 'no debió copiar');
    return;
  }
  throw new Error('esperaba ImportError');
});

await check('dry-run no escribe nada', () => {
  const d = oldProject({ name: 'viejo-dry', type: 'module', scripts: {} });
  const r = importModules(['cockpit'], { origen: REPO, destino: d, dryRun: true });
  assert(r.copied.includes('src/cockpit.js'), 'plan incluye cockpit.js');
  assert(!existsSync(join(d, 'src')), 'no debió crear src/');
  assert(!JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).dependencies, 'package.json intacto');
});

let port = await freePort();
await check('importación real: copia, conflictos, package.json, .gitignore y verificación', () => {
  const d = oldProject({ name: 'viejo', scripts: { cockpit: 'echo mio' }, dependencies: { ajv: '^8.0.0' } });
  // Archivo propio que difiere del starter: debe quedar intacto.
  mkdirSync(join(d, 'src'));
  const mine = "// mi versión vieja\nexport function loadEnv() {}\nexport function parseEnv() {}\n";
  writeFileSync(join(d, 'src', 'load_env.js'), mine);

  const r = importModules(['cockpit', 'brazos'], { origen: REPO, destino: d });
  assert(r.type_module_added, 'agrega type module');
  assert(r.conflicts.some(c => c.file === 'src/load_env.js'), 'conflicto reportado');
  assertEq(readFileSync(join(d, 'src', 'load_env.js'), 'utf8'), mine, 'no sobrescribe');
  assert(existsSync(join(d, 'src', 'cockpit.js')) && existsSync(join(d, 'cockpit', 'public', 'app.js')), 'copió el cockpit');
  const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'));
  assertEq(pkg.type, 'module', 'type');
  assertEq(pkg.dependencies.ajv, '^8.0.0', 'conserva la versión propia de ajv');
  assertEq(pkg.dependencies['ajv-formats'], '^3.0.1', 'agrega ajv-formats');
  assertEq(pkg.scripts.cockpit, 'echo mio', 'no pisa el script propio');
  assertEq(pkg.scripts['cockpit:open'], 'node src/cockpit.js open', 'agrega cockpit:open');
  assert(r.scripts_conflicts.some(s => s.script === 'cockpit'), 'reporta script en conflicto');
  const gi = readFileSync(join(d, '.gitignore'), 'utf8');
  assert(gi.includes('cockpit/.server.pid') && gi.split('node_modules/').length === 2, 'gitignore');

  // Segunda corrida: idempotente.
  const r2 = importModules(['cockpit', 'brazos'], { origen: REPO, destino: d });
  assertEq(r2.copied.length, 0, 'nada nuevo que copiar');
  assertEq(r2.gitignore_added.length, 0, 'gitignore sin duplicados');

  const inst = installDeps(d, r);
  assert(inst.ran && inst.ok, `npm install: ${inst.output}`);
  const v = runVerify(['cockpit', 'brazos'], { origen: REPO, destino: d, env: { COCKPIT_NO_BROWSER: '1', COCKPIT_PORT: String(port) } });
  const bad = v.filter(x => !x.ok);
  assert(!bad.length, bad.map(b => `${b.cmd}: ${b.output}`).join(' | '));
  assert(!existsSync(join(d, 'cockpit', 'reviews', 'ejemplo-cockpit.json')), 'borra la revisión de ejemplo');
  assert(!existsSync(join(d, 'cockpit', '.server.pid')), 'el cockpit quedó cerrado');
});

function assertEq(a, e, m) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m}: esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`); }

await new Promise(r => setTimeout(r, 300));
for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
