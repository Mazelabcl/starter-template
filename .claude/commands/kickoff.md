---
description: Entrevista corta para arrancar un proyecto y plan de batalla revisable en el cockpit (equipo, brazos, proceso, councils)
---

El usuario quiere arrancar un proyecto nuevo desde el starter. Invoca la skill `kickoff` y sigue su protocolo:

1. Una pregunta a la vez (máximo 5). Tono directo, novato-friendly, español neutro (cero voseo, cero regionalismos rioplatenses).
2. Al final arma el plan de batalla y publícalo en el cockpit (`plan.js build` + `node src/cockpit.js publish`). En el chat, solo el TLDR de 5 líneas y `npm run cockpit`.
3. No persistas nada ni arranques el Sprint 1 hasta aplicar el feedback del cockpit (`node src/cockpit.js pending`).
