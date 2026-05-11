// dashboard/public/engine/app.js
//
// Phaser.Game factory + integer-scale fitting al viewport.
// Spec sección 2 + ADR-01 v3.1.
//
// Decisiones clave:
//   - type: Phaser.AUTO (WebGL preferido, Canvas fallback).
//   - width: 1280, height: 720 (resolución base interna).
//   - pixelArt: true (Phaser activa antialias=false + roundPixels=true por sí).
//   - render.roundPixels: true (explícito, defensa redundante).
//   - scale.mode: Phaser.Scale.NONE + scale.zoom: <entero> calculado por fitToViewport.
//   - backgroundColor: '#0a0e1a' (matchea body en style.css).
//   - parent: 'game' (apunta al <canvas id="game"> del index.html).
//
// initGame(manifest) recibe el manifest del pack (resuelto por pack/resolver.js)
// y lo pasa a OfficeScene vía init data. Nadie más toca el manifest dentro del engine.

import Phaser from '../lib/phaser.js';
import { OfficeScene } from './scene.js';

const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;

/**
 * Crea Phaser.Game y arranca OfficeScene con el manifest del pack.
 *
 * @param {object} manifest  PackManifest validado por loader.js.
 * @returns {Promise<import('https://esm.sh/phaser@3.80.1').Game>}
 */
export async function initGame(manifest) {
  const config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    pixelArt: true,
    backgroundColor: '#0a0e1a',
    render: {
      pixelArt: true,
      roundPixels: true,
      antialias: false,
    },
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1,
    },
    // No declaramos escenas en config para evitar auto-start. Agregamos
    // OfficeScene manualmente con scene.add() para poder pasarle el manifest
    // como init data en el start().
    scene: [],
    audio: { noAudio: true },
    banner: false,
  };

  const game = new Phaser.Game(config);

  // Registramos OfficeScene y la iniciamos pasando el manifest.
  // init(data) en la escena va a recibir { manifest } como data.
  game.scene.add('office', OfficeScene, false);
  game.scene.start('office', { manifest });

  return game;
}

/**
 * Calcula el integer zoom máximo que cabe en el viewport actual y lo aplica.
 * Llamar al inicio y en cada window 'resize'.
 *
 * Idempotente — si ya está en el zoom correcto, no hace nada extra.
 *
 * @param {import('https://esm.sh/phaser@3.80.1').Game} game
 * @returns {number}  el zoom aplicado (>= 1).
 */
export function fitToViewport(game) {
  if (!game || !game.scale) return 1;
  const vw = typeof window !== 'undefined' ? window.innerWidth : BASE_WIDTH;
  const vh = typeof window !== 'undefined' ? window.innerHeight : BASE_HEIGHT;
  // Floor del ratio en cada eje, mínimo 1. Garantiza zoom entero.
  const zx = Math.max(1, Math.floor(vw / BASE_WIDTH));
  const zy = Math.max(1, Math.floor(vh / BASE_HEIGHT));
  const zoom = Math.min(zx, zy);
  // Phaser.Scale.ScaleManager.setZoom existe en 3.80.
  try {
    game.scale.setZoom(zoom);
  } catch {
    // Si la API cambia en versiones futuras, no romper el dashboard.
  }
  return zoom;
}
