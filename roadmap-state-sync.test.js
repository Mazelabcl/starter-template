// roadmap-state-sync.test.js
//
// Verifica D7: cuando `src/roadmap.js#startSprint()` o `closeSprint()` corren,
// hacen un POST best-effort al dashboard `/api/state` con el `current_sprint`
// actualizado. Si el dashboard no está corriendo, la operación NO falla — los
// archivos locales (`roadmap/current-sprint.json`, `roadmap.md`) quedan bien.
//
// Estrategia:
//   1. Levantamos un server HTTP fake en un puerto temporal que captura POSTs.
//   2. Apuntamos roadmap.js al server vía DASHBOARD_PORT.
//   3. Ejecutamos startSprint y verificamos que llegó el POST con el shape esperado.
//   4. Apagamos el server, corremos startSprint otra vez: NO debe romper.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import { startSprint, closeSprint, _internal } from './src/roadmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true');
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'assertEqual'}: esperado ${e}, obtenido ${a}`);
  }
}

// Server fake mínimo que captura POSTs a /api/state.
function startFakeDashboard() {
  const captured = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/state') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { /* mantener null */ }
        captured.push(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolveP) => {
    server.listen(0, () => {
      const addr = server.address();
      resolveP({ server, port: addr.port, captured });
    });
  });
}

function setupRoadmapDir() {
  const tmp = mkdtempSync(join(tmpdir(), 'roadmap-sync-test-'));
  // roadmap.md mínimo con los marcadores que rerenderAll() necesita.
  const md = [
    '# Roadmap del proyecto',
    '',
    '## Sprint actual',
    '',
    '### Tareas del sprint',
    '',
    '<!-- tasks-start -->',
    '<!-- tasks-end -->',
    '',
    '<!-- preview-start -->',
    '<!-- preview-end -->',
    '',
    '## Backlog',
    '',
    '### Alta',
    '<!-- prio-alta-start -->',
    '<!-- prio-alta-end -->',
    '',
    '### Media',
    '<!-- prio-media-start -->',
    '<!-- prio-media-end -->',
    '',
    '### Baja',
    '<!-- prio-baja-start -->',
    '<!-- prio-baja-end -->',
    '',
    '### Ideas crudas',
    '<!-- ideas-crudas-start -->',
    '<!-- ideas-crudas-end -->',
    '',
  ].join('\n');
  writeFileSync(join(tmp, 'roadmap.md'), md, 'utf8');
  return tmp;
}

const tmpDirs = [];
const originalPort = process.env.DASHBOARD_PORT;

try {
  // ---------------------- Test 1: startSprint POSTea al dashboard ----------------------
  await check('startSprint envía POST /api/state con current_sprint correcto', async () => {
    const { server, port, captured } = await startFakeDashboard();
    try {
      process.env.DASHBOARD_PORT = String(port);
      const dir = setupRoadmapDir();
      tmpDirs.push(dir);

      const { sprint } = startSprint({ number: 1, objective: 'Sprint inicial del test' }, dir);
      // El POST es async fire-and-forget — esperamos un poco para que llegue.
      await new Promise(r => setTimeout(r, 200));

      assertTrue(captured.length === 1, `esperaba 1 POST, hubo ${captured.length}`);
      const body = captured[0];
      assertTrue(body && body.current_sprint, 'payload no contiene current_sprint');
      assertEqual(body.current_sprint.number, 1, 'number incorrecto');
      assertEqual(body.current_sprint.objective, 'Sprint inicial del test', 'objective incorrecto');
      // El sprint devuelto por startSprint también debe tener el shape canónico.
      assertEqual(sprint.number, 1, 'sprint.number');
      assertEqual(sprint.objective, 'Sprint inicial del test', 'sprint.objective');
    } finally {
      server.close();
    }
  });

  // ---------------------- Test 2: closeSprint POSTea con sprint nuevo (fresh) ----------------------
  await check('closeSprint envía POST con el sprint siguiente (fresh)', async () => {
    const { server, port, captured } = await startFakeDashboard();
    try {
      process.env.DASHBOARD_PORT = String(port);
      const dir = setupRoadmapDir();
      tmpDirs.push(dir);
      const memDir = mkdtempSync(join(tmpdir(), 'roadmap-sync-memory-'));
      tmpDirs.push(memDir);

      startSprint({ number: 2, objective: 'Sprint a cerrar' }, dir);
      await new Promise(r => setTimeout(r, 100));
      // Limpiamos los POSTs del startSprint.
      captured.length = 0;

      closeSprint({ lessons: ['lesson uno'], deliverables: ['delivered uno'] }, dir, memDir);
      await new Promise(r => setTimeout(r, 200));

      assertTrue(captured.length >= 1, `esperaba ≥1 POST, hubo ${captured.length}`);
      const lastBody = captured[captured.length - 1];
      assertTrue(lastBody && lastBody.current_sprint, 'payload no trae current_sprint');
      // closeSprint deja el sprint en (number+1, '') hasta que startSprint abra el siguiente.
      assertEqual(lastBody.current_sprint.number, 3, 'next sprint number');
      assertEqual(lastBody.current_sprint.objective, '', 'next sprint objective vacío');
    } finally {
      server.close();
    }
  });

  // ---------------------- Test 3: dashboard caído NO rompe ----------------------
  await check('startSprint no rompe cuando el dashboard NO está corriendo', async () => {
    // Apuntamos a un puerto donde nadie escucha.
    process.env.DASHBOARD_PORT = '1'; // puerto privilegiado, casi seguro cerrado en CI
    const dir = setupRoadmapDir();
    tmpDirs.push(dir);

    // Esto debe completarse sin lanzar.
    const { sprint } = startSprint({ number: 7, objective: 'sin dashboard' }, dir);
    assertEqual(sprint.number, 7, 'sprint creado igual sin dashboard');
    // Dejamos margen para que el fetch fire-and-forget rechace y nadie crashee.
    await new Promise(r => setTimeout(r, 600));
  });

  // ---------------------- Test 4: notifyDashboardCurrentSprint directo es no-op si arg inválido ----------------------
  await check('notifyDashboardCurrentSprint con null/undefined NO rompe', async () => {
    process.env.DASHBOARD_PORT = '1';
    await _internal.notifyDashboardCurrentSprint(null);
    await _internal.notifyDashboardCurrentSprint(undefined);
    await _internal.notifyDashboardCurrentSprint('not an object');
    // Si llegamos hasta acá sin throw, pass.
  });
} finally {
  // Limpieza
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (originalPort === undefined) delete process.env.DASHBOARD_PORT;
  else process.env.DASHBOARD_PORT = originalPort;
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
if (failed > 0) {
  console.error('\nFallos:');
  for (const f of fails) console.error(`  - ${f.label}: ${f.error}`);
}
process.exit(failed === 0 ? 0 : 1);
