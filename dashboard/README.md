# Dashboard de observabilidad multi-agente — v3 (Sprint 2.2)

Servidor HTTP nativo (cero deps) que expone el estado en vivo del sistema multi-agente.
Sprint 2.3 reemplazará el placeholder de UI por un kanban + métricas.

## Levantar

```bash
npm run dashboard
# o equivalente:
node dashboard/server.js
```

Puerto: `7777` por defecto. Override con `DASHBOARD_PORT=9000 npm run dashboard`.

URL: <http://localhost:7777/>

## Endpoints

### `GET /api/state`

Retorna el estado completo + campos derivados (memoria del proyecto y contratos).

```bash
curl -s http://localhost:7777/api/state | jq .
```

Estructura de respuesta:

```json
{
  "session_id": "uuid",
  "session_started_at": "ISO timestamp",
  "active_tasks": [ /* ver esquema abajo */ ],
  "events": [ /* últimos eventos en memoria, full history en /api/history */ ],
  "metrics": {
    "total_tokens_session": 0,
    "tasks_completed": 0,
    "tasks_failed": 0,
    "councils_invoked": 0,
    "images_generated": 0
  },
  "active_skills": ["skill-name"],
  "current_sprint": { "number": 2, "objective": "..." },
  "derived": {
    "memory_snapshot": { /* output de src/memory.js summarize() */ },
    "declared_contracts": ["ArchitectAlpha", "..."],
    "uptime_seconds": 42
  }
}
```

### `POST /api/state`

Merge atómico de un patch parcial contra state.json.

```bash
curl -X POST http://localhost:7777/api/state \
  -H 'Content-Type: application/json' \
  -d '{"active_skills": ["pipeline-v2", "image-gen"]}'
```

Política de merge:

- `active_tasks`, `events`, `active_skills` reemplazan completamente si vienen en el patch.
- `metrics` hace shallow merge (solo overrides explícitos).
- `current_sprint`, `session_id`, `session_started_at` reemplazan.
- Eventos nuevos detectados (por `timestamp+type`) se persisten también en `dashboard/history/events.log`.

### `GET /api/events`

Server-Sent Events stream. Emite el evento `state` cuando `state.json` cambia (vía `fs.watch`).

Cliente:

```js
const es = new EventSource('/api/events');
es.addEventListener('state', () => fetch('/api/state').then(r => r.json()).then(render));
```

Si SSE no está disponible (proxy hostil, etc.), Sprint 2.3 puede caer a polling cada 2s sobre `/api/state`.

### `GET /api/history?limit=100`

Últimos N eventos persistidos en `dashboard/history/events.log` (NDJSON append-only). Default 100, máximo 1000.

```bash
curl -s 'http://localhost:7777/api/history?limit=20' | jq .
```

## Esquema completo de `state.json`

```json
{
  "session_id": "uuid-v4",
  "session_started_at": "ISO timestamp",
  "active_tasks": [
    {
      "id": "task-uuid",
      "title": "string",
      "agent": "agent-name",
      "agent_role": "actúa como ...",
      "status": "queued|running|completed|failed",
      "files_in_use": ["path1"],
      "started_at": "ISO",
      "ended_at": "ISO | null",
      "tokens_estimated": 0,
      "skill_invoked": "skill-name | null",
      "failure_reason": "(opcional) string si status=failed"
    }
  ],
  "events": [
    {
      "timestamp": "ISO",
      "type": "task_started|task_completed|task_failed|agent_invoked|skill_invoked|decision_emitted|hand_off_validated|hand_off_failed|council_invoked|image_generated",
      "payload": { "...": "..." }
    }
  ],
  "metrics": {
    "total_tokens_session": 0,
    "tasks_completed": 0,
    "tasks_failed": 0,
    "councils_invoked": 0,
    "images_generated": 0
  },
  "active_skills": ["skill-name"],
  "current_sprint": { "number": 2, "objective": "..." }
}
```

## Cómo deben usarlo los agentes

Usar el helper `scripts/update_state.js`. Cada agente, al arrancar y al terminar, ejecuta los comandos correspondientes. El helper escribe `state.json` atómicamente y, si el servidor está vivo, también notifica vía POST.

```bash
# Al empezar una tarea
node scripts/update_state.js task-start <task-id> <agent> "<agent-role>" "<title>" file1.js file2.js

# Al terminar OK
node scripts/update_state.js task-complete <task-id> 12000

# Al fallar
node scripts/update_state.js task-fail <task-id> "razón corta del fallo"

# Eventos arbitrarios
node scripts/update_state.js event council_invoked '{"voices": 4}'
node scripts/update_state.js event image_generated '{"asset": "hero-shot.png"}'

# Skills entrando/saliendo del set activo
node scripts/update_state.js skill-add pipeline-v2
node scripts/update_state.js skill-remove pipeline-v2
```

Exit code 0 si OK, 1 si fallo. Mensajes de error en español neutro a `stderr`.

## Robustez

- Si `state.json` no existe, `/api/state` retorna estado inicial vacío sin crashear.
- Si `state.json` se corrompe, el server loguea y retorna estado inicial; el helper falla rápido y pide reparación manual.
- Escrituras siempre atómicas (`tmp + rename`), seguras ante kill mid-write.
- CORS abierto a todos los orígenes (uso local).

## Auto-update vía hooks

El template trae un par de hooks de Claude Code que escriben al dashboard automáticamente cada vez que Claude lanza un sub-agente con la herramienta `Agent`. No tienes que hacer nada manual: en cuanto un agente arranca, aparece como tarea `running` en el dashboard; en cuanto termina, pasa a `completed` (o `failed` si la tool reportó error).

### Qué hace el hook

- `.claude/settings.json` registra dos hooks: `PreToolUse` y `PostToolUse`, ambos filtrados por `matcher: "Agent"`.
- El comando del hook es `node "$CLAUDE_PROJECT_DIR/scripts/dashboard_hook.js" pre|post`.
- El wrapper:
  1. Lee el JSON del hook por stdin (incluye `tool_use_id`, `tool_input.prompt`, `tool_input.subagent_type`, `tool_input.description`, y en `post` también `tool_response`).
  2. Genera un `task_id` único en el `pre` y lo correlaciona con `tool_use_id` en `.cache/active-agents.json`. El `post` recupera el mismo `task_id` para cerrar la tarea correcta.
  3. Extrae `agent_role` del prompt buscando un patrón `ROL: <texto>` en los primeros 400 chars (fallback al primer renglón). Trunca a 100 chars.
  4. Llama a `node scripts/update_state.js task-start | task-complete | task-fail` con los args correctos.
  5. Logea cada invocación a `dashboard/hooks.log` (NDJSON, una línea por evento).

### Cómo verificar que está funcionando

```bash
# Mira los logs en vivo mientras Claude trabaja
tail -f dashboard/hooks.log

# O dispara el test integral
node dashboard-hooks.test.js
```

Cuando Claude lanza un Agent, deberías ver una línea `{"level":"info","msg":"hook ejecutado","mode":"pre",...}` y, al terminar, otra con `"mode":"post"`.

### Cómo desactivarlo

Si los hooks interfieren (por ejemplo si vas a hacer demos sin red, o el dashboard te da igual en una sesión puntual), basta con renombrar el archivo de settings:

```bash
mv .claude/settings.json .claude/settings.json.disabled
```

Reinicia Claude Code para que tome el cambio. Para reactivarlo, renombra al revés.

Alternativa quirúrgica: comenta solo la sección `hooks` dentro del JSON.

### Limitaciones conocidas

- **Solo funciona dentro del repo.** El `.claude/settings.json` es local al proyecto. Si abres Claude Code desde otra carpeta, no se aplica.
- **La primera vez Claude Code puede pedir confirmación** para cargar el settings de proyecto y/o para ejecutar comandos `node` desde un hook. Acepta una vez y queda persistido.
- **Fail-safe estricto:** si `update_state.js` falla, el dashboard no está corriendo, o el spawn revienta — el hook igual sale con exit 0 y NO bloquea al Agent. Errores quedan en `dashboard/hooks.log` (rotación automática a `hooks.log.1` cuando supera 1 MB).
- **Correlación PreToolUse ↔ PostToolUse vía `tool_use_id`.** Si Claude Code cambia el campo en el futuro, el `post` no encontraría la tarea y simplemente no haría nada (queda visible en el dashboard hasta el próximo cierre manual).
- **No instrumenta otras herramientas.** Solo `Agent`. Si quieres trackear `Bash`, `Edit`, etc., agrega más entradas con su propio `matcher`.
