# Campos de project-profile.json

Documentación complementaria del schema `memory/schemas/project-profile.schema.json`.
Lee este archivo si necesitas entender qué llenar y por qué. La validación dura la
hace el schema; esto es la guía humana.

## project_type (requerido)

Uno de: `research | build | content | business | personal | mixed`.

- `research`: el output dominante son hallazgos, papers, deep-dives.
- `build`: se construye software, hardware, sistema técnico.
- `content`: storytelling, libros, video, audio, imagen.
- `business`: estrategia, marketing, ventas, operaciones.
- `personal`: vida del owner — finanzas, salud, hobbies estructurados.
- `mixed`: cuando no se puede reducir a una categoría dominante. Usar con criterio.

## mode (requerido)

Uno de: `rapido | profundo`.

- `rapido`: iteración corta, sin pipeline-v2 completo. Para PoCs y scratch.
- `profundo`: cada deliverable pasa pipeline-v2 (architect → critic → cold-reader).

## description (requerido)

Una sola línea, máximo 240 caracteres. Si necesita más, va en `docs/`, no acá.

## created_at (requerido)

ISO 8601 con timezone. Ej: `2026-05-08T14:30:00.000Z`.

## owner (requerido)

Email o handle del dueño del proyecto.

## skills_activas (requerido)

Array de slugs (no objetos). Ej: `["kickoff", "pipeline-v2", "image-gen"]`.

## agentes_activos (requerido)

Array de nombres. El detalle (rol, modelo, métricas) vive en `active-team.json`.
Acá solo va el nombre — duplicarlo es redundante pero hace la lectura del
profile autosuficiente sin abrir el segundo archivo.

## sprint_inicial (requerido)

Identificador del primer sprint del proyecto. Ej: `sprint-0-discovery`.
Los sprints siguientes se loguean en `sprint-log.md`, no acá.

## tags (opcional)

Etiquetas libres. Ej: `["mazelab", "interno", "trading"]`.
