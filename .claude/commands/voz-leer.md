---
description: Lee la última respuesta de Claude con OpenAI TTS — one-shot, no cambia el modo
---

El usuario quiere escuchar la última respuesta de Claude. Hazlo así:

1. Lee `memory/voice-mode-state.json` para obtener `voice`, `model`, `speed` y `cache_dir`. Si no existe el archivo, usa defaults: `voice=nova`, `model=tts-1`, `speed=1.0`.
2. Toma el contenido textual de **tu última respuesta visible** en este turno previo (la que el usuario quiere escuchar). Si no hay respuesta previa de Claude en el contexto, avisa "No tengo una respuesta previa para leer en este turno" y termina.
3. Aplica strip de bloques de código: reemplaza cualquier ` ``` ... ``` ` por "[bloque de código omitido]" y limpia espacios redundantes. Si después del strip el texto queda en menos de 50 chars, avisa "Respuesta demasiado corta para leer" y termina.
4. Invoca `node scripts/voice_tts.js` con flags:
   ```
   node scripts/voice_tts.js --text "<respuesta limpia, escapada>" --voice <voice> --model <model> --speed <speed>
   ```
   Pasa el texto entre comillas dobles, escapa comillas internas con `\"`. Si el texto contiene caracteres especiales que romperían la línea de comando, escríbelo a un archivo temporal y usa `--file <tmpfile>` en su lugar.
5. **No cambies el state.** Este comando es one-shot: si el modo voz estaba off, sigue off; si estaba on, sigue on.
6. Confirma al usuario que el audio se está reproduciendo. Si el script retornó error, muestra el mensaje accionable que dio (típicamente API key faltante o cuota).

NUNCA leas la transcripción del usuario, solo respuestas previas de Claude. Si no hay nada previo, frena.
