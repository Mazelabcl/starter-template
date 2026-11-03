---
description: Abre la página de uso en el cockpit (tokens gastados, módulos usados y nunca usados). Medirlo no gasta tokens.
allowed-tools: Bash
---

Aldot lanzó `/uso`. Corre solo esto, sin leer transcripciones ni analizar nada por tu cuenta:

```
node src/cockpit.js open uso
```

Responde en una línea: "Te abrí el uso en el navegador." Si el comando falla, corre `node src/uso.js` y muéstrale solo el total y los 3 mayores gastos.
