# Starter Template Mazelab — instrucciones para Claude

Este es el starter de Aldot. Cada nuevo proyecto se clona desde acá. Cualquier persona novata debe poder arrancar sin fricción.

Versión: **v4.2.1** (2026-06). Diferencias clave vs v2: hand-off contracts entre agentes, memoria persistente del proyecto (separada de la global del usuario), dashboard en vivo, councils multi-modelo, image-explorer, voice-mode TTS, kickoff adaptativo, roadmap con `/idea`. Detalle: `process-log/v3-plan.md`.

## Antes de cualquier cosa

Cada vez que se abre el proyecto:

1. **Lee la memoria del proyecto al arranque.** Llama `summarize()` de `src/memory.js`. Es barato y te da: `has_profile`, `project_type`, `mode`, `agentes_count`, `decisiones_count`, `sprints_completados`. Decide qué hacer según el snapshot:
   - **Si `has_profile === false`** → propone `/kickoff`. La entrevista adaptativa detecta tipo de proyecto (build / business / content / research / personal), recomienda stack, persiste `project-profile.json` + `active-team.json`.
   - **Si hay profile pero falta `active-team.json` o `roadmap/current-sprint.json`** → continúa el kickoff donde se quedó.
   - **Si el proyecto ya está activo** → solo cargar `decisions.md` y `lessons.md` cuando vayas a tomar decisión nueva o el usuario pregunte por contexto histórico. No los cargues por inercia.
2. **Si las API keys faltan** (no hay `.env` con `OPENROUTER_API_KEY` o `OPENAI_API_KEY`) → sugiere `npm run setup` o los slash `/setup-openrouter` / `/setup-openai`. `REPLICATE_API_TOKEN`: requerido para `image-explorer` Y para los modelos económicos de `image-gen` (FLUX, Ideogram, Nano Banana Pro). Opcional solo si usas únicamente gpt-image-2.
3. **Lee `process-log/00-decisions.md`** — son decisiones humanas (ley). Cualquier output que las contradiga, frena.
4. **Lee `docs/company.md`** si tiene contenido — es el contexto de la empresa del usuario.
5. **Sugiere levantar el dashboard** en otro terminal: `npm run dashboard`. Da visibilidad en vivo de tareas activas, eventos, métricas y hand-offs validados.
6. **Si la sesión es la primera real**, propone correr `npm run smoke` antes de arrancar (8 checks end-to-end, ~90s, ~USD 0.05).

## Capacidades disponibles

Capacidades completas (research, imágenes, councils, orquestación, memoria, dashboard, review-app, tests) en `docs/capacidades.md` — cárgalo cuando evalúes qué skill usar o qué test correr. La fuente machine-readable del catálogo de skills es `.claude/skills/_catalog/skills-catalog.json`.

## Selección de modelo

Qué modelo usar según el tipo de tarea:

| Tipo de tarea | Modelo | Por qué |
|---|---|---|
| Mecánica/repetitiva (formato, listas, parseo) | haiku | barato y rápido |
| Construcción normal (código, contenido, research) | sonnet | el default equilibrado |
| Decisión crítica, arquitectura, audit de riesgo, creatividad fina | opus | caro, solo cuando de verdad importa |

El orquestador elige por defecto; tú puedes pedir "usa opus para esto" si lo crees crítico.

## /goal — Claude itera solo hasta cumplir una condición

- **Qué es:** Claude trabaja en loop por sí mismo hasta cumplir una condición verificable (tests pasan, el proyecto compila, los archivos se generaron).
- **Guardrail OBLIGATORIO:** siempre incluir un tope de turnos, p. ej. "...or stop after 8 turns". Sin tope, un loop puede gastar mucho dinero.
- **Cuándo usarlo:** condiciones determinísticas y comprobables. NO para metas vagas ("hazlo mejor", "que quede lindo") — esas no tienen criterio de parada claro.
- **Costo típico:** ~USD 1-4 por sesión.

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

**Research proactivo (D11) — reactivo → proactivo.** Antes de que un agente afirme datos de mundo real (naming, tendencias, cifras de mercado, competidores, precios, o cualquier cosa post-corte-de-conocimiento), el orquestador **PROPONE research** (`node src/research.js pro "..."` o `deep`) en vez de dejar que el agente invente. Señales que disparan la propuesta: "tendencias 2026", "qué se sabe de", "estado del arte", naming/branding, precios, decisiones con incertidumbre factual. No esperes a que el usuario lo pida.

## Modelo operativo (pipeline v2)

Las reglas operativas completas del pipeline (las 5 capas, hand-off contracts, manejo de fallos) viven en `.claude/skills/pipeline-v2/SKILL.md` — esa es la fuente. Anclas que el orquestador debe tener presentes sin abrir la skill:

- **Capa 0 — `content/principles.md` literal al tope de cada brief**, nunca resumido. Si no existe → `/kickoff` primero. `content/INDEX.md` decide qué cargar (no el repo entero). El context bundle suma extracto del perfil (`memory/project-profile.json`) + `docs/company.md` si tiene contenido real (D10).
- **Brief Contract obligatorio (D10):** ningún agente se lanza sin los 6 puntos (rol profundo, objetivo verificable, contexto inyectado, no-goals, formato, recordatorio D6). Brief débil = no se lanza.
- **Cold-reader gate independiente:** solo recibe `principles.md` + deliverable, sin historial de critic.
- **Imágenes:** validación multimodal obligatoria + refs declaradas mencionadas en el texto del prompt (D10/D12).

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

## Referencia rápida — tests

Tabla completa de tests + qué valida cada uno en `docs/capacidades.md` (sección "Referencia rápida — tests"). Regla de oro: `npm run smoke` gasta credits reales, no lo corras en cada commit — usa los tests específicos para CI continuo.

## Feedback al starter Mazelab

En la raíz hay un archivo `feedback.md`. Es el canal para reportar findings sobre el starter mismo (skills faltantes, scripts rotos, anti-patrones, contracts que no encajan en uso real) — **NO** para bugs/features del proyecto consumer.

**Flujo:**
1. Cuando aldot ve algo del starter que falla o falta, te dice: _"anota esto en `feedback.md`"_. El usuario solo dice eso — la estructura del archivo es **self-documented**, no le preguntes formato.
2. Agregas tu finding bajo la sección `## NUEVO (sin procesar)` de `feedback.md`: fecha, contexto, finding, acción sugerida (opcional). Texto libre, sin formato rígido.
3. Cuando aldot retoma sesión sobre el starter, le da la ruta del `feedback.md` al orquestador del starter, que lee `## NUEVO`, sintetiza al inbox global, aplica fixes y mueve lo procesado a `## Archivo` con fecha.

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

**v4.2.1** (2026-06). Plan vivo en `process-log/v3-plan.md`. Decisiones cerradas en `process-log/00-decisions.md` (ley).

Cambios v3.1 sobre v3 (Sprint v3.1): helper `src/load_env.js` para carga idempotente del `.env`; chat público orquestador↔agentes en el dashboard; skill `dual-auditor-protocol` en el catálogo; review-app oficial migrada al starter; sync `roadmap/current-sprint.json` ↔ `dashboard/state.json` automático vía `roadmap.js`; kickoff con capa de contraste post-respuestas + sub-tipo `business-with-software`; campo `sprint_number` en task schema; timeout configurable en `openrouter_client.chat()`; D6 (subagentes sin Write) y D7 (sync current-sprint canónico) cableadas.
