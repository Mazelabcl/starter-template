# v3 — Backlog v3.1 (issues conocidos al cierre)

Items detectados durante el confidence-loop del cierre v3 que no son bloqueantes para el uso real, pero quedan agendados para la siguiente iteración.

Severidad: **alto / medio / bajo**. Esfuerzo: **trivial / medio / alto**.

---

## P1 — Catálogo de skills mayoritariamente en v0.1 (stub funcional)

**Severidad:** alto. **Esfuerzo:** alto (skill por skill).

13 de las 14 skills opcionales del catálogo (`_catalog/`) son stubs funcionales v0.1: tienen frontmatter completo + las 4 secciones requeridas (Cuándo activar, Qué hace, Anti-patrones, Próximos pasos), pero no traen contenido profundo, templates literales, ejemplos copy-pasteables ni best practices completas. La excepción es `superpowers-pr` (v2.0) y, parcialmente, `quality-mindset` (v1.0 core).

El INDEX.md del catálogo lo declara explícitamente, así que el usuario está advertido. Pero al activarlas vía `/kickoff`, la experiencia será delgada hasta que se profundicen.

**Plan v3.1:** priorizar 3-4 skills más probables de usar en proyectos reales (`frontend-design`, `playwright`, `marketing`, `seo`) y pasarlas por `confidence-loop` para llevarlas a v1.0 con contenido real. Cada skill puede ser un sprint de medio día.

**Por qué no se arregla ahora:** profundizar 13 skills bien tomaría 5-10 días de trabajo concentrado. No cabe en el confidence-loop de cierre.

---

## P2 — `.claude/agents/council-orchestrator.md` no existe (entregable del plan)

**Severidad:** medio. **Esfuerzo:** medio.

El plan `v3-plan.md` lista en la "Estructura final del repo" un archivo `.claude/agents/council-orchestrator.md`. La carpeta `.claude/agents/` no existe en el repo y ningún código la referencia.

En la práctica, la skill `council` (`.claude/skills/council/SKILL.md`) cumple ese rol — incluye detección de señales, selección de council, orquestación y síntesis. El "agente orquestador" se reemplazó tácitamente por una skill. Decisión razonable, pero no documentada.

**Plan v3.1:** decidir explícitamente: (a) crear `council-orchestrator.md` como agente especializado y refactorizar la skill para delegarle, o (b) borrar la mención del plan y dejar la skill `council` como única superficie. Opción (b) probablemente más simple.

**Por qué no se arregla ahora:** requiere decisión del usuario sobre arquitectura de agentes, no es solo un fix mecánico.

---

## P3 — Slash commands `/voz-on`, `/voz-off`, `/voz-leer` están separados; falta `/voz` unificado

**Severidad:** bajo. **Esfuerzo:** trivial.

Hoy hay 3 comandos distintos para voz. Un `/voz <on|off|leer>` unificado sería más fácil de recordar y descubrir desde la lista de slash commands. Los 3 actuales pueden seguir como aliases.

**Por qué no se arregla ahora:** funcional, no urgente. Mover bien requiere migrar el state si se decide cambiar el contrato de los comandos.

---

## P4 — `replicate_client.js` tiene README pero no se invoca desde slash commands

**Severidad:** bajo. **Esfuerzo:** medio.

El módulo `src/replicate_client.js` está completo y viene con README, pero la única vía de uso es directa desde Node (`image_explorer.js` lo importa internamente). No hay slash command que dispare image-explorer, y el README no especifica si Replicate también va a tener uso fuera de image-explorer (ej. video con FLUX-video).

**Plan v3.1:** decidir si Replicate es solo dependencia interna de image-explorer o si va a tener slash propio. Si lo primero, mover a `src/_internal/replicate_client.js`. Si lo segundo, agregar `/imagen-explorar` o similar.

---

## P5 — Tests usan keys live skipped silenciosamente

**Severidad:** bajo. **Esfuerzo:** trivial.

`council-engine.test.js`, `image-explorer.test.js`, `openrouter-client.test.js` y `voice-tts.test.js` tienen tests live (Tests 4-7 según suite) que skip silencioso si no hay key real. La salida dice `SKIP — sin OPENROUTER_API_KEY válida`.

Esto es correcto para CI, pero el smoke test quick podría reportar de forma más visible que esos tests no cubren la integración real con la API. Al final del día, `npm run smoke` (sin --quick) es el único check live, y eso está bien declarado en docs.

**Plan v3.1:** evaluar si conviene un endpoint `/api/health` en cada cliente que el smoke test pueda invocar como dry-run con la key real (sin consumir tokens significativos), para detectar regresiones de auth/billing antes que afectar uso real.

---

## P6 — `setup.js` postinstall puede fallar silenciosamente en CI sin TTY

**Severidad:** bajo. **Esfuerzo:** trivial. **Ya manejado parcialmente.**

El setup detecta TTY ausente y sale con exit 0 + mensaje claro ("No hay terminal interactivo. Saltando setup."). Eso es correcto para CI. Pero el README no menciona explícitamente este comportamiento, lo cual puede confundir a alguien que ve el log de CI y se pregunta si setup corrió o no.

**Plan v3.1:** agregar 1 línea al `docs/QUICKSTART.md` sección "Errores comunes" explicando este caso.

---

## P7 — `image_explorer.README.md`, `council.README.md`, `openrouter_client.README.md` viven en `src/` en vez de tener carpetas dedicadas

**Severidad:** bajo. **Esfuerzo:** medio.

El patrón típico sería `src/<modulo>/README.md` + `src/<modulo>/index.js`. Hoy tenemos `src/openrouter_client.js` + `src/openrouter_client.README.md`. Funciona y los enlaces del CLAUDE.md respetan el path. Pero en proyectos grandes esto envejece mal — se pierde la cohesión cuando el módulo crece.

**Plan v4:** evaluar refactor a estructura tipo paquete: `src/openrouter/{index.js, README.md, models.js, ...}`. Es trabajo de día completo, no aporta valor inmediato.

---

## Anotaciones operativas (no son issues, son recordatorios)

- El sistema **funciona end-to-end** según los 22 test suites verdes (~340+ asserts). Los issues anteriores son de pulido y profundidad, no de corrección.
- `npm run smoke` con keys reales debería correrse antes de empezar el primer proyecto serio post-clonación. No corre en CI por costo (~USD 0.05 por corrida).
- La memoria del proyecto (`memory/`) es **persistente y viaja con el repo** — distinta de la memoria global del usuario en `~/.claude/projects/.../memory/`. Esto está documentado pero merece refuerzo si surge confusión real.
