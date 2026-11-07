---
description: Abre la página de uso en el cockpit (tokens gastados, módulos usados y nunca usados). Medirlo no gasta tokens.
allowed-tools: Bash
---

Aldot lanzó `/uso`. Corre solo esto, sin leer transcripciones ni analizar nada por tu cuenta:

```
node src/cockpit.js open uso
```

Responde en una línea: "Te abrí el uso en el navegador." Si el comando falla, corre `node src/uso.js` y muéstrale solo el total, los 3 mayores gastos y, si aparece, el aviso de "MCP que cargan en TODOS los proyectos" (con su ruta absoluta; no cambies su configuración).

Si pregunta cuánto cabe en la ventana de 5 horas: `node src/uso.js ventana --vivo --guardar` (una llamada mínima de ~1 K tokens; calibra con sus cortes reales por límite y lo deja para los presupuestos de bold-rounds y council).
