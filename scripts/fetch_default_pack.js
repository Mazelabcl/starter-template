// scripts/fetch_default_pack.js
// Descarga el pack default (Kenney CC0) y deja los binarios en assets/vendor/<pack>/.
// Cero deps nuevas: usa fetch nativo (Node 18+), node:crypto, node:zlib y un
// parser mínimo del Central Directory del ZIP. Soporta solo los métodos de
// compresión usados por Kenney (store=0 y deflate=8), suficiente para el caso.
//
// Diseño testeable: exporta funciones puras (computeSHA256, parseZipEntries,
// extractZip, validateManifest) para mock desde tests sin red.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { validateOutput } from '../contracts/validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PACK_NAME = 'kenney-roguelike';
const PACK_DIR = join(REPO_ROOT, 'assets', 'packs', PACK_NAME);
const VENDOR_DIR = join(REPO_ROOT, 'assets', 'vendor', PACK_NAME);
const MANIFEST_PATH = join(PACK_DIR, 'manifest.json');

const SHA_SENTINEL = '0'.repeat(64);

// Segundo pack: Kenney mantiene characters como ZIP aparte. URL declarada acá
// porque el manifest solo modela "un source_url principal"; el characters
// va inline en este script. Si en el futuro el schema soporta múltiples
// fuentes, mover allá.
const CHARACTERS_ZIP_URL = 'https://kenney.nl/media/pages/assets/roguelike-characters/cc364edf00-1729196490/kenney_roguelike-characters.zip';

// ---------- helpers exportables ----------

/**
 * SHA256 hex de un Buffer.
 * @param {Buffer} buf
 * @returns {string}
 */
export function computeSHA256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Valida un manifest contra el schema assets-pack del repo (Ajv).
 * @param {object} manifest
 * @returns {{ valid: boolean, errors: Array<{message: string}> }}
 */
export function validateManifest(manifest) {
  return validateOutput('assets-pack', manifest);
}

/**
 * Parser mínimo del Central Directory de un ZIP. Suficiente para los ZIPs de
 * Kenney (sin ZIP64, sin encryption, métodos 0=store / 8=deflate).
 *
 * @param {Buffer} zip
 * @returns {Array<{ name: string, method: number, compressedSize: number, uncompressedSize: number, localHeaderOffset: number }>}
 */
export function parseZipEntries(zip) {
  // 1) buscar el End Of Central Directory record (EOCD): signature 0x06054b50.
  //    Vive cerca del final, posiblemente con comment de hasta 64KB.
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const maxComment = Math.min(zip.length, 65557);
  for (let i = zip.length - 22; i >= zip.length - maxComment && i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('no encontré End Of Central Directory — ¿ZIP corrupto o ZIP64?');
  }

  const numEntries = zip.readUInt16LE(eocdOffset + 10);
  const cdSize = zip.readUInt32LE(eocdOffset + 12);
  const cdOffset = zip.readUInt32LE(eocdOffset + 16);

  if (cdOffset + cdSize > zip.length) {
    throw new Error('Central Directory fuera de rango');
  }

  // 2) recorrer central directory entries (signature 0x02014b50).
  const CD_SIG = 0x02014b50;
  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (zip.readUInt32LE(off) !== CD_SIG) {
      throw new Error(`Central Directory entry signature inválida en offset ${off}`);
    }
    const method = zip.readUInt16LE(off + 10);
    const compressedSize = zip.readUInt32LE(off + 20);
    const uncompressedSize = zip.readUInt32LE(off + 24);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const localHeaderOffset = zip.readUInt32LE(off + 42);
    const name = zip.slice(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Lee el contenido de una entry del ZIP. Solo soporta store (0) y deflate (8).
 *
 * @param {Buffer} zip
 * @param {{ method: number, compressedSize: number, uncompressedSize: number, localHeaderOffset: number, name: string }} entry
 * @returns {Buffer}
 */
export function readZipEntry(zip, entry) {
  const LF_SIG = 0x04034b50;
  const off = entry.localHeaderOffset;
  if (zip.readUInt32LE(off) !== LF_SIG) {
    throw new Error(`Local file header signature inválido en offset ${off} (${entry.name})`);
  }
  const nameLen = zip.readUInt16LE(off + 26);
  const extraLen = zip.readUInt16LE(off + 28);
  const dataOffset = off + 30 + nameLen + extraLen;
  const compressed = zip.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) {
    return Buffer.from(compressed);
  }
  if (entry.method === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`método de compresión no soportado ${entry.method} en ${entry.name}`);
}

/**
 * Descomprime un ZIP entero a un directorio. Itera entries y para los que NO
 * sean directorios, escribe el contenido respetando la estructura interna.
 *
 * @param {Buffer} zipBuffer
 * @param {string} destDir
 * @returns {Array<{ name: string, bytes: number }>}
 */
export function extractZip(zipBuffer, destDir) {
  const entries = parseZipEntries(zipBuffer);
  const written = [];
  for (const entry of entries) {
    // Saltar directorios (terminan con `/`) o entries vacíos.
    if (entry.name.endsWith('/')) continue;
    // Path traversal guard básico.
    if (entry.name.includes('..')) {
      throw new Error(`entry con .. rechazado: ${entry.name}`);
    }
    const data = readZipEntry(zipBuffer, entry);
    const outPath = join(destDir, entry.name);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, data);
    written.push({ name: entry.name, bytes: data.length });
  }
  return written;
}

/**
 * Verifica que los paths declarados en el manifest existan en vendor dir.
 * @param {object} manifest
 * @param {string} vendorDir
 * @returns {Array<string>} lista de paths faltantes (vacío si todo OK)
 */
export function findMissingFiles(manifest, vendorDir) {
  const missing = [];
  for (const ts of manifest.tilesets || []) {
    const p = join(vendorDir, ts.src);
    if (!existsSync(p)) missing.push(ts.src);
  }
  if (manifest.characters_atlas?.src) {
    const p = join(vendorDir, manifest.characters_atlas.src);
    if (!existsSync(p)) missing.push(manifest.characters_atlas.src);
  }
  return missing;
}

// ---------- runner principal ----------

/**
 * Descarga un ZIP y retorna el Buffer + SHA256.
 * Aislada para que sea mockeable desde tests (vía import-replace o
 * inyección del fetcher).
 *
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ buffer: Buffer, sha256: string }>}
 */
export async function downloadZip(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} bajando ${url}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const sha256 = computeSHA256(buffer);
  return { buffer, sha256 };
}

/**
 * Chequea el SHA contra el manifest. Reglas:
 *   - Si manifest tiene sentinel (64 ceros) → loggear + retornar { mode: 'sentinel', sha }
 *   - Si manifest tiene SHA real y matchea → { mode: 'match', sha }
 *   - Si manifest tiene SHA real y NO matchea → throw error con instrucciones
 *
 * @param {string} expectedSha
 * @param {string} actualSha
 * @param {string} sourceUrl
 * @returns {{ mode: 'sentinel'|'match', sha: string }}
 */
export function checkSha(expectedSha, actualSha, sourceUrl) {
  if (expectedSha === SHA_SENTINEL) {
    return { mode: 'sentinel', sha: actualSha };
  }
  if (expectedSha === actualSha) {
    return { mode: 'match', sha: actualSha };
  }
  throw new Error(
    `SHA256 del ZIP descargado NO matchea el del manifest.\n` +
    `  esperado: ${expectedSha}\n` +
    `  actual:   ${actualSha}\n` +
    `  fuente:   ${sourceUrl}\n` +
    `Probable causa: Kenney rotó el ZIP en su CDN. Verifica a mano que el binario\n` +
    `nuevo sigue siendo el pack correcto y actualiza manifest.json#source_sha256.`,
  );
}

async function main() {
  console.log('[fetch_default_pack] iniciando…');
  console.log(`[fetch_default_pack] pack: ${PACK_NAME}`);
  console.log(`[fetch_default_pack] manifest: ${MANIFEST_PATH}`);

  if (!existsSync(MANIFEST_PATH)) {
    console.error(`ERROR: manifest no encontrado en ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

  // Validación previa del manifest (Ajv).
  const pre = validateManifest(manifest);
  if (!pre.valid) {
    console.error('ERROR: manifest no valida contra el schema:');
    for (const e of pre.errors) console.error(`  - ${e.message}`);
    process.exit(1);
  }

  mkdirSync(VENDOR_DIR, { recursive: true });

  // 1) ZIP principal (Roguelike Indoors).
  console.log(`[fetch_default_pack] descargando ${manifest.source_url}…`);
  const main = await downloadZip(manifest.source_url);
  console.log(`[fetch_default_pack] ZIP indoors: ${main.buffer.length} bytes, sha256=${main.sha256}`);
  const shaCheck = checkSha(manifest.source_sha256, main.sha256, manifest.source_url);
  if (shaCheck.mode === 'sentinel') {
    console.log('');
    console.log('[fetch_default_pack] AVISO: source_sha256 está en sentinel (64 ceros).');
    console.log(`[fetch_default_pack] SHA real del ZIP descargado: ${main.sha256}`);
    console.log('[fetch_default_pack] Para fijar el SHA y validar futuras descargas,');
    console.log('[fetch_default_pack] edita manifest.json y reemplaza source_sha256 con ese valor.');
    console.log('');
  }

  console.log('[fetch_default_pack] descomprimiendo indoors…');
  const writtenIndoors = extractZip(main.buffer, VENDOR_DIR);
  console.log(`[fetch_default_pack] indoors: ${writtenIndoors.length} archivos descomprimidos`);

  // 2) ZIP characters.
  console.log(`[fetch_default_pack] descargando ${CHARACTERS_ZIP_URL}…`);
  const chars = await downloadZip(CHARACTERS_ZIP_URL);
  console.log(`[fetch_default_pack] ZIP characters: ${chars.buffer.length} bytes, sha256=${chars.sha256}`);

  console.log('[fetch_default_pack] descomprimiendo characters…');
  const writtenChars = extractZip(chars.buffer, VENDOR_DIR);
  console.log(`[fetch_default_pack] characters: ${writtenChars.length} archivos descomprimidos`);

  // 3) Validar que los paths declarados en el manifest existen en vendor dir.
  const missing = findMissingFiles(manifest, VENDOR_DIR);
  if (missing.length > 0) {
    console.error('');
    console.error('ERROR: los siguientes paths del manifest no existen tras descomprimir:');
    for (const p of missing) console.error(`  - ${p}`);
    console.error('');
    console.error('Probables causas:');
    console.error('  1) Kenney cambió la estructura interna del ZIP. Revisa los paths reales');
    console.error('     en assets/vendor/' + PACK_NAME + '/ y actualiza manifest.json#tilesets/.src y');
    console.error('     manifest.json#characters_atlas.src.');
    console.error('  2) Si los archivos están bajo un subdir distinto, mueve a mano o ajusta el manifest.');
    process.exit(1);
  }

  // 4) Re-validar manifest (paranoia).
  const post = validateManifest(manifest);
  if (!post.valid) {
    console.error('ERROR: manifest no valida tras descomprimir (no debería pasar):');
    for (const e of post.errors) console.error(`  - ${e.message}`);
    process.exit(1);
  }

  // 5) Copiar manifest.json a vendor/ para que el resolver frontend lo encuentre.
  // El resolver prueba vendor/<pack>/manifest.json primero, luego packs/. Si solo existe
  // en packs/, el resolver retorna baseUrl=packs/ y los binarios (que viven en vendor/)
  // se piden a packs/ → 404. Copia idempotente del manifest cierra el gap.
  const { copyFileSync } = await import('node:fs');
  const vendorManifestPath = join(VENDOR_DIR, 'manifest.json');
  copyFileSync(MANIFEST_PATH, vendorManifestPath);
  console.log(`[fetch_default_pack] manifest copiado a vendor/: ${vendorManifestPath}`);

  // 6) Reporte final.
  console.log('');
  console.log('[fetch_default_pack] OK. Resumen:');
  console.log(`  vendor dir: ${VENDOR_DIR}`);
  for (const ts of manifest.tilesets) {
    const p = join(VENDOR_DIR, ts.src);
    console.log(`  tileset "${ts.name}": ${p}`);
  }
  if (manifest.characters_atlas?.src) {
    const p = join(VENDOR_DIR, manifest.characters_atlas.src);
    console.log(`  characters atlas: ${p}`);
  }
  console.log('');
  console.log('Próximo paso: arranca `npm run dashboard` y abre http://localhost:7777.');
}

// Si se ejecuta directo, corre el main.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(e => {
    console.error(`[fetch_default_pack] FALLO: ${e.message}`);
    process.exit(1);
  });
}
