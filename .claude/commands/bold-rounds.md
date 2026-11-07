---
description: Rediseño o innovación de producto por rondas sobre una COPIA (web, proyecto, feature o documento). Cada ronda compara una variante ciega y una con contexto en el cockpit; tú eliges cuánto involucrarte. Uso /bold-rounds <objetivo> [N rondas] [producto] [auto|cada:N|todas].
allowed-tools: Bash, Read, Edit, Write, Agent
---

El usuario lanzó `/bold-rounds` con argumento: "$ARGUMENTS".

Follow the `bold-rounds` skill (`.claude/skills/bold-rounds/SKILL.md`). Dispatch:

- **Empty argument:** ask (in Spanish): `¿Qué quieres mejorar por rondas? Dame la carpeta, archivo o URL, el objetivo en una frase y cuántas rondas (por defecto 3).`
- **Argument present:** the first path/URL is the target; a trailing integer is N (default 3, max 10); the rest is the goal. Words like "producto"/"innova el producto" mean `--modo producto`; "auto", "cada N" or "todas" set `--involucramiento`. If the involvement or the models were not said, ask the involvement question and the model question (idea: Opus recommended; build: Sonnet recommended) from the skill ONCE before `init`. Run `init` without `--yes` to show the budget (tokens and % of the 5-hour window, plus the "keep the PC plugged in" warning), wait for a yes, rerun it with `--yes`, then round 1 as the skill says (method B: `run N --fondo` and `espera N`, never a single wait longer than 4 minutes).

Rules: Spanish neutro, no voseo. Work only on the copy in `rounds/`. Never touch the real target until the user says "aplicar". Show results in the cockpit, not as a wall of text: after publishing each round, run `node src/cockpit.js open <review_id>` yourself and tell the user "Te abrí el cockpit en el navegador". At the end, publish the summary page with `node scripts/bold_rounds.js resumen`. Always give absolute paths.
