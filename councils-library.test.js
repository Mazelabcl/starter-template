// councils-library.test.js
// Valida la biblioteca de personas y plantillas del council de expertos, la
// sugerencia de council por keywords y la asignación de modelos.
// Sin llamadas reales a APIs. Correr: node councils-library.test.js

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPersonas, loadTemplates, validatePersona, validateTemplate, suggestTemplates,
  suggestWithLlm, formatProposal, assignModels, pickSynthModel, familyOf, MODEL_CATALOG,
} from './src/council.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const personaFiles = readdirSync(join(ROOT, 'councils', 'personas')).filter(f => f.endsWith('.json'));
const templateFiles = readdirSync(join(ROOT, 'councils', 'templates')).filter(f => f.endsWith('.json'));
const personas = loadPersonas();
const templates = loadTemplates({ personas });

// Sin tope: en un proyecto, --guardar agrega personas a esta carpeta.
await check('hay al menos 12 personas', () => {
  assert(personaFiles.length >= 12, `hay ${personaFiles.length}`);
});

await check('cada persona cumple el schema y su id coincide con el archivo', () => {
  for (const f of personaFiles) {
    const p = JSON.parse(readFileSync(join(ROOT, 'councils', 'personas', f), 'utf8'));
    const v = validatePersona(p);
    assert(v.ok, `${f}: ${v.errors.join('; ')}`);
    assert(`${p.id}.json` === f, `${f}: id ${p.id} no coincide`);
  }
});

await check('el schema de persona rechaza una persona incompleta', () => {
  assert(!validatePersona({ id: 'x', name: 'X' }).ok, 'debió fallar');
  assert(!validatePersona({ ...personas.get('cto'), model_preference: 'acme' }).ok, 'model_preference inválido debió fallar');
});

await check('las personas cubren las 5 categorías y los roles pedidos', () => {
  const cats = new Set([...personas.values()].map(p => p.category));
  for (const c of ['tecnico', 'producto', 'negocio', 'creativo', 'comodin']) assert(cats.has(c), `falta categoría ${c}`);
  for (const id of ['cto', 'sre', 'seguridad', 'datos', 'pm', 'ux-research', 'growth', 'cfo', 'ventas', 'cliente',
    'director-arte', 'storyteller', 'visionario', 'contrarian', 'usuario-novato']) {
    assert(personas.has(id), `falta persona ${id}`);
  }
});

await check('el visionario se presenta como "inspirado en", no como la persona real', () => {
  const v = personas.get('visionario');
  assert(/inspirado en/i.test(v.name), 'el nombre debe decir "inspirado en"');
  assert(/no eres él/i.test(v.actua_como), 'actua_como debe aclarar que no es la persona real');
});

await check('cada plantilla cumple el schema, su id coincide y sus personas existen', () => {
  for (const f of templateFiles) {
    const t = JSON.parse(readFileSync(join(ROOT, 'councils', 'templates', f), 'utf8'));
    const v = validateTemplate(t);
    assert(v.ok, `${f}: ${v.errors.join('; ')}`);
    assert(`${t.id}.json` === f, `${f}: id ${t.id} no coincide`);
    for (const id of t.personas) assert(personas.has(id), `${f}: persona ${id} no existe`);
  }
});

await check('existen las 6 situaciones pedidas con sus personas', () => {
  const byId = Object.fromEntries(templates.map(t => [t.id, t]));
  const expect = {
    'nueva-funcionalidad': ['cto', 'pm', 'ux-research', 'usuario-novato'],
    'arquitectura-critica': ['cto', 'sre', 'seguridad', 'contrarian'],
    'lanzamiento-marketing': ['growth', 'storyteller', 'ventas', 'cliente'],
    'diseno-visual': ['director-arte', 'ux-research', 'visionario'],
    'precio-negocio': ['cfo', 'ventas', 'cliente'],
    'contenido-creativo': ['storyteller', 'director-arte', 'audiencia'],
  };
  for (const [id, ps] of Object.entries(expect)) {
    assert(byId[id], `falta plantilla ${id}`);
    assert(JSON.stringify(byId[id].personas) === JSON.stringify(ps), `${id}: personas ${byId[id].personas}`);
  }
  assert(byId['arquitectura-critica'].mode === 'multimodel', 'arquitectura-critica debe ser multimodel');
});

await check('personas y plantillas sin voseo ni regionalismos rioplatenses', () => {
  const re = /\b(vos|tenés|podés|querés|sabés|hacés|decís|decime|andá|mirá|che|boludo|quilombo|piola)\b/i;
  for (const dir of ['personas', 'templates']) {
    for (const f of readdirSync(join(ROOT, 'councils', dir)).filter(x => x.endsWith('.json'))) {
      const txt = readFileSync(join(ROOT, 'councils', dir, f), 'utf8');
      assert(!re.test(txt), `${dir}/${f}: regionalismo "${txt.match(re)?.[0]}"`);
    }
  }
});

// ---------- Sugerencia por keywords ----------

const CASES = [
  ['¿Conviene que el cockpit del starter use voz con OpenAI Realtime o basta con chat de texto para un usuario novato?', 'nueva-funcionalidad'],
  ['Quiero migrar la base de datos a Postgres y cambiar la autenticación', 'arquitectura-critica'],
  ['Armemos el plan de lanzamiento con una campaña en Instagram', 'lanzamiento-marketing'],
  ['Qué paleta de colores y tipografía usamos para el logo', 'diseno-visual'],
  ['Cuánto debería cobrar por el plan mensual de suscripción', 'precio-negocio'],
  ['Escribe el guion para un video de YouTube del personaje', 'contenido-creativo'],
  ['Necesito un nombre y un slogan para la app', 'naming'],
];

for (const [text, expected] of CASES) {
  await check(`suggest: "${text.slice(0, 45)}..." -> ${expected}`, () => {
    const s = suggestTemplates(text, { templates });
    assert(s.length >= 1 && s.length <= 2, `devolvió ${s.length} sugerencias`);
    assert(s[0].template.id === expected, `top fue ${s[0].template.id} (${s.map(x => `${x.template.id}:${x.score}`).join(', ')})`);
    assert(s[0].justification.length > 20, 'justificación vacía');
  });
}

await check('suggest: texto sin señales devuelve lista vacía', () => {
  assert(suggestTemplates('hola, qué tal', { templates }).length === 0, 'debió devolver []');
});

await check('suggest: acentos y mayúsculas no importan', () => {
  assert(suggestTemplates('DISEÑO de la PALETA', { templates })[0]?.template.id === 'diseno-visual', 'no normalizó');
});

await check('suggestWithLlm (mock) acepta un id válido y descarta uno inventado', async () => {
  const ok = await suggestWithLlm('algo raro', { templates, chatFn: async () => ({ content: '{"template_id":"estrategia","why":"Es una decisión de rumbo."}' }) });
  assert(ok.length === 1 && ok[0].template.id === 'estrategia' && ok[0].via === 'llm', 'no devolvió estrategia');
  const bad = await suggestWithLlm('algo raro', { templates, chatFn: async () => ({ content: '{"template_id":"inventada"}' }) });
  assert(bad.length === 0, 'debió descartar un id inventado');
});

await check('formatProposal arma la frase literal con nombres, costo y "¿Lo armo?"', () => {
  const s = suggestTemplates(CASES[0][0], { templates })[0];
  const line = formatProposal(s, personas);
  assert(line.startsWith('Para esto te sirve un council de CTO + Product manager'), line);
  assert(/~USD \d+\.\d{2}/.test(line) && line.endsWith('¿Lo armo?'), line);
});

// ---------- Asignación de modelos ----------

await check('modo personas: las 4 personas de nueva-funcionalidad caen en 4 familias distintas', () => {
  const t = templates.find(x => x.id === 'nueva-funcionalidad');
  const a = assignModels(t.personas.map(id => personas.get(id)), 'personas');
  assert(new Set(a.map(x => x.family)).size === 4, a.map(x => x.family).join(','));
});

await check('modo multimodel: toda plantilla de 3+ personas usa >=3 familias', () => {
  for (const t of templates.filter(x => x.personas.length >= 3)) {
    const a = assignModels(t.personas.map(id => personas.get(id)), 'multimodel');
    assert(new Set(a.map(x => x.family)).size >= 3, `${t.id}: ${a.map(x => x.family).join(',')}`);
  }
});

await check('el integrador es de la familia menos usada por las personas', () => {
  const ps = ['cto', 'ux-research', 'cliente'].map(id => personas.get(id)); // 3 prefieren anthropic
  for (const mode of ['personas', 'multimodel']) {
    const a = assignModels(ps, mode);
    const synth = pickSynthModel(a, mode);
    const counts = {};
    a.forEach(x => { counts[x.family] = (counts[x.family] || 0) + 1; });
    const max = Math.max(...Object.values(counts));
    assert((counts[familyOf(synth)] || 0) < max || max === 1, `${mode}: integrador ${synth} es de la familia mayoritaria`);
  }
});

await check('todos los modelos asignables tienen precio en MODEL_CATALOG', () => {
  for (const mode of ['personas', 'multimodel']) {
    const a = assignModels([...personas.values()], mode);
    for (const x of a) assert(MODEL_CATALOG[x.model], `${x.model} sin precio`);
    assert(MODEL_CATALOG[pickSynthModel(a, mode)], 'integrador sin precio');
  }
});

console.log(`\nPasados: ${passed} | Fallados: ${failed}`);
process.exit(failed ? 1 : 0);
