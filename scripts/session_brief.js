// scripts/session_brief.js
// Brief mecánico de arranque de sesión (hook SessionStart). Detecta sin keys ni
// kickoff y sugiere el próximo paso en 1-3 líneas. NO reemplaza el juicio del
// orquestador — solo da una señal barata y determinística.
//
// Lee:
//   - summarize() de src/memory.js → has_profile (¿corrió /kickoff?).
//   - .env del repo → ¿están las keys core (OPENROUTER_API_KEY, OPENAI_API_KEY)?
//
// CONTRATO DURO: en un clon fresco (sin memory/ o sin node_modules) DEBE salir
// silencioso con exit 0. Nunca rompe el arranque de Claude. Cualquier error se
// traga y termina en 0.
//
// Uso (vía hook): node scripts/session_brief.js
// Idioma: español neutro.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Keys core: sin estas, los modelos principales no funcionan. Las opcionales
// (REPLICATE_API_TOKEN, GEMINI_API_KEY) no entran en este chequeo mecánico.
const CORE_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'];

// Parser mínimo de .env (sin importar load_env.js para no depender de su
// side-effect y mantener este script lo más autónomo posible).
function parseEnvFile(path) {
  const out = {};
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return out; }
  for (const lineRaw of text.split(/\r?\n/)) {
    let line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Una key cuenta como "presente" solo si tiene valor real — no el placeholder
// del .env.example (contiene "pega-aqui" o arranca con "optional-").
function keyIsReal(val) {
  if (typeof val !== 'string' || !val.trim()) return false;
  const v = val.trim().toLowerCase();
  if (v.includes('pega-aqui')) return false;
  if (v.startsWith('optional-')) return false;
  return true;
}

async function run() {
  // Clon fresco: sin node_modules no podemos importar memory.js (usa ajv). Salir
  // silencioso — el arranque no debe depender de un npm install previo.
  if (!existsSync(join(REPO_ROOT, 'node_modules'))) return;
  // Sin memory/ tampoco hay nada que resumir (clon fresco sin estado).
  if (!existsSync(join(REPO_ROOT, 'memory'))) return;

  const briefs = [];

  // 1) ¿corrió /kickoff? (has_profile)
  try {
    const mem = await import('../src/memory.js');
    const summary = mem.summarize(join(REPO_ROOT, 'memory'));
    if (summary && summary.has_profile === false) {
      briefs.push('Proyecto sin kickoff: sugiere /kickoff para detectar tipo y armar el stack.');
    }
  } catch {
    // Si memory.js falla por lo que sea, no bloqueamos el arranque.
  }

  // 2) ¿están las keys core?
  try {
    const envPath = join(REPO_ROOT, '.env');
    const env = existsSync(envPath) ? parseEnvFile(envPath) : {};
    const missing = CORE_KEYS.filter(k => !keyIsReal(process.env[k]) && !keyIsReal(env[k]));
    if (missing.length) {
      briefs.push(`Faltan keys core (${missing.join(', ')}): corre npm run setup.`);
    }
  } catch {
    // idem: nunca rompemos el arranque por el chequeo de keys.
  }

  if (briefs.length) {
    console.log('[brief de sesión]');
    for (const b of briefs) console.log(`- ${b}`);
  }
}

run().catch(() => { /* nunca propaga: el arranque no debe fallar por esto */ });
