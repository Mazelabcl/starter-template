---
name: bold-rounds
description: Round-by-round BOLD redesign of any concept (web page, project, feature, document) on a COPY. Each round runs two variants in parallel, BLIND (fresh context, no memory) and CONTEXT (knows previous rounds and user feedback), screenshots before/after, rejects invisible changes, and publishes a "rounds" review in the cockpit so the user picks blind, context or "integrar ambas". The real target is never touched until the user says "aplicar". Triggers "/bold-rounds", "mejóralo por rondas", "rediseño audaz", "hazlo como la demo del café", "dale N rondas de mejora".
allowed-tools: Bash, Read, Edit, Write, Agent
---

# bold-rounds: one bold change per round, blind vs context, user decides

Helper: `scripts/bold_rounds.js` (run `node scripts/bold_rounds.js` for usage). Runtime data: `rounds/` (gitignored). Review UI: cockpit (`kind: "rounds"`). Demo fixture: `examples/cafeteria-90s/`.

## Core instruction for every variant (the user's literal prompt, keep it in English)

> "Look at the site first. Then innovate: think about the user experience and think outside the box. Make one bold change that improves conversions or the look and feel, not a small tweak. Use any tool you have. You must ship a change every time."

The helper embeds it in `rounds/NNN/prompt-<variant>.md` together with the guardrails: one change in ONE category (composición, tipografía, color, imágenes, interacción, jerarquía, mobile), visible at first glance, anti-slop (no default gradients, no pills everywhere, no card soup, 3-4 colors + neutrals, 1-2 named references), truthful facts, self-contained, user-facing text in Spanish neutro, and a `notes.md` (qué cambió, categoría, por qué, referencias, riesgo).

## Hard rules

1. Work ONLY on the copy in `rounds/`. Never edit the real target until the user says "aplicar" (step 9).
2. BLIND variants receive the prompt file content and NOTHING else: no chat summary, no DESIGN.md, no previous rounds. That is the point.
3. No visible change = rejected. "Always ship" without a visible diff is fake progress.
4. Caps: `--rounds` (default 5, hard max 10), per-variant timeout 15 min, human checkpoint every `--pause-every` rounds (default 3). The helper refuses to prepare a round past the cap or after too many rounds without a human decision. Never bypass with `--force` unless the user asked.
5. Never use paid APIs (image generation, etc.) inside a variant unless the user explicitly allowed it and knows the cost.

## Setup (once per run)

```bash
node scripts/bold_rounds.js init <carpeta|archivo|url> --rounds <N> --goal "<objetivo en una frase>"
```
(esto copia el objetivo a `rounds/working/` sin tocar el original y crea `rounds/DESIGN.md`)

- If `/bold-rounds` came without N, use 3. Without a clear goal, ask once: `¿Qué quieres lograr con el rediseño? (por ejemplo: más pedidos, que se vea actual, que se entienda mejor)`.
- If `rounds/run.json` already exists, ask whether to continue that run or start another one with `--out rounds-<nombre>` (all later commands then need the same `--out`).
- Screenshots need Playwright. If the helper prints the install hint, show it to the user as copy-paste steps and wait. Documents (`.md`, `.txt`) are rendered as a simple page; other files skip screenshots and are judged by text diff.

## Each round N

1. **Prepare** (snapshot "before" + two copies + prompts):
   `node scripts/bold_rounds.js prepare N`
2. **Run both variants in parallel.** Default (method A, inside this session): send ONE message with two Agent calls (`general-purpose`), each with the exact content of `rounds/NNN/prompt-blind.md` and `rounds/NNN/prompt-context.md` as the whole prompt. Do not add anything to the blind prompt.
   Unattended long runs (method B, headless): `node scripts/bold_rounds.js run N` (runs `claude -p` per variant inside its folder, both at once; logs in `rounds/NNN/log-*.txt`).
3. Each variant writes `rounds/NNN/<variant>/notes.md`. If one is missing, note it in the review; do not write it yourself.
4. **After + diff check:** `node scripts/bold_rounds.js after N` (screenshots "after", pixel diff vs before, rejects variants without visible change).
5. **Look yourself:** Read the before/after PNGs (desktop and mobile) of each candidate. If a variant broke the page (overflow, unreadable text, invented facts), say so in your TLDR.
6. **Publish:** `node scripts/bold_rounds.js review N` (cockpit review with blind, context and, if both pass, "integrar ambas"; before/after media). Tell the user:
   `Ronda N lista en el cockpit: npm run cockpit → http://localhost:7788. Vota a favor de UNA opción (ciega, contexto o integrar) y guarda.`
   Then give a 3-line TLDR: what each variant changed (category + one sentence) and which one you would pick and why.
7. **Checkpoint.** Wait for the vote: `node scripts/bold_rounds.js choice N` (or `node src/cockpit.js pending`). If the user said up front "sigue solo" / unattended, you may pick yourself with `apply N <variante> --auto`; the helper forces a pause after `pause_every` such rounds.
   - If the user chose "integrar": spawn one Agent that copies `rounds/NNN/context/` to `rounds/NNN/integrada/` and merges in the chosen parts of `blind/` per the user's comment, writing its own `notes.md`; then run `after N` and show it before applying.
8. **Apply the choice to the working copy** (seeds round N+1; the real target stays untouched):
   `node scripts/bold_rounds.js apply N <blind|context|integrada>`
   Then update `rounds/DESIGN.md` (max 15 lines): direction the user validated, what they rejected, categories already used. Mark the feedback processed: `node src/cockpit.js done <review_id>`.
9. Continue with N+1 until the cap. At the end, or whenever the user says "aplicar":
   `node scripts/bold_rounds.js changes` (lista qué archivos del original cambiarían)
   Show the list, confirm once, then copy those files from `rounds/working/` to the real target with Read/Write. Never copy without that explicit "aplicar".

## Stop conditions

- Both variants rejected in a round: stop and tell the user `Esta ronda no produjo un cambio visible en ninguna variante. ¿Cambiamos el objetivo o paramos aquí?`
- The user votes down every option twice in a row: stop and ask what direction they want.
- Cap reached: summarize the evolution (round, category, chosen variant) in 5 lines max and offer "aplicar".

## Choosing method A vs B

- A (Agent tool) is the default: works on Windows with no extra flags, runs in parallel, the user sees progress, and a subagent only knows its prompt, so blind is truly blind.
- B (`claude -p`) is for long unattended runs (e.g. 8 rounds overnight with `--auto`). Each variant is a fresh process with edits limited to its folder (`--permission-mode acceptEdits`). Caveat: it still loads the user's global and project CLAUDE.md, a small amount of shared context.
- The official `ralph-loop` plugin is NOT used: it repeats the same prompt inside one session (context accumulates, so no blind variant) and its stop hook is a bash script.

## Anti-patterns

- Summarizing the history into the blind prompt "to help it". That kills the comparison.
- Shipping invisible changes (refactors, meta tags) as a round.
- Long text dumps instead of the cockpit review.
- Touching the original target before "aplicar".
- Several bold changes in one variant: harder to judge, harder to roll back.
