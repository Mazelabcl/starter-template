---
name: voice-mode
description: Reproduce respuestas largas de Claude por voz usando OpenAI TTS. Útil cuando trabajas en otra cosa o cuando una respuesta larga se procesa mejor escuchándola. Triggers "/voz-on", "/voz-off", "/voz-leer", "lee esta respuesta", "modo voz".
allowed-tools: Read, Write, Bash
---

# voice-mode — TTS de respuestas largas con OpenAI

Voz Nivel 2 del starter v3. Convierte el texto de respuestas largas en audio con OpenAI TTS y lo reproduce localmente. Pensado para que escuches mientras haces otra cosa, repases decisiones complejas caminando, o proceses una respuesta densa sin estar pegado a la pantalla.

Sprint 4.5 (Nivel 1) cubre el input por voz (Win+H gratis del sistema operativo). Esta skill cubre el output.

## Cuándo activar

- **Respuestas largas (>500 chars)** que prefieres escuchar en lugar de leer.
- **Trabajas en otra ventana** mientras Claude analiza, planea o revisa.
- **Repasar decisiones complejas** mientras caminas, manejas o haces otra tarea.
- **Lectura final de un brief** antes de aceptarlo, para escuchar si suena bien en voz alta.

## Cuándo NO activar

- Respuestas cortas (<500 chars) — la latencia + costo no compensan.
- Respuestas que son mayoritariamente código, JSON, configs, paths o tablas — TTS los lee mal.
- Respuestas con estructuras visuales (diagramas ASCII, mermaid, comparativas en columnas).
- Sesiones de debug con mucho ida-y-vuelta corto.

## Cómo se invoca

| Comando | Efecto |
|---|---|
| `/voz-on` | A partir de ahora todas las respuestas con más de `auto_threshold_chars` (default 500) se reproducen automáticamente. |
| `/voz-off` | Vuelve al modo silencioso. |
| `/voz-leer` | Lee la última respuesta de Claude (one-shot, no cambia el modo). |

El estado se persiste en `memory/voice-mode-state.json` para sobrevivir entre sesiones. Si el archivo no existe, los comandos lo crean con los defaults.

## Cómo funciona internamente

Cuando esta skill está activa y Claude termina una respuesta:

1. Lee `memory/voice-mode-state.json` para obtener `enabled`, `voice`, `model`, `speed` y `auto_threshold_chars`.
2. Si `enabled === false`: no hace nada.
3. Si `enabled === true` y la respuesta supera el threshold:
   - Aplica `stripCodeBlocks` para excluir bloques ` ``` ... ``` ` del texto que va a TTS (TTS lee código pésimo).
   - Si después del strip queda menos del threshold, no reproduce.
   - Invoca `node scripts/voice_tts.js --text "<contenido limpio>"` con los parámetros del state.
   - El script chunka el texto, llama OpenAI TTS, cachea por sha256, y reproduce con el player default del sistema.

## Configuración

Defaults en `memory/voice-mode-state.json`:

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

| Campo | Detalle |
|---|---|
| `voice` | `nova` (cálida, neutral, buena en español), `onyx` (grave masculina), `shimmer` (suave femenina), `alloy` (neutra), `echo` (neutra masculina), `fable` (narrativa). |
| `model` | `tts-1` (rápido, calidad estándar, default), `tts-1-hd` (más calidad, ~2x latencia y costo), `gpt-4o-mini-tts` (alternativa nueva). |
| `speed` | 0.25 a 4.0. Default 1.0. Aldo a veces sube a 1.15-1.3 para escuchar más rápido. |
| `auto_threshold_chars` | Por debajo de este número de chars, no se reproduce automáticamente aunque `/voz-on` esté activo. Evita TTS para respuestas cortas. |
| `skip_code_blocks` | Si `true`, los bloques ` ``` ` se reemplazan por "[bloque de código omitido]" antes de TTS. |
| `cache_dir` | Donde se guardan los MP3s. Cache persiste entre sesiones — texto idéntico no re-paga. Limpiar con `node scripts/voice_tts.js --clear-cache`. |

Para cambiar valores: editar el JSON manualmente o pasar flags en `/voz-on --voice onyx --speed 1.2` (la skill los persiste al state).

## Costos

Tabla de costo aproximado por longitud de respuesta:

| Chars | tts-1 | tts-1-hd |
|---|---|---|
| 500 | ~USD 0.0075 | ~USD 0.015 |
| 1000 | ~USD 0.015 | ~USD 0.030 |
| 2000 | ~USD 0.030 | ~USD 0.060 |
| 5000 | ~USD 0.075 | ~USD 0.150 |
| 10000 | ~USD 0.150 | ~USD 0.300 |

**Estimación por sesión típica de Aldo** (8-12 respuestas largas, ~1500 chars promedio, modelo `tts-1`): **USD 0.20 a 0.50 por sesión**, antes de cache hits. Con cache (re-escuchar la misma decisión), el costo real baja a la mitad o menos.

Para sesiones muy largas: considerar `tts-1` (no hd) para mantener costo bajo. La diferencia de calidad es notable solo si Aldo se queda escuchando un rato.

## Anti-patrones

1. **No activar para respuestas cortas.** El threshold de 500 chars existe por algo — bajarlo gasta credits sin mejorar UX.
2. **No activar para respuestas con código denso.** TTS lee `function getFoo()` como "function get foo open paren close paren" — molesto. La skill ya hace strip de bloques ` ``` `, pero si la respuesta es 90% código no compensa.
3. **No activar para tablas / diagramas / paths.** Mejor lectura visual.
4. **No subir `speed` arriba de 1.5 sin probar.** A 2.0 ya cuesta entender en español.
5. **No activar `tts-1-hd` por default.** Solo si Aldo explícitamente pide más calidad. La latencia es notable.
6. **No usar voz `fable` para respuestas técnicas.** Fable suena narrativa, queda raro leyendo briefs de código.
7. **No olvidar limpiar cache periódicamente.** El directorio puede crecer mucho. `--clear-cache` cuando supere unos cientos de MB.

## Próximamente — Voz Nivel 3

- **Sesión de voz dedicada** (Whisper STT loop con Claude API + TTS) → v3.5. Conversación continua sin teclado.
- **Realtime API** (audio bidireccional baja latencia) → v3.5+. Cuando esté estable y con costo razonable.

Estas dos viven en backlog del v3-plan, no en este sprint.

## Versión

v0 — 2026-05-09 (Sprint 4.6 — Voz Nivel 2)
