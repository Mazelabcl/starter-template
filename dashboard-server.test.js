// dashboard-server.test.js
// Test integral del servidor del dashboard + helper update_state.js.
//
// Estrategia: levantamos el servidor en un puerto temporal apuntando a un STATE_PATH
// real (el repo), pero antes hacemos backup del state.json actual y lo restauramos
// al terminar para no contaminar nada.
//
// Output: PASS/FAIL por endpoint y comando. Exit code 0 si todo verde, 1 si algo falla.

import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { startServer } from './dashboard/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const STATE_PATH = join(REPO_ROOT, 'dashboard', 'state.json');
const HISTORY_DIR = join(REPO_ROOT, 'dashboard', 'history');
const HISTORY_LOG = join(HISTORY_DIR, 'events.log');
const UPDATE_SCRIPT = join(REPO_ROOT, 'scripts', 'update_state.js');

let passed = 0;
let failed = 0;
const fails = [];

function check(label, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`PASS  ${label}`); passed += 1; })
    .catch(e => {
      console.error(`FAIL  ${label}`);
      console.error(`      ${e.message}`);
      fails.push({ label, error: e.message });
      failed += 1;
    });
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true');
}

function backupState() {
  return {
    state: existsSync(STATE_PATH) ? readFileSync(STATE_PATH, 'utf8') : null,
    history: existsSync(HISTORY_LOG) ? readFileSync(HISTORY_LOG, 'utf8') : null,
  };
}

function restoreState(backup) {
  if (backup.state !== null) {
    writeFileSync(STATE_PATH, backup.state, 'utf8');
  } else if (existsSync(STATE_PATH)) {
    unlinkSync(STATE_PATH);
  }
  if (backup.history !== null) {
    mkdirSync(HISTORY_DIR, { recursive: true });
    writeFileSync(HISTORY_LOG, backup.history, 'utf8');
  } else if (existsSync(HISTORY_LOG)) {
    unlinkSync(HISTORY_LOG);
  }
}

function resetStateForTests() {
  // Limpia el state y el history log para empezar desde cero en cada test.
  if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
  if (existsSync(HISTORY_LOG)) unlinkSync(HISTORY_LOG);
}

function runHelper(args, env = {}) {
  const r = spawnSync(process.execPath, [UPDATE_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function main() {
  console.log('--- dashboard-server.test.js ---');
  const backup = backupState();
  let serverInfo = null;

  try {
    resetStateForTests();

    // Levantamos en puerto temporal (0 = SO asigna).
    serverInfo = await startServer(0);
    const baseUrl = `http://localhost:${serverInfo.port}`;
    // Helper apunta al puerto del server bajo test.
    const helperEnv = { DASHBOARD_PORT: String(serverInfo.port) };

    // ---------- ENDPOINTS HTTP ----------

    await check('GET /api/state retorna estado inicial cuando state.json no existe', async () => {
      const t0 = Date.now();
      const r = await fetch(`${baseUrl}/api/state`);
      const ms = Date.now() - t0;
      assertEqual(r.status, 200, 'status');
      const j = await r.json();
      assertTrue(typeof j.session_id === 'string' && j.session_id.length > 0, 'session_id existe');
      assertTrue(Array.isArray(j.active_tasks), 'active_tasks es array');
      assertTrue(Array.isArray(j.events), 'events es array');
      assertTrue(j.metrics && typeof j.metrics === 'object', 'metrics objeto');
      assertTrue(j.derived && Array.isArray(j.derived.declared_contracts), 'derived.declared_contracts');
      assertTrue(j.derived.memory_snapshot, 'derived.memory_snapshot');
      assertTrue(ms < 500, `latencia razonable (${ms}ms)`);
    });

    await check('POST /api/state mergea active_skills', async () => {
      const r = await fetch(`${baseUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_skills: ['pipeline-v2', 'image-gen'] }),
      });
      assertEqual(r.status, 200, 'status');
      const j = await r.json();
      assertTrue(j.ok === true, 'ok=true');
      // Ahora GET debe verlos.
      const r2 = await fetch(`${baseUrl}/api/state`);
      const j2 = await r2.json();
      assertEqual(j2.active_skills.length, 2, 'active_skills len');
      assertTrue(j2.active_skills.includes('pipeline-v2'), 'incluye pipeline-v2');
    });

    await check('POST /api/state rechaza JSON inválido con 400', async () => {
      const r = await fetch(`${baseUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'no-soy-json',
      });
      assertEqual(r.status, 400, 'status 400');
    });

    await check('POST /api/state rechaza active_tasks no-array con 400', async () => {
      const r = await fetch(`${baseUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_tasks: 'no-soy-array' }),
      });
      assertEqual(r.status, 400, 'status 400');
    });

    await check('POST /api/state persiste eventos al history log', async () => {
      resetStateForTests();
      const ev = {
        timestamp: new Date().toISOString(),
        type: 'agent_invoked',
        payload: { agent: 'TestBot' },
      };
      const r = await fetch(`${baseUrl}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [ev] }),
      });
      assertEqual(r.status, 200, 'status');
      const j = await r.json();
      assertEqual(j.new_events, 1, 'new_events=1');
      // GET history debe traerlo.
      const rh = await fetch(`${baseUrl}/api/history`);
      const jh = await rh.json();
      assertTrue(Array.isArray(jh.events), 'events array');
      assertTrue(jh.events.some(e => e.type === 'agent_invoked'), 'history contiene agent_invoked');
    });

    await check('GET /api/history respeta limit', async () => {
      const r = await fetch(`${baseUrl}/api/history?limit=5`);
      assertEqual(r.status, 200, 'status');
      const j = await r.json();
      assertTrue(Array.isArray(j.events), 'events array');
      assertTrue(j.events.length <= 5, 'len <= 5');
    });

    await check('GET / sirve placeholder html', async () => {
      const r = await fetch(`${baseUrl}/`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      assertTrue(text.includes('Dashboard v3'), 'contiene "Dashboard v3"');
    });

    await check('GET ruta inexistente retorna 404', async () => {
      const r = await fetch(`${baseUrl}/no-existe.html`);
      assertEqual(r.status, 404, 'status 404');
    });

    await check('OPTIONS /api/state responde CORS preflight', async () => {
      const r = await fetch(`${baseUrl}/api/state`, { method: 'OPTIONS' });
      assertEqual(r.status, 204, 'status 204');
      assertTrue(r.headers.get('access-control-allow-origin') === '*', 'CORS *');
    });

    // ---------- HELPER CLI update_state.js ----------

    await check('CLI task-start crea tarea running', async () => {
      resetStateForTests();
      const r = runHelper(['task-start', 'task-1', 'TestAgent', 'actúa como QA', 'mi tarea', 'a.js', 'b.js'], helperEnv);
      assertEqual(r.code, 0, `exit code (stderr=${r.stderr})`);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      assertEqual(state.active_tasks.length, 1, 'una tarea');
      const t = state.active_tasks[0];
      assertEqual(t.id, 'task-1', 'id');
      assertEqual(t.agent, 'TestAgent', 'agent');
      assertEqual(t.agent_role, 'actúa como QA', 'agent_role');
      assertEqual(t.status, 'running', 'status');
      assertEqual(t.files_in_use.length, 2, 'files len');
      assertTrue(state.events.some(e => e.type === 'task_started'), 'event task_started');
    });

    await check('CLI task-complete marca completed y suma tokens', async () => {
      const r = runHelper(['task-complete', 'task-1', '5000'], helperEnv);
      assertEqual(r.code, 0, 'exit code');
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-1');
      assertEqual(t.status, 'completed', 'status');
      assertEqual(t.tokens_estimated, 5000, 'tokens');
      assertEqual(state.metrics.tasks_completed, 1, 'metrics.tasks_completed');
      assertEqual(state.metrics.total_tokens_session, 5000, 'metrics.total_tokens_session');
    });

    await check('CLI task-fail marca failed con razón', async () => {
      runHelper(['task-start', 'task-2', 'TestAgent', 'actúa como QA', 'tarea fallida'], helperEnv);
      const r = runHelper(['task-fail', 'task-2', 'algo se rompió'], helperEnv);
      assertEqual(r.code, 0, 'exit code');
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-2');
      assertEqual(t.status, 'failed', 'status');
      assertTrue(t.failure_reason && t.failure_reason.includes('algo'), 'failure_reason');
      assertEqual(state.metrics.tasks_failed, 1, 'metrics.tasks_failed');
    });

    await check('CLI event agrega evento con payload JSON', async () => {
      const r = runHelper(['event', 'council_invoked', '{"voices":4}'], helperEnv);
      assertEqual(r.code, 0, 'exit code');
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const ev = state.events.find(e => e.type === 'council_invoked');
      assertTrue(!!ev, 'evento existe');
      assertEqual(ev.payload.voices, 4, 'payload.voices');
      assertEqual(state.metrics.councils_invoked, 1, 'councils_invoked++');
    });

    await check('CLI skill-add agrega skill al set', async () => {
      const r = runHelper(['skill-add', 'pipeline-v2'], helperEnv);
      assertEqual(r.code, 0, 'exit code');
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      assertTrue(state.active_skills.includes('pipeline-v2'), 'skill presente');
    });

    await check('CLI skill-remove quita skill del set', async () => {
      const r = runHelper(['skill-remove', 'pipeline-v2'], helperEnv);
      assertEqual(r.code, 0, 'exit code');
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      assertTrue(!state.active_skills.includes('pipeline-v2'), 'skill ausente');
    });

    await check('CLI uso incorrecto retorna exit code 1', async () => {
      const r = runHelper(['task-start'], helperEnv); // faltan args
      assertEqual(r.code, 1, 'exit code 1 cuando faltan args');
    });

    await check('CLI comando desconocido retorna exit code 1', async () => {
      const r = runHelper(['comando-falso'], helperEnv);
      assertEqual(r.code, 1, 'exit code 1');
    });

    // ---------- conexión CLI ↔ servidor ----------
    await check('CLI notifica al server, GET /api/state refleja cambio', async () => {
      resetStateForTests();
      runHelper(['task-start', 'task-end-to-end', 'EndAgent', 'actúa como integrador', 'e2e check'], helperEnv);
      // Pequeña espera para que el POST async del helper alcance al server.
      await new Promise(r => setTimeout(r, 100));
      const r = await fetch(`${baseUrl}/api/state`);
      const j = await r.json();
      assertTrue(j.active_tasks.some(t => t.id === 'task-end-to-end'), 'tarea visible vía GET /api/state');
    });

    // ---------- v2 schema fields + helpers nuevos ----------

    await check('CLI task-start hidrata campos v2 con defaults', async () => {
      resetStateForTests();
      runHelper(['task-start', 'task-v2-defaults', 'AgentX', 'rol completo aquí', 'tarea v2'], helperEnv);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-v2-defaults');
      assertTrue(!!t, 'tarea existe');
      assertEqual(t.role_full, 'rol completo aquí', 'role_full backup');
      assertEqual(t.summary, null, 'summary default null');
      assertEqual(t.origin, null, 'origin default null');
      assertEqual(t.gate, null, 'gate default null');
      assertTrue(Array.isArray(t.artifacts), 'artifacts es array');
      assertEqual(t.artifacts.length, 0, 'artifacts vacío');
      assertEqual(typeof t.review_worthy, 'boolean', 'review_worthy bool');
      assertEqual(typeof t.review_seen, 'boolean', 'review_seen bool');
    });

    await check('CLI task-start no marca review_worthy automático (eliminada heurística first-of-agent)', async () => {
      // Las tasks nuevas no son review_worthy por default. Solo si origin=council:*,
      // gate=cold-reader, hay artifact binario, o override manual.
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.agent === 'AgentX');
      assertEqual(t.review_worthy, false, 'review_worthy false por default');
      assertEqual(t.review_reason, null, 'review_reason null por default');
    });

    await check('CLI task-update aplica patch parcial sin tocar otros campos', async () => {
      const patch = JSON.stringify({ summary: 'Una línea de contexto', origin: 'sprint:1', gate: 'critic' });
      const r = runHelper(['task-update', 'task-v2-defaults', patch], helperEnv);
      assertEqual(r.code, 0, `exit code (stderr=${r.stderr})`);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-v2-defaults');
      assertEqual(t.summary, 'Una línea de contexto', 'summary aplicado');
      assertEqual(t.origin, 'sprint:1', 'origin aplicado');
      assertEqual(t.gate, 'critic', 'gate aplicado');
      // Otros campos intactos.
      assertEqual(t.agent, 'AgentX', 'agent intacto');
      assertEqual(t.role_full, 'rol completo aquí', 'role_full intacto');
    });

    await check('CLI task-update con origin council:* dispara review-worthy', async () => {
      runHelper(['task-start', 'task-council', 'CouncilBot', 'rol', 'titulo'], helperEnv);
      runHelper(['task-update', 'task-council', '{"origin":"council:strategy-calls"}'], helperEnv);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-council');
      assertTrue(t.review_worthy === true, 'review_worthy true por origin council:*');
      assertEqual(t.review_reason, 'council', `review_reason debe ser council, no ${t.review_reason}`);
    });

    await check('CLI task-update con gate cold-reader dispara review-worthy', async () => {
      runHelper(['task-start', 'task-cold', 'ColdBot', 'rol', 'titulo'], helperEnv);
      runHelper(['task-update', 'task-cold', '{"gate":"cold-reader"}'], helperEnv);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-cold');
      assertTrue(t.review_worthy === true, 'review_worthy true por gate cold-reader');
    });

    await check('CLI task-artifact con imagen dispara review-worthy y dedup por path', async () => {
      runHelper(['task-start', 'task-img', 'ImgAgent', 'rol', 'titulo'], helperEnv);
      runHelper(['task-artifact', 'task-img', 'content/output/scene/bg.png', 'image', 'fondo'], helperEnv);
      // Repetimos el mismo path: debe deduplicar.
      runHelper(['task-artifact', 'task-img', 'content/output/scene/bg.png', 'image', 'fondo'], helperEnv);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-img');
      assertEqual(t.artifacts.length, 1, 'artifacts deduplicado');
      assertEqual(t.artifacts[0].kind, 'image', 'kind image');
      assertTrue(t.review_worthy === true, 'review_worthy true por binary-artifact');
    });

    await check('CLI task-artifact sin path o vacío falla con exit 1', async () => {
      const r = runHelper(['task-artifact', 'task-img'], helperEnv);
      assertEqual(r.code, 1, 'exit code 1 cuando falta path');
    });

    await check('CLI task-review-seen apaga el badge sin perder review_worthy', async () => {
      runHelper(['task-review-seen', 'task-img'], helperEnv);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-img');
      assertTrue(t.review_seen === true, 'review_seen true');
      assertTrue(t.review_worthy === true, 'review_worthy se preserva (audit trail)');
    });

    await check('CLI task-update review_seen=true es idempotente con humano', async () => {
      // Race between humano (POST /api/state con review_seen) y heurística (que no
      // debe re-flagear review_seen=false). refreshReviewWorthy nunca toca review_seen.
      runHelper(['task-update', 'task-img', '{"review_seen":true}'], helperEnv);
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const t = state.active_tasks.find(x => x.id === 'task-img');
      assertTrue(t.review_seen === true, 'review_seen sigue true tras un update posterior');
    });

    // ---------- /files/<rel> whitelist + path traversal ----------

    await check('GET /files/<archivo de content/> sirve contenido', async () => {
      // Creamos un archivo pequeño dentro de content/ para verificar lectura ok.
      const targetDir = join(REPO_ROOT, 'content');
      mkdirSync(targetDir, { recursive: true });
      const targetFile = join(targetDir, '__a11y-test-fixture.txt');
      writeFileSync(targetFile, 'hello-from-test', 'utf8');
      try {
        const r = await fetch(`${baseUrl}/files/${encodeURIComponent('content/__a11y-test-fixture.txt')}`);
        assertEqual(r.status, 200, 'status 200');
        const text = await r.text();
        assertEqual(text, 'hello-from-test', 'contenido coincide');
      } finally {
        try { unlinkSync(targetFile); } catch { /* ignore */ }
      }
    });

    await check('GET /files/.env retorna 404 (blocklist)', async () => {
      // Aunque el archivo no exista, la blocklist debe rechazarlo antes.
      const r = await fetch(`${baseUrl}/files/.env`);
      assertEqual(r.status, 404, 'status 404');
    });

    await check('GET /files/dashboard/state.json retorna 404 (blocklist)', async () => {
      const r = await fetch(`${baseUrl}/files/dashboard/state.json`);
      assertEqual(r.status, 404, 'status 404 — state.json es privado');
    });

    await check('GET /files/<path-traversal> retorna 404', async () => {
      const r = await fetch(`${baseUrl}/files/${encodeURIComponent('../../etc/passwd')}`);
      assertEqual(r.status, 404, 'status 404 — path traversal bloqueado');
    });

    await check('GET /files/<carpeta no-whitelisted> retorna 404', async () => {
      // package.json existe pero no está en la whitelist.
      const r = await fetch(`${baseUrl}/files/package.json`);
      assertEqual(r.status, 404, 'status 404 — fuera de whitelist');
    });

  } finally {
    if (serverInfo && serverInfo.server) {
      await new Promise(r => serverInfo.server.close(r));
    }
    restoreState(backup);
  }

  console.log('---');
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('FAILS:');
    for (const f of fails) console.log(`  - ${f.label}: ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
