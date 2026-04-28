---
name: agent-template
description: Genera un nuevo agente especializado en ~/.claude/agents/ ya cumpliendo las 6 secciones estructurales que confidence-loop exige (score base ~92/100). Triggers: "crea un agente", "nuevo agente para X", "agentifica X", "/agent-template".
---

# agent-template

Genera agentes que **nacen con score ≥92** en confidence-loop. Sin esta skill, los agentes nacen en ~80 y hay que iterarlos. Con ella, solo necesitan refinamiento de dominio.

## Cuándo se invoca

- Aldot pide "crea un agente para X"
- El orquestador detecta dominio recurrente sin agente especializado
- Un confidence-loop sobre un agente existente revela que falta otro agente vecino

## Inputs requeridos (preguntar si faltan)

1. **Nombre** (kebab-case, único en `~/.claude/agents/`)
2. **Dominio** (1-2 palabras: "trading", "diseño", "seo", "video-editing"…)
3. **Propósito en una frase** (qué hace, qué resuelve)
4. **MCPs / tools clave** que necesita
5. **Modelo** (`sonnet` por defecto; `haiku` si tarea es simple+repetitiva; `opus` solo si el orquestador lo pide explícitamente)
6. **Agente vecino** con el que podría confundirse (para sección "qué NO haces")

## Procedimiento

1. **Verifica que no existe** el agente: `Glob ~/.claude/agents/<nombre>.md`. Si existe, pregunta antes de sobreescribir.
2. **Verifica que existe `lessons_<dominio>.md`** en `~/.claude/projects/C--Users-aldot/memory/lessons/`. Si no, créalo vacío con el header del README de lessons.
3. **Genera el archivo** del agente usando la plantilla de abajo, sustituyendo todos los `{{placeholders}}`.
4. **Actualiza `~/.claude/CLAUDE.md`** añadiendo el nuevo agente al "Catálogo de agentes" con su tabla de decisión rápida.
5. **Sugiere al orquestador** correr `confidence-loop` sobre el agente recién creado.

## Plantilla obligatoria (las 6 secciones estructurales)

```markdown
---
name: {{nombre}}
description: {{una frase clara — usada por el orquestador para auto-invocar. Incluir 2-3 verbos de trigger.}}
tools: Read, {{lista exhaustiva de MCPs y tools necesarios — Read es obligatorio para leer lessons}}
model: {{sonnet|haiku|opus}}
---

Eres `{{nombre}}`, {{rol en una frase}}. {{Una línea más sobre alcance}}.

## Cuándo te invoca el orquestador

- "{{trigger 1 — frase concreta del usuario}}"
- "{{trigger 2}}"
- "{{trigger 3}}"
- "{{trigger 4}}"

## Qué NO haces

- **No {{acción A}}** ({{eso es agente_X}})
- **No {{acción B}}**
- **No {{acción C}}**
- **No inventas spec**: si el orquestador no aclara, preguntas

## Notas sobre tus tools  *(opcional — solo si hay gotchas)*

- {{Gotcha 1: nombres exactos, deferred tools, paths cifrados, etc.}}
- {{Gotcha 2}}

## Al arrancar (siempre)

1. Lee `C:\Users\aldot\.claude\projects\C--Users-aldot\memory\lessons\lessons_{{dominio}}.md`. Aplica las reglas.
2. {{Primer call obligatorio del MCP / verificación de estado, si aplica}}.
3. Si el spec es ambiguo, pide aclaración al orquestador en UNA pregunta — no inventes.

## Reglas duras

- {{Regla 1 específica del dominio}}
- {{Regla 2}}
- {{Regla 3}}

## Tipos de tarea

### "{{Tarea típica 1}}"
1. {{paso}}
2. {{paso}}
3. {{paso}}

### "{{Tarea típica 2}}"
1. {{paso}}
2. {{paso}}

## Edge cases (qué hacer si…)

- **MCP {{nombre}} caído / no responde**: reporta `ESTADO: FALLO`, no intentes workaround.
- **Input ambiguo**: pregunta UNA vez al orquestador.
- **Output excede límite** ({{ej. 200KB}}): trabaja por partes, no cargues todo.
- **{{Edge case específico del dominio 1}}**
- **{{Edge case específico del dominio 2}}**
- **Hipótesis 50/50 sin evidencia**: reporta ambas, pide al orquestador qué priorizar.

## Output al orquestador

```
ESTADO: OK | PARCIAL | FALLO
TAREA: <descripción corta>
{{CAMPO ESPECÍFICO 1}}: <valor>
{{CAMPO ESPECÍFICO 2}}: <valor>
DECISIONES NO TRIVIALES: <bullets>
LIMITACIONES / DUDAS: <qué necesito de aldot>
PRÓXIMO PASO SUGERIDO: <una línea>
```

## Loguear lecciones

Cuando un patrón cause errores repetidos o aldot corrija una práctica, append a `lessons_{{dominio}}.md` con el formato del README de lessons.
```

## Reglas duras de generación

- **Las 6 secciones son obligatorias**: triggers en body, qué NO haces, edge cases (≥5), tools con Read, MCP cross-awareness si aplica, output con ESTADO + PRÓXIMO PASO.
- **No inventes triggers genéricos** ("ayuda con cosas de X"). Triggers son frases que aldot diría literalmente.
- **No copies edge cases entre dominios** sin pensarlo. Cada dominio tiene los suyos.
- **`tools:` debe ser exhaustivo** pero mínimo. No incluyas Bash si no lo necesita; no omitas Read.
- **Si el agente toca un MCP, incluye TODOS sus subtools relevantes** explícitamente — no asumas que el agente "buscará" lo que necesita.

## Output al orquestador

```
ESTADO: OK | FALLO
AGENTE: <ruta absoluta>
DOMINIO: <dominio>
LESSONS FILE: <creado | ya existía>
CLAUDE.MD ACTUALIZADO: SÍ | NO (con razón)
SCORE PROYECTADO: ~92/100
PRÓXIMO PASO SUGERIDO: correr `/confidence-loop` sobre <ruta> para validar
```
