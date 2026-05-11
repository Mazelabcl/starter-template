// dashboard-fetch-pack.test.js
// Tests para scripts/fetch_default_pack.js — sin red, todo mockeado.

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

import {
  computeSHA256,
  validateManifest,
  parseZipEntries,
  readZipEntry,
  extractZip,
  findMissingFiles,
  downloadZip,
  checkSha,
} from './scripts/fetch_default_pack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- computeSHA256 ----------

test('computeSHA256 retorna SHA conocido', () => {
  // SHA256 de "hello world\n" (con newline) NO; usamos el de "abc" canónico.
  const sha = computeSHA256(Buffer.from('abc'));
  assert.strictEqual(sha, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('computeSHA256 retorna 64 hex chars siempre', () => {
  const sha = computeSHA256(Buffer.from([0x01, 0x02, 0x03]));
  assert.match(sha, /^[a-f0-9]{64}$/);
});

// ---------- validateManifest ----------

function goodManifest() {
  return {
    name: 'kenney-roguelike',
    version: '1.0.0',
    license: 'CC0-1.0',
    attribution: 'Kenney',
    tile_size: 16,
    scale: 2,
    tilesets: [{ name: 'indoors', src: 'tiles/x.png' }],
    characters_atlas: {
      src: 'characters/y.png',
      frame_width: 16,
      frame_height: 16,
      animations: {
        idle:    { frames: [0], frameRate: 4, repeat: -1 },
        working: { frames: [0, 1, 2, 3], frameRate: 8, repeat: -1 },
        waiting: { frames: [0], frameRate: 2, repeat: -1 },
        failed:  { frames: [0], frameRate: 2, repeat: -1 },
      },
    },
  };
}

test('validateManifest acepta manifest válido', () => {
  const r = validateManifest(goodManifest());
  assert.strictEqual(r.valid, true);
});

test('validateManifest rechaza si falta un campo requerido', () => {
  const m = goodManifest();
  delete m.tile_size;
  const r = validateManifest(m);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.length > 0);
});

test('validateManifest rechaza nombre con path traversal', () => {
  const m = goodManifest();
  m.name = '../bad';
  const r = validateManifest(m);
  assert.strictEqual(r.valid, false);
});

test('validateManifest acepta manifest real del repo', () => {
  const manifestPath = join(__dirname, 'assets', 'packs', 'kenney-roguelike', 'manifest.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const r = validateManifest(m);
  assert.strictEqual(r.valid, true, `errors: ${JSON.stringify(r.errors)}`);
});

// ---------- checkSha ----------

test('checkSha con sentinel reporta mode "sentinel"', () => {
  const sentinel = '0'.repeat(64);
  const actual = 'a'.repeat(64);
  const r = checkSha(sentinel, actual, 'http://x');
  assert.strictEqual(r.mode, 'sentinel');
  assert.strictEqual(r.sha, actual);
});

test('checkSha con SHA fijo y match reporta mode "match"', () => {
  const sha = '0123456789abcdef'.repeat(4);
  const r = checkSha(sha, sha, 'http://x');
  assert.strictEqual(r.mode, 'match');
});

test('checkSha con SHA mismatch lanza error con instrucciones', () => {
  const expected = '0123456789abcdef'.repeat(4);
  const actual   = 'fedcba9876543210'.repeat(4);
  assert.throws(
    () => checkSha(expected, actual, 'http://x.zip'),
    /SHA256.*NO matchea/,
  );
});

// ---------- ZIP parser ----------
// Construimos un ZIP minimalista (1 archivo "hello.txt" → "hi") y verificamos
// que parseZipEntries + readZipEntry lo descomprimen. Cubre method=0 (store).

function buildMinimalZip(filename, content, method = 0) {
  const nameBuf = Buffer.from(filename, 'utf8');
  let payload, compressedLen, uncompressedLen, crc32;
  // CRC32 calculation
  const crc = createHash; // placeholder; we won't actually verify CRC in our parser
  // Compute real CRC32 with a small impl.
  function computeCrc32(buf) {
    let table;
    if (!buildMinimalZip._crcTable) {
      table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
      }
      buildMinimalZip._crcTable = table;
    } else {
      table = buildMinimalZip._crcTable;
    }
    let crcv = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crcv = (table[(crcv ^ buf[i]) & 0xff] ^ (crcv >>> 8)) >>> 0;
    }
    return (crcv ^ 0xffffffff) >>> 0;
  }
  const contentBuf = Buffer.from(content, 'utf8');
  crc32 = computeCrc32(contentBuf);
  uncompressedLen = contentBuf.length;
  if (method === 0) {
    payload = contentBuf;
  } else if (method === 8) {
    payload = deflateRawSync(contentBuf);
  } else {
    throw new Error('test no soporta method ' + method);
  }
  compressedLen = payload.length;

  // Local file header
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);    // version needed
  lfh.writeUInt16LE(0, 6);     // general purpose
  lfh.writeUInt16LE(method, 8);
  lfh.writeUInt16LE(0, 10);    // mod time
  lfh.writeUInt16LE(0, 12);    // mod date
  lfh.writeUInt32LE(crc32, 14);
  lfh.writeUInt32LE(compressedLen, 18);
  lfh.writeUInt32LE(uncompressedLen, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);    // extra len
  nameBuf.copy(lfh, 30);
  const localBlock = Buffer.concat([lfh, payload]);

  // Central directory entry
  const cd = Buffer.alloc(46 + nameBuf.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);     // version made by
  cd.writeUInt16LE(20, 6);     // version needed
  cd.writeUInt16LE(0, 8);      // gp
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc32, 16);
  cd.writeUInt32LE(compressedLen, 20);
  cd.writeUInt32LE(uncompressedLen, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);     // extra
  cd.writeUInt16LE(0, 32);     // comment
  cd.writeUInt16LE(0, 34);     // disk number
  cd.writeUInt16LE(0, 36);     // internal attrs
  cd.writeUInt32LE(0, 38);     // external attrs
  cd.writeUInt32LE(0, 42);     // local header offset
  nameBuf.copy(cd, 46);

  const cdOffset = localBlock.length;
  const cdSize = cd.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);    // disk
  eocd.writeUInt16LE(0, 6);    // start disk
  eocd.writeUInt16LE(1, 8);    // entries this disk
  eocd.writeUInt16LE(1, 10);   // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);   // comment length

  return Buffer.concat([localBlock, cd, eocd]);
}

test('parseZipEntries lee un ZIP store mínimo', () => {
  const zip = buildMinimalZip('hello.txt', 'hi');
  const entries = parseZipEntries(zip);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].name, 'hello.txt');
  assert.strictEqual(entries[0].method, 0);
  assert.strictEqual(entries[0].uncompressedSize, 2);
});

test('readZipEntry descomprime store (method=0)', () => {
  const zip = buildMinimalZip('hello.txt', 'hi', 0);
  const entries = parseZipEntries(zip);
  const data = readZipEntry(zip, entries[0]);
  assert.strictEqual(data.toString('utf8'), 'hi');
});

test('readZipEntry descomprime deflate (method=8)', () => {
  // contenido suficientemente largo para que deflate sea legible
  const content = 'a'.repeat(100) + 'b'.repeat(100);
  const zip = buildMinimalZip('big.txt', content, 8);
  const entries = parseZipEntries(zip);
  const data = readZipEntry(zip, entries[0]);
  assert.strictEqual(data.toString('utf8'), content);
});

test('extractZip escribe los archivos a disco', () => {
  const tmp = join(tmpdir(), `fetch-pack-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const zip = buildMinimalZip('tiles/foo.png', 'fake-png-bytes', 0);
    const written = extractZip(zip, tmp);
    assert.strictEqual(written.length, 1);
    const out = readFileSync(join(tmp, 'tiles', 'foo.png'), 'utf8');
    assert.strictEqual(out, 'fake-png-bytes');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- findMissingFiles ----------

test('findMissingFiles detecta archivos faltantes', () => {
  const tmp = join(tmpdir(), `fp-missing-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const manifest = goodManifest();
    const missing = findMissingFiles(manifest, tmp);
    assert.deepStrictEqual(missing.sort(), ['characters/y.png', 'tiles/x.png'].sort());
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('findMissingFiles retorna vacío cuando los archivos existen', () => {
  const tmp = join(tmpdir(), `fp-present-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    mkdirSync(join(tmp, 'tiles'), { recursive: true });
    mkdirSync(join(tmp, 'characters'), { recursive: true });
    writeFileSync(join(tmp, 'tiles', 'x.png'), 'x');
    writeFileSync(join(tmp, 'characters', 'y.png'), 'y');
    const missing = findMissingFiles(goodManifest(), tmp);
    assert.deepStrictEqual(missing, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- downloadZip con fetch mock ----------

test('downloadZip con mock fetch retorna buffer + sha', async () => {
  const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]);
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    async arrayBuffer() {
      return fakeZip.buffer.slice(fakeZip.byteOffset, fakeZip.byteOffset + fakeZip.byteLength);
    },
  });
  const r = await downloadZip('http://example/x.zip', mockFetch);
  assert.strictEqual(r.buffer.length, fakeZip.length);
  assert.strictEqual(r.sha256, computeSHA256(fakeZip));
});

test('downloadZip rechaza HTTP no-ok', async () => {
  const mockFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    () => downloadZip('http://example/x.zip', mockFetch),
    /HTTP 503/,
  );
});
