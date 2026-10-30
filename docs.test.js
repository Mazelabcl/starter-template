// docs.test.js
// Verifica que la documentación del starter (v6) está al día y liviana:
// - CLAUDE.md cabe en el presupuesto (≤ 6000 chars ≈ 1500 tokens) y no fuerza
//   lecturas pesadas (00-decisions.md) ni menciona features eliminadas.
// - CLAUDE.md conserva lo esencial: español neutro, usuario novato, memoria,
//   roadmap + contrato de marcadores, regla de referencias de imagen, .env.
// - README / QUICKSTART: sin `-b v3`, sin dashboard / voz / contracts.
// - Sin regionalismos rioplatenses obvios.
//
// Salida: PASS/FAIL por check + resumen final.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)));
const README = join(REPO, 'README.md');
const CLAUDEMD = join(REPO, 'CLAUDE.md');
const QUICKSTART = join(REPO, 'docs', 'QUICKSTART.md');
const CAPACIDADES = join(REPO, 'docs', 'capacidades.md');

let passed = 0;
let failed = 0;
const failsList = [];

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${err.message}`);
    failsList.push({ label, error: err.message });
    failed += 1;
  }
}

function read(p) {
  if (!existsSync(p)) throw new Error(`no existe: ${p}`);
  return readFileSync(p, 'utf8');
}

function assertContainsAll(text, tokens, where) {
  const lower = text.toLowerCase();
  const missing = tokens.filter(t => !lower.includes(t.toLowerCase()));
  if (missing.length) throw new Error(`${where}: faltan referencias a [${missing.join(', ')}]`);
}

function assertContainsNone(text, tokens, where) {
  const found = tokens.filter(t => text.includes(t));
  if (found.length) throw new Error(`${where}: contiene referencias eliminadas [${found.join(', ')}]`);
}

// Features eliminadas en v6 Sprint 1: no deben aparecer en los docs de entrada.
const REMOVED = [
  'npm run dashboard', 'npm start', 'update_state.js', 'dashboard_hook',
  'voice-mode', '/voz-on', 'voice_tts', 'contracts/', 'emitOutput', 'consumeInput',
  'pipeline-v2', 'quality-mindset', 'karpathy-rules', 'Brief Contract',
  'claude-opus-4-7', '-b v3',
];

// ---------- CLAUDE.md ----------

check('CLAUDE.md ≤ 6000 caracteres (~1500 tokens)', () => {
  const n = read(CLAUDEMD).length;
  if (n > 6000) throw new Error(`CLAUDE.md tiene ${n} chars`);
});

check('CLAUDE.md no obliga a leer process-log/00-decisions.md', () => {
  if (/00-decisions/.test(read(CLAUDEMD))) throw new Error('CLAUDE.md menciona 00-decisions');
});

check('CLAUDE.md sin referencias a features eliminadas', () => {
  assertContainsNone(read(CLAUDEMD), REMOVED, 'CLAUDE');
});

check('CLAUDE.md no repite la regla obsoleta "subagentes sin Write" (D6)', () => {
  const txt = read(CLAUDEMD);
  if (/D6|Subagentes NO pueden/i.test(txt)) throw new Error('CLAUDE.md conserva D6');
});

check('CLAUDE.md conserva lo esencial', () => {
  assertContainsAll(read(CLAUDEMD), [
    'español neutro', 'TLDR', 'memory/', 'summarize', 'addDecision', '/idea', '/roadmap',
    'review-app', 'marcadores', 'Image 1', 'mimetype', '--env-file=.env', 'feedback.md',
  ], 'CLAUDE');
});

check('CLAUDE.md referencia archivos que existen', () => {
  const txt = read(CLAUDEMD);
  for (const ref of ['memory/README.md', 'councils/README.md', 'docs/capacidades.md', 'docs/company.md',
    '.claude/skills/_catalog/INDEX.md', 'roadmap/roadmap.md']) {
    if (txt.includes(ref) && !existsSync(join(REPO, ref))) {
      throw new Error(`CLAUDE referencia "${ref}" pero no existe`);
    }
  }
});

// ---------- README ----------

check('README.md sin referencias a features eliminadas', () => {
  assertContainsNone(read(README), REMOVED, 'README');
});

check('README.md menciona capacidades, quickstart y comandos', () => {
  assertContainsAll(read(README), [
    'kickoff', 'council', 'image-gen', 'image-explorer', 'review-app', 'roadmap',
    'docs/QUICKSTART.md', 'npm run smoke', 'npm test', '/idea', '/council',
    '.claude/skills/_catalog/INDEX.md', 'v6-dev',
  ], 'README');
});

check('README.md referencia archivos que existen', () => {
  const txt = read(README);
  for (const ref of ['docs/QUICKSTART.md', 'docs/capacidades.md', 'docs/voice-input-guide.md',
    '.claude/skills/_catalog/INDEX.md', 'scripts/smoke_test.README.md']) {
    if (txt.includes(ref) && !existsSync(join(REPO, ref))) {
      throw new Error(`README referencia "${ref}" pero no existe`);
    }
  }
});

// ---------- QUICKSTART / capacidades ----------

check('docs/QUICKSTART.md sin referencias a features eliminadas', () => {
  assertContainsNone(read(QUICKSTART), REMOVED, 'QUICKSTART');
});

check('docs/QUICKSTART.md cubre clonar, install, smoke, kickoff y errores', () => {
  assertContainsAll(read(QUICKSTART), [
    'git clone', 'npm install', 'npm run smoke', '/kickoff', 'OPENROUTER_API_KEY', 'Errores comunes',
  ], 'QUICKSTART');
});

check('docs/capacidades.md sin referencias a features eliminadas', () => {
  assertContainsNone(read(CAPACIDADES), REMOVED, 'capacidades');
});

// ---------- idioma ----------

check('Sin regionalismos rioplatenses obvios en docs de entrada', () => {
  const banned = [' vos ', ' tenés ', ' podés ', ' querés ', ' sabés ', ' decime ', ' mirá ', ' che '];
  for (const file of [README, CLAUDEMD, QUICKSTART, CAPACIDADES]) {
    // "Cero voseo (vos, tenés...)" en la regla de idioma es la lista negra, no uso.
    const txt = ` ${read(file).toLowerCase().replace(/\(vos, tenés, podés, decime, mirá, che\.\.\.\)/g, '')} `;
    for (const b of banned) {
      if (txt.includes(b)) throw new Error(`${file}: contiene "${b.trim()}"`);
    }
  }
});

console.log('');
console.log(`Total: ${passed} pasaron, ${failed} fallaron.`);
if (failed > 0) {
  for (const f of failsList) console.log(`  - ${f.label}: ${f.error}`);
  process.exit(1);
}
console.log('docs OK.');
