// scripts/cockpit_visual_check.js
// Prueba el cockpit en un navegador real, de punta a punta: láminas, slider, teclado,
// swipe, votos guardados, "Ver más", elegir con un clic, ayuda, revisiones viejas,
// consola sin errores y sin scroll horizontal, en escritorio y celular.
//
// Uso: npm run cockpit:check  (usa datos de prueba en una carpeta temporal; no toca nada tuyo)
// Necesita Playwright una vez: npm install --no-save playwright-core
// No corre en `npm test` porque requiere navegador. Idioma: español neutro.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultLauncher, encodePNG, INSTALL_HINT } from './bold_rounds.js';
import { publishReview } from '../src/cockpit.js';
import { startCockpit } from '../cockpit/server.js';

let passed = 0;
const fails = [];
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); passed += 1; }
  catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); fails.push(label); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

function solidPNG(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
  return encodePNG(w, h, buf);
}

const root = mkdtempSync(join(tmpdir(), 'cockpit-check-'));
mkdirSync(join(root, 'media'), { recursive: true });
writeFileSync(join(root, 'media', 'antes.png'), solidPNG(640, 1200, [40, 90, 200]));
writeFileSync(join(root, 'media', 'despues.png'), solidPNG(640, 1200, [220, 90, 40]));
writeFileSync(join(root, 'media', 'a.png'), solidPNG(640, 400, [30, 160, 90]));
writeFileSync(join(root, 'media', 'b.png'), solidPNG(640, 400, [160, 30, 120]));

publishReview({
  id: 'visual',
  title: 'Revisión visual de prueba',
  kind: 'rounds',
  items: [
    {
      id: 'slider', title: 'Slider', headline: 'Mira el antes y después', body_md: 'Detalle **oculto** detrás de Ver más.',
      visual: { type: 'before_after', before: 'media/antes.png', after: 'media/despues.png', hotspots: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.2, label: 'Titular nuevo' }] },
      stats: [{ value: '42%', label: 'cambió' }],
    },
    { id: 'plano', title: 'Diagrama', headline: 'Tres pasos', visual: { type: 'diagram', kind: 'flow', steps: [{ label: 'Uno' }, { label: 'Dos' }, { label: 'Tres' }] } },
    {
      id: 'elegir', title: 'Elegir', headline: '¿Cuál prefieres?', ask: 'Elige una',
      visual: { type: 'compare', options: [{ id: 'a', label: 'Opción A', image: 'media/a.png', item: 'slider' }, { id: 'b', label: 'Opción B', image: 'media/b.png', item: 'integrar' }] },
    },
  ],
}, root, { silencioso: true });

// Revisión con el contrato viejo: solo title + body_md + media.
publishReview({
  id: 'vieja',
  title: 'Revisión con formato antiguo',
  kind: 'other',
  items: [
    { id: 'texto', title: 'Solo texto', body_md: 'Un texto antiguo con **negritas** que debe seguir viéndose.' },
    { id: 'foto', title: 'Solo imagen', media: ['media/a.png'] },
  ],
}, root, { silencioso: true });

const browser = await defaultLauncher();
if (!browser) {
  console.log(INSTALL_HINT);
  rmSync(root, { recursive: true, force: true });
  process.exit(3);
}

// Transcripciones de juguete para la página de uso: nunca se leen las reales.
const usoDir = join(root, '.transcripciones');
const slugRoot = root.replace(/[^a-zA-Z0-9]/g, '-');
mkdirSync(join(usoDir, slugRoot), { recursive: true });
writeFileSync(join(usoDir, slugRoot, 'sesion-prueba.jsonl'), [
  JSON.stringify({ type: 'user', cwd: root, timestamp: '2026-10-30T10:00:00Z', message: { role: 'user', content: 'hola' } }),
  JSON.stringify({ type: 'assistant', cwd: root, timestamp: '2026-10-30T10:00:01Z', message: { id: 'm1', model: 'claude-prueba', content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'council' } }], usage: { input_tokens: 10, cache_creation_input_tokens: 40000, cache_read_input_tokens: 90000, output_tokens: 700 } } }),
].join('\n') + '\n');

const { server, port } = await startCockpit({ root, port: 0, host: '127.0.0.1', env: {}, pollMs: 200, usoDir });
const base = `http://localhost:${port}`;
const VIEWPORTS = {
  escritorio: { viewport: { width: 1440, height: 900 } },
  celular: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const feedbackFile = id => join(root, 'cockpit', 'feedback', `${id}.json`);
const readFeedback = id => (existsSync(feedbackFile(id)) ? JSON.parse(readFileSync(feedbackFile(id), 'utf8')) : null);
const visibleSlide = page => page.locator('.slide:not([hidden])');

try {
  for (const [name, opts] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    rmSync(join(root, 'cockpit', 'feedback'), { recursive: true, force: true });

    await check(`${name}: la revisión abre en láminas, sin el texto a la vista`, async () => {
      await page.goto(`${base}/#/r/visual`);
      await page.waitForSelector('.slide:not([hidden]) .ba-frame');
      assert(await visibleSlide(page).locator('.headline').innerText() === 'Mira el antes y después', 'titular');
      assert(!(await page.locator('body').innerText()).includes('oculto'), 'body_md visible por defecto');
    });

    await check(`${name}: "Ver más" muestra y oculta el detalle`, async () => {
      await page.click('#btn-more');
      assert(await page.locator('#more-body').innerText().then(t => t.includes('oculto')), 'no apareció el detalle');
      await page.click('#more-close');
      assert(await page.locator('#more-sheet').isHidden(), 'no se cerró');
    });

    await check(`${name}: el slider se mueve al arrastrar`, async () => {
      const frame = page.locator('.ba-frame');
      const box = await frame.boundingBox();
      assert(box && box.width > 200 && box.height > 100, `marco muy chico: ${JSON.stringify(box)}`);
      const pos = () => frame.evaluate(f => parseFloat(f.style.getPropertyValue('--pos')));
      const start = await pos();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5, { steps: 4 });
      await page.mouse.up();
      const end = await pos();
      assert(Math.abs(end - 85) < 3 && end !== start, `posición ${start} → ${end}`);
    });

    await check(`${name}: una pastilla lleva a su zona marcada`, async () => {
      await page.click('.hs-chip');
      const pos = await page.locator('.ba-frame').evaluate(f => parseFloat(f.style.getPropertyValue('--pos')));
      assert(pos < 10, `el slider quedó en ${pos}`);
    });

    await check(`${name}: votar se guarda solo en cockpit/feedback`, async () => {
      await page.click('#vote-down');
      await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('guardado'));
      assert(readFeedback('visual').items.slider.vote === 'down', 'voto no guardado');
      assert(readFeedback('visual').processed === false, 'debe quedar pendiente');
    });

    await check(`${name}: comentar se guarda solo`, async () => {
      await page.click('#btn-comment');
      await page.fill('#comment-input', 'Más grande');
      await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('guardado'));
      await page.waitForTimeout(700);
      assert(readFeedback('visual').items.slider.comment === 'Más grande', 'comentario no guardado');
      await page.click('#btn-comment');
    });

    await check(`${name}: flechas del teclado cambian de lámina`, async () => {
      await page.locator('.headline').first().click();
      await page.keyboard.press('ArrowRight');
      assert(await visibleSlide(page).locator('.headline').innerText() === 'Tres pasos', 'no avanzó');
      assert(await visibleSlide(page).locator('svg.dg text').count() > 0, 'diagrama sin dibujar');
      await page.keyboard.press('ArrowLeft');
      assert(await visibleSlide(page).locator('.headline').innerText() === 'Mira el antes y después', 'no retrocedió');
      await page.keyboard.press('ArrowRight');
    });

    if (opts.hasTouch) {
      await check(`${name}: deslizar con el dedo cambia de lámina`, async () => {
        const cdp = await ctx.newCDPSession(page);
        const swipe = async (x0, x1, y) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
          for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 5, y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await swipe(340, 60, 120);
        await page.waitForTimeout(150);
        assert(await visibleSlide(page).locator('.headline').innerText() === '¿Cuál prefieres?', 'no avanzó');
        await swipe(60, 340, 120);
        await page.waitForTimeout(150);
        assert(await visibleSlide(page).locator('.headline').innerText() === 'Tres pasos', 'no retrocedió');
        await page.keyboard.press('ArrowRight');
      });
    } else {
      await page.keyboard.press('ArrowRight');
    }

    await check(`${name}: elegir con un clic vota la opción y limpia la otra`, async () => {
      assert(await visibleSlide(page).locator('.headline').innerText() === '¿Cuál prefieres?', 'lámina equivocada');
      await page.click('.cmp-card[data-option="b"]');
      await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('guardado'));
      await page.waitForTimeout(700);
      assert(readFeedback('visual').items.integrar.vote === 'up', 'no votó la opción');
      await page.click('.cmp-card[data-option="a"]');
      await page.waitForTimeout(800);
      const fb = readFeedback('visual');
      assert(fb.items.slider.vote === 'up' && fb.items.integrar.vote === null, JSON.stringify(fb.items));
      assert(await page.locator('.cmp-card[data-option="a"].cmp-on').count() === 1, 'sin marca visual');
    });

    await check(`${name}: la lámina final resume los votos`, async () => {
      await page.keyboard.press('End');
      const text = await visibleSlide(page).locator('.headline').innerText();
      assert(/votadas/.test(text), text);
    });

    await check(`${name}: el panel de conversación abre sin errores (sin micrófono)`, async () => {
      await page.click('#btn-talk');
      assert(await page.locator('#talk').isVisible(), 'panel oculto');
      await page.click('#talk-close');
    });

    await check(`${name}: una revisión vieja se sigue viendo`, async () => {
      await page.goto(`${base}/#/r/vieja`);
      await page.waitForFunction(() => document.querySelector('.slide:not([hidden]) .headline')?.textContent === 'Solo texto');
      assert((await visibleSlide(page).innerText()).includes('negritas'), 'sin texto');
      await page.keyboard.press('ArrowRight');
      assert(await visibleSlide(page).locator('img').count() === 1, 'sin imagen');
    });

    await check(`${name}: inicio con miniaturas y ayuda siempre a mano`, async () => {
      await page.goto(`${base}/#/`);
      await page.waitForSelector('.thumb');
      assert(await page.locator('.thumb').count() === 2, 'miniaturas');
      await page.click('#btn-help');
      await page.waitForSelector('.help-card');
      const text = await page.locator('#view-help').innerText();
      for (const t of ['Rediseño por rondas', 'Council de expertos', 'Arma tú el panel de expertos', 'kickoff', 'Astra', 'video', 'importar-modulo']) assert(text.includes(t), `falta ${t}`);
      assert(await page.locator('.help-card svg.dg').count() >= 6, 'tarjetas sin diagrama');
    });

    await check(`${name}: la página de uso se abre desde el botón y muestra números y barras`, async () => {
      await page.goto(`${base}/#/`);
      await page.click('#btn-uso');
      await page.waitForSelector('.uso-tile');
      assert((await page.locator('#uso-title').innerText()).includes('131 K'), 'total');
      assert(await page.locator('.uso-bar-svg').count() >= 2, 'sin barras');
      assert(await page.locator('.uso-chip').count() >= 1, 'sin nunca usados');
      await page.click('#uso-tab-todos');
      await page.waitForFunction(() => document.getElementById('uso-tab-todos').getAttribute('aria-pressed') === 'true');
      await page.click('#uso-tab-proyecto');
      await page.waitForSelector('.uso-tile');
    });

    await check(`${name}: sin scroll horizontal`, async () => {
      for (const route of ['#/', '#/ayuda', '#/uso', '#/r/visual/1', '#/r/visual/2', '#/r/visual/3', '#/r/visual/4']) {
        await page.goto(`${base}/${route}`);
        await page.waitForTimeout(150);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(over <= 1, `${route} se desborda ${over}px`);
      }
    });

    await check(`${name}: consola sin errores`, async () => {
      assert(!errors.length, errors.join(' | '));
    });
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} PASS, ${fails.length} FAIL`);
process.exit(fails.length ? 1 : 0);
