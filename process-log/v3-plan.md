# Starter Template — Plan de construcción v3

Documento vivo. Persistido al inicio del Sprint 1, actualizado al cerrar cada sprint.

---

## v3 cerrada — 2026-05-09

**Score final del confidence loop: 91/100** (ponderado).

**Suites de tests verdes acumuladas:** 22 archivos, ~353 PASS, 0 FAIL, 8 SKIP por ausencia de keys live (esperado).

**Recomendación de uso:** v3 está lista para arrancar un proyecto real. Las 7 dimensiones que importan para "el sistema funciona" están en 90+. Las dimensiones que bajan el promedio (88-92) son pulido y profundidad de catálogo, no funcionalidad rota.

**Backlog v3.1:** 7 items documentados en `process-log/v3-followups.md`. Item P1 (catálogo de skills opcionales en stub v0.1) es el de mayor esfuerzo y mayor impacto a futuro.

**Reporte completo del confidence loop:** `process-log/v3-confidence-report.md`.

**Iterar a v3.1 cuándo:** después de 3-4 proyectos reales corridos con v3, no antes. La señal de uso decide qué se profundiza.

---

## Estado de avance — 2026-05-09 (cierre v3)

**Sprint 1 — Foundation Core: COMPLETO**
- 1.1 Hand-off contracts: 3/3 tests verdes
- 1.2 Memoria del proyecto: 10/10 tests verdes
- 1.3 Pipeline-v2 reescrita: 12/12 tests verdes (integration)

**Sprint 2 — Foundation UX: COMPLETO**
- 2.1 Kickoff adaptativo: 34/34 tests verdes (con regression suite v3.1)
- 2.2 Dashboard server: 18/18 tests verdes (SSE + polling + history)
- 2.3 Dashboard UI rica: 21/21 tests verdes (kanban + métricas + timeline + replay + export, partido en 2.3a/2.3b)
- 2.4 Roadmap + /idea: 14/14 tests verdes

**Sprint 3 — Quality & Validation: COMPLETO**
- 3.1 Skill quality-mindset: 12/12 tests verdes
- 3.2 Split superpowers-pr al catálogo: 20/20 tests verdes
- 3.3 Smoke test end-to-end: 7/7 tests verdes (meta) + smoke quick verde

**Sprint 4 — Capabilities: COMPLETO**
- 4.1 Cliente OpenRouter unificado: 4/4 tests + 3 skip live
- 4.2 Motor de councils: 4/4 tests + 1 skip live
- 4.3 4 councils predefinidos: 47/47 tests config
- 4.4 Skill council (core, no opcional — ver "Cambios respecto al plan original"): 30/30 tests
- 4.5 Voz Nivel 1 (Win+H docs): 10/10 tests
- 4.6 Voz Nivel 2 (OpenAI TTS): 4/4 tests + 2 skip live

**Sprint 5 — Stack creativo + curación: COMPLETO**
- 5.1 Image-explorer multi-modelo (gpt-image-2 + Replicate stack): 4/4 tests + 2 skip live
- 5.2 Curación de 14 skills opcionales en `_catalog/`: 62/62 tests estructurales
- 5.3 Updates de docs (README + CLAUDE.md + QUICKSTART + READMEs por módulo): 23/23 tests docs-v3
- 5.4 Confidence loop final: 14/14 tests + 22 suites verdes en sweep completo

**Tests acumulados verdes: ~353 asserts en 22 suites. Cero regresión.**

**Nada commiteado.** Todos los cambios viven en working tree de `C:\Users\aldot\.gemini\antigravity\scratch\Starter-template\repo`. El repo está listo para que Aldot decida cuándo y cómo commitear (sugerencia: una rama `v3` con commits por sprint, o squash a un solo commit "Starter Template v3").

---


## Visión

Un OS personal que arranca con un perfil del proyecto, monta el equipo de agentes correcto con contratos de comunicación verificables, te muestra en vivo qué hace cada uno, y aprende de cada iteración.

No es "starter con muchas skills". Es OS personal con: perfil → equipo correcto → visibilidad en vivo → roadmap → memoria persistente.

## Por qué v3

La v2 sufrió de "ceguera operacional": los agentes parecían colaborar pero la información no fluía bien entre ellos (Finding F2). El bug solo se descubrió cuando el output final (imagen) reveló inconsistencias. La v3 resuelve esto estructuralmente con hand-off contracts + visibilidad en vivo + smoke test.

## Decisiones cerradas (referencia)

| Tema | Decisión |
|---|---|
| Quality-mindset | Core. Reformulado, sin Git. Incluye commits regulares + branches por feature. |
| Superpowers PR | Opcional, solo proyectos con flujo Git formal. Movida a `_catalog/`. |
| Skill-creator | Catálogo opcional, no core. |
| Councils | Tier system (1/2/3). Parametrizables. Con tools opcionales. 4 predefinidos: Creative, Architecture, Strategy, Mazelab personalizado. |
| Modelos imagen | Multi-modelo via skill `image-explorer`. Stack opcional. |
| Voz | Nivel 1 (Win+H, gratis) + Nivel 2 (OpenAI TTS) en v3. Realtime en v3.5. |
| Memoria proyecto | Nueva capa: `./memory/` separada de la memoria global del usuario. |
| Dashboard | Rico con métricas e historial. Servidor Node minimal. |
| Kickoff | Reescrito como árbol adaptativo que produce `project-profile.json`. |
| Roadmap | `roadmap.md` persistente + `/idea` para captura sin desvío. |
| Smoke test | Sí, valida sistema antes de uso real. |
| Hand-off contracts | Cada agente declara qué archivos lee/escribe (resuelve F2 estructuralmente). |
| TTS provider | OpenAI TTS para v3. ElevenLabs queda en backlog. |

## Estructura final del repo (objetivo)

```
starter-template/
├── CLAUDE.md                       # actualizado para v3
├── README.md                       # actualizado
├── setup.js                        # ampliado con smoke test
├── .env.example
├── .claude/
│   ├── skills/
│   │   ├── kickoff/                # REESCRITA: árbol adaptativo
│   │   ├── pipeline-v2/            # ACTUALIZADA: usa hand-off contracts
│   │   ├── cold-reader-gate/
│   │   ├── multimodal-validation/
│   │   ├── image-gen/
│   │   ├── karpathy-rules/
│   │   ├── quality-mindset/        # NUEVA
│   │   ├── confidence-loop/
│   │   ├── agent-template/
│   │   ├── council/                # NUEVA
│   │   ├── image-explorer/         # NUEVA
│   │   ├── voice-mode/             # NUEVA
│   │   └── _catalog/               # opcionales
│   │       ├── superpowers-pr/
│   │       ├── skill-creator/
│   │       ├── seo-strategist/
│   │       ├── brand-guidelines/
│   │       ├── webapp-testing/
│   │       └── ... (resto curadas)
│   ├── agents/
│   │   └── council-orchestrator.md
│   └── settings.json
├── councils/
│   ├── creative-ideation.json
│   ├── architecture-decision.json
│   ├── strategy-calls.json
│   ├── mazelab-council.json
│   └── templates/
│       └── persona-template.json
├── content/
│   ├── principles.md
│   └── INDEX.md
├── memory/
│   ├── project-profile.json
│   ├── decisions.md
│   ├── lessons.md
│   ├── active-team.json
│   ├── sprint-log.md
│   ├── schemas/
│   ├── templates/
│   └── README.md
├── roadmap/
│   ├── roadmap.md
│   └── current-sprint.json
├── dashboard/
│   ├── server.js
│   ├── public/{index.html,style.css,app.js}
│   └── state.json
├── contracts/
│   ├── README.md
│   ├── schemas/
│   ├── validator.js
│   ├── helpers.js
│   └── test.js
├── scripts/
│   ├── openai_images.py
│   ├── voice_tts.js                # NUEVO
│   ├── smoke_test.js               # NUEVO
│   └── update_state.js             # NUEVO
├── src/
│   ├── research.js
│   ├── memory.js                   # NUEVO
│   ├── council.js                  # NUEVO
│   ├── image_explorer.js           # NUEVO
│   └── openrouter_client.js        # NUEVO
└── process-log/
    ├── 00-decisions.md
    ├── findings-for-template.md
    └── v3-plan.md                  # ESTE archivo
```

## Sprints

### Sprint 1 — Foundation Core

Cimientos. Resolver F2 estructuralmente y montar memoria del proyecto.

| # | Bloque | Entregables | Status |
|---|---|---|---|
| 1.1 | Hand-off contracts | `contracts/` con README, schemas, validator, helpers, test | EN PROGRESO |
| 1.2 | Memoria del proyecto | `memory/` + `src/memory.js` + test | EN PROGRESO |
| 1.3 | Reescritura pipeline-v2 | `.claude/skills/pipeline-v2/SKILL.md` usando contracts | PENDIENTE |

Verificación: agentes en cadena pasan info validada y actualizan memoria.

### Sprint 2 — Foundation UX

Visibilidad y onboarding.

| # | Bloque | Entregables |
|---|---|---|
| 2.1 | Kickoff adaptativo | Skill reescrita + `project-profile.json` |
| 2.2 | Dashboard server | `dashboard/server.js` + `state.json` |
| 2.3 | Dashboard UI | Kanban + métricas + historial |
| 2.4 | Roadmap + /idea | `roadmap.md` + comando |

Verificación: kickoff en proyecto vacío produce perfil + dashboard activo + roadmap inicializado.

### Sprint 3 — Quality & Validation

Disciplina sin overhead + validación que evita ceguera.

| # | Bloque | Entregables |
|---|---|---|
| 3.1 | Skill `quality-mindset` | Reformulación de la disciplina core (sucesora conceptual de `superpowers-lite` v2, sin Git formal) |
| 3.2 | Split superpowers-pr | Renombrada de `superpowers-lite` y movida a `_catalog/superpowers-pr/` |
| 3.3 | Smoke test end-to-end | `scripts/smoke_test.js` valida en 60s |

Verificación: smoke test verde + quality-mindset visible en tareas reales.

### Sprint 4 — Capabilities

Councils + voz.

| # | Bloque | Entregables |
|---|---|---|
| 4.1 | Cliente OpenRouter | `src/openrouter_client.js` |
| 4.2 | Motor de councils | `src/council.js` |
| 4.3 | 4 councils predefinidos | JSONs en `councils/` |
| 4.4 | Skill `council` | Detecta cuándo proponer council |
| 4.5 | Voz Nivel 1 | Doc Win+H |
| 4.6 | Voz Nivel 2 | `scripts/voice_tts.js` + comandos |

Verificación: council Creative produce naming con tradeoffs. Voz reproduce respuestas largas.

### Sprint 5 — Stack creativo + curación

| # | Bloque | Entregables |
|---|---|---|
| 5.1 | Image-explorer | `src/image_explorer.js` + skill |
| 5.2 | Curación 19 skills | `_catalog/` poblado |
| 5.3 | Updates de docs | README + CLAUDE.md v3 |
| 5.4 | Confidence loop sistema | Reporte final 95+ |

Verificación: proyecto nuevo end-to-end usa todo lo prometido sin parches manuales.

## Lo que NO hacemos en v3

- Realtime API (voz bidireccional baja latencia) → v3.5
- ElevenLabs como segundo TTS → backlog
- Router de modelos OpenRouter automático por tarea → v4
- Memoria semántica (embeddings) del proyecto → v4
- App nativa Electron → v4

## Findings clave heredados de v2

- **F2** (CRÍTICO, resuelto en Sprint 1.1): sub-agentes no heredan permisos de settings.local.
- **F11**: Perplexity amplifica typos del usuario en lugar de cuestionar términos inventados. Wrapping pre-flight propuesto.
- **F12**: sub-agentes Opus se traban en deliberación extendida sin output visible.
- **F8**: pre-flight checks en `/kickoff` incompletos.
- **F13**: validación de conteo en outlines largos no automática.

## Reglas duras del proyecto

1. Español neutro estricto. Cero voseo argentino. Cero regionalismos rioplatenses.
2. Validación multimodal obligatoria post-imagen.
3. Cada artefacto creativo pasa por pipeline-v2 (architect → critic → cold-reader → humano).
4. Cada agente declara hand-off contract.
5. Cada output validable contra schema.
6. Memoria del proyecto se actualiza en eventos significativos, no en cada paso.
7. Confidence loop sobre artefactos críticos antes de cerrarlos.

## Criterio de éxito v3

Un usuario nuevo abre el template en un proyecto desde cero, corre setup + kickoff, construye algo end-to-end, y todo lo prometido funciona sin que tenga que parchar manualmente. El smoke test pasa verde. El dashboard muestra estado vivo. La memoria persiste entre sesiones.

## Cambios respecto al plan original

### Sprint 4.4 — Skill `council` queda en core (no opcional)

El plan original (sección "Estructura final del repo") listaba `council/` dentro de `.claude/skills/` sin clasificarla explícitamente como core u opcional. Al construirla en Sprint 4.4 quedó claro que **debe estar siempre cargada**, no en el catálogo.

**Razón:** la skill tiene un componente de **auto-detección de señales** (sección 1 de su SKILL.md). Detecta cuándo una conversación contiene una decisión con tradeoffs reales y propone convocar un council. Si la skill viviera en `_catalog/`, esa detección no ocurriría — el usuario tendría que recordar invocarla manualmente cada vez, y el valor diferencial del sistema multi-modelo se perdería.

Las skills opcionales del catálogo son skills que **se invocan deliberadamente** cuando el contexto las amerita (ej. `superpowers-pr` solo si hay flujo Git formal). Una skill cuyo propósito incluye **detectar pasivamente** debe estar siempre cargada.

Cambio aplicado: `.claude/skills/_catalog/README.md` agrega `council` a la lista core. La estructura final del repo sigue siendo la del plan, solo se aclara que `council/` vive en `.claude/skills/` directamente, no en `_catalog/`.
