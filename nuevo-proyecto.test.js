// nuevo-proyecto.test.js
//
// Verifica scripts/nuevo-proyecto.ps1 y scripts/instalar-atajo.ps1:
//   1. Estático: archivos ASCII (PowerShell 5.1 lee mal tildes sin BOM) y con
//      los pasos clave (clone v6, respaldo local, remote remove, .env, kickoff).
//   2. En Windows: nombre inválido o carpeta existente → exit 1 sin clonar;
//      el instalador usa un perfil TEMPORAL (nunca el real), conserva lo que
//      había y es idempotente (un solo bloque marcador).
//   3. Opcional (NUEVO_PROYECTO_E2E=1): clon completo desde este repo a una
//      carpeta temporal con -SinClaude, y se borra al final.
// Idioma: español neutro.

import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(fileURLToPath(import.meta.url));
const NP = join(REPO, 'scripts', 'nuevo-proyecto.ps1');
const IA = join(REPO, 'scripts', 'instalar-atajo.ps1');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1;
  }
}
function assert(c, m) { if (!c) throw new Error(m || 'esperaba true'); }

function ps(file, args) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { encoding: 'utf8', timeout: 300000 });
}

check('scripts .ps1 son ASCII puro', () => {
  for (const f of [NP, IA]) {
    const buf = readFileSync(f);
    const bad = buf.findIndex(b => b > 127);
    assert(bad === -1, `${f}: byte no ASCII en la posición ${bad}`);
  }
});

check('nuevo-proyecto.ps1 tiene los pasos clave', () => {
  const s = readFileSync(NP, 'utf8');
  for (const t of ["$Rama = 'v6'", 'github.com/Mazelabcl/starter-template.git', '$Respaldo', '$Origen', 'remote remove origin',
    '$EnvOrigen', 'npm install', '-ignore-scripts', 'SinClaude', "claude '/kickoff'", 'Test-Path -LiteralPath $destino']) {
    assert(s.includes(t), `falta "${t}"`);
  }
  assert(!/Get-Content[^\n]*\.env|type [^\n]*\.env/i.test(s), 'nunca debe imprimir el .env');
});

check('instalar-atajo.ps1: marcadores, Bypass y perfil parametrizable', () => {
  const s = readFileSync(IA, 'utf8');
  for (const t of ['# >>> mazelab nuevo-proyecto >>>', '# <<< mazelab nuevo-proyecto <<<', '-ExecutionPolicy Bypass -File', '$Perfil', '.mazelab', 'NoCambiarPolitica']) {
    assert(s.includes(t), `falta "${t}"`);
  }
});

const isWin = process.platform === 'win32';
const tmpDirs = [];
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; }

if (isWin) {
  check('nombre con espacio o tilde → exit 1 sin crear nada', () => {
    const d = tmp('np-name-');
    for (const name of ['mi proyecto', 'cafeteria-ñuñoa', '.oculto']) {
      const r = ps(NP, [name, '-Carpeta', d, '-SinClaude', '-Origen', 'C:\\no-existe']);
      assert(r.status === 1, `${name}: exit ${r.status}`);
      assert(/El nombre solo puede tener/.test(r.stdout), r.stdout);
    }
  });

  check('carpeta ya existente → exit 1', () => {
    const d = tmp('np-exists-');
    mkdirSync(join(d, 'ya-existe'));
    const r = ps(NP, ['ya-existe', '-Carpeta', d, '-SinClaude', '-Origen', 'C:\\no-existe']);
    assert(r.status === 1 && /Ya existe la carpeta/.test(r.stdout), r.stdout);
  });

  check('instalar-atajo: perfil temporal, conserva contenido e idempotente', () => {
    const d = tmp('np-atajo-');
    const perfil = join(d, 'perfil', 'Microsoft.PowerShell_profile.ps1');
    mkdirSync(dirname(perfil), { recursive: true });
    writeFileSync(perfil, 'Set-Alias ll Get-ChildItem\n');
    for (let i = 0; i < 2; i++) {
      const r = ps(IA, ['-Perfil', perfil, '-Destino', join(d, 'mazelab'), '-NoCambiarPolitica']);
      assert(r.status === 0, `exit ${r.status}: ${r.stdout}${r.stderr}`);
    }
    const txt = readFileSync(perfil, 'utf8');
    assert(txt.includes('Set-Alias ll Get-ChildItem'), 'perdió el contenido previo');
    assert(txt.split('# >>> mazelab nuevo-proyecto >>>').length === 2, 'bloque duplicado');
    assert(txt.includes(join(d, 'mazelab', 'nuevo-proyecto.ps1')), 'ruta del script');
    assert(existsSync(join(d, 'mazelab', 'nuevo-proyecto.ps1')), 'script copiado');
    // La función carga y responde (validación de nombre, sin clonar).
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `. '${perfil}'; nuevo-proyecto 'con espacio'; exit $LASTEXITCODE`], { encoding: 'utf8', timeout: 60000 });
    assert(r.status === 1 && /El nombre solo puede tener/.test(r.stdout), `función: ${r.status} ${r.stdout}`);
  });

  if (process.env.NUEVO_PROYECTO_E2E === '1') {
    check('E2E: clona desde este repo, quita origin, instala (sin Claude)', () => {
      const d = tmp('np-e2e-');
      const branch = spawnSync('git', ['-C', REPO, 'branch', '--show-current'], { encoding: 'utf8' }).stdout.trim();
      const r = ps(NP, ['prueba-e2e', '-Carpeta', d, '-SinClaude', '-Origen', resolve(REPO), '-Rama', branch, '-EnvOrigen', join(d, 'no.env')]);
      assert(r.status === 0, `exit ${r.status}: ${r.stdout.slice(-800)}`);
      const p = join(d, 'prueba-e2e');
      assert(existsSync(join(p, 'node_modules', 'ajv')), 'npm install');
      const rem = spawnSync('git', ['-C', p, 'remote'], { encoding: 'utf8' }).stdout.trim();
      assert(rem === '', `remotes: ${rem}`);
    });
  } else {
    console.log('SKIP  E2E completo (NUEVO_PROYECTO_E2E=1 para correrlo)');
  }
} else {
  console.log('SKIP  pruebas de PowerShell (solo Windows)');
}

for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
