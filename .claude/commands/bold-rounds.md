---
description: Rediseño audaz por rondas sobre una COPIA (web, proyecto, feature o documento). Cada ronda compara una variante ciega y una con contexto en el cockpit; tú eliges. Uso /bold-rounds <objetivo> [N rondas].
allowed-tools: Bash, Read, Edit, Write, Agent
---

El usuario lanzó `/bold-rounds` con argumento: "$ARGUMENTS".

Follow the `bold-rounds` skill (`.claude/skills/bold-rounds/SKILL.md`). Dispatch:

- **Empty argument:** ask (in Spanish): `¿Qué quieres mejorar por rondas? Dame la carpeta, archivo o URL, el objetivo en una frase y cuántas rondas (por defecto 3).`
- **Argument present:** the first path/URL is the target; a trailing integer is N (default 3, max 10); the rest is the goal. Run `init`, then round 1 as the skill says (method A: two parallel Agent calls with the prompt files verbatim).

Rules: Spanish neutro, no voseo. Work only on the copy in `rounds/`. Never touch the real target until the user says "aplicar". Show results in the cockpit, not as a wall of text: after publishing each round, run `node src/cockpit.js open <review_id>` yourself and tell the user "Te abrí el cockpit en el navegador".
