// dashboard-public-mode.test.js
// Verifica que DASHBOARD_PUBLIC=1 activa el middleware read-only.
// Necesita lanzar el server en subproceso porque la flag se lee en module load.

import { test, after, before } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, 'dashboard', 'server.js');
const SERVER_URL = pathToFileURL(SERVER_PATH).href;

// Launcher: arranca el server en puerto 0 con DASHBOARD_PUBLIC=1 y reporta el
// puerto real por stdout. En Windows necesitamos file:// para que ESM lo cargue.
const LAUNCHER_SCRIPT = `
import('${SERVER_URL}').then(async ({startServer}) => {
  const { port } = await startServer(0);
  console.log('PORT=' + port);
}).catch(e => { console.error('LAUNCHER_FAIL', e.message); process.exit(1); });
`;

let child = null;
let serverPort = null;

before(async () => {
  child = spawn(process.execPath, ['--input-type=module', '-e', LAUNCHER_SCRIPT], {
    env: { ...process.env, DASHBOARD_PUBLIC: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverPort = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = chunk => {
      buf += chunk.toString();
      const m = buf.match(/PORT=(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', d => buf += d.toString());
    setTimeout(() => reject(new Error('timeout esperando puerto del server\n' + buf)), 5000);
  });
});

after(async () => {
  if (child && !child.killed) {
    child.kill('SIGKILL');
  }
});

test('POST /api/state retorna 403 con DASHBOARD_PUBLIC=1', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active_skills: ['x'] }),
  });
  assert.strictEqual(r.status, 403);
  const j = await r.json();
  assert.strictEqual(j.error, 'read-only mode');
});

test('PUT /api/state retorna 403', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`, {
    method: 'PUT',
    body: '{}',
  });
  assert.strictEqual(r.status, 403);
});

test('PATCH /api/state retorna 403', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`, {
    method: 'PATCH',
    body: '{}',
  });
  assert.strictEqual(r.status, 403);
});

test('DELETE /api/state retorna 403', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`, {
    method: 'DELETE',
  });
  assert.strictEqual(r.status, 403);
});

test('GET /api/state retorna 200 (whitelist)', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.ok(typeof j.session_id === 'string');
});

test('HEAD /api/state retorna 200 o 204 (no 403)', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`, { method: 'HEAD' });
  assert.ok(r.status === 200 || r.status === 204, `status ${r.status}`);
});

test('OPTIONS /api/state retorna 200 o 204', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/state`, { method: 'OPTIONS' });
  assert.ok(r.status === 200 || r.status === 204, `status ${r.status}`);
});

test('GET /api/pack-name funciona en read-only', async () => {
  const r = await fetch(`http://localhost:${serverPort}/api/pack-name`);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.pack, 'kenney-roguelike');
});

test('GET /assets/packs/kenney-roguelike/manifest.json funciona en read-only', async () => {
  const r = await fetch(`http://localhost:${serverPort}/assets/packs/kenney-roguelike/manifest.json`);
  assert.strictEqual(r.status, 200);
});
