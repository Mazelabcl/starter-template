// cockpit.test.js
//
// Verifica el cockpit (Sprint v6-S2):
//   1. Contrato src/cockpit.js: validación, publish, list, feedback, pending,
//      markProcessed, roadmapSnapshot, parseSummary, instrucciones de la guía.
//   2. Hook de sesión: cuenta feedback pendiente y arma UNA línea corta.
//   3. Server: rutas de revisión y feedback, guard de path traversal en media
//      y estáticos, bloqueo de origen externo, token de voz con fetch simulado
//      (sin llamadas reales), chat/resumen con modelo simulado y SSE.
//
// No gasta plata: OpenAI y OpenRouter se reemplazan por funciones falsas.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import {
  validateReview,
  publishReview,
  listReviews,
  saveFeedback,
  pendingFeedback,
  markProcessed,
  roadmapSnapshot,
  parseSummary,
  buildGuideInstructions,
  formatPending,
  isSafeMediaPath,
} from './src/cockpit.js';
import { countPendingCockpit, cockpitLine } from './scripts/session_brief.js';
import { startCockpit, REALTIME_DEFAULTS } from './cockpit/server.js';

let passed = 0;
let failed = 0;
const fails = [];

async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${e.message}`);
    fails.push({ label, error: e.message });
    failed += 1;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'esperaba true'); }
function assertEqual(a, e, msg) {
  if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || 'assertEqual'}: esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`);
}
function assertThrows(fn, re, msg) {
  try { fn(); } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`${msg}: mensaje inesperado "${e.message}"`);
    return;
  }
  throw new Error(`${msg}: esperaba excepción`);
}

const tmpDirs = [];
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-test-'));
  tmpDirs.push(root);
  return root;
}

function sampleReview(overrides = {}) {
  return {
    id: 'plan-landing',
    title: 'Plan de la landing',
    kind: 'plan',
    connects_to: ['Sprint 2', 'branding'],
    context_brief: 'Aldot debe elegir el hero. BRIEF-SECRETO-123',
    items: [
      { id: 'hero', title: 'Hero con video', body_md: 'Un **video** corto.', media: ['content/hero.png'], tags: ['diseño'] },
      { id: 'cta', title: 'Botón de contacto' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Contrato
// ---------------------------------------------------------------------------

await check('validateReview normaliza defaults (created_at, media, tags, body_md)', () => {
  const r = validateReview(sampleReview());
  assert(!Number.isNaN(Date.parse(r.created_at)), 'created_at autocompletado');
  assertEqual(r.items[1].media, [], 'media default');
  assertEqual(r.items[1].tags, [], 'tags default');
  assertEqual(r.items[1].body_md, '', 'body_md default');
});

await check('validateReview lista TODOS los errores (kind, items vacíos, id con espacios)', () => {
  assertThrows(() => validateReview({ id: 'con espacio', title: '', kind: 'nope', items: [] }),
    /id:[\s\S]*title:[\s\S]*kind:[\s\S]*items:/, 'errores múltiples');
});

await check('validateReview rechaza ítems duplicados y media insegura', () => {
  const bad = sampleReview({ items: [
    { id: 'a', title: 'A', media: ['../secreto.png'] },
    { id: 'a', title: 'B', media: ['.env'] },
    { id: 'c', title: 'C', media: ['C:/Windows/x.png'] },
  ] });
  assertThrows(() => validateReview(bad), /duplicado[\s\S]*|\.\./, 'duplicado/traversal');
  for (const p of ['../x.png', '.env', 'a/.git/config', '/abs.png', 'C:\\x.png', 'a/../b.png']) {
    assert(!isSafeMediaPath(p), `debería ser insegura: ${p}`);
  }
  assert(isSafeMediaPath('content/output/img 1.png'), 'ruta normal es segura');
});

await check('publishReview escribe cockpit/reviews/<id>.json y listReviews lo ve como sin-feedback', () => {
  const root = makeRoot();
  const { path } = publishReview(sampleReview(), root);
  assert(existsSync(path), 'archivo creado');
  assert(path.includes(join('cockpit', 'reviews')), 'ruta del contrato');
  const list = listReviews(root);
  assertEqual(list.length, 1, '1 revisión');
  assertEqual(list[0].feedback_status, 'sin-feedback', 'estado inicial');
  assertEqual(list[0].item_count, 2, 'item_count');
});

await check('listReviews salta JSON corrupto sin romper', () => {
  const root = makeRoot();
  publishReview(sampleReview(), root);
  writeFileSync(join(root, 'cockpit', 'reviews', 'roto.json'), '{no es json', 'utf8');
  assertEqual(listReviews(root).length, 1, 'solo la válida');
});

await check('saveFeedback: filtra ítems desconocidos y votos inválidos; processed=false; formato del contrato', () => {
  const root = makeRoot();
  publishReview(sampleReview(), root);
  const { feedback } = saveFeedback('plan-landing', {
    items: { hero: { vote: 'up', comment: 'me gusta' }, cta: { vote: 'meh', comment: 7 }, fantasma: { vote: 'down' } },
    conversation: [{ who: 'guia', text: 'Hola' }, { who: 'usuario', text: 'Dale' }, { who: 'hacker', text: 'x' }],
    summary: { decisions: ['Hero aprobado', 3], open_questions: [], requests: ['CTA verde'], extra: 1 },
  }, root);
  assertEqual(Object.keys(feedback).sort(), ['conversation', 'items', 'processed', 'review_id', 'saved_at', 'summary'], 'campos del contrato');
  assertEqual(feedback.processed, false, 'processed=false');
  assertEqual(feedback.items, { hero: { vote: 'up', comment: 'me gusta' }, cta: { vote: null, comment: '' } }, 'items filtrados');
  assertEqual(feedback.conversation.length, 2, 'who inválido descartado');
  assertEqual(feedback.summary, { decisions: ['Hero aprobado'], open_questions: [], requests: ['CTA verde'] }, 'summary normalizado');
  const disk = JSON.parse(readFileSync(join(root, 'cockpit', 'feedback', 'plan-landing.json'), 'utf8'));
  assertEqual(disk.review_id, 'plan-landing', 'escrito en disco');
});

await check('saveFeedback sin revisión existente lanza error claro', () => {
  const root = makeRoot();
  assertThrows(() => saveFeedback('no-existe', {}, root), /No existe la revisión/, 'sin revisión');
  assertThrows(() => saveFeedback('../x', {}, root), /inválido/, 'id inválido');
});

await check('pendingFeedback → markProcessed → vuelve a pendiente si se guarda de nuevo', () => {
  const root = makeRoot();
  publishReview(sampleReview(), root);
  assertEqual(pendingFeedback(root).length, 0, 'sin feedback no hay pendiente');
  saveFeedback('plan-landing', { items: { cta: { vote: 'down', comment: 'muy chico' } } }, root);
  const pend = pendingFeedback(root);
  assertEqual(pend.length, 1, '1 pendiente');
  assertEqual(pend[0].review_title, 'Plan de la landing', 'enriquecido con título');
  assertEqual(pend[0].item_titles.cta, 'Botón de contacto', 'títulos de ítems');
  const txt = formatPending(pend);
  assert(txt.includes('[-] Botón de contacto: muy chico'), 'texto legible con voto y comentario');
  assert(txt.includes('node src/cockpit.js done'), 'texto indica cómo marcar');
  markProcessed('plan-landing', root);
  assertEqual(pendingFeedback(root).length, 0, 'procesado sale de pendientes');
  assertEqual(listReviews(root)[0].feedback_status, 'procesado', 'estado procesado');
  saveFeedback('plan-landing', { items: {} }, root);
  assertEqual(pendingFeedback(root).length, 1, 'nuevo guardado vuelve a pendiente');
  assertThrows(() => markProcessed('otra', root), /No hay feedback/, 'markProcessed sin feedback');
});

await check('roadmapSnapshot: hecho (sprint-log sin el ejemplo comentado), ahora y sigue; no reescribe roadmap.md', () => {
  const root = makeRoot();
  mkdirSync(join(root, 'roadmap'), { recursive: true });
  mkdirSync(join(root, 'memory'), { recursive: true });
  writeFileSync(join(root, 'roadmap', 'current-sprint.json'), JSON.stringify({
    number: 3, objective: 'Cockpit con voz', started_at: '2026-10-01', target_close: '2026-10-15',
    tasks: [{ id: 't1', title: 'Server', status: 'completed' }, { id: 't2', title: 'Voz', status: 'in_progress' }],
    backlog_added_during_sprint: [],
  }), 'utf8');
  const md = '# Roadmap\n\n<!-- preview-start -->\n- Council de expertos\n<!-- preview-end -->\n\n<!-- prio-alta-start -->\n- Video director _(contexto: pedido)_\n<!-- prio-alta-end -->\n';
  writeFileSync(join(root, 'roadmap', 'roadmap.md'), md, 'utf8');
  writeFileSync(join(root, 'memory', 'sprint-log.md'), [
    '# Sprint log', '', '```', '## Sprint N — <título>', '```', '',
    '<!--', '## Sprint 9 — Ejemplo comentado', '-->', '',
    '## Sprint 1 — Base liviana', '', '**Fechas:** 2026-09-01 a 2026-09-10', '**Objetivo:** x', '**Entregables:**', '- CLAUDE.md corto', '- Tests verdes', '',
    '**Lessons emergentes:**', '- (sin lessons emergentes)', '',
    '## Sprint 2 — Memoria', '', '**Entregables:**', '- memory.js', '',
  ].join('\n'), 'utf8');
  const snap = roadmapSnapshot(root);
  assertEqual(snap.done.map(s => s.number), [1, 2], 'solo sprints reales');
  assertEqual(snap.done[0].deliverables, ['CLAUDE.md corto', 'Tests verdes'], 'entregables');
  assertEqual(snap.done[0].lessons, [], '(sin ...) se ignora');
  assertEqual(snap.now.objective, 'Cockpit con voz', 'sprint actual');
  assertEqual(snap.now.tasks.length, 2, 'tareas');
  assertEqual(snap.next.preview, ['Council de expertos'], 'preview');
  assertEqual(snap.next.high_priority, ['Video director'], 'alta prioridad sin contexto');
  assertEqual(readFileSync(join(root, 'roadmap', 'roadmap.md'), 'utf8'), md, 'roadmap.md intacto');
});

await check('roadmapSnapshot en proyecto vacío no rompe', () => {
  const snap = roadmapSnapshot(makeRoot());
  assertEqual(snap.done, [], 'sin sprints');
  assertEqual(snap.now, null, 'sin sprint actual');
});

await check('parseSummary tolera texto alrededor y bloques ```json; null si no hay JSON', () => {
  assertEqual(parseSummary('Claro:\n```json\n{"decisions":["A"],"open_questions":[],"requests":["B"]}\n```'),
    { decisions: ['A'], open_questions: [], requests: ['B'] }, 'con fence');
  assertEqual(parseSummary('>{"decisions":[]}'), { decisions: [], open_questions: [], requests: [] }, 'campos faltantes = []');
  assertEqual(parseSummary('sin json'), null, 'sin JSON');
});

await check('buildGuideInstructions: incluye brief, ítems, español neutro y una pregunta a la vez', () => {
  const r = validateReview(sampleReview());
  const voz = buildGuideInstructions(r, 'voz');
  for (const t of ['BRIEF-SECRETO-123', 'Hero con video', 'Botón de contacto', 'español neutro', 'UNA sola pregunta', 'No eres el orquestador', 'Sprint 2']) {
    assert(voz.includes(t), `falta "${t}"`);
  }
  assert(buildGuideInstructions(r, 'texto').includes('sin markdown'), 'modo texto');
});

// ---------------------------------------------------------------------------
// 2. Hook de sesión
// ---------------------------------------------------------------------------

await check('session_brief: cuenta solo processed=false y arma UNA línea corta', () => {
  const root = makeRoot();
  assertEqual(countPendingCockpit(root), 0, 'sin carpeta = 0');
  assertEqual(cockpitLine(0), '', 'nada si 0');
  publishReview(sampleReview(), root);
  publishReview(sampleReview({ id: 'otra' }), root);
  saveFeedback('plan-landing', {}, root);
  saveFeedback('otra', {}, root);
  markProcessed('otra', root);
  writeFileSync(join(root, 'cockpit', 'feedback', 'roto.json'), '{x', 'utf8');
  assertEqual(countPendingCockpit(root), 1, '1 pendiente');
  const line = cockpitLine(1);
  assert(!line.includes('\n'), 'una sola línea');
  assert(line.includes('node src/cockpit.js pending'), 'dice cómo leerlo');
  assert(line.length < 200, `corta (<60 tokens aprox.), tiene ${line.length} chars`);
});

// ---------------------------------------------------------------------------
// 3. Server
// ---------------------------------------------------------------------------

function request(port, method, path, { body, headers = {} } = {}) {
  return new Promise((ok, fail) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: {
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...headers,
    } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        ok({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', fail);
    if (data) req.write(data);
    req.end();
  });
}

const srvRoot = makeRoot();
mkdirSync(join(srvRoot, 'content'), { recursive: true });
writeFileSync(join(srvRoot, 'content', 'hero.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(join(srvRoot, 'content', 'otra.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(join(srvRoot, '.env'), 'OPENAI_API_KEY=sk-no-deberia-salir\n', 'utf8');
publishReview(sampleReview(), srvRoot);

const fetchCalls = [];
let fetchMode = 'ok';
async function fakeFetch(url, init) {
  fetchCalls.push({ url, init });
  if (fetchMode === 'fail') {
    return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Incorrect API key' } }) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ value: 'ek_test_123', expires_at: 1900000000, session: { id: 'sess_1' } }) };
}
const chatCalls = [];
async function fakeChat({ system, messages }) {
  chatCalls.push({ system, messages });
  if (/SOLO como JSON/.test(system)) return 'Aquí va: {"decisions":["Hero aprobado"],"open_questions":["¿Color?"],"requests":[]}';
  return 'Hola, revisemos el primer ítem. ¿Lo apruebas?';
}

const env = { OPENAI_API_KEY: 'sk-test-real-key-NO-SALE', OPENROUTER_API_KEY: 'or-test' };
const { server, port } = await startCockpit({ root: srvRoot, port: 0, env, fetchImpl: fakeFetch, chatImpl: fakeChat, pollMs: 80 });

try {
  await check('GET /api/reviews y /api/reviews/:id devuelven la revisión y feedback=null', async () => {
    const list = await request(port, 'GET', '/api/reviews');
    assertEqual(list.status, 200, 'status lista');
    assertEqual(list.json.map(r => r.id), ['plan-landing'], 'ids');
    const one = await request(port, 'GET', '/api/reviews/plan-landing');
    assertEqual(one.json.review.items.length, 2, 'ítems');
    assertEqual(one.json.feedback, null, 'sin feedback');
    assertEqual((await request(port, 'GET', '/api/reviews/nada')).status, 404, '404 inexistente');
    assertEqual((await request(port, 'GET', '/api/reviews/..%2F..%2Fx')).status, 400, 'id con traversal = 400');
  });

  await check('GET / sirve el HTML del cockpit y /api/roadmap responde', async () => {
    const home = await request(port, 'GET', '/');
    assertEqual(home.status, 200, 'home');
    assert(home.text.includes('Conversar sobre esta revisión'), 'botón de conversación');
    assert(home.text.includes('Guardar feedback'), 'botón guardar');
    const rm = await request(port, 'GET', '/api/roadmap');
    assert(rm.json && 'done' in rm.json && 'next' in rm.json, 'snapshot');
  });

  await check('POST /api/feedback/:id guarda y /api/feedback/pending lo expone', async () => {
    const r = await request(port, 'POST', '/api/feedback/plan-landing', { body: {
      items: { hero: { vote: 'up', comment: '' } },
      conversation: [{ who: 'usuario', text: 'sí' }],
      summary: null,
    } });
    assertEqual(r.status, 200, 'guardado');
    assertEqual(r.json.processed, false, 'processed=false');
    const pend = await request(port, 'GET', '/api/feedback/pending');
    assertEqual(pend.json.length, 1, '1 pendiente');
    const bad = await request(port, 'POST', '/api/feedback/plan-landing', { body: '{roto' });
    assertEqual(bad.status, 400, 'JSON inválido = 400');
  });

  await check('POST desde un origen externo se bloquea (403)', async () => {
    const r = await request(port, 'POST', '/api/feedback/plan-landing', { body: {}, headers: { Origin: 'https://evil.example' } });
    assertEqual(r.status, 403, 'origen externo');
    const v = await request(port, 'POST', '/api/voice/session/plan-landing', { body: {}, headers: { Origin: 'https://evil.example' } });
    assertEqual(v.status, 403, 'voz desde origen externo');
    const okLocal = await request(port, 'POST', '/api/feedback/plan-landing', { body: {}, headers: { Origin: `http://localhost:${port}` } });
    assertEqual(okLocal.status, 200, 'localhost permitido');
  });

  await check('media: sirve solo rutas declaradas; bloquea traversal, .env y no declaradas', async () => {
    const ok = await request(port, 'GET', '/media?path=content%2Fhero.png');
    assertEqual(ok.status, 200, 'declarada');
    assertEqual(ok.headers['content-type'], 'image/png', 'mimetype');
    assertEqual((await request(port, 'GET', '/media?path=content%2Fotra.png')).status, 403, 'no declarada');
    assertEqual((await request(port, 'GET', '/media?path=..%2F..%2Fetc%2Fpasswd')).status, 400, 'traversal');
    assertEqual((await request(port, 'GET', '/media?path=.env')).status, 400, '.env');
    assertEqual((await request(port, 'GET', '/media?path=content%2F..%2F.env')).status, 400, 'traversal a .env');
    assertEqual((await request(port, 'GET', '/media?path=package.json')).status, 400, 'extensión no permitida');
  });

  await check('estáticos: no se puede salir de public/ (path traversal)', async () => {
    for (const p of ['/..%2F..%2F.env', '/../server.js', '/%2e%2e/%2e%2e/.env', '/..\\..\\.env']) {
      const r = await request(port, 'GET', p);
      assert(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
      assert(!r.text.includes('sk-no-deberia-salir'), `${p} filtró el .env`);
    }
  });

  await check('voz: el server acuña el client secret con la key real y el navegador solo recibe ek_', async () => {
    fetchMode = 'ok';
    fetchCalls.length = 0;
    const r = await request(port, 'POST', '/api/voice/session/plan-landing', { body: {} });
    assertEqual(r.status, 200, 'status');
    assertEqual(r.json.value, 'ek_test_123', 'ephemeral');
    assert(!r.text.includes('sk-test-real-key'), 'la key real NO viaja al navegador');
    assertEqual(r.json.calls_url, REALTIME_DEFAULTS.calls_url, 'endpoint WebRTC');
    assertEqual(fetchCalls.length, 1, '1 llamada a OpenAI');
    const call = fetchCalls[0];
    assertEqual(call.url, 'https://api.openai.com/v1/realtime/client_secrets', 'endpoint client_secrets');
    assertEqual(call.init.headers.Authorization, 'Bearer sk-test-real-key-NO-SALE', 'auth server-side');
    const body = JSON.parse(call.init.body);
    assertEqual(body.session.type, 'realtime', 'type realtime');
    assertEqual(body.session.model, REALTIME_DEFAULTS.model, 'modelo');
    assertEqual(body.session.audio.output.voice, 'marin', 'voz');
    assertEqual(body.session.audio.input.transcription.language, 'es', 'transcripción en español');
    assert(body.session.instructions.includes('BRIEF-SECRETO-123'), 'instrucciones con context_brief');
    assert(body.session.instructions.includes('Botón de contacto'), 'instrucciones con ítems');
    assertEqual(body.expires_after.seconds, 600, 'expira en 10 min');
  });

  await check('voz: error de OpenAI → 502 con mensaje; sin key → 400', async () => {
    fetchMode = 'fail';
    const r = await request(port, 'POST', '/api/voice/session/plan-landing', { body: {} });
    assertEqual(r.status, 502, '502');
    assert(/Incorrect API key/.test(r.json.error), 'mensaje de OpenAI');
    fetchMode = 'ok';
    const noKeyRoot = makeRoot();
    publishReview(sampleReview(), noKeyRoot);
    const s2 = await startCockpit({ root: noKeyRoot, port: 0, env: {}, fetchImpl: fakeFetch, chatImpl: fakeChat });
    try {
      const nk = await request(s2.port, 'POST', '/api/voice/session/plan-landing', { body: {} });
      assertEqual(nk.status, 400, 'sin key');
      assert(/OPENAI_API_KEY/.test(nk.json.error), 'explica la key faltante');
      const st = await request(s2.port, 'GET', '/api/status');
      assertEqual(st.json.voice, false, 'status voz=false');
    } finally {
      s2.server.close();
    }
  });

  await check('chat de texto: usa el mismo brief y mapea usuario/guía a roles', async () => {
    chatCalls.length = 0;
    const r = await request(port, 'POST', '/api/chat/plan-landing', { body: { conversation: [
      { who: 'guia', text: 'Hola' }, { who: 'usuario', text: 'Apruebo el hero' },
    ] } });
    assertEqual(r.status, 200, 'status');
    assert(r.json.reply.includes('primer ítem'), 'respuesta');
    const call = chatCalls[0];
    assert(call.system.includes('BRIEF-SECRETO-123'), 'system con brief');
    assertEqual(call.messages.map(m => m.role), ['user', 'assistant', 'user'], 'roles (con saludo inicial de usuario)');
  });

  await check('resumen: transcript → JSON normalizado {decisions, open_questions, requests}', async () => {
    const r = await request(port, 'POST', '/api/summary/plan-landing', { body: { conversation: [
      { who: 'guia', text: '¿Apruebas el hero?' }, { who: 'usuario', text: 'Sí' },
    ] } });
    assertEqual(r.status, 200, 'status');
    assertEqual(r.json.summary, { decisions: ['Hero aprobado'], open_questions: ['¿Color?'], requests: [] }, 'summary');
    const empty = await request(port, 'POST', '/api/summary/plan-landing', { body: { conversation: [] } });
    assertEqual(empty.json.summary.decisions, [], 'sin conversación = vacío sin llamar al modelo');
  });

  await check('SSE: /api/events avisa "change" cuando llega una revisión nueva', async () => {
    const got = await new Promise((ok, fail) => {
      const timer = setTimeout(() => { req.destroy(); fail(new Error('sin evento en 3s')); }, 3000);
      const req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, res => {
        let buf = '';
        res.on('data', c => {
          buf += c.toString('utf8');
          if (buf.includes('event: change')) { clearTimeout(timer); req.destroy(); ok(true); }
        });
        setTimeout(() => publishReview(sampleReview({ id: 'nueva', title: 'Nueva' }), srvRoot), 150);
      });
      req.on('error', () => { /* destroy */ });
    });
    assert(got, 'evento recibido');
  });
} finally {
  server.close();
  server.closeAllConnections?.();
}

for (const d of tmpDirs) {
  try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('');
console.log(`Total: ${passed} pasaron, ${failed} fallaron.`);
if (failed > 0) {
  for (const f of fails) console.log(`  - ${f.label}: ${f.error}`);
  process.exit(1);
}
console.log('cockpit OK.');
