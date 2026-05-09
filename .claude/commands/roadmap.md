---
description: Muestra el roadmap actual o ejecuta acciones (close, priorize) sobre él
allowed-tools: Bash, Read
---

El usuario lanzó `/roadmap` con argumento: "$ARGUMENTS".

Reglas de despacho según el primer token de `$ARGUMENTS`:

## Caso 1 — sin argumento (mostrar)

Lee y resume:

```bash
node -e "import('./src/roadmap.js').then(m => { console.log(JSON.stringify(m.summarize(), null, 2)); })"
```

Y muestra el roadmap.md crudo (es legible para humanos):

```bash
cat roadmap/roadmap.md
```

Responde con:
- Sprint actual + número + objetivo + estado
- Tareas (pending vs completed)
- Cuántas ideas crudas hay pendientes de priorizar
- Una sugerencia: si hay ideas crudas, recordar al usuario que puede correr `/roadmap priorize <idea>` al cierre del sprint.

## Caso 2 — `close`

El usuario pide cerrar el sprint actual. Pide confirmación PRIMERO:

1. Muestra el resumen de lo que se cerrará: número de sprint, objetivo, tareas completadas vs pendientes, ideas capturadas.
2. Pregunta: "¿Confirmas el cierre del sprint? Necesito (a) lessons emergentes (1-3 bullets) y (b) entregables (opcional, si vacío usaré las tareas completadas)."
3. Espera respuesta. Si el usuario confirma, llama:

```bash
node -e "import('./src/roadmap.js').then(m => { const r = m.closeSprint({ lessons: JSON.parse(process.argv[1]), deliverables: JSON.parse(process.argv[2]) }); console.log(JSON.stringify(r)); })" -- '<JSON-array-lessons>' '<JSON-array-deliverables>'
```

4. Reporta: "Sprint N cerrado. Movido a memory/sprint-log.md. Listo para iniciar sprint N+1 — ¿qué objetivo le pones?"

## Caso 3 — `priorize <idea>` (también acepta `prioritize`)

El usuario quiere mover una idea cruda a una sección priorizada.

1. El texto de la idea es todo lo que viene después de `priorize` o `prioritize`.
2. Pregunta al usuario: "¿Qué prioridad le doy: alta, media o baja?"
3. Espera respuesta. Llama:

```bash
node -e "import('./src/roadmap.js').then(m => { const r = m.prioritizeIdea({ ideaText: process.argv[1], newPriority: process.argv[2] }); console.log(JSON.stringify(r)); })" -- "<idea>" "<alta|media|baja>"
```

4. Confirma con una línea: "Idea movida a prioridad <X>. Sigues con tu tarea actual."

## Caso 4 — argumento desconocido

Responde con la lista de subcomandos válidos: `(vacío)`, `close`, `priorize <idea>`. No inventes acciones.

REGLAS DURAS:
- Idioma: español neutro. Cero voseo.
- `/roadmap close` SIEMPRE pide confirmación antes de escribir a `memory/sprint-log.md`.
- No mezcles los outputs JSON crudos en la respuesta final — sintetiza para el humano.
