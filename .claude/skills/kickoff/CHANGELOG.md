# kickoff — changelog

## v3 — 2026-05-09 (Sprint 2.1)

### Cambios estructurales

- **Adaptatividad real.** La v2 hacía 6 preguntas fijas en orden (audiencia, outputs, tono, restricciones, referencias). La v3 detecta señales en la frase inicial del usuario y bifurca a una de 6 ramas (research / build / content / business / personal / mixed) con su propio set de preguntas. Dos usuarios distintos NO reciben las mismas preguntas.
- **Detector determinístico.** La detección vive en `detector.js` (regex sobre lowercase del input). No usa LLM — es pura, testeable y predecible. Devuelve `{ type, size, output, confidence, evidence }`.
- **Recomendación de stack justificada.** El kickoff propone skills relevantes para el proyecto con un `why` de 1 línea por cada una. Antes solo escribía principles.md sin ayudar a elegir herramientas.
- **Persistencia integrada con memory.js.** Al confirmar, llama `writeProfile`, `addSkill`, `addSprint` con el sprint inicial. El project-profile.json queda válido contra el schema. Antes solo se creaban dos `.md`.
- **Roadmap inicial.** Crea `roadmap/roadmap.md` con sprint 1 abierto y backlog vacío. Sprint 2.4 lo enriquecerá.
- **Confianza explícita.** Si `confidence < 2`, repregunta con opción cerrada antes de bifurcar. La v2 no manejaba ambigüedad: empezaba el cuestionario igual.
- **Reversibilidad.** El usuario puede pedir "reinicia" o "vuelve atrás" en cualquier punto. Nada se persiste hasta confirmación final.

### Cambios de tono / UX

- **Saludo de UNA línea.** La v2 abría con un párrafo educativo de 6 puntos sobre cómo funciona el sistema. La v3 abre con una sola pregunta y construye confianza por el flujo, no por el discurso.
- **Sin checks técnicos previos.** La v2 corría pre-flight checks (node_modules, .env, .venv) antes de la primera pregunta. La v3 los delega al orquestador post-perfil — la primera interacción es escuchar.
- **Máximo 4-5 preguntas adaptativas.** La v2 aspiraba a 6 fijas. La v3 acota duro. Si necesitas más detalle, lo descubres en la primera tarea.

### Cambios técnicos

- Frontmatter: añadido `Edit` a `allowed-tools` (necesario para sustituir placeholders en templates).
- Templates pre-pobladas en `content/principles.template.md` y `content/INDEX.template.md`. La skill las copia y rellena.
- `detector.js` exporta: `detectSignals`, `recommendStack`, `recommendMode`, `suggestInitialSprint`, `CORE_SKILLS`. Reusable por el test de integración y por el dashboard del Sprint 2.2.

### Lo que se conserva de v2

- Estructura del `principles.md` (qué ES / qué NO ES / audiencia / tono / outputs / restricciones).
- Estructura del `INDEX.md` (tabla de carga obligatoria por tarea).
- Filosofía: "principles literal al tope de cada brief".
- Idioma español neutro estricto.

### Migración

Repos con kickoff v2 ya corrido: `content/principles.md` sigue siendo válido. Lo nuevo es `memory/project-profile.json`. Para hidratar un proyecto v2 a v3, corre `/kickoff` con el flag implícito de "ajustar perfil" (la skill detecta `principles.md` existente y propone reusar su contenido al construir el perfil).

## v2 — 2026-05-06

Primera versión. Pre-flight checks + 6 preguntas lineales + escritura de `principles.md` + `INDEX.md`. Sin perfil persistente ni recomendación de skills.
