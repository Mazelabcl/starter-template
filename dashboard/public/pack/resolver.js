// dashboard/public/pack/resolver.js
//
// Resuelve el pack activo del dashboard v3. Orden de precedencia:
//   1) ?pack=<name> en URL (si pasa sanitización).
//   2) Argumento `preferredName` (si pasa sanitización).
//   3) GET /api/pack-name → env DASHBOARD_PACK del server.
// Cualquier nombre que NO matchea la regex del schema cae silencioso al default
// 'kenney-roguelike'. Esto bloquea path traversal vía URL.
//
// Una vez resuelto el nombre, intenta cargar el manifest:
//   a) /assets/vendor/<name>/manifest.json — binarios reales bajados por fetch script.
//   b) /assets/packs/<name>/manifest.json  — manifest declarativo del repo.
// Si ambos fallan, throw error con el mensaje canónico hacia el banner UI.

const DEFAULT_PACK = 'kenney-roguelike';

// Misma regex que el schema assets-pack.schema.json#name: ^[a-z0-9][a-z0-9-]*$.
const PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Valida que el nombre cumpla la regex del schema antes de usarlo en paths.
 * Exportada para tests del fix path-traversal.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidPackName(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0) return false;
  // Defensa extra: la regex ya bloquea, pero rechazamos paths con `..` por si acaso.
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return PACK_NAME_RE.test(name);
}

/**
 * Lee el query param `pack` del URL actual (browser) o de un URL pasado.
 * En entornos sin `window`/`URL` retorna null.
 *
 * @param {string} [urlString]
 * @returns {string|null}
 */
function readUrlPack(urlString) {
  try {
    const href = urlString
      || (typeof window !== 'undefined' && window.location ? window.location.href : null);
    if (!href) return null;
    const u = new URL(href);
    return u.searchParams.get('pack');
  } catch {
    return null;
  }
}

/**
 * Resuelve el pack activo + el URL base del manifest a usar.
 *
 * Estrategia:
 *   1. Si llega `preferredName` y es válido → ese. Si no es válido → ignorar y seguir.
 *   2. Si la URL trae `?pack=` y es válido → ese (gana sobre env).
 *   3. fetch GET /api/pack-name. Si retorna un name válido → ese.
 *   4. Fallback a DEFAULT_PACK.
 *
 * Luego prueba /assets/vendor/ y /assets/packs/ en orden y retorna el primero
 * que responda 200.
 *
 * @param {string} [preferredName]
 * @param {{ fetchImpl?: typeof fetch, urlString?: string }} [opts]
 * @returns {Promise<{ name: string, baseUrl: string, manifestUrl: string, source: 'vendor'|'packs' }>}
 */
export async function resolvePack(preferredName, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;

  // 1) URL override gana (sanitizado).
  const fromUrl = readUrlPack(opts.urlString);
  if (fromUrl && isValidPackName(fromUrl)) {
    return await tryResolve(fromUrl, fetchImpl);
  }

  // 2) preferredName explícito.
  if (preferredName && isValidPackName(preferredName)) {
    return await tryResolve(preferredName, fetchImpl);
  }

  // 3) /api/pack-name.
  let envName = null;
  try {
    const r = await fetchImpl('/api/pack-name');
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j.pack === 'string' && isValidPackName(j.pack)) {
        envName = j.pack;
      }
    }
  } catch {
    // sin red o endpoint no disponible: caemos al default.
  }

  // 4) Fallback al default.
  return await tryResolve(envName || DEFAULT_PACK, fetchImpl);
}

async function tryResolve(name, fetchImpl) {
  // Prioridad vendor (binarios reales) → packs (manifest declarativo, sin binarios).
  const candidates = [
    { source: 'vendor', baseUrl: `/assets/vendor/${name}` },
    { source: 'packs',  baseUrl: `/assets/packs/${name}` },
  ];
  for (const c of candidates) {
    const manifestUrl = `${c.baseUrl}/manifest.json`;
    // HEAD primero (más barato). Si el server no soporta HEAD aquí, hacemos GET fallback.
    let ok = false;
    try {
      const r = await fetchImpl(manifestUrl, { method: 'HEAD' });
      ok = r.ok;
    } catch {
      // ignore — caemos a GET
    }
    if (!ok) {
      try {
        const r = await fetchImpl(manifestUrl, { method: 'GET' });
        ok = r.ok;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      return { name, baseUrl: c.baseUrl, manifestUrl, source: c.source };
    }
  }
  throw new Error(
    `no encontré assets del pack "${name}" — corre \`npm run dashboard:assets\` ` +
    `para descargar el default CC0, o copia un pack premium a assets/vendor/${name}/.`,
  );
}
