import { test } from 'node:test';
import assert from 'node:assert';

const PHASER_URL = 'https://esm.sh/phaser@3.80.1';

/**
 * esm.sh sirve un wrapper ESM corto (~170 bytes) que re-exporta desde
 * /phaser@<ver>/es2022/phaser.mjs (el bundle real, ~1.2MB). El navegador
 * sigue el import automáticamente. Para medir el bundle real en Node,
 * parseamos el wrapper y descargamos la URL referida.
 */
async function fetchWrapper() {
  const res = await fetch(PHASER_URL, { redirect: 'follow' });
  return { res, text: await res.text() };
}

async function fetchRealBundle() {
  const { text } = await fetchWrapper();
  const match = text.match(/from\s+["']([^"']+phaser\.mjs)["']/);
  if (!match) throw new Error('no encontré el path al bundle real en el wrapper esm.sh');
  const bundleUrl = new URL(match[1], 'https://esm.sh/').toString();
  const res = await fetch(bundleUrl, { redirect: 'follow' });
  const body = await res.text();
  return { url: bundleUrl, status: res.status, body };
}

test('Phaser CDN URL (wrapper) responde 200', async () => {
  const { res } = await fetchWrapper();
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
});

test('Wrapper esm.sh es ESM y re-exporta phaser.mjs', async () => {
  const { text } = await fetchWrapper();
  assert.ok(text.includes('export'), 'no parece ESM');
  assert.ok(/phaser\.mjs/.test(text), 'no apunta a phaser.mjs');
});

test('Bundle real de Phaser pesa > 200KB', async () => {
  const { url, status, body } = await fetchRealBundle();
  assert.strictEqual(status, 200, `bundle ${url} respondió ${status}`);
  assert.ok(body.length > 200000, `bundle muy chico: ${body.length} bytes (${url})`);
  console.log('[phaser bundle] url:', url);
  console.log('[phaser bundle] tamaño servido:', body.length, 'bytes');
});

test('Bundle real de Phaser parece ESM válido', async () => {
  const { body } = await fetchRealBundle();
  assert.ok(body.includes('export'), 'no parece ESM');
});
