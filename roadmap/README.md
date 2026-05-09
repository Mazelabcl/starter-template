# roadmap/ — columna organizativa del proyecto

El roadmap es donde vive **el camino del proyecto**: qué estamos haciendo ahora (sprint actual), qué viene después (preview), y qué se nos ocurrió mientras tanto (backlog + ideas crudas). Cuando un sprint cierra, su historia se mueve a `memory/sprint-log.md` — esa es la memoria histórica.

## Filosofía

1. **Un solo lugar para mirar.** El usuario abre `roadmap.md` y entiende el estado en 30 segundos.
2. **Captura sin desviar.** El comando `/idea` agrega ideas al backlog sin gatillar trabajo. Aldot puede tener una ocurrencia mientras debuggea, capturarla, y seguir.
3. **El sprint absorbe foco.** Las tareas del sprint actual son lo que se está haciendo. Todo lo demás es backlog y se evalúa al cerrar.
4. **Lo que se cierra, se aprende.** Al cerrar un sprint, lessons + entregables van a `memory/sprint-log.md`. Nada se pierde.

## Cómo se conecta con el resto

| Archivo | Rol | Quién escribe |
|---|---|---|
| `roadmap/roadmap.md` | Vista narrativa para humanos. Sprint + backlog + ideas. | `src/roadmap.js` (vía `/idea`, `/roadmap`) |
| `roadmap/current-sprint.json` | Fuente de verdad estructurada del sprint actual. | `src/roadmap.js` |
| `memory/sprint-log.md` | Historial de sprints cerrados con lessons. | `src/memory.js` (vía `addSprint`, llamado desde `closeSprint`) |
| `memory/active-team.json` | Skills/agentes activos. Independiente del roadmap. | `src/memory.js` |
| `dashboard/state.json` | Snapshot vivo de la sesión. Lee del roadmap para mostrar el sprint actual. | `dashboard/` (Sprint 2.2/2.3) |

`roadmap.md` y `current-sprint.json` se mantienen sincronizados por el módulo: cada vez que cambias el JSON, el módulo re-renderiza las secciones marcadas en el `.md`. Las marcas son comentarios HTML (`<!-- tasks-start -->` / `<!-- tasks-end -->`, etc.) que delimitan zonas autogeneradas — el resto del archivo es prosa que el humano puede editar libremente sin romper nada.

## Filosofía de la marca

El `.md` está diseñado para ser **legible primero**. No es JSON enmascarado de markdown: es un documento que un humano puede abrir, editar el texto entre marcadores, y aún así interactuar con el módulo. La verdad estructurada está en el JSON; el `.md` es la vista.

## Anti-patrones

- **No usar el roadmap como dump de todo.** Si tienes 80 ideas, el sistema falla. Filtra al cierre de cada sprint: lo que no entra a "alta" o "media", se descarta o pasa a "baja/wishlist". El backlog es para lo que sí harás.
- **No mezclar tasks ejecutables con ideas-deseo.** Una task tiene dueño y fecha objetivo. Una idea es opcional y queda en el backlog. Si tu sprint tiene "implementar dark mode" cuando todavía no decidiste si vale la pena, es idea, no task.
- **No editar `current-sprint.json` a mano.** Pasa por los helpers (`addTask`, `completeTask`, `prioritizeIdea`). El JSON y el `.md` se desincronizan si lo tocas directamente.
- **No reusar el sprint para todo.** Cuando cumple su objetivo, ciérralo con `/roadmap close`. Empezar uno nuevo es barato y mantiene el historial limpio.
- **No escribir lessons largos al cerrar.** Una línea por lección. La versión completa va a `memory/lessons.md` (vía `addLesson`).

## Slash commands

- `/idea <texto>` — captura idea cruda al backlog del sprint actual. No ejecuta nada. Idempotente: el mismo texto no se duplica.
- `/roadmap` — muestra el sprint actual + tareas + ideas crudas pendientes.
- `/roadmap close` — cierra el sprint actual con confirmación. Mueve a `memory/sprint-log.md`.
- `/roadmap priorize <idea>` — mueve una idea cruda a una sección priorizada (alta/media/baja). El comando pregunta cuál.

## Ejemplos

### Ejemplo 1 — Captura sin desviar

Aldot está debuggeando un problema con el `validator.js` y se le ocurre que el dashboard debería tener dark mode.

```
/idea agregar dark mode al dashboard
```

Claude responde: `Capturado en backlog: "agregar dark mode al dashboard". Sigues con tu tarea actual.`

Aldot continúa el debug. La idea queda en `roadmap.md`, sección "Ideas crudas".

### Ejemplo 2 — Priorizar y entrar al sprint siguiente

Al cerrar el sprint actual, Aldot revisa las ideas crudas:

```
/roadmap priorize agregar dark mode al dashboard
```

Claude pregunta: `¿Qué prioridad le doy: alta, media o baja?`. Aldot dice "media".

Resultado: la idea se mueve de "Ideas crudas" a "Backlog priorizado → Media prioridad" en `roadmap.md`. Cuando empiece el siguiente sprint, Aldot decide si la convierte en task con `addTask`.

### Ejemplo 3 — Cierre completo de sprint

```
/roadmap close
```

Claude muestra el resumen: Sprint 2 — "Sistema de roadmap", 3/3 tareas completadas, 4 ideas capturadas (2 priorizadas, 2 crudas). Pregunta lessons + entregables.

Aldot responde con 2 lessons. Claude llama `closeSprint({ lessons, deliverables })` que:
1. Empuja el sprint a `memory/sprint-log.md` con `addSprint(...)`.
2. Limpia `current-sprint.json` para el sprint 3.
3. Re-renderiza `roadmap.md` con header en blanco listo para el siguiente objetivo.

Claude responde: `Sprint 2 cerrado. Movido a memory/sprint-log.md. Listo para iniciar sprint 3 — ¿qué objetivo le pones?`.

## Inicialización

Al clonar el starter, `roadmap/roadmap.md` ya viene con la estructura básica (template inicial sin contenido). El comando `/kickoff` (Sprint 2.1) llena el sprint 1 con 2-3 tareas concretas extraídas de la entrevista al usuario. Después `/idea` y `/roadmap` ya operan normalmente.
