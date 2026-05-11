# Dashboard v3

Pixel-art office scene en Phaser 3. Pixel-art ↔ `state.json` en vivo vía SSE.

**Estado:** v3.0 completo — fases 1-7 implementadas. Avatares dinámicos con label flotante, side panel rico con drill-down por agente, vista de Sprint con hitos cruzados contra tasks, vista Roadmap macro con render markdown XSS-safe + historial de sprints colapsable.

## Quick start

```bash
npm install
npm run dashboard:assets    # primera vez: baja pack CC0 default (Kenney)
npm run dashboard
# abre http://localhost:7777
```

`npm run dashboard:assets` solo es necesario la primera vez (o cuando borras `assets/vendor/`). El default es `kenney-roguelike`.

## Endpoints

| Endpoint | Qué hace |
|---|---|
| `GET /` | Sirve el frontend estático (Phaser 3 + ESM). |
| `GET /api/state` | Snapshot completo: tasks, eventos, métricas, memoria derivada. |
| `GET /api/events` | Server-Sent Events; emite cuando `state.json` cambia. |
| `POST /api/state` | Merge atómico (validación básica). Bloqueado en modo público. |
| `GET /api/history` | Últimos 100 eventos persistidos del session log. |
| `GET /api/sprint` | Lee `roadmap/current-sprint.json` y lo devuelve (200 con `{}` si no existe). |
| `GET /api/roadmap` | Lee `roadmap/roadmap.md` y devuelve `{ markdown: "<contenido>" }`. 200 con `{ markdown: "" }` si no existe. |
| `GET /api/sprints/history` | Parsea `memory/sprint-log.md` y devuelve array de sprints cerrados ordenado descendente por número. 200 con `[]` si no existe. |
| `GET /api/pack-name` | Nombre del pack activo. |
| `GET /assets/<rel>` | Binarios CC0 con whitelist. |
| `GET /files/<rel>` | Archivos del repo bajo subcarpetas permitidas. |

## Schema extendido del task

Aditivos retro-compatibles. Tasks sin estos campos siguen funcionando — el server inyecta defaults seguros.

### v2.1 (fase 6 expandida) — drill-down por agente

| Campo | Tipo | Default | Uso |
|---|---|---|---|
| `prompt_brief` | string \| null | `null` | Brief en lenguaje humano del prompt completo. Se muestra como BRIEF en el side panel. Si está ausente, el panel cae a `summary` y luego a `title`. |
| `plan_steps` | string[] | `[]` | Pasos planificados que el agente declara seguir. Se renderiza como lista numerada en la sección PLAN del panel. |
| `current_step` | integer | `0` | Índice 0-based del paso actual. Marca con ▶ el paso vivo; ✓ los anteriores; ○ los siguientes. |

### v2.2 (fase 7) — agrupación organizativa

| Campo | Tipo | Default | Uso |
|---|---|---|---|
| `phase` | string \| null | `null` | Fase del proyecto en la que vive la task (ej. `"design"`, `"build"`, `"validate"`). Se muestra en la sección CONTEXTO ORGANIZATIVO del panel agente, y agrupa las tareas completadas en la vista Sprint cuando alguna las declara. |
| `epic` | string \| null | `null` | Épica que agrupa varias tasks bajo un objetivo mayor (ej. `"dashboard-v3"`). Acompaña a `phase` en el panel agente y aparece como sufijo `[epic]` en la vista Sprint. |

### Declarar plan + brief + phase/epic al iniciar la task

CLI flags (sintaxis natural):
```bash
node scripts/update_state.js task-start demo-1 ArchitectAgent "Arquitecto" "Sistema de auth" auth.js \
  --prompt "Diseñar el sistema de auth con OAuth2" \
  --plan-step "Investigar opciones" \
  --plan-step "Elegir librería" \
  --plan-step "Implementar flujo" \
  --plan-step "Tests" \
  --current-step 0 \
  --phase design \
  --epic dashboard-v3
```

JSON patch en mitad del trabajo (avanza el paso actual sin reiniciar):
```bash
node scripts/update_state.js task-update demo-1 '{"current_step":1}'
```

Patch combinado (cambia plan + brief + phase/epic):
```bash
node scripts/update_state.js task-update demo-1 \
  '{"prompt_brief":"Diseñar auth OAuth2","plan_steps":["Investigar","Elegir","Implementar","Tests"],"current_step":2,"phase":"build","epic":"auth-system"}'
```

Para limpiar phase o epic, pasa `null`:
```bash
node scripts/update_state.js task-update demo-1 '{"phase":null,"epic":null}'
```

## Side panel

Tres modos accesibles desde la barra de modo en el header del panel:

- **Agente** — click en cualquier avatar abre el panel acá: brief, plan, task actual (id/gate/origin/tokens), contexto organizativo (fase/épica) cuando se declaran, entregables, eventos recientes.
- **Sprint** — botón `Sprint` en la topbar (esquina superior derecha): objetivo, hitos planificados cruzados con tasks completadas, tareas done (agrupadas por phase cuando se usa), entregables agrupados del sprint, métricas.
- **Roadmap** — botón `Roadmap` en la topbar: render del `roadmap/roadmap.md` como texto pixel-art monoespaciado + historial colapsable de sprints cerrados leído de `memory/sprint-log.md`.

Cierre del panel: tecla **ESC**, click fuera del card, o botón **×**.

### Cruce de hitos con tasks

El frontend acepta varios shapes para los milestones del sprint:

1. `sprint.milestones[]` — array de `{ title, task_id?, status? }`.
2. `sprint.hitos[]` — alias en español, mismo shape.
3. **Fallback (shape real actual):** si no hay milestones formales, se usan `sprint.tasks[]` como hitos implícitos. Cada `task.title` se vuelve un milestone con `task_id = task.id`.

Match contra `state.active_tasks[]`:
- Si `milestone.task_id` matchea `task.id` → status derivado del task (`completed` → done, `running` → in_progress, otro → planned).
- Si no, se respeta `milestone.status` declarado explícito.
- Si no, aprox-match por `title` contra `task.summary || task.title || task.id` (lowercase, igualdad o inclusión).
- Si nada matchea → `planned`.

### Render del roadmap.md

Mini-parser markdown XSS-safe en `dashboard/public/ui/panel.js` (función `renderMarkdownToDOM`). Soporta:

- `# H1`, `## H2`, `### H3` → `<h1/h2/h3>` con `textContent`
- `- bullet` o `* bullet` → `<ul><li>` (bullets consecutivos se agrupan)
- `**bold**` → `<strong>` intercalado con texto plano
- Comentarios HTML (`<!-- ... -->`) → ignorados (son marcadores internos de `src/roadmap.js`, no contenido)
- Líneas en blanco → break visual
- Cualquier otra línea → `<p>` con `textContent`

**Invariante ADR-02:** ningún render usa `innerHTML` con datos del state. Cubierto por test `dashboard-roadmap-render.test.js` que hace grep contra `\.innerHTML\s*=` en `panel.js`.

### Parser de `memory/sprint-log.md`

`GET /api/sprints/history` parsea sprints cerrados con el siguiente shape esperado:

```markdown
## Sprint 1 — Fundamentos del pipeline

**Fechas**
- inicio: 2026-05-01
- fin: 2026-05-08

**Entregables**
- contracts/
- memory/

**Lessons**
- schemas compartidos evitan reescribir validación
```

El parser es defensivo:
- Cada bloque empieza con `## Sprint <N>` (cualquier cosa después del N es objetivo opcional).
- Sub-bloques aceptados: `Objetivo`/`Objective`, `Fechas`/`Dates`, `Entregables`/`Deliverables`, `Lessons`/`Lecciones`.
- Sub-headers `**Texto**` o `### Texto` ambos válidos.
- Bullets con `-` o `*`.
- Si el archivo no existe → retorna `[]` con 200.

## Modo público (read-only)

Activado con `DASHBOARD_PUBLIC=1`. Whitelist de métodos `GET`, `HEAD`, `OPTIONS`. Cualquier otro método responde 403 con `{"error":"read-only mode"}` antes de entrar a los handlers.

```bash
# POSIX
DASHBOARD_PUBLIC=1 node dashboard/server.js

# Windows PowerShell
$env:DASHBOARD_PUBLIC = '1'; node dashboard/server.js
```

## Pack customization

Por defecto el dashboard usa el pack `kenney-roguelike` (CC0, descargado por `npm run dashboard:assets`).

Para usar un pack propio:

1. Crear `assets/vendor/<mi-pack>/` con la estructura del manifest declarado en `contracts/schemas/assets-pack.schema.json`.
2. Arrancar con la env var: `DASHBOARD_PACK=mi-pack npm run dashboard`.

El resolver intenta primero `/assets/vendor/<pack>/manifest.json` y cae a `/assets/packs/<pack>/manifest.json` si no encuentra binarios. El nombre del pack se sanitiza contra la regex `^[a-z0-9][a-z0-9-]*$` antes de construir el path.

## Migración desde v2 (kanban)

El dashboard v2 quedó en el tag git `dashboard-v2-final`. Para recuperar:

```bash
git checkout dashboard-v2-final -- dashboard/public/
```

Esto reescribe `dashboard/public/` con la versión v2. Para volver a v3 sin pull: `git checkout HEAD -- dashboard/public/`.
