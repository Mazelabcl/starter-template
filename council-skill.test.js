// council-skill.test.js
// Verifica la skill `council` (council de expertos), su slash command y que
// ambos apunten a la interfaz real de src/council.js. No hace llamadas a APIs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(ROOT, '.claude', 'skills', 'council', 'SKILL.md');
const COMMAND_PATH = join(ROOT, '.claude', 'commands', 'council.md');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m); }
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { fm: null, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

const skillRaw = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, 'utf8') : '';
const { fm, body } = parseFrontmatter(skillRaw);
const cmdRaw = existsSync(COMMAND_PATH) ? readFileSync(COMMAND_PATH, 'utf8') : '';
const { fm: cmdFm, body: cmdBody } = parseFrontmatter(cmdRaw);

check('SKILL.md y slash command existen', () => {
  assert(skillRaw, `no encontrado: ${SKILL_PATH}`);
  assert(cmdRaw, `no encontrado: ${COMMAND_PATH}`);
});

check('SKILL.md tiene como máximo 120 líneas', () => {
  const n = skillRaw.split(/\r?\n/).length;
  assert(n <= 120, `tiene ${n} líneas`);
});

check('frontmatter: name council, description con triggers, allowed-tools', () => {
  assert(fm && fm.name === 'council', `name: ${fm?.name}`);
  assert(fm.description && fm.description.length >= 80, 'description corta');
  assert(/Triggers/.test(fm.description) && /"\/council"/.test(fm.description), 'faltan triggers');
  for (const t of ['Bash', 'Read', 'Edit']) assert(fm['allowed-tools']?.includes(t), `allowed-tools sin ${t}`);
});

check('dice cuándo proponer y cuándo NO proponer un council', () => {
  assert(/##\s+When to propose/i.test(body), 'falta sección de cuándo proponer');
  assert(/Do NOT propose/i.test(body), 'falta cuándo no proponer');
  for (const w of ['feature', 'naming', 'strategy', 'architecture']) assert(body.toLowerCase().includes(w), `no menciona ${w}`);
  assert(/verifiable/i.test(body) && /test/i.test(body), 'no excluye lo verificable con tests/docs');
});

check('incluye la frase literal en español para proponerlo', () => {
  assert(/Para esto te sirve un council de .+¿Lo armo\?/.test(body), 'falta la frase literal');
});

check('documenta los comandos reales del CLI', () => {
  assert(/node src\/council\.js suggest "/.test(body), 'falta suggest');
  assert(/node src\/council\.js run --template/.test(body), 'falta run');
  for (const flag of ['--files', '--redteam', '--mode multimodel', '--yes', '--dry-run']) assert(body.includes(flag), `falta ${flag}`);
});

check('tres formas de elegir expertos: --personas, --crear/--guardar y panel armado por el orquestador', () => {
  assert(/node src\/council\.js run --personas cto,steve-jobs/.test(body), 'falta --personas sin plantilla');
  assert(/--crear "[^"]+: [^"]+"/.test(body) && body.includes('--guardar'), 'falta --crear/--guardar');
  assert(/arma tú el panel de expertos/i.test(fm.description) && /arma tú el panel de expertos/i.test(body), 'falta el trigger del panel');
  assert(/3-5 experts/.test(body) && /Armaría este panel \(~USD/.test(body) && /¿Lo corro\?/.test(body), 'falta la plantilla del panel');
  assert(/ONLY after a yes/.test(body), 'debe correr solo tras un sí');
  assert(/arma tú el panel/i.test(cmdBody), 'el slash command no despacha el panel');
});

check('presentación: cockpit + TLDR de 5 líneas + atribución', () => {
  assert(/cockpit\/reviews\//.test(body), 'no menciona la revisión del cockpit');
  assert(/5-line TLDR/i.test(body), 'no exige TLDR de 5 líneas');
  assert(/esto lo vio/i.test(body), 'no pide atribuir aportes');
});

check('nunca escribe a memoria sola: addDecision solo tras decisión del usuario', () => {
  assert(/never writes to memory/i.test(body), 'no lo dice explícito');
  assert(/addDecision\(\)/.test(body), 'no menciona addDecision');
});

check('sin menú de tiers viejo', () => {
  assert(!/Tier [123]/.test(skillRaw) && !/Tier [123]/.test(cmdRaw), 'quedan referencias a tiers');
  for (const old of ['creative-ideation', 'architecture-decision', 'strategy-calls', 'mazelab-council']) {
    assert(!skillRaw.includes(old) && !cmdRaw.includes(old), `referencia vieja: ${old}`);
  }
});

check('slash command con frontmatter y despacho a suggest/list', () => {
  assert(cmdFm && cmdFm.description && cmdFm.description.length > 20, 'description ausente');
  assert(/council\.js list/.test(cmdBody) && /council\.js suggest/.test(cmdBody), 'no despacha a list/suggest');
});

check('motor agentes + entrevista + involucramiento documentados', () => {
  for (const c of ['node src/council.js prepare --question', 'node src/council.js siguiente <id>', 'node src/council.js registrar <id>', '--formato entrevista', '--audiencia "', '--hallazgos']) assert(body.includes(c), `falta ${c}`);
  assert(/ONE message with one Agent call/.test(body), 'debe pedir subagentes en paralelo');
  assert(/¿Cuánto quieres involucrarte?/.test(body) && /never invent their pick/.test(body), 'falta la pregunta de involucramiento');
  assert(/3-5 coaches/.test(body) && /Run ONLY after a yes/.test(body), 'el panel se propone y se corre tras un sí');
  assert(fm['allowed-tools'].includes('Agent'), 'allowed-tools sin Agent');
});

check('sin voseo ni regionalismos rioplatenses', () => {
  const re = /\b(vos|tenés|podés|querés|sabés|hacés|decís|decime|andá|mirá|che|quilombo)\b/i;
  assert(!re.test(skillRaw), `skill: ${skillRaw.match(re)?.[0]}`);
  assert(!re.test(cmdRaw), `command: ${cmdRaw.match(re)?.[0]}`);
});

check('_catalog/README.md lista council como skill core', () => {
  const raw = readFileSync(join(ROOT, '.claude', 'skills', '_catalog', 'README.md'), 'utf8');
  assert(/`council`/.test(raw), 'council no aparece');
});

console.log(`\nPasados: ${passed}\nFallados: ${failed}`);
process.exit(failed ? 1 : 0);
