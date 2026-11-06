---
description: Convoca un council de expertos (CTO, devops, PM, usuario novato...) que fusiona sus perspectivas en una propuesta mejorada. Sin argumentos lista plantillas; con texto propone el council adecuado.
allowed-tools: Bash, Read, Edit
---

El usuario lanzó `/council` con argumento: "$ARGUMENTS".

Follow the `council` skill (`.claude/skills/council/SKILL.md`). Dispatch:

- **Empty argument:** run `node src/council.js list`, show the templates in 1 line each, and ask (in Spanish): `¿Para qué decisión lo quieres? Cuéntamela en una frase y te propongo el council.`
- **Argument starts with a template id** (e.g. `nueva-funcionalidad ¿X o Y?`): treat the rest as the question, show the cost with `--dry-run`, ask `¿Lo corro?`, then run it as the skill says.
- **"arma tú el panel de expertos" (or similar):** you pick the experts; follow "Three ways to choose the experts" in the skill. Show the panel with its cost and wait for a yes.
- **"entrevista", "entrevista a la audiencia", "sin API" or "con agentes":** use the engine `agentes` from the skill (`node src/council.js prepare ...`, with `--formato entrevista` for interviews). Ask the involvement question once, propose the panel (3-5 coaches + audience) and wait for a yes.
- **Any other text:** it is the task. Run `node src/council.js suggest "$ARGUMENTS"`, show the proposal line it prints and wait for a yes before running.

Rules: Spanish neutro, no voseo. Never run multimodel or anything over USD 0.50 without explicit OK. Never dump the raw JSON; give the 5-line TLDR and open the cockpit review yourself with `node src/cockpit.js open <id>` (the user never opens a second terminal); then say "Te abrí el cockpit en el navegador".
