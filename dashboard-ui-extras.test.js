// dashboard-ui-extras.test.js
// Test del frontend extendido (Sprint 2.3b — timeline + replay + export).
//
// Estrategia: levanta el server en puerto efímero, pide los assets nuevos y
// verifica:
//   - app-extras.js parsea como JS válido y tiene funciones esperadas.
//   - index.html contiene los slots montados con sus data-attributes.
//   - style.css tiene los bloques nuevos.
//   - sprite.svg expone los 8 símbolos originales + los 6 nuevos.
//   - GET /api/history responde para popular el timeline inicial.
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

async function main() {
  console.log('--- dashboard-ui-extras.test.js ---');
  let serverInfo = null;

  try {
    serverInfo = await startServer(0);
    const baseUrl = `http://localhost:${serverInfo.port}`;

    await check('app-extras.js existe en disco y se sirve por HTTP', async () => {
      assertTrue(existsSync(join(PUBLIC_DIR, 'app-extras.js')), 'falta app-extras.js en disco');
      const r = await fetch(`${baseUrl}/app-extras.js`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      assertTrue(text.length > 1000, `app-extras.js demasiado corto (${text.length} bytes)`);
    });

    await check('app-extras.js parsea como JS válido', async () => {
      const text = readFileSync(join(PUBLIC_DIR, 'app-extras.js'), 'utf8');
      try {
        new vm.Script(text, { filename: 'app-extras.js' });
      } catch (e) {
        throw new Error(`error de sintaxis: ${e.message}`);
      }
      // Sondas mínimas para detectar regresiones de API.
      assertTrue(text.includes('/api/history'), 'consume /api/history');
      assertTrue(text.includes('/api/state'),   'consume /api/state');
      assertTrue(text.includes('EventSource'),  'usa EventSource para SSE');
      assertTrue(text.includes('createObjectURL'), 'usa Blob + URL.createObjectURL para export');
      assertTrue(/function\s+exportLog|exportLog\s*=/.test(text) || text.includes('exportLog'), 'define exportLog');
    });

    await check('index.html contiene los slots estáticos de 2.3b montados', async () => {
      const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
      const required = [
        'data-timeline',           // panel raíz
        'data-timeline-list',      // ol del listado
        'data-timeline-search',    // input de búsqueda
        'data-timeline-filters',   // contenedor de filtros
        'data-replay-modal',       // root del modal de replay
        'data-replay-scrubber',    // slider temporal
        'data-replay-snapshot',    // contenedor del kanban de replay
        'data-export-btn',         // botón exportar
        'app-extras.js',           // script del módulo nuevo
      ];
      for (const needle of required) {
        assertTrue(html.includes(needle), `falta marcador de 2.3b: ${needle}`);
      }
    });

    await check('app-extras.js construye filas con data-timeline-row', async () => {
      // Las filas se generan en runtime — verificamos que el módulo emite el
      // attribute esperado para integraciones futuras / queries de DOM.
      const text = readFileSync(join(PUBLIC_DIR, 'app-extras.js'), 'utf8');
      assertTrue(text.includes('data-timeline-row') || text.includes('timelineRow'),
        'app-extras.js no construye rows con data-timeline-row');
    });

    await check('index.html sigue balanceado tras la inyección de 2.3b', async () => {
      const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
      const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
      const stack = [];
      const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
      let m;
      while ((m = tagRe.exec(html)) !== null) {
        const raw = m[0];
        const name = m[1].toLowerCase();
        const selfClosing = raw.endsWith('/>') || VOID.has(name);
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
      if (stack.length > 0) throw new Error(`tags sin cerrar: ${stack.join(', ')}`);
    });

    await check('style.css tiene los bloques nuevos de 2.3b', async () => {
      const r = await fetch(`${baseUrl}/style.css`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      const required = [
        '.timeline',
        '.timeline-row',
        '.timeline-filter',
        '.replay-modal',
        '.replay-scrubber',
        '.replay-kanban',
        '@keyframes timeline-slide-in',
      ];
      for (const needle of required) {
        assertTrue(text.includes(needle), `falta regla CSS: ${needle}`);
      }
      // Variables y reglas de 2.3a NO deben haber sido removidas.
      assertTrue(text.includes('--timeline-h'), 'preserva --timeline-h de 2.3a');
      assertTrue(text.includes('--accent-cyan'), 'preserva --accent-cyan');
    });

    await check('sprite.svg tiene los 8 símbolos originales + los 6 nuevos', async () => {
      const r = await fetch(`${baseUrl}/icons/sprite.svg`);
      assertEqual(r.status, 200, 'status');
      const text = await r.text();
      const original = ['i-task-start', 'i-task-complete', 'i-task-failed', 'i-agent', 'i-skill', 'i-council', 'i-image', 'i-clock'];
      const nuevos   = ['i-replay', 'i-export', 'i-decision', 'i-handoff', 'i-search', 'i-chevron'];
      for (const id of [...original, ...nuevos]) {
        assertTrue(text.includes(`id="${id}"`), `falta símbolo: ${id}`);
      }
      const symbolCount = (text.match(/<symbol\s/g) || []).length;
      assertTrue(symbolCount === 14, `total de símbolos esperado 14, real ${symbolCount}`);
    });

    await check('GET /api/history responde para alimentar el timeline', async () => {
      const r = await fetch(`${baseUrl}/api/history?limit=200`);
      assertEqual(r.status, 200, 'status');
      const j = await r.json();
      assertTrue(Array.isArray(j.events), 'events es array');
    });

    await check('app-extras.js declara los tipos de evento canónicos', async () => {
      const text = readFileSync(join(PUBLIC_DIR, 'app-extras.js'), 'utf8');
      const types = [
        'task_started', 'task_completed', 'task_failed',
        'agent_invoked', 'skill_invoked', 'decision_emitted',
        'hand_off_validated', 'hand_off_failed', 'council_invoked', 'image_generated',
      ];
      for (const t of types) {
        assertTrue(text.includes(t), `falta manejo del tipo de evento: ${t}`);
      }
    });

    await check('app.js de 2.3a sigue intacto en sus puntos clave', async () => {
      // Cero regresión: el módulo de 2.3a no fue tocado.
      const text = readFileSync(join(PUBLIC_DIR, 'app.js'), 'utf8');
      assertTrue(text.includes('renderColumns'), 'kanban renderColumns presente');
      assertTrue(text.includes('connectSSE'),    'connectSSE presente');
      assertTrue(text.includes('toggleSidebar'), 'toggleSidebar presente');
      assertTrue(!text.includes('app-extras'),   'app.js no menciona app-extras');
      assertTrue(!text.includes('replay-modal'), 'app.js no contiene lógica de replay');
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
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
