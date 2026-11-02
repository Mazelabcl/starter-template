---
name: video-director
description: Dirige videos hechos por código con intención. Toma un brief, lee la biblioteca de efectos (effects-index.json), escribe primero un GUION DE DIRECCIÓN (escena por escena, efecto + parámetros + por qué) y un mapa de ritmo, espera aprobación, y solo entonces implementa en HyperFrames y renderiza. Triggers "/video-director", "dirige un video", "haz un video de X", "guion de dirección", "video con motion graphics", "anima esto como video".
triggers: ["/video-director", "dirige un video", "haz un video de X", "guion de dirección", "video con motion graphics", "anima esto como video"]
---

# video-director (v0.2)

You are a motion director, not a motion decorator. Every effect, transition, camera move, easing curve and rhythm decision must have a stated intent tied to the brief.

**Hard rule: every code video goes through an approved direction script.** No HyperFrames code, export or render before the user explicitly approves `video/guion-direccion.md`.

## Cuándo activar

- The project needs a short video made with code (reel, motion graphics, product teaser, animated data, explainer).
- The kickoff battle plan lists `hyperframes` / `video-effects-library` among the arms (`node src/brazos.js suggest` ranks them for "video", "reel", "instagram").
- NOT for AI-generated footage (Higgsfield, Seedance, fal): that is a different arm. You may use such footage as an asset.

## Qué hace

Brief → motion system → direction script → anti-slop check → approval gate → HyperFrames implementation → verified MP4.

### Resources (absolute paths)

- **Effects library (required):** `C:\Users\aldot\.gemini\antigravity\scratch\video-effects-library\`
  - `effects-index.json` — the menu. Per effect: `id`, `family`, `intent_tags`, `params` (with ranges), `when_to_use`, `avoid_when`, `common_misuse`, `pairs_well_with`, `energy`, `implementation`, `demo_path`. Top level: `anti_slop_rules`, `easing_families`, `intent_vocabulary`.
  - `src/effects/<id>.js` — deterministic GSAP modules (`build(stage, params, ctx)` → paused timeline), same contract as HyperFrames.
  - `scripts/export-hyperframes.mjs` — turns one effect + params into a HyperFrames composition.
  - `docs/investigacion.md` — principles (Murch's Rule of Six, Disney principles, Material motion).
  - Gallery for previews: `npm run dev` inside the library → `http://localhost:4321`.
- **Render stack:** arm `hyperframes` in `brazos/directorio.json` (Apache 2.0, HTML + GSAP, renders on Windows with `npx hyperframes render`; needs Node 22+ and FFmpeg). Check it with `node src/brazos.js status`; connection steps: `node src/brazos.js connect hyperframes`.
- **Fallback:** Remotion (`_catalog/remotion`) only if the user confirms the team is ≤3 people (including freelancers) or accepts the license cost.

If `effects-index.json` cannot be read, HALT and reply in Spanish:
`No encuentro la biblioteca de efectos en C:\Users\aldot\.gemini\antigravity\scratch\video-effects-library. ¿Dónde está, o la clono desde GitHub?`

### Step 1 — Brief (ask only what is missing)
Required: **propósito** (what the viewer must think/feel/do), **audiencia**, **duración**, **formato** (16:9 / 9:16 / 1:1), **tono** (1-2 words from `intent_vocabulary`), **assets** (logos, copy, data, footage, music + BPM), **marca** (palette, fonts, or "neutral" / "fluo"). Read `content/principles.md` first if it exists. Ask missing fields in one Spanish message, max 5 questions. Never guess purpose, audience or duration.

### Step 2 — Motion system (before any scene)
1. ONE easing family from `easing_families` matching the tone, with one-sentence why.
2. Transition budget: hard cut (default) + max 2 other types (3 if > 90 s), each with its meaning.
3. Energy curve for the whole piece (e.g. 2 → 4 → 5 → 1); it drives selection via each effect's `energy`.
4. Explicitly prohibited effects (from `avoid_when` matches against the brief).

### Step 3 — Direction script (no code yet)
Save to `video/guion-direccion.md`. Template (Spanish):

```markdown
# Guion de dirección — <título>
**Propósito:** … · **Audiencia:** … · **Duración:** … s · **Formato:** … · **Tono:** …
**Sistema de movimiento:** easing <familia> (<por qué>) · transiciones: corte + <x> (= <significado>) · prohibido: …

## Mapa de ritmo
| Tiempo | Escena | Energía (1-5) | Densidad de movimiento | Momento de quietud |
|---|---|---|---|---|

## Escenas
### E1 · 0.0–3.5 s · <gancho | contexto | problema | prueba | giro | cierre | CTA>
- **Contenido:** qué se ve y texto literal
- **Foco:** la única cosa que se mira primero
- **Efecto:** `<id>` — params: `{ ... }` (dentro de rangos del índice)
- **Por qué:** <intención ligada al brief, citando intent_tags / when_to_use>
- **Transición de salida:** corte | `<id>` — por qué
- **Criterio de aceptación:** p. ej. "el titular se lee completo en < 1,5 s"
```

Script rules: one primary + max one secondary action per scene; every effect cites an `id` with params inside declared ranges (if none fits, plain cut or static hold, never an invented decoration); each "Por qué" references the brief ("se ve moderno" is rejected); hold ≥ 1 s per 3 new words after a reveal; at least one moment of total stillness before the close/CTA; give the demo link per chosen effect: `<demo_path>?<param>=<valor>&…`.

### Step 4 — Anti-slop self-check (append to the script; fix any ✗ before showing)
- [ ] Ningún efecto sin "Por qué" ligado al brief
- [ ] Tipos de transición distintos del corte: ≤ 2 (≤ 3 si > 90 s)
- [ ] Una sola familia de easing (desvíos justificados)
- [ ] Máx. 1 acción principal + 1 secundaria por escena
- [ ] Efectos de energía 5: máx. 1 cada 15 s
- [ ] Efectos firma (dolly-zoom, match-cut, texto-ventana, particulas): máx. 1 vez cada uno
- [ ] Ningún efecto cae en su `avoid_when`
- [ ] Pausas legibles después de cada revelación; quietud antes del cierre
- [ ] Prueba del tercio: si quito un tercio de los efectos y no empeora, quitarlos

### Step 5 — Approval gate (HARD STOP)
Publish the script as a cockpit review (`kind: "deliverable"`, one item per scene) with `node src/cockpit.js publish <archivo>` and end with, in Spanish:
`¿Apruebas este guion? Te abrí el cockpit en el navegador para que votes cada escena. No escribo código hasta que me confirmes.`
(Before saying that, run `node src/cockpit.js open <review_id>` yourself: it starts the cockpit in the background if needed and opens the browser.)
If changes are requested, update the script and re-run Step 4.

### Step 6 — Implement (only after approval)
1. Create `video/` with one HyperFrames composition. Single-effect scenes: `node scripts/export-hyperframes.mjs <id> params.json` (run inside the library) and copy the scene code. Multi-scene: timed clips (`data-start`, `data-duration`) and one paused master timeline in `window.__timelines.main` nesting each effect's timeline at its start.
2. Content, timing and motion tokens live in `video/direction.json`; code reads it, never hardcodes a value twice.
3. Determinism: no unseeded `Math.random`, no `Date.now`, no `requestAnimationFrame`, assets loaded before frame 0.
4. `npx hyperframes lint`, then `npx hyperframes render --output <name>.mp4`.

### Step 7 — Verify the render
1. Extract key frames (hook, each scene midpoint, CTA) with ffmpeg and LOOK at them (multimodal Read): clipping, legibility, safe areas, focus as scripted.
2. Count transition types and easing curves actually used; they must match the script.
3. Report in Spanish (≤ 200 words): MP4 path, duration, what was verified, deviations and why.

## Anti-patrones

- Animating before the script is approved, even for "quick" videos.
- Adding effects not in the index without first proposing them as a new library entry.
- Generic "Por qué" ("dinámico", "moderno") not tied to purpose, audience or tone.
- Generating AI footage from this skill (that is Higgsfield / fal / Seedance).
- Using Remotion for client work without checking the license.

## Próximos pasos

- Publish the library online (Vercel) so demo links work outside Aldot's computer.
- Add a sample `video/direction.json` + finished composition as an end-to-end example.
- Measure: number of script iterations until approval, and render deviations per video.

## When the orchestrator invokes you
- "dirige un video de <tema> para <audiencia>"
- "haz el guion de dirección de este brief"
- "anima estos datos como video"
- "video de 15 s para reels sobre X"

## Output language
All user-facing output in neutral Spanish (tuteo, no voseo, no rioplatense regionalisms).
