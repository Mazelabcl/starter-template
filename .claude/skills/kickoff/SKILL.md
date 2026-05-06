---
name: kickoff
description: Entrevista al usuario al iniciar un proyecto y autogenera content/principles.md + content/INDEX.md. Triggers "/kickoff", "vamos a empezar", "nuevo proyecto", "qué construimos hoy".
allowed-tools: Read, Write, Glob
---

# kickoff — entrevista inicial del proyecto

**Esta es la primera skill que corre en un proyecto nuevo.** Sin esto, los agentes drifteán porque no hay un canon corto que guíe.

## Cuándo invocarla

- Usuario clona el starter por primera vez y dice algo tipo "tengo una idea", "vamos a empezar", "qué hacemos"
- Slash command `/kickoff` explícito
- `content/principles.md` no existe o está vacío

## Cuándo NO invocarla

- Si `content/principles.md` ya existe con contenido válido — pregunta antes de sobrescribir.
- Si el usuario solo quiere hacer una pregunta puntual no relacionada al proyecto.

## Cómo opera

### Paso 1 — entrevista (haz UNA pregunta a la vez, espera respuesta)

Tono: directo, simple, novato-friendly. Español neutro (cero voseo).

Preguntas en este orden:

1. **"¿Qué quieres construir / diseñar / pensar / desarrollar?"** (deja que se explaye libre)
2. **"¿Para quién es?"** (audiencia, cliente, uso interno, público general)
3. **"¿Qué outputs concretos esperas tener al final?"** (ej. video de 1 min, web landing, set de imágenes, plan de contenidos, app, doc, etc.)
4. **"¿Qué tono / estilo?"** (formal, casual, juguetón, técnico, místico, etc.)
5. **"¿Hay restricciones duras?"** (deadline, presupuesto, lo que SÍ debe pasar, lo que NUNCA debe pasar)
6. **"¿Hay referencias inspiradoras?"** (URLs, marcas, otros proyectos, si tiene)

Si el usuario responde algo ambiguo, repregunta UNA vez. Si sigue ambiguo, registra "TBD" y avanza.

### Paso 2 — síntesis y muestra al usuario

Antes de escribir archivos, muestra al usuario:

```
Voy a generar content/principles.md con esto. Confírmame:

PROYECTO: <nombre tentativo>
QUÉ ES: <1 línea>
QUÉ NO ES: <1-2 líneas, lo opuesto>
AUDIENCIA: <...>
OUTPUTS: <lista>
TONO: <...>
RESTRICCIONES: <...>
REFERENCIAS: <...>

¿Está bien o ajustamos algo antes de escribir?
```

Espera confirmación. Si pide cambios, ajusta y vuelve a mostrar.

### Paso 3 — escribir `content/principles.md`

Estructura obligatoria (< 1500 palabras):

```markdown
# {{PROYECTO}} — Principios

> Documento canónico. Cualquier agente lo lee LITERAL al tope de su brief.
> Si lo que vas a producir contradice un principio, frena y pregunta al orquestador.

## Qué ES este proyecto
{{1-2 párrafos directos}}

## Qué NO ES
- {{Anti-pattern 1}}
- {{Anti-pattern 2}}
- {{Anti-pattern 3}}

## Audiencia
{{1 párrafo: para quién, contexto, qué espera}}

## Tono no negociable
- {{Atributo 1 (ej. "directo, sin jerga")}}
- {{Atributo 2}}
- {{Idioma: español neutro — cero voseo, cero regionalismos}}

## Outputs esperados
- {{Output 1}}
- {{Output 2}}

## Restricciones duras
- {{Lo que SIEMPRE debe pasar}}
- {{Lo que NUNCA debe pasar}}

## Reglas para cualquier agente
1. Lee este archivo + `content/INDEX.md` + `process-log/00-decisions.md` antes de generar output.
2. Si tu output contradice un principio, frena y pregunta.
3. Reporta el modelo que usaste (`claude-opus-4-7`, `gpt-image-2`, etc.).
4. Si generas imágenes: haz Read multimodal del PNG después (skill `multimodal-validation`).
5. Si generas prompts con references: cada `Image N` declarada DEBE estar mencionada en el texto del prompt.

## Versión
v0 — {{YYYY-MM-DD}}
```

### Paso 4 — escribir `content/INDEX.md`

```markdown
# INDEX — router de archivos del proyecto

> Cada agente carga SOLO los archivos relevantes a su tarea. No el repo entero.

## Tabla de carga obligatoria por tarea

| Tarea | Carga obligatoria | Carga si aplica |
|---|---|---|
| Cualquier output | `principles.md` + este INDEX + `process-log/00-decisions.md` | — |
| Texto narrativo / pitch / contenido | + glosario, lore, ejemplos previos | — |
| Visual / imagen | + style-guide, char-sheets relevantes | concept arts contextuales |
| Personaje nuevo | + lore, canon-cast | research previo si hay |
| Code | + relevant module(s) | tests, docs |

## Archivos canónicos del proyecto

- `content/principles.md` — qué ES y qué NO ES (Capa 0)
- `content/INDEX.md` — este archivo
- `process-log/00-decisions.md` — decisiones humanas (ley)
- {{añadir aquí los archivos que se vayan creando: lore.md, style-guide.md, char-sheets/, etc.}}

## Versión
v0 — {{YYYY-MM-DD}}
```

### Paso 5 — confirmar al usuario

```
Listo. Generé:
- content/principles.md
- content/INDEX.md

Próximo paso: cuéntame qué quieres hacer primero. Te propondré un plan
usando pipeline v2 (architect → critic → cold-reader → tu validación).
```

## Reglas duras

1. **Una pregunta a la vez.** No hagas un cuestionario gigante.
2. **Muestra antes de escribir.** Confirmación humana es obligatoria.
3. **Idioma del usuario.** Si responde en español neutro, escribe en español neutro. Si el global del usuario marca lista negra de regionalismos, respétala.
4. **Si el usuario es novato**, explica decisiones técnicas en lenguaje simple (sin jerga gratuita).
5. **No inventes información.** Si una respuesta es ambigua, repregunta o registra "TBD".

## Versión

v0 — 2026-05-06 — primera versión derivada del manual portable de orquestación.
