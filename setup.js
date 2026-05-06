// Setup interactivo: API keys + Python venv + dependencias.
// Diseñado para usuarios novatos. Detecta Python; si no está, da instrucciones claras.

import { createInterface } from 'readline';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { platform } from 'os';
import { join } from 'path';

// Si no hay TTY interactivo (ej. CI o postinstall en algunos entornos), salir limpio.
if (!process.stdin.isTTY) {
  console.log('\n[setup.js] No hay terminal interactivo. Saltando setup.');
  console.log('Cuando puedas, corre manualmente: npm run setup\n');
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const ENV_PATH = '.env';
const IS_WIN = platform() === 'win32';
const VENV_DIR = '.venv';
const VENV_PY = IS_WIN ? join(VENV_DIR, 'Scripts', 'python.exe') : join(VENV_DIR, 'bin', 'python');
const VENV_PIP = IS_WIN ? join(VENV_DIR, 'Scripts', 'pip.exe') : join(VENV_DIR, 'bin', 'pip');

function log(msg) { console.log(msg); }
function header(t) { console.log(`\n━━━ ${t} ━━━`); }

function detectPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
      const m = out.match(/Python (\d+)\.(\d+)/);
      if (m && parseInt(m[1]) >= 3 && parseInt(m[2]) >= 10) {
        return { cmd, version: out };
      }
    } catch { /* not found */ }
  }
  return null;
}

function showPythonInstructions() {
  log('\nPython 3.10+ no detectado. Necesitas instalarlo para usar gpt-image-2.\n');
  if (IS_WIN) {
    log('Windows — opción más fácil:');
    log('  1. Abre Microsoft Store y busca "Python 3.12" → Instalar');
    log('  2. O descarga desde https://www.python.org/downloads/ (marca "Add to PATH" al instalar)');
  } else if (platform() === 'darwin') {
    log('macOS:');
    log('  brew install python@3.12');
    log('  (si no tienes brew: https://brew.sh)');
  } else {
    log('Linux:');
    log('  sudo apt install python3 python3-venv python3-pip   # Debian/Ubuntu');
    log('  sudo dnf install python3 python3-pip                # Fedora');
  }
  log('\nDespués de instalar, vuelve a correr: npm run setup\n');
}

function setupPythonEnv(py) {
  header('Python venv + openai');
  if (existsSync(VENV_PY)) {
    log('venv ya existe — saltando creación.');
  } else {
    log(`Creando venv con ${py.cmd}...`);
    const r = spawnSync(py.cmd, ['-m', 'venv', VENV_DIR], { stdio: 'inherit' });
    if (r.status !== 0) {
      log('FALLO al crear venv. Asegurate de tener python3-venv instalado.');
      return false;
    }
  }
  log('Instalando openai en venv...');
  const r2 = spawnSync(VENV_PIP, ['install', '--quiet', '--upgrade', '-r', 'requirements.txt'], { stdio: 'inherit' });
  if (r2.status !== 0) {
    log('FALLO al instalar deps Python. Revisa errores arriba.');
    return false;
  }
  log('OK — Python listo.');
  return true;
}

function upsertEnv(key, value) {
  let envContent = '';
  if (existsSync(ENV_PATH)) {
    envContent = readFileSync(ENV_PATH, 'utf8');
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (envContent.match(re)) {
      envContent = envContent.replace(re, `${key}=${value}`);
    } else {
      envContent += (envContent.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
    }
  } else {
    envContent = `${key}=${value}\n`;
  }
  writeFileSync(ENV_PATH, envContent);
}

async function maybeAskKey(label, envKey, prefix, url) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').match(new RegExp(`^${envKey}=(.+)$`, 'm'))?.[1] : null;
  if (existing && existing !== `${prefix}pega-aqui-tu-key`) {
    const ans = (await ask(`${label} ya configurada. ¿Reemplazar? [y/N]: `)).trim().toLowerCase();
    if (ans !== 'y' && ans !== 'yes') return;
  }
  log(`Sácala en: ${url}`);
  log(`Formato esperado: ${prefix}...`);
  const key = (await ask(`Pega tu ${label} (Enter para saltar): `)).trim();
  if (!key) { log(`Saltada — podrás configurarla después con /setup-${envKey.toLowerCase().replace('_api_key','').replace('_','-')}.`); return; }
  if (!key.startsWith(prefix)) {
    log(`Aviso: la key no empieza con "${prefix}". Continuando igual.`);
  }
  upsertEnv(envKey, key);
  log(`Guardada en .env`);
}

(async () => {
  log('\n╔═══════════════════════════════════════════╗');
  log('║   Setup del starter-template              ║');
  log('║   API keys + Python para gpt-image-2      ║');
  log('╚═══════════════════════════════════════════╝');

  // Carpetas que pueden faltar al clonar
  for (const d of ['content', 'process-log', 'scripts']) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  // 1. OpenRouter (Perplexity research)
  header('1. OpenRouter API key (research vía Perplexity)');
  await maybeAskKey('OpenRouter API key', 'OPENROUTER_API_KEY', 'sk-or-v1-', 'https://openrouter.ai/keys');

  // 2. OpenAI (gpt-image-2)
  header('2. OpenAI API key (gpt-image-2 para imágenes)');
  log('Antes verifica en https://platform.openai.com/settings/organization/general');
  log('que tu org diga: Individual Approved + Business Approved.');
  log('Y en https://platform.openai.com/limits que aparezca gpt-image-2.\n');
  await maybeAskKey('OpenAI API key', 'OPENAI_API_KEY', 'sk-proj-', 'https://platform.openai.com/api-keys');

  // 3. Python
  header('3. Python (para gpt-image-2)');
  const py = detectPython();
  if (py) {
    log(`Detectado: ${py.version}`);
    const ans = (await ask('¿Crear venv e instalar openai ahora? [Y/n]: ')).trim().toLowerCase();
    if (ans !== 'n' && ans !== 'no') {
      setupPythonEnv(py);
    } else {
      log('Saltado. Después puedes correr: npm run setup-python');
    }
  } else {
    showPythonInstructions();
  }

  // Cierre
  header('Listo');
  log('Próximos pasos:');
  log('  1. Abre Claude Code en este proyecto.');
  log('  2. Escribe /kickoff para arrancar la entrevista del proyecto.');
  log('  3. O prueba: node src/research.js quick "qué hora es en Tokio"\n');
  rl.close();
})();
