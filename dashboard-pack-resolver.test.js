// dashboard-pack-resolver.test.js
// Tests para dashboard/public/pack/resolver.js + loader.js.
// Mockeamos `fetch` para evitar red.

import { test } from 'node:test';
import assert from 'node:assert';

import { isValidPackName, resolvePack } from './dashboard/public/pack/resolver.js';
import { validateManifestMinimal, loadManifest } from './dashboard/public/pack/loader.js';

// ---------- isValidPackName ----------

test('isValidPackName acepta kenney-roguelike', () => {
  assert.strictEqual(isValidPackName('kenney-roguelike'), true);
});

test('isValidPackName acepta nombre minúsculas + dígitos', () => {
  assert.strictEqual(isValidPackName('lpc-tile-1'), true);
});

test('isValidPackName rechaza path traversal', () => {
  assert.strictEqual(isValidPackName('../../etc/passwd'), false);
});

test('isValidPackName rechaza nombre con guion bajo inicial', () => {
  assert.strictEqual(isValidPackName('_invalid'), false);
});

test('isValidPackName rechaza vacío', () => {
  assert.strictEqual(isValidPackName(''), false);
});

test('isValidPackName rechaza no-string', () => {
  assert.strictEqual(isValidPackName(null), false);
  assert.strictEqual(isValidPackName(undefined), false);
  assert.strictEqual(isValidPackName(123), false);
  assert.strictEqual(isValidPackName({}), false);
});

test('isValidPackName rechaza nombre con slash', () => {
  assert.strictEqual(isValidPackName('foo/bar'), false);
  assert.strictEqual(isValidPackName('foo\\bar'), false);
});

test('isValidPackName rechaza mayúsculas', () => {
  assert.strictEqual(isValidPackName('Kenney-Roguelike'), false);
});

// ---------- resolvePack mock ----------

function makeFetchMock(routes) {
  // routes: { 'METHOD url': { status, body } } o { url: { status, body } }
  return async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const altKey = url;
    const r = routes[key] || routes[altKey];
    if (!r) {
      return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      async json() {
        if (typeof r.body === 'string') return JSON.parse(r.body);
        return r.body || {};
      },
      async text() { return typeof r.body === 'string' ? r.body : JSON.stringify(r.body); },
    };
  };
}

test('resolvePack orden vendor → packs → error', async () => {
  // Caso 1: vendor responde 200 → ese gana
  const fetch1 = makeFetchMock({
    'HEAD /assets/vendor/kenney-roguelike/manifest.json': { status: 200, body: '' },
  });
  const r1 = await resolvePack('kenney-roguelike', { fetchImpl: fetch1, urlString: 'http://localhost/' });
  assert.strictEqual(r1.source, 'vendor');
  assert.strictEqual(r1.baseUrl, '/assets/vendor/kenney-roguelike');

  // Caso 2: vendor 404, packs 200 → packs gana
  const fetch2 = makeFetchMock({
    'HEAD /assets/vendor/kenney-roguelike/manifest.json': { status: 404 },
    'GET /assets/vendor/kenney-roguelike/manifest.json': { status: 404 },
    'HEAD /assets/packs/kenney-roguelike/manifest.json': { status: 200, body: '' },
  });
  const r2 = await resolvePack('kenney-roguelike', { fetchImpl: fetch2, urlString: 'http://localhost/' });
  assert.strictEqual(r2.source, 'packs');

  // Caso 3: ambos 404 → throw
  const fetch3 = makeFetchMock({});
  await assert.rejects(
    () => resolvePack('kenney-roguelike', { fetchImpl: fetch3, urlString: 'http://localhost/' }),
    /no encontré assets/,
  );
});

test('resolvePack con ?pack=../../../etc/passwd cae a default silencioso', async () => {
  const fetchMock = makeFetchMock({
    'HEAD /assets/packs/kenney-roguelike/manifest.json': { status: 200, body: '' },
  });
  const r = await resolvePack(undefined, {
    fetchImpl: fetchMock,
    urlString: 'http://localhost/?pack=../../etc/passwd',
  });
  // No usó el path traversal → usó default
  assert.strictEqual(r.name, 'kenney-roguelike');
  assert.strictEqual(r.source, 'packs');
});

test('resolvePack con ?pack=válido lo prefiere por sobre env y default', async () => {
  const fetchMock = makeFetchMock({
    'HEAD /assets/vendor/lpc-interior/manifest.json': { status: 200, body: '' },
    'GET /api/pack-name': { status: 200, body: { pack: 'otro' } },
  });
  const r = await resolvePack(undefined, {
    fetchImpl: fetchMock,
    urlString: 'http://localhost/?pack=lpc-interior',
  });
  assert.strictEqual(r.name, 'lpc-interior');
});

test('resolvePack sin URL override usa /api/pack-name', async () => {
  const fetchMock = makeFetchMock({
    'GET /api/pack-name': { status: 200, body: { pack: 'mi-pack' } },
    'HEAD /assets/vendor/mi-pack/manifest.json': { status: 200, body: '' },
  });
  const r = await resolvePack(undefined, { fetchImpl: fetchMock, urlString: 'http://localhost/' });
  assert.strictEqual(r.name, 'mi-pack');
});

test('resolvePack con /api/pack-name retornando nombre inválido cae a default', async () => {
  const fetchMock = makeFetchMock({
    'GET /api/pack-name': { status: 200, body: { pack: '../../bad' } },
    'HEAD /assets/packs/kenney-roguelike/manifest.json': { status: 200, body: '' },
  });
  const r = await resolvePack(undefined, { fetchImpl: fetchMock, urlString: 'http://localhost/' });
  assert.strictEqual(r.name, 'kenney-roguelike');
});

// ---------- loadManifest + validateManifestMinimal ----------

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

test('validateManifestMinimal acepta manifest bien formado', () => {
  assert.doesNotThrow(() => validateManifestMinimal(goodManifest()));
});

test('validateManifestMinimal rechaza name inválido', () => {
  const m = goodManifest();
  m.name = '../bad';
  assert.throws(() => validateManifestMinimal(m), /name inválido/);
});

test('validateManifestMinimal rechaza tilesets vacío', () => {
  const m = goodManifest();
  m.tilesets = [];
  assert.throws(() => validateManifestMinimal(m), /tilesets/);
});

test('validateManifestMinimal rechaza animations sin las 4 keys', () => {
  const m = goodManifest();
  delete m.characters_atlas.animations.idle;
  assert.throws(() => validateManifestMinimal(m), /animations\.idle/);
});

test('validateManifestMinimal rechaza frameRate no entero', () => {
  const m = goodManifest();
  m.characters_atlas.animations.idle.frameRate = 'rápido';
  assert.throws(() => validateManifestMinimal(m), /frameRate/);
});

test('loadManifest fetch+parse+valida', async () => {
  const fetchMock = makeFetchMock({
    'GET https://example/manifest.json': { status: 200, body: goodManifest() },
  });
  const m = await loadManifest('https://example/manifest.json', { fetchImpl: fetchMock });
  assert.strictEqual(m.name, 'kenney-roguelike');
});

test('loadManifest rechaza 404', async () => {
  const fetchMock = makeFetchMock({});
  await assert.rejects(
    () => loadManifest('https://example/none.json', { fetchImpl: fetchMock }),
    /HTTP 404/,
  );
});
