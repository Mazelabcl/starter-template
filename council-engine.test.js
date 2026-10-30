// council-engine.test.js
// Tests del motor del council de expertos (src/council.js) con el LLM simulado.
// Cubre: fusión con recomendación nunca null, anonimización y re-atribución,
// fallas parciales, red team con parada temprana, gate de costo, contexto del
// proyecto, toCockpitReview, y que NUNCA se escriba en memory/.
//
// Corrida real opcional (cuesta ~USD 0.01, ~60 s): COUNCIL_LIVE=1 node council-engine.test.js
// Esa corrida también usa un directorio temporal, nunca el memory/ real.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  invoke, validateMerge, toCockpitReview, saveResult, buildTldr, summaryLine,
  buildProjectContext, anonymize, CouncilError,
} from './src/council.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
let skipped = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); failed += 1; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sha = p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'missing');
const realDecisionsHash = sha(join(ROOT, 'memory', 'decisions.md'));

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'council-test-'));
  mkdirSync(join(dir, 'content'), { recursive: true });
  mkdirSync(join(dir, 'memory'), { recursive: true });
  writeFileSync(join(dir, 'content', 'principles.md'), '# Principios\n\nPRINCIPIO_UNICO: el usuario es novato.\n');
  writeFileSync(join(dir, 'memory', 'decisions.md'), '# Decisiones\n\n## 2026-10-01: Usar Next.js\n\nDECISION_UNICA\n');
  return dir;
}

// ---------- LLM simulado ----------
// opts.mergeNullTimes: cuántas veces la fusión devuelve recommendation null antes de arreglarse.
// opts.failModels: modelos que lanzan error. opts.attacks: ataques del red team.
function makeMock(opts = {}) {
  const calls = [];
  let mergeNull = opts.mergeNullTimes || 0;
  const reply = (obj, cost = 0.001) => ({
    content: typeof obj === 'string' ? obj : JSON.stringify(obj),
    usage: { prompt_tokens: 1000, completion_tokens: 300 },
    raw: { usage: { cost } },
    model_used: 'mock',
  });
  const chatFn = async ({ model, system, messages }) => {
    const user = messages[0].content;
    const last = messages[messages.length - 1].content;
    calls.push({ model, system, user, last });
    if ((opts.failModels || []).includes(model) && system.includes('ROLE:')) throw new Error(`modelo ${model} caído`);

    if (user.includes('Attack this proposal')) {
      return reply({ attacks: opts.attacks || [{ issue: 'Detalle menor de redacción', severity: 'baja', fix: 'Ajustar texto' }] });
    }
    if (user.includes('Patch the integrated proposal')) {
      return reply({
        integrated_proposal_md: 'Propuesta parchada: empezar con chat de texto [A] y medir antes de agregar voz [B]. Se agrega límite de gasto [R].',
        contributions: [
          { text: 'Empezar con chat de texto', voice: 'A', type: 'idea', adopted: true, why: 'Menor costo' },
          { text: 'Poner tope de gasto mensual a la voz', voice: 'R', type: 'threat', adopted: true, why: 'El red team mostró riesgo de costo' },
        ],
        tensions: [],
        recommendation: 'Lanzar con chat de texto y tope de gasto antes de probar voz.',
        confidence: 'media',
        what_would_change_it: 'Que el costo de voz baje a la mitad.',
      });
    }
    if (system.startsWith('You are the integrator')) {
      const voices = [...user.matchAll(/## Voz ([A-Z])/g)].map(m => m[1]);
      const base = {
        integrated_proposal_md: `Propuesta integrada: chat de texto primero [${voices[0]}], voz como experimento medido [${voices[1]}].`,
        contributions: voices.map((v, i) => ({ text: `Aporte de la voz ${v}`, voice: i === 0 && voices.length > 2 ? `${v},${voices[2]}` : v, type: ['threat', 'opportunity', 'idea'][i % 3], adopted: i % 2 === 0, why: 'Razón concreta' })),
        tensions: [{ between: [voices[0], voices[1]], issue: `Voz ${voices[0]} quiere voz ahora y Voz ${voices[1]} prefiere esperar`, suggested_resolution: 'Experimento acotado' }],
        recommendation: 'Empezar con chat de texto y probar voz con 5 usuarios.',
        confidence: 'media',
        what_would_change_it: 'Que los usuarios novatos prefieran hablar.',
      };
      if (mergeNull > 0) { mergeNull -= 1; return reply({ ...base, recommendation: null }); }
      return reply(base, 0.004);
    }
    // Persona (fase 1)
    const id = user.match(/"persona": "([a-z-]+)"/)[1];
    return reply({
      persona: id,
      threats: [`Riesgo visto por ${id}`],
      opportunities: [`Oportunidad vista por ${id}`],
      ideas: [`Idea de ${id}`],
      key_concern: `La preocupación principal de ${id} sobre costos de voz`,
      would_change_mind_if: 'Datos de uso reales',
    });
  };
  return { chatFn, calls };
}

const Q = '¿Voz con OpenAI Realtime o chat de texto para un usuario novato?';

async function main() {
  await check('validateMerge: rechaza recommendation null, vacía o evasiva; acepta una válida', () => {
    const ok = {
      integrated_proposal_md: 'x'.repeat(50),
      contributions: [{ text: 'abc', voice: 'A', type: 'idea', adopted: true, why: 'porque sí' }],
      tensions: [],
      recommendation: 'Hacer chat de texto primero.',
      confidence: 'alta',
      what_would_change_it: 'nuevos datos',
    };
    assert(validateMerge(ok).ok, validateMerge(ok).errors.join('; '));
    assert(!validateMerge({ ...ok, recommendation: null }).ok, 'null pasó');
    assert(!validateMerge({ ...ok, recommendation: '   ' }).ok, 'vacía pasó');
    assert(!validateMerge({ ...ok, recommendation: 'Requiere decisión humana' }).ok, 'evasiva pasó');
    assert(!validateMerge({ ...ok, confidence: 'muy alta' }).ok, 'confidence inválida pasó');
    assert(!validateMerge({ ...ok, contributions: [{ text: 'abc', voice: 'A', type: 'riesgo', adopted: true, why: 'x' }] }).ok, 'type inválido pasó');
  });

  const root = tempRoot();
  const tmpDecisions = sha(join(root, 'memory', 'decisions.md'));
  let result;
  const mock = makeMock();

  await check('invoke (mock): fusión completa con recomendación, aportes atribuidos y costo real', async () => {
    result = await invoke({ question: Q, template: 'nueva-funcionalidad', root, chatFn: mock.chatFn, now: new Date('2026-10-30T12:00:00Z') });
    assert(result.id === 'council-2026-10-30T12-00-00-000Z', result.id);
    assert(result.mode === 'personas' && result.template === 'nueva-funcionalidad', 'modo/plantilla');
    assert(result.answers.length === 4, `answers ${result.answers.length}`);
    assert(typeof result.merge.recommendation === 'string' && result.merge.recommendation.length > 10, 'sin recomendación');
    const ids = new Set(['cto', 'pm', 'ux-research', 'usuario-novato']);
    for (const c of result.merge.contributions) {
      assert(ids.has(c.persona), `aporte atribuido a ${c.persona}`);
      assert(c.persona_name && c.persona_name !== c.persona || c.persona === 'cto', 'falta nombre de persona');
    }
    assert(new Set(result.merge.contributions.map(c => c.persona)).size === 4, 'no están las 4 personas');
    assert(result.merge.contributions.some(c => c.also_seen_by.length === 1), 'no re-atribuyó una voz compartida "A,C"');
    assert(result.merge.tensions[0].between.every(b => ids.has(b)), 'tensión sin re-atribuir');
    assert(!/\[[A-D]\]/.test(result.merge.integrated_proposal_md), 'quedaron letras de voz en la propuesta');
    assert(!/Voz [A-D]\b/.test(JSON.stringify(result.merge)), 'quedó "Voz X" sin re-atribuir en el texto');
    assert(/(CTO|Product manager|Investigador UX|Usuario novato) quiere voz ahora/.test(result.merge.tensions[0].issue), result.merge.tensions[0].issue);
    assert(result.metadata.cost_source === 'openrouter', 'costo no vino de usage.cost');
    assert(Math.abs(result.metadata.cost_usd - 0.008) < 1e-6, `costo ${result.metadata.cost_usd}`);
    assert(result.metadata.partial === false, 'partial');
  });

  await check('anonimización: el integrador no ve ids ni nombres de personas', () => {
    const mergeCall = mock.calls.find(c => c.system.startsWith('You are the integrator'));
    assert(mergeCall, 'no hubo llamada de fusión');
    assert(!/"persona"/.test(mergeCall.user), 'el campo persona llegó al integrador');
    for (const name of ['Product manager', 'Investigador UX', 'Usuario novato', 'usuario-novato', 'ux-research']) {
      assert(!mergeCall.user.includes(name), `"${name}" llegó al integrador`);
    }
    const a = anonymize([{ persona_id: 'x', answer: { persona: 'x', key_concern: 'k' } }], { shuffle: false });
    assert(a.map.A === 'x' && a.voices[0].answer.persona === undefined, 'anonymize no quitó persona');
  });

  await check('integrador de otra familia que las personas', () => {
    const fams = result.personas.map(p => p.family);
    assert(!fams.includes(result.metadata.synth_model.split('/')[0]) || new Set(fams).size === 4, `synth ${result.metadata.synth_model} vs ${fams}`);
  });

  await check('contexto: principios, decisiones recientes y --files llegan a las personas', async () => {
    const personaCall = mock.calls.find(c => c.system.includes('ROLE:'));
    assert(personaCall.user.includes('PRINCIPIO_UNICO'), 'faltan principios');
    assert(personaCall.user.includes('DECISION_UNICA'), 'faltan decisiones');
    writeFileSync(join(root, 'grande.md'), 'Z'.repeat(20000));
    const ctx = buildProjectContext({ root, files: ['grande.md', 'no-existe.md'] });
    const big = ctx.sources.find(s => s.path === 'grande.md');
    assert(big && big.truncated && big.chars <= 5100, `archivo grande sin recortar: ${JSON.stringify(big)}`);
    assert(ctx.sources.some(s => s.path === 'no-existe.md' && s.missing), 'archivo faltante no reportado');
    assert(ctx.text.length <= 14500, `contexto total ${ctx.text.length}`);
  });

  await check('decisiones vacías (solo plantilla) no se inyectan', () => {
    const r2 = mkdtempSync(join(tmpdir(), 'council-test-'));
    mkdirSync(join(r2, 'memory'));
    writeFileSync(join(r2, 'memory', 'decisions.md'), '# Decisiones del proyecto\n\nUsa addDecision().\n');
    assert(buildProjectContext({ root: r2 }).sources.length === 0, 'inyectó la plantilla vacía');
    rmSync(r2, { recursive: true, force: true });
  });

  await check('fusión que devuelve recommendation null se repara con un reintento', async () => {
    const m = makeMock({ mergeNullTimes: 1 });
    const r = await invoke({ question: Q, personas: ['cto', 'pm'], root, chatFn: m.chatFn });
    assert(r.merge.recommendation.length > 10, 'sin recomendación');
    assert(m.calls.filter(c => c.system.startsWith('You are the integrator')).length === 2, 'no hubo reintento de reparación');
  });

  await check('fusión que insiste en null falla con merge_failed (nunca devuelve null)', async () => {
    const m = makeMock({ mergeNullTimes: 99 });
    let err = null;
    try { await invoke({ question: Q, personas: ['cto', 'pm'], root, chatFn: m.chatFn }); } catch (e) { err = e; }
    assert(err instanceof CouncilError && err.code === 'merge_failed', `error ${err?.code}`);
  });

  await check('una persona caída: el council sigue y marca partial', async () => {
    const m = makeMock({ failModels: ['google/gemini-3.5-flash-lite'] });
    const r = await invoke({ question: Q, template: 'nueva-funcionalidad', root, chatFn: m.chatFn });
    assert(r.metadata.partial === true && r.metadata.personas_alive === 3, `alive ${r.metadata.personas_alive}`);
    assert(r.metadata.failed[0].error.includes('caído'), 'falla no registrada');
  });

  await check('con menos de 2 personas vivas falla con insufficient_personas', async () => {
    const m = makeMock({ failModels: ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna'] });
    let err = null;
    try { await invoke({ question: Q, personas: ['cto', 'pm'], root, chatFn: m.chatFn }); } catch (e) { err = e; }
    assert(err?.code === 'insufficient_personas', `error ${err?.code}`);
  });

  await check('red team con solo ataques menores: parada temprana, sin parche', async () => {
    const m = makeMock();
    const r = await invoke({ question: Q, personas: ['cto', 'pm'], redteam: true, root, chatFn: m.chatFn });
    assert(r.redteam && r.redteam.patched === false && /parada temprana/.test(r.redteam.note), JSON.stringify(r.redteam));
    assert(!m.calls.some(c => c.user.includes('Patch the integrated proposal')), 'parchó igual');
  });

  await check('red team con ataque alto: el integrador parcha y el aporte se atribuye al contrarian', async () => {
    const m = makeMock({ attacks: [{ issue: 'El costo de voz puede dispararse', severity: 'alta', fix: 'Tope de gasto' }] });
    const r = await invoke({ question: Q, personas: ['cto', 'pm'], redteam: true, root, chatFn: m.chatFn });
    assert(r.redteam.patched === true, 'no parchó');
    const rt = r.merge.contributions.find(c => c.source === 'redteam');
    assert(rt && rt.persona === 'contrarian', 'aporte del red team sin atribuir');
    assert(r.merge.integrated_proposal_md.includes('[Contrarian'), 'la propuesta no re-atribuyó [R]');
  });

  await check('multimodel sin confirmar costo falla; confirmado usa >=3 familias', async () => {
    const m = makeMock();
    let err = null;
    try { await invoke({ question: Q, template: 'arquitectura-critica', root, chatFn: m.chatFn }); } catch (e) { err = e; }
    assert(err?.code === 'cost_confirmation_required', `error ${err?.code}`);
    assert(m.calls.length === 0, 'llamó al modelo antes de confirmar');
    const r = await invoke({ question: Q, template: 'arquitectura-critica', confirmCost: true, root, chatFn: m.chatFn });
    assert(new Set(r.personas.map(p => p.family)).size >= 3, 'menos de 3 familias');
    assert(r.redteam !== null, 'la plantilla pide red team');
  });

  await check('toCockpitReview cumple el contrato exacto del cockpit', () => {
    const rv = toCockpitReview(result);
    assert(JSON.stringify(Object.keys(rv)) === JSON.stringify(['id', 'title', 'kind', 'created_at', 'connects_to', 'context_brief', 'items']), Object.keys(rv).join(','));
    assert(rv.kind === 'council' && rv.id === result.id, 'kind/id');
    assert(!Number.isNaN(Date.parse(rv.created_at)), 'created_at no es ISO');
    assert(Array.isArray(rv.connects_to) && rv.connects_to.every(s => typeof s === 'string'), 'connects_to');
    assert(rv.context_brief.length > 100 && rv.context_brief.includes(result.merge.recommendation), 'context_brief pobre');
    const expectedItems = 1 + result.merge.contributions.length + result.merge.tensions.length;
    assert(rv.items.length === expectedItems, `items ${rv.items.length} != ${expectedItems}`);
    for (const it of rv.items) {
      assert(JSON.stringify(Object.keys(it)) === JSON.stringify(['id', 'title', 'body_md', 'media', 'tags']), `item ${it.id}: ${Object.keys(it)}`);
      assert(typeof it.title === 'string' && typeof it.body_md === 'string' && Array.isArray(it.media) && it.tags.every(t => typeof t === 'string'), `tipos de ${it.id}`);
    }
    assert(new Set(rv.items.map(i => i.id)).size === rv.items.length, 'ids repetidos');
    assert(rv.items[0].id === 'propuesta', 'el primer item debe ser la propuesta');
    const c = rv.items.find(i => i.id === 'c1');
    const contrib = result.merge.contributions[0];
    assert(c.tags[0] === contrib.persona && c.tags[1] === contrib.type, `tags ${c.tags}`);
    assert(rv.items.some(i => i.tags[0] === 'tension'), 'falta item de tensión');
  });

  await check('saveResult escribe en councils/results y cockpit/reviews del root dado', () => {
    const { resultPath, reviewPath } = saveResult(result, { root });
    assert(resultPath.startsWith(root) && reviewPath.startsWith(root), 'escribió fuera del root temporal');
    assert(JSON.parse(readFileSync(resultPath, 'utf8')).id === result.id, 'resultado ilegible');
    assert(JSON.parse(readFileSync(reviewPath, 'utf8')).kind === 'council', 'review ilegible');
  });

  await check('TLDR de 5 líneas y línea resumen', () => {
    const lines = buildTldr(result).split('\n');
    assert(lines.length === 5 && lines[0].startsWith('1. Recomendación:'), lines.join(' | '));
    assert(/lo vio (CTO|Product manager|Investigador UX|Usuario novato)/.test(lines[2]), lines[2]);
    assert(summaryLine(result).startsWith('Council listo: 4/4'), summaryLine(result));
  });

  await check('nunca escribe en memory/ (ni el temporal ni el real)', () => {
    assert(sha(join(root, 'memory', 'decisions.md')) === tmpDecisions, 'cambió decisions.md temporal');
    assert(sha(join(ROOT, 'memory', 'decisions.md')) === realDecisionsHash, 'cambió el memory/decisions.md REAL');
    const src = readFileSync(join(ROOT, 'src', 'council.js'), 'utf8');
    assert(!/addDecision|memory\.js/.test(src), 'council.js todavía referencia memory.js/addDecision');
  });

  // ---------- Corrida real opcional ----------
  const key = process.env.OPENROUTER_API_KEY;
  if (process.env.COUNCIL_LIVE !== '1' || !key || /pega-aqui|placeholder/i.test(key)) {
    console.log('SKIP  corrida real (activar con COUNCIL_LIVE=1 y OPENROUTER_API_KEY)');
    skipped += 1;
  } else {
    await check('corrida real barata (2 personas) en directorio temporal', async () => {
      const liveRoot = tempRoot();
      const r = await invoke({ question: 'Nombre corto para una app de notas para novatos', personas: ['storyteller', 'usuario-novato'], root: liveRoot });
      assert(r.merge.recommendation.length > 10, 'sin recomendación');
      assert(r.merge.contributions.every(c => ['storyteller', 'usuario-novato'].includes(c.persona)), 'aporte sin atribuir');
      saveResult(r, { root: liveRoot });
      assert(sha(join(ROOT, 'memory', 'decisions.md')) === realDecisionsHash, 'tocó memory/ real');
      console.log(`      costo USD ${r.metadata.cost_usd} (${r.metadata.cost_source}), ${r.metadata.duration_seconds} s`);
      rmSync(liveRoot, { recursive: true, force: true });
    });
  }

  rmSync(root, { recursive: true, force: true });
  console.log(`\nResultado: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(`fatal: ${e.stack || e.message}`); process.exit(1); });
