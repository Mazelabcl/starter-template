# Dashboard UI — guía rápida (v2 kanban-first)

UI vanilla (HTML + CSS + JS, cero dependencias). Servida por
`dashboard/server.js` en el puerto `7777`.

## Pivot v2: del log al kanban

La v1 mostraba eventos como log línea-a-línea con UUIDs crípticos. La v2
prioriza el avance: cada agente es una **tarjeta** con título humano,
contexto, rol completo expandible y entregables clickeables. El timeline
sigue vivo abajo (Sprint 2.3b).

## Layout

- **Header (arriba):** título + banner del proyecto (icono según
  `project_type`, descripción, tags) + chips de métricas (review pendiente,
  tokens, USD aprox., completadas, fallos, councils, imágenes, uptime) +
  indicador de conexión.
- **Sidebar izquierdo (colapsable, persistido en localStorage):** sprint
  actual con barra de progreso, skills activas como chips, equipo activo
  (agentes ordenados por uso), contratos declarados (`contracts/declared/`),
  enlace para descargar `/api/state`. Cada sección vacía muestra un **tip
  accionable** — nunca queda muda.
- **Toolbar del board:** toggle "solo review-worthy" (atajo de teclado: `r`)
  + leyenda de colores.
- **Kanban central:** cinco columnas — `Backlog` (queued), `En curso`
  (running), `Esperando review` (running/completed con `review_worthy`
  pendiente), `Completadas`, `Falladas` (oculta cuando está vacía). Cada
  tarjeta muestra:
  - Badge **REVIEW** arriba a la izquierda cuando vale la pena revisar.
  - Título humano (`task.title`) o derivado de `task.summary`. UUID en chip
    secundario al lado, click-to-copy.
  - Chips: agente, origen (council/sprint/decision), gate (cold-reader/
    critic), skill invocada.
  - **Rol completo** del agente (`task.role_full` o `task.agent_role`),
    expandible in-line con "ver más".
  - Una línea de contexto humano (`task.summary`).
  - **Entregables** (`task.artifacts[]`): chips clickeables con icono por
    extensión; las imágenes se muestran como mini-thumbnail 40×40.
  - Footer: tiempo + tokens + botón "marcar visto" cuando el badge review
    sigue activo.

## Heurística "review-worthy"

Una task se auto-marca como `review_worthy=true` cuando:

1. `origin` empieza con `council:`.
2. `gate === "cold-reader"`.
3. Contiene un artifact binario (image/audio/video).
4. Es la primera task de un agente nuevo en la sesión.

Cualquier agente puede setear `review_worthy: true` explícitamente con
`scripts/update_state.js task-update`. El humano apaga el badge con el
botón "marcar visto" (envía `review_seen: true` por POST /api/state).

## Estados visuales

| Color    | Significa                                                  |
| -------- | ---------------------------------------------------------- |
| Cyan     | trabajando (border pulsante en cards `running`)            |
| Amber    | review pendiente (cards en columna review + badge + halo)  |
| Verde    | completada                                                 |
| Violeta  | skill o council invocados                                  |
| Amarillo | advertencia, fallback a polling                            |
| Rojo     | fallo de tarea, servidor caído                             |

## Conexión al server

1. **Carga inicial:** `GET /api/state` se llama una vez para pintar todo.
2. **Live updates:** `EventSource('/api/events')` (SSE). Cada evento `state`
   dispara un re-fetch + re-render incremental.
3. **Fallback (3 errores SSE seguidos):** polling cada 2 s contra
   `/api/state`. Indicador pasa a amarillo.
4. **Servidor caído:** indicador rojo con reintento cada 5 s.

Cada segundo se actualizan los contadores live (uptime + duración de
tareas `running`) sin tocar al server.

## Render incremental

El kanban no hace re-render completo. Cada `<article class="task">` lleva
un `data-task-id`. En cada actualización: las tarjetas vivas se reusan
(solo se actualizan los slots que cambiaron), las nuevas se insertan con
animación `slide-in`, y las que ya no aplican se eliminan.

Una task con `review_worthy=true && !review_seen` se desvía visualmente a
la columna `review` mientras siga pendiente. Su `status` real se conserva
en `state.json` — esto solo afecta el render.

## Limitaciones conocidas

### Costo USD es una estimación gruesa

La métrica `~$` del topbar multiplica `total_tokens_session` por
`USD 0.012 / 1k tokens`. Es el promedio mezclando input y output con
precios típicos de Claude Opus / Sonnet. **No distingue input vs output, no
distingue modelos, no incluye llamadas a Replicate / OpenAI Images / TTS**.
Sirve como orden de magnitud, no como factura. Si necesitas cifras
exactas, lee los logs de OpenRouter.

### Heurística "first-of-agent" cap 200

`computeReviewWorthy()` en `scripts/update_state.js` mira
`state.events` (cap 200 entradas en memoria, persiste todo en
`dashboard/history/events.log`). Si tu sesión supera 200 eventos y un
agente nuevo aparece **después** del rollover, también será marcado como
"first-of-agent". Es comportamiento esperado: preferimos falsos positivos
(badge de más) a falsos negativos (perder una tarea importante).

### `/files/<rel>` requiere localhost por default

El endpoint sirve archivos del repo solo bajo whitelist (ver "Endpoints"
abajo). Aun así, **no expongas el dashboard fuera de localhost sin un
proxy con auth** — la whitelist es un mitigante, no un sustituto.

## Schema extendido (v2)

Campos opcionales en cada task. Los agentes los setean con
`scripts/update_state.js task-update <id> <json>`:

| Campo            | Tipo     | Para qué                                                      |
| ---------------- | -------- | ------------------------------------------------------------- |
| `role_full`      | string   | Rol completo sin truncar (el `agent_role` original era 100ch).|
| `summary`        | string   | 1 línea de contexto humano que se pinta sobre la card.        |
| `origin`         | string   | "council:&lt;name&gt;", "sprint:&lt;num&gt;", "decision:..."  |
| `gate`           | string   | "cold-reader", "critic", null.                                |
| `artifacts`      | array    | `[{ path, kind, title?, mime? }]`. kind ∈ image/file/link/audio/video. |
| `review_worthy`  | bool     | true cuando vale la pena que el humano la vea.                |
| `review_reason`  | string   | "council", "cold-reader", "binary-artifact", "first-of-agent".|
| `review_seen`    | bool     | true cuando el humano ya la marcó como vista.                 |

Backward-compat: todos opcionales, defaults seguros.

## Endpoints (servidor)

- `GET  /api/state` — snapshot + memoria + contratos declarados.
- `POST /api/state` — merge atómico. UI lo usa para `review_seen`.
- `GET  /api/events` — SSE. Emite `state` en cada cambio de
  `state.json`.
- `GET  /api/history?limit=N` — últimos eventos del log NDJSON.
- `GET  /files/<path-relativo>` — sirve archivos del repo en lectura, con
  guard de path-traversal **y whitelist explícita**. Lo usan los chips de
  entregables.

### Whitelist de `/files/<path>`

Por defecto, solo se sirven archivos bajo:

```
content/                content output (deliverables canónicos)
councils/results/       outputs de councils
dashboard/public/       assets de la UI (auto)
memory/                 memoria del proyecto
contracts/declared/     contratos declarados por agentes
contracts/schemas/      JSON Schemas
roadmap/                sprint y backlog
process-log/            historial de proceso
docs/                   docs del proyecto
```

Bloqueos duros (siempre aplicables):

```
.env, .git/, node_modules/, .cache/, .claude/,
dashboard/state.json (privado), dashboard/history/ (privado)
```

Para apretar más cuando el dashboard se expone fuera de localhost, usar:

```
DASHBOARD_FILES_ALLOW="content,councils/results"
```

(separado por comas, sustituye la whitelist por defecto).

## Persistencia local

Flags de UI bajo el namespace `mz.dashboard.*`:

- `mz.dashboard.sidebar` → `open` o `closed`.
- `mz.dashboard.onlyReview` → `true` o `false` (filtro toggle).
- `mz.dashboard.roleExpanded` → array de task-ids con rol completo abierto.

## Estado vacío

Si no hay tareas, eventos ni tokens consumidos, el banner sobre el kanban
muestra un comando de prueba. Si el sprint, las skills o el equipo están
vacíos, cada sección de la sidebar sugiere el siguiente paso (`/kickoff`,
`/idea`, etc.) — la sidebar nunca queda muda.

## Sprint 2.3b (entregado)

- Panel inferior con timeline en vivo de eventos.
- Modal de replay para hacer scrubbing temporal sobre `/api/history`.
- Botón "Exportar log" en el sidebar.

Los hooks viven en `app-extras.js`. El layout usa `--timeline-h: 0px` por
default; se sube a 240px cuando el panel está montado.
