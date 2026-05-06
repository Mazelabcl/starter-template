---
description: Configura la API key de OpenAI (gpt-image-2) de forma interactiva
---

El usuario quiere configurar su API key de OpenAI para usar gpt-image-2. Hazlo así:

1. Pregúntale: "Pega tu OpenAI API key (formato sk-proj-...). Si no tienes, sácala en https://platform.openai.com/api-keys"
2. Antes, recuérdale verificar que su org tenga acceso a `gpt-image-2`:
   - `https://platform.openai.com/settings/organization/general` → debe decir Individual Approved + Business Approved
   - `https://platform.openai.com/limits` → debe listar `gpt-image-2`
3. Cuando responda con la key, valida que empiece con "sk-proj-" (si no, advierte pero acepta)
4. Lee el archivo `.env` (si no existe, créalo). Actualiza o agrega la línea `OPENAI_API_KEY=<key>`. NO toques otras líneas.
5. Confirma con: "Guardado. Si Python ya está instalado, prueba con: `python scripts/openai_images.py generate \"un perro azul\" test.png --quality low`. Si Python no está, corre primero `npm run setup`."

NUNCA loguees la API key en consola ni en respuestas.
