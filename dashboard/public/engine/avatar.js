// dashboard/public/engine/avatar.js
//
// Wrapper Phaser.GameObjects.Container con state machine de 4 estados.
// Spec sección 2 + sección 6.
//
// El sprite usa el atlas `chars:atlas` (cargado por OfficeScene.preload()) y
// las anims globales `avatar:<state>` (registradas una vez en
// OfficeScene.create() vía registerAvatarAnims() abajo). Si una anim no está
// registrada (manifest incompleto, state desconocido), setState() hace skip
// silencioso con console.debug — nunca crashea.
//
// El container es interactivo: emite 'avatar-clicked' por el bus global en
// pointerdown. El handler real del panel lo agrega ui/panel.js en fase 6.

import Phaser from '../lib/phaser.js';
import { bus } from './eventBus.js';

/** @typedef {'idle'|'working'|'waiting'|'failed'} AvatarState */
const VALID_STATES = new Set(['idle', 'working', 'waiting', 'failed']);

const SCALE = 2;            // matchea OfficeScene.scaleFactor
const HITBOX_SIZE = 32;     // 16 frame × scale=2 = 32 px lógicos de click area

// Fase 6 — etiqueta flotante sobre el avatar con el summary de la task activa.
// Trunco a ~6 palabras o 35 chars (lo que sea más corto) + ellipsis. La etiqueta
// vive como un Text fuera del container (en coords absolutas de la escena) para
// que no se vea afectada por setScale(2) del container — queremos texto a 1×.
const LABEL_MAX_CHARS = 35;
const LABEL_MAX_WORDS = 6;
const LABEL_Y_OFFSET = -24;   // px sobre el centro del seat

export function truncateLabel(text) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const trimmed = text.trim();
  // Por palabras.
  const words = trimmed.split(/\s+/);
  let candidate = trimmed;
  if (words.length > LABEL_MAX_WORDS) {
    candidate = words.slice(0, LABEL_MAX_WORDS).join(' ') + '…';
  }
  // Por chars (después de la corta por palabras).
  if (candidate.length > LABEL_MAX_CHARS) {
    candidate = candidate.slice(0, LABEL_MAX_CHARS - 1).trimEnd() + '…';
  }
  return candidate;
}

/**
 * Registra las 4 anims globales `avatar:<state>` en la escena. Llamar UNA VEZ
 * en OfficeScene.create(). Idempotente: si las anims ya existen las skipea.
 *
 * @param {Phaser.Scene} scene
 * @param {object} manifest  Pack manifest con characters_atlas.animations.
 */
export function registerAvatarAnims(scene, manifest) {
  if (!scene || !manifest || !manifest.characters_atlas || !manifest.characters_atlas.animations) {
    console.warn('[avatar] registerAvatarAnims: manifest sin characters_atlas.animations; skip.');
    return;
  }
  const anims = manifest.characters_atlas.animations;
  for (const [state, def] of Object.entries(anims)) {
    const key = 'avatar:' + state;
    if (scene.anims.exists(key)) continue;
    try {
      scene.anims.create({
        key,
        frames: def.frames.map(f => ({ key: 'chars:atlas', frame: f })),
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    } catch (e) {
      console.warn(`[avatar] no pude registrar anim ${key}: ${e && e.message ? e.message : e}`);
    }
  }
}

/**
 * Crea un Avatar.
 *
 * @param {{ name: string, role?: string, seat: {x:number,y:number,isOverflow?:boolean}, scene: Phaser.Scene }} cfg
 * @returns {{
 *   name: string,
 *   view: Phaser.GameObjects.Container,
 *   sprite: Phaser.GameObjects.Sprite,
 *   setState: (s: string) => void,
 *   getState: () => string,
 *   setHalo: (on: boolean) => void,
 *   destroy: () => void,
 *   lastSeenAt: number,
 * }}
 */
export function createAvatar(cfg) {
  const { name, role, seat, scene } = cfg;
  if (!scene) throw new Error('[avatar] createAvatar: falta scene');
  if (!seat) throw new Error('[avatar] createAvatar: falta seat');

  const x = seat.x;
  const y = seat.y;

  // Halo: graphics circular amarillo oculto por default. Cuando setHalo(true),
  // arranca un Tween alpha 0.3 ↔ 1 loop. Cuando setHalo(false), para y oculta.
  const halo = scene.add.graphics();
  halo.fillStyle(0xffe34d, 0.55);
  halo.fillCircle(0, 8, 18); // levemente abajo del centro para "encerrar" al sprite
  halo.lineStyle(2, 0xffe34d, 1);
  halo.strokeCircle(0, 8, 18);
  halo.setVisible(false);
  halo.setAlpha(0);

  // Sprite con el primer frame del atlas. La anim 'avatar:idle' se reproduce
  // explícito tras setState('idle') más abajo.
  const sprite = scene.add.sprite(0, 0, 'chars:atlas', 0);
  sprite.setOrigin(0.5, 0.5);

  // Container que agrupa halo + sprite. Posicionado en seat.x, seat.y con
  // scale=2 igual al resto de la escena.
  const view = scene.add.container(x, y, [halo, sprite]);
  view.setScale(SCALE);

  // Si es overflow, le aplicamos un tinte sutil para indicarlo visualmente.
  // El tinte va al sprite, no al container (los containers no soportan tint).
  if (seat.isOverflow) {
    sprite.setTint(0xc0c0c0);
  }

  // Tag para que el grupo de avatars de la escena pueda iterar y encontrarlos.
  view.setName('avatar:' + name);
  // Data útil para debug por pointer.
  view.setData('avatarName', name);
  if (role) view.setData('avatarRole', role);

  // Hitbox + interactividad. setSize define el rect del container; setInteractive
  // sin args usa ese rect. Esto es necesario porque containers no infieren
  // hitbox del contenido automáticamente.
  view.setSize(HITBOX_SIZE, HITBOX_SIZE);
  view.setInteractive({ useHandCursor: true });
  view.on('pointerdown', () => {
    try {
      bus.dispatchEvent(new CustomEvent('avatar-clicked', { detail: { name } }));
    } catch (e) {
      console.debug('[avatar] dispatch avatar-clicked falló:', e && e.message ? e.message : e);
    }
  });

  // Fase 6 — Text label flotante sobre el avatar. Vive como GameObject independiente
  // (no dentro del container) para que la fuente NO se escale 2× junto al sprite.
  // Posición = (seat.x, seat.y + LABEL_Y_OFFSET). Style monospace 10px blanco con
  // stroke negro 2px para legibilidad sobre cualquier color de fondo.
  let label = null;
  try {
    label = scene.add.text(x, y + LABEL_Y_OFFSET, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
      resolution: 2,
    });
    label.setOrigin(0.5, 1);
    label.setDepth(1000); // sobre todo el resto de la escena
  } catch (e) {
    console.debug(`[avatar:${name}] no pude crear label:`, e && e.message ? e.message : e);
    label = null;
  }

  // State interno + halo tween handle.
  let currentState = 'idle';
  let haloTween = null;

  const api = {
    name,
    view,
    sprite,
    label,
    lastSeenAt: Date.now(),

    setLabel(text) {
      if (!label) return;
      try {
        label.setText(truncateLabel(text));
      } catch (e) {
        console.debug(`[avatar:${name}] setLabel falló:`, e && e.message ? e.message : e);
      }
    },

    setState(s) {
      if (!VALID_STATES.has(s)) {
        console.debug(`[avatar:${name}] estado desconocido "${s}", skip play()`);
        return;
      }
      if (s === currentState && sprite.anims && sprite.anims.isPlaying) {
        return; // ya está reproduciendo ese estado
      }
      currentState = s;
      const key = 'avatar:' + s;
      try {
        if (!scene.anims || !scene.anims.exists(key)) {
          console.debug(`[avatar:${name}] anim "${key}" no registrada, skip play()`);
          return;
        }
        sprite.play(key);
      } catch (e) {
        // Phaser puede tirar si la anim no existe o el sprite ya fue destruido.
        console.debug(`[avatar:${name}] play(${key}) falló:`, e && e.message ? e.message : e);
      }
    },

    getState() {
      return currentState;
    },

    setHalo(on) {
      if (on) {
        if (halo.visible) return; // ya está activo
        halo.setVisible(true);
        // Tween loop alpha 0.5 ↔ 1.
        try {
          haloTween = scene.tweens.add({
            targets: halo,
            alpha: { from: 0.5, to: 1 },
            duration: 700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        } catch (e) {
          // Sin tween, igual queda visible (alpha 1).
          halo.setAlpha(1);
        }
      } else {
        if (haloTween) {
          try { haloTween.stop(); } catch { /* ignore */ }
          haloTween = null;
        }
        halo.setVisible(false);
        halo.setAlpha(0);
      }
    },

    destroy() {
      try {
        if (haloTween) { haloTween.stop(); haloTween = null; }
      } catch { /* ignore */ }
      try { view.destroy(); } catch { /* ignore */ }
      try { if (label) { label.destroy(); label = null; } } catch { /* ignore */ }
    },
  };

  // Arranca en idle. Si la anim no está registrada el debug warn ya cubre.
  api.setState('idle');

  return api;
}
