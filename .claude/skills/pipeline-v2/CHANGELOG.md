# pipeline-v2 — CHANGELOG

## v3.0 — 2026-05-09 (Sprint 1.3)

Filosofía intacta: 5 capas, cold-reader independiente, humano final. Lo que cambia es cómo se transita entre capas y cómo el pipeline aprende del proyecto.

### Agregado

- **Hand-off contracts en cada transición entre capas.** Cada capa que produce output llama `emitOutput(agent, schemaId, output, path)` desde `contracts/helpers.js`, que valida contra JSON Schema antes de escribir a disco. Cada capa que consume llama `consumeInput(agent, expectedSchemaId, path)`, que re-valida antes de procesar. Si falla, lanza `ContractViolation` con mensaje legible.
- **Schemas vinculados a las capas** (`contracts/schemas/`):
  - Capa 1 emite `architect-output`.
  - Capa 2 emite `critic-output` y consume `architect-output`.
  - Capa 3 emite `cold-reader-output` y consume `architect-output`.
- **Declaración explícita de contratos.** Cada agente que se invoca por primera vez en el proyecto llama `declareContract({ agent, inputs, outputs, preconditions, postconditions })`. Persiste en `contracts/declared/<agent>.json` para auditoría.
- **Carga de memoria al inicio del flujo.** La skill llama `summarize()` desde `src/memory.js` siempre. Si `has_profile === false`, frena y propone `/kickoff`. Decisiones y lecciones se cargan literal solo cuando aplican a la tarea.
- **Registro de uso de agentes.** Cada invocación llama `touchAgent(name)` (mantiene `total_invocaciones` y `ultimo_uso`). Agentes nuevos se registran con `addAgent`.
- **Decisiones y lecciones emergentes.** Override del veto cold-reader → `addDecision` obligatorio. Patrón de fallo identificable → `addLesson`.
- **Sección "Manejo de fallos contractuales"** con 3 opciones: reintentar con feedback del error, frenar y notificar al humano, saltar la capa con override explícito (registrado en `decisions.md`).
- **Tabla de hand-offs** explícita con schema y path típico para cada transición entre capas.
- **Test de integración** (`pipeline-v2-integration.test.js` en raíz del repo): simula los 5 hand-offs end-to-end con outputs ficticios, casos éxito y fallo.
- **`allowed-tools`** suma `Bash` para que la skill pueda invocar el CLI del validator (`node contracts/validator.js validate ...`) cuando sea más práctico que la API.

### Conservado de v0/v2

- Las 5 capas y su orden no negociable.
- Cold-reader independiente con veto absoluto y modelo idealmente distinto al architect.
- `principles.md` literal al tope de cada brief, no resumido.
- `INDEX.md` decide qué cargar.
- DIFF de pérdidas en R2+.
- Regla anti-watchdog para sub-agentes Opus en outputs largos.
- Modelo tracking en cada output.
- Validación multimodal obligatoria para imágenes.
- Refs declaradas deben mencionarse literal en el prompt.

### Breaking changes

Ninguno en términos de filosofía. Pero quien tenga código o agentes que escriban outputs del pipeline directo a disco con `fs.writeFile` (saltando `emitOutput`) ahora tiene que migrar:

- **Antes:** `writeFileSync('content/architect/cap03.json', JSON.stringify(proposal))`
- **Ahora:** `emitOutput('architect-pax', 'architect-output', proposal, 'content/architect/cap03.json')`

Si el output existente no cumple el schema, la migración revela el bug. Eso es exactamente lo que pipeline v2 (sin contratos) NO atajaba — el bug aparecía 2 capas después.

### Cómo migrar uso existente

1. Para cada agente que orquestes con esta skill, llama una vez `declareContract({...})` con su firma. Solo la primera vez. Las llamadas siguientes son no-op si el archivo ya existe.
2. Reemplaza escrituras directas a disco por `emitOutput`.
3. Reemplaza `JSON.parse(readFileSync(path))` antes de procesar input por `consumeInput`.
4. Al inicio de tu flujo, agrega `summarize()`. Si `has_profile === false`, propón `/kickoff` antes de continuar.
5. En cada invocación de agente, agrega `touchAgent(name)` (o `addAgent` si es nuevo).
6. Cierra el flujo con un `addLesson` si emergió un patrón, o con un `addDecision` si el humano hizo override.
7. Corre `node pipeline-v2-integration.test.js` desde la raíz del repo para confirmar que la integración funciona.

### Compatibilidad hacia atrás

Si una capa NO usa los contratos (ej. una skill custom que no sabe de `emitOutput`), no rompe nada — pero pierdes la garantía. Los contratos son opt-in en términos de implementación, mandatorios en términos de skill: si esta skill orquesta el flujo, todos los hand-offs pasan por contract.

## v0 — 2026-05-06

Versión inicial derivada del manual portable. 5 capas, cold-reader independiente, regla anti-watchdog. Sin contratos, sin memoria.
