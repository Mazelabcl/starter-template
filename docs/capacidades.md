# Capacidades del starter — referencia on-demand

Este doc lo carga el orquestador cuando va a evaluar **qué skill usar** o **qué test correr**. No es de lectura obligatoria al arranque — vive fuera de `CLAUDE.md` para no inflar el contexto de cada sesión.

## Capacidades disponibles

Todas las skills core viven en `.claude/skills/`. Las opcionales en `.claude/skills/_catalog/` y se activan vía `/kickoff` o copia manual. La fuente machine-readable del catálogo es `.claude/skills/_catalog/skills-catalog.json` (úsala en el kickoff para razonar qué skills proponer).

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
- **client-language** (catálogo): cuando el deliverable es para cliente/audiencia final, prohíbe jerga técnica y fuerza lenguaje humano. Propónla si el proyecto tiene audiencia no técnica.
- **non-technical-cold-reader** (catálogo): gate binario GO/NO-GO que veta un deliverable de cliente si contiene jerga técnica.
- **superpowers-pr** (catálogo, opcional): 5 reglas duras para Git/PR/code review formal. Vive en `.claude/skills/_catalog/superpowers-pr/`. Activarla solo si el proyecto usa flujo PR formal — kickoff lo decide.

### Memoria, roadmap y voz

- **memory.js** (`src/memory.js`): lectura/escritura de la memoria del proyecto. Helpers: `summarize`, `readProfile`, `writeProfile`, `addDecision`, `addLesson`, `addAgent`, `touchAgent`, `addSprint`, `getActiveTeam`. Detalle: `memory/README.md`.

  > **Nota:** `addDecision({ ..., reversibility })` espera `reversibility` como enum estricto: `alta` | `media` | `baja`. Texto libre falla con `MemoryError`. Mismo cuidado con otros campos enum del schema.

- **roadmap.js** (`src/roadmap.js`): gestión de sprint actual + backlog priorizado. Helpers: `addIdea`, `getCurrentSprint`, `closeSprint`. Slash command `/idea` para captura sin desvío.
- **voice-mode** (skill + `scripts/voice_tts.js`): TTS de respuestas largas con OpenAI TTS. Comandos `/voz-on`, `/voz-off`, `/voz-leer`. Defaults en `memory/voice-mode-state.json`.

### Observabilidad — dashboard v3 (HTML simple)

- **Dashboard HTML simple de estado** (vanilla JS, cero deps de frontend) con tabla de tareas en vivo (Agente, Estado, Modelo, Tokens, Summary) + pestañas Sprint / Roadmap / Chat. `npm run dashboard` lo levanta en `http://localhost:7777`. Lee `state.json` vía `/api/state` + SSE. Modo público read-only con `DASHBOARD_PUBLIC=1`. Detalle: `dashboard/README.md`. (v4: degradado desde el pixel-art Phaser — decisión D8. La review-app es la superficie HTML preferida para consumir output de agentes.)
- **Cómo lo alimentan los agentes**: `node scripts/update_state.js task-start <id> <agent> <role> <title> [files...] [--prompt ...] [--plan-step ...]... [--current-step N] [--phase ...] [--epic ...]` + `task-update <id> '<json-patch>'` + `task-complete <id> [tokens]`. El helper escribe atómico a `dashboard/state.json` y notifica al server. Schema completo de la task en `dashboard/README.md`.

### review-app — superficie canónica para consumir output

- **review-app** (`review-app/server.js`, catálogo): app HTTP local zero-dep para leer output de agentes. Modo "sprint/bloques" (revisar PRs marcando OK/Feedback) y modo "viewer" (lista cualquier `.md` de un directorio con TLDR = H1 + primer párrafo, click abre el `.md` renderizado). `npm run review-app`. Es la superficie HTML preferida del usuario para consumir output. Detalle: `review-app/README.md`.

## Referencia rápida — tests del repo

Cuando algo se rompa, estos tests son el primer chequeo:

| Test | Qué valida |
|---|---|
| `npm run smoke` | Sistema completo end-to-end (8 checks, ~90s, gasta API). |
| `npm run smoke:quick` | Estructura solamente, sin red. |
| `npm run test:contracts` | Schemas + emit/consume del sistema de hand-offs. |
| `npm run test:dashboard` | Server HTTP + SSE + history + helper update_state.js + modo público read-only. |
| `npm run test:skills-catalog` | `skills-catalog.json` parsea + cubre todas las skills en disco (sin huérfanos ni faltantes). |
| `npm run test:review-app` | review-app server: modo sprint/bloques + modo viewer. |
| `npm run test:roadmap-sync` | Sync `current-sprint.json` ↔ `state.json`. |
| `npm run test:load-env` | Carga idempotente del `.env`. |
| `node memory/test.js` | Helpers de memoria del proyecto. |
| `node pipeline-v2-integration.test.js` | Flujo completo pipeline v2. |
| `node docs-v3.test.js` | Documentación v3 al día. |

No corras `npm run smoke` en cada commit — gasta credits reales. Para CI continuo, usa los tests específicos.
