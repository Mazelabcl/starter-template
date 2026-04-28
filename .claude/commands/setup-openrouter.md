---
description: Configura la API key de OpenRouter de forma interactiva
---

El usuario quiere configurar su API key de OpenRouter. Hazlo así:

1. Pregúntale: "Pega tu OpenRouter API key (formato sk-or-v1-...). Si no tienes, sácala en https://openrouter.ai/keys"
2. Cuando responda, valida que empiece con "sk-or-v1-" (si no, advierte pero acepta)
3. Lee el archivo `.env` (si no existe, créalo). Actualiza o agrega la línea `OPENROUTER_API_KEY=<key>`. NO toques otras líneas del .env.
4. Confirma con: "Guardado. Prueba con: `node src/research.js quick \"<una pregunta>\"`"

NUNCA loguees la API key en consola ni en respuestas.
