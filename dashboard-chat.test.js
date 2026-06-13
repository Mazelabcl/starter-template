// dashboard-chat.test.js
//
// Verifica el chat público del dashboard (Sprint v3.1):
//   - POST /api/chat persiste a chat-log.jsonl + emite SSE 'chat-msg'.
//   - GET /api/chat/history retorna los últimos N mensajes.
//   - El helper `node scripts/update_state.js say <from> <to> <message>` escribe
//     al log local incluso si el server no está, y POSTea best-effort.
//   - sanitizeChatField bloquea control chars y limita longitud.
//
// Importante: corremos el server en un puerto temporal y limpiamos el
// chat-log.jsonl al final.

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  startServer,
  closeWatcher,
  CHAT_LOG_PATH,
  sanitizeChatField,
  readChatTail,
} from './dashboard/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
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

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
  }
}

function backupChatLog() {
  if (existsSync(CHAT_LOG_PATH)) {
    return readFileSync(CHAT_LOG_PATH, 'utf8');
  }
  return null;
}

function restoreChatLog(backup) {
  if (backup === null) {
    if (existsSync(CHAT_LOG_PATH)) unlinkSync(CHAT_LOG_PATH);
  } else {
    mkdirSync(dirname(CHAT_LOG_PATH), { recursive: true });
    writeFileSync(CHAT_LOG_PATH, backup, 'utf8');
  }
}

function resetChatLog() {
  if (existsSync(CHAT_LOG_PATH)) unlinkSync(CHAT_LOG_PATH);
}

const backup = backupChatLog();

let serverHandle = null;
try {
  resetChatLog();
  serverHandle = await startServer(0);
  const port = serverHandle.port;
  // 127.0.0.1 explícito: el server bindea a loopback IPv4; "localhost" puede
  // resolver a ::1 (IPv6) en Windows y no responder.
  const base = `http://127.0.0.1:${port}`;

  // --------------------- TEST 1: sanitizeChatField ---------------------
  await check('sanitizeChatField: control chars stripped + length limit', () => {
    assertEqual(sanitizeChatField('hello\x00world'), 'helloworld', 'control char');
    assertEqual(sanitizeChatField('  hello  '), 'hello', 'trim');
    assertEqual(sanitizeChatField('', 100), '', 'empty string');
    assertEqual(sanitizeChatField(null), '', 'null');
    assertEqual(sanitizeChatField(123), '', 'number');
    const long = 'x'.repeat(5000);
    assertTrue(sanitizeChatField(long, 100).length === 100, 'length limit');
  });

  // --------------------- TEST 2: POST /api/chat persiste ---------------------
  await check('POST /api/chat persiste a chat-log.jsonl con shape correcto', async () => {
    resetChatLog();
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'orquestador', to: 'pencil-designer', message: 'hola' }),
    });
    assertTrue(res.ok, `POST falló: ${res.status}`);
    const json = await res.json();
    assertEqual(json.ok, true, 'response ok');

    const tail = readChatTail(10);
    assertTrue(tail.length === 1, `esperaba 1 mensaje, hubo ${tail.length}`);
    const m = tail[0];
    assertEqual(m.from, 'orquestador', 'from');
    assertEqual(m.to, 'pencil-designer', 'to');
    assertEqual(m.message, 'hola', 'message');
    assertTrue(typeof m.timestamp === 'string' && m.timestamp.length > 0, 'timestamp set');
  });

  // --------------------- TEST 3: POST /api/chat valida campos ---------------------
  await check('POST /api/chat rechaza payload sin from/to/message', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '', to: 'x', message: 'y' }),
    });
    assertEqual(res.status, 400, 'should be 400');
  });

  await check('POST /api/chat rechaza JSON malformado', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assertEqual(res.status, 400, 'should be 400');
  });

  // --------------------- TEST 4: GET /api/chat/history ---------------------
  await check('GET /api/chat/history retorna mensajes ordenados', async () => {
    resetChatLog();
    // Insertamos 3 mensajes vía POST.
    for (const i of [1, 2, 3]) {
      await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `agente-${i}`, to: 'orquestador', message: `msg ${i}` }),
      });
    }
    const res = await fetch(`${base}/api/chat/history`);
    assertTrue(res.ok, `history falló: ${res.status}`);
    const json = await res.json();
    assertTrue(Array.isArray(json.messages), 'messages array');
    assertEqual(json.messages.length, 3, '3 mensajes');
    assertEqual(json.messages[0].from, 'agente-1', 'orden cronológico');
    assertEqual(json.messages[2].from, 'agente-3', 'orden cronológico');
  });

  // --------------------- TEST 5: helper `say` desde update_state.js ---------------------
  await check('node scripts/update_state.js say <from> <to> <message> escribe al log local', async () => {
    resetChatLog();
    const r = spawnSync(process.execPath, [UPDATE_SCRIPT, 'say', 'critic', 'architect', 'tu output tiene un problema'], {
      cwd: REPO_ROOT,
      env: { ...process.env, DASHBOARD_PORT: String(port) },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(`helper falló (status ${r.status}): ${r.stderr}`);
    }
    // Esperamos a que el POST async fire-and-forget llegue.
    await new Promise(r => setTimeout(r, 200));
    const tail = readChatTail(10);
    // El log local Y el server pueden tener el mensaje. Esperamos al menos 1.
    assertTrue(tail.length >= 1, `esperaba ≥1 mensaje, hubo ${tail.length}`);
    const found = tail.find(m => m.from === 'critic' && m.to === 'architect');
    assertTrue(!!found, 'mensaje del helper no encontrado en el log');
    assertEqual(found.message, 'tu output tiene un problema', 'message body');
  });

  // --------------------- TEST 6: SSE chat-msg event delivery ---------------------
  await check('POST /api/chat emite evento SSE chat-msg a clientes conectados', async () => {
    resetChatLog();
    // Abrimos un cliente SSE básico.
    const sseAbort = new AbortController();
    const sseRes = await fetch(`${base}/api/events`, {
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' },
      signal: sseAbort.signal,
    });
    assertTrue(sseRes.ok, 'SSE abierto');

    // Lectura streaming hasta encontrar el evento chat-msg.
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let foundEvent = null;

    // Lanzar el POST después de un tick para garantizar que el cliente está conectado.
    setTimeout(() => {
      fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'sse-sender', to: 'sse-receiver', message: 'broadcast test' }),
      }).catch(() => { /* swallow */ });
    }, 50);

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Parser mínimo SSE: divide por \n\n.
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const eventLine = block.split('\n').find(l => l.startsWith('event: '));
        const dataLine = block.split('\n').find(l => l.startsWith('data: '));
        if (eventLine && eventLine.includes('chat-msg') && dataLine) {
          foundEvent = JSON.parse(dataLine.slice(6));
          break;
        }
      }
      if (foundEvent) break;
    }
    sseAbort.abort();
    try { reader.releaseLock(); } catch { /* ignore */ }

    assertTrue(!!foundEvent, 'chat-msg event no recibido por SSE');
    assertEqual(foundEvent.from, 'sse-sender', 'event.from');
    assertEqual(foundEvent.message, 'broadcast test', 'event.message');
  });
} finally {
  if (serverHandle && serverHandle.server) {
    await new Promise(r => serverHandle.server.close(() => r()));
  }
  closeWatcher();
  restoreChatLog(backup);
}

console.log(`\nresultado: ${passed} pasaron, ${failed} fallaron`);
if (failed > 0) {
  console.error('\nFallos:');
  for (const f of fails) console.error(`  - ${f.label}: ${f.error}`);
}
process.exit(failed === 0 ? 0 : 1);
