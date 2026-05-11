// scripts/start_dashboard.js
// Arranca el dashboard en background + abre el browser.
// Usado por `npm start` después de install + dashboard:assets.

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
console.log('  Para detenerlo después: cierra la terminal o mata el proceso node');
console.log('════════════════════════════════════════════════════════');

// Salimos limpio. El server queda corriendo detached.
process.exit(0);
