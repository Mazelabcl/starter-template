// council-skill.test.js
// Test conceptual de la skill `council` (Sprint 4.4).
// Verifica que el SKILL.md, el slash command y los placeholders existan
// con la estructura mínima esperada.
// No prueba comportamiento de runtime — la skill es un .md.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;

const SKILL_DIR = resolve(REPO_ROOT, '.claude', 'skills', 'council');
const SKILL_PATH = join(SKILL_DIR, 'SKILL.md');
const COMMAND_PATH = resolve(REPO_ROOT, '.claude', 'commands', 'council.md');
const RESULTS_DIR = resolve(REPO_ROOT, 'councils', 'results');
const RESULTS_GITKEEP = join(RESULTS_DIR, '.gitkeep');
const CATALOG_README = resolve(REPO_ROOT, '.claude', 'skills', '_catalog', 'README.md');
const V3_PLAN = resolve(REPO_ROOT, 'process-log', 'v3-plan.md');

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Parses simple YAML frontmatter at top of a markdown file. Returns {fm, body}.
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { fm: null, body: text };
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body: match[2] };
}

function getHeaders(body, level) {
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`);
  const headers = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(re);
    if (m) headers.push(m[1]);
  }
  return headers;
}

// =============================================================================
// 1. Existencia de archivos
// =============================================================================

check('SKILL.md existe en .claude/skills/council/', () => {
  assert(existsSync(SKILL_PATH), `no encontrado: ${SKILL_PATH}`);
});

check('slash command .claude/commands/council.md existe', () => {
  assert(existsSync(COMMAND_PATH), `no encontrado: ${COMMAND_PATH}`);
});

check('directorio councils/results/ existe', () => {
  assert(existsSync(RESULTS_DIR), `no encontrado: ${RESULTS_DIR}`);
  const st = statSync(RESULTS_DIR);
  assert(st.isDirectory(), `councils/results no es directorio`);
});

check('placeholder councils/results/.gitkeep existe', () => {
  assert(existsSync(RESULTS_GITKEEP), `no encontrado: ${RESULTS_GITKEEP}`);
});

// =============================================================================
// 2. Frontmatter del SKILL.md
// =============================================================================

const skillRaw = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, 'utf8') : '';
const { fm: skillFm, body: skillBody } = parseFrontmatter(skillRaw);

check('SKILL.md tiene frontmatter YAML', () => {
  assert(skillFm !== null, 'frontmatter no encontrado o malformado');
});

check('frontmatter tiene name: council', () => {
  assert(skillFm && skillFm.name === 'council', `name esperado "council", encontrado "${skillFm?.name}"`);
});

check('frontmatter tiene description con triggers explícitos', () => {
  assert(skillFm && skillFm.description && skillFm.description.length >= 80,
    'description ausente o demasiado corta');
  const desc = skillFm.description.toLowerCase();
  assert(desc.includes('council') || desc.includes('multi-modelo'),
    'description debería mencionar council o multi-modelo');
});

check('frontmatter declara allowed-tools (Bash, Read, Edit)', () => {
  assert(skillFm && typeof skillFm['allowed-tools'] === 'string',
    'allowed-tools ausente');
  const tools = skillFm['allowed-tools'];
  assert(/Bash/i.test(tools), 'allowed-tools debe incluir Bash');
  assert(/Read/i.test(tools), 'allowed-tools debe incluir Read');
  assert(/Edit/i.test(tools), 'allowed-tools debe incluir Edit');
});

// =============================================================================
// 3. Las 7 secciones requeridas (H2 headers)
// =============================================================================

const REQUIRED_SECTIONS = [
  /Cuándo activar esta skill/i,
  /Selección del council/i,
  /Flujo de orquestación/i,
  /Confirmación de costo/i,
  /[Cc]rear council custom/i,
  /Anti-?patrones/i,
  /Ejemplos end-to-end/i,
];

const h2Headers = skillBody ? getHeaders(skillBody, 2) : [];

check('SKILL.md tiene al menos 7 secciones H2', () => {
  assert(h2Headers.length >= 7, `solo ${h2Headers.length} H2 headers encontrados`);
});

for (let i = 0; i < REQUIRED_SECTIONS.length; i += 1) {
  const re = REQUIRED_SECTIONS[i];
  const label = `sección requerida #${i + 1} (${re.source})`;
  check(label, () => {
    const matched = h2Headers.some(h => re.test(h));
    assert(matched, `ningún H2 coincide con ${re}; encontrados: ${h2Headers.join(' | ')}`);
  });
}

// =============================================================================
// 4. Slash command estructura mínima
// =============================================================================

const commandRaw = existsSync(COMMAND_PATH) ? readFileSync(COMMAND_PATH, 'utf8') : '';
const { fm: commandFm, body: commandBody } = parseFrontmatter(commandRaw);

check('slash command tiene frontmatter', () => {
  assert(commandFm !== null, 'frontmatter no encontrado en commands/council.md');
});

check('slash command tiene description', () => {
  assert(commandFm && commandFm.description && commandFm.description.length > 20,
    'description ausente o demasiado corta');
});

check('slash command despacha los 4 casos (vacío, name, new, desconocido)', () => {
  assert(commandBody, 'cuerpo del slash vacío');
  assert(/Caso 1/i.test(commandBody), 'falta despacho Caso 1 (sin argumento)');
  assert(/Caso 2/i.test(commandBody), 'falta despacho Caso 2 (invocación directa)');
  assert(/Caso 3/i.test(commandBody), 'falta despacho Caso 3 (new custom)');
  assert(/Caso 4/i.test(commandBody), 'falta despacho Caso 4 (desconocido)');
});

check('slash command lista los 4 councils predefinidos', () => {
  assert(/creative-ideation/.test(commandBody), 'falta creative-ideation');
  assert(/architecture-decision/.test(commandBody), 'falta architecture-decision');
  assert(/strategy-calls/.test(commandBody), 'falta strategy-calls');
  assert(/mazelab-council/.test(commandBody), 'falta mazelab-council');
});

// =============================================================================
// 5. Contenido sustancial del SKILL.md
// =============================================================================

check('SKILL.md menciona los 4 councils predefinidos', () => {
  for (const name of ['creative-ideation', 'architecture-decision', 'strategy-calls', 'mazelab-council']) {
    assert(skillBody.includes(name), `falta mención de ${name}`);
  }
});

check('SKILL.md menciona los 3 tiers con costo aprox', () => {
  assert(/Tier 1/i.test(skillBody) && /Tier 2/i.test(skillBody) && /Tier 3/i.test(skillBody),
    'faltan menciones de Tier 1/2/3');
  assert(/USD/i.test(skillBody) || /\$/.test(skillBody),
    'faltan referencias a costo en USD');
});

check('SKILL.md menciona node src/council.js (CLI)', () => {
  assert(/node\s+src\/council\.js/.test(skillBody),
    'no se ve la invocación CLI esperada');
});

check('SKILL.md menciona addDecision para persistir', () => {
  assert(/addDecision/.test(skillBody),
    'falta referencia a addDecision()');
});

check('SKILL.md tiene al menos 4 anti-patrones tabulados', () => {
  // Conteo de filas de tabla en la sección de anti-patrones.
  const idx = skillBody.search(/##\s+Sección 6/i);
  assert(idx >= 0, 'no encuentro Sección 6');
  const next = skillBody.indexOf('## Sección', idx + 5);
  const slice = next > 0 ? skillBody.slice(idx, next) : skillBody.slice(idx);
  const tableRows = slice.split(/\r?\n/).filter(l => /^\|/.test(l) && !/^\|\s*-/.test(l));
  assert(tableRows.length >= 5, `solo ${tableRows.length} filas de tabla en Sección 6 (header + datos)`);
});

check('SKILL.md tiene al menos 3 ejemplos end-to-end (A, B, C)', () => {
  const idx = skillBody.search(/##\s+Sección 7/i);
  assert(idx >= 0, 'no encuentro Sección 7');
  const slice = skillBody.slice(idx);
  // Sub-headers H3 con "Ejemplo".
  const matches = slice.match(/###\s+Ejemplo\s+[A-Z]/g);
  assert(matches && matches.length >= 3, `encontrados ${matches?.length || 0} ejemplos, mínimo 3`);
});

// =============================================================================
// 6. Idioma neutro — anti-voseo
// =============================================================================

const RIOPLATENSE_PATTERNS = [
  /\bvos\b/i,                  // "vos"
  /\btenés\b/i,
  /\bpodés\b/i,
  /\bquerés\b/i,
  /\bsabés\b/i,
  /\bhacés\b/i,
  /\bdecís\b/i,
  /\bdecime\b/i,
  /\bandá\b/i,
  /\bmirá\b/i,
  /\bche\b/i,
  /\bquilombo\b/i,
];

check('SKILL.md no tiene voseo argentino ni regionalismos rioplatenses', () => {
  for (const re of RIOPLATENSE_PATTERNS) {
    assert(!re.test(skillBody), `regionalismo detectado: ${re.source}`);
  }
});

check('slash command no tiene voseo argentino ni regionalismos rioplatenses', () => {
  for (const re of RIOPLATENSE_PATTERNS) {
    assert(!re.test(commandBody), `regionalismo detectado en command: ${re.source}`);
  }
});

// =============================================================================
// 7. Catalog README actualizado
// =============================================================================

check('_catalog/README.md menciona council como core', () => {
  assert(existsSync(CATALOG_README), `no encontrado: ${CATALOG_README}`);
  const raw = readFileSync(CATALOG_README, 'utf8');
  // Busca la sección de core skills y valida que council esté listada.
  const coreIdx = raw.search(/skills?\s+core/i);
  assert(coreIdx >= 0 || /core/i.test(raw), 'no hay sección core en _catalog/README.md');
  assert(/`council`/.test(raw), 'council no aparece como core skill listada');
});

// =============================================================================
// 8. v3-plan.md tiene la sección de cambios
// =============================================================================

check('process-log/v3-plan.md tiene sección "Cambios respecto al plan original"', () => {
  assert(existsSync(V3_PLAN), `no encontrado: ${V3_PLAN}`);
  const raw = readFileSync(V3_PLAN, 'utf8');
  assert(/##\s+Cambios respecto al plan original/i.test(raw),
    'falta sección "Cambios respecto al plan original"');
  assert(/Sprint 4\.4/i.test(raw),
    'falta mención de Sprint 4.4 en cambios');
  assert(/core/i.test(raw.split('Cambios respecto al plan original')[1] || ''),
    'la sección de cambios no menciona la decisión de core');
});

// =============================================================================
// Resumen final
// =============================================================================

console.log('');
console.log(`Pasados: ${passed}`);
console.log(`Fallados: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
