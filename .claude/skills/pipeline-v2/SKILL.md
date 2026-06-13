---
name: pipeline-v2
description: Orquesta el flujo de creación de cualquier artefacto creativo del proyecto con hand-off contracts verificables y memoria persistente del proyecto. Capa 0 (principles + memoria) → Capa 1 (architect) → Capa 2 (critic interno) → Capa 3 (cold-reader gate) → Capa 4 (humano decide). Cada transición valida output contra un JSON Schema antes de avanzar. Triggers "construye X", "vamos a crear Y", "/pipeline-v2", o cualquier creación no trivial.
allowed-tools: Read, Write, Glob, Bash, Task
---

# pipeline-v2 — orquestación de artefactos creativos con contratos y memoria

Este es el flujo estándar para crear cualquier cosa no trivial en el proyecto. Sin esto, los agentes drifteán y los outputs pasan validación interna pero fallan en lectura cold. La v3 agrega dos cosas que la v2 no tenía:

- **Hand-off contracts** entre cada par de capas: cada output se valida contra un JSON Schema antes de pasar a la siguiente. Si falla, no avanza.
- **Memoria del proyecto** integrada al ciclo: la skill lee `memory/` al arrancar, registra invocaciones de agentes durante el flujo y escribe decisiones/lecciones cuando emergen.

La filosofía de las 5 capas y del cold-reader independiente sigue intacta. Lo que cambia es que ahora cada hand-off es verificable y el pipeline aprende del proyecto.

## Cuándo invocar esta skill

- Cualquier creación no trivial: guion, texto narrativo, plan, propuesta, set de imágenes, agente nuevo, skill nueva, código de feature significativo.
- Después de `/kickoff` cuando el usuario pide un primer entregable concreto.
- Cuando el usuario dice "construye X", "vamos a crear Y", "/pipeline-v2".

## Cuándo NO invocarla

- Tareas triviales (typo, one-liner, explicación de algo existente).
- Tareas puramente técnicas con tests automáticos como verificación (compilar Pine, correr lint, etc.) — usa los validators del dominio.
- Cuando el usuario pide explícitamente un draft rápido sin gates.

## Archivos y herramientas que usa

- `contracts/helpers.js` → `emitOutput`, `consumeInput`, `declareContract`, `assertFileExists`, `ContractViolation`.
- `contracts/schemas/` → `architect-output`, `critic-output`, `cold-reader-output`, `image-gen-output`, `research-output`.
- `src/memory.js` → `summarize`, `touchAgent`, `addAgent`, `addDecision`, `addLesson`, `addSprint`, `getActiveTeam`.
- `content/principles.md` y `content/INDEX.md` → canon del proyecto.
- `process-log/00-decisions.md` → decisiones humanas (ley).

Si una de las funciones anteriores no se ha usado nunca en este repo, igual está disponible — los helpers fueron diseñados para ser idempotentes.

## Las 5 capas (orden no negociable)

Cada capa declara: qué input espera, qué contrato valida al consumirlo, qué output produce, qué contrato valida al emitirlo y a qué capa transiciona.

### Capa 0 — Carga de contexto (principles + memoria)

**Input esperado:**
- `content/principles.md` debe existir y no estar vacío.
- `content/INDEX.md` decide qué archivos cargar para esta tarea.

**Acciones:**
1. Llamar `summarize()` desde `src/memory.js`. Esto retorna un snapshot ligero con `has_profile`, `agentes_count`, `decisiones_count`, etc. Es barato y siempre se hace.
2. Si `has_profile === false` → frenar y proponer `/kickoff` antes de continuar.
3. Si `decisiones_count > 0` y la tarea pisa terreno donde puede haber decisiones previas → leer `memory/decisions.md` literal.
4. Si `lecciones_count > 0` y la tarea es del mismo dominio que alguna lección registrada → leer `memory/lessons.md` literal.
5. Si `process-log/00-decisions.md` no está ya en contexto, leerlo (decisiones humanas, son ley). Cita las decisiones por ID (D3, D6...), no cargues el archivo entero en briefs.
6. Mirar la tabla de `INDEX.md` y cargar **solo** los archivos listados como obligatorios + los aplicables. No el repo entero.
7. **Sumar al bundle el perfil + company.md (D10).** Lee `memory/project-profile.json` y extrae solo `project_type`, `mode`, `description`, `owner` (no el archivo entero). Lee `docs/company.md` **solo si tiene contenido real** (no los placeholders del template `(describe en 2-3 líneas)`). Estos dos van al context bundle para que todo brief tenga el norte del proyecto sin que el agente lo asuma. El mecanismo de inyección ya existe (principles literal + INDEX); esto solo amplía las fuentes.

**Precondición ejecutable:** `assertFileExists('principles', 'content/principles.md')` antes de cualquier brief.

**Output de la capa:** un "context bundle" en memoria (no se escribe a disco) que incluye principles literal, archivos del INDEX, decisiones humanas, snapshot de memoria, **extracto del perfil (`project_type`/`mode`/`description`/`owner`) y `company.md` si tiene contenido real**.

**Transición a Capa 1:** se pasa el bundle al architect como parte del brief (o a Capa 0.7 primero si la tarea es compuesta).

### Capa 0.7 — Diseño y presentación de equipo (D10, EXPERIMENTAL)

> **Feature experimental para validar que los prompts son ricos.** Por terminal por ahora; presentación en HTML es futuro. Puede removerse si no aporta valor. Para tareas de UN solo agente trivial NO es obligatorio (evita verbosidad gratuita).

**Cuándo aplica:** ANTES de lanzar sub-agentes para una **tarea compuesta** (2+ agentes — ej. una landing que necesita diseñador front + copywriter + experto en keywords). Para un solo agente trivial, sáltala.

**Acciones del orquestador:**
1. **Lista los roles necesarios.** ¿Diseñador front? ¿Copywriter? ¿Experto en keywords? ¿Investigador? Deriva los roles del brief y del context bundle, no de inercia.
2. **PRESENTA el equipo al usuario** en formato digerible. Por cada agente:
   - **Rol + experiencia** (1 línea, perfil profundo — ver Brief Contract en Capa 1).
   - **Objetivo** (1-3 metas numeradas y verificables).
   - **Pasos clave** que seguirá.
   - **RESUMEN del contexto inyectado** (descripción de qué recibe: principles, extracto de perfil, decisiones aplicables) — **NO copy-paste literal del contexto**, solo el resumen.
3. **Espera OK o ajuste del usuario** antes de delegar. Si el usuario corrige un rol, un objetivo o el contexto, ajusta antes de lanzar.

**Por qué existe:** obliga al orquestador a redactar el Brief Contract completo ANTES de delegar, y le da al usuario (vibe coder) una vista clara de "a quién contrata" para cada pieza. Si el equipo presentado se ve pobre ("experto en X" a secas), es señal de que el brief no cumple el Brief Contract — corregir antes de gastar tokens en sub-agentes.

**Formato de presentación sugerido (terminal):**

```
Te presento al equipo para esta tarea:

1. <slug-agente> — <rol profundo + experiencia, 1 línea>
   Objetivo: (1) ... (2) ...
   Pasos: lee X → produce Y → valida Z.
   Contexto que recibe: principles literal + perfil (tipo/modo) + D3, D6.

2. <slug-agente> — ...

¿Lanzo así o ajustas algo?
```

**Transición:** con el OK del usuario → Capa 1 por cada agente. Sin OK → ajustar y re-presentar.

### Capa 1 — Architect / creator

**Input esperado:** el context bundle de Capa 0 + brief específico de la tarea.

#### Brief Contract — checklist OBLIGATORIO antes de lanzar cualquier agente (D10)

Todo brief a un sub-agente es una **precondición**: si no cumple los 6 puntos, NO se lanza el agente. Un brief débil ("eres experto en X, hazme Y") produce output genérico y desperdicia tokens. El Brief Contract fuerza profundidad:

1. **ROL profundo** — no "experto en X" a secas, sino "experto en X que ha hecho Y para empresas/proyectos del tipo Z", con experiencia simulada relevante. Ej.: *"Eres copywriter de conversión con 8 años escribiendo landings SaaS B2B que han levantado seed rounds"*, no *"eres copywriter"*.
2. **OBJETIVO** — 1-3 metas numeradas y verificables. Verificable = se puede comprobar si se cumplió (no "que quede bien").
3. **CONTEXTO inyectado** — `principles.md` literal + extracto del perfil (`project_type`/`mode`/`description`) + las decisiones aplicables (citadas por ID: D3, D6...) + `company.md` si aplica. **Inyectado, no asumido** — el agente no adivina el norte del proyecto.
4. **NO-GOALS / restricciones** — qué NO hacer (no inventar datos, no tocar el archivo X, no salirse del tono, etc.).
5. **FORMATO de salida** esperado — estructura, schema si aplica, longitud, idioma.
6. **Recordatorio D6** — literal: *"Entrega tu output como texto en tu respuesta final. NO uses la Write tool — el wrapper la bloquea. El orquestador persistirá el archivo."*

Si la tarea es compuesta (2+ agentes), el Brief Contract de cada agente se redacta en Capa 0.7 y se presenta al usuario antes de delegar.

#### Research proactivo antes de afirmar datos de mundo real (D11)

Antes de que un agente afirme datos de mundo real — naming/branding, tendencias, cifras de mercado, competidores, precios, o cualquier cosa post-corte-de-conocimiento — el orquestador **PROPONE research** (`node src/research.js pro "..."` o `deep` para más profundidad) en vez de dejar que el agente invente. Reactivo → proactivo.

**Señales que disparan la propuesta:** "tendencias 2026", "qué se sabe de", "estado del arte", naming/branding, precios, competidores, o cualquier decisión con incertidumbre factual. Si detectas estas señales en el brief, propón el research ANTES de lanzar al agente y enriquece el context bundle con el resultado.

**Acciones:**
1. Si el architect aún no declaró contract → llamar `declareContract({ agent, inputs, outputs, preconditions, postconditions })` con la firma del agente. Persiste en `contracts/declared/<agent>.json`.
2. Si el architect aún no está en `active-team.json` → llamar `addAgent({ name, role, model })`. Si ya está, llamar `touchAgent(name)` para registrar invocación.
3. Lanzar al agente con `principles.md` literal al tope (no resumido), archivos del INDEX, brief, y reportar modelo usado.
4. Si es R2+, aplicar el protocolo "DIFF de pérdidas": antes de iterar, listar 5 cosas del R1 que NO debe perder. Pegar literal al brief de R2.
5. El agente devuelve un objeto que cumple el schema `architect-output`.

**Contrato a emitir:** `emitOutput('architect-X', 'architect-output', proposal, 'content/architect/<tarea>.json')`. Si el output no valida, `emitOutput` lanza `ContractViolation` y no escribe nada — esto evita contaminar el disco con archivos rotos.

**Output esperado:** un archivo JSON en `content/architect/` que cumple `architect-output` (campos obligatorios: `agent`, `model`, `produced_at`, `artifact_kind`, `title`, `sections` con al menos 1 entrada).

**Transición a Capa 2:** el path del JSON del architect se pasa al critic.

### Capa 2 — Critic interno multi-óptica

**Input esperado:** el JSON del architect.

**Acciones:**
1. `consumeInput('critic-X', 'architect-output', '<path>')` re-valida el JSON antes de procesarlo. Si fue editado a mano, si el schema cambió, o si el productor era de versión vieja, el critic se entera ahora y no después.
2. Lanzar 3-4 ópticas relevantes al artefacto (showrunner, formato del medio, voice del cliente, etc.). NO incluye cold-reader — esa es Capa 3.
3. Llamar `touchAgent` por cada óptica que sea un agente registrado.
4. Producir un objeto que cumple `critic-output` (scores 0-100 por criterio, lista de issues con severity, verdict ∈ {pass, iterate, reject}).

**Contrato a emitir:** `emitOutput('critic-X', 'critic-output', critique, 'content/critic/<tarea>.json')`.

**Output esperado:** un JSON en `content/critic/` con scores y must-fix accionables.

**Transición:**
- Si `verdict === 'iterate'` o `verdict === 'reject'` y los issues son atajables → vuelve a Capa 1 con DIFF de pérdidas + must-fix.
- Si `verdict === 'pass'` → avanza a Capa 3.
- Máximo 3 ciclos critic↔architect. Después de 3, frena y notifica al humano.

### Capa 3 — Cold-reader gate

**Input esperado:** SOLO `principles.md` + el deliverable final del architect (NO el output del critic, NO debate previo, NO scores). Esto es lo que hace al cold-reader independiente.

**Acciones:**
1. Invocar la skill `cold-reader-gate` (idealmente con modelo distinto al architect para reducir self-confirming).
2. El gate produce un objeto que cumple `cold-reader-output` (vote ∈ {GO, NO-GO}; si NO-GO, `reason` es obligatorio por el schema).

**Contrato a emitir:** `emitOutput('cold-reader', 'cold-reader-output', vote, 'content/cold-reader/<tarea>.json')`.

**Transición:**
- Si `vote === 'GO'` → Capa 4.
- Si `vote === 'NO-GO'` → vuelve a Capa 1 con `reason` y `blocking_principles` como input para el siguiente architect run. Máximo 3 ciclos cold-reader↔architect. Después de 3, frena y propone replantear el brief.

### Capa 4 — Humano decide

**Input esperado:** el deliverable final + el `cold-reader-output` con vote=GO.

**Acciones:**
1. Presentar al humano el deliverable y el path del JSON de cold-reader.
2. Escribir `process-log/XX-{tarea}-{ronda}.md` con resumen de las rondas, modelos usados y decisiones tomadas.
3. Si el humano aprueba con cambios menores → registrarlo como decisión vía `addDecision({ title, decision, reasoning, alternatives, reversibility })`.
4. Si el humano hace **override** del veto del cold-reader (caso raro pero válido) → es decisión arquitectónica y va a `addDecision` obligatorio con `reversibility` explícito.
5. Si durante el flujo apareció un patrón de fallo identificable (ej. "el critic siempre se queja de X cuando el architect usa el modelo Y") → registrar vía `addLesson({ title, context, lesson, application })`.

**Output esperado:** humano aprueba, edita o pide otra ronda.

## Hand-off contracts — cómo funcionan en concreto

Cada transición entre capas pasa por dos puntos de validación:

1. **Al emitir** (`emitOutput`): el productor valida el output contra el schema antes de escribirlo. Si falla → lanza `ContractViolation`, no escribe nada.
2. **Al consumir** (`consumeInput`): el consumidor re-valida el archivo antes de procesarlo. Detecta ediciones manuales, schemas evolucionados, productores viejos.

Ambos lanzan `ContractViolation` (extiende `Error`) con mensajes legibles que indican agente, schema, path y el campo específico que falló.

Ejemplo copy-pasteable de `emitOutput`/`consumeInput` + manejo de `ContractViolation`: `contracts/README.md` §1.

### Tabla de hand-offs del pipeline

| De → A | Schema validado | Path típico |
|---|---|---|
| Capa 0 → Capa 1 | (sin schema, context bundle in-memory) | — |
| Capa 1 → Capa 2 | `architect-output` | `content/architect/<tarea>.json` |
| Capa 2 → Capa 1 (loop iterar) | `critic-output` | `content/critic/<tarea>.json` |
| Capa 2 → Capa 3 (cuando pass) | `architect-output` (re-validado) | `content/architect/<tarea>.json` |
| Capa 3 → Capa 4 | `cold-reader-output` con vote=GO | `content/cold-reader/<tarea>.json` |
| Capa 3 → Capa 1 (loop NO-GO) | `cold-reader-output` con vote=NO-GO | `content/cold-reader/<tarea>.json` |

## Memoria del proyecto — qué se lee, qué se escribe, cuándo

### Al INICIO de cada invocación de la skill

- `summarize()` siempre. Snapshot ligero, barato.
- `readProfile()` si vas a tomar decisiones que dependen del modo del proyecto (rapido vs profundo).
- `getActiveTeam()` antes de decidir qué agente lanzar.
- Cargar `decisions.md` literal solo si `decisiones_count > 0` y la tarea está en zona donde decisiones pasadas pueden aplicar.
- Cargar `lessons.md` literal solo si `lecciones_count > 0` y la tarea es del mismo dominio.

### DURANTE el flujo

- `touchAgent(name)` cada vez que invocas a un agente registrado (incluso si ya pasó por la skill antes en la misma sesión). Mantiene `total_invocaciones` y `ultimo_uso` actualizados.
- `addAgent({ name, role, model })` la primera vez que un agente nuevo se usa en este proyecto.
- `declareContract({...})` la primera vez que un agente se invoca — persiste su firma en `contracts/declared/<agent>.json`.

### Al CERRAR el flujo

- Si el humano hizo override del veto cold-reader → `addDecision` obligatorio con razonamiento.
- Si emergió una lección operacional (un patrón de fallo, una receta que funcionó) → `addLesson`.
- Si esta invocación cierra un sprint completo → llama `closeSprint()` desde `src/roadmap.js` (que internamente hace `addSprint` + actualiza el roadmap + sincroniza con dashboard).

No escribir más de lo necesario. La memoria se mantiene útil porque está curada, no porque sea exhaustiva.

## Convención de chat público (Sprint v3.1)

El dashboard expone una pestaña "Chat" con feed cronológico de comunicación orquestador ↔ agentes. **Cada brief a sub-agentes del pipeline debe incluir esta instrucción literal**:

> "Cuando termines un milestone significativo (research listo, primer draft escrito, validación pasada), llama:
>
> ```bash
> node scripts/update_state.js say <tu-nombre> orquestador "<descripción 1 línea del milestone>"
> ```
>
> El humano que mira el dashboard verá tu avance en la pestaña Chat sin tener que preguntarme cómo va. Si el dashboard no está corriendo, el comando es silencioso — no rompe nada."

**Importante:** el chat NO reemplaza el output formal (hand-off contracts siguen siendo la verdad). Es narrativa para el humano. Mensajes típicos:
- `say architect orquestador "research completado, escribiendo proposal"`
- `say critic architect "missing section sobre edge cases, RE-DO"`
- `say architect orquestador "R2 listo, pass internal critic"`
- `say cold-reader orquestador "GO, deliverable listo para review humano"`

Limitación A7 (subagentes y Write): los sub-agentes NO pueden hacer `Write` directo a archivos del proyecto desde su wrapper. Devuelven todo como TEXTO. El orquestador hace el `Write`. Esto NO afecta al helper `say` porque éste es un comando Bash que el sub-agente ejecuta (no es Write); el comando hace el append al log él mismo.

## Manejo de fallos contractuales

Cuando una capa produce output que NO valida contra su contract, decide entre 3 opciones:

### Opción A — Reintentar el mismo agente con feedback del error

Aplica cuando:
- El error es claramente del modelo (campo faltante, formato mal, value fuera del enum).
- Es la primera o segunda vez que el agente falla en este flujo.

Cómo:
1. Captura el `ContractViolation`. El `.message` ya tiene el campo y schema que falló.
2. Construye un brief de re-intento que incluye literal el mensaje de error y la sección del schema que se rompió.
3. Vuelve a invocar al mismo agente con ese brief añadido.
4. Si falla de nuevo → escala a Opción B o C.

### Opción B — Frenar y notificar al humano

Aplica cuando:
- El agente falló 2-3 veces en el mismo punto.
- El error sugiere ambigüedad en el brief o en el schema.
- La tarea no es urgente y el humano puede ajustar.

Cómo:
1. Reportar al humano: qué capa, qué agente, qué schema, qué campo, los últimos 2 intentos.
2. Esperar instrucción: ¿editar brief? ¿ajustar schema? ¿cambiar modelo? ¿saltar capa esta vez?
3. Si la decisión es estructural (ej. ajustar schema, cambiar agente default) → registrar con `addDecision`.

### Opción C — Saltar la capa con override explícito (solo en emergencia)

Aplica cuando:
- El humano tiene urgencia y aceptó conscientemente saltarla.
- Es claro que el sistema podrá recuperarse después.

Cómo:
1. **Obligatorio:** registrar `addDecision({ title: 'Skip Capa N en tarea X', decision: '...', reasoning: 'override por urgencia', alternatives: 'esperar fix del schema', reversibility: 'alta' })`.
2. **Obligatorio:** registrar `addLesson` con el patrón de fallo, para que la próxima vez se atrape antes.
3. Avanzar con la advertencia explícita en el process-log.

## Reglas duras

1. **principles.md literal, no resumido.** Resumir = drift garantizado.
2. **INDEX manda qué cargar.** Cargar más = drift por contexto extra.
3. **DIFF de pérdidas en R2+.** Sin esto, cada ronda pierde lo bueno de la anterior.
4. **Cold-reader es independiente.** No le pases historial. Si lo haces, su veto deja de servir.
5. **Modelo tracking.** Cada agente reporta el modelo usado en el campo `model` del schema.
6. **Validation multimodal en imágenes.** Skill `multimodal-validation` obligatoria después de generar PNG.
7. **Refs mencionadas en texto del prompt.** Cada `Image N` declarada DEBE estar nombrada en el prompt.
8. **Idioma del proyecto.** Forzado al inicio de cada brief, según `principles.md`.
9. **Cada hand-off pasa por contract.** No hay "confío en el agente, lo paso directo".
10. **Memoria curada, no exhaustiva.** Solo escribir cuando algo emergió de verdad.
11. **Brief Contract obligatorio (D10).** Ningún agente se lanza sin los 6 puntos: rol profundo, objetivo verificable, contexto inyectado, no-goals, formato, recordatorio D6. Brief débil = no se lanza.
12. **Research proactivo (D11).** Ante un claim factual de mundo real, el orquestador propone `src/research.js` antes de dejar que el agente invente.

## Regla anti-watchdog para sub-agentes Opus en outputs largos

Cuando lances un agente que escribe archivos largos (outline >50 slides, código >500 líneas, guion >3000 palabras), incluye **literal** en el brief esta cláusula al inicio:

```
EMPIEZA YA. Lee inputs, después escribe el archivo INMEDIATAMENTE.
No planifiques en mensajes — planifica en comentario HTML al tope.
Tu plan vive en el archivo, no en la conversación.
```

**Por qué:** sin esto, el sub-agente puede entrar en "deliberación extendida" y el watchdog del stream lo mata a los 600s sin progreso. Caso real: F12 en `process-log/findings-for-template.md` — el architect R4 quedó >10 min sin escribir y el stream se cortó.

Patrón de mitigación adicional: split de tareas grandes en 2 mini-tareas más cortas (ej. R4a = rellenar placeholders, R4b = refactor conectores) cuando el output esperado es muy extenso.

## Anti-patrones (NO hacer)

| Anti-patrón | Por qué falla |
|---|---|
| Lanzar architect con 15+ archivos de contexto | Drift por extrapolación |
| Critic con cold-reader como una voz más en la rúbrica | Self-confirming, scores inflados |
| Validation textual sin Read multimodal del PNG | Bugs visuales se escapan |
| Refs cargadas pero no mencionadas en texto del prompt | Modelo las ignora |
| Múltiples R1, R2, R3 sin DIFF de pérdidas | Cada ronda pierde lo bueno del anterior |
| Pasar paths absolutos dispersos al usuario | Friction de copy-paste, mejor subcarpetas |
| Hand-off sin `consumeInput` ("confío en el archivo") | El bug aparece 2 capas después, lejos de la causa |
| Escribir output del agente directo a disco con `fs.writeFile` | Te saltas la validación del schema; usa `emitOutput` |
| Pasarle al cold-reader el historial de critic | Su veto deja de ser independiente |
| `addLesson` por cada turno | Memoria deja de ser útil cuando se llena de ruido |
| Loop infinito critic↔architect sin cap | Quema tokens y nunca converge; cap a 3 ciclos |

## Ejemplo end-to-end (corto)

Usuario: "construye el capítulo 03 del proyecto Pax".

1. **Capa 0.** Llamo `summarize()` → `has_profile=true`, `decisiones_count=4`, `lecciones_count=2`. Leo `principles.md` (literal), `INDEX.md` (decide cargar `char_pax.md` y `tono.md`), `00-decisions.md`, `memory/decisions.md` (hay una decisión sobre tono cómic), `memory/lessons.md` (hay una lección sobre refs no mencionadas).

2. **Capa 1.** No tengo `architect-pax` en `active-team` → `addAgent({ name: 'architect-pax', role: 'crea capítulos', model: 'claude-opus-4-7' })`. Llamo `declareContract({...})`. Lanzo el agente con principles literal + char_pax + tono + brief + DIFF de pérdidas si es R2. El agente retorna proposal. Llamo `emitOutput('architect-pax', 'architect-output', proposal, 'content/architect/cap03.json')`. Valida → escribe.

3. **Capa 2.** Llamo `consumeInput('critic-pax', 'architect-output', 'content/architect/cap03.json')`. Valida → procedo. Lanzo 3 ópticas en paralelo (showrunner, formato cómic, voz Pax). Llamo `touchAgent` por cada una. Cada óptica retorna scores + issues. Sintetizo en un `critic-output` con `verdict: 'iterate'`, llamo `emitOutput`. Hay must-fix → vuelvo a Capa 1 con DIFF de pérdidas.

4. **Capa 1 (R2).** Architect re-itera. Esta vez el critic da `verdict: 'pass'`.

5. **Capa 3.** Invoco `cold-reader-gate` con SOLO `principles.md` + `content/architect/cap03.json` (no le paso el critic). Retorna `vote: 'GO'`. Llamo `emitOutput`. Valida → escribe.

6. **Capa 4.** Presento al humano el deliverable + path del cold-reader. Aldot aprueba. Escribo `process-log/03-cap03-r2.md` con resumen. Detecté un patrón ("el architect ignora el principio P05 en R1") → llamo `addLesson({ title: 'Principio P05 requiere recordatorio explícito en brief R1', context: '...', lesson: '...', application: 'Brief R1 debe citar P05 literal' })`.

Total: 2 hand-offs validados con architect↔critic, 1 con architect→cold-reader, 1 con cold-reader→humano. Memoria actualizada con 1 lesson. Cero outputs corruptos pasaron entre capas.

## Versión

v3.1 — 2026-06-02 — Sprint v4.1 (hardening del core). Agrega: Brief Contract obligatorio en Capa 1 (D10), Capa 0.7 "te presento al equipo" experimental (D10), research proactivo ante claims factuales (D11), e inyección de perfil + `company.md` al context bundle de Capa 0 (D10). v3.0 — 2026-05-09 — Sprint 1.3: hand-off contracts + memoria del proyecto. Ver `CHANGELOG.md`.
