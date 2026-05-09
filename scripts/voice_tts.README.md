# voice_tts — TTS de respuestas largas

Script standalone que convierte texto en audio MP3 usando OpenAI TTS, lo cachea localmente, y lo reproduce con el player default del sistema. Sprint 4.6 del starter v3 (Voz Nivel 2).

## Uso CLI

```bash
# Texto inline
node scripts/voice_tts.js --text "hola, esto es una prueba"

# Desde archivo
node scripts/voice_tts.js --file respuesta.txt --voice onyx --speed 1.2

# Solo guardar, sin reproducir
node scripts/voice_tts.js --text "..." --output salida.mp3 --no-play

# Limpiar cache
node scripts/voice_tts.js --clear-cache

# Ayuda completa
node scripts/voice_tts.js --help
```

También vía npm: `npm run voz -- --text "hola"`.

## Flags principales

| Flag | Default | Detalle |
|---|---|---|
| `--text` / `--file` | — | Fuente del texto (mutuamente exclusivos). |
| `--voice` | `nova` | `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. |
| `--model` | `tts-1` | `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`. |
| `--speed` | `1.0` | 0.25 a 4.0. |
| `--output` | (cache) | Path donde guardar el MP3 final. |
| `--no-play` | (off) | Solo guarda, no reproduce. |
| `--chunk-size` | `2000` | Chars por chunk para latencia menor. |
| `--clear-cache` | — | Limpia el cache y sale. |

## Integración con la skill voice-mode

La skill `.claude/skills/voice-mode/SKILL.md` orquesta el uso:

- `/voz-on` activa modo voz: respuestas largas (>500 chars) se reproducen automáticamente.
- `/voz-off` lo desactiva.
- `/voz-leer` lee la última respuesta one-shot.

El estado vive en `memory/voice-mode-state.json` y persiste entre sesiones. La skill llama a este script internamente.

## Comparación de modelos

| Modelo | Latencia (1000 chars) | Calidad | Costo / 1k chars |
|---|---|---|---|
| `tts-1` | ~3-5s | Estándar — clara, natural en español | ~USD 0.015 |
| `tts-1-hd` | ~6-10s | Premium — más matiz, mejor entonación | ~USD 0.030 |
| `gpt-4o-mini-tts` | ~4-6s | Variable — más expresivo, menos predecible | ~USD 0.015 |

**Recomendación:** `tts-1` para uso diario. `tts-1-hd` solo cuando Aldo va a escuchar algo largo y la calidad importa.

## Costos esperados

Una respuesta típica de Claude (1500 chars) cuesta ~USD 0.022 con `tts-1`. Una sesión normal de 8-12 respuestas largas: USD 0.20 a 0.50, antes de cache.

El cache es agresivo: el mismo texto + voz + modelo + speed = mismo MP3 reutilizado. Re-escuchar una decisión 5 veces cuesta como una.

## Cache

- Ubicación default: `.cache/voice/` (relativa al repo).
- Cambiar con `--cache-dir <path>`.
- Filename: `sha256(voice|model|speed|format|text).mp3` (truncado a 32 hex).
- Limpiar: `node scripts/voice_tts.js --clear-cache` (o borrar el directorio a mano).
- El cache crece linealmente. Limpiar cuando supere unos cientos de MB.

## Reproducción por plataforma

- **Windows**: `start "" "<file>"` — abre con la app default (Windows Media Player, Groove, lo que sea).
- **macOS**: `afplay <file>`.
- **Linux**: prueba `mpg123 -q`, luego `aplay -q`, luego `ffplay -nodisp -autoexit -loglevel quiet`.
- Si nada funciona: el archivo queda en cache y se loguea el path para reproducción manual.

## Errores comunes

- `OPENAI_API_KEY no encontrada` → corre `npm run setup` o `/setup-openai`.
- `OpenAI rechazó la API key` → key inválida o expirada en `.env`.
- `OpenAI rechazó la petición (400)` → texto malformado o modelo/voice inválidos.
- `429` → rate limit; el script reintenta 3 veces con backoff.

## Versión

v0 — 2026-05-09. Cero deps nuevas (fetch nativo + child_process + crypto).
