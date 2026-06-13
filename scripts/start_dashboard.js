// scripts/start_dashboard.js
// Arranca el dashboard en background + abre el browser.
// Usado por `npm start`. v4: ya no baja assets — el dashboard es HTML plano.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PORT = process.env.DASHBOARD_PORT || '7777';
const URL = `http://localhost:${PORT}`;

console.log('[start] arrancando dashboard en background...');

// Spawn detached del server. stdio ignore para no bloquear.
const server = spawn('node', ['dashboard/server.js'], {
  cwd: REPO_ROOT,
  detached: true,
  stdio: 'ignore',
});
server.unref();

// Esperamos a que el server levante. 2s es generoso.
await wait(2000);

// Health-check: confirmamos que el server que respondió en el puerto es EL NUESTRO
// (recién levantado) y no otro proceso ocupando el puerto — p. ej. el dashboard de
// OTRO proyecto del starter, que mostraría datos equivocados.
async function healthCheck() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/state`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

const healthy = await healthCheck();
if (!healthy) {
  const altPort = '7778';
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  ⚠ El dashboard NO respondió en el puerto ${PORT}.`);
  console.log(`  El puerto ${PORT} probablemente está ocupado por otro proceso`);
  console.log('  (posiblemente el dashboard de OTRO proyecto del starter, que');
  console.log('  mostraría datos equivocados). No abro el browser.');
  console.log('');
  console.log('  Arranca este proyecto en otro puerto:');
  console.log(`    Windows:     set DASHBOARD_PORT=${altPort}&& npm start`);
  console.log(`    PowerShell:  $env:DASHBOARD_PORT='${altPort}'; npm start`);
  console.log(`    Mac/Linux:   DASHBOARD_PORT=${altPort} npm start`);
  console.log('════════════════════════════════════════════════════════');
  process.exit(1);
}

// Abrir browser cross-platform.
const platform = process.platform;
let openCmd, openArgs;
if (platform === 'darwin') {
  openCmd = 'open';
  openArgs = [URL];
} else if (platform === 'win32') {
  openCmd = 'cmd';
  openArgs = ['/c', 'start', '', URL];
} else {
  openCmd = 'xdg-open';
  openArgs = [URL];
}

try {
  spawn(openCmd, openArgs, { detached: true, stdio: 'ignore' }).unref();
  console.log(`[start] dashboard abierto en ${URL}`);
} catch (e) {
  console.log(`[start] no pude abrir el browser automáticamente. Abre manualmente: ${URL}`);
}

console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  Todo listo. Próximo paso:');
console.log('    1. Abre Claude Code en esta carpeta');
console.log('    2. Dile: /kickoff');
console.log('');
console.log(`  Dashboard corriendo en: ${URL}`);
console.log(`  Para detenerlo después: npx kill-port ${PORT}`);
console.log('════════════════════════════════════════════════════════');

// Salimos limpio. El server queda corriendo detached.
process.exit(0);
