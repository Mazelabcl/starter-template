// scripts/build_skills_catalog.js
//
// Genera .claude/skills/_catalog/skills-catalog.json — la fuente machine-readable
// del catálogo de skills (core + catalog). El kickoff lee este JSON entero (es
// barato, ~30 entradas) y RAZONA sobre qué skills proponer, en vez de solo
// matchear keywords (decisión D9).
//
// Cómo funciona:
//   1. Escanea .claude/skills/<core> y .claude/skills/_catalog/<catalog>.
//   2. Lee el frontmatter de cada SKILL.md (name, description, triggers).
//   3. Combina con METADATA curada (when_to_use, output, status, cost_hint).
//   4. Emite el array ordenado: core primero, luego catalog, alfabético dentro
//      de cada grupo.
//
// Correr: node scripts/build_skills_catalog.js
// El test skills-catalog.test.js valida que el JSON esté en sync con el disco.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SKILLS_DIR = join(REPO_ROOT, '.claude', 'skills');
const CATALOG_DIR = join(SKILLS_DIR, '_catalog');
const OUT_PATH = join(CATALOG_DIR, 'skills-catalog.json');

// METADATA curada por skill. Lo que el frontmatter no captura: cuándo usarla en
// lenguaje del orquestador, qué produce, su status de madurez, y una pista de
// costo. status: "stub" (esqueleto v0.1, avisar al proponer) | "v1.0" (madura).
// El INDEX.md (sección "Estado de las skills") dice que TODO el catálogo son
// stubs v0.1 excepto superpowers-pr (v2.0), dual-auditor-protocol y review-app.
const META = {
  // ---- core (siempre activas) ----
  'agent-template': { when_to_use: 'Antes de escribir un agent.md a mano: da scaffold con las 6 secciones y score base ~92/100.', output: 'Archivo de agente en ~/.claude/agents/<slug>.md', status: 'v1.0', cost_hint: 'sin costo de API' },
  'cold-reader-gate': { when_to_use: 'Al cerrar un artefacto creativo antes de mostrarlo al humano: voto binario GO/NO-GO con veto absoluto.', output: 'Veredicto GO/NO-GO + justificación', status: 'v1.0', cost_hint: '~USD 0.02-0.10 (1 modelo)' },
  'confidence-loop': { when_to_use: 'Para subir la calidad de un artefacto (agente, skill, código, plan) hasta 95+/100, máx 5 iteraciones.', output: 'Artefacto mejorado + score final', status: 'v1.0', cost_hint: 'variable según iteraciones' },
  'council': { when_to_use: 'Decisión compleja con tradeoffs reales, naming/ideación, debate de arquitectura. NO para decisiones triviales.', output: 'Deliberación multi-modelo + síntesis en councils/results/', status: 'v1.0', cost_hint: 'Tier 1 ~USD 0.02-0.10; Tier 2/3 más caro, confirmar' },
  'image-explorer': { when_to_use: 'Cuando importa la "mano" del modelo de imagen y aún no sabes cuál usar (concept art, branding).', output: 'Grilla HTML comparando 3-4 modelos', status: 'v1.0', cost_hint: '~USD 0.18-0.20 por 4 modelos' },
  'image-gen': { when_to_use: 'Generar imágenes con gpt-image-2 cuando ya sabes el modelo. Identity lock + refs en el prompt.', output: 'PNG(s) en content/output/<scene>/', status: 'v1.0', cost_hint: '~USD 0.04-0.40 por imagen según calidad' },
  'karpathy-rules': { when_to_use: 'Auto al escribir/editar código: 4 reglas para mantenerlo limpio y surgical.', output: 'Disciplina de código (no genera archivos)', status: 'v1.0', cost_hint: 'sin costo de API' },
  'kickoff': { when_to_use: 'Al iniciar un proyecto o repo recién clonado, antes de construir nada con canon.', output: 'project-profile.json + active-team.json + principles.md + sprint inicial', status: 'v1.0', cost_hint: 'variable (entrevista)' },
  'multimodal-validation': { when_to_use: 'Auto después de generar/editar imágenes: fuerza Read multimodal del PNG. Sin esto no hay PASS.', output: 'Veredicto visual PASS/FAIL', status: 'v1.0', cost_hint: 'sin costo extra de API' },
  'pipeline-v2': { when_to_use: 'Creación no trivial de un deliverable: architect → critic → cold-reader → humano con contracts validados.', output: 'Deliverable validado + memoria sincronizada', status: 'v1.0', cost_hint: 'variable según capas' },
  'quality-mindset': { when_to_use: 'Siempre activa para cualquier tarea no trivial: spec → plan → ejecución → cierre validado.', output: 'Disciplina de proceso (no genera archivos)', status: 'v1.0', cost_hint: 'sin costo de API' },
  'voice-mode': { when_to_use: 'Cuando una respuesta larga se procesa mejor escuchándola. NO para respuestas con código/JSON/tablas.', output: 'Audio TTS de la respuesta', status: 'v1.0', cost_hint: '~USD 0.015 por 1k chars (OpenAI TTS)' },

  // ---- catalog (opcionales, activadas por kickoff o manual) ----
  'brand-guidelines': { when_to_use: 'Content recurrente, business con marca, o build con UI: mantiene content/brand.md (color, tipografía, voz).', output: 'content/brand.md', status: 'stub', cost_hint: 'sin costo' },
  'canvas-design': { when_to_use: 'Visualización custom programática: SVG generativo, infografías, gráficos con D3/p5/three.', output: 'SVG/canvas + código', status: 'stub', cost_hint: 'sin costo' },
  'dual-auditor-protocol': { when_to_use: 'Audit de código de producción de alto riesgo: dos auditores adversariales (Claude + GPT) + synthesizer.', output: 'findings A/B + synthesis-output', status: 'v1.0', cost_hint: '~2.5x un audit single (3 calls)' },
  'frontend-design': { when_to_use: 'Build con superficie UI (web, dashboard, landing): componentes UI accesibles y semánticos.', output: 'Componentes UI (HTML/CSS/JS o framework)', status: 'stub', cost_hint: 'sin costo' },
  'marketing': { when_to_use: 'Lado comercial (business/content): copy publicitario, posts, anuncios, email (AIDA, PAS, BAB).', output: 'Copy/contenido de marketing', status: 'stub', cost_hint: 'sin costo' },
  'pdf-skill': { when_to_use: 'Build/business que produce o recibe PDFs: generación, parsing, extracción, merge/split.', output: 'PDFs o datos extraídos', status: 'stub', cost_hint: 'sin costo' },
  'playwright': { when_to_use: 'Build con webapp y flujos críticos: tests E2E con selectores resilientes y traces.', output: 'Tests Playwright', status: 'stub', cost_hint: 'sin costo' },
  'remotion': { when_to_use: 'Content/marketing con video data-driven: video programático con React, render server-side.', output: 'Video (mp4) renderizado', status: 'stub', cost_hint: 'sin costo (compute local)' },
  'review-app': { when_to_use: 'Revisar PRs/bloques de un sprint marcando OK/Feedback, o leer output .md de agentes (modo viewer). Superficie HTML preferida del usuario.', output: 'App HTTP local en localhost', status: 'v1.0', cost_hint: 'sin costo' },
  'seo': { when_to_use: 'Build/business/content con sitio web público: SEO técnico + on-page (meta, schema, headings) proyecto-local.', output: 'Meta tags, schema, recomendaciones SEO', status: 'stub', cost_hint: 'sin costo' },
  'skill-creator': { when_to_use: 'Cuando aparece disciplina recurrente que conviene capturar como skill del proyecto.', output: 'SKILL.md + CHANGELOG.md', status: 'stub', cost_hint: 'sin costo' },
  'superpowers-full': { when_to_use: 'Build complejo (>1000 LOC, equipo exigente): set completo spec-driven + TDD estricto + debug riguroso.', output: 'Disciplinas + artefactos según uso', status: 'stub', cost_hint: 'sin costo' },
  'superpowers-pr': { when_to_use: 'Build con flujo PR formal (equipo, GitHub flow, CI/CD): 5 reglas duras de Git/PR/code review.', output: 'Disciplina de Git/PR (no genera archivos)', status: 'v1.0', cost_hint: 'sin costo' },
  'web-artifacts-builder': { when_to_use: 'Prototipos, demos, herramientas one-off: HTML+JS+CSS autocontenido en un archivo. Preguntar standalone (inline) vs server (fetch).', output: 'Archivo HTML autocontenido', status: 'stub', cost_hint: 'sin costo' },
  'webapp-testing': { when_to_use: 'Build sin estrategia de testing decidida: pirámide saludable unit/integration/E2E.', output: 'Estrategia + tests', status: 'stub', cost_hint: 'sin costo' },
  'xlsx': { when_to_use: 'Business donde el cliente vive en planillas: lectura/escritura/generación de Excel.', output: 'Archivos .xlsx o datos parseados', status: 'stub', cost_hint: 'sin costo' },
  'client-language': { when_to_use: 'Cuando un deliverable es para CLIENTE/audiencia final (business, content, marketing), no para devs: prohíbe jerga técnica y fuerza lenguaje humano.', output: 'Texto reescrito sin jerga + glosario aplicado', status: 'stub', cost_hint: 'sin costo' },
  'non-technical-cold-reader': { when_to_use: 'Gate final sobre un deliverable de cliente: veta (NO-GO) si contiene jerga técnica. Voto binario de legibilidad para no-técnicos.', output: 'Veredicto GO/NO-GO + lista de términos prohibidos detectados', status: 'stub', cost_hint: 'sin costo (o ~USD 0.02 si usa modelo)' },
};

function parseFrontmatter(md) {
  const lines = md.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const out = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Extrae triggers: si el frontmatter tiene `triggers: [...]`, parsea el array.
// Si no, deriva de las frases entre comillas en la description (core skills),
// PERO solo del segmento posterior a la palabra 'Triggers' — así no captura
// frases entre comillas que son parte de la explicación (ej. la "mano" del
// modelo en image-explorer). Si no hay palabra 'Triggers', no extrae nada.
function extractTriggers(fm) {
  if (fm && typeof fm.triggers === 'string' && fm.triggers.trim().startsWith('[')) {
    try { return JSON.parse(fm.triggers); } catch { /* fallthrough */ }
  }
  const desc = (fm && fm.description) || '';
  const idx = desc.search(/Triggers/i);
  if (idx === -1) return [];
  const triggersSegment = desc.slice(idx);
  const quoted = [...triggersSegment.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  return quoted.length ? quoted : [];
}

function listDirs(dir, exclude = []) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !exclude.includes(e.name))
    .map(e => e.name)
    .sort();
}

function buildEntry(skillName, baseDir, location) {
  const skillPath = join(baseDir, skillName, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  const fm = parseFrontmatter(readFileSync(skillPath, 'utf8')) || {};
  const meta = META[skillName] || {};
  return {
    name: skillName,
    location,
    triggers: extractTriggers(fm),
    when_to_use: meta.when_to_use || (fm.description || '').slice(0, 160),
    output: meta.output || '(no declarado)',
    status: meta.status || 'stub',
    cost_hint: meta.cost_hint || 'sin costo',
  };
}

export function buildCatalog() {
  const core = listDirs(SKILLS_DIR, ['_catalog']);
  const catalog = listDirs(CATALOG_DIR);
  const entries = [];
  for (const s of core) {
    const e = buildEntry(s, SKILLS_DIR, 'core');
    if (e) entries.push(e);
  }
  for (const s of catalog) {
    const e = buildEntry(s, CATALOG_DIR, 'catalog');
    if (e) entries.push(e);
  }
  return entries;
}

function main() {
  const entries = buildCatalog();
  writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  console.log(`[build_skills_catalog] escribí ${entries.length} skills a ${OUT_PATH}`);
  const stubs = entries.filter(e => e.status === 'stub').length;
  console.log(`  core: ${entries.filter(e => e.location === 'core').length}, catalog: ${entries.filter(e => e.location === 'catalog').length}, stubs: ${stubs}`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('build_skills_catalog.js');
if (isMain) main();
