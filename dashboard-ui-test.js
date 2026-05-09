// dashboard-ui-test.js — Sprint 2.3a
//
// Test ligero del frontend del dashboard sin headless browser. Levanta el server
// en puerto efímero, verifica los entregables clave de 2.3a, y cierra. Diseñado
// para correr en < 2s.
//
// Cobertura:
//   1. Server arranca y sirve el index.html con los elementos esperados (header,
//      sidebar, las 4 columnas del kanban).
//   2. app.js descarga OK, parsea como JS válido (sintaxis), y referencia /api/state
//      + /api/events.
//   3. style.css existe, > 200 líneas, contiene las variables CSS principales del
//      tema (--bg-deep, --bg-surface, --text-primary, --accent-cyan, --danger).
//   4. icons/sprite.svg existe y tiene al menos los símbolos de tareas.
//
// PASS / FAIL claro al final. Exit 0 si todo verde, 1 si algo falla.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { startServer, closeWatcher } from './dashboard/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'dashboard', 'public');

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
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'assertEqual'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

async function main() {
  console.log('--- dashboard-ui-test.js (Sprint 2.3a) ---');
  let serverInfo = null;

  try {
    serverInfo = await startServer(0);
    const baseUrl = `http://localhost:${serverInfo.port}`;

    // 1. Index HTML: doctype + elementos clave.
    await check('index.html tiene los elementos clave de 2.3a', async () => {
      const r = await fetch(`${baseUrl}/`);
      assertEqual(r.status, 200, 'status');
      const html = await r.text();
      assertTrue(/<!doctype html>/i.test(html), 'falta doctype');
      assertTrue(html.includes('<header class="topbar"'), 'falta header.topbar');
      assertTrue(html.includes('<aside class="sidebar"'), 'falta aside.sidebar');
      assertTrue(html.includes('<main class="board"'), 'falta main.board');
      // Las cuatro columnas del kanban:
      for (const status of ['queued', 'running', 'completed', 'failed']) {
        assertTrue(html.includes(`data-status="${status}"`), `falta columna ${status}`);
      }
      // Hook reservado para 2.3b debe estar comentado, no implementado.
      assertTrue(html.includes('2.3b'), 'falta hook reservado para 2.3b');
    });

    // 2. app.js: parsea como JS, referencia los endpoints correctos.
    await check('app.js parsea como JS válido y consume /api/state + /api/events', async () => {
      const r = await fetch(`${baseUrl}/app.js`);
      assertEqual(r.status, 200, 'status');
      const js = await r.text();
      try {
        new vm.Script(js, { filename: 'app.js' });
      } catch (e) {
        throw new Error(`sintaxis inválida: ${e.message}`);
      }
      assertTrue(js.includes('/api/state'), 'no referencia /api/state');
      assertTrue(js.includes('/api/events'), 'no referencia /api/events');
      assertTrue(js.includes('EventSource'), 'no usa EventSource');
    });

    // 3. style.css: > 200 líneas + variables principales.
    await check('style.css tiene > 200 líneas y declara las variables del tema', async () => {
      const cssPath = join(PUBLIC_DIR, 'style.css');
      assertTrue(existsSync(cssPath), 'style.css no existe');
      const css = readFileSync(cssPath, 'utf8');
      const lineCount = css.split('\n').length;
      assertTrue(lineCount > 200, `style.css solo tiene ${lineCount} líneas`);
      const requiredVars = [
        '--bg-deep',
        '--bg-surface',
        '--bg-surface-2',
        '--text-primary',
        '--text-secondary',
        '--text-muted',
        '--success',
        '--warning',
        '--danger',
        '--accent-cyan',
        '--accent-purple',
        '--border-subtle',
      ];
      for (const v of requiredVars) {
        assertTrue(css.includes(v), `falta variable CSS: ${v}`);
      }
    });

    // 4. Sprite SVG: presente y con símbolos.
    await check('icons/sprite.svg existe y tiene al menos los símbolos de tareas', async () => {
      const r = await fetch(`${baseUrl}/icons/sprite.svg`);
      assertEqual(r.status, 200, 'status');
      const svg = await r.text();
      assertTrue(svg.includes('<symbol'), 'sprite.svg sin <symbol>');
      for (const id of ['i-task-start', 'i-task-complete', 'i-task-failed']) {
        assertTrue(svg.includes(`id="${id}"`), `falta símbolo ${id}`);
      }
    });

  } finally {
    if (serverInfo && serverInfo.server) {
      await new Promise(r => serverInfo.server.close(r));
    }
    closeWatcher();
  }

  console.log('---');
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('FAILS:');
    for (const f of fails) console.log(`  - ${f.label}: ${f.error}`);
  }
  // Salida limpia: seteamos exitCode y dejamos que Node decida cuándo cerrar
  // (el watcher de fs.watch del server queda vivo, así que process.exit() directo
  // dispara una assertion de libuv en Windows). unref() en los handles internos
  // permite que el proceso termine cuando no hay otro trabajo.
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
