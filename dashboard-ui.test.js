// dashboard-ui.test.js
// Test ligero del frontend del dashboard — Sprint 2.3a (kanban + métricas, sin
// timeline/replay; eso entra en 2.3b).
//
// Estrategia: levanta el server en puerto efímero, hace fetch a los assets estáticos,
// verifica HTML + JS + CSS bien formados. NO verifica render visual (eso requiere
// un headless browser, fuera de scope para este sprint).
//
// PASS/FAIL claro. Exit 0 si todo verde, 1 si algo falla.

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

// Validador de HTML mínimo: balance de tags y presencia de elementos clave.
// No usamos parser externo (cero deps).
const VOID_ELEMENTS = new Set([
  'area','base','br','col','embed','hr','img','input','link','meta',
  'param','source','track','wbr',
]);

function validateHtmlBalance(html) {
  const stack = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const raw = m[0];
    const name = m[1].toLowerCase();
    const selfClosing = raw.endsWith('/>') || VOID_ELEMENTS.has(name);
    const isClose = raw.startsWith('</');
    if (selfClosing && !isClose) continue;
    if (isClose) {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) throw new Error(`tag de cierre sin apertura: </${name}>`);
      stack.splice(idx, 1);
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    throw new Error(`tags sin cerrar: ${stack.join(', ')}`);
  }
}

async function main() {
  console.log('--- dashboard-ui.test.js ---');
  let serverInfo = null;

  try {
    serverInfo = await startServer(0);
    const baseUrl = `http://localhost:${serverInfo.port}`;

    await check('GET / sirve index.html con doctype y root html', async () => {
      const r = await fetch(`${baseUrl}/`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      assertTrue(/<!doctype html>/i.test(text), 'tiene doctype');
      assertTrue(text.includes('<html'), 'tiene <html');
      assertTrue(text.includes('Dashboard v3'), 'contiene "Dashboard v3"');
    });

    await check('index.html tiene HTML balanceado', async () => {
      const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
      validateHtmlBalance(html);
    });

    await check('index.html declara las secciones esperadas para 2.3a', async () => {
      const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
      const required = [
        'class="topbar"',           // header
        'class="sidebar"',          // sidebar izquierdo
        'class="board"',            // kanban
        'data-status="queued"',     // columna en cola
        'data-status="running"',    // columna trabajando
        'data-status="completed"',  // columna completadas
        'data-status="failed"',     // columna falladas
        '2.3b:',                    // hook reservado para timeline/replay
      ];
      for (const needle of required) {
        assertTrue(html.includes(needle), `falta sección: ${needle}`);
      }
    });

    await check('GET /style.css existe y tiene las variables del tema', async () => {
      const r = await fetch(`${baseUrl}/style.css`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      assertTrue(text.length > 1000, `style.css demasiado corto (${text.length} bytes)`);
      assertTrue(text.includes('--bg-deep'), 'declara --bg-deep');
      assertTrue(text.includes('--accent-cyan'), 'declara --accent-cyan');
      assertTrue(text.includes('.task'), 'tiene reglas para .task');
      assertTrue(text.includes('@keyframes'), 'incluye animaciones');
      assertTrue(text.includes('--timeline-h'), 'reserva variable --timeline-h para 2.3b');
    });

    await check('GET /app.js existe y parsea como JS válido', async () => {
      const r = await fetch(`${baseUrl}/app.js`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      assertTrue(text.length > 1000, `app.js demasiado corto (${text.length} bytes)`);
      try {
        new vm.Script(text, { filename: 'app.js' });
      } catch (e) {
        throw new Error(`error de sintaxis en app.js: ${e.message}`);
      }
      assertTrue(text.includes('EventSource'), 'usa EventSource para SSE');
      assertTrue(text.includes('/api/state'), 'consulta /api/state');
      assertTrue(text.includes('/api/events'), 'consulta /api/events');
    });

    await check('icons/sprite.svg existe y tiene los símbolos de 2.3a', async () => {
      const r = await fetch(`${baseUrl}/icons/sprite.svg`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      assertTrue(text.includes('<symbol'), 'sprite.svg sin <symbol>');
      // 2.3a: estados de tarea + entidades del sistema (8 símbolos máximo).
      const iconIds = ['i-task-start', 'i-task-complete', 'i-task-failed', 'i-skill', 'i-council'];
      for (const id of iconIds) {
        assertTrue(text.includes(`id="${id}"`), `falta icono: ${id}`);
      }
      // Sprint 2.3a fijó <= 8; 2.3b agrega 6 (replay/export/decision/handoff/search/chevron).
      // Cota actualizada para acomodar 2.3b sin romper la verificación de mínimos.
      const symbolCount = (text.match(/<symbol\s/g) || []).length;
      assertTrue(symbolCount <= 16, `demasiados símbolos: ${symbolCount} > 16`);
    });

    await check('public/README.md existe y describe la UI', async () => {
      const path = join(PUBLIC_DIR, 'README.md');
      assertTrue(existsSync(path), 'public/README.md no existe');
      const text = readFileSync(path, 'utf8');
      assertTrue(text.length > 200, 'README muy corto');
      assertTrue(/Kanban/i.test(text) || /columnas/i.test(text), 'README menciona kanban/columnas');
      assertTrue(/SSE|EventSource/i.test(text), 'README menciona SSE');
      assertTrue(/2\.3b/i.test(text), 'README anuncia lo que viene en 2.3b');
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
  // Cerramos el watcher arriba en finally; con eso el loop puede terminar solo
  // y evitamos la assertion de libuv en Windows que dispara setImmediate(process.exit).
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
