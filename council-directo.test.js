// council-directo.test.js
// Council entrevista DIRECTO (src/council.js `entrevista`): las personas solo producen
// texto, así que cada fase es UNA llamada sin herramientas para todos los coaches y una
// corta por persona de audiencia (antes: ~50 sesiones completas en Weddi). Sin red ni
// Claude real: claudeFn y chatFn son falsos. Verifica número de llamadas, rutas (plan vs
// USD), modelos, presupuesto con confirmación y registro igual al motor agentes.
// Idioma: español neutro.

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { runDirectInterview, estimateDirectInterview, DIRECT_MODELS } from './src/council.js';
import { validateReview, getReview } from './src/cockpit.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; } catch (e) {
    console.error(`FAIL  ${label}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
    failed += 1;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

const COACHES = ['growth', 'usuario-novato'];
const AUD = ['aud-oficinista', 'aud-estudiante'];
const finding = id => ({ persona: id, threats: ['Riesgo concreto visto en la entrevista'], opportunities: ['Oportunidad concreta y medible'], ideas: ['Idea concreta (lo dijo Oficinista)'], key_concern: 'que pidan sin fila', would_change_mind_if: 'datos reales de pedidos' });

/** Respuesta falsa según la fase que pide el prompt (como lo haría el modelo). */
function fakeAnswer(system, user) {
  if (/Each coach writes 2-4 key questions/.test(user)) return Object.fromEntries(COACHES.map(c => [c, { coach: c, questions: ['¿La última vez que pediste café para llevar, qué pasó?', '¿Qué hiciste cuando había fila?'] }]));
  if (/Each coach asks exactly ONE follow-up/.test(user)) return Object.fromEntries(COACHES.map(c => [c, { coach: c, followups: AUD.map(a => ({ to: a, question: '¿Por qué dijiste eso del precio?' })) }]));
  if (/turns what the interviewees said into findings/.test(user)) return Object.fromEntries(COACHES.map(c => [c, finding(c)]));
  if (/# Preguntas del panel/.test(user)) return { persona: 'x', answers: [{ q: 'Q1', answer: 'Lo pedí por WhatsApp y llegó tarde.' }, { q: 'Q2', answer: 'Me fui a otro lado.' }] };
  if (/# Repreguntas del panel/.test(user)) return { persona: 'x', answers: COACHES.map(c => ({ from: c, answer: 'Porque el precio no estaba a la vista.' })) };
  if (/## Voz [A-Z]/.test(user)) {
    const voices = [...new Set([...user.matchAll(/## Voz ([A-Z])/g)].map(m => m[1]))];
    return {
      titular: 'Letrero de para llevar en la vereda', pasos: ['Letrero', 'Precios a la vista', 'Medir dos semanas'],
      integrated_proposal_md: `Propuesta integrada: letrero en la vereda y precios a la vista, medido dos semanas [${voices.join(',')}].`,
      contributions: voices.map((v, i) => ({ titular: `Hallazgo concreto ${i + 1}`, text: `Aporte de la Voz ${v}`, voice: v, type: 'idea', adopted: true, why: 'Razón concreta' })),
      tensions: [], recommendation: 'Probar el letrero dos semanas.', confidence: 'media', what_would_change_it: 'si no suben los pedidos',
    };
  }
  throw new Error(`prompt inesperado: ${user.slice(0, 80)}`);
}

function fakeClaude(calls, { bad = 0 } = {}) {
  let left = bad;
  return async opts => {
    calls.push({ ruta: 'claude', ...opts });
    const data = fakeAnswer(opts.systemPrompt, opts.prompt);
    const text = left-- > 0 ? 'no es json' : JSON.stringify(data);
    return { ok: true, result: text, timed_out: false, limit: { hit: false }, window: { first: 0.1, last: 0.1 }, usage: { total: 3000, input: 2, cache_write: 2500, cache_read: 0, output: 498, first_context: 2502 } };
  };
}
function fakeChat(calls) {
  return async ({ model, system, messages }) => {
    calls.push({ ruta: 'openrouter', model, system, user: messages[0].content });
    return { content: JSON.stringify(fakeAnswer(system, messages[0].content)), usage: { prompt_tokens: 1000, completion_tokens: 300 }, raw: { usage: { cost: 0.0012 } }, model_used: model };
  };
}

const base = {
  question: '¿Qué haría que más gente pida café para llevar?', personas: COACHES,
  audiencia: ['Oficinista: 34 años, compra café camino al trabajo', 'Estudiante: 21 años, presupuesto justo'],
  context: 'Cafetería de barrio.',
};

await check('ruta claude: 4 llamadas de coaches/integrador (Opus, sin herramientas) + 4 de audiencia (Haiku) = 8 en vez de 11 sesiones', async () => {
  const root = mkdtempSync(join(tmpdir(), 'council-directo-'));
  const calls = [];
  const r = await runDirectInterview({ ...base, root, rutaCoaches: 'claude', rutaAudiencia: 'claude', claudeFn: fakeClaude(calls) });
  assert(calls.length === 8, `llamadas: ${calls.length}`);
  const coach = calls.filter(c => c.model === DIRECT_MODELS.coaches.claude);
  const aud = calls.filter(c => c.model === DIRECT_MODELS.audiencia.claude);
  assert(coach.length === 4 && aud.length === 4, `${coach.length}/${aud.length}`);
  assert(calls.every(c => Array.isArray(c.tools) && c.tools.length === 0 && c.maxTurns === 1 && c.systemPrompt), 'sin herramientas, 1 turno, system propio');
  // Cada coach recibe su ficha en la misma llamada, sin mezclar voces.
  assert(COACHES.every(id => coach[0].prompt.includes(`## ${id}`)) && /INDEPENDENTLY/.test(coach[0].systemPrompt), 'una llamada para todos los coaches');
  // La audiencia recibe la forma del JSON (antes se perdía al quitar la entrega por archivo).
  assert(/Return exactly this JSON shape: \{"persona"/.test(aud[0].prompt), aud[0].prompt.slice(-300));
  assert(r.metrics.tokens_plan === 24000 && r.metrics.cost_usd === 0 && r.metrics.llamadas === 8, JSON.stringify(r.metrics));
  const saved = JSON.parse(readFileSync(r.resultPath, 'utf8'));
  assert(saved.engine === 'directo' && saved.metadata.tokens_plan === 24000 && saved.metadata.rutas.coaches === 'claude', JSON.stringify(saved.metadata));
  assert(existsSync(r.findingsPath) && saved.interview.questions.length >= 2, 'hallazgos para bold-rounds');
  const review = getReview(saved.id, root);
  validateReview(review);
  const part = review.items.find(i => i.id === 'participantes');
  assert(part.stats.some(s => /tokens de tu plan/.test(s.label)) && part.stats.some(s => /OpenRouter/.test(s.label)), JSON.stringify(part.stats));
});

await check('ruta openrouter: audiencia barata en USD real y coaches por el plan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'council-directo-or-'));
  const calls = [];
  const r = await runDirectInterview({ ...base, root, rutaCoaches: 'claude', rutaAudiencia: 'openrouter', claudeFn: fakeClaude(calls), chatFn: fakeChat(calls) });
  const or = calls.filter(c => c.ruta === 'openrouter');
  assert(or.length === 4 && or.every(c => c.model === DIRECT_MODELS.audiencia.openrouter), JSON.stringify(or.map(c => c.model)));
  assert(Math.abs(r.metrics.cost_usd - 0.0048) < 1e-9 && r.metrics.tokens_plan === 12000, JSON.stringify(r.metrics));
});

await check('JSON inválido: reintenta una vez con el error; un límite de uso corta con aviso de reintentar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'council-directo-bad-'));
  const calls = [];
  await runDirectInterview({ ...base, root, rutaCoaches: 'claude', rutaAudiencia: 'claude', claudeFn: fakeClaude(calls, { bad: 1 }) });
  assert(calls.length === 9 && /previous answer was not valid/.test(calls[1].prompt), `llamadas ${calls.length}`);
  const lim = async () => ({ ok: false, result: '', timed_out: false, limit: { hit: true, message: "You've hit your 5-hour limit" }, window: null, usage: { total: 0, input: 0, cache_write: 0, cache_read: 0, output: 0 } });
  let msg = '';
  try { await runDirectInterview({ ...base, root, rutaCoaches: 'claude', rutaAudiencia: 'claude', claudeFn: lim }); } catch (e) { msg = e.message; }
  assert(/límite de uso/.test(msg) && /reintenta/.test(msg), msg);
});

await check('presupuesto: muestra tokens, % de ventana y USD; la ruta de pago solo con confirmación', async () => {
  const p = await estimateDirectInterview({ coaches: 2, audiencia: 2, rutaCoaches: 'claude', rutaAudiencia: 'claude' });
  assert(p.usd_openrouter === 0 && p.tokens > 0 && /% de una ventana de 5 h/.test(p.texto), p.texto);
  const q = await estimateDirectInterview({ coaches: 2, audiencia: 2, rutaCoaches: 'openrouter', rutaAudiencia: 'openrouter' });
  assert(q.usd_openrouter > 0 && q.tokens === 0, JSON.stringify(q.openrouter));
  const r = spawnSync(process.execPath, ['src/council.js', 'entrevista', '--question', 'prueba', '--personas', 'growth,pm',
    '--audiencia', 'Oficinista: 34 años, compra café', '--audiencia', 'Estudiante: 21 años, presupuesto justo',
    '--ruta-audiencia', 'claude', '--root', mkdtempSync(join(tmpdir(), 'council-cli-'))], { encoding: 'utf8' });
  assert(r.status === 2 && /Presupuesto del council entrevista/.test(r.stdout) && /--yes/.test(r.stdout) && /Solo si el usuario lo confirma/.test(r.stdout), r.stdout + r.stderr);
});

console.log(`\nTotal: ${passed} pasaron, ${failed} fallaron.`);
process.exit(failed ? 1 : 0);
