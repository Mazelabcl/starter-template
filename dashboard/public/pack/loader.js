// dashboard/public/pack/loader.js
//
// Carga + validación browser-side del manifest del pack activo.
//   - loadManifest(url): fetch + verificación de campos mínimos (sin Ajv).
//   - loadPackTextures(scene, manifest): integración con Phaser.Loader; se completa
//     en fase 3 cuando Phaser.Scene esté en juego. Por ahora declara la API y
//     deja un TODO claro.

const PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const REQUIRED_ANIMATIONS = ['idle', 'working', 'waiting', 'failed'];

/**
 * @typedef {Object} CharAnimation
 * @property {number[]} frames
 * @property {number}   frameRate
 * @property {number}   repeat
 */

/**
 * @typedef {Object} PackTileset
 * @property {string} name
 * @property {string} src
 * @property {number} [columns]
 * @property {number} [rows]
 */

/**
 * @typedef {Object} PackManifest
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string} attribution
 * @property {string} [source_url]
 * @property {string} [source_sha256]
 * @property {number} tile_size
 * @property {number} scale
 * @property {PackTileset[]} tilesets
 * @property {Object}  characters_atlas
 * @property {string}  characters_atlas.src
 * @property {number}  characters_atlas.frame_width
 * @property {number}  characters_atlas.frame_height
 * @property {Object<string, CharAnimation>} characters_atlas.animations
 */

/**
 * Fetch + validación mínima (sin Ajv en browser). Chequea presencia y tipos
 * de los campos críticos para que el engine no explote a mitad de render.
 * La validación dura corre en scripts/fetch_default_pack.js con Ajv del repo.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<PackManifest>}
 */
export async function loadManifest(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const r = await fetchImpl(url);
  if (!r.ok) {
    throw new Error(`no pude descargar manifest ${url}: HTTP ${r.status}`);
  }
  let manifest;
  try {
    manifest = await r.json();
  } catch (e) {
    throw new Error(`manifest ${url} no es JSON: ${e.message}`);
  }
  validateManifestMinimal(manifest, url);
  return manifest;
}

/**
 * Validación browser sin Ajv. Chequea los invariantes que el engine necesita:
 *   - name string + matchea regex del schema
 *   - version string
 *   - tilesets es array con length >= 1
 *   - characters_atlas tiene src, frame_width, frame_height, animations
 *   - animations tiene las 4 keys (idle/working/waiting/failed)
 *   - cada animation tiene frames[], frameRate int, repeat int
 *
 * @param {object} manifest
 * @param {string} url
 * @returns {void}
 * @throws {Error} si algún invariante falla.
 */
export function validateManifestMinimal(manifest, url = '<manifest>') {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`manifest ${url} no es objeto`);
  }
  if (typeof manifest.name !== 'string' || !PACK_NAME_RE.test(manifest.name)) {
    throw new Error(`manifest ${url}.name inválido: "${manifest.name}"`);
  }
  if (typeof manifest.version !== 'string') {
    throw new Error(`manifest ${url}.version inválido`);
  }
  if (!Array.isArray(manifest.tilesets) || manifest.tilesets.length < 1) {
    throw new Error(`manifest ${url}.tilesets debe ser array no vacío`);
  }
  for (const ts of manifest.tilesets) {
    if (!ts || typeof ts !== 'object' || typeof ts.name !== 'string' || typeof ts.src !== 'string') {
      throw new Error(`manifest ${url}.tilesets[*] requiere {name, src}`);
    }
  }
  const ca = manifest.characters_atlas;
  if (!ca || typeof ca !== 'object') {
    throw new Error(`manifest ${url}.characters_atlas falta`);
  }
  if (typeof ca.src !== 'string') {
    throw new Error(`manifest ${url}.characters_atlas.src inválido`);
  }
  if (!Number.isInteger(ca.frame_width) || !Number.isInteger(ca.frame_height)) {
    throw new Error(`manifest ${url}.characters_atlas.frame_{width,height} deben ser enteros`);
  }
  if (!ca.animations || typeof ca.animations !== 'object') {
    throw new Error(`manifest ${url}.characters_atlas.animations falta`);
  }
  for (const key of REQUIRED_ANIMATIONS) {
    const anim = ca.animations[key];
    if (!anim || typeof anim !== 'object') {
      throw new Error(`manifest ${url}.characters_atlas.animations.${key} falta`);
    }
    if (!Array.isArray(anim.frames) || anim.frames.length < 1) {
      throw new Error(`animations.${key}.frames debe ser array no vacío`);
    }
    if (!Number.isInteger(anim.frameRate)) {
      throw new Error(`animations.${key}.frameRate debe ser entero`);
    }
    if (!Number.isInteger(anim.repeat)) {
      throw new Error(`animations.${key}.repeat debe ser entero`);
    }
  }
}

/**
 * Carga texturas del pack en Phaser.Loader y registra animations globales.
 *
 * Llamada desde `Phaser.Scene.preload()`:
 *   - tilesets se cargan como spritesheets (key `tiles:<tileset.name>`).
 *   - characters_atlas se carga como spritesheet (key `chars:atlas`).
 *   - Las animations se REGISTRAN globalmente en `scene.anims` con keys
 *     `avatar:idle`, `avatar:working`, `avatar:waiting`, `avatar:failed`.
 *
 * El `baseUrl` (por ej. `/assets/vendor/kenney-roguelike`) se concatena con
 * `tileset.src` y `characters_atlas.src` para resolver los paths reales.
 *
 * @param {object}   scene     Phaser.Scene (con scene.load y scene.anims).
 * @param {PackManifest} manifest
 * @param {string}   baseUrl   URL base del pack (ej `/assets/vendor/<name>`).
 * @returns {Promise<void>}
 */
export async function loadPackTextures(scene, manifest, baseUrl) {
  // TODO fase 3: integrar con Phaser. La interfaz queda definida y testeable
  // (manifest validado antes de entrar acá). Cuando la OfficeScene exista,
  // el body es algo como:
  //
  //   for (const ts of manifest.tilesets) {
  //     scene.load.spritesheet(`tiles:${ts.name}`, `${baseUrl}/${ts.src}`, {
  //       frameWidth: manifest.tile_size,
  //       frameHeight: manifest.tile_size,
  //     });
  //   }
  //   const ca = manifest.characters_atlas;
  //   scene.load.spritesheet('chars:atlas', `${baseUrl}/${ca.src}`, {
  //     frameWidth: ca.frame_width,
  //     frameHeight: ca.frame_height,
  //   });
  //   await new Promise(r => { scene.load.once('complete', r); scene.load.start(); });
  //
  //   for (const [state, anim] of Object.entries(ca.animations)) {
  //     scene.anims.create({
  //       key: `avatar:${state}`,
  //       frames: scene.anims.generateFrameNumbers('chars:atlas', { frames: anim.frames }),
  //       frameRate: anim.frameRate,
  //       repeat: anim.repeat,
  //     });
  //   }
  if (!scene || !manifest || typeof baseUrl !== 'string') {
    throw new Error('loadPackTextures: scene, manifest y baseUrl son obligatorios');
  }
  // Validación previa para que el llamador detecte un manifest roto temprano.
  validateManifestMinimal(manifest, baseUrl + '/manifest.json');
  // No-op real hasta fase 3. La función existe + chequea contrato.
}
