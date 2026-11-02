# Capacidades del starter — referencia on-demand

Este doc lo carga el orquestador cuando va a evaluar **qué skill usar** o **qué test correr**. No es de lectura obligatoria al arranque — vive fuera de `CLAUDE.md` para no inflar el contexto de cada sesión.

## Capacidades disponibles

Todas las skills core viven en `.claude/skills/`. Las opcionales en `.claude/skills/_catalog/` y se activan vía `/kickoff` o copia manual. La fuente machine-readable del catálogo es `.claude/skills/_catalog/skills-catalog.json` (úsala en el kickoff para razonar qué skills proponer).

### Texto y research

- **Research vía Perplexity (OpenRouter)**: `node src/research.js <quick|pro|search|reason|deep> "<pregunta>" [--timeout-ms=N]`. Default `pro`. Devuelve `citations` (URLs) y `sources` (URL + título). `deep`/`reason` usan 300000 ms de timeout por defecto. Para info actualizada, **siempre** úsalo — no inventes datos.
- **Cliente OpenRouter unificado** (`src/openrouter_client.js`): acceso a Anthropic, OpenAI, Google, DeepSeek, Qwen, Meta, Perplexity con una sola key. Base de councils y de cualquier flujo multi-modelo. Detalle: `src/openrouter_client.README.md`.

### Imágenes

- **gpt-image-2** (Python): `<python-del-venv> scripts/openai_images.py generate|edit|batch …` — usa el intérprete del venv (`.venv\Scripts\python.exe` en Windows, `.venv/bin/python` en Mac/Linux), donde está instalado `openai`; el `python` del sistema no lo tiene. La skill `image-gen` lo orquesta con identity lock, refs declaradas en el prompt, y batch async.
- **Modelos económicos vía Replicate** (`scripts/replicate_images.py --model <flux2-dev ~$0.012 | ideogram-v3 ~$0.03 | nano-banana-pro ~$0.04>`): misma firma pública (`generate_image` / `edit_image`) y mismas reglas de referencia que gpt-image-2 (D12/D13). Para iteración rápida o cuando la calidad extrema no importa. `scripts/gemini_images.py` es ruta alternativa para Nano Banana Pro.
- **image-explorer multi-modelo** (`src/image_explorer.js`): compara mismo prompt en gpt-image-2, FLUX, Imagen 3, Ideogram, Recraft, SD 3.5 y arma grilla HTML para elegir ganador. Útil para concept art, branding, exploración de "mano de modelo". Detalle: `src/image_explorer.README.md`.
- **multimodal-validation** (skill): fuerza Read del PNG después de cualquier `generate_image()` / `edit_image()`. Sin esto no hay PASS.

### Decisiones complejas

- **council** (skill + `src/council.js`): council de expertos. 16 personas (CTO, SRE, PM, CFO, usuario novato, visionario...) opinan por separado y un integrador fusiona lo mejor de cada una, con cada aporte atribuido. 8 plantillas por situación; `node src/council.js suggest "tarea"` propone cuál usar. También se eligen expertos a mano (`--personas`), se crean al vuelo (`--crear "Rol: foco"`, con `--guardar` para conservarlos) o los elige Claude ("arma tú el panel de expertos"). Modo `multimodel` para arquitectura crítica. Resultado votable en el cockpit. Slash: `/council`. Detalle: `councils/README.md` y `.claude/skills/council/SKILL.md`.

### Rediseño por rondas

- **bold-rounds** (skill + `scripts/bold_rounds.js`, slash `/bold-rounds <objetivo> [N]`): mejora audaz de una web, proyecto o documento sobre una COPIA en `rounds/`. Cada ronda corre dos variantes en paralelo: **ciega** (subagente sin memoria, para innovar sin sesgo) y **contexto** (conoce rondas previas y tu feedback). Screenshots escritorio 1440 / celular 390 con Playwright, diff de píxeles que rechaza cambios invisibles, revisión `kind: "rounds"` en el cockpit con antes/después, pausa de control cada 3 rondas sin humano y tope de 10. El original solo cambia cuando dices "aplicar" (`node scripts/bold_rounds.js changes` lista qué cambiaría). Modo desatendido: `node scripts/bold_rounds.js run <ronda>` (usa `claude -p`). Screenshots requieren una vez `npm install --no-save playwright-core` (usa tu Chrome o Edge). Demo: `examples/cafeteria-90s/`.

### Orquestación y calidad

- **kickoff**: entrevista adaptativa que termina en un plan de batalla publicado en el cockpit (`kind: "plan"`, armado con `.claude/skills/kickoff/plan.js`): TLDRs, equipo con "actúa como", brazos, proceso, councils y riesgos. Tras aplicar el feedback autogenera `content/principles.md` + `content/INDEX.md` + `memory/project-profile.json` + `memory/active-team.json` + sprint inicial.
- **brazos** (`src/brazos.js` + `brazos/directorio.json`): ~40 integraciones para ejecutar (MCP, API, CLI, skill, librería, plugin, conector) con comando de conexión, credencial, costo, riesgos y si está verificado. `status` (conectado / falta auth / no instalado), `suggest "<proyecto>"`, `connect <id>` (solo imprime pasos), `mcp-json <ids> [--write]`. Detalle: `brazos/README.md`.
- **video-director** (catálogo): video por código con guion de dirección aprobado antes de animar; usa la biblioteca de efectos de Aldot y HyperFrames.
- **agent-template**: genera un agente nuevo con las secciones estructurales listas.
- **confidence-loop** (catálogo, opcional): itera un artefacto hasta un score alto (5 iteraciones máx). Se autoevalúa: úsala como apoyo, no como validación independiente.
- **cold-reader-gate** (catálogo, opcional): lectura en frío con voto GO/NO-GO; recibe solo el canon (`principles.md` o el brief) + el deliverable.
- **client-language** (catálogo): cuando el deliverable es para cliente/audiencia final, prohíbe jerga técnica y fuerza lenguaje humano. Propónla si el proyecto tiene audiencia no técnica.
- **non-technical-cold-reader** (catálogo): gate binario GO/NO-GO que veta un deliverable de cliente si contiene jerga técnica.
- **superpowers-pr** (catálogo, opcional): 5 reglas duras para Git/PR/code review formal. Vive en `.claude/skills/_catalog/superpowers-pr/`. Activarla solo si el proyecto usa flujo PR formal — kickoff lo decide.

### Memoria y roadmap

- **memory.js** (`src/memory.js`): lectura/escritura de la memoria del proyecto. Helpers: `summarize`, `readProfile`, `writeProfile`, `addDecision`, `addLesson`, `addAgent`, `touchAgent`, `addSprint`, `getActiveTeam`. Detalle: `memory/README.md`.

  > **Nota:** `addDecision({ ..., reversibility })` usa el enum `alta` | `media` | `baja` (alta = fácil de deshacer; default `media`). Texto libre se mapea por palabras clave (irreversible → baja, reversible → alta, resto → media) y queda como nota.

- **roadmap.js** (`src/roadmap.js`): gestión de sprint actual + backlog priorizado. Helpers: `addIdea`, `getCurrentSprint`, `startSprint`, `closeSprint`. Slash command `/idea` para captura sin desvío. No edites a mano el contenido entre marcadores de `roadmap.md`; si faltan marcadores, `roadmap.js` los agrega.

### cockpit — revisión con feedback que el orquestador consume

- **cockpit** (`cockpit/server.js` + `src/cockpit.js`): `node src/cockpit.js open [id]` lo levanta en segundo plano (puerto 7788 o el siguiente libre; PID en `cockpit/.server.pid`, log en `cockpit/.server.log`) y abre el navegador; `node src/cockpit.js stop` lo cierra. Modo manual: `npm run cockpit`. Roadmap arriba, foco, votos por ítem, conversación guiada por voz (OpenAI Realtime) o texto, y feedback en `cockpit/feedback/` que el hook de inicio avisa. Publicar: `/revisar` o `node src/cockpit.js publish <archivo>`. Leer: `node src/cockpit.js pending`; cerrar: `node src/cockpit.js done <id>`. Detalle: `cockpit/README.md`.

### Proyectos nuevos y viejos

- **nuevo-proyecto** (`scripts/nuevo-proyecto.ps1`, Windows): `nuevo-proyecto <nombre>` crea el proyecto en la carpeta actual (si estás en tu carpeta de usuario, en `C:\` o en una carpeta del sistema, usa `~\.gemini\antigravity\scratch`; dentro de otro repo git pide confirmación salvo `-Forzar`), clona el starter v6, quita el remote, copia el `.env`, instala y abre Claude Code con `/kickoff`. El atajo se instala una vez con `powershell -ExecutionPolicy Bypass -File scripts\instalar-atajo.ps1`.
- **importar-modulo** (`modulos.json` + `scripts/importar_modulo.js`): `/importar-modulo <nombre>` dentro de un proyecto viejo trae cockpit, bold-rounds, council, brazos o video-director con sus dependencias, sin sobrescribir archivos (reporta conflictos), y lo verifica corriéndolo.

### review-app — visor de output de agentes

- **review-app** (`review-app/server.js`, catálogo): app HTTP local zero-dep para leer output de agentes. Modo "sprint/bloques" (revisar PRs marcando OK/Feedback) y modo "viewer" (lista cualquier `.md` de un directorio con TLDR = H1 + primer párrafo, click abre el `.md` renderizado). `npm run review-app`. Es la superficie HTML preferida del usuario para consumir output. Detalle: `review-app/README.md`.

## Referencia rápida — tests del repo

`npm test` corre todos. Algunos útiles por separado:

| Test | Qué valida |
|---|---|
| `npm test` | Todos los `*.test.js` + `memory/test.js`. |
| `npm run smoke` | 4 checks reales (keys, memoria, research con fuentes, imagen). Gasta ~USD 0.05. |
| `npm run smoke:quick` | Keys + memoria, sin red. |
| `npm run test:skills-catalog` | `skills-catalog.json` en sync con las skills en disco. |
| `npm run test:cockpit` | cockpit: contrato, feedback pendiente, rutas, path traversal, token de voz simulado. |
| `npm run test:review-app` | review-app: modo sprint/bloques + modo viewer. |
| `npm run test:image-refs` | Mimetype + guard "Image 1" de `openai_images.py`. |
| `npm run test:image-wrappers` | Guard de los wrappers multi-modelo (FLUX, Ideogram, Nano Banana Pro). |
| `npm run test:load-env` | Carga idempotente del `.env`. |
| `node brazos.test.js` | Directorio de brazos: schema, status simulado, ranking de `suggest`, `mcp-json`. |
| `node kickoff-plan.test.js` | Plan de batalla del kickoff: ítems, brazos, councils, publicación en el cockpit. |
| `node roadmap-integration.test.js` | Roadmap: ideas, tareas, sprints y auto-reparación de marcadores. |
| `node memory/test.js` | Helpers de memoria (incluye mapeo de `reversibility`). |
| `node research.test.js` | Extracción de fuentes y timeouts de `research.js` (sin red). |

No corras `npm run smoke` en cada commit: gasta credits reales.
