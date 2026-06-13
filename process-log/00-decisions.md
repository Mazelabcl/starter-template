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

## D1 — Dashboard pixel-art office (2026-05-11)
Superada por D8 (dashboard degradado a HTML plano). Ver historial completo en git tag `v3.1-final`.

## D2 — Sistema multi-pack de assets pixel-art (2026-05-11)
**Contexto:** LimeZu Modern Interiors (pack premium ideal) confirmó vía devlog que ni free ni paga permiten redistribución dentro de repo open-source. Cero packs CC0 office modernos completos disponibles en OpenGameArt.
**Decisión:** Dashboard NO empaca pack cerrado. Define interfaz de carga vía manifest JSON. Default CC0 Kenney roguelike (descargado por `npm run dashboard:assets`, NO commiteado). Consumer premium dropea pack privado en `assets/vendor/<name>/` y activa con `DASHBOARD_PACK`.
**Aplicación:** El template define la interfaz y deja al consumer aportar el pack premium si tiene budget. Preserva libertad del template + upgrade path premium.
**Parcialmente vigente:** el dashboard pixel-art se degradó a HTML plano (D8), pero la interfaz de pack premium (`assets-pack.schema.json`) sigue en uso.
**Reversibilidad:** baja.

## D3 — Engine pivot a Phaser 3 (2026-05-11)
Superada por D8 (frontend Phaser borrado, dashboard degradado a HTML plano). Ver historial completo en git tag `v3.1-final`.

## D4 — Assets binarios NO commiteados al repo público (2026-05-11)
**Contexto:** Packs free-to-use (LimeZu, MetroCity, Arlan_TR) carecen de licencia SPDX formal — uso final OK pero redistribución dentro de repo público abierta a interpretación. Kenney CC0 OK pero crece el repo + depende de URL upstream.
**Decisión:** Solo `manifest.json` + `ATTRIBUTION.md` por pack default commiteado. Binarios viven en `assets/vendor/<name>/` gitignored. Script `dashboard:assets` descarga + valida SHA256 + descomprime + valida manifest con Ajv.
**Aplicación:** Política assets-no-bundleados desacopla licencia + tamaño + permite premium-swap. Cualquier nuevo pack default sigue la misma convención.
**Parcialmente vigente:** el dashboard pixel-art se degradó a HTML plano (D8), pero la interfaz de pack premium (`assets-pack.schema.json`) sigue en uso.
**Reversibilidad:** baja.

## D5 — Re-priorización del dashboard a visibilidad (2026-05-11)
Superada por D8 (dashboard degradado a HTML plano). Ver historial completo en git tag `v3.1-final`.

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

## D8 — Consolidación v4: dashboard pixel-art degradado a HTML plano (2026-06-02)
**Contexto:** El dashboard pixel-art Phaser (262KB, ~2.774 LOC frontend, 14 suites de test) era el mayor lastre de mantención del starter y el usuario NUNCA lo usó en la práctica. Sí ama la review-app (HTML simple). El frontend Phaser aportaba valor decorativo, no operativo.
**Decisión:** Degradar el dashboard pixel-art a un dashboard HTML plano (vanilla JS, cero deps de frontend): tabla de tareas en vivo (Agente, Estado, Modelo, Tokens, Summary) + pestañas Sprint / Roadmap / Chat. El backend (server.js, endpoints, SSE, chat, modo público) se conserva intacto. Se borra el frontend Phaser (boot.js, engine/, pack/, lib/, ui/panel.js, style.css pixel-art), assets/packs/, scripts/fetch_default_pack.js, y ~10 suites de test puramente del frontend. Pivote de filosofía: de "ver agentes" (decorativo) a "consumir output" (la review-app es la superficie HTML preferida). Los endpoints `/api/pack-name` y `/assets/` se eliminan del server (eran solo del pack system).
**Aplicación:** `dashboard/public/` ahora es index.html + app.js + style.css plano. `package.json` pierde `dashboard:assets`, `test:dashboard:scene`, `test:dashboard:panel`; `npm start` ya no baja assets. README del dashboard reescrito. Rollback completo disponible en el tag git `v3.1-final` (`git checkout v3.1-final -- dashboard/public/`).
**Reversibilidad:** alta (el frontend Phaser vive en el tag v3.1-final; el backend nunca se tocó).

## D9 — skills-catalog.json como fuente única + kickoff razona sobre el catálogo (2026-06-02)
**Contexto:** El kickoff hacía capa de contraste por match de keywords contra `_catalog/INDEX.md` (texto humano). Funcional pero la capa de contraste "reaccionaba a keywords, no razonaba" — no consideraba `when_to_use`, status de madurez (stub vs maduro), ni costo, y solo cruzaba el catálogo, no las skills core.
**Decisión:** `.claude/skills/_catalog/skills-catalog.json` es la fuente única machine-readable del catálogo (core + catalog) con `{ name, location, triggers[], when_to_use, output, status, cost_hint }`. El kickoff (Paso 3.5) LEE el JSON entero (barato, ~30 entradas) y RAZONA skill por skill: "el proyecto hace X, esta skill sirve porque Y, su status es Z (si stub, avisa); la propongo/no". El `detector.js` sigue dando el stack base curado por keywords; el JSON + razonamiento es la capa de contraste mejorada. El INDEX.md queda como vista humana; el JSON es la fuente. Se regenera con `node scripts/build_skills_catalog.js` y se valida con `npm run test:skills-catalog` (sync con disco, sin huérfanos ni faltantes).
**Aplicación:** Nuevo `scripts/build_skills_catalog.js` + `_catalog/skills-catalog.json` (30 skills) + test `skills-catalog.test.js`. Kickoff SKILL.md Paso 3.5 reescrito para razonar sobre el JSON. INDEX.md anota que el JSON es la fuente.
**Reversibilidad:** alta (el detector keyword-based sigue intacto como base; el catálogo razonado es aditivo).

## D10 — Brief Contract obligatorio + "Te presento al equipo" (2026-06-02)
**Contexto:** El brief a sub-agentes no forzaba un prompt rico — permitía "eres experto en X" superficial, que produce output genérico. Tampoco existía un paso de "diseño de equipo" antes de delegar: los agentes se registraban reactivamente, sin que el usuario viera a quién se contrata para cada pieza ni qué contexto recibe. Además el context bundle de Capa 0 no inyectaba el perfil del proyecto ni `company.md` (el mecanismo ya existía para principles + INDEX, solo faltaba sumar fuentes).
**Decisión:** (1) **Brief Contract** obligatorio como precondición en pipeline-v2 Capa 1 — todo brief debe traer los 6 puntos: rol profundo (no "experto en X" sino "experto en X que hizo Y para Z"), objetivo verificable 1-3, contexto inyectado (principles literal + extracto de perfil + decisiones por ID + company.md), no-goals, formato de salida, recordatorio D6. (2) **Capa 0.7 "Te presento al equipo"** (EXPERIMENTAL): para tareas compuestas (2+ agentes), el orquestador presenta el equipo al usuario antes de delegar (rol+experiencia, objetivo, pasos, resumen del contexto inyectado) y espera OK. Por terminal por ahora; HTML futuro; removible si no aporta. (3) **Inyectar** extracto de `memory/project-profile.json` + `docs/company.md` (si tiene contenido real) al context bundle de Capa 0.
**Aplicación:** `.claude/skills/pipeline-v2/SKILL.md` (Capa 0 paso 7, Capa 0.7 nueva, Brief Contract en Capa 1, reglas duras 11). Anclado en `CLAUDE.md` raíz "Modelo operativo".
**Reversibilidad:** alta (es política documental + checklist en skill; la Capa 0.7 está marcada experimental y removible).

## D11 — Research proactivo ante claims factuales (2026-06-02)
**Contexto:** El research vía Perplexity (`src/research.js`) era REACTIVO — solo corría si el usuario lo pedía explícito. Los agentes podían afirmar datos de mundo real (naming, tendencias, cifras, competidores, precios) inventándolos, en vez de verificar.
**Decisión:** Antes de que un agente afirme datos de mundo real o post-corte-de-conocimiento, el orquestador PROPONE research (`node src/research.js pro/deep "..."`) en vez de dejar que invente. Señales que disparan la propuesta: "tendencias 2026", "qué se sabe de", "estado del arte", naming/branding, precios, decisiones con incertidumbre factual. Reactivo → proactivo.
**Aplicación:** `CLAUDE.md` raíz "Patrones de orquestación" (nota bajo la tabla) + `.claude/skills/pipeline-v2/SKILL.md` Capa 1 (nota research proactivo + regla dura 12).
**Reversibilidad:** alta (es regla de comportamiento del orquestador, sin código que dependa de ella).

## D12 — Fix canónico de refs de imagen: mimetype tuples + mention-check guard (2026-06-02)
**Contexto:** `scripts/openai_images.py` pasaba las references como file handles crudos (`open(p,"rb")`) sin mimetype explícito. La SDK de OpenAI inferia el tipo del nombre y rechazaba SILENCIOSAMENTE formatos como `.webp`/`.jpg` → la ref nunca llegaba al modelo → el modelo "describía" en vez de usar la imagen real. La causa raíz era el mimetype. Ambos proyectos consumer (mazelab-meta-ads, pax-os) ya lo habían arreglado a mano con file tuples. Además, la regla L3 ("cada Image N debe nombrarse en el prompt") era solo prosa — nada la verificaba.
**Decisión:** (1) En `edit_image` y `_edit_async`, pasar **file tuples** `(basename, fileobj, mimetype)` con mimetype explícito vía `_mime_for(path)` (png/jpg/jpeg/webp/gif → image/*). Cerrar file handles correctamente. (2) **Guard mention-check**: si hay refs cargadas y el prompt no contiene "Image 1" (regex `Image\s*1`, case-insensitive), lanzar `ValueError` claro — convierte la disciplina L3 en guardrail real. (3) Plantilla canónica "Image N" (refs posicionales + anti-pattern "nunca describir lo que existe como archivo") importada del `PROCESO.md` de mazelab a `image-gen/SKILL.md`.
**Aplicación:** `scripts/openai_images.py` (helpers `_mime_for`, `_assert_refs_mentioned`, `_open_file_tuples`; `edit_image` y `_edit_async` reescritos). `.claude/skills/image-gen/SKILL.md` (REGLA DE ORO + L3 actualizada). Test nuevo `dashboard-image-refs.test.js` (valida mime + guard con sub-proceso Python, sin tocar el API). Script `test:image-refs` en package.json.
**Reversibilidad:** baja (es un fix de correctitud — sin él las refs no-PNG se ignoran; no hay razón para revertir).

## D13 — Set multi-modelo de imagen pre-configurado (2026-06-02)
**Contexto:** Solo había un wrapper de imagen (`gpt-image-2` vía `openai_images.py`, arreglado en D12). gpt-image-2 da máxima calidad pero cuesta ~$0.21 high — caro para iteración rápida o casos donde la calidad extrema no importa. El research de modelos (Sprint v4.2) confirmó alternativas viables con el mismo patrón de refs: FLUX.2 dev (~15x más barato), Ideogram 3 (mejor para texto en imagen), Nano Banana Pro (refs fuertes hasta 14 imágenes).
**Decisión:** Set multi-modelo pre-configurado: gpt-image-2 (default, máxima calidad) + FLUX.2 dev + Ideogram 3 (ambos vía Replicate, `scripts/replicate_images.py --model flux2-dev|ideogram-v3`) + Nano Banana Pro (`scripts/gemini_images.py`, vía Gemini API). TODOS exponen la **misma firma pública** (`generate_image` / `edit_image`) y respetan las **mismas reglas de referencia** que `openai_images.py` (D12): archivo real como ref nunca descrito + guard mention-check "Image 1" + mimetype correcto. Cuando se discuta generar imágenes, el orquestador **PRESENTA las opciones precio/calidad al usuario** y espera la elección; default gpt-image-2 si no especifica y la calidad importa. Params de API de FLUX/Ideogram/Gemini verificados con WebFetch/WebSearch al implementar; las incertidumbres residuales (mapeo size/quality, data URI base64 en FLUX) solo se confirman con llamada real.
**Aplicación:** `scripts/gemini_images.py` (Nano Banana Pro, `gemini-3-pro-image`, inline_data base64) + `scripts/replicate_images.py` (FLUX.2 dev + Ideogram v3) nuevos. `.claude/skills/image-gen/SKILL.md` sección "Selección de modelo" (tabla + regla de presentación). `.env.example` agrega `GEMINI_API_KEY` (opcional). Test `image-wrappers.test.js` valida el guard mention-check de cada wrapper nuevo vía sub-proceso Python (sin tocar APIs ni requerir keys; skip si falta intérprete). Script `test:image-wrappers` en package.json.
**Reversibilidad:** alta (los wrappers nuevos son aditivos; gpt-image-2 sigue siendo el default y no se tocó).
**Addendum (2026-06-02):** Nano Banana Pro confirmado funcionando vía Replicate (`google/nano-banana-pro`), probado con 2 llamadas reales: generación simple + edición con referencia (respeta la forma). Validado multimodal. La ruta de implementación final es `scripts/replicate_images.py --model nano-banana-pro` (refs vía `image_input` como data URIs, output forzado a png), no la vía Gemini API descrita arriba.

## D14 — Audit v5: 45 fixes verificados (2026-06-13)
**Contexto:** Tras la consolidación v4 (D8) y los fixes de imágenes (D12/D13), un audit exhaustivo del starter detectó 45 oportunidades concretas en cinco frentes: tokens desperdiciados por sesión, docs desfasadas respecto a D8, fricciones de usuario novato en Windows, deshonestidad del catálogo (skills stub presentadas como maduras) e higiene de git/seguridad.
**Decisión:** Aplicados 45 fixes verificados — recorte de tokens (quality-mindset/decisions/detector CLI), docs al día post-D8, fricciones novato Windows (python venv, npm start, PowerShell), catálogo honesto (stubs), higiene git (gitignore + dotenv muerto + bind 127.0.0.1), y oportunidades (chip costo USD, /resumen, feedback endpoint, SessionStart hook). Detalle en AUDIT-v5.html.
**Aplicación:** Tokens (~4-5k/sesión): quality-mindset y kickoff con ejemplos movidos a EXAMPLES.md, 00-decisions condensado (D1/D3/D5 superadas por D8), detector.js con CLI, dedups de council/catálogo/pipeline. Docs al día: dashboard descrito como HTML v4 (no kanban borrado), versiones a v4.2.1, conteos de catálogo a 18, estructura con review-app/feedback.md, wrappers multi-modelo. Novato Windows: python del `.venv` en image-gen, npm start con health-check + apagado real, variantes PowerShell, setup.js (`--python-only`, placeholder, comando replicate, paths en errores). Catálogo honesto: client-language/non-technical-cold-reader a status stub, trigger 'mano' removido, detector sincronizado. Higiene: `.gitignore` (state.json, contracts/declared, runtime outputs, voice-state), dotenv dep muerta removida, servers bind 127.0.0.1, CORS restringido. Oportunidades: chip costo USD en dashboard, `/resumen` + build_resumen.js, review-app feedback endpoint, SessionStart hook.
**Reversibilidad:** media.
