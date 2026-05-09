// docs-v3.test.js
// Verifica que la documentación v3 del starter está actualizada y consistente.
// - README.md existe, tiene >150 líneas, menciona capacidades clave.
// - CLAUDE.md tiene secciones nuevas (hand-off contracts, memoria, roadmap).
// - docs/QUICKSTART.md existe con los 5 pasos.
// - Cero referencias huérfanas a nombres viejos (legacy skill name).
//
// Salida: PASS/FAIL claro por check + resumen final.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname);

const README = join(REPO, 'README.md');
const CLAUDEMD = join(REPO, 'CLAUDE.md');
const QUICKSTART = join(REPO, 'docs', 'QUICKSTART.md');

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

function lineCount(s) {
  return s.split(/\r?\n/).length;
}

function assertContainsAll(text, tokens, where) {
  const lower = text.toLowerCase();
  const missing = tokens.filter(t => !lower.includes(t.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`${where}: faltan referencias a [${missing.join(', ')}]`);
  }
}

function assertNotContains(text, token, where) {
  if (text.includes(token)) {
    throw new Error(`${where}: contiene referencia huérfana a "${token}"`);
  }
}

// ---------- README ----------

check('README.md existe', () => {
  if (!existsSync(README)) throw new Error('README.md no existe en raíz');
});

check('README.md tiene >150 líneas', () => {
  const txt = read(README);
  const n = lineCount(txt);
  if (n < 150) throw new Error(`solo ${n} líneas (esperado >=150)`);
});

check('README.md menciona capacidades clave v3', () => {
  const txt = read(README);
  assertContainsAll(txt, [
    'kickoff',
    'pipeline-v2',
    'council',
    'dashboard',
    'image-explorer',
    'voice-mode',
    'cold-reader-gate',
    'multimodal-validation',
    'image-gen',
    'memory',
    'roadmap',
  ], 'README');
});

check('README.md menciona quickstart, smoke test y MCPs', () => {
  const txt = read(README);
  assertContainsAll(txt, [
    'docs/QUICKSTART.md',
    'npm run smoke',
    'npm run dashboard',
    'docs/mcps-recomendados.md',
    '.claude/skills/_catalog/INDEX.md',
  ], 'README');
});

check('README.md menciona slash commands de v3', () => {
  const txt = read(README);
  assertContainsAll(txt, ['/kickoff', '/idea', '/roadmap', '/council', '/voz-on'], 'README');
});

check('README.md tiene sección de costos', () => {
  const txt = read(README);
  if (!/Costos\s+t[íi]picos/i.test(txt)) {
    throw new Error('falta sección "Costos típicos"');
  }
});

// ---------- CLAUDE.md ----------

check('CLAUDE.md existe', () => {
  if (!existsSync(CLAUDEMD)) throw new Error('CLAUDE.md no existe en raíz');
});

check('CLAUDE.md tiene sección Hand-off contracts', () => {
  const txt = read(CLAUDEMD);
  if (!/Hand-off contracts/i.test(txt)) {
    throw new Error('falta sección "Hand-off contracts"');
  }
  assertContainsAll(txt, ['emitOutput', 'consumeInput', 'declareContract', 'ContractViolation'], 'CLAUDE');
});

check('CLAUDE.md tiene sección Memoria del proyecto', () => {
  const txt = read(CLAUDEMD);
  if (!/Memoria del proyecto/i.test(txt)) {
    throw new Error('falta sección "Memoria del proyecto"');
  }
  assertContainsAll(txt, ['summarize', 'addDecision', 'addLesson', 'memory/'], 'CLAUDE');
});

check('CLAUDE.md tiene sección Roadmap y backlog', () => {
  const txt = read(CLAUDEMD);
  if (!/Roadmap y backlog/i.test(txt)) {
    throw new Error('falta sección "Roadmap y backlog"');
  }
  assertContainsAll(txt, ['/idea', 'roadmap/'], 'CLAUDE');
});

check('CLAUDE.md menciona capacidades nuevas v3', () => {
  const txt = read(CLAUDEMD);
  assertContainsAll(txt, [
    'kickoff',
    'pipeline-v2',
    'cold-reader-gate',
    'multimodal-validation',
    'image-gen',
    'image-explorer',
    'council',
    'voice-mode',
    'agent-template',
    'karpathy-rules',
    'quality-mindset',
    'confidence-loop',
    'openrouter_client',
    'memory.js',
    'roadmap.js',
  ], 'CLAUDE');
});

check('CLAUDE.md mantiene reglas duras y anti-patrones', () => {
  const txt = read(CLAUDEMD);
  if (!/Reglas duras/i.test(txt)) throw new Error('falta sección "Reglas duras"');
  if (!/Anti-patrones/i.test(txt)) throw new Error('falta sección "Anti-patrones"');
  assertContainsAll(txt, ['español neutro', 'multimodal', 'cold-reader', 'paralelismo'], 'CLAUDE');
});

check('CLAUDE.md preserva referencia a process-log/00-decisions.md', () => {
  const txt = read(CLAUDEMD);
  if (!txt.includes('process-log/00-decisions.md')) {
    throw new Error('falta referencia a process-log/00-decisions.md (decisiones humanas — ley)');
  }
});

// ---------- QUICKSTART ----------

check('docs/QUICKSTART.md existe', () => {
  if (!existsSync(QUICKSTART)) throw new Error('docs/QUICKSTART.md no existe');
});

check('docs/QUICKSTART.md tiene los 5 pasos', () => {
  const txt = read(QUICKSTART);
  const stepRe = /Paso\s+([1-5])\b/gi;
  const found = new Set();
  let m;
  while ((m = stepRe.exec(txt)) !== null) found.add(m[1]);
  for (const expected of ['1', '2', '3', '4', '5']) {
    if (!found.has(expected)) throw new Error(`falta "Paso ${expected}"`);
  }
});

check('docs/QUICKSTART.md cubre setup, smoke, dashboard, kickoff', () => {
  const txt = read(QUICKSTART);
  assertContainsAll(txt, [
    'npm install',
    'npm run smoke',
    'npm run dashboard',
    '/kickoff',
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
  ], 'QUICKSTART');
});

check('docs/QUICKSTART.md tiene sección de errores comunes', () => {
  const txt = read(QUICKSTART);
  if (!/[Ee]rrores comunes/.test(txt)) {
    throw new Error('falta sección "Errores comunes"');
  }
});

// ---------- referencias huérfanas ----------
// El nombre legacy se construye en runtime para no contaminar el repo
// con referencias literales que el scanner de superpowers-pr-test.js
// detectaría como huérfanas en este propio archivo.
const LEGACY_NAME = ['superpowers', 'lite'].join('-');

check(`README.md sin referencias a ${LEGACY_NAME}`, () => {
  assertNotContains(read(README), LEGACY_NAME, 'README');
});

check(`CLAUDE.md sin referencias a ${LEGACY_NAME}`, () => {
  assertNotContains(read(CLAUDEMD), LEGACY_NAME, 'CLAUDE');
});

check(`QUICKSTART.md sin referencias a ${LEGACY_NAME}`, () => {
  assertNotContains(read(QUICKSTART), LEGACY_NAME, 'QUICKSTART');
});

// ---------- consistencia con repo real ----------

check('README.md referencia archivos que existen', () => {
  const txt = read(README);
  const refs = [
    'docs/QUICKSTART.md',
    'docs/voice-input-guide.md',
    'docs/mcps-recomendados.md',
    '.claude/skills/_catalog/INDEX.md',
    'memory/README.md',
    'process-log/v3-plan.md',
    'process-log/00-decisions.md',
    'scripts/smoke_test.README.md',
  ];
  for (const ref of refs) {
    if (txt.includes(ref) && !existsSync(join(REPO, ref))) {
      throw new Error(`README referencia "${ref}" pero el archivo no existe`);
    }
  }
});

check('CLAUDE.md referencia archivos que existen', () => {
  const txt = read(CLAUDEMD);
  const refs = [
    'contracts/README.md',
    'memory/README.md',
    'councils/README.md',
    'src/openrouter_client.README.md',
    'process-log/v3-plan.md',
    'process-log/00-decisions.md',
  ];
  for (const ref of refs) {
    if (txt.includes(ref) && !existsSync(join(REPO, ref))) {
      throw new Error(`CLAUDE referencia "${ref}" pero el archivo no existe`);
    }
  }
});

check('No hay regionalismos rioplatenses obvios en docs v3', () => {
  // Lista mínima — captura los más típicos
  const banned = [' vos ', ' tenés ', ' podés ', ' querés ', ' sabés ', ' decime ', ' boludo ', ' che '];
  for (const file of [README, CLAUDEMD, QUICKSTART]) {
    const txt = ' ' + read(file).toLowerCase() + ' ';
    for (const b of banned) {
      if (txt.includes(b)) {
        throw new Error(`${file}: contiene "${b.trim()}" (regionalismo)`);
      }
    }
  }
});

// ---------- resumen ----------

console.log('');
console.log(`Total: ${passed} pasaron, ${failed} fallaron.`);
if (failed > 0) {
  console.log('');
  console.log('Detalle de fallos:');
  for (const f of failsList) {
    console.log(`  - ${f.label}: ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('docs-v3 OK.');
  process.exit(0);
}
