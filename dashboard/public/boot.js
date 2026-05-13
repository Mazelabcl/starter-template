// dashboard/public/boot.js
//
// Entry point del frontend v3. Llamado por index.html con type="module".
// Orden: resolvePack → loadManifest → initGame → fitToViewport.
// Fase 3: hasta acá llega el flujo. mountUI / connectState entran en fases 5-6.

import { resolvePack } from './pack/resolver.js';
import { loadManifest } from './pack/loader.js';
import { initGame, fitToViewport } from './engine/app.js';
import { startStateSync } from './engine/stateSync.js';
import { bus } from './engine/eventBus.js';
import { createSidePanel } from './ui/panel.js';

const loading = document.getElementById('loading');

function showError(err) {
  if (!loading) return;
  loading.innerHTML = ''; // limpia "Cargando…"
  const wrap = document.createElement('div');
  wrap.style.color = '#f87171';
  wrap.style.fontFamily = 'monospace';
  wrap.style.padding = '20px';
  wrap.style.maxWidth = '720px';
  wrap.style.lineHeight = '1.5';
  // SECURITY: usamos textContent + nodos del DOM, nunca innerHTML con datos
  // (la regla XSS de ADR-02 aplica a panel.js pero la respetamos acá también).
  const h = document.createElement('strong');
  h.textContent = 'Error al iniciar el dashboard';
  wrap.appendChild(h);
  wrap.appendChild(document.createElement('br'));
  wrap.appendChild(document.createElement('br'));
  const msg = document.createElement('span');
  msg.textContent = err && err.message ? err.message : String(err);
  wrap.appendChild(msg);
  wrap.appendChild(document.createElement('br'));
  wrap.appendChild(document.createElement('br'));
  const hint = document.createElement('small');
  hint.style.color = '#9ca3af';
  hint.textContent = 'Si dice "no encontré assets", corre `npm run dashboard:assets`.';
  wrap.appendChild(hint);
  loading.appendChild(wrap);
  loading.style.display = 'block';
}

try {
  loading.textContent = 'Resolviendo pack…';
  const pack = await resolvePack();

  loading.textContent = 'Cargando manifest…';
  const manifest = await loadManifest(pack.manifestUrl);

  loading.textContent = 'Iniciando Phaser…';
  const game = await initGame(manifest);
  fitToViewport(game);
  window.addEventListener('resize', () => fitToViewport(game));

  // Esperamos un frame para que el renderer.type ya esté seteado (WebGL=1, Canvas=2).
  game.events.once('ready', () => {
    const rendererName = game.renderer && game.renderer.type === 1 ? 'WebGL' : 'Canvas';
    console.log(`[dashboard v3] booted. renderer: ${rendererName}, pack: ${pack.name}`);
  });

  // Fase 4 — state sync (GET /api/state + SSE /api/events).
  // El handle queda en window para inspección manual desde DevTools y para que
  // tests futuros puedan disconnect() sin tener que importar el módulo entero.
  const sync = startStateSync();
  window.__dashboardSync = sync;
  console.log('[dashboard v3] state sync iniciado');

  // Fase 6 — side panel rico + botón Sprint en topbar.
  // El panel suscribe 'avatar-clicked' y 'open-sprint' del bus internamente.
  const panel = createSidePanel();
  panel.mount();
  window.__dashboardPanel = panel;
  const sprintBtn = document.getElementById('sprint-toggle');
  if (sprintBtn) {
    sprintBtn.addEventListener('click', () => {
      bus.dispatchEvent(new CustomEvent('open-sprint'));
    });
  }
  const roadmapBtn = document.getElementById('roadmap-toggle');
  if (roadmapBtn) {
    roadmapBtn.addEventListener('click', () => {
      bus.dispatchEvent(new CustomEvent('open-roadmap'));
    });
  }
  const chatBtn = document.getElementById('chat-toggle');
  if (chatBtn) {
    chatBtn.addEventListener('click', () => {
      bus.dispatchEvent(new CustomEvent('open-chat'));
    });
  }
  console.log('[dashboard v3] side panel montado');

  loading.style.display = 'none';
} catch (err) {
  console.error('[dashboard v3] boot failed:', err);
  showError(err);
}
