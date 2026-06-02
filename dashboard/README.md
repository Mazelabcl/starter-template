# Dashboard v3 — HTML simple de estado

Dashboard HTML plano (vanilla JS, cero deps de frontend) que muestra el estado en vivo de los agentes leyendo `state.json` vía `/api/state` + SSE.

**Estado:** v4 — degradado desde el pixel-art Phaser (decisión D8). El frontend Phaser nunca se usó en la práctica; la review-app HTML es la superficie preferida del usuario. El backend (server.js, endpoints, SSE, chat) se conservó intacto. El frontend ahora es una tabla de estado + pestañas Sprint / Roadmap / Chat, sin dependencias ni assets binarios.

## Quick start

```bash
npm install
npm run dashboard
# abre http://localhost:7777
```

No necesita bajar assets ni packs — es HTML estático servido por el server Node nativo.

## Qué muestra

- **Tareas** (vista por defecto): tabla en vivo con columnas Agente, Estado, Modelo, Tokens, Summary. Lee `/api/state` y se refresca por SSE cuando `state.json` cambia. Barra de métricas (tokens, done, failed, councils) en el header.
- **Sprint**: objetivo del sprint vivo (`roadmap/current-sprint.json`), tareas completadas (filtradas por `sprint_number` cuando las tasks lo declaran) y métricas.
- **Roadmap**: render del `roadmap/roadmap.md` (mini-parser markdown XSS-safe) + historial colapsable de sprints cerrados (`memory/sprint-log.md`).
- **Chat**: feed cronológico de comunicación orquestador ↔ agentes.

## Archivos del frontend

| Archivo | Qué hace |
|---|---|
| `public/index.html` | Estructura HTML plana: topbar, pestañas, tabla de tareas, contenedores de vistas. |
| `public/app.js` | Vanilla JS: fetch `/api/state`, render tabla + métricas, suscripción SSE, render de las pestañas Sprint/Roadmap/Chat. Mini-parser markdown XSS-safe portado del panel viejo. |
| `public/style.css` | CSS plano limpio (modo oscuro legible). NO pixel-art. |

**Invariante XSS (ADR-02):** todo render de datos (`state`, `sprint`, `roadmap`, `chat`) usa `textContent` / `createElement`. Nunca `innerHTML` con datos.

## Endpoints

| Endpoint | Qué hace |
|---|---|
| `GET /` | Sirve el frontend HTML plano estático. |
| `GET /api/state` | Snapshot completo: tasks, eventos, métricas, memoria derivada. |
| `GET /api/events` | Server-Sent Events; emite `state` cuando `state.json` cambia + `chat-msg`. |
| `POST /api/state` | Merge atómico (validación básica). Bloqueado en modo público. |
| `GET /api/history` | Últimos 100 eventos persistidos del session log. |
| `GET /api/sprint` | Lee `roadmap/current-sprint.json` (200 con `{}` si no existe). |
| `GET /api/roadmap` | Lee `roadmap/roadmap.md` y devuelve `{ markdown }` (200 con `""` si no existe). |
| `GET /api/sprints/history` | Parsea `memory/sprint-log.md` → array de sprints cerrados (200 con `[]` si no existe). |
| `POST /api/chat` | Chat público. Body `{ from, to, message, timestamp? }`. Persiste a `chat-log.jsonl` + emite SSE `chat-msg`. |
| `GET /api/chat/history` | Últimos N mensajes del chat (default 200). |
| `GET /files/<rel>` | Archivos del repo bajo subcarpetas permitidas (whitelist + anti-traversal). |

## Chat público

Pestaña **Chat**: feed cronológico de comunicación entre orquestador y agentes.

```bash
node scripts/update_state.js say <from> <to> <message>
```

Ejemplos:
```bash
node scripts/update_state.js say architect orquestador "research done, escribiendo proposal"
node scripts/update_state.js say orquestador aldot "todos los tests verdes, listo para review"
```

- El helper escribe SIEMPRE al `chat-log.jsonl` local (incluso sin dashboard corriendo).
- Si el dashboard corre, además POSTea a `/api/chat` para SSE en vivo.
- Mensajes máx 4000 chars; control chars stripped; `from`/`to` máx 80 chars.
- Body siempre por `textContent` (XSS-safe).

## Schema extendido del task

Aditivos retro-compatibles. Tasks sin estos campos siguen funcionando — el server inyecta defaults seguros. Campos: `summary`, `prompt_brief`, `plan_steps[]`, `current_step`, `phase`, `epic`, `sprint_number`, `model`. La tabla de tareas muestra `agent`, `status`, `model`, `tokens_estimated`, `summary` (con fallback a `title`/`prompt_brief`).

Declarar al iniciar:
```bash
node scripts/update_state.js task-start demo-1 ArchitectAgent "Arquitecto" "Sistema de auth" auth.js \
  --prompt "Diseñar el sistema de auth con OAuth2" --plan-step "Investigar" --current-step 0 --phase design
```

Patch en mitad del trabajo:
```bash
node scripts/update_state.js task-update demo-1 '{"current_step":1,"phase":"build"}'
```

## Modo público (read-only)

Activado con `DASHBOARD_PUBLIC=1`. Whitelist de métodos `GET`, `HEAD`, `OPTIONS`. Cualquier otro método responde 403.

```bash
# POSIX
DASHBOARD_PUBLIC=1 node dashboard/server.js

# Windows PowerShell
$env:DASHBOARD_PUBLIC = '1'; node dashboard/server.js
```

## Rollback al pixel-art Phaser

El frontend Phaser pixel-art quedó en el tag git `v3.1-final`. Para recuperarlo:

```bash
git checkout v3.1-final -- dashboard/public/
```
