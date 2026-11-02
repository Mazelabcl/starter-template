// scripts/importar_modulo.js
// Importa módulos del starter v6 (cockpit, bold-rounds, council, brazos,
// video-director) a un proyecto VIEJO, según modulos.json.
//
// Se corre DESDE el starter v6 apuntando al proyecto viejo (no hay que copiar
// esta herramienta):
//   node <starter-v6>/scripts/importar_modulo.js <modulo> [<modulo>...] [opciones]
//
// Opciones:
//   --destino <dir>   proyecto viejo (por defecto: carpeta actual)
//   --dry-run         solo muestra el plan, no escribe nada
//   --no-install      no corre npm install aunque se agreguen dependencias
//   --no-verify       no corre los comandos de verificación
//   --con-tests       copia también los tests del módulo
//   --json            imprime el reporte como JSON
//   list              lista los módulos disponibles
//
// Reglas: nunca sobrescribe archivos existentes (los reporta como conflicto),
// agrega dependencias/scripts/.gitignore que falten sin pisar los existentes,
// y si el proyecto es CommonJS se detiene antes de copiar y explica opciones.
// Idioma: español neutro.

import {
  existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ORIGEN = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class ImportError extends Error {
  constructor(message) { super(message); this.name = 'ImportError'; }
}

export function loadManifest(origen = ORIGEN) {
  const f = join(origen, 'modulos.json');
  if (!existsSync(f)) throw new ImportError(`No encuentro modulos.json en ${origen}.`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

/** Normaliza cada entrada de `files` a { src, dest }. */
export function fileEntries(mod) {
  return (mod.files || []).map(e => (typeof e === 'string' ? { src: e, dest: e } : { src: e.src, dest: e.dest || e.src }));
}

/** Orden de importación con dependencias primero (falla si hay ciclos o módulos inexistentes). */
export function resolveOrder(manifest, names) {
  const order = [];
  const state = {};
  const visit = (n, chain) => {
    const mod = manifest.modules[n];
    if (!mod) throw new ImportError(`No existe el módulo "${n}". Disponibles: ${Object.keys(manifest.modules).filter(k => !manifest.modules[k].internal).join(', ')}.`);
    if (state[n] === 'done') return;
    if (state[n] === 'visiting') throw new ImportError(`Dependencia circular: ${[...chain, n].join(' → ')}`);
    state[n] = 'visiting';
    for (const r of mod.requires || []) visit(r, [...chain, n]);
    state[n] = 'done';
    order.push(n);
  };
  for (const n of names) visit(n, []);
  return order;
}

/** Revisión estática de exports (no ejecuta el archivo). */
export function hasExport(source, name) {
  if (name === 'default') return /export\s+default\b/.test(source);
  const n = name.replace(/[$]/g, '\\$');
  if (new RegExp(`export\\s+(async\\s+)?(function\\*?|const|let|var|class)\\s+${n}\\b`).test(source)) return true;
  const re = /export\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(source))) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim());
    if (names.includes(name)) return true;
  }
  return false;
}

function walkJs(dir, root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.venv', '.cache'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJs(p, root, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Archivos .js del proyecto que usan CommonJS (require / module.exports). */
export function findCommonJs(destino) {
  return walkJs(destino, destino)
    .filter(f => {
      const s = readFileSync(f, 'utf8');
      return /(^|[^.\w])require\s*\(\s*['"`]/m.test(s) || /\bmodule\.exports\b|\bexports\.\w+\s*=/.test(s);
    })
    .map(f => relative(destino, f).split(sep).join('/'));
}

function sameFile(a, b) {
  const x = readFileSync(a);
  const y = readFileSync(b);
  if (x.equals(y)) return true;
  // Ignora diferencias de fin de línea (CRLF vs LF).
  return x.toString('utf8').replace(/\r\n/g, '\n') === y.toString('utf8').replace(/\r\n/g, '\n');
}

/**
 * Planifica (y si !dryRun, aplica) la importación. Devuelve un reporte.
 */
export function importModules(names, { origen = ORIGEN, destino = process.cwd(), dryRun = false, withTests = false } = {}) {
  const manifest = loadManifest(origen);
  destino = resolve(destino);
  if (resolve(origen) === destino) throw new ImportError('El destino es el mismo starter. Corre el comando dentro del proyecto viejo.');
  const order = resolveOrder(manifest, names);
  const report = {
    origen, destino, modules: order, copied: [], identical: [], conflicts: [], missing_exports: [],
    deps_added: {}, deps_kept: [], scripts_added: {}, scripts_conflicts: [], gitignore_added: [],
    type_module_added: false, optional_npm: {}, notes: [], verify: [],
  };

  // 1. package.json y tipo de módulo (antes de copiar nada).
  const pkgPath = join(destino, 'package.json');
  if (!existsSync(pkgPath)) throw new ImportError(`No hay package.json en ${destino}. ¿Es la carpeta del proyecto? Si es un proyecto sin Node, crea uno con: npm init -y`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.type !== 'module') {
    const cjs = findCommonJs(destino);
    if (cjs.length) {
      throw new ImportError([
        `El proyecto usa CommonJS (require/module.exports) y los módulos del starter son ESM (import/export). No copié nada.`,
        `Archivos CommonJS (${cjs.length}): ${cjs.slice(0, 10).join(', ')}${cjs.length > 10 ? ', ...' : ''}`,
        'Opciones:',
        '  1. (recomendada) Renombrar esos archivos a .cjs (y sus require a la nueva ruta) y luego agregar "type": "module" al package.json.',
        '  2. Convertirlos a ESM (import/export).',
        'Después vuelve a correr la importación.',
      ].join('\n'));
    }
    pkg.type = 'module';
    report.type_module_added = true;
  }

  // 2. Archivos.
  for (const name of order) {
    const mod = manifest.modules[name];
    const entries = fileEntries(mod);
    if (withTests) for (const t of mod.tests || []) entries.push({ src: t, dest: t });
    for (const { src, dest } of entries) {
      const from = join(origen, src);
      const to = join(destino, dest);
      if (!existsSync(from)) throw new ImportError(`modulos.json lista ${src} pero no existe en el starter.`);
      if (!existsSync(to)) {
        report.copied.push(dest);
        if (!dryRun) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); }
      } else if (sameFile(from, to)) {
        report.identical.push(dest);
      } else {
        report.conflicts.push({ module: name, file: dest });
      }
    }
    for (const [file, names] of Object.entries(mod.requires_exports || {})) {
      const to = join(destino, file);
      const source = existsSync(to) && !report.copied.includes(file) ? readFileSync(to, 'utf8') : null;
      if (source === null) continue; // se copió la versión del starter: exporta todo
      const missing = names.filter(n => !hasExport(source, n));
      if (missing.length) report.missing_exports.push({ module: name, file, missing });
    }
    // 3. npm, scripts, gitignore.
    pkg.dependencies = pkg.dependencies || {};
    for (const [dep, ver] of Object.entries(mod.npm || {})) {
      const has = pkg.dependencies[dep] || pkg.devDependencies?.[dep];
      if (!has) { pkg.dependencies[dep] = ver; report.deps_added[dep] = ver; }
      else if (has !== ver) report.deps_kept.push(`${dep}@${has} (el starter usa ${ver})`);
    }
    pkg.scripts = pkg.scripts || {};
    for (const [k, v] of Object.entries(mod.scripts || {})) {
      if (!(k in pkg.scripts)) { pkg.scripts[k] = v; report.scripts_added[k] = v; }
      else if (pkg.scripts[k] !== v) report.scripts_conflicts.push({ script: k, actual: pkg.scripts[k], starter: v });
    }
    Object.assign(report.optional_npm, mod.optional_npm || {});
    if (mod.notes) report.notes.push(`${name}: ${mod.notes}`);
  }

  // .gitignore
  const giPath = join(destino, '.gitignore');
  const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  const have = new Set(gi.split(/\r?\n/).map(l => l.trim()));
  const blocks = [];
  for (const name of order) {
    const lines = (manifest.modules[name].gitignore || []).filter(l => !have.has(l));
    if (!lines.length) continue;
    lines.forEach(l => have.add(l));
    report.gitignore_added.push(...lines);
    blocks.push(`# ${name} (importado del starter v6 con /importar-modulo)`, ...lines);
  }
  if (!dryRun) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (blocks.length) writeFileSync(giPath, gi + (gi && !gi.endsWith('\n') ? '\n' : '') + (gi ? '\n' : '') + blocks.join('\n') + '\n');
  }
  return report;
}

/** npm install en el destino (solo si se agregaron dependencias o falta node_modules). */
export function installDeps(destino, report) {
  const needs = Object.keys(report.deps_added).length > 0 || !existsSync(join(destino, 'node_modules'));
  if (!needs) return { ran: false };
  // Un solo string con shell: npm es npm.cmd en Windows y spawn sin shell no lo resuelve.
  const r = spawnSync('npm install --ignore-scripts --no-fund --no-audit', { cwd: destino, encoding: 'utf8', shell: true });
  return { ran: true, ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-5).join('\n') };
}

/** Corre los comandos `verify` de cada módulo en el destino. Borra lo que el ejemplo del cockpit haya creado. */
export function runVerify(names, { origen = ORIGEN, destino = process.cwd(), env = {} } = {}) {
  const manifest = loadManifest(origen);
  destino = resolve(destino);
  const order = resolveOrder(manifest, names);
  const ejemplo = join(destino, 'cockpit', 'reviews', 'ejemplo-cockpit.json');
  const ejemploExistia = existsSync(ejemplo);
  const results = [];
  for (const name of order) {
    for (const cmd of manifest.modules[name].verify || []) {
      const r = spawnSync(cmd, { cwd: destino, shell: true, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
      results.push({ module: name, cmd, ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-4).join('\n') });
    }
  }
  if (!ejemploExistia && existsSync(ejemplo)) { try { unlinkSync(ejemplo); } catch { /* ignore */ } }
  return results;
}

export function formatReport(report) {
  const out = [];
  out.push(`Módulos: ${report.modules.join(' → ')}`);
  out.push(`Copiados (${report.copied.length}): ${report.copied.join(', ') || 'ninguno'}`);
  if (report.identical.length) out.push(`Ya estaban iguales: ${report.identical.length} archivos (no los toqué).`);
  if (report.conflicts.length) {
    out.push(`CONFLICTOS (${report.conflicts.length}, NO sobrescritos; tu versión queda intacta):`);
    for (const c of report.conflicts) out.push(`  - ${c.file} [${c.module}]`);
  }
  for (const m of report.missing_exports) out.push(`ATENCIÓN: tu ${m.file} no exporta ${m.missing.join(', ')}; el módulo ${m.module} lo necesita.`);
  if (report.type_module_added) out.push('package.json: agregué "type": "module" (el proyecto no tenía CommonJS).');
  if (Object.keys(report.deps_added).length) out.push(`Dependencias agregadas: ${Object.entries(report.deps_added).map(([k, v]) => `${k}@${v}`).join(', ')}`);
  if (report.deps_kept.length) out.push(`Dependencias que ya tenías (no las cambié): ${report.deps_kept.join(', ')}`);
  if (Object.keys(report.scripts_added).length) out.push(`Scripts npm agregados: ${Object.keys(report.scripts_added).join(', ')}`);
  for (const s of report.scripts_conflicts) out.push(`Script "${s.script}" ya existe con otro comando (no lo cambié). El starter usa: ${s.starter}`);
  if (report.gitignore_added.length) out.push(`.gitignore: agregué ${report.gitignore_added.length} líneas.`);
  for (const [k, v] of Object.entries(report.optional_npm)) out.push(`Opcional: ${k} (${v})`);
  for (const n of report.notes) out.push(`Nota: ${n}`);
  if (report.install) out.push(report.install.ran ? `npm install: ${report.install.ok ? 'OK' : `FALLÓ\n${report.install.output}`}` : 'npm install: no hizo falta');
  for (const v of report.verify) out.push(`${v.ok ? 'OK   ' : 'FALLA'} [${v.module}] ${v.cmd}${v.ok ? '' : `\n      ${v.output.split('\n').join('\n      ')}`}`);
  return out.join('\n');
}

function cliMain(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const opts = {};
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--destino') { opts.destino = argv[++i]; continue; }
    if (argv[i].startsWith('--')) continue;
    names.push(argv[i]);
  }
  if (!names.length || names[0] === 'list') {
    const m = loadManifest();
    console.log('Módulos disponibles:');
    for (const [k, v] of Object.entries(m.modules)) if (!v.internal) console.log(`  ${k}${v.requires?.length ? ` (requiere: ${v.requires.join(', ')})` : ''}: ${v.description}`);
    console.log('\nUso: node <starter-v6>/scripts/importar_modulo.js <modulo> [--destino <proyecto>] [--dry-run] [--no-install] [--no-verify] [--con-tests]');
    return names.length ? 0 : 1;
  }
  try {
    const dryRun = flags.has('--dry-run');
    const report = importModules(names, { ...opts, dryRun, withTests: flags.has('--con-tests') });
    const destino = report.destino;
    if (!dryRun && !flags.has('--no-install')) report.install = installDeps(destino, report);
    if (!dryRun && !flags.has('--no-verify')) report.verify = runVerify(names, { destino });
    if (flags.has('--json')) console.log(JSON.stringify(report, null, 2));
    else console.log((dryRun ? '[dry-run: no escribí nada]\n' : '') + formatReport(report));
    const bad = report.verify.some(v => !v.ok) || (report.install && report.install.ran && !report.install.ok) || report.missing_exports.length;
    return bad ? 2 : 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(cliMain(process.argv.slice(2)));
