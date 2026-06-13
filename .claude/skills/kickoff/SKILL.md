---
name: kickoff
description: Entrevista adaptativa al iniciar un proyecto. Detecta señales del usuario, hace solo las preguntas relevantes, recomienda stack de skills y deja persistido project-profile.json + active-team.json + sprint inicial. Triggers "/kickoff", "vamos a empezar", "nuevo proyecto", "qué construimos hoy".
allowed-tools: Read, Write, Edit, Glob, Bash
---

# kickoff — onboarding adaptativo del proyecto

**Esta es la primera skill que corre en un proyecto nuevo.** Reemplaza la v2 lineal por una entrevista que se adapta al usuario: lo escucha, detecta qué quiere construir, y solo le pregunta lo necesario para arrancar.

Filosofía: un onboarding de producto premium, no un formulario. Dos usuarios distintos NO reciben las mismas preguntas.

## Cuándo invocarla

- Usuario clona el starter por primera vez y dice "vamos a empezar", "tengo una idea", "qué hacemos".
- Slash command `/kickoff` explícito.
- `memory/project-profile.json` no existe o está vacío.

## Cuándo NO invocarla

- Si `memory/project-profile.json` ya tiene un perfil válido — pregunta antes de sobrescribir. Ofrece la opción "ajustar perfil" en lugar de reiniciar.
- Si el usuario hace una pregunta puntual no relacionada al proyecto.

## Reversibilidad

En cualquier momento del kickoff, si el usuario dice "reinicia", "vuelve atrás" o "cambiemos esto", retomas desde el punto que pida. No persistes nada hasta su confirmación final explícita.

---

## Paso 0 (pre-flight) — auto-setup si falta

**Antes del saludo**, verifica el estado del proyecto. Si algo falta, te ofreces a configurarlo automáticamente — el usuario novato no debería tener que correr comandos a mano.

### Checks en orden

1. **`node_modules/` existe?** Si no:
   ```
   Veo que aún no tienes las dependencias instaladas. Es 1 comando, ~30 segundos.
   ¿Las instalo por ti ahora? [Y/n]
   ```
   Si confirma → ejecuta `npm install` vía Bash. Si falla, muestra el error y guía.

2. **`.env` existe y tiene API keys reales?** Verifica:
   - Si `.env` no existe → falta setup completo.
   - Si `.env` existe pero `OPENROUTER_API_KEY` o `OPENAI_API_KEY` están vacías o tienen placeholder (`pega-aqui-tu-key`) → falta configurar.
   
   En cualquiera de los casos, ofrécelo:
   ```
   Faltan tus API keys. Te las pido conversacionalmente — son 2 obligatorias y 1 opcional.
   ¿Empezamos? [Y/n]
   ```
   
   Si confirma:
   - **OpenRouter API key** (requerida — research, councils, cliente unificado): "Sácala en https://openrouter.ai/keys. Formato `sk-or-v1-...`. Pégala (Enter para saltar):"
   - **OpenAI API key** (requerida — gpt-image-2, voice-mode TTS): "Sácala en https://platform.openai.com/api-keys. Formato `sk-proj-...`. Pégala:"
   - **Replicate API token** (opcional — image-explorer multi-modelo): "Si vas a hacer concept art o exploración visual, conviene. Pégala (Enter para saltar):"
   
   Cada key que reciba la guarda con el helper `upsertEnv(key, value)` (o equivalente) escribiendo a `.env`.

3. **Python 3.10+ disponible?** (solo si vas a usar gpt-image-2 — opcional):
   - Si está y no hay venv → ofrece crearlo: `python -m venv .venv && .venv/Scripts/pip install -r requirements.txt` (Windows) o equivalente en macOS/Linux.
   - Si no está → muéstrale el comando de instalación según OS y sigue sin él (gpt-image-2 quedará desactivado hasta que lo configure).

4. **Una vez todo verde**, pasas al Paso 1 (saludo) sin ceremonia. Si algo falló, lo mencionas brevemente ("OpenAI key quedó saltada — la puedes configurar después con `/setup-openai`") y pasas al saludo igual.

### Anti-patrones del pre-flight

- **No abrumar.** Si TODO está OK, no lo menciones — pasa directo al saludo. Solo hablas si falta algo.
- **No exigir todas las keys.** OpenRouter es la mínima viable para arrancar. OpenAI puede saltar (gpt-image-2 quedará off). Replicate es siempre opcional.
- **No correr `npm install` sin confirmar.** Es seguro pero educa al usuario sobre qué pasa.

---

## Paso 1 — saludo inicial (literal)

```
Hola, soy el Starter Template de Mazelab.

Soy un sistema multi-agente que te acompaña en cualquier tipo de proyecto:
investigaciones, software, contenido creativo, decisiones de negocio,
automatizaciones personales. Tengo capacidades como councils multi-modelo,
generación de imágenes, dashboard en vivo, memoria persistente entre
sesiones, voz (input por Win+H + output por TTS), y un catálogo de skills
opcionales que activo según tu proyecto.

Mi job es escucharte, armar el equipo correcto, y ejecutar contigo. La
entrevista que sigue se adapta a tu respuesta — si dices "necesito un meme",
no te pregunto sobre arquitectura. Te haré entre 3 y 5 preguntas cortas y
propondré un plan que tú confirmas o ajustas antes de arrancar.

Antes de empezar dime en una frase qué quieres construir o resolver hoy.
```

La intro debe leerse en menos de 20 segundos — es saludo + valor + qué viene a continuación. Después una sola pregunta. Sin checks técnicos previos. Si el ambiente necesita configuración (npm install, .env), el orquestador lo detecta después del kickoff; aquí solo escuchamos.

---

## Paso 1 — detección de señales

Cuando el usuario responde, **ejecuta el detector vía Bash**: `node .claude/skills/kickoff/detector.js detect "<texto del usuario>"` (y `stack <type>` / `sprint <type> <mode>` según necesites más adelante). Imprime el JSON resultante a stdout. **NO leas `detector.js` al contexto — es determinístico** (regex sobre el texto en minúsculas, sin LLM), predecible y testeable.

Devuelve `{ type, size, output, confidence, evidence }`:

- **type** ∈ `research | build | content | business | personal | mixed`
- **size** ∈ `rapido | medio | grande`
- **output** ∈ `imagen | codigo | analisis | documento | idea | mixed`

### Tabla resumida de señales (para diagnóstico humano)

| Categoría | Keywords/patrones disparadores | Resultado |
|---|---|---|
| content | meme, post, instagram, tiktok, campaña, copy, guion, ilustración, reel, artículo, blog | `type=content` |
| build | app, aplicación, web, dashboard, plataforma, sistema, herramienta, cli, api, bot, automatizar, digitalizar | `type=build` |
| business | ventas, clientes, crm, mi empresa, operación, estrategia comercial, modelo de negocio, pitch deck | `type=business` |
| research | investigar, research, analizar mercado, benchmark, competencia, estado del arte, tendencias, deep dive | `type=research` |
| personal | organizar mi, agenda, rutina, hábito, journal, productividad personal | `type=personal` |
| rápido | ahora, rápido, urgente, hoy, ya, "en 30 min", meme, post | `size=rapido` |
| grande | varios días, sprint, aplicación, plataforma, digitalizar, "a fondo", "deep dive" | `size=grande` |

Si dos categorías de tipo empatan con score ≥2, devuelve `mixed`. Si nadie hizo match, también `mixed`.

**Tiebreaker `build > business`:** cuando build y business empatan (caso típico: "construir app para gestionar ventas"), gana `build`. La naturaleza dominante de un proyecto es lo que se EJECUTA, no para qué área es. Una app de ventas se construye como software (stack build) aunque sirva al negocio.

### Si la confianza es baja (`confidence < 2`)

Antes de bifurcar preguntas, repregunta UNA vez con una opción cerrada cálida:

```
No me quedó del todo claro. ¿Esto va más por el lado de:
(a) crear contenido o algo creativo,
(b) construir software o una herramienta,
(c) investigar o analizar algo,
(d) organizar un proceso o decisión de negocio,
(e) algo personal,
o (f) otra cosa que no entra ahí?
```

Con la respuesta, re-corres `detectSignals(answer + " " + originalInput)` y avanzas con lo que salga, aunque siga `mixed`.

---

## Paso 2 — preguntas adaptativas (máximo 4-5)

Según el `type` detectado, haces SOLO las preguntas de la rama correspondiente. Una pregunta a la vez. Tono cálido, directo, español neutro.

**Regla dura:** nunca más de 5 preguntas adaptativas. Si necesitas más detalle, lo descubres durante la ejecución, no en el kickoff.

### Rama: content

1. ¿Para quién es y dónde se va a publicar? (Instagram, LinkedIn, web, interno…)
2. ¿Qué tono o estilo? (juguetón, técnico, místico, irónico, formal…)
3. ¿Hay marca o referencias visuales que respetar? (URLs, logos, paletas)
4. ¿Cuántas piezas y para cuándo? (una sola para hoy, set de 5, campaña semanal…)

### Rama: build

1. ¿Para quién es? (uso interno tuyo, equipo, clientes externos)
2. ¿Stack o restricciones técnicas? (lenguajes que ya usas, qué NO usar, integraciones obligadas)
3. ¿Cuál es el flujo crítico que debe funcionar primero? (lo mínimo que prueba que vale la pena seguir)
4. ¿Deadline o presupuesto que marque el ritmo?

### Rama: business

1. ¿Qué proceso o área concreta estamos atacando? (ventas, ops, soporte, finanzas…)
2. ¿Quién lo opera hoy y dónde está el dolor? (cuello de botella, costo, errores)
3. ¿Tienes datos o documentación previa del proceso? (planillas, manuales, CRM)
4. ¿En qué horizonte quieres ver resultado? (semana, mes, trimestre)

### Rama: research

1. ¿Qué profundidad necesitas? (panorama de 1 hora, informe semanal, tesis de varias semanas)
2. ¿Hay fuentes preferidas o vetadas? (papers, prensa especializada, redes, internas)
3. ¿Qué decisión vas a tomar con el resultado? (define cuándo es "suficiente")
4. ¿Formato del entregable? (informe escrito, deck, base de datos, mapa)

### Rama: personal

1. ¿Qué intentas mejorar o resolver? (productividad, hábitos, decisiones, journaling)
2. ¿Qué intentaste antes y por qué no funcionó?
3. ¿Cuánto tiempo al día estás dispuesto a dedicarle?

### Rama: mixed

Solo 3 preguntas, abiertas, para concretar el tipo:
1. ¿Cuál es el resultado tangible que quieres tener al final? (algo que se vea, se lea, se use)
2. ¿Quién es el usuario o lector? (tú, tu equipo, clientes, público)
3. ¿En cuánto tiempo esperas tenerlo listo?

Después de estas 3, vuelves a correr `detectSignals` sobre las respuestas combinadas y eliges la rama. Si sigue `mixed`, asumes ese tipo y avisas al usuario que el sprint inicial será "concretar el tipo".

---

## Paso 3 — diagnóstico y stack recomendado

Una vez recogidas las respuestas, aplicas:

- `recommendStack(type)` → lista de skills recomendadas con un `why` por cada una.
- `recommendMode(type, size)` → `rapido` o `profundo`.
- `suggestInitialSprint(type, mode)` → `{ objective, deliverables[], mode }`.

### Paso 3.5 — capa de contraste razonada contra el catálogo (Sprint v3.1, mejorada v4 / D9)

Después de detectar tipo y armar el stack curado por `detector.js`, **lee el archivo `.claude/skills/_catalog/skills-catalog.json` ENTERO** (es barato, ~30 entradas) y **RAZONA** skill por skill, no solo matchees keywords. El `detector.js` te da el stack base curado; el catálogo JSON + tu razonamiento es la capa de contraste mejorada.

Para cada skill del catálogo que NO esté ya en el stack curado, pregúntate:

1. **¿El proyecto hace X que esta skill sirve?** Compara `when_to_use` y `triggers` del JSON contra lo que el usuario describió. No te limites a un match literal de keyword — razona el encaje real.
2. **¿Por qué sí / por qué no?** Si la propones, da el `why` concreto ("mencionaste que el deliverable es para un cliente final, esta skill evita jerga técnica").
3. **¿Cuál es su `status`?** Si es `"stub"`, AVISA al usuario que es un esqueleto v0.1 (invocable pero pendiente de profundización) antes de proponerla. Si es `"v1.0"`, está madura.

Solo propones lo que tiene encaje real. No vuelques el catálogo entero — eso es ruido.

**Caso especial — audiencia no técnica (tema recurrente #1):** si el proyecto es `business`, `content` o `marketing` Y tiene un cliente/audiencia FINAL que va a leer los deliverables (no solo devs), **propón `client-language`** (reescribe sin jerga técnica) y, si los deliverables son críticos de cara al cliente, también `non-technical-cold-reader` (gate que veta jerga antes de mostrar al cliente). Mantén la jerga técnica solo en superficies del orquestador (un `/aldo/`, READMEs internos).

**Sub-tipo `business-with-software` (Sprint v3.1):**

Si el `type` detectado es `business` Y las respuestas del usuario mencionan código, repo, PR, merge, audit, app, sistema, código de producción, ERP, GitHub — activa el sub-tipo `business-with-software`. Esto auto-propone como skills **adicionales** al stack `business`:

- `superpowers-pr` (PR formal + code review)
- `webapp-testing` (estrategia de testing)
- `playwright` (E2E para flujos críticos)
- `frontend-design` (si hay UI involucrada)
- `dual-auditor-protocol` (si hay audit de código de producción)
- `review-app` (si hay flujo de PRs a revisar)

El detector implementa esto en `detector.js#enrichStackWithContrast(type, userAnswersText)`. La función devuelve `{ stack, extras, subType }` donde `extras` son las skills sugeridas por contraste + sub-tipo.

**Output al usuario** cuando hay extras del contraste:

```
Esto es lo que entendí:
...
Stack recomendado:
- <skills curadas del tipo>

Además, detecté en tus respuestas señales para activar también:
- <skill extra 1> — <why específico, ej. "mencionaste PRs y audit de código">
- <skill extra 2> — <why>

¿Las activamos? [Y]es / [N]o / [solo X y Y]
```

Las **skills core** (siempre activas, definidas en `CORE_SKILLS` del detector) son:
`pipeline-v2`, `cold-reader-gate`, `multimodal-validation`, `karpathy-rules`, `confidence-loop`, `agent-template`. Estas no se discuten — se activan automáticamente. Solo presentas al usuario las RECOMENDADAS adicionales.

### Stack recomendado por tipo (resumen)

| Tipo | Skills recomendadas adicionales |
|---|---|
| content | image-gen, image-explorer, brand-guidelines, multimodal-validation, marketing, canvas-design |
| build | quality-mindset, agent-template, council, karpathy-rules, superpowers-pr, frontend-design, webapp-testing, playwright |
| business | council, pipeline-v2, seo-strategist, agent-template, marketing, brand-guidelines, xlsx |
| research | pipeline-v2, cold-reader-gate, firecrawl, context7 |
| personal | confidence-loop, pipeline-v2 |
| mixed | pipeline-v2, confidence-loop, web-artifacts-builder |

Las skills opcionales del catálogo (`_catalog/INDEX.md`) están disponibles pero no todas se recomiendan automáticamente para todo tipo. La lista por tipo es curada — Sprint 5.2 amplió las recomendaciones según el video que vio Aldo. Las skills no listadas (ej. `pdf-skill`, `remotion`, `web-artifacts-builder` para tipos distintos a `mixed`) se activan manualmente cuando el caso lo amerita, no por default.

### Diagnóstico al usuario (formato literal de salida)

```
Esto es lo que entendí:

Proyecto: <descripción de 1 línea reformulada por ti>
Tipo: <type detectado> (<por qué — referencia a las palabras del usuario>)
Tamaño: <size> · Modo: <rapido|profundo>

Stack recomendado:
- <skill 1> — <why en 1 línea>
- <skill 2> — <why en 1 línea>
- <skill 3> — <why en 1 línea>
(además de las skills core: pipeline-v2, cold-reader-gate, multimodal-validation, karpathy-rules, confidence-loop, agent-template)

Sprint 1 sugerido — <objective>:
- <deliverable 1>
- <deliverable 2>
- <deliverable 3>

¿Confirmas o ajustas algo antes de que lo guarde?
```

Si el usuario ajusta, integras los cambios y vuelves a mostrar este bloque hasta que diga "confirma", "dale", "guarda", "sí está bien", etc.

---

## Paso 4 — persistencia (SOLO al recibir confirmación explícita)

Cargas `src/memory.js` y `src/roadmap.js` y ejecutas en este orden. Todas las llamadas son idempotentes.

**Política de sprints (D7):** `addSprint()` SOLO se llama al CERRAR un sprint, no al abrirlo. Esto se ajustó en Sprint v3.1 — antes `kickoff` llamaba `addSprint` al crear el sprint inicial y eso hacía que `summarize().sprints_completados` reportara `1` aunque el sprint recién hubiera abierto (confusión semántica entre "sprint vivo" en `roadmap/current-sprint.json` y "sprint cerrado" en `memory/sprint-log.md`).

```js
import { writeProfile, addSkill } from '../src/memory.js';
import { startSprint } from '../src/roadmap.js';
import { CORE_SKILLS, recommendStack, recommendMode, suggestInitialSprint } from '.claude/skills/kickoff/detector.js';

const profile = {
  project_type: <type>,
  mode: <mode>,
  description: <descripción de 1 línea, máx 240 caracteres>,
  created_at: new Date().toISOString(),
  owner: <email del usuario>,
  skills_activas: [...CORE_SKILLS, ...recommendStack(type).map(s => s.name)],
  agentes_activos: [],
  sprint_inicial: 'sprint-1',
  tags: [<type>, <size>],
};
writeProfile(profile);

for (const name of CORE_SKILLS) addSkill({ name });
for (const s of recommendStack(type)) addSkill({ name: s.name, notas: s.why });

// Sprint inicial: crea SOLO roadmap/current-sprint.json. NO llamar a addSprint()
// — ese se reserva para el cierre del sprint (vía closeSprint() en roadmap.js).
const sprint = suggestInitialSprint(type, mode);
startSprint({ number: 1, objective: sprint.objective });
// startSprint() además sincroniza dashboard/state.json.current_sprint con el
// sprint recién creado (mejor-effort vía POST /api/state, silencioso si el
// dashboard no está arriba).
```

### Crear archivos del proyecto

1. `content/principles.md` ← copia desde `content/principles.template.md` y reemplaza `{{PROYECTO}}`, `{{TIPO}}`, `{{DESCRIPCION}}`, `{{TONO}}`, `{{NO_NEGOCIABLES}}`, `{{FECHA}}`.
2. `content/INDEX.md` ← copia desde `content/INDEX.template.md` y ajusta la sección de archivos canónicos según el tipo.
3. `roadmap/roadmap.md` ← genera con sprint 1 explicitado y backlog vacío. Sprint 2.4 lo enriquecerá.

Si `content/` o `roadmap/` no existen, créalos.

### Roadmap inicial (formato literal)

```markdown
# Roadmap del proyecto

## Sprint actual

### Sprint 1 — <objective>
**Modo:** <rapido|profundo>
**Estado:** abierto

Deliverables:
- <deliverable 1>
- <deliverable 2>
- <deliverable 3>

## Backlog

(vacío — Sprint 2.4 lo enriquecerá con priorización)

## Sprints cerrados

(ninguno aún — ver memory/sprint-log.md cuando empiecen a cerrarse)
```

### Agentes activos

En el kickoff NO se invocan agentes todavía. `agentes_activos` arranca vacío. El primer agente se registra cuando el usuario pida la primera tarea concreta.

---

## Paso 5 — verificación final

Cierra con este mensaje:

```
Listo. Guardé:
- memory/project-profile.json (perfil)
- memory/active-team.json (skills activadas)
- memory/sprint-log.md (sprint 1)
- content/principles.md y content/INDEX.md (canon del proyecto)
- roadmap/roadmap.md (con sprint 1 abierto)

Tip de productividad: si vas a escribir prompts largos, en Windows usa Win+H
para dictar (macOS: doble Fn). Detalles en docs/voice-input-guide.md.

Si quieres validar que el sistema arranca limpio, corre:
npm run smoke:quick   (corre el smoke test en modo rápido, sin gastar credits reales)

¿Empezamos con el primer deliverable del sprint?
```

Ofrece correr `npm run smoke:quick` automáticamente para validar que el sistema arranca limpio.

---

## Persistencia: contrato exacto con memory.js

| Llamada | Cuándo | Argumentos |
|---|---|---|
| `writeProfile(profile)` | Una sola vez, al confirmar el diagnóstico. | El objeto del Paso 4. |
| `addSkill({ name, notas? })` | Una vez por skill core + una vez por skill recomendada. | `notas` es el `why` cuando aplica. |
| `addAgent(...)` | NO en el kickoff. Se llama cuando el primer agente se invoca. | — |
| `startSprint({ number, objective })` (de roadmap.js) | Una sola vez al crear el sprint inicial. Crea `roadmap/current-sprint.json` Y sincroniza `dashboard/state.json.current_sprint`. | Tomado de `suggestInitialSprint`. |
| `addSprint(...)` (de memory.js) | **NO en el kickoff.** Se llama recién al CERRAR el sprint (vía `closeSprint()` en roadmap.js). Esa decisión vive en D7. | — |

`addDecision` y `addLesson` NO se llaman en el kickoff salvo que el usuario tome una decisión explícita durante la entrevista (ej. "decido no usar Git en este proyecto"). En ese caso lo registras como `addDecision`.

---

## Anti-patrones (no hacer)

1. **No hacer más de 5 preguntas adaptativas.** Si la pregunta 6 te parece necesaria, no la es: descubre eso en la primera tarea.
2. **No recomendar stack genérico.** Si el tipo es `content`, no recomiendas `firecrawl`. Si es `research`, no recomiendas `image-gen`. La justificación de cada skill (`why`) debe ser específica al proyecto.
3. **No asumir tipo sin señal clara.** Si `confidence < 2`, repreguntas. No "intuyes".
4. **No persistir antes de la confirmación.** El usuario decide final. Hasta entonces, todo vive en memoria de la conversación.
5. **No bombardear al usuario con jerga.** Aldo es vibe coder. Decir "te activo confidence-loop, pipeline-v2 y agent-template" sin explicar para qué = falla.
6. **No saltarte el Paso 0 con un párrafo educativo de 6 puntos.** El saludo es UNA línea, una pregunta. Lo demás se gana con el flujo.
7. **No correr checks técnicos (npm install, .env) antes de preguntar.** Eso interrumpe la energía. El orquestador los ejecuta DESPUÉS, cuando ya hay perfil.

---

## Ejemplos end-to-end

Dos ejemplos completos del flujo (meme rápido para Instagram, digitalizar área de ventas) viven en `EXAMPLES.md` en esta misma carpeta. NO se cargan al invocar la skill — léelos solo si necesitas ver el flujo aplicado a un caso concreto.

---

## Versión

v3 — 2026-05-09 — entrevista adaptativa con detección de señales, recomendación de stack justificada, persistencia integrada con memory.js, templates pre-pobladas y test de integración con 3 escenarios. Reemplaza la v2 lineal de 6 preguntas fijas.

Cambios principales: ver `CHANGELOG.md` en esta misma carpeta.
