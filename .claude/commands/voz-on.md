---
description: Activa el modo voz — respuestas largas se reproducen automáticamente con OpenAI TTS
---

El usuario quiere activar el modo voz. Hazlo así:

1. Lee `memory/voice-mode-state.json`. Si no existe, créalo con los defaults:
   ```json
   {
     "enabled": false,
     "voice": "nova",
     "model": "tts-1",
     "speed": 1.0,
     "auto_threshold_chars": 500,
     "skip_code_blocks": true,
     "cache_dir": ".cache/voice"
   }
   ```
2. Cambia `enabled` a `true`. Si el usuario pasó flags inline (ej. `/voz-on --voice onyx --speed 1.2`), persiste también esos overrides en el JSON antes de escribir. Voces válidas: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. Modelos válidos: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`. Speed entre 0.25 y 4.0.
3. Escribe el JSON de vuelta a `memory/voice-mode-state.json` (formato bonito, 2 espacios de indent, newline final).
4. Confirma al usuario: "Modo voz activado. Voz: <voice>, modelo: <model>, speed: <speed>. Las respuestas con más de <auto_threshold_chars> caracteres se reproducirán automáticamente. Para desactivar: `/voz-off`. Para leer la última respuesta sin cambiar el modo: `/voz-leer`."
5. **A partir de este punto**, cuando termines cualquier respuesta posterior, antes de cerrar el turno revisa: si `enabled === true` y el texto plano de la respuesta (después de strip de bloques ` ``` `) supera `auto_threshold_chars`, invoca `node scripts/voice_tts.js --text "<respuesta>" --voice <voice> --model <model> --speed <speed>` en background. No bloquees al usuario por la latencia del TTS.

Si `OPENAI_API_KEY` no está en `.env`, avisa al usuario que corra `/setup-openai` primero — el modo voz necesita la key igual que `gpt-image-2`.

NUNCA inventes valores nuevos para campos que el usuario no pidió cambiar.
