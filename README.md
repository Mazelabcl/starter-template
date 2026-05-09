# Starter Template Mazelab — v3

Un OS personal para arrancar proyectos con Claude Code: perfil del proyecto + equipo de agentes con contratos verificables + visibilidad en vivo + memoria persistente. No es "abrir Claude Code en un repo vacío".

## Quickstart (3 pasos)

```bash
# 1. Clonar el template
git clone https://github.com/Mazelabcl/starter-template mi-proyecto
cd mi-proyecto

# 2. Setup interactivo: instala deps, pide API keys, arma el venv de Python
npm install
# (corre setup.js en postinstall — pide OpenRouter, OpenAI y opcional Replicate)

# 3. Smoke test antes de empezar (opcional pero muy recomendado)
npm run smoke
# Valida 8 checks end-to-end. ~90s, ~USD 0.05 en API. Si está verde, listo para arrancar.
```

Después abres Claude Code en este repo y le dices `/kickoff`. La entrevista detecta qué proyecto vas a hacer, recomienda stack, persiste el perfil, y deja todo armado para empezar.

Guía completa de 5 minutos: [`docs/QUICKSTART.md`](docs/QUICKSTART.md).

## Visión

La v2 sufría de "ceguera operacional": los agentes parecían colaborar pero la información no fluía bien entre ellos. Los bugs aparecían dos pasos después de la causa, lejos del fallo real.

La v3 resuelve esto estructuralmente:

- **Hand-off contracts** entre agentes (cada agente declara qué lee/escribe, validado contra JSON Schema antes de procesar).
- **Memoria del proyecto** persistente (decisiones, lessons, equipo activo, sprints — viaja con el repo).
- **Dashboard rico en vivo** (kanban + métricas + timeline + replay + export).
- **Smoke test end-to-end** (un comando te dice si el sistema completo funciona).
- **Councils multi-modelo** (3-5 perspectivas distintas deliberan sobre decisiones complejas, con tiers de costo controlados).

No es marketing. Cada capacidad tiene tests, contratos verificables y costo medido.

## Capacidades core

Cada una se invoca desde Claude Code con sus triggers naturales. Skills viven en `.claude/skills/`.

| Capacidad | Cómo invocar | Para qué |
|---|---|---|
| **kickoff** | `/kickoff`, "vamos a arrancar un proyecto nuevo" | Entrevista adaptativa, detecta tipo de proyecto (build / business / content / research / personal), recomienda stack de skills, persiste `project-profile.json` + `active-team.json`. |
| **pipeline-v2** | "construye X", "vamos a crear Y", "/pipeline-v2" | Orquesta architect → critic → cold-reader → humano. Cada transición valida hand-off contract. |
| **cold-reader-gate** | Auto al cerrar artefacto creativo, o "/cold-reader-gate" | Voto binario GO/NO-GO con veto absoluto sobre el critic interno. |
| **multimodal-validation** | Auto después de cualquier imagen generada | Fuerza Read del PNG. Sin esto no hay PASS. |
| **image-gen** | "genera imagen de X", "/image-gen" | gpt-image-2 con identity lock + reglas de references + paralelismo agresivo. |
| **image-explorer** | "explora prompt en N modelos" | Compara mismo prompt en gpt-image-2, FLUX, Imagen 3, Ideogram, Recraft, SD 3.5 en paralelo. Grilla HTML para elegir ganador. |
| **council** | `/council`, "convoca un council para X" | 3-5 modelos distintos deliberan, cross-pollination opcional, síntesis con Opus. 4 councils predefinidos (Tier 1/2/3). |
| **voice-mode** | `/voz-on`, `/voz-off`, `/voz-leer` | TTS de respuestas largas con OpenAI TTS. |
| **agent-template** | "crea un agente para X", "/agent-template" | Genera agente nuevo con score base ~92/100. |
| **karpathy-rules** | Auto al escribir código | 4 reglas core de coding limpio. |
| **quality-mindset** | Auto en tareas no triviales | Disciplina mínima viable: spec → plan → ejecución → cierre validado. Sin Git formal. |
| **confidence-loop** | "/confidence-loop", "mejora hasta 95" | Itera artefacto hasta 95+/100 (5 iteraciones máx). |

Skills opcionales (14 más en `.claude/skills/_catalog/`): `superpowers-pr`, `frontend-design`, `playwright`, `webapp-testing`, `pdf-skill`, `xlsx`, `marketing`, `seo`, `remotion`, `brand-guidelines`, `canvas-design`, `web-artifacts-builder`, `skill-creator`, `superpowers-full`. Se activan vía `/kickoff` según perfil del proyecto.

Catálogo completo: [`.claude/skills/_catalog/INDEX.md`](.claude/skills/_catalog/INDEX.md).

## Slash commands

| Comando | Efecto |
|---|---|
| `/kickoff` | Entrevista adaptativa para iniciar un proyecto. |
| `/idea <texto>` | Captura idea cruda al backlog del roadmap, sin desviar el flujo actual. |
| `/roadmap` | Revisa sprint actual + backlog priorizado. |
| `/council` | Lista councils, invoca uno, o crea custom (`new`). |
| `/voz-on`, `/voz-off`, `/voz-leer` | Activa/desactiva TTS, lee última respuesta. |
| `/setup-openrouter`, `/setup-openai` | Configura una API key específica sin correr setup completo. |

## Estructura del repo

```
starter-template/
├── README.md                 (este archivo)
├── CLAUDE.md                 (instrucciones operativas para Claude)
├── setup.js                  (setup interactivo — postinstall)
├── package.json
├── .env.example              (OPENROUTER_API_KEY, OPENAI_API_KEY, REPLICATE_API_TOKEN opcional)
├── .claude/
│   ├── commands/             (slash commands: /idea, /roadmap, /council, /voz-*, /kickoff, etc.)
│   ├── skills/               (12 skills core + _catalog/ con 14 opcionales)
│   └── settings.example.local.json
├── contracts/                (hand-off contracts: schemas + validator + helpers)
├── memory/                   (project-profile.json, decisions.md, lessons.md, sprint-log.md, etc.)
├── councils/                 (4 councils predefinidos + templates + results/)
├── content/                  (principles.md, INDEX.md generados por /kickoff; outputs)
├── roadmap/                  (roadmap.md, current-sprint.json)
├── dashboard/                (server.js + UI rica)
├── docs/                     (QUICKSTART.md, voice-input-guide.md, mcps-recomendados.md)
├── scripts/                  (openai_images.py, voice_tts.js, smoke_test.js, update_state.js)
├── src/                      (research.js, council.js, image_explorer.js, memory.js, roadmap.js, openrouter_client.js, replicate_client.js)
└── process-log/              (00-decisions.md, v3-plan.md, findings-for-template.md)
```

## Stack tecnológico

| Capa | Tech | Cuándo se usa | API key |
|---|---|---|---|
| Research / texto / councils | OpenRouter (Anthropic, OpenAI, Google, DeepSeek, Qwen, Meta, Perplexity) | `src/research.js`, `src/council.js`, `src/openrouter_client.js` | `OPENROUTER_API_KEY` (recomendada) |
| Imágenes con identity lock | OpenAI gpt-image-2 vía Python | `scripts/openai_images.py`, skill `image-gen` | `OPENAI_API_KEY` (opcional) |
| Imágenes multi-modelo | Replicate (FLUX, Imagen 3, Ideogram, Recraft, SD 3.5) | `src/image_explorer.js`, `src/replicate_client.js` | `REPLICATE_API_TOKEN` (opcional) |
| TTS (voz output) | OpenAI TTS (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) | `scripts/voice_tts.js`, skill `voice-mode` | `OPENAI_API_KEY` |
| Voz input | Win+H nativo (Windows) o doble-Fn (macOS) | Sistema operativo | sin costo |

Las keys viven en `.env` (ignorado por git). Usa `npm run setup` o `/setup-openrouter` / `/setup-openai` para configurarlas.

## Councils — sistema de tiers

Convocas un council cuando hay decisión con tradeoffs reales (más de una respuesta defendible). Tres tiers definen estructura y costo:

| Tier | Estructura | Costo | Cuándo |
|---|---|---|---|
| 1 | round1 únicamente, sin cross-pollination | USD 0.02 a 0.10 | Decisiones reversibles, ideación, naming. |
| 2 | round1 + round2 con cross-pollination + synthesis Opus | USD 0.15 a 0.60 | Decisiones estratégicas con costo medio. |
| 3 | round1 + round2 + synthesis Opus + `confidence_loop` post-synthesis | USD 0.80 a 2.50 | Decisiones irreversibles, arquitectura, contratos legales. |

Los 4 councils predefinidos: `creative-ideation` (Tier 1), `strategy-calls` y `mazelab-council` (Tier 2), `architecture-decision` (Tier 3). Editables y clonables como custom. Detalle: [`councils/README.md`](councils/README.md).

## Cómo agrego skills opcionales

El catálogo en `.claude/skills/_catalog/` tiene 14 skills disponibles. Tres formas de activar una:

1. **Vía `/kickoff`.** El árbol adaptativo recomienda skills según el tipo de proyecto detectado.
2. **Manual.** Copia la carpeta de `_catalog/<skill>/` a `.claude/skills/<skill>/`. Claude Code la carga al reabrir.
3. **Crear skill custom.** Skill `skill-creator` (en catálogo) genera SKILL.md + CHANGELOG.md con el formato del starter.

Detalle por skill: [`.claude/skills/_catalog/INDEX.md`](.claude/skills/_catalog/INDEX.md).

## Cómo agrego MCPs

Los MCP servers se configuran en `~/.claude/settings.json` con bloque `mcpServers`. Recomendaciones por perfil de proyecto (Context7, Codebase-memory, Obsidian-MCP, Firecrawl, GitHub MCP) y cómo configurar cada uno: [`docs/mcps-recomendados.md`](docs/mcps-recomendados.md).

## Smoke test antes de empezar proyecto serio

```bash
npm run smoke           # completo (~60-90s, ~USD 0.05 en API credits)
npm run smoke:quick     # rápido (<15s, sin gasto de red)
```

Verifica 8 cosas end-to-end: variables de entorno, hand-off contracts, memoria del proyecto, dashboard server, Perplexity research, gpt-image-2 generación, multimodal validation flow, pipeline-v2 integration. Detalle de cada check + errores comunes: [`scripts/smoke_test.README.md`](scripts/smoke_test.README.md).

Cuándo correrlo: antes de empezar un proyecto serio, después de rotar API keys, después de actualizar deps, o cuando algo se siente raro. **No** lo corras en cada commit — gasta credits reales.

## Para retomar el proyecto

Cuando reabres una sesión, Claude debe leer la memoria del proyecto al arranque:

```js
import { summarize } from './src/memory.js';
const snap = summarize();
// Devuelve: has_profile, project_type, mode, agentes_count, decisiones_count, sprints_completados, paths.
```

Si `has_profile === false` → propone `/kickoff`. Si hay perfil pero faltan archivos clave → continúa el kickoff donde se quedó. Si está activo → carga `decisions.md` / `lessons.md` solo cuando vaya a tomar decisión nueva o el usuario pregunte por contexto histórico.

Y en otro terminal: `npm run dashboard` para ver kanban + métricas + timeline en vivo mientras trabajas.

Detalle del modelo: [`memory/README.md`](memory/README.md).

## Productividad — input/output por voz

**Input (gratis):** dictar prompts largos con Win+H (Windows 11) o doble-Fn (macOS). Acelera mucho brainstorming. Comandos de puntuación útiles y tips: [`docs/voice-input-guide.md`](docs/voice-input-guide.md).

**Output (con costo):** TTS de respuestas largas con OpenAI TTS vía skill `voice-mode`. Útil para escuchar mientras haces otra cosa, repasar decisiones complejas caminando, o lectura final de briefs. Defaults en `memory/voice-mode-state.json`. Comandos: `/voz-on`, `/voz-off`, `/voz-leer`.

## Costos típicos

Cifras aproximadas por llamada — verifica el valor exacto en cada provider.

| Capacidad | Costo aproximado |
|---|---|
| Research Perplexity (`quick` / `pro`) | USD 0.001 a 0.01 por consulta |
| Research Perplexity (`deep`) | USD 0.05 a 0.20 por consulta |
| Imagen gpt-image-2 (medium 1024×1024) | USD 0.04 |
| Imagen gpt-image-2 (high 1024×1536) | USD 0.25 |
| Imagen Replicate (FLUX, SD 3.5, Recraft) | USD 0.003 a 0.05 |
| Council Tier 1 (creative-ideation) | USD 0.02 a 0.10 |
| Council Tier 2 (strategy-calls, mazelab-council) | USD 0.15 a 0.60 |
| Council Tier 3 (architecture-decision) | USD 0.80 a 2.50 |
| TTS `tts-1` por respuesta de 1000 chars | USD 0.015 |
| Smoke test completo | ~USD 0.05 |

El sistema **siempre confirma costos** antes de invocar Tier 2/3 o batches grandes.

## Versión y changelog

**v3** (2026-05) — Hand-off contracts + memoria persistente + dashboard rico + councils multi-modelo + image-explorer + voice-mode + kickoff adaptativo + roadmap + smoke test.

Plan completo y estado de sprints: [`process-log/v3-plan.md`](process-log/v3-plan.md).
Decisiones humanas (ley): [`process-log/00-decisions.md`](process-log/00-decisions.md).

Lo que **no** entró en v3 (parqueado para v3.5/v4): Realtime API voz bidireccional, ElevenLabs como segundo TTS, router automático de modelos por tarea, memoria semántica con embeddings, app nativa Electron.
