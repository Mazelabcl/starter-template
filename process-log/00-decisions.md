# 00 — Decisiones humanas (ley)

> Este archivo es **ley** para todos los agentes. Lo leen primero (después de `principles.md`).
> Cada decisión tiene un ID (D1, D2, ...). Los agentes citan el ID al aplicar.

## Formato de cada decisión

```
## D{N} — {título corto} (YYYY-MM-DD)
**Contexto:** qué situación gatilló la decisión.
**Decisión:** qué se decidió, en una frase.
**Aplicación:** cómo afecta el trabajo de aquí en adelante.
```

---

<!-- Las decisiones se anexan abajo a medida que aparezcan. -->

## D1 — Dashboard v3 reemplazo total por pixel-art office (2026-05-11)
**Contexto:** Dashboard v2 (kanban) no transmitía valor visual al usuario. Research deep de repos existentes (claude-office, Star-Office-UI, openclaw-virtual-office) reveló fork pesado o state shape rígido en todos.
**Decisión:** Borrar dashboard v2 completo. Reemplazar por dashboard pixel-art "indie tech studio office" con avatares por agente, estados visuales reactivos, click → drill-down, read-only mode nativo.
**Aplicación:** Stack 100% JS, sin sidecar Python. Build custom permite control total + valor extra: dashboard exponible público como vitrina del studio que clona el starter.
**Reversibilidad:** baja.

## D2 — Sistema multi-pack de assets pixel-art (2026-05-11)
**Contexto:** LimeZu Modern Interiors (pack premium ideal) confirmó vía devlog que ni free ni paga permiten redistribución dentro de repo open-source. Cero packs CC0 office modernos completos disponibles en OpenGameArt.
**Decisión:** Dashboard NO empaca pack cerrado. Define interfaz de carga vía manifest JSON. Default CC0 Kenney roguelike (descargado por `npm run dashboard:assets`, NO commiteado). Consumer premium dropea pack privado en `assets/vendor/<name>/` y activa con `DASHBOARD_PACK`.
**Aplicación:** El template define la interfaz y deja al consumer aportar el pack premium si tiene budget. Preserva libertad del template + upgrade path premium.
**Reversibilidad:** baja.

## D3 — Engine pivot a Phaser 3 (2026-05-11)
**Contexto:** Spec v3.0 inicial usaba PixiJS v8. Research deep de Star-Office-UI reveló que Phaser 3 sin bundler funciona vía CDN ESM y aporta abstracciones nativas (Scene lifecycle, Sprite con anims declarativas, Tweens, ParticleEmitter, Camera.roundPixels) que reducen LOC vs PixiJS bajo nivel.
**Decisión:** Phaser 3.80.1 vía `https://esm.sh/phaser@3.80.1`, no PixiJS. Render `Phaser.AUTO` (WebGL preferido, Canvas fallback). `pixelArt: true` + `scale.zoom` integer + CSS `image-rendering: pixelated`.
**Aplicación:** Cualquier futura iteración del engine usa Phaser. PixiJS queda descartado para este caso de uso.
**Reversibilidad:** baja.

## D4 — Assets binarios NO commiteados al repo público (2026-05-11)
**Contexto:** Packs free-to-use (LimeZu, MetroCity, Arlan_TR) carecen de licencia SPDX formal — uso final OK pero redistribución dentro de repo público abierta a interpretación. Kenney CC0 OK pero crece el repo + depende de URL upstream.
**Decisión:** Solo `manifest.json` + `ATTRIBUTION.md` por pack default commiteado. Binarios viven en `assets/vendor/<name>/` gitignored. Script `dashboard:assets` descarga + valida SHA256 + descomprime + valida manifest con Ajv.
**Aplicación:** Política assets-no-bundleados desacopla licencia + tamaño + permite premium-swap. Cualquier nuevo pack default sigue la misma convención.
**Reversibilidad:** baja.

## D5 — Re-priorización del dashboard a visibilidad (2026-05-11)
**Contexto:** Aldot vio el dashboard funcionando con avatares estáticos y preguntó qué le aporta. Respuesta honesta: era decorativo. Su lista (título encima del avatar, click → prompt+plan+estado, sprint con hitos y entregables) es lo que un dashboard de control real necesita.
**Decisión:** Pausar fase 5 (5 animaciones efímeras) → v1.1. Saltar a fase 6 EXPANDIDA + fase 7 con visibilidad real: título flotante, side panel con prompt_brief + plan_steps + current_step + artefactos, vista Sprint cruzando roadmap/current-sprint.json con state.json, vista Roadmap macro + sprints históricos. Schema task extendido con campos OPCIONALES no-breaking: `prompt_brief`, `plan_steps[]`, `current_step`, `phase`, `epic`.
**Aplicación:** Las animaciones efímeras (`task_completed` tick, `image_generated` popup, etc.) quedan en backlog v1.1. Cualquier nuevo campo del schema task sigue el patrón "opcional, no-breaking, fallback gracioso".
**Reversibilidad:** media.

## D6 — Subagentes NO escriben a archivos del proyecto directamente (2026-05-13)
**Contexto:** En audit-master Sprint 1, la skill local `dual-auditor-protocol` asumía que los auditores subagentes podían hacer `Write` a `audit/findings-deep-A.md` y `audit/findings-deep-B.md`. El wrapper del runtime de Claude Code bloqueó el Write con "Subagents should return findings as text". El orquestador tuvo que recibir los findings como texto en la respuesta del subagente y persistirlos a mano. La limitación no estaba documentada en el starter.
**Decisión:** Todo brief a sub-agente (lanzado vía Agent tool) DEBE incluir literal: "Entrega tus findings como texto en tu respuesta final. NO uses la Write tool — el wrapper la bloquea. El orquestador (Claude principal) persistirá el archivo. Si tu output excede 50k tokens, divídelo en N partes y declara explícito 'parte 1/N, continúa en próximo turno'." Aplica a TODOS los flujos donde corre un sub-agente: dual-auditor-protocol, pipeline-v2, image-gen, council, kickoff. NO aplica al orquestador principal (que sí escribe libremente).
**Aplicación:** Documentado en `CLAUDE.md` (sección "Limitaciones del runtime de Claude Code") + en cada skill que delegue a sub-agentes (dual-auditor-protocol, pipeline-v2 actualizados en Sprint v3.1). Si Anthropic Code más adelante levanta la restricción, esta decisión se revisa.
**Reversibilidad:** alta (es solo una política documental + briefs literales, no hay código que dependa de la limitación; cuando se levante, simplemente reescribimos los briefs).

## D7 — `roadmap/current-sprint.json` es la fuente canónica del sprint vivo + sync a dashboard (2026-05-13)
**Contexto:** En audit-master el sprint inicial creado por `/kickoff` (vía `addSprint`) (a) reportaba `sprints_completados: 1` cuando recién había abierto — confusión entre "sprint vivo" y "sprint cerrado"; (b) la pestaña Roadmap del dashboard nunca veía el sprint actual porque solo lee `roadmap.md` + `sprint-log.md`, no `current-sprint.json`; (c) `state.json.current_sprint` quedaba en `{number: 0, objective: '(sin sprint declarado)'}` indefinidamente.
**Decisión:** `roadmap/current-sprint.json` es la fuente única de verdad del sprint vivo. `startSprint()` y `closeSprint()` de `src/roadmap.js` POSTean best-effort al dashboard `/api/state` actualizando `current_sprint`. `addSprint()` (de memory.js) NO se llama en kickoff — solo en `closeSprint()`. Cada task creada vía `task-start` auto-pobla `sprint_number` desde `current-sprint.json` si hay sprint vivo (sprint con objective declarado). Las pestañas Sprint y Roadmap del dashboard filtran/agrupan por `sprint_number` cuando las tasks lo declaran.
**Aplicación:** Modificado `src/roadmap.js` (helper `notifyDashboardCurrentSprint` + hook en startSprint/closeSprint), `scripts/update_state.js` (campo `sprint_number` v2.3, auto-pobla desde current-sprint), `dashboard/server.js` (`ensureTaskV2Fields` incluye `sprint_number`), `.claude/skills/kickoff/SKILL.md` (NO llama addSprint), `dashboard/public/ui/panel.js` (filtra/agrupa por sprint_number + "Sprint actual" en pestaña Roadmap). Test nuevo `roadmap-state-sync.test.js`.
**Reversibilidad:** media. Si el patrón resulta frágil podemos volver a tener `addSprint` en kickoff y depender solo de roadmap.md, pero perdería la sincronización en vivo con el dashboard.
