# Starter Template Mazelab — instrucciones para Claude

Este es el starter de Aldot. Cada nuevo proyecto se clona desde acá. Cualquier persona novata debe poder arrancar sin fricción.

Versión: **v3**. Diferencias clave vs v2: hand-off contracts entre agentes, memoria persistente del proyecto (separada de la global del usuario), dashboard en vivo, councils multi-modelo, image-explorer, voice-mode TTS, kickoff adaptativo, roadmap con `/idea`. Detalle: `process-log/v3-plan.md`.

## Antes de cualquier cosa

Cada vez que se abre el proyecto:

1. **Lee la memoria del proyecto al arranque.** Llama `summarize()` de `src/memory.js`. Es barato y te da: `has_profile`, `project_type`, `mode`, `agentes_count`, `decisiones_count`, `sprints_completados`. Decide qué hacer según el snapshot:
   - **Si `has_profile === false`** → propone `/kickoff`. La entrevista adaptativa detecta tipo de proyecto (build / business / content / research / personal), recomienda stack, persiste `project-profile.json` + `active-team.json`.
   - **Si hay profile pero falta `active-team.json` o `roadmap/current-sprint.json`** → continúa el kickoff donde se quedó.
   - **Si el proyecto ya está activo** → solo cargar `decisions.md` y `lessons.md` cuando vayas a tomar decisión nueva o el usuario pregunte por contexto histórico. No los cargues por inercia.
2. **Si las API keys faltan** (no hay `.env` con `OPENROUTER_API_KEY` o `OPENAI_API_KEY`) → sugiere `npm run setup` o los slash `/setup-openrouter` / `/setup-openai`. `REPLICATE_API_TOKEN` es opcional, solo si vas a usar `image-explorer`.
3. **Lee `process-log/00-decisions.md`** — son decisiones humanas (ley). Cualquier output que las contradiga, frena.
4. **Lee `docs/company.md`** si tiene contenido — es el contexto de la empresa del usuario.
5. **Sugiere levantar el dashboard** en otro terminal: `npm run dashboard`. Da visibilidad en vivo de tareas activas, eventos, métricas y hand-offs validados.
6. **Si la sesión es la primera real**, propone correr `npm run smoke` antes de arrancar (8 checks end-to-end, ~90s, ~USD 0.05).

## Capacidades disponibles

Todas las skills core viven en `.claude/skills/`. Las opcionales en `.claude/skills/_catalog/` y se activan vía `/kickoff` o copia manual.

### Texto y research

- **Research vía Perplexity (OpenRouter)**: `node src/research.js <quick|pro|search|reason|deep> "<pregunta>"`. Default `pro`. Para info actualizada, **siempre** úsalo — no inventes datos.
- **Cliente OpenRouter unificado** (`src/openrouter_client.js`): acceso a Anthropic, OpenAI, Google, DeepSeek, Qwen, Meta, Perplexity con una sola key. Base de councils y de cualquier flujo multi-modelo. Detalle: `src/openrouter_client.README.md`.

### Imágenes

- **gpt-image-2** (Python): `python scripts/openai_images.py generate|edit|batch …`. La skill `image-gen` lo orquesta con identity lock, refs declaradas en el prompt, y batch async.
- **image-explorer multi-modelo** (`src/image_explorer.js`): compara mismo prompt en gpt-image-2, FLUX, Imagen 3, Ideogram, Recraft, SD 3.5 y arma grilla HTML para elegir ganador. Útil para concept art, branding, exploración de "mano de modelo". Detalle: `src/image_explorer.README.md`.
- **multimodal-validation** (skill): fuerza Read del PNG después de cualquier `generate_image()` / `edit_image()`. Sin esto no hay PASS.

### Decisiones complejas

- **council** (skill + `src/council.js`): convoca 3-5 modelos distintos para deliberar. 4 councils predefinidos (`creative-ideation` Tier 1, `strategy-calls` y `mazelab-council` Tier 2, `architecture-decision` Tier 3). Auto-invocable bajo señales implícitas (con confirmación). Slash directo: `/council`. Detalle: `councils/README.md` y `.claude/skills/council/SKILL.md`.

### Orquestación y calidad

- **kickoff**: entrevista adaptativa, autogenera `content/principles.md` + `content/INDEX.md` + `memory/project-profile.json` + `memory/active-team.json` + sprint inicial.
- **pipeline-v2**: orquesta architect → critic → cold-reader → humano. Cada transición valida hand-off contract. Mantiene memoria del proyecto sincronizada.
- **cold-reader-gate**: lectura cold con voto binario GO/NO-GO y veto absoluto. Independiente — no se le pasa debate previo ni scores de critic.
- **agent-template**: genera agente nuevo con score base ~92/100. Pásalo por `confidence-loop` para llegar a 95+.
- **karpathy-rules**: 4 reglas para escribir código limpio. Auto al editar código.
- **quality-mindset** (core, siempre activa): disciplina mínima viable — spec → plan → ejecución → cierre validado. Sin Git formal.
- **confidence-loop**: itera artefacto hasta 95+/100 (5 iteraciones máx). Útil sobre agentes, skills, planes, código no trivial.
- **superpowers-pr** (catálogo, opcional): 5 reglas duras para Git/PR/code review formal. Vive en `.claude/skills/_catalog/superpowers-pr/`. Activarla solo si el proyecto usa flujo PR formal — kickoff lo decide.

### Memoria, roadmap y voz

- **memory.js** (`src/memory.js`): lectura/escritura de la memoria del proyecto. Helpers: `summarize`, `readProfile`, `writeProfile`, `addDecision`, `addLesson`, `addAgent`, `addSkill`, `touchAgent`, `addSprint`, `getActiveTeam`. Detalle: `memory/README.md`.
- **roadmap.js** (`src/roadmap.js`): gestión de sprint actual + backlog priorizado. Helpers: `addIdea`, `getCurrentSprint`, `closeSprint`. Slash command `/idea` para captura sin desvío.
- **voice-mode** (skill + `scripts/voice_tts.js`): TTS de respuestas largas con OpenAI TTS. Comandos `/voz-on`, `/voz-off`, `/voz-leer`. Defaults en `memory/voice-mode-state.json`.

### Observabilidad — dashboard v3

- **Dashboard pixel-art** (Phaser 3) con avatares vivos por agente, drill-down por agente, vista Sprint con hitos cruzados, vista Roadmap macro + historial de sprints. `npm run dashboard` lo levanta en `http://localhost:7777`. **Requiere `npm run dashboard:assets` la primera vez** para bajar el pack CC0 default (`kenney-roguelike`). Modo público read-only con `DASHBOARD_PUBLIC=1`. Detalle: `dashboard/README.md`.
- **Cómo lo alimentan los agentes**: `node scripts/update_state.js task-start <id> <agent> <role> <title> [files...] [--prompt ...] [--plan-step ...]... [--current-step N] [--phase ...] [--epic ...]` + `task-update <id> '<json-patch>'` + `task-complete <id> [tokens]`. El helper escribe atómico a `dashboard/state.json` y notifica al server. Schema completo de la task en `dashboard/README.md`.

## Hand-off contracts

Cada agente del pipeline declara qué archivos lee, qué archivos escribe, contra qué schema, y precondiciones/postcondiciones. Antes de que el agente B procese el output del agente A, el contrato se valida.

```js
import { declareContract, emitOutput, consumeInput } from './contracts/helpers.js';
```

- **`declareContract`** se llama una vez al cargar el agente. Persiste en `contracts/declared/<agent>.json`.
- **`emitOutput(agent, schemaId, output, path)`** valida contra el schema antes de escribir. Si falla, lanza `ContractViolation` y no escribe nada.
- **`consumeInput(agent, expectedSchemaId, path)`** re-valida antes de procesar. Detecta archivos modificados a mano o schemas que evolucionaron.

Schemas iniciales en `contracts/schemas/`: `architect-output`, `critic-output`, `cold-reader-output`, `image-gen-output`, `research-output`. Para añadir uno nuevo, deja `<id>.schema.json` en esa carpeta — el validator lo descubre al arranque.

Detalle completo + ejemplos copy-pasteables: [`contracts/README.md`](contracts/README.md).

## Memoria del proyecto

`memory/` persiste el estado mutable del proyecto entre sesiones. **Es del proyecto**, no del usuario — viaja con el repo. Tres lugares distintos para info persistente:

| Dónde | Qué va |
|---|---|
| `CLAUDE.md` (este archivo) | Reglas estables, capacidades, anti-patrones del repo. |
| `memory/` del proyecto | Estado mutable: decisiones, lessons, equipo activo, sprints. |
| Memoria global del usuario (`~/.claude/projects/.../memory/`) | Reglas que aplican a TODOS los proyectos del usuario. |

Cuándo Claude debe **leer** memoria: al arranque de sesión (`summarize()` siempre), antes de tomar decisión nueva (cargar `decisions.md`), antes de delegar a un agente (cargar `active-team.json`).

Cuándo Claude debe **escribir** memoria: solo en eventos significativos. No por cada paso. Ejemplos válidos:

- Decisión arquitectónica o de proceso → `addDecision({ title, decision, reasoning, alternatives, reversibility })`.
- Lección emergente de un fallo o éxito → `addLesson({ title, context, lesson, application })`.
- Cierre de sprint → `addSprint({ number, objective, deliverables, lessons, dates })`.
- Agente entra/sale del equipo → `addAgent` / `removeAgent` / `touchAgent`.

Detalle, schemas, anti-patrones: [`memory/README.md`](memory/README.md).

## Roadmap y backlog

El proyecto tiene **un sprint actual** + **un backlog priorizado**. Vive en `roadmap/` y se gestiona desde `src/roadmap.js`.

- **`/idea <texto>`** — captura idea cruda al backlog del sprint. NO ejecuta. NO desvía la conversación. Una línea de confirmación, fin. Útil cuando estás en medio de algo y se te ocurre otra cosa que no quieres perder.
- **`/roadmap`** — review del sprint actual + backlog. Permite priorizar, cerrar sprint, abrir uno nuevo.

Sprint actual en `roadmap/current-sprint.json`. Plan vivo en `roadmap/roadmap.md`.

## Patrones de orquestación

Decisión rápida — "qué hago cuando el usuario pide X":

| Lo que pide el usuario | Patrón a seguir |
|---|---|
| "Vamos a empezar / arrancar un proyecto" o repo recién clonado | `/kickoff` primero. NO procedes a construir sin canon. |
| "Construye / crea / vamos a hacer X" (creación no trivial) | `pipeline-v2` completa: principles → INDEX → architect → critic → cold-reader → humano. |
| "Qué te parece A vs B" / "estoy entre dos opciones" / decisión con tradeoffs | Skill `council` propone (Tier según severidad). NO ejecutes sin confirmación de costo. |
| "Genera imagen de X" | Skill `image-gen` con identity lock + multimodal-validation. Si no sabes qué modelo, propón `image-explorer` antes (~USD 0.18 por 4 modelos). |
| "Investiga / busca / qué se sabe sobre X" | `node src/research.js pro "X"`. NO inventes datos. |
| "Crea un agente para X" | Skill `agent-template` → `confidence-loop` para llegar a 95+. |
| "Mejora esto / súbele la calidad" | `confidence-loop` sobre el artefacto (5 iteraciones máx). |
| "Tengo una idea: X" cuando estás en otra cosa | `/idea X`. Captura, sigue tarea actual. |
| "Qué tenemos pendiente" / "review del sprint" | `/roadmap`. Lee `roadmap/current-sprint.json` + backlog. |

Paralelo cuando sea independiente. Secuencial cuando uno alimenta al otro. Si dudas → secuencial es más seguro.

## Modelo operativo (pipeline v2)

1. **Capa 0 — `content/principles.md` literal al tope de cada brief.** No resumido. Si no existe → `/kickoff` primero.
2. **Capa 0.5 — `content/INDEX.md` decide qué cargar.** No el repo entero. Más memoria del proyecto si aplica (decisions, lessons relevantes).
3. **Capa 1 — Architect** crea el deliverable. Declara su contract. **Emite output validado** (`emitOutput`).
4. **Capa 2 — Critic interno multi-óptica** (3-4 voces, sin cold-reader). **Consume input validado** (`consumeInput`) antes de revisar.
5. **Capa 3 — Cold-reader gate** (skill `cold-reader-gate`) — independiente, voto binario, veto absoluto. Solo recibe `principles.md` + deliverable.
6. **Capa 4 — Humano decide** sobre lo que pasó cold-reader. Decisiones que emergen → `addDecision()` a memoria.

Cada hand-off entre capas pasa por validador de contracts. Si falla, error claro al instante con el path exacto y el campo que rompió. No se escribe nada corrupto a disco.

## Reglas duras

1. **Idioma — español neutro.** Cero voseo, cero regionalismos rioplatenses (vos/tenés/podés/decime/etc.). Tuteo neutro. **Auto-check antes de enviar:** releo mi propio output, si encuentro regionalismos, reescribo.
2. **Cada agente declara contract.** No procesar input ajeno sin `consumeInput()`. No emitir output sin `emitOutput()`. Si el schema no existe, créalo en `contracts/schemas/` antes de seguir.
3. **`summarize()` al inicio de cada pipeline.** Antes de delegar a agentes, lee snapshot de memoria. Carga decisiones/lessons crudas solo si las vas a usar de verdad.
4. **No abrir council Tier 2 o 3 sin confirmar costo.** Tier 1 (USD 0.02-0.10) puede correr con confirmación previa del turno. Tier 2 y 3 requieren confirmación explícita con monto. Costos en `councils/README.md`.
5. **No escribir memoria por cada paso.** Solo eventos significativos (decisiones, lessons, cierre de sprint, cambio de equipo). El log conversacional es ruido, no va a memoria.
6. **Validación multimodal en imágenes — obligatorio.** Después de `generate_image()` / `edit_image()`, hago Read del PNG. Sin esto no hay PASS.
7. **Refs declaradas DEBEN mencionarse en el texto del prompt.** Cada `Image N` cargada en el array tiene que estar nombrada literal en el prompt — si no, el modelo la ignora.
8. **DIFF de pérdidas en R2+.** Antes de iterar una segunda ronda, listo 5 cosas del R1 que NO debo perder.
9. **Cold-reader es independiente.** No le paso debate previo, briefs históricos, ni scores de critic. Solo `principles.md` + deliverable.
10. **Modelo tracking obligatorio.** Cada output reporta el modelo usado (`claude-opus-4-7`, `gpt-image-2`, `flux-1.1-pro`, etc.). Va al campo `model` del schema correspondiente.
11. **Subcarpetas, no paths dispersos.** Outputs van a `content/output/<scene_or_asset>/`, exploraciones a `content/explorations/<timestamp>/`, results de council a `councils/results/<timestamp>.json`.
12. **Paralelismo agresivo en operaciones independientes.** Si N jobs no dependen entre sí (imágenes, research, hand-offs), corre paralelo. Default 8 concurrentes en imágenes; hasta 15-20 en tier alto.

## Anti-patrones (NO hacer)

- Lanzar agente con 15+ archivos de contexto histórico (cargar solo lo que el INDEX dice).
- Critic con cold-reader como una voz más en la rúbrica.
- Validation textual sin Read del PNG.
- Refs cargadas pero no mencionadas en el texto.
- Iterar R2/R3 sin DIFF de pérdidas.
- Crear agentes nuevos a media sesión y usarlos en la misma sesión (no cargan).
- Convocar council para decisiones triviales o con respuesta clara y verificable (council es overkill, gasta dinero).
- Usar `image-explorer` cuando ya sabes qué modelo necesitas (gasta ~USD 0.20 al pedo).
- Activar `voice-mode` para respuestas con mucho código, JSON, paths o tablas (TTS los lee mal).
- Escribir a memoria por cada turno (memoria no es log, es destilado).
- Saltar `consumeInput()` en hand-offs porque "el archivo lo escribió el agente anterior, debe estar bien" (ese es el bug que v3 vino a matar).
- Pasar paths absolutos dispersos al usuario para refs.

## Tono

- Aldot es vibe coder + emprendedor, no senior architect. Explica decisiones técnicas en lenguaje simple.
- Directo, sin jerga gratuita.
- Sin emojis salvo que el usuario los pida.

## Referencia rápida — tests del repo

Cuando algo se rompa, estos tests son el primer chequeo:

| Test | Qué valida |
|---|---|
| `npm run smoke` | Sistema completo end-to-end (8 checks, ~90s, gasta API). |
| `npm run smoke:quick` | Estructura solamente, sin red. |
| `npm run test:contracts` | Schemas + emit/consume del sistema de hand-offs. |
| `npm run test:dashboard` | Server HTTP + SSE + history + helper update_state.js + endpoints v3 (32 checks). |
| `npm run test:dashboard:scene` | Suite completa del frontend Phaser 3: phaser smoke + pack resolver + fetch pack + public mode + seating + event bus + panel render + sprint cross + roadmap render + sprints history. |
| `npm run test:dashboard:panel` | Solo render del side panel (agente / sprint / roadmap). Más rápido cuando iteras sobre la UI. |
| `node memory/test.js` | Helpers de memoria del proyecto. |
| `node pipeline-v2-integration.test.js` | Flujo completo pipeline v2. |
| `node docs-v3.test.js` | Documentación v3 al día. |

No corras `npm run smoke` en cada commit — gasta credits reales. Para CI continuo, usa los tests específicos.

## Feedback al starter Mazelab

En la raíz hay un archivo `feedback.md`. Es el canal para reportar findings sobre el starter mismo (skills faltantes, scripts rotos, anti-patrones, contracts que no encajan en uso real) — **NO** para bugs/features del proyecto consumer.

**Flujo:**
1. Cuando aldot ve algo del starter que falla o falta, te dice: _"anota esto en `feedback.md`"_.
2. Agregas entry al final del archivo: fecha, contexto, finding, acción sugerida (opcional). Texto libre, no hay formato rígido.
3. Cuando aldot retoma sesión sobre el starter, le da la ruta del `feedback.md` al orquestador del starter, que lee, sintetiza al inbox global y aplica fixes.

**NO arregles el starter desde este proyecto.** Tu rol es reportar. El orquestador del starter es el que corrige.

## Limitaciones del runtime de Claude Code

🛑 **Subagentes NO pueden hacer Write a archivos del proyecto.** El wrapper de subagentes (los que se lanzan vía la Agent tool) bloquea el uso del Write tool con "Subagents should return findings as text". Esto aplica a TODOS los subagentes, no solo a los nuestros. Decisión registrada como D6.

**Workaround obligatorio en todos los briefs a subagentes:**

> "Entrega tus findings como texto en tu respuesta final. **NO uses la Write tool** — el wrapper la bloquea. El orquestador (Claude principal) persistirá el archivo. Tu output va dentro del mensaje, encerrado en code fences si es markdown/JSON. Si excede 50k tokens, divídelo en N partes y dilo explícito al final ('parte 1/3, continúa en próximo turno')."

**Aplica especialmente a:**
- `dual-auditor-protocol` (los auditores entregan findings como texto; el orquestador escribe `audit/findings-deep-{A,B}.md`).
- `pipeline-v2` cuando el architect/critic/cold-reader corren como subagentes.
- Cualquier flujo donde un agente "produce un deliverable" — el deliverable viaja como texto, el orquestador hace el Write.

**No aplica a:** el orquestador principal (Claude que conversa con el usuario), que sí puede escribir archivos libremente. La limitación es exclusiva del wrapper de subagentes.

🛑 **Agentes recién creados NO cargan en la misma sesión.** Si en la sesión actual se crea o se edita el frontmatter de un agente en `~/.claude/agents/xxx.md` o `.claude/agents/xxx.md`, Claude Code no lo verá hasta que el usuario reinicie. El registro de agents se construye al arranque de sesión y no refresca en caliente.

**Workaround:** crear los agentes durante `/kickoff` (Paso 0) y pedirle al usuario reiniciar antes del primer trabajo real. Si el agente surge mid-sesión, avisar explícito y usar `general-purpose` con un prompt que emule el rol del agente nuevo para esa tarea puntual.

🛑 **Skills recién creadas/editadas SÍ se ven en la misma sesión** (a diferencia de agents). Las skills se leen on-demand cada vez que se invocan. Editar una skill no requiere reinicio.

## Versión

**v3.1** (2026-05). Plan vivo en `process-log/v3-plan.md`. Decisiones cerradas en `process-log/00-decisions.md` (ley).

Cambios v3.1 sobre v3 (Sprint v3.1): helper `src/load_env.js` para carga idempotente del `.env`; chat público orquestador↔agentes en el dashboard; skill `dual-auditor-protocol` en el catálogo; review-app oficial migrada al starter; sync `roadmap/current-sprint.json` ↔ `dashboard/state.json` automático vía `roadmap.js`; kickoff con capa de contraste post-respuestas + sub-tipo `business-with-software`; campo `sprint_number` en task schema; timeout configurable en `openrouter_client.chat()`; D6 (subagentes sin Write) y D7 (sync current-sprint canónico) cableadas.
