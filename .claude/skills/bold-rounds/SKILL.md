---
name: bold-rounds
description: Round-by-round BOLD redesign of any concept (web page, project, feature, document) on a COPY. Two modes, visual (look and feel) and producto (a new capability, decision or outcome for the end user). Each round runs two variants, BLIND (fresh context, no memory) and CONTEXT (knows previous rounds, user comments and council findings); each variant first IDEATES in an isolated session and then BUILDS in another, with hard caps and a visible token budget. Screenshots before/after, rejects fake progress, and publishes a "rounds" review in the cockpit so the user picks blind, context or "integrar ambas" and leaves a comment. The user chooses how involved to be (auto, cada:N, todas). The real target is never touched until the user says "aplicar". Triggers "/bold-rounds", "mejóralo por rondas", "rediseño audaz", "innova el producto por rondas", "hazlo como la demo del café", "dale N rondas de mejora".
allowed-tools: Bash, Read, Edit, Write, Agent
---

# bold-rounds: one bold change per round, blind vs context, user decides

Helper: `scripts/bold_rounds.js` (run `node scripts/bold_rounds.js` for usage). Runtime data: `rounds/` (gitignored). Review UI: cockpit (`kind: "rounds"`). Demo fixture: `examples/cafeteria-90s/`.

## Core instruction for every variant (the user's literal prompt, keep it in English)

> "Look at the site first. Then innovate: think about the user experience and think outside the box. Make one bold change that improves conversions or the look and feel, not a small tweak. Use any tool you have. You must ship a change every time."

The helper embeds it verbatim in `rounds/NNN/idea-prompt-<variant>.md` (method B) and `rounds/NNN/prompt-<variant>.md` (method A) and adapts only the guardrails to the mode:

- `--modo visual` (default): one change in ONE visual category (composición, tipografía, color, imágenes, interacción, jerarquía, mobile), visible at first glance, anti-slop. Rejected without a visible pixel diff.
- `--modo producto`: ONE innovation that changes what the end user can do, decide or get. Categories: capacidad nueva, decisión que se facilita, resultado o entregable nuevo, coordinación que se elimina, momento que se protege, recuerdo o valor difícil de conseguir hoy, monetización o motivo de compra. Changes that only touch typography, color, layout or copy are forbidden. Each variant must leave something testable in the copy (a working interaction, sample data labeled "ejemplo"). Rejected if notes.md lacks `Categoría`, `Antes`, `Ahora` or `Cómo probarlo`, or if the category is aesthetic; pixels are not required (a capability may live behind a click) but the diff is still shown when there is one.

Use `producto` when the user wants to innovate the product ("innova", "qué más podría hacer", "nuevas funciones"); `visual` when they talk about the look. If unclear, ask once: `¿Quieres innovar cómo se ve (visual) o qué puede hacer el usuario con el producto (producto)?`

## Who innovates, and how it stays cheap (method B, default)

Each variant runs as two isolated `claude -p` sessions (`src/claude_aislado.js`: `--safe-mode --strict-mcp-config`, no global CLAUDE.md, skills, plugins, MCP or hooks; explicit `--effort`; hard `--max-turns` and timeout that kills the process tree):

1. **IDEAR**: model chosen by the user (recommend Opus: out-of-the-box ideas), only the Read tool, a short own system prompt, the before screenshots and the entry file inline, max 6 turns. It replies with the idea spec (`idea-<v>.md`; its fields seed `notes.md`).
2. **CONSTRUIR**: another session (recommend Sonnet), only Read/Edit/Write/Glob/Grep, max 25 turns, no screenshots or self-verification (`after` does that).

Measured on `examples/cafeteria-90s` (2026-11-06): ~6-8 K tokens of initial context and ~60 K tokens per variant, vs ~55 K initial and ~3 M per variant in Weddi.

- **Lens** = a concrete angle from `councils/personas/*.json` (field `lente`), e.g. `director-arte`, `growth`, `usuario-novato`. Lenses apply to IDEATION. Blind gets its lens but no history. `init --lentes a,b,c` sets the rotation, default `auto` (never the same lens for both variants, no repeated pair across rounds). One-off: `prepare N --lente-blind X --lente-context Y`. The lens lands in `notes.md` (`Mirada:`) and on the slides.
- **Models**: never assume them. Ask at setup and pass `init --modelo-idea <m> --modelo-construir <m>` (or `--modelo <m>` for both; the CLI refuses without them). Per round: `prepare N --modelo-idea M --modelo M`.

## Hard rules

1. Work ONLY on the copy in `rounds/`. Never edit the real target until the user says "aplicar" (step 9).
2. BLIND variants receive the prompt file content and NOTHING else: no chat summary, no DESIGN.md, no comments, no council findings. That is the point.
3. Fake progress is rejected: no visible change (visual), no Antes/Ahora/Cómo probarlo (producto), or JavaScript that does not compile (`after` runs `node --check` on changed .js files and inline `<script>`s).
4. Caps: `--rounds` (default 5, hard max 10), per-variant timeout 15 min. Never bypass with `--force` unless the user asked.
5. Never use paid APIs (image generation, etc.) inside a variant unless the user explicitly allowed it and knows the cost.
6. Never invent the user's choice. If the mode needs their decision and it has not arrived, say what is pending and how to answer (the helper's `siguiente_paso` line), then stop.
7. **Never wait longer than 4 minutes in one command** (a 600 s watchdog kills orchestrators). Long work goes to `run N --fondo`; then repeat `espera N` (max 240 s each) until it says `listo`.
8. **Usage limit is not a quality verdict.** If `after` marks a variant `reintentar` ("hit your limit"), tell the user when the window frees up and rerun only that variant later (`run N <variante> --fondo`). Never reject it or pick the other one because of it.
9. Always give the user ABSOLUTE paths (the helper prints them), ready to open.

## Involvement (ask ONCE at the start if the user did not say it)

```
¿Cuánto quieres involucrarte?
1. Rápido: doy la instrucción y listo (auto: Claude elige cada ronda y deja escrito por qué)
2. Cada N rondas: Claude elige y te muestro un checkpoint cada N (por ejemplo cada:3)
3. Todas: tú eliges cada ronda en el cockpit
Te recomiendo <todas|auto> porque <one line>.
```

Recommend `todas` when the task is core to the product or hard to undo; `auto` when it is quick or exploratory. Pass the answer as `--involucramiento auto|cada:N|todas` (saved in `run.json`).

- `auto`: no forced pauses. After each review, pick yourself: `apply N <variante> --auto --razon "<por qué, una línea>"`. The reason is shown first in that round's cockpit review and logged in DESIGN.md. Safety cap: 10 rounds in a row, plus the stop conditions below.
- `cada:N`: same as auto, but `prepare` refuses to continue after N rounds without a human; show the checkpoint and wait. When the user answers (or says "sigue"), record it with `apply <last> <variante>` WITHOUT `--auto`.
- `todas`: never use `--auto` (the helper refuses). Wait for the user's pick.

## Variant report: pictures first, text optional

Visual mode `notes.md`: `Titular`, `Categoría`, `Mirada`, `Gana` (what the end user gains), `Cambio 1..5`, `Por qué`, `Referencias`, `Riesgo` (one line each). Product mode: `Titular`, `Categoría`, `Mirada`, `Gana`, `Situación`, `Antes`, `Ahora`, `Cómo probarlo`, `Señal de validación`, `Depende de prueba real`, `Riesgo`. Notes only show behind "Ver más"; the "elegir" slide shows the key lines of each option side by side, plus before/after slider slides with numbered hotspots when pixels changed.

## Setup (once per run)

1. Ask (once, together if possible): goal, mode, involvement, and the two models: `¿Con qué modelo idea cada variante y con cuál construye? Te recomiendo Opus para idear (ideas fuera de la caja) y Sonnet para construir (gasta bastante menos). También puedes usar Haiku.` Never pick silently.
2. Show the budget (creates nothing, prints tokens and the approximate % of a 5-hour window, labeled as an estimate):
   `node scripts/bold_rounds.js init <carpeta|archivo|url> --rounds <N> --goal "<objetivo>" --modo <modo> --involucramiento <inv> --modelo-idea opus --modelo-construir sonnet`
   Show the user those lines plus the warning that the PC must stay plugged in and not suspend. Only after a yes, run the same command with `--yes` (esto copia el objetivo a `rounds/working/` sin tocar el original).
- If `/bold-rounds` came without N, use 3. `--hallazgos a.md`: findings from a council (only CONTEXT receives them).
- Variants and runs go in SERIES by default (same total tokens, no bursts that hit the limit). Parallel only if the user asks: `init ... --paralelo` or `run N --paralelo`.
- If `rounds/run.json` already exists, ask whether to continue or start another with `--out rounds-<nombre>` (all later commands need the same `--out`).
- Screenshots need Playwright. If the helper prints the install hint, show it as copy-paste steps and wait.

## Each round N

1. **Prepare:** `node scripts/bold_rounds.js prepare N`
2. **Run (method B):** `node scripts/bold_rounds.js run N --fondo`, then `node scripts/bold_rounds.js espera N` until it prints `listo` (exit 3 = still running: call it again). Logs and metrics: `rounds/NNN/log-<v>-idea.jsonl`, `log-<v>-build.jsonl`, `run-<v>.json`.
3. **Check:** `node scripts/bold_rounds.js after N` (screenshots, diff, syntax check, rejection by mode, `reintentar` on usage limit).
4. **Look yourself:** Read the before/after PNGs; in product mode also open the entry file and follow "Cómo probarlo". If a variant broke the page or invented facts, say so in your TLDR.
5. **Publish:** `node scripts/bold_rounds.js review N`, then `node src/cockpit.js open <review_id>` yourself. Tell the user:
   `Ronda N lista. Te abrí el cockpit en el navegador. Elige una con un clic y, si quieres, deja un comentario con el botón de chat: la variante con contexto lo recibe en la siguiente ronda.`
   Then at most one line: which one you would pick and why. In `auto`, skip the wait and say what you picked and why in one line.
6. **Decision.** `node scripts/bold_rounds.js choice N` or `status` (`siguiente_paso` says exactly what is pending). Chat answers go in with `--comentario "..."`.
   - "integrar": spawn one Agent (model Sonnet) that copies `rounds/NNN/context/` to `rounds/NNN/integrada/`, merges the chosen parts of `blind/` per the comment and writes its own `notes.md`; then `after N` and show it before applying.
7. **Apply** (seeds round N+1): `node scripts/bold_rounds.js apply N <blind|context|integrada>` (`--auto --razon "..."` only when you chose). Update `rounds/DESIGN.md` "Dirección" (max 15 lines) and `node src/cockpit.js done <review_id>`.
8. **Summary page** (end of the run or when the user asks how it went): `node scripts/bold_rounds.js resumen`, then `node src/cockpit.js open <id>`. One round per slide: big headline, before/after, "qué gana el usuario", a "Probar" button (opens the demo in a sandbox), a verdict chip and a 5-word glossary. Never improvise your own HTML summary.
9. At the end, or when the user says "aplicar": `node scripts/bold_rounds.js changes`, show the list, confirm once, then copy those files from `rounds/working/` to the real target. Never copy without that explicit "aplicar".

## Method A (fallback)

Only if `claude -p` is not available: ONE message with two Agent calls (`general-purpose`, `model` = `MODELO_PARA_AGENT` from `prepare`), each with the exact content of `rounds/NNN/prompt-<variant>.md`. It is not isolated (each subagent loads the session's global context) and has no turn cap, so it costs much more; say so before using it. The official `ralph-loop` plugin is NOT used.

## Stop conditions

- Both variants rejected in a round (not `reintentar`): stop and tell the user `Esta ronda no produjo un cambio válido en ninguna variante. ¿Cambiamos el objetivo o paramos aquí?`
- The user votes down every option twice in a row: stop and ask what direction they want.
- Usage limit: stop, say when the window frees up, and continue later with the pending `run`.
- Cap reached: `resumen`, a 5-line summary and offer "aplicar".

## Anti-patterns

- Summarizing the history, comments or findings into the blind prompt "to help it".
- Running variants with an inherited, non-isolated `claude -p`, or in parallel without the user asking.
- `sleep`/waits longer than 4 minutes, or treating "hit your limit" as a bad variant.
- Product mode rounds that only enlarge text or move boxes: that is visual mode.
- Picking for the user in `todas`, or waiting for a vote in `auto`.
- Long text dumps or relative paths instead of the cockpit review and absolute paths.
- Touching the original target before "aplicar".
