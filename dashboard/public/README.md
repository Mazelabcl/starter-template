# Dashboard UI — guía rápida (v4 HTML plano de estado)

UI vanilla (HTML + CSS + JS, cero dependencias). Servida por
`dashboard/server.js` en el puerto `7777`.

**Estado:** v4 — el frontend Phaser pixel-art (boot.js, engine/, pack/,
ui/panel.js, style.css pixel-art) se degradó a un dashboard HTML plano
(decisión D8). El backend (server.js, endpoints, SSE, chat, modo público)
se conservó intacto. Rollback al pixel-art en el tag git `v3.1-final`
(`git checkout v3.1-final -- dashboard/public/`).

## Layout

- **Topbar (arriba):** título + barra de métricas (tokens, completadas,
  fallos, councils) + indicador de conexión.
- **Pestañas:** `Tareas` (vista por defecto), `Sprint`, `Roadmap`, `Chat`.

### Tareas (vista por defecto)

Tabla en vivo con columnas **Agente, Estado, Modelo, Tokens, Summary**. Lee
`/api/state` y se refresca por SSE cuando `state.json` cambia. El `summary`
cae a `title` / `prompt_brief` si no está declarado.

### Sprint

Objetivo del sprint vivo (`roadmap/current-sprint.json`), tareas completadas
(filtradas por `sprint_number` cuando las tasks lo declaran) y métricas.

### Roadmap

Render del `roadmap/roadmap.md` (mini-parser markdown XSS-safe) + historial
colapsable de sprints cerrados (`memory/sprint-log.md`).

### Chat

Feed cronológico de comunicación orquestador ↔ agentes. Se alimenta con
`node scripts/update_state.js say <from> <to> <message>`.

## Archivos del frontend

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura HTML plana: topbar, pestañas, tabla de tareas, contenedores de vistas. |
| `app.js` | Vanilla JS: fetch `/api/state`, render tabla + métricas, suscripción SSE, render de Sprint/Roadmap/Chat. Mini-parser markdown XSS-safe. |
| `style.css` | CSS plano limpio (modo oscuro legible). NO pixel-art. |

**Invariante XSS (ADR-02):** todo render de datos (`state`, `sprint`,
`roadmap`, `chat`) usa `textContent` / `createElement`. Nunca `innerHTML`
con datos.

## Conexión al server

1. **Carga inicial:** `GET /api/state` se llama una vez para pintar todo.
2. **Live updates:** `EventSource('/api/events')` (SSE). Cada evento `state`
   dispara un re-fetch + re-render. Eventos `chat-msg` actualizan el feed.
3. **Fallback:** si SSE falla repetidamente, polling cada 2 s contra
   `/api/state`. Indicador pasa a amarillo.
4. **Servidor caído:** indicador rojo con reintento.

## Limitaciones conocidas

### Costo USD es una estimación gruesa

Cuando el topbar muestra `~$`, multiplica `total_tokens_session` por
`USD 0.012 / 1k tokens`. Es el promedio mezclando input y output con
precios típicos de Claude Opus / Sonnet. **No distingue input vs output, no
distingue modelos, no incluye llamadas a Replicate / OpenAI Images / TTS**.
Sirve como orden de magnitud, no como factura. Si necesitas cifras
exactas, lee los logs de OpenRouter.

### `/files/<rel>` requiere localhost por default

El endpoint sirve archivos del repo solo bajo whitelist (ver "Endpoints"
abajo). Aun así, **no expongas el dashboard fuera de localhost sin un
proxy con auth** — la whitelist es un mitigante, no un sustituto.

## Endpoints (servidor)

- `GET  /api/state` — snapshot + memoria + contratos declarados.
- `POST /api/state` — merge atómico (bloqueado en modo público).
- `GET  /api/events` — SSE. Emite `state` en cada cambio de `state.json` + `chat-msg`.
- `GET  /api/history?limit=N` — últimos eventos del log NDJSON.
- `GET  /api/sprint` — lee `roadmap/current-sprint.json`.
- `GET  /api/roadmap` — lee `roadmap/roadmap.md` y devuelve `{ markdown }`.
- `GET  /api/sprints/history` — parsea `memory/sprint-log.md` → array de sprints cerrados.
- `POST /api/chat` — chat público. Persiste a `chat-log.jsonl` + emite SSE.
- `GET  /api/chat/history` — últimos N mensajes del chat.
- `GET  /files/<path-relativo>` — sirve archivos del repo en lectura, con
  guard de path-traversal **y whitelist explícita**.

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

## Modo público (read-only)

Activado con `DASHBOARD_PUBLIC=1`. Whitelist de métodos `GET`, `HEAD`,
`OPTIONS`. Cualquier otro método responde 403.
