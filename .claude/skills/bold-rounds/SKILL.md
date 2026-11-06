---
name: bold-rounds
description: Round-by-round BOLD redesign of any concept (web page, project, feature, document) on a COPY. Two modes, visual (look and feel) and producto (a new capability, decision or outcome for the end user). Each round runs two variants in parallel, BLIND (fresh context, no memory) and CONTEXT (knows previous rounds, user comments and council findings), screenshots before/after, rejects fake progress, and publishes a "rounds" review in the cockpit so the user picks blind, context or "integrar ambas" and leaves a comment. The user chooses how involved to be (auto, cada:N, todas). The real target is never touched until the user says "aplicar". Triggers "/bold-rounds", "mejóralo por rondas", "rediseño audaz", "innova el producto por rondas", "hazlo como la demo del café", "dale N rondas de mejora".
allowed-tools: Bash, Read, Edit, Write, Agent
---

# bold-rounds: one bold change per round, blind vs context, user decides

Helper: `scripts/bold_rounds.js` (run `node scripts/bold_rounds.js` for usage). Runtime data: `rounds/` (gitignored). Review UI: cockpit (`kind: "rounds"`). Demo fixture: `examples/cafeteria-90s/`.

## Core instruction for every variant (the user's literal prompt, keep it in English)

> "Look at the site first. Then innovate: think about the user experience and think outside the box. Make one bold change that improves conversions or the look and feel, not a small tweak. Use any tool you have. You must ship a change every time."

The helper embeds it verbatim in `rounds/NNN/prompt-<variant>.md` and adapts only the guardrails to the mode:

- `--modo visual` (default): one change in ONE visual category (composición, tipografía, color, imágenes, interacción, jerarquía, mobile), visible at first glance, anti-slop. Rejected without a visible pixel diff.
- `--modo producto`: ONE innovation that changes what the end user can do, decide or get. Categories: capacidad nueva, decisión que se facilita, resultado o entregable nuevo, coordinación que se elimina, momento que se protege, recuerdo o valor difícil de conseguir hoy, monetización o motivo de compra. Changes that only touch typography, color, layout or copy are forbidden. Each variant must leave something testable in the copy (a working interaction, sample data labeled "ejemplo"). Rejected if notes.md lacks `Categoría`, `Antes`, `Ahora` or `Cómo probarlo`, or if the category is aesthetic; pixels are not required (a capability may live behind a click) but the diff is still shown when there is one.

Use `producto` when the user wants to innovate the product ("innova", "qué más podría hacer", "nuevas funciones"); `visual` when they talk about the look. If unclear, ask once: `¿Quieres innovar cómo se ve (visual) o qué puede hacer el usuario con el producto (producto)?`

## Hard rules

1. Work ONLY on the copy in `rounds/`. Never edit the real target until the user says "aplicar" (step 9).
2. BLIND variants receive the prompt file content and NOTHING else: no chat summary, no DESIGN.md, no comments, no council findings. That is the point.
3. Fake progress is rejected: no visible change (visual) or no Antes/Ahora/Cómo probarlo (producto).
4. Caps: `--rounds` (default 5, hard max 10), per-variant timeout 15 min. Never bypass with `--force` unless the user asked.
5. Never use paid APIs (image generation, etc.) inside a variant unless the user explicitly allowed it and knows the cost.
6. Never invent the user's choice. If the mode needs their decision and it has not arrived, say what is pending and how to answer (the helper's `siguiente_paso` line), then stop.

## Involvement (ask ONCE at the start if the user did not say it)

```
¿Cuánto quieres involucrarte?
1. Rápido: doy la instrucción y listo (auto: Claude elige cada ronda y deja escrito por qué)
2. Cada N rondas: Claude elige y te muestro un checkpoint cada N (por ejemplo cada:3)
3. Todas: tú eliges cada ronda en el cockpit
Te recomiendo <todas|auto> porque <one line>.
```

Recommend `todas` when the task is core to the product or hard to undo; `auto` when it is quick or exploratory. Pass the answer as `--involucramiento auto|cada:N|todas` (saved in `run.json`).

- `auto`: no forced pauses. After each review, pick yourself: `apply N <variante> --auto --razon "<por qué, una línea>"`. The reason is shown first in that round's cockpit review and logged in DESIGN.md. Safety cap: 10 rounds in a row (the hard round max), plus the stop conditions below.
- `cada:N`: same as auto, but `prepare` refuses to continue after N rounds without a human; show the checkpoint and wait. When the user answers (or says "sigue"), record it with `apply <last> <variante>` WITHOUT `--auto`.
- `todas`: never use `--auto` (the helper refuses). Wait for the user's pick.

## Variant report: pictures first, text optional

Visual mode `notes.md`: `Titular`, `Categoría`, `Cambio 1..5`, `Por qué`, `Referencias`, `Riesgo` (one line each). Product mode: `Titular`, `Categoría`, `Situación` (quién, qué momento, qué falla hoy), `Antes`, `Ahora`, `Cómo probarlo` (pasos en la copia), `Señal de validación` (métrica + umbral), `Depende de prueba real`, `Riesgo`. Notes only show behind "Ver más"; the "elegir" slide shows Titular, Antes → Ahora, Cómo probarlo and Señal of each option side by side (visual mode: Titular, Categoría, Cambios), plus the before/after slider slides when pixels changed.

## Setup (once per run)

```bash
node scripts/bold_rounds.js init <carpeta|archivo|url> --rounds <N> --goal "<objetivo>" --modo producto --involucramiento todas [--hallazgos councils/results/<id>-hallazgos.md]
```
(esto copia el objetivo a `rounds/working/` sin tocar el original y crea `rounds/DESIGN.md`)

- If `/bold-rounds` came without N, use 3. Without a clear goal, ask once: `¿Qué quieres lograr? (por ejemplo: más pedidos, que se vea actual, que los invitados compartan más fotos)`.
- `--hallazgos`: findings from a council `entrevista` (or any .md). Only the CONTEXT variant receives them.
- If `rounds/run.json` already exists, ask whether to continue that run or start another with `--out rounds-<nombre>` (all later commands need the same `--out`).
- Parallel runs (e.g. two lenses, 10 rounds each): `init ... --out rounds-novia --goal "lente novia"` and `init ... --out rounds-novio --goal "lente novio"`. Each run has its own review ids; run their rounds in parallel (one message, four Agent calls).
- Screenshots need Playwright. If the helper prints the install hint, show it as copy-paste steps and wait. Documents (`.md`, `.txt`) render as a simple page; other files are judged by text diff.

## Each round N

1. **Prepare:** `node scripts/bold_rounds.js prepare N`
2. **Run both variants in parallel.** Method A (default): ONE message with two Agent calls (`general-purpose`), each with the exact content of `rounds/NNN/prompt-blind.md` and `rounds/NNN/prompt-context.md` as the whole prompt. Add nothing to the blind prompt. Method B (unattended): `node scripts/bold_rounds.js run N` (`claude -p` per variant; logs in `rounds/NNN/log-*.txt`).
3. Each variant writes `rounds/NNN/<variant>/notes.md`. If one is missing, say so; do not write it yourself.
4. **Check:** `node scripts/bold_rounds.js after N` (screenshots, diff, rejection by mode).
5. **Look yourself:** Read the before/after PNGs; in product mode also open the entry file and follow "Cómo probarlo". If a variant broke the page or invented facts, say so in your TLDR.
6. **Publish:** `node scripts/bold_rounds.js review N`, then `node src/cockpit.js open <review_id>` yourself. Tell the user:
   `Ronda N lista. Te abrí el cockpit en el navegador. Elige una con un clic y, si quieres, deja un comentario con el botón de chat: la variante con contexto lo recibe en la siguiente ronda.`
   Then at most one line: which one you would pick and why. In `auto`, skip the wait (step 7) and tell the user what you picked and why in one line.
7. **Decision.** `node scripts/bold_rounds.js choice N` (pick + comment) or `node scripts/bold_rounds.js status` (`siguiente_paso` says exactly what is pending). If the user answers in chat, pass their words with `--comentario "..."`.
   - "integrar": spawn one Agent that copies `rounds/NNN/context/` to `rounds/NNN/integrada/`, merges the chosen parts of `blind/` per the comment and writes its own `notes.md`; then `after N` and show it before applying.
8. **Apply** (seeds round N+1; the real target stays untouched): `node scripts/bold_rounds.js apply N <blind|context|integrada>` (add `--auto --razon "..."` only when you chose). It stores the user's cockpit comment for the next CONTEXT prompt and in DESIGN.md automatically. Then update `rounds/DESIGN.md` "Dirección" (max 15 lines) and mark the feedback processed: `node src/cockpit.js done <review_id>`.
9. Continue until the cap. At the end, or when the user says "aplicar": `node scripts/bold_rounds.js changes`, show the list, confirm once, then copy those files from `rounds/working/` to the real target. Never copy without that explicit "aplicar".

## Stop conditions

- Both variants rejected in a round: stop and tell the user `Esta ronda no produjo un cambio válido en ninguna variante. ¿Cambiamos el objetivo o paramos aquí?`
- The user votes down every option twice in a row: stop and ask what direction they want.
- Cap reached: summarize the evolution (round, category, chosen variant, who chose) in 5 lines max and offer "aplicar".

## Choosing method A vs B

- A (Agent tool) is the default: works on Windows, runs in parallel, the user sees progress, and a subagent only knows its prompt, so blind is truly blind.
- B (`claude -p`) is for long unattended runs (e.g. `--involucramiento auto` overnight). Each variant is a fresh process limited to its folder. Caveat: it still loads the global and project CLAUDE.md.
- The official `ralph-loop` plugin is NOT used: same session, context accumulates, no blind variant.

## Anti-patterns

- Summarizing the history, comments or findings into the blind prompt "to help it".
- Product mode rounds that only enlarge text or move boxes: that is visual mode.
- Picking for the user in `todas`, or waiting for a vote in `auto`.
- Long text dumps instead of the cockpit review.
- Touching the original target before "aplicar".
