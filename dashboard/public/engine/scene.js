// dashboard/public/engine/scene.js
//
// OfficeScene: escena principal del dashboard. Fase 3 = piso, paredes y escritorios.
// Sin avatares (fase 4) ni animaciones efímeras (fase 5).
//
// Estrategia para fase 3:
//   1) preload(): carga el tileset indoors + el characters atlas (este último para
//      tenerlo listo cuando llegue fase 4; no se usa todavía en create()).
//   2) create(): arma una sala de oficina 1280×720 a base de:
//        - piso con un tile repetido en grilla (índice elegido por probing visual)
//        - una fila de pared en el borde superior
//        - dos filas de escritorios (8 puestos total)
//        - decoración mínima (sillas/plantas) si los índices funcionan
//
// Como Kenney NO documenta el índice de cada tile y la única forma de saberlo
// es probarlo visual, dejamos un flag SHOW_EXPLORATION_GRID que dibuja una grilla
// numerada de los primeros 144 tiles en la esquina inferior izquierda. Aldot puede
// activarlo si quiere afinar índices.
//
// FALLBACK robusto: si elegimos un índice "vacío" del tileset, igual se ve algo
// porque dibujamos los escritorios y un marco de pared usando Phaser.Graphics
// con colores planos (32×32 a scale=2). Eso garantiza que la fase 3 nunca quede
// con pantalla negra incluso si el índice elegido no es óptimo.

import Phaser from '../lib/phaser.js';
import { listSeats, seatFor } from './seating.js';
import { createAvatar, registerAvatarAnims } from './avatar.js';
import { bus } from './eventBus.js';
import { getCachedSnapshot } from './stateSync.js';

const SHOW_EXPLORATION_GRID = false;

// Vida útil de un avatar sin verse en el state. >60s sin aparecer → fade-out + destroy.
const AVATAR_TTL_MS = 60_000;
// Si una task con gate sigue running >5s sin update, el avatar pasa a 'waiting'.
const GATE_WAITING_THRESHOLD_MS = 5_000;
// Una task fallida sigue mostrándose en 'failed' por 10s. Pasado ese tiempo el
// avatar vuelve a 'idle' si no hay otra task activa.
const FAILED_HOLD_MS = 10_000;

// Índices "razonables" del tileset Kenney roguelike-indoors (36 cols × 28 rows).
// Decisión por convención: tiles de piso suelen vivir en filas 0-3 de los sets indoor.
// Si el tile no queda bien visualmente, el fallback Graphics cubre el área igual.
const TILE_FLOOR = 1;            // tile de "piso" — probable parquet o stone
const TILE_WALL_TOP = 38;        // tile de "pared horizontal" en fila 1
const TILE_DESK = 320;           // tile de "mesa/escritorio" zona media-baja del set
const TILE_CHAIR = 354;          // tile de "silla" — opcional, fallback Graphics si no se ve
const TILE_PLANT = 124;          // tile de "planta" decoración esquinas — opcional

// Constantes de layout. Tile size lógico = 16; con manifest.scale=2 cada tile
// renderizado mide 32×32 css px. Aritmética del layout va en lógicos (16) para
// no perder pixel-perfect.
const TILE_PX = 16;

export class OfficeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'office' });
    this.manifest = null;
    this.baseUrl = null;
    this.scaleFactor = 2;
  }

  init(data) {
    this.manifest = data && data.manifest ? data.manifest : null;
    if (!this.manifest) {
      // Sin manifest no podemos pintar — el preload va a fallar de cualquier forma.
      // Dejamos un log claro para el debug.
      console.error('[OfficeScene] init() sin manifest. boot.js debería haberlo pasado.');
      return;
    }
    this.baseUrl = '/assets/vendor/' + this.manifest.name;
    this.scaleFactor = this.manifest.scale || 2;
  }

  preload() {
    if (!this.manifest) return;
    const ts = this.manifest.tilesets[0];
    // Tileset indoors. Kenney tilesets tienen 1px de gap entre tiles (margin/spacing).
    // Usamos margin=0, spacing=1 — verificado en tilesheetInfo.txt del pack.
    this.load.spritesheet(`tiles:${ts.name}`, `${this.baseUrl}/${ts.src}`, {
      frameWidth: this.manifest.tile_size,
      frameHeight: this.manifest.tile_size,
      margin: 0,
      spacing: 1,
    });
    const ca = this.manifest.characters_atlas;
    // Characters atlas — precargado para fase 4. spacing tambien 1 (mismo formato Kenney).
    this.load.spritesheet('chars:atlas', `${this.baseUrl}/${ca.src}`, {
      frameWidth: ca.frame_width,
      frameHeight: ca.frame_height,
      margin: 0,
      spacing: 1,
    });
  }

  create() {
    if (!this.manifest) {
      this._renderManifestErrorBanner();
      return;
    }

    const ts = this.manifest.tilesets[0];
    const tilesetKey = `tiles:${ts.name}`;
    const renderedTile = this.manifest.tile_size * this.scaleFactor; // 16 * 2 = 32

    // Crear grupos lógicos. Estos quedan vivos para fase 4 (avatars), 5 (fx).
    this.layers = {
      bg: this.add.layer().setName('bg'),
      props: this.add.layer().setName('props'),
      avatars: this.add.layer().setName('avatars'),
      fx: this.add.layer().setName('fx'),
      debug: this.add.layer().setName('debug'),
    };

    // 1) Suelo a color sólido como base — garantiza que algo se ve incluso si los
    //    sprites del tileset tienen alfa parcial o el índice elegido es "vacío".
    const floorRect = this.add.rectangle(640, 360, 1280, 720, 0x1d2230).setOrigin(0.5);
    this.layers.bg.add(floorRect);

    // 2) Tile de piso repetido en grilla. 40 cols × 23 rows aproximadamente a scale=2.
    const colsX = Math.ceil(1280 / renderedTile);
    const rowsY = Math.ceil(720 / renderedTile);
    for (let cy = 0; cy < rowsY; cy++) {
      for (let cx = 0; cx < colsX; cx++) {
        const sp = this.add.image(cx * renderedTile, cy * renderedTile, tilesetKey, TILE_FLOOR)
          .setOrigin(0, 0)
          .setScale(this.scaleFactor);
        this.layers.bg.add(sp);
      }
    }

    // 3) Pared horizontal en la primera fila visible. Una franja arriba 32px de alto.
    for (let cx = 0; cx < colsX; cx++) {
      const sp = this.add.image(cx * renderedTile, 0, tilesetKey, TILE_WALL_TOP)
        .setOrigin(0, 0)
        .setScale(this.scaleFactor);
      this.layers.bg.add(sp);
    }

    // 4) Marco visual sólido (Graphics) sobre la franja superior. Garantiza
    //    silueta de "pared" aunque TILE_WALL_TOP no sea exactamente eso.
    const wallStripe = this.add.rectangle(640, renderedTile / 2, 1280, renderedTile, 0x394056)
      .setOrigin(0.5)
      .setAlpha(0.55);
    this.layers.bg.add(wallStripe);

    // 5) Dos filas de 4 escritorios cada una. Spacing pensado para fase 4
    //    (lugar donde van a sentarse los avatares). Las coordenadas vienen del
    //    catálogo único en seating.js para que escena y asignador no se
    //    desincronicen.
    //
    //    Layout objetivo:
    //
    //      pared ---------------------------------
    //
    //         [D] [D] [D] [D]      (fila 1 — y ~ 260)
    //
    //         [D] [D] [D] [D]      (fila 2 — y ~ 480)
    //
    this.seats = listSeats().map(s => ({ ...s })); // catálogo plano para el resto del engine
    // Cada seat.y en seating.js está corregido en `-renderedTile/2 - 4` respecto
    // del centro del escritorio. Recuperamos el centro deshaciendo ese offset.
    for (const seat of this.seats) {
      const x = seat.x;
      const deskCenterY = seat.y + renderedTile / 2 + 4; // 240 → 260, 460 → 480
      // Tile real del escritorio. Si no es óptimo, el rect debajo da el "bulto".
      const deskBg = this.add.rectangle(x, deskCenterY, renderedTile * 2, renderedTile, 0x6b4a2b)
        .setOrigin(0.5)
        .setStrokeStyle(2, 0x3a2614, 1);
      const desk = this.add.image(x, deskCenterY, tilesetKey, TILE_DESK)
        .setOrigin(0.5)
        .setScale(this.scaleFactor);
      // "Silla" detrás del escritorio (un poco más abajo).
      const chairBg = this.add.rectangle(x, deskCenterY + renderedTile, renderedTile, renderedTile, 0x2d3a5a)
        .setOrigin(0.5);
      const chair = this.add.image(x, deskCenterY + renderedTile, tilesetKey, TILE_CHAIR)
        .setOrigin(0.5)
        .setScale(this.scaleFactor);

      this.layers.props.add(deskBg);
      this.layers.props.add(desk);
      this.layers.props.add(chairBg);
      this.layers.props.add(chair);
    }

    // 6) Plantas decorativas en las esquinas inferiores. Si el índice no es planta,
    //    se ve un tile cualquiera; no rompe el layout.
    const corners = [
      { x: 64, y: 656 },
      { x: 1216, y: 656 },
    ];
    for (const c of corners) {
      const plant = this.add.image(c.x, c.y, tilesetKey, TILE_PLANT)
        .setOrigin(0.5)
        .setScale(this.scaleFactor);
      this.layers.props.add(plant);
    }

    // 7) Label sutil de "dashboard v3" abajo-derecha para confirmar que la escena cargó.
    const label = this.add.text(1270, 710, 'dashboard v3', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#6b7a99',
    }).setOrigin(1, 1);
    this.layers.debug.add(label);

    // 8) Si está activa, dibujar grid de exploración con los primeros 144 tiles
    //    en una esquina, con índice numérico encima. Útil para afinar TILE_FLOOR
    //    / TILE_WALL_TOP / TILE_DESK manualmente — aldot activa el flag, recarga,
    //    elige índices visualmente.
    if (SHOW_EXPLORATION_GRID) {
      this._drawExplorationGrid(tilesetKey);
    }

    // 9) Fase 4 — anims globales de avatar + grupo dinámico + subscripción state.
    registerAvatarAnims(this, this.manifest);
    this.avatars = new Map(); // agent name → Avatar
    this._onStateUpdateBound = this.onStateUpdate.bind(this);
    bus.addEventListener('state-update', this._onStateUpdateBound);
    // Cleanup de la subscripción cuando la escena se destruye.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._teardownStateSubscription());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this._teardownStateSubscription());

    // Race fix: si stateSync ya recibió el snapshot inicial ANTES de que la
    // escena registrara el listener, el primer 'state-update' se perdió porque
    // EventTarget no replay. Leemos el cache y procesamos manualmente.
    const cached = getCachedSnapshot();
    if (cached) {
      console.log('[OfficeScene] aplicando snapshot cacheado (race fix)');
      this.onStateUpdate({ detail: cached });
    }
  }

  _teardownStateSubscription() {
    if (this._onStateUpdateBound) {
      try { bus.removeEventListener('state-update', this._onStateUpdateBound); } catch { /* ignore */ }
      this._onStateUpdateBound = null;
    }
    if (this.avatars) {
      for (const a of this.avatars.values()) {
        try { a.destroy(); } catch { /* ignore */ }
      }
      this.avatars.clear();
    }
  }

  /**
   * Maneja un snapshot de /api/state. Crea/destruye/actualiza avatares según
   * los agentes únicos en active_tasks. Idempotente: snapshots repetidos no
   * crean duplicados.
   */
  onStateUpdate(event) {
    const snap = event && event.detail ? event.detail : null;
    if (!snap) return;
    if (!this.avatars) return; // create() todavía no corrió

    const tasks = Array.isArray(snap.active_tasks) ? snap.active_tasks : [];
    const now = Date.now();

    // Agrupar tasks por agente.
    const tasksByAgent = new Map();
    for (const t of tasks) {
      if (!t || typeof t.agent !== 'string' || !t.agent) continue;
      let arr = tasksByAgent.get(t.agent);
      if (!arr) { arr = []; tasksByAgent.set(t.agent, arr); }
      arr.push(t);
    }

    // Identificar agentes "en active_tasks". active_team está en el spec pero
    // el state.json real no lo expone — caemos al set de tasks.
    const liveAgents = new Set(tasksByAgent.keys());

    // 1) Crear avatares nuevos.
    for (const name of liveAgents) {
      if (this.avatars.has(name)) continue;
      const occupied = new Set(this.avatars.keys());
      const seat = seatFor(name, occupied);
      const agentTasks = tasksByAgent.get(name) || [];
      const role = (agentTasks[0] || {}).role_full || (agentTasks[0] || {}).agent_role || null;
      try {
        const avatar = createAvatar({ name, role, seat, scene: this });
        this.avatars.set(name, avatar);
        // Setea label inicial inmediatamente (sin esperar al próximo state update).
        if (typeof avatar.setLabel === 'function') {
          avatar.setLabel(this._deriveAvatarLabel(agentTasks));
        }
      } catch (e) {
        console.warn(`[OfficeScene] createAvatar(${name}) falló:`, e && e.message ? e.message : e);
      }
    }

    // 2) Refrescar state + halo + label + lastSeenAt para cada avatar existente.
    for (const [name, avatar] of this.avatars) {
      if (liveAgents.has(name)) {
        avatar.lastSeenAt = now;
        const agentTasks = tasksByAgent.get(name) || [];
        avatar.setState(this._deriveAvatarState(agentTasks, now));
        avatar.setHalo(this._shouldHalo(agentTasks));
        if (typeof avatar.setLabel === 'function') {
          avatar.setLabel(this._deriveAvatarLabel(agentTasks));
        }
      }
    }

    // 3) Destruir avatares ausentes >TTL (fade-out simple + destroy).
    for (const [name, avatar] of Array.from(this.avatars.entries())) {
      if (liveAgents.has(name)) continue;
      if (now - avatar.lastSeenAt > AVATAR_TTL_MS) {
        try {
          this.tweens.add({
            targets: avatar.view,
            alpha: 0,
            duration: 400,
            onComplete: () => { try { avatar.destroy(); } catch { /* ignore */ } },
          });
        } catch {
          // Sin tween, destroy inmediato.
          try { avatar.destroy(); } catch { /* ignore */ }
        }
        this.avatars.delete(name);
      }
    }
  }

  _deriveAvatarState(agentTasks, now) {
    // Prioridad: failed reciente > running > waiting > idle.
    let hasRunning = false;
    let recentFailed = false;
    let waitingByGate = false;

    for (const t of agentTasks) {
      if (!t) continue;
      const status = t.status;
      const endedAt = t.ended_at ? Date.parse(t.ended_at) : NaN;
      const startedAt = t.started_at ? Date.parse(t.started_at) : NaN;
      if (status === 'failed' && Number.isFinite(endedAt) && (now - endedAt) < FAILED_HOLD_MS) {
        recentFailed = true;
      }
      if (status === 'running') {
        hasRunning = true;
        if (t.gate && Number.isFinite(startedAt) && (now - startedAt) > GATE_WAITING_THRESHOLD_MS) {
          waitingByGate = true;
        }
      }
    }

    if (recentFailed) return 'failed';
    if (waitingByGate) return 'waiting';
    if (hasRunning) return 'working';
    return 'idle';
  }

  _shouldHalo(agentTasks) {
    for (const t of agentTasks) {
      if (!t) continue;
      if (t.review_worthy && !t.review_seen) return true;
    }
    return false;
  }

  // Fase 6 — texto a mostrar arriba del avatar.
  // Prioridad:
  //   1. Si hay tasks 'running' → summary de la más reciente (started_at).
  //      Si esa task no tiene summary → cae al title.
  //   2. Si no hay running pero hay varias tasks → "N tareas".
  //   3. Si no hay tasks → "idle".
  _deriveAvatarLabel(agentTasks) {
    if (!Array.isArray(agentTasks) || agentTasks.length === 0) return 'idle';
    const running = agentTasks.filter(t => t && t.status === 'running');
    if (running.length > 0) {
      // Más reciente por started_at; si empata, el último del array.
      let pick = running[0];
      let pickTs = Date.parse(pick.started_at || '') || 0;
      for (let i = 1; i < running.length; i++) {
        const ts = Date.parse(running[i].started_at || '') || 0;
        if (ts >= pickTs) { pick = running[i]; pickTs = ts; }
      }
      const text = (pick.summary && String(pick.summary).trim())
        || (pick.title && String(pick.title).trim())
        || '';
      return text || 'working';
    }
    if (agentTasks.length > 1) return `${agentTasks.length} tareas`;
    return 'idle';
  }

  _drawExplorationGrid(tilesetKey) {
    const cols = 12;
    const rows = 12;
    const cell = 28; // 16 base * ~1.75 zoom para que se vea
    const originX = 16;
    const originY = 16;
    // Fondo semi-transparente para legibilidad de los números.
    const bg = this.add.rectangle(
      originX - 4,
      originY - 4,
      cols * cell + 8,
      rows * cell + 16,
      0x000000,
      0.6,
    ).setOrigin(0, 0);
    this.layers.debug.add(bg);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const x = originX + c * cell;
        const y = originY + r * cell;
        const sp = this.add.image(x, y, tilesetKey, idx)
          .setOrigin(0, 0)
          .setScale(1.5);
        const t = this.add.text(x, y + cell - 8, String(idx), {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#ffe000',
        }).setOrigin(0, 0);
        this.layers.debug.add(sp);
        this.layers.debug.add(t);
      }
    }
  }

  _renderManifestErrorBanner() {
    this.add.rectangle(640, 360, 1280, 720, 0x2a0e0e);
    this.add.text(640, 360, 'OfficeScene: manifest faltante', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#f87171',
    }).setOrigin(0.5);
  }
}
