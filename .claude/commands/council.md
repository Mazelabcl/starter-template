---
description: Convoca un council de expertos (CTO, devops, PM, usuario novato...) que fusiona sus perspectivas en una propuesta mejorada. Sin argumentos lista plantillas; con texto propone el council adecuado.
allowed-tools: Bash, Read, Edit
---

El usuario lanzó `/council` con argumento: "$ARGUMENTS".

Follow the `council` skill (`.claude/skills/council/SKILL.md`). Dispatch:

- **Empty argument:** run `node src/council.js list`, show the templates in 1 line each, and ask (in Spanish): `¿Para qué decisión lo quieres? Cuéntamela en una frase y te propongo el council.`
- **Argument starts with a template id** (e.g. `nueva-funcionalidad ¿X o Y?`): treat the rest as the question, show the cost with `--dry-run`, ask `¿Lo corro?`, then run it as the skill says.
- **Any other text:** it is the task. Run `node src/council.js suggest "$ARGUMENTS"`, show the proposal line it prints and wait for a yes before running.

Rules: Spanish neutro, no voseo. Never run multimodel or anything over USD 0.50 without explicit OK. Never dump the raw JSON; give the 5-line TLDR and point to the cockpit review.
