# Starter Template Mazelab — v6-dev

Un **kit de contexto + herramientas** para arrancar proyectos con Claude Code: research con fuentes, generación de imágenes multi-modelo, memoria del proyecto, roadmap con `/idea`, review-app para revisar entregables y councils de expertos para decisiones difíciles. Usas lo que tu proyecto necesita; nada es obligatorio.

## Atajo en Windows: un solo comando

Instálalo una vez (desde la carpeta del starter, en PowerShell):

```
powershell -ExecutionPolicy Bypass -File scripts\instalar-atajo.ps1
```
(copia el script a `$HOME\.mazelab\` y agrega el comando `nuevo-proyecto` a tu perfil de PowerShell)

Desde ahí, en cualquier ventana NUEVA de PowerShell:

```
nuevo-proyecto mi-proyecto
```
(clona el starter en `~\.gemini\antigravity\scratch\mi-proyecto`, lo desconecta del repo del starter, copia tu `.env`, corre `npm install` y abre Claude Code con `/kickoff`)

## Quickstart manual (copia y pega)

1. Clona el template y entra en la carpeta:
   ```bash
   git clone https://github.com/Mazelabcl/starter-template.git mi-proyecto
   cd mi-proyecto
   ```
   (descarga el starter en una carpeta nueva llamada `mi-proyecto`)

2. Instala dependencias:
   ```bash
   npm install
   ```
   (instala lo necesario y abre el setup que te pide las API keys: OpenRouter obligatoria, OpenAI y Replicate opcionales)

3. Abre Claude Code en esta carpeta y escribe:
   ```
   /kickoff
   ```
   (entrevista corta que detecta qué proyecto vas a hacer y deja el roadmap y la memoria listos)

Opcional, antes de trabajar en serio:
```bash
npm run smoke
```
(4 checks reales: keys, memoria, research y una imagen; ~USD 0.05. `npm run smoke:quick` no gasta nada)

Guía de 5 minutos: [`docs/QUICKSTART.md`](docs/QUICKSTART.md). Tip: dicta prompts largos con Win+H (Windows) o doble Fn (macOS): [`docs/voice-input-guide.md`](docs/voice-input-guide.md).

## Qué trae

| Capacidad | Cómo se usa | Para qué |
|---|---|---|
| **kickoff** | `/kickoff` | Entrevista adaptativa que termina en un **plan de batalla** en el cockpit: equipo de agentes ("actúa como" + por qué), brazos conectados y faltantes, sprints con gates, councils sugeridos y riesgos. |
| **brazos** | `node src/brazos.js status` / `suggest "..."` | Directorio de integraciones para ejecutar (MCP, APIs, CLIs, plugins): qué está conectado, qué falta y cómo conectarlo. Ver [`brazos/README.md`](brazos/README.md). |
| **research** | `node src/research.js pro "pregunta"` | Perplexity vía OpenRouter, con fuentes. Modos `quick`, `pro`, `search`, `reason`, `deep`. |
| **image-gen** | "genera imagen de X", `/image-gen` | gpt-image-2 (y FLUX, Ideogram, Nano Banana Pro) con identity lock y referencias. |
| **image-explorer** | "explora este prompt en varios modelos" | Mismo prompt en 3-4 modelos, grilla HTML para elegir. |
| **multimodal-validation** | automático tras generar imágenes | Obliga a mirar el PNG antes de darlo por bueno. |
| **council** | `/council` | Personas expertas (CTO, devops, PM, usuario novato...) opinan por separado y se fusionan en una propuesta mejorada, con cada aporte atribuido. |
| **bold-rounds** | `/bold-rounds <objetivo> [N]` | Rediseño audaz por rondas sobre una copia: cada ronda compara una variante ciega (sin memoria) y una con contexto, con screenshots antes/después en el cockpit. Tú eliges; el original no se toca hasta que digas "aplicar". Demo: `examples/cafeteria-90s/`. |
| **agent-template** | "crea un agente para X" | Scaffold de agente especializado. |
| **memoria** | `src/memory.js` | Decisiones, lessons, equipo y sprints del proyecto. Viaja con el repo. |
| **roadmap** | `/idea <texto>`, `/roadmap` | Sprint actual + backlog priorizado en `roadmap/roadmap.md`. |
| **cockpit** | `/revisar` (Claude lo abre solo con `node src/cockpit.js open <id>`) | Revisión con roadmap, votos por ítem y conversación por voz; el feedback lo lee Claude al continuar. Ver [`cockpit/README.md`](cockpit/README.md). |
| **review-app** | `npm run review-app` | Visor local de los `.md` que generan los agentes. |
| **resumen** | `/resumen` | `RESUMEN.html` autocontenido con el estado del proyecto. |

Skills opcionales (21, incluye `video-director` para reels hechos por código con HyperFrames) en `.claude/skills/_catalog/` — se activan con `/kickoff` o copiando la carpeta a `.claude/skills/`. Incluye `confidence-loop`, `cold-reader-gate`, `dual-auditor-protocol`, `superpowers-pr`, `frontend-design`, `seo`, `marketing` y más. Catálogo: [`.claude/skills/_catalog/INDEX.md`](.claude/skills/_catalog/INDEX.md).

Referencia completa (qué usar y qué test correr): [`docs/capacidades.md`](docs/capacidades.md).

## Slash commands

| Comando | Efecto |
|---|---|
| `/kickoff` | Entrevista para iniciar un proyecto. |
| `/idea <texto>` | Captura una idea al backlog sin desviar lo que estás haciendo. |
| `/roadmap` | Revisa sprint actual + backlog. |
| `/council` | Propone el council adecuado para tu tarea y lo corre si dices que sí. |
| `/revisar` | Publica una revisión del trabajo actual en el cockpit. |
| `/bold-rounds <objetivo> [N]` | N rondas de mejora audaz (ciega vs. contexto) sobre una copia; eliges en el cockpit. |
| `/resumen` | Genera `RESUMEN.html`. |
| `/setup-openrouter`, `/setup-openai` | Configura una API key puntual. |

## Estructura

```
├── CLAUDE.md          instrucciones para Claude (cortas, se cargan en cada sesión)
├── setup.js           setup interactivo (corre con npm install; se salta solo en Vercel/CI)
├── .claude/           commands, skills core, _catalog/ con skills opcionales
├── memory/            memoria del proyecto
├── roadmap/           roadmap.md + current-sprint.json
├── brazos/           directorio de integraciones (MCP, API, CLI, plugins) + schema
├── councils/          personas, plantillas y resultados de councils
├── content/           principles.md / INDEX.md (los genera /kickoff) + outputs
├── cockpit/           revisión con voz + feedback (reviews/ y feedback/)
├── review-app/        visor local de .md
├── docs/              QUICKSTART, capacidades, MCPs recomendados, guía de dictado
├── scripts/           imágenes (Python), smoke test, run_tests, resumen
└── src/               research, council, memory, roadmap, image_explorer, clientes de API
```

## API keys

Viven en `.env` (ignorado por git). Configúralas con `npm run setup`. Para correr un script propio con las keys cargadas:

```bash
node --env-file=.env mi-script.js
```
(carga las variables del `.env` antes de ejecutar el script)

| Key | Para qué | ¿Obligatoria? |
|---|---|---|
| `OPENROUTER_API_KEY` | research, councils | Sí |
| `OPENAI_API_KEY` | gpt-image-2 | Para imágenes |
| `REPLICATE_API_TOKEN` | image-explorer, FLUX / Ideogram / Nano Banana Pro | Opcional |

## Deploy a Vercel / CI

`setup.js` corre en `npm install` (postinstall) pero sale de inmediato si detecta `VERCEL`, `CI`, `NETLIFY` o `GITHUB_ACTIONS`, así el build no se cuelga esperando API keys.

## Tests

```bash
npm test
```
(corre todos los tests del starter; algunos hacen llamadas reales de centavos si hay keys en `.env`)

## Costos típicos

| Capacidad | Costo aproximado |
|---|---|
| Research `quick` / `pro` | USD 0.001 a 0.01 |
| Research `deep` | USD 0.05 a 0.20 (tarda minutos) |
| gpt-image-2 medium 1024×1024 | USD 0.04 |
| Replicate (FLUX, SD 3.5, Recraft) | USD 0.003 a 0.05 |
| Council personas / multimodel | USD 0.02-0.05 / 0.30-0.50 |
| `/bold-rounds` | 2 agentes por ronda (~1-2 min cada uno); consume tu plan de Claude Code, no API keys |
| Smoke test completo | ~USD 0.05 |

## Versión

**v6-dev** (2026-10) — Sprint 1 "base liviana": se quitaron el dashboard, el modo voz, el pipeline de 5 capas con contracts y las skills de disciplina auto-disparadas; `CLAUDE.md` bajó a ~1.1k tokens. Historial anterior en git (tags `v5.0` y previos).

## Feedback al starter

¿Algo del starter falla? Anótalo en `feedback.md` bajo `## NUEVO`.
