// src/load_env.js
// Helper para cargar `.env` idempotentemente desde scripts standalone.
//
// Problema: NADIE carga `.env` automáticamente en este repo. Node no lo lee al
// invocar `node scripts/x.js`, y `npm run` tampoco lo inyecta (no dependemos de
// dotenv ni de ninguna otra carga automática). Por eso existe este helper: cada
// script que necesite las keys del `.env` debe importarlo explícitamente. Esto
// importa cuando:
//   - Un agente lanza un script vía Bash tool.
//   - CI/CD ejecuta scripts sin pasar por npm.
//   - El usuario lo invoca a mano fuera de `npm run`.
//
// Solución: importar este módulo al tope del script. Side-effect: lee `.env` del
// cwd (y del repo root como fallback) y popula `process.env` con las keys que
// falten. Las keys ya presentes en `process.env` NO se sobreescriben — esto es
// importante para que el usuario pueda overridear con `KEY=val node script.js`.
//
// Uso:
//   import './src/load_env.js';            // desde la raíz del repo
//   import '../src/load_env.js';           // desde scripts/
//
// Idempotente: importarlo N veces tiene el mismo efecto que importarlo una.
// Silent: si `.env` no existe, no rompe — solo no carga nada.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Flag de idempotencia: garantiza que sólo intentamos cargar una vez por proceso.
const FLAG = Symbol.for('mazelab.load_env.loaded');

/**
 * Parser mínimo de .env. Acepta:
 *   - KEY=value
 *   - KEY="value with spaces"
 *   - KEY='value'
 *   - # comentarios
 *   - líneas vacías
 * Ignora export prefix. NO interpola variables (`${OTHER_VAR}` queda literal).
 *
 * @param {string} text Contenido del archivo .env
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  for (const lineRaw of text.split(/\r?\n/)) {
    let line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    // Strip comentario inline solo si NO está dentro de comillas.
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(' #');
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    out[key] = val;
  }
  return out;
}

/**
 * Carga `.env` desde los lugares estándar. Devuelve la lista de paths leídos.
 * Por defecto:
 *   1. <cwd>/.env
 *   2. <REPO_ROOT>/.env  (solo si distinto del cwd)
 *
 * Keys ya presentes en `process.env` se respetan (override del shell gana).
 *
 * @param {{ paths?: string[], override?: boolean, force?: boolean }} [opts]
 * @returns {{ loaded: string[], keys: string[] }}
 */
export function loadEnv(opts = {}) {
  // Idempotencia salvo que `force: true` pida re-cargar (útil para tests).
  if (!opts.force && globalThis[FLAG]) {
    return { loaded: [], keys: [] };
  }
  const override = opts.override === true;
  const cwdEnv = resolve(process.cwd(), '.env');
  const rootEnv = join(REPO_ROOT, '.env');
  const candidates = Array.isArray(opts.paths) && opts.paths.length
    ? opts.paths.map(p => resolve(p))
    : [cwdEnv, rootEnv];

  const loaded = [];
  const keys = [];
  const seen = new Set();
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(path)) continue;
    let parsed;
    try {
      parsed = parseEnv(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (!override && Object.prototype.hasOwnProperty.call(process.env, k) && process.env[k] !== '') {
        // Ya seteada en el environment: respetamos lo que ya hay.
        continue;
      }
      process.env[k] = v;
      if (!keys.includes(k)) keys.push(k);
    }
    loaded.push(path);
  }
  globalThis[FLAG] = true;
  return { loaded, keys };
}

// Side-effect al importar: corre `loadEnv()` con defaults. Esto es lo que hace
// `import './src/load_env.js';` "just work" como entry point implícito.
loadEnv();

export default loadEnv;
