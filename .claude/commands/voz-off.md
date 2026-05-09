---
description: Desactiva el modo voz — vuelve al modo silencioso
---

El usuario quiere desactivar el modo voz. Hazlo así:

1. Lee `memory/voice-mode-state.json`. Si no existe, no hay nada que desactivar — confirma "Modo voz ya estaba inactivo (no había state)" y termina.
2. Cambia `enabled` a `false`. **No toques** los demás campos (voice, model, speed, etc.) — el usuario probablemente quiere conservar su configuración para la próxima vez que active.
3. Escribe el JSON de vuelta (2 espacios de indent, newline final).
4. Confirma: "Modo voz desactivado. Tu configuración (voz: <voice>, modelo: <model>, speed: <speed>) quedó guardada para la próxima vez. Para reactivar: `/voz-on`."
5. **A partir de este punto**, no invoques `voice_tts.js` automáticamente al cerrar respuestas. El usuario puede seguir usando `/voz-leer` para one-shots.

NUNCA borres el archivo voice-mode-state.json. Solo cambia `enabled`.
