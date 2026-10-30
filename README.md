# Starter Template Mazelab — v6-dev

Un **kit de contexto + herramientas** para arrancar proyectos con Claude Code: research con fuentes, generación de imágenes multi-modelo, memoria del proyecto, roadmap con `/idea`, review-app para revisar entregables y councils multi-modelo para decisiones difíciles. Usas lo que tu proyecto necesita; nada es obligatorio.

## Quickstart (copia y pega)

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
| **kickoff** | `/kickoff` | Entrevista adaptativa: tipo de proyecto, stack de skills recomendado, perfil y sprint inicial. |
| **research** | `node src/research.js pro "pregunta"` | Perplexity vía OpenRouter, con fuentes. Modos `quick`, `pro`, `search`, `reason`, `deep`. |
| **image-gen** | "genera imagen de X", `/image-gen` | gpt-image-2 (y FLUX, Ideogram, Nano Banana Pro) con identity lock y referencias. |
| **image-explorer** | "explora este prompt en varios modelos" | Mismo prompt en 3-4 modelos, grilla HTML para elegir. |
| **multimodal-validation** | automático tras generar imágenes | Obliga a mirar el PNG antes de darlo por bueno. |
| **council** | `/council` | 3-5 modelos deliberan una decisión con tradeoffs. Tiers con costo confirmado. |
| **agent-template** | "crea un agente para X" | Scaffold de agente especializado. |
| **memoria** | `src/memory.js` | Decisiones, lessons, equipo y sprints del proyecto. Viaja con el repo. |
| **roadmap** | `/idea <texto>`, `/roadmap` | Sprint actual + backlog priorizado en `roadmap/roadmap.md`. |
| **cockpit** | `/revisar` + `npm run cockpit` | Revisión con roadmap, votos por ítem y conversación por voz; el feedback lo lee Claude al continuar. Ver [`cockpit/README.md`](cockpit/README.md). |
| **review-app** | `npm run review-app` | Visor local de los `.md` que generan los agentes. |
| **resumen** | `/resumen` | `RESUMEN.html` autocontenido con el estado del proyecto. |

Skills opcionales (20) en `.claude/skills/_catalog/` — se activan con `/kickoff` o copiando la carpeta a `.claude/skills/`. Incluye `confidence-loop`, `cold-reader-gate`, `dual-auditor-protocol`, `superpowers-pr`, `frontend-design`, `seo`, `marketing` y más. Catálogo: [`.claude/skills/_catalog/INDEX.md`](.claude/skills/_catalog/INDEX.md).

Referencia completa (qué usar y qué test correr): [`docs/capacidades.md`](docs/capacidades.md).

## Slash commands

| Comando | Efecto |
|---|---|
| `/kickoff` | Entrevista para iniciar un proyecto. |
| `/idea <texto>` | Captura una idea al backlog sin desviar lo que estás haciendo. |
| `/roadmap` | Revisa sprint actual + backlog. |
| `/council` | Lista councils, invoca uno o crea uno custom. |
| `/revisar` | Publica una revisión del trabajo actual en el cockpit. |
| `/resumen` | Genera `RESUMEN.html`. |
| `/setup-openrouter`, `/setup-openai` | Configura una API key puntual. |

## Estructura

```
├── CLAUDE.md          instrucciones para Claude (cortas, se cargan en cada sesión)
├── setup.js           setup interactivo (corre con npm install; se salta solo en Vercel/CI)
├── .claude/           commands, skills core, _catalog/ con skills opcionales
├── memory/            memoria del proyecto
├── roadmap/           roadmap.md + current-sprint.json
├── councils/          councils predefinidos + resultados
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
| Council Tier 1 / 2 / 3 | USD 0.02-0.10 / 0.15-0.60 / 0.80-2.50 |
| Smoke test completo | ~USD 0.05 |

## Versión

**v6-dev** (2026-10) — Sprint 1 "base liviana": se quitaron el dashboard, el modo voz, el pipeline de 5 capas con contracts y las skills de disciplina auto-disparadas; `CLAUDE.md` bajó a ~1.1k tokens. Historial anterior en git (tags `v5.0` y previos).

## Feedback al starter

¿Algo del starter falla? Anótalo en `feedback.md` bajo `## NUEVO`.
