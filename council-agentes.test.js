// council-agentes.test.js
// Motor "agentes" de src/council.js (subagentes de Claude Code) y formato
// "entrevista" (coaches que entrevistan a una audiencia ficticia). Sin red y sin
// modelos: los "subagentes" se simulan escribiendo los JSON que pide cada prompt.
// Verifica prompts por persona, avance de fases, pimponeo, registro en el mismo
// formato que `run` (results + cockpit) y el archivo de hallazgos para bold-rounds.
// Idioma: español neutro.

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  prepareAgentRun, advanceAgentRun, recordAgentRun, parseAudience, collectQuestions, AGENT_MODEL,
} from './src/council.js';
import { validateReview, getReview } from './src/cockpit.js';
// bold-rounds es otro módulo: si no está (proyecto con solo council), esa parte se salta.
const BOLD = join(dirname(fileURLToPath(import.meta.url)), 'scripts', 'bold_rounds.js');
const bold = existsSync(BOLD) ? await import(pathToFileURL(BOLD).href) : null;

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
function throws(fn, re, msg) {
  let m = '';
  try { fn(); } catch (e) { m = e.message; }
  assert(re.test(m), `${msg}: obtuve "${m}"`);
}
const read = p => readFileSync(p, 'utf8');
const put = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 1));
const answer = id => ({ persona: id, threats: [`Riesgo concreto visto por ${id}`], opportunities: ['Oportunidad concreta y medible'], ideas: ['Idea concreta para el usuario final'], key_concern: 'que los invitados no suban fotos', would_change_mind_if: 'datos de uso reales' });
// Integrador falso: usa las voces que trae el prompt (Voz A, Voz B...).
function fakeMerge(prompt) {
  const voices = [...new Set([...prompt.matchAll(/## Voz ([A-Z])/g)].map(m => m[1]))];
  return {
    titular: 'Álbum común con QR en cada mesa',
    pasos: ['QR en la mesa', 'Álbum común', 'Favoritas de los novios'],
    integrated_proposal_md: `Propuesta integrada con pasos concretos para que los invitados suban fotos [${voices.join(',')}].`,
    contributions: voices.map((v, i) => ({ titular: `Hallazgo concreto número ${i + 1}`, text: `Aporte de la Voz ${v}`, voice: v, type: ['threat', 'opportunity', 'idea'][i % 3], adopted: i !== 1, why: 'Razón concreta' })),
    tensions: [],
    recommendation: 'Probar el álbum común con QR en una boda real antes de construir más.',
    confidence: 'media',
    what_would_change_it: 'que menos del 20% de invitados suba fotos',
  };
}

const ROOT = mkdtempSync(join(tmpdir(), 'council-agentes-'));
const NOW = new Date('2026-11-05T10:00:00Z');

try {
  // ---------------------------------------------------------------- council
  let councilId;
  await check('prepare (council): un prompt por persona, con su "actúa como" y la ruta de salida', () => {
    const r = prepareAgentRun({ question: '¿Agregamos álbum común o descarga ZIP?', personas: ['cto', 'pm'], root: ROOT, now: NOW });
    councilId = r.plan.id;
    assert(r.tasks.length === 2 && r.plan.phase === 'respuestas', JSON.stringify(r.tasks));
    const p = read(r.tasks[0].prompt_path);
    assert(p.includes('ROLE:') && p.includes('¿Agregamos álbum común'), 'falta rol o pregunta');
    assert(p.includes(`Write ONLY one JSON object to this file with the Write tool: ${r.tasks[0].output_path}`), 'falta la ruta de salida');
    assert(!/Output ONLY one JSON object\. No markdown fences, no text before/.test(p), 'la regla de responder solo JSON contradice escribir el archivo');
    assert(/answer independently/.test(p), 'debe pedir independencia');
    assert(!read(r.tasks[1].prompt_path).includes(r.tasks[0].output_path), 'una persona no debe ver la salida de otra');
  });

  await check('siguiente: espera si falta una respuesta; luego arma el prompt del integrador anónimo', () => {
    const dir = join(ROOT, 'councils', 'runs', councilId);
    put(join(dir, 'respuestas-cto.json'), answer('cto'));
    let r = advanceAgentRun(councilId, { root: ROOT });
    assert(r.status === 'esperando' && r.problems.length === 1 && r.problems[0].who === 'pm', JSON.stringify(r));
    writeFileSync(join(dir, 'respuestas-pm.json'), '```json\n' + JSON.stringify(answer('pm')) + '\n```');
    r = advanceAgentRun(councilId, { root: ROOT });
    assert(r.status === 'nueva-fase' && r.phase === 'integrar' && r.tasks.length === 1, JSON.stringify(r));
    const p = read(r.tasks[0].prompt_path);
    assert(/## Voz A/.test(p) && /## Voz B/.test(p) && !/"persona": "cto"/.test(p), 'el integrador debe recibir voces anónimas');
    put(r.tasks[0].output_path, fakeMerge(p));
    assert(advanceAgentRun(councilId, { root: ROOT }).status === 'listo', 'debió quedar listo');
  });

  await check('registrar: mismo formato que run (results + cockpit) y hallazgos.md', () => {
    const r = recordAgentRun(councilId, { root: ROOT, now: new Date('2026-11-05T10:05:00Z') });
    assert(existsSync(r.resultPath) && existsSync(r.reviewPath) && existsSync(r.findingsPath), 'faltan archivos');
    const res = JSON.parse(read(r.resultPath));
    assert(res.engine === 'agentes' && res.mode === 'agentes' && res.metadata.cost_usd === 0, JSON.stringify(res.metadata));
    assert(res.personas.every(p => p.model === AGENT_MODEL), 'modelo');
    assert(res.merge.contributions.every(c => ['cto', 'pm'].includes(c.persona)), 'atribución');
    const rv = getReview(councilId, ROOT);
    validateReview(rv);
    assert(rv.kind === 'council' && rv.items[0].id === 'propuesta' && rv.items[1].stats[0].value === 'Plan', 'revisión');
    assert(/lo vio (CTO|Product manager|PM)/i.test(read(r.findingsPath)), read(r.findingsPath));
    assert(advanceAgentRun(councilId, { root: ROOT }).status === 'registrado', 'estado final');
  });

  // ------------------------------------------------------------- entrevista
  await check('entrevista: valida 3-5 coaches y 3-6 personas de audiencia "Rol: perfil"', () => {
    throws(() => parseAudience('Novia'), /Rol: perfil/, 'formato');
    assert(parseAudience('Novia práctica: 29 años, organiza sola').id === 'aud-novia-practica', 'id');
    throws(() => prepareAgentRun({ question: 'q', formato: 'entrevista', personas: ['cto', 'pm', 'growth'], audiencia: ['A uno: perfil uno', 'B dos: perfil dos'], root: ROOT, dryRun: true }), /3 a 6 personas/, 'audiencia mínima');
    throws(() => prepareAgentRun({ question: 'q', formato: 'entrevista', personas: ['cto', 'pm'], audiencia: ['A uno: perfil uno', 'B dos: perfil dos', 'C tres: perfil tres'], root: ROOT, dryRun: true }), /3 a 5 coaches/, 'coaches mínimos');
    const q = collectQuestions([{ coach: 'a', questions: ['¿Qué hiciste la última vez?', '¿Cuánto pagaste?'] }, { coach: 'b', questions: ['¿Que hiciste la ultima vez?', '¿Quién te ayudó?'] }]);
    assert(q.map(x => x.id).join(',') === 'Q1,Q2,Q3' && q[1].by === 'a', JSON.stringify(q));
  });

  let ivId;
  const AUD = ['Novia práctica: 29 años, organiza sola, presupuesto ajustado', 'Novia romántica: 33 años, quiere recuerdos de la abuela', 'Novia ocupada: 31 años, trabaja full, delega en su hermana'];
  await check('entrevista prepare: coaches con "actúa como" (incluido uno creado) formulan preguntas', () => {
    const r = prepareAgentRun({
      question: '¿Qué innovación haría que más invitados compartan fotos en Weddi?', formato: 'entrevista',
      personas: ['growth', 'ux-research'], crear: ['Coach inspirado en Gary Vaynerchuk: atención, contenido diario y vender sin vergüenza'],
      audiencia: AUD, root: ROOT, now: new Date('2026-11-05T11:00:00Z'),
    });
    ivId = r.plan.id;
    assert(r.plan.phase === 'preguntas' && r.tasks.length === 3, JSON.stringify(r.tasks.map(t => t.who)));
    const vee = r.tasks.find(t => t.who.startsWith('coach-inspirado'));
    const p = read(vee.prompt_path);
    assert(/Actúas como coach inspirado en Gary Vaynerchuk/.test(p) && /never claim to BE them/.test(p), 'coach con personalidad');
    assert(p.includes('aud-novia-practica') && /past behavior/.test(p), 'debe ver a quién entrevista y preguntar por conducta pasada');
    assert(r.panel.subagents === 3 * 3 + 3 * 2 + 1, `subagentes: ${r.panel.subagents}`);
  });

  await check('entrevista: audiencia responde por separado, coaches repreguntan una vez, audiencia responde', () => {
    const dir = join(ROOT, 'councils', 'runs', ivId);
    const plan = () => JSON.parse(read(join(dir, 'plan.json')));
    for (const c of plan().coaches) put(join(dir, `preguntas-${c.id}.json`), { coach: c.id, questions: [`¿Qué hiciste con las fotos de la última boda (${c.id})?`, `¿Qué te frustró de eso (${c.id})?`] });
    let r = advanceAgentRun(ivId, { root: ROOT });
    assert(r.phase === 'respuestas' && r.tasks.length === 3, JSON.stringify(r));
    const pa = read(r.tasks[0].prompt_path);
    assert(/FICTIONAL member of the target audience/.test(pa) && pa.includes('Q1.') && plan().questions.length === 6, 'preguntas numeradas para la audiencia');
    assert(!pa.includes('Novia romántica') || r.tasks[0].who === 'aud-novia-romantica', 'una persona de audiencia no ve a las otras');
    for (const a of plan().audience) put(join(dir, `respuestas-${a.id}.json`), { persona: a.id, answers: plan().questions.map(q => ({ q: q.id, answer: `Respuesta de ${a.name} a ${q.id}: se perdieron en WhatsApp` })) });
    r = advanceAgentRun(ivId, { root: ROOT });
    assert(r.phase === 'repreguntas', r.phase);
    const pr = read(r.tasks[0].prompt_path);
    assert(pr.includes('Respuesta de Novia práctica a Q1') && /exactly ONE follow-up to each interviewee/.test(pr), 'repregunta con la transcripción');
    for (const c of plan().coaches) put(join(dir, `repreguntas-${c.id}.json`), { coach: c.id, followups: plan().audience.map(a => ({ to: a.id, question: `¿Por qué dices eso, ${a.name}? (${c.id})` })) });
    r = advanceAgentRun(ivId, { root: ROOT });
    assert(r.phase === 'respuestas2' && plan().followups.length === 9, JSON.stringify(plan().followups?.length));
    const t = r.tasks.find(x => x.who === 'aud-novia-practica');
    const p2 = read(t.prompt_path);
    assert(p2.includes('¿Por qué dices eso, Novia práctica?') && !p2.includes('¿Por qué dices eso, Novia romántica?'), 'cada persona ve solo sus repreguntas');
    for (const a of plan().audience) put(join(dir, `respuestas2-${a.id}.json`), { persona: a.id, answers: plan().coaches.map(c => ({ from: c.id, answer: `Porque la abuela no usa WhatsApp (${a.name})` })) });
    r = advanceAgentRun(ivId, { root: ROOT });
    assert(r.phase === 'hallazgos' && read(r.tasks[0].prompt_path).includes('Porque la abuela no usa WhatsApp'), 'hallazgos con la transcripción completa');
    for (const c of plan().coaches) put(join(dir, `hallazgos-${c.id}.json`), answer(c.id));
    r = advanceAgentRun(ivId, { root: ROOT });
    assert(r.phase === 'integrar', r.phase);
    const pm = read(r.tasks[0].prompt_path);
    assert(/## Voz C/.test(pm) && pm.includes('# Entrevista:'), 'integrador con voces de coaches y transcripción');
    put(r.tasks[0].output_path, fakeMerge(pm));
  });

  await check('entrevista registrar: lámina de entrevistados y hallazgos que alimentan bold-rounds (solo CONTEXTO)', async () => {
    const r = recordAgentRun(ivId, { root: ROOT });
    const rv = getReview(ivId, ROOT);
    validateReview(rv);
    const slide = rv.items.find(i => i.id === 'entrevistados');
    assert(slide && slide.visual.members.length === 3 && slide.stats[0].value === 6, JSON.stringify(slide && slide.stats));
    assert(r.result.formato === 'entrevista' && r.result.interview.transcript_md.includes('Novia ocupada'), 'transcripción en el resultado');
    const md = read(r.findingsPath);
    assert(md.includes('(entrevista)') && md.includes('Novia romántica') && /validar con usuarios reales/.test(md), md);
    if (!bold) { console.log('      (sin scripts/bold_rounds.js: se salta la parte de bold-rounds)'); return; }
    const site = join(ROOT, 'sitio');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, 'index.html'), '<h1>Weddi</h1>');
    const out = join(ROOT, 'rounds-novia');
    const run = await bold.init(site, { out, modo: 'producto', involucramiento: 'auto', hallazgos: [r.findingsPath] });
    const ctx = bold.buildPrompt('context', { run, out, n: 1, root: ROOT });
    const blind = bold.buildPrompt('blind', { run, out, n: 1, root: ROOT });
    assert(ctx.includes('Novia romántica') && !blind.includes('Novia romántica'), 'hallazgos solo para CONTEXTO');
  });
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

console.log(`\n${passed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
