# Dashboard v3 — Arquitectura

**Producido por:** architect (Plan agent) en pipeline-v2 manual
**Fecha:** 2026-05-10
**Estado:** Critic PASS-WITH-FIXES + Cold-reader GO. **7 fixes aplicados (todos). Spec listo para fase 1.**
**Revisión:** v3.1 — pivot Phaser 3 + assets CC0 fetch-on-demand

---

## Abiertos del orquestador resueltos

1. **ADR-04 — ráfaga de eventos en primer snapshot**: opción **(a)** — settear cursor al timestamp del último event sin animar.
2. **Migración A — git tag**: repo bajo git real, `git tag dashboard-v2-final` previo a borrar. Sin push --tags.
3. **Migración E — cross-env**: NO agregar. Documentar comandos POSIX y Windows en README.
4. **Fase 2 criterio 3 — servir `/assets/`**: handler nuevo `/assets/<rel>` con whitelist hardcodeada.
5. **Engine pivot — PixiJS → Phaser 3 (v3.1)**: Phaser 3.80 vía CDN ESM (verificado). Razón: abstracciones nativas (Scene, Sprite con anims, Tweens, Cameras roundPixels) reducen LOC.
6. **Assets binarios en repo — descartado (v3.1)**: el starter NO commitea binarios. `assets/vendor/<pack>/` gitignored. Consumer corre `npm run dashboard:assets` para fetch CC0 default desde Kenney.nl CDN.

---

Pixel-art office scene en **Phaser 3.80+**, alimentada por el mismo `dashboard/state.json` + SSE del backend v2. El backend cambia poco; el frontend se reescribe. Meta MVP: oficina con avatares que cambian de estado en vivo según `active_tasks` y `events`, con drill-down a entregables.

## 1. Diagrama de módulos

```
dashboard/
├── server.js                          (REUTILIZA — agrega flag read-only + endpoint /api/pack-name + handler /assets/<rel>)
├── state.json                         (mismo schema; consumido por scene engine)
└── public/
    ├── index.html                     (REESCRITO — host del canvas + side panel)
    ├── style.css                      (REESCRITO — crisp pixels + panel DOM)
    ├── boot.js                        (NUEVO — entry point, dynamic import esm.sh)
    ├── pack/
    │   ├── loader.js                  (NUEVO — fetch + validate manifest.json + load textures en Phaser)
    │   └── resolver.js                (NUEVO — vendor → packs fallback)
    ├── engine/
    │   ├── app.js                     (NUEVO — Phaser.Game init, Scale.NONE + zoom integer)
    │   ├── scene.js                   (NUEVO — Phaser.Scene principal: piso, paredes, props)
    │   ├── seating.js                 (NUEVO — hash determinístico nombre → asiento)
    │   ├── avatar.js                  (NUEVO — Phaser.GameObjects.Sprite wrapper + state machine)
    │   ├── animations.js              (NUEVO — registry 5 efímeras vía Tweens + Particles)
    │   ├── eventBus.js                (NUEVO — diff por timestamp, EventTarget global)
    │   └── stateSync.js               (NUEVO — SSE client + GET /api/state inicial)
    ├── ui/
    │   ├── panel.js                   (NUEVO — side panel DOM nativo, drill-down)
    │   ├── topbar.js                  (NUEVO — métricas + reloj de sesión)
    │   └── mode.js                    (NUEVO — detección ?mode=public + lock UI)
    ├── lib/
    │   └── phaser.js                  (NUEVO — re-export desde esm.sh, único punto de entrada)
    └── README.md                      (REESCRITO — pack system + modo público + fetch CC0)

assets/                                (NUEVO ROOT)
├── packs/
│   └── kenney-roguelike/              (default pack — solo manifest, sin binarios)
│       ├── manifest.json              (COMMITEADO; declara source_url + paths esperados)
│       └── ATTRIBUTION.md             (COMMITEADO; Kenney.nl + CC0)
└── vendor/                            (GITIGNORED — binarios reales)
    └── kenney-roguelike/              (poblado por scripts/fetch_default_pack.js)
        ├── tiles/
        └── characters/

contracts/schemas/
├── architect-output.schema.json       (EXISTE)
├── assets-pack.schema.json            (NUEVO — valida manifest.json; campos Phaser-friendly)
├── dashboard-event.schema.json        (NUEVO — valida shape de events[])
└── (existentes intactos)

scripts/
└── fetch_default_pack.js              (NUEVO — descarga Kenney pack CC0, valida manifest con Ajv)
```

**Boundaries clave:**
- `engine/*` no toca DOM ni `fetch`; recibe state plano y dispara render Phaser.
- `ui/*` no toca Phaser; solo DOM. Comunica con engine vía `bus` (`EventTarget`) expuesto por `eventBus.js`.
- `pack/*` es la única vía para resolver paths de sprites; el engine pide texturas vía Phaser.Loader desde el pack loader.
- `stateSync.js` es la única vía hacia `/api/state` y `/api/events`. Nadie más hace `fetch`.

## 2. Signatures de exports públicos

```js
// public/lib/phaser.js
// Único punto de entrada Phaser 3.80.1 desde esm.sh (verificado: sirve ESM con default + named exports).
export { default } from 'https://esm.sh/phaser@3.80.1';
export * from 'https://esm.sh/phaser@3.80.1';
```

```js
// public/boot.js
/**
 * Entry point del frontend v3. Llamado por index.html con type="module".
 * Orden: detectMode → resolvePack → loadManifest → initGame → mountScene → connectState → mountUI.
 * Top-level await, no exports.
 */
```

```js
// public/pack/loader.js
/**
 * @typedef {Object} PackAsset
 * @property {string} name
 * @property {'tileset'|'spritesheet'} kind
 * @property {string} src
 * @property {number} [frame_width]
 * @property {number} [frame_height]
 */
/**
 * @typedef {Object} CharAnimation
 * @property {number[]} frames
 * @property {number}   frameRate
 * @property {number}   repeat
 */
/**
 * @typedef {Object} PackManifest
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string} attribution
 * @property {string} [source_url]
 * @property {number} scale
 * @property {number} tile_size
 * @property {PackAsset[]} tilesets
 * @property {Object}  characters_atlas
 * @property {string}  characters_atlas.src
 * @property {number}  characters_atlas.frame_width
 * @property {number}  characters_atlas.frame_height
 * @property {Object<string, CharAnimation>} characters_atlas.animations
 */

/**
 * Validación mínima browser (sin Ajv): verifica presencia de campos críticos:
 *   - typeof manifest.name === 'string' && regex `^[a-z0-9][a-z0-9-]*$`
 *   - typeof manifest.version === 'string'
 *   - Array.isArray(manifest.tilesets) && length >= 1
 *   - manifest.characters_atlas.animations tiene las 4 keys: idle, working, waiting, failed
 *   - cada animation tiene `frames[]`, `frameRate` (int), `repeat` (int)
 * La validación dura corre en `scripts/fetch_default_pack.js` con Ajv del repo.
 * @param {string} url
 * @returns {Promise<PackManifest>}
 * @throws {Error} si no valida los campos mínimos.
 */
export async function loadManifest(url) {}

/**
 * Carga texturas en Phaser.Loader con keys predecibles:
 *   tilesets:   `tiles:<tileset.name>`
 *   characters: `chars:atlas`
 * Registra animations globales: `scene.anims.create({ key: 'avatar:<state>', frames, frameRate, repeat })`.
 * @param {import('phaser').Scene} scene
 * @param {PackManifest} manifest
 * @returns {Promise<void>}
 */
export async function loadPackTextures(scene, manifest) {}
```

```js
// public/pack/resolver.js
/**
 * Lee window.__PACK__ (inyectado por server desde env DASHBOARD_PACK) o ?pack=.
 * Antes de construir el path, SANITIZA el nombre contra la regex del schema
 * (`^[a-z0-9][a-z0-9-]*$`) — bloquea path traversal. Si el nombre URL/env no
 * matchea, fallback silencioso a default 'kenney-roguelike'.
 * Orden: /assets/vendor/<name>/manifest.json → /assets/packs/<name>/manifest.json.
 * @param {string} [preferredName]
 * @returns {Promise<{ baseUrl: string, manifest: PackManifest }>}
 */
export async function resolvePack(preferredName) {}

/**
 * Valida que el nombre de pack cumpla la regex del schema antes de usarlo en paths.
 * Exportada para testing del fix path-traversal.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidPackName(name) {}
```

```js
// public/engine/app.js
/**
 * Crea Phaser.Game con:
 *   - type: Phaser.AUTO (WebGL preferido, Canvas fallback)
 *   - width: 1280, height: 720
 *   - pixelArt: true (setea antialias=false + roundPixels=true)
 *   - scale.mode: Phaser.Scale.NONE
 *   - scale.zoom: integer por fitToViewport (1×|2×|3×)
 *   - render.roundPixels: true
 *   - scene: [ResourceLoaderScene, OfficeScene]
 * @returns {Promise<import('phaser').Game>}
 */
export async function initGame() {}

/** Recalcula scale.zoom al viewport en resize. Solo enteros. Idempotente. */
export function fitToViewport(game) {}
```

```js
// public/engine/scene.js
/**
 * Phaser.Scene 'office'. Crea grupos: bg, props, avatars, fx (efímero).
 */
export class OfficeScene extends Phaser.Scene {}

/**
 * @param {Phaser.Scene} scene
 * @param {PackManifest} manifest
 */
export function buildStaticScene(scene, manifest) {}
```

```js
// public/engine/seating.js
/** @typedef {{ x: number, y: number, isOverflow?: boolean }} Seat */

/**
 * Hash FNV-1a 32-bit % 8 slots; colisión = probing lineal.
 * Overflow N>8: si todos los 8 slots base ocupados, agente va a "overflow row"
 * (fila 3 visual, debajo de la oficina principal, slots dinámicos sin colisión).
 * El Seat devuelto marca `isOverflow: true` para que el render aplique tinte
 * suave o indicador visual. Sin error, sin warning bloqueante.
 * @param {string} agentName
 * @param {Set<string>} [occupiedNames]  set de nombres ya colocados, para tracking overflow
 * @returns {Seat}
 */
export function seatFor(agentName, occupiedNames) {}

/** Catálogo fijo de 8 slots base + capacidad overflow ilimitada. */
export function listSeats() {}
```

```js
// public/engine/avatar.js
/** @typedef {'idle'|'working'|'waiting'|'failed'} AvatarState */
/** @typedef {{ name: string, role: string, seat: Seat, scene: Phaser.Scene }} AvatarConfig */

/**
 * @typedef {Object} Avatar
 * @property {Phaser.GameObjects.Sprite} sprite
 * @property {Phaser.GameObjects.Container} view
 * @property {(s: AvatarState) => void}  setState
 * @property {() => AvatarState}         getState
 * @property {(on: boolean) => void}     setHalo
 * @property {() => void}                destroy
 * @property {string}                    name
 */

/** @param {AvatarConfig} cfg @returns {Avatar} */
export function createAvatar(cfg) {}
```

```js
// public/engine/animations.js
/** @typedef {'council_invoked'|'image_generated'|'task_completed'|'task_failed'|'contract_violation'} EphemeralEventType */
/** @typedef {{ type: EphemeralEventType, payload: object, timestamp: string }} EphemeralEvent */

/**
 * Registry de 5 efímeras vía Phaser.Tweens, ParticleEmitter, Graphics.
 * Cleanup automático vía scene.time.delayedCall.
 * @param {Phaser.Scene} scene
 * @param {(name: string) => Avatar|null} getAvatarByName
 * @returns {{ play: (ev: EphemeralEvent) => void, dispose: () => void }}
 */
export function createAnimationPlayer(scene, getAvatarByName) {}
```

```js
// public/engine/eventBus.js
/**
 * Cursor tuple `{ timestamp: string, index: number }`. Diff strict-greater por tuple:
 * un evento E es "nuevo" si `(E.timestamp, E.indexInArray) > cursor`.
 * Tie-break por índice resuelve eventos con timestamp idéntico (mismo ms) — bloqueante del critic.
 * Primer call con cursor null: settea cursor al último (timestamp, index) SIN emitir (ADR-04 opción a).
 * @param {Array<{type:string,timestamp:string,payload?:object}>} events
 * @returns {EphemeralEvent[]}
 */
export function diffEvents(events) {}

export function resetCursor(toTimestamp, toIndex) {}

export const bus = new EventTarget();
```

```js
// public/engine/stateSync.js
/**
 * GET /api/state inicial + EventSource a /api/events. Backoff 1s→2s→4s→8s.
 * Emite 'state-update' por bus.
 * @returns {{ getSnapshot: () => object|null, disconnect: () => void }}
 */
export function startStateSync() {}
```

```js
// public/ui/panel.js
/**
 * Side panel DOM overlay derecho 360px. Suscribe bus 'avatar-clicked', 'event-clicked'.
 * @returns {{ mount: () => void, openTask: (taskId: string) => void, close: () => void }}
 */
export function createSidePanel() {}
```

```js
// public/ui/topbar.js
export function createTopbar() {}
```

```js
// public/ui/mode.js
/** @returns {{ isPublic: boolean }} */
export function detectMode() {}
```

## 3. Schema del manifest de packs

`contracts/schemas/assets-pack.schema.json`. **Cambio v3.1:** `animations` ahora `{ frames, frameRate, repeat }` por animación (Phaser API directa).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "assets-pack",
  "title": "Assets pack manifest (Phaser 3)",
  "type": "object",
  "required": ["name", "version", "license", "attribution", "tile_size", "scale", "tilesets", "characters_atlas"],
  "additionalProperties": false,
  "properties": {
    "name":        { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "version":     { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    "license":     { "type": "string", "enum": ["CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-3.0", "CC-BY-SA-4.0", "OGA-BY-3.0", "MIT"] },
    "attribution": { "type": "string", "minLength": 1 },
    "source_url":  { "type": "string", "format": "uri" },
    "source_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$", "description": "SHA256 esperado del ZIP fuente; fetch_default_pack.js valida post-download" },
    "tile_size":   { "type": "integer", "enum": [16, 32, 48] },
    "scale":       { "type": "integer", "minimum": 1, "maximum": 4 },
    "tilesets": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["name", "src"],
        "additionalProperties": false,
        "properties": {
          "name":    { "type": "string", "pattern": "^[a-z0-9_-]+$" },
          "src":     { "type": "string" },
          "columns": { "type": "integer", "minimum": 1 },
          "rows":    { "type": "integer", "minimum": 1 }
        }
      }
    },
    "characters_atlas": {
      "type": "object",
      "required": ["src", "frame_width", "frame_height", "animations"],
      "additionalProperties": false,
      "properties": {
        "src":          { "type": "string" },
        "frame_width":  { "type": "integer", "minimum": 8 },
        "frame_height": { "type": "integer", "minimum": 8 },
        "animations": {
          "type": "object",
          "required": ["idle", "working", "waiting", "failed"],
          "additionalProperties": false,
          "patternProperties": {
            "^(idle|working|waiting|failed)$": {
              "type": "object",
              "required": ["frames", "frameRate", "repeat"],
              "additionalProperties": false,
              "properties": {
                "frames":    { "type": "array", "minItems": 1, "items": { "type": "integer", "minimum": 0 } },
                "frameRate": { "type": "integer", "minimum": 1, "maximum": 60 },
                "repeat":    { "type": "integer", "minimum": -1 }
              }
            }
          }
        }
      }
    }
  }
}
```

**Mecanismo de "pack activo":**
- Default: `kenney-roguelike` (combo CC0 verificado).
- Override env: `DASHBOARD_PACK=mi-pack`. Server expone `GET /api/pack-name`; `boot.js` lo consulta.
- Override URL: `?pack=mi-pack` gana sobre env.
- Resolver intenta primero `/assets/vendor/<name>/manifest.json`. Si 404, intenta `/assets/packs/<name>/manifest.json` (solo manifest declarativo; sin binarios = error de "corre fetch"). Si ambos fallan: "no encontré assets — corre `npm run dashboard:assets`".

## 3.bis Default pack CC0 verificado (Kenney.nl)

**Combo elegido — todo CC0, sin obligación de atribución:**

| Componente | Pack | URL canónica | Cobertura |
|---|---|---|---|
| Interior tiles | Kenney "Roguelike Indoors" | `https://kenney.nl/assets/roguelike-indoors` | Tiles top-down de interiores. 16×16. |
| Characters | Kenney "Roguelike Characters" | `https://kenney.nl/assets/roguelike-characters` | Spritesheet personajes top-down compatibles. |

**ZIPs directos verificados (poblados por `scripts/fetch_default_pack.js`):**
- `https://kenney.nl/media/pages/assets/roguelike-indoors/e0687ca2a9-1702169567/kenney_roguelike-indoors.zip`
- `https://kenney.nl/media/pages/assets/roguelike-characters/cc364edf00-1729196490/kenney_roguelike-characters.zip`

**Cobertura real vs ideal "office":** Kenney no tiene pack pixel-art **específicamente office** CC0. El combo roguelike-indoors aporta interiores genéricos (mesas, estanterías, sillas, plantas, lámparas) que funcionan como "oficina" con dirección artística mínima. Consumer premium-office (LimeZu, MetroCity, Arlan_TR) activa pack propio.

**Fallbacks alternativos (OpenGameArt, CC-BY/SA — no default por overhead legal):**
- `https://opengameart.org/content/lpc-interior-castle-tiles` (Sharm, CC-BY 4.0 / CC-BY-SA 4.0 / OGA-BY 3.0).
- `https://opengameart.org/content/lpc-tile-atlas` (CC-BY-SA 3.0 / GPL 3.0).

**Política dura del repo:**
- `assets/vendor/**` en `.gitignore`. Cero binarios.
- `assets/packs/<name>/manifest.json` commiteado (declarativo + `source_url`).
- `assets/packs/<name>/ATTRIBUTION.md` commiteado.
- Consumer premium: copia binarios + manifest a `assets/vendor/<name>/` y activa con `DASHBOARD_PACK`.

## 4. Contracts nuevos requeridos

| Archivo | Propósito |
|---|---|
| `assets-pack.schema.json` | Valida manifest. Usado por `pack/loader.js` (browser, check mínimo) y `scripts/fetch_default_pack.js` (Node, Ajv del repo). |
| `dashboard-event.schema.json` | Documenta shape de `events[]`. Campos: `type` (enum MVP), `timestamp` (ISO), `payload` (object). |

## 5. ADRs

### ADR-01 (REESCRITO v3.1) — Phaser 3.80 vía esm.sh vs PixiJS
**Contexto:** Starter sin bundler. Research Star-Office-UI mostró que Phaser sirve por CDN ESM y aporta abstracciones nativas (Scene lifecycle, Sprite anims declarativas, Tweens, ParticleEmitter, Camera.roundPixels, Scale.NONE + zoom integer) que reducen LOC vs PixiJS bajo nivel.

**Decisión:** Phaser 3.80.1 desde `https://esm.sh/phaser@3.80.1`, verificado: sirve `application/javascript` con `export default` + named exports en `<script type="module">`. Re-export único en `public/lib/phaser.js`. Render `Phaser.AUTO` (WebGL preferido, Canvas fallback automático).

**Configuración pixel-perfect:**
- `pixelArt: true` (Phaser setea `antialias: false` + `roundPixels: true`).
- `scale.mode: Phaser.Scale.NONE` + `scale.zoom: <entero>` calculado runtime.
- CSS `image-rendering: pixelated` segundo seguro.

**Consecuencias:** Cero deps nuevas. Bundle ~1.2MB cache primer load. Phaser arrastra Arcade Physics no usada (tree-shaking esm.sh parcial). Pérdida vs PixiJS: render más opinionado, compensado por API de juego más alta.

**Alternativas descartadas:**
- PixiJS v8 (spec v3.0): bajo nivel, requiere implementar state machines de animation manualmente.
- Phaser UMD `<script>`: requiere `window.Phaser` global. ESM funciona.

### ADR-02 — DOM nativo para side panel vs Phaser GameObject
**Contexto:** Drill-down con texto largo. Phaser Text no maneja bien selección/accesibilidad/scroll.
**Decisión:** Side panel = `<aside>` HTML absoluto sobre canvas. Phaser dispara eventos `avatar-clicked` por `bus`; `ui/panel.js` los escucha.

**Invariante de seguridad (XSS):** TODO render desde `state.json` al DOM del panel usa `element.textContent`, **JAMÁS** `innerHTML`. Aplica a `task.summary`, `task.role_full`, `payload.reason`, `artifact.title`, todos los campos. Test `dashboard-panel-xss.test.js` hace grep contra `innerHTML\s*=` en `ui/panel.js` — si match, falla. Para tipografía pixel-art se usa webfont CC0 (Press Start 2P o VT323 desde Google Fonts CDN) en `style.css` aplicada solo al `<aside>`, manteniendo el vibe sin romper accesibilidad.

**Consecuencias:** Selección, copy-paste, screen-readers, links funcionan. Precio: tipografía sistema "rompe" inmersión pixel-art salvo override con webfont (incluido). XSS bloqueado por invariante testeable.

### ADR-03 — Determinismo del seating
**Contexto:** Mismo agente debe quedar en mismo escritorio entre recargas.
**Decisión:** `hash(agentName) % seats.length` con FNV-1a 32-bit inline. 8 slots en 2 filas. Colisiones por probing lineal.
**Consecuencias:** Determinismo sin persistencia. >8 agentes requiere ampliar catálogo (decisión consciente).

### ADR-04 — Diff de eventos por timestamp vs sequence number
**Contexto:** SSE notifica cambio; frontend re-fetch state completo. Detectar events nuevos sin tocar backend.
**Decisión:** Cursor `lastSeenTimestamp` (string ISO), comparación lexicográfica. Primer call con cursor null: settear cursor al último timestamp SIN emitir (opción a).
**Consecuencias:** Cero cambios backend. Primer load no dispara ráfaga acumulada.

### ADR-05 (NUEVO v3.1) — Assets NO commiteados; fetch on-demand
**Contexto:** Spec v3.0 asumía bundle de binarios CC0/CC-BY. Problema: tamaño del repo crece, riesgo re-licensing upstream, dificulta swap a premium.
**Decisión:** Starter solo commitea `manifest.json` + `ATTRIBUTION.md` por pack. Binarios en `assets/vendor/<name>/` gitignored. `scripts/fetch_default_pack.js` baja ZIP CC0 desde Kenney CDN, descomprime, valida manifest con Ajv. Comando: `npm run dashboard:assets`.
**Consecuencias:** Repo público liviano. Costo: primera vez requiere correr el script. Riesgo: si Kenney mueve URL, fetch rompe — mitigado documentando URL en `manifest.json#source_url` y fallback al bundle all-in-1 manual.

## 6. State machine del Avatar

```
                  ┌──────────────────┐
   inicio ──────► │      IDLE        │ ◄────────────────┐
                  │ (anim idle loop) │                  │
                  └──────────────────┘                  │
                       │      ▲                         │
                task_started  │ task_completed          │
                       ▼      │                         │
                  ┌──────────────────┐                  │
                  │     WORKING      │                  │
                  │ (anim teclear)   │                  │
                  └──────────────────┘                  │
                       │      ▲                         │
              hand-off│      │ consumeInput OK         │
                       ▼      │                         │
                  ┌──────────────────┐                  │
                  │     WAITING      │ ─ timeout 30s ───┘
                  │ (anim mirar)     │
                  └──────────────────┘
                       │
                  task_failed
                       ▼
                  ┌──────────────────┐
                  │     FAILED       │ ─ next task_started ─► WORKING
                  │ (anim cabeza-↓)  │ ─ timeout 60s ───────► IDLE
                  └──────────────────┘
```

Implementación Phaser: `setState(s)` llama `this.sprite.play('avatar:' + s)`. Anims registradas globalmente en `OfficeScene.create()` con keys desde manifest.

| State | Anim key | Transiciones |
|---|---|---|
| `idle` | `avatar:idle` loop | → working en `task_started` propio |
| `working` | `avatar:working` loop | → idle en `task_completed`/`task_failed`; → waiting en `hand_off_emitted` |
| `waiting` | `avatar:waiting` loop | → working en `task_updated` con gate consumido; → idle por timeout 30s |
| `failed` | `avatar:failed` loop | → working en próximo `task_started`; → idle por timeout 60s |

## 7. 5 animaciones efímeras (hard list cerrada)

| Event | Input (payload) | Output visual (Phaser primitives) | Duración | Cleanup |
|---|---|---|---|---|
| `council_invoked` | `payload.council`, `payload.tier` | Tier-1: Graphics globo + Text. Tier-2: 2 sprites 2arios + 3 globos. Tier-3: 4 sprites en mesa redonda (Group). | 4s | `scene.time.delayedCall(4000, () => container.destroy())` |
| `image_generated` | `payload.path`, `payload.task_id` | Mini-Sprite tile flotando sobre avatar, Tween y -16px easing, fade-out alpha | 2s | Tween onComplete destroy |
| `task_completed` | `payload.id`, `payload.tokens` | Sprite tick verde + `ParticleEmitter` corto (4-6 partículas, radial) | 1.2s | `emitter.stop()` + delayedCall destroy |
| `task_failed` | `payload.id`, `payload.reason` | Sprite exclamación rojo + Tween shake sobre `avatar.view` (±2px senoidal) | 1.5s | yoyo Tween + restore x; destroy sprite |
| `contract_violation` | `payload.agent`, `payload.schema_id`, `payload.field` | Graphics línea roja punteada caller→callee + Text label `<schema_id>.<field>` flotante sobre el callee (2s, fade-in/out) — didáctico para usuarios nuevos. | 3s | Graphics + Text destroyed |

**Hard-list:** ninguna otra animación en v1. Events con `type` desconocido → `console.debug`.

## 8. Mapeo state.json → render

| Campo state.json | Consumidor | Render |
|---|---|---|
| `session_id`, `session_started_at` | `ui/topbar.js` | Texto + uptime tick 1s |
| `active_tasks[].agent` (unique set) | `engine/scene.js` | Crea/destruye avatares: nuevos → `createAvatar`; ausentes 60s → fade-out + destroy |
| `active_tasks[].agent` + `.status` | `engine/avatar.js` setState | `running`→`working`, `completed`→`idle` (+tick), `failed`→`failed`, gate-blocked+stale→`waiting` |
| `review_worthy && !review_seen` | `engine/avatar.js` setHalo(true) | Halo amarillo pulsante (Tween alpha loop) |
| `active_tasks[i].artifacts[]` | `ui/panel.js` (click) | Chips con link a `/files/<path>` |
| `events[]` (delta) | `engine/eventBus.js` → `animations.js` | Dispara una de las 5 efímeras |
| `metrics.*` | `ui/topbar.js` | Contadores |
| `active_skills[]` | `ui/topbar.js` | Chips informativos |
| `current_sprint.{number,objective}` | `ui/topbar.js` | Subtítulo, sin progress bar MVP |
| `derived.declared_contracts` | `ui/panel.js` global | Lista al abrir panel global |
| `derived.memory_snapshot` | `ui/topbar.js` | Badge `agentes_count` |

## 9. Plan de migración

**A. Tag de seguridad:** `git tag dashboard-v2-final` antes de borrar.

**B. Archivos a borrar:**
```
dashboard/public/app.js
dashboard/public/app-extras.js
dashboard/public/style.css
dashboard/public/index.html
dashboard/public/icons/sprite.svg
```
**No borrar:** `dashboard/server.js`, `dashboard/state.json`, `dashboard/history/`, `dashboard/README.md` (reescribir).

**C. `.gitignore` (agregar):**
```
assets/vendor/
```

**D. Tests existentes:**

| Test | Acción |
|---|---|
| `dashboard-server.test.js` | Mantener + assertar `GET /api/pack-name`, `POST` 403 con `DASHBOARD_PUBLIC=1`, handler `/assets/<rel>` |
| `dashboard-hooks.test.js` | Mantener (ortogonal) |
| `dashboard-ui.test.js` | Borrar |
| `dashboard-ui-extras.test.js` | Borrar |
| `dashboard-ui-test.js` | Borrar |

**E. Tests nuevos:**

| Test | Cubre |
|---|---|
| `dashboard-pack-resolver.test.js` | `pack/resolver.js` + `pack/loader.js` con fetch mock |
| `dashboard-event-bus.test.js` | `eventBus.diffEvents` cursor advance, tie-break, reset, primer-snapshot |
| `dashboard-seating.test.js` | `seating.seatFor` determinismo + colisiones FNV-1a + **overflow N=9 y N=12** (marca `isOverflow: true`, sin error) |
| `dashboard-pack-resolver.test.js` | (extender) test path-traversal: `?pack=../../../etc/passwd` → fallback silencioso a default. `isValidPackName` valida regex correctamente. |
| `dashboard-fetch-pack.test.js` | (extender) test SHA256 mismatch del ZIP descargado → error claro con hint a `source_url` |
| `dashboard-panel-xss.test.js` (NUEVO v3.1 fix) | grep contra `innerHTML\s*=` en `ui/panel.js` retorna 0 matches |
| `dashboard-public-mode.test.js` | `DASHBOARD_PUBLIC=1` rechaza POST con 403 |
| `dashboard-fetch-pack.test.js` (NUEVO v3.1) | `scripts/fetch_default_pack.js` mock HTTP ZIP; verifica unzip + Ajv |
| `dashboard-phaser-loads.test.js` (NUEVO v3.1) | Smoke headless: importa Phaser desde esm.sh, verifica `Phaser.AUTO`, `Phaser.Scene`, `Phaser.Tweens`, `Phaser.GameObjects.Particles.ParticleEmitter` están disponibles. Mide bundle real con `curl -sIL` y loggea en consola. Debe correr en fase 1 antes de comprometerse al stack. |

**F. Scripts `package.json`:**
```json
"dashboard:assets":     "node scripts/fetch_default_pack.js",
"test:dashboard:scene": "node dashboard-pack-resolver.test.js && node dashboard-event-bus.test.js && node dashboard-seating.test.js && node dashboard-public-mode.test.js && node dashboard-fetch-pack.test.js"
```
Eliminar `test:dashboard:ui`. NO agregar `cross-env`. Read-only:
- POSIX: `DASHBOARD_PUBLIC=1 node dashboard/server.js`
- Windows: `set DASHBOARD_PUBLIC=1 && node dashboard/server.js`

**G. Comunicación del breaking change:**
- `dashboard/README.md` reescrito.
- `CLAUDE.md`: tabla de tests actualizada.
- `process-log/00-decisions.md`: registrar pivot Phaser + política assets como D3 y D4.

## 10. Criterios de aceptación por fase

**Fase 1 — Limpieza + esqueleto + smoke Phaser:**
1. `ls dashboard/public/` → solo `index.html`, `boot.js`, `README.md`, subdirs nuevos.
2. `assets/vendor/` en `.gitignore`.
3. `npm run dashboard` arranca; `http://localhost:7777` muestra "Dashboard v3 cargando…" sin errores.
4. `npm run test:dashboard` verde.
5. Tag `dashboard-v2-final` existe.
6. **Smoke Phaser**: `node dashboard-phaser-loads.test.js` verde — Phaser carga desde esm.sh, APIs (`Scene`, `Tweens`, `Particles`, `AUTO`) disponibles, bundle real medido y registrado en ADR-01. **Si este test falla, bloquear fase 2** y revisar stack.

**Fase 2 — Pack system + fetch CC0:**
1. `npm run dashboard:assets` baja Kenney roguelike-indoors + characters a `assets/vendor/kenney-roguelike/`, valida manifest → exit 0.
2. `curl http://localhost:7777/assets/packs/kenney-roguelike/manifest.json` retorna JSON.
3. `curl http://localhost:7777/assets/vendor/kenney-roguelike/characters/...` retorna PNG (200).
4. Bloque resolver de `test:dashboard:scene` verde.
5. Si `vendor/<pack>/` no existe al arrancar el dashboard, el server detecta la ausencia y devuelve `index.html` con banner inline: "no encontré assets — corre `npm run dashboard:assets`" + botón "Reintentar". UX mejor que silent fail.

**Fase 3 — Phaser game + escena estática:**
1. Dashboard muestra sala 1280×720 con piso, paredes, escritorios. Sin avatares.
2. Resize: integer scaling (1×, 2×, 3×), nunca fraccional.
3. 60fps sostenido escena estática.
4. `Phaser.AUTO` resolvió a WebGL (`game.renderer.type === Phaser.WEBGL`).

**Fase 4 — Avatares + state machine:**
1. State con 3 active_tasks `running` → 3 sprites en asientos distintos con `avatar:working`.
2. `task-complete` → ese avatar pasa a `avatar:idle` en ≤1s.
3. Reload da mismo asiento por agente.
4. `dashboard-seating.test.js` verde.

**Fase 5 — Animaciones efímeras:**
1. `update_state.js event council_invoked` → globo blanco 4s.
2. 5 eventos en 2s → 5 animaciones simultáneas, ninguna crashea, cleanup correcto.
3. Evento con type desconocido → no rompe, `console.debug`.

**Fase 6 — Side panel + drill-down:**
1. Click sobre avatar (Phaser pointer event) → bus `avatar-clicked` → panel abre.
2. Click en artifact `.png` → nueva pestaña.
3. Click fuera → cierra.

**Fase 7 — Read-only + tests:**
1. `DASHBOARD_PUBLIC=1` activa middleware con **whitelist de métodos `GET`, `HEAD`, `OPTIONS`** (NO blacklist de POST). Test exhaustivo: `curl -X POST | PUT | PATCH | DELETE` → 403 con body `{"error":"read-only mode"}`. Cubre futuros endpoints mutantes sin tener que recordar agregar 403 a cada uno.
2. `?mode=public` esconde controles futuros que generen mutación.
3. Test `dashboard-panel-xss.test.js` verde — grep `innerHTML\s*=` en `ui/panel.js` retorna 0 matches (invariante ADR-02).
4. `test:dashboard:scene` verde.
5. `smoke:quick` verde.

## 11. Qué NO está en v1

- Whiteboard modes / theming alternativo / dark mode
- Replay histórico de `dashboard/history/events.log`
- Export PNG/GIF
- Auth real / login / sesiones por usuario
- Multi-user concurrente
- Animaciones fuera de las 5 listadas
- Avatares custom por agente (tinte HSV hash-derived es nice-to-have)
- Sonido / audio cues
- Mini-mapa / zoom in/out
- Drag para reorganizar asientos
- Edición del state desde la UI
- Multi-pack en una sesión
- Phaser Arcade Physics activado
- I18n del side panel
- Métricas históricas con gráficos
- Vendorizado de Phaser local
- Bundle de assets premium en el starter público

## 12. Riesgos remanentes

| # | Riesgo | Prob | Mitigación |
|---|---|---|---|
| 1 | esm.sh falla primera carga sin red | Media | Documentar. `scripts/vendor_phaser.js` opcional futuro. |
| 2 | Validación manifest browser sin Ajv | Media | Validación dura en `scripts/fetch_default_pack.js`. Browser: check mínimo. |
| 3 | Sprite ráfaga primer load | Baja si test cubre | `dashboard-event-bus.test.js` cubre primer call con cursor null. |
| 4 | Kenney mueve URL del ZIP → `dashboard:assets` rompe | Media | `manifest.json#source_url` + README explica fallback al bundle all-in-1 manual. |
| 5 | Phaser 3.80 ~1.2MB primer load lento | Baja | Aceptable MVP. esm.sh gzip. Cache navegador. |
| 6 | Kenney roguelike-indoors sin "office puro" | Media | Aceptable MVP: dirección artística "alquímica/medieval-style" funciona. Consumer premium activa pack propio. |
| 7 | Phaser arrastra Arcade Physics no usada → bundle inflado | Baja | esm.sh tree-shaking parcial. ~1.2MB aceptable vs 600KB PixiJS. Costo de ADR-01. |

---

## Archivos críticos para implementación

- `dashboard/public/boot.js` (nuevo — entry point)
- `dashboard/public/engine/avatar.js` (nuevo — wrapper Phaser.Sprite + state machine)
- `dashboard/public/engine/animations.js` (nuevo — registry 5 efímeras vía Tweens + Particles)
- `dashboard/public/pack/loader.js` (nuevo — fetch manifest + load texturas + anims globales)
- `scripts/fetch_default_pack.js` (nuevo — descarga Kenney ZIPs, unzip, valida Ajv)

---

## Estado final (2026-05-11)

**v3.0 completo — fases 1-7 implementadas. Fase 5 (animaciones efímeras) postpuesta a v1.1 por decisión D5.**

7 fixes originales del critic aplicados:

✅ **Fix 1** — Tie-break en `diffEvents` por tuple `{timestamp, index}` (sección 2)
✅ **Fix 2** — Sanitización `?pack=` contra regex schema en `resolvePack` + `isValidPackName` exportada (sección 2)
✅ **Fix 3** — `dashboard-phaser-loads.test.js` en fase 1, bloqueante. Mide bundle real (sección 9.E + criterio fase 1.6)
✅ **Fix 4** — Read-only middleware con whitelist `GET/HEAD/OPTIONS` (criterio fase 7.1)
✅ **Fix 5** — Invariante XSS `textContent`-only + test `dashboard-roadmap-render.test.js` (anteriormente `dashboard-panel-xss.test.js`) con grep `innerHTML` (ADR-02 + sección 9.E)
✅ **Fix 6** — Overflow seating con `isOverflow: true` + SHA256 ZIP en schema (`seatFor` sección 2 + schema sección 3)
✅ **Fix 7** — Campos mínimos browser validation declarados en `loadManifest` (sección 2)

**Sugerencias secundarias aplicadas:**
- Tooltip didáctico en `contract_violation` con `schema_id.field` (tabla animaciones)
- Auto-detect ausencia de assets con banner inline + botón "Reintentar" (criterio fase 2.5)
- Webfont pixel-art CC0 (Press Start 2P / VT323) en el panel para mantener vibe (ADR-02)

### Fases completadas

| Fase | Entrega clave |
|---|---|
| 1 | Limpieza + esqueleto + smoke Phaser. Tag `dashboard-v2-final`. `dashboard-phaser-loads.test.js` verde. |
| 2 | Pack system + fetch CC0 (`scripts/fetch_default_pack.js`). Handler `/assets/<rel>` con whitelist. Banner inline si vendor/ no existe. |
| 3 | Phaser game + escena estática 1280×720 con piso, paredes, escritorios. Integer scaling. WebGL preferido. |
| 4 | Avatares + state machine. Seating determinístico FNV-1a + overflow. Label flotante sobre avatares. |
| 5 | **Postpuesta a v1.1** por D5 (re-priorización). Las 5 animaciones efímeras quedan para una iteración futura. El dashboard v3.0 funciona sin ellas: el estado se actualiza, los avatares cambian de pose, los eventos se loguean — solo no hay fx celebratorios cuando un evento dispara. |
| 6 (expandida) | Side panel rico con drill-down por agente (brief, plan, task actual, entregables, eventos), vista Sprint con hitos cruzados, botón Sprint en topbar. Schema task v2.1: `prompt_brief`, `plan_steps`, `current_step`. |
| 7 | Vista Roadmap macro + historial de sprints colapsable. Endpoints `/api/roadmap` y `/api/sprints/history` con parser markdown defensivo. Schema task v2.2: `phase`, `epic`. Botón Roadmap en topbar + selector tri-modal en el panel. Tests `dashboard-roadmap-render.test.js` + `dashboard-sprints-history.test.js`. Docs `dashboard/README.md` reescrita + `CLAUDE.md` actualizado. |

### Estado de tests al cierre v3.0

- `npm run test:dashboard`: 32/32 verde (server HTTP + helper update_state.js + endpoints v3).
- `npm run test:dashboard:scene`: 10 archivos, ~116 tests verdes (phaser smoke + pack resolver + fetch pack + public mode + seating + event bus + panel render + sprint cross + roadmap render + sprints history).

### Sugerencias secundarias descartadas para v1.0 (revisable v1.1)

- Fusionar `pack/resolver.js` + `pack/loader.js`: cuesta más refactorizar boundaries ahora que mantener separados.
- `dashboard-event.schema.json` como JSDoc en lugar de archivo: cuesta poco mantener archivo separado y da contrato testeable.
- Animaciones efímeras (fase 5 original): pendiente cerrar las 5 de la sección 7. Posiblemente reescalado al subset que realmente aporta (council_invoked + task_failed son las más útiles en uso real).

### Estado para arranque del próximo proyecto

El dashboard v3.0 está listo para que el starter Mazelab arranque un proyecto nuevo:
1. Clone del starter → `npm install`.
2. `npm run dashboard:assets` para bajar el pack CC0 default.
3. `npm run dashboard` en una terminal lateral.
4. `/kickoff` define el primer sprint; cada task lanzada por agentes alimenta el state vía `scripts/update_state.js`.
5. El humano navega Agente/Sprint/Roadmap desde el side panel sin interferir con el trabajo.
