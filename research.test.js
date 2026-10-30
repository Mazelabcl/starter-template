// research.test.js
// v6 fixes a + b de src/research.js, sin red (fetch simulado):
//   a. `deep` y `reason` usan 300000 ms de timeout por defecto; el caller y el
//      CLI (`--timeout-ms` / RESEARCH_TIMEOUT_MS) pueden sobreescribirlo.
//   b. Las fuentes de Perplexity vía OpenRouter vienen en
//      `choices[0].message.annotations[].url_citation` (verificado con una
//      llamada real a perplexity/sonar el 2026-10-30). También se aceptan
//      `citations` (shape antiguo) y `search_results`.

process.env.OPENROUTER_API_KEY ||= 'sk-or-v1-test-fake';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`);
    failed += 1;
  }
}

// Fixture con el shape real de OpenRouter + Perplexity (recortado).
const REAL_SHAPE = {
  id: 'gen-x', model: 'perplexity/sonar', provider: 'Perplexity',
  choices: [{
    index: 0, finish_reason: 'stop',
    message: {
      role: 'assistant', content: 'La capital de Chile es Santiago [1][2].',
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://es.wikipedia.org/wiki/Santiago_de_Chile', title: 'Santiago de Chile - Wikipedia', start_index: 0, end_index: 0 } },
        { type: 'url_citation', url_citation: { url: 'https://www.britannica.com/place/Chile', title: 'Chile | Britannica', start_index: 0, end_index: 0 } },
        { type: 'url_citation', url_citation: { url: 'https://es.wikipedia.org/wiki/Santiago_de_Chile', title: 'duplicado', start_index: 0, end_index: 0 } },
      ],
    },
  }],
  usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
};

// fetch simulado: registra el timeout pedido (vía setTimeout) y responde el fixture.
const timeouts = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (ms >= 60_000) timeouts.push(ms);
  return realSetTimeout(fn, ms >= 60_000 ? 2 ** 30 : ms, ...rest);
};
globalThis.fetch = async () => ({
  ok: true, status: 200, headers: { get: () => null }, json: async () => REAL_SHAPE,
});

const { research, extractCitations, defaultTimeoutFor, parseCliArgs, DEEP_TIMEOUT_MS } = await import('./src/research.js');

await check('extractCitations: shape real de OpenRouter (annotations url_citation), sin duplicados', () => {
  const r = extractCitations(REAL_SHAPE);
  if (r.citations.length !== 2) throw new Error(`esperaba 2 URLs, obtuve ${r.citations.length}`);
  if (r.citations[0] !== 'https://es.wikipedia.org/wiki/Santiago_de_Chile') throw new Error('URL incorrecta');
  if (r.sources[1].title !== 'Chile | Britannica') throw new Error('título no extraído');
});

await check('extractCitations: shape antiguo `citations` (strings) y `search_results`', () => {
  const r = extractCitations({ citations: ['https://a.cl'], search_results: [{ url: 'https://b.cl', title: 'B' }] });
  if (r.citations.join(',') !== 'https://a.cl,https://b.cl') throw new Error(r.citations.join(','));
});

await check('extractCitations: respuesta sin fuentes → arrays vacíos (no lanza)', () => {
  const r = extractCitations({ choices: [{ message: { content: 'x' } }] });
  if (r.citations.length || r.sources.length) throw new Error('debería ser vacío');
  extractCitations(null);
});

await check('research() devuelve citations y sources desde el response real', async () => {
  const r = await research('quick', '¿capital de Chile?');
  if (r.citations.length !== 2 || r.sources.length !== 2) throw new Error(JSON.stringify(r.citations));
});

await check('timeout por defecto: deep/reason = 300000 ms, quick/pro sin override', () => {
  if (DEEP_TIMEOUT_MS !== 300_000) throw new Error(`DEEP_TIMEOUT_MS=${DEEP_TIMEOUT_MS}`);
  if (defaultTimeoutFor('deep') !== 300_000 || defaultTimeoutFor('reason') !== 300_000) throw new Error('deep/reason');
  if (defaultTimeoutFor('quick') !== undefined || defaultTimeoutFor('pro') !== undefined) throw new Error('quick/pro');
});

await check('research(deep) pasa 300000 ms a chat(); override del caller gana', async () => {
  timeouts.length = 0;
  await research('deep', 'q');
  await research('deep', 'q', { timeout_ms: 900_000 });
  await research('pro', 'q');
  if (timeouts.join(',') !== '300000,900000,120000') throw new Error(`timeouts usados: ${timeouts.join(',')}`);
});

await check('CLI: --timeout-ms=N y --timeout-ms N se parsean y se quitan de la pregunta', () => {
  const a = parseCliArgs(['deep', 'hola', 'mundo', '--timeout-ms=600000']);
  if (a.timeout_ms !== 600000 || a.rest.join(' ') !== 'deep hola mundo') throw new Error(JSON.stringify(a));
  const b = parseCliArgs(['deep', '--timeout-ms', '700000', 'pregunta']);
  if (b.timeout_ms !== 700000 || b.rest.join(' ') !== 'deep pregunta') throw new Error(JSON.stringify(b));
});

await check('CLI: RESEARCH_TIMEOUT_MS como alternativa', () => {
  process.env.RESEARCH_TIMEOUT_MS = '450000';
  try {
    if (parseCliArgs(['deep', 'q']).timeout_ms !== 450000) throw new Error('env no leída');
  } finally {
    delete process.env.RESEARCH_TIMEOUT_MS;
  }
});

globalThis.setTimeout = realSetTimeout;
console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed === 0 ? 0 : 1);
