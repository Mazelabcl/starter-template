---
name: image-explorer
description: Explora un mismo prompt en 3-4 modelos de imagen distintos en paralelo (gpt-image-2, FLUX, Imagen 3, Ideogram, Recraft, SD 3.5) y arma una grilla HTML para comparar la "mano" de cada uno antes de comprometerse. Útil cuando importa el estilo del modelo (concept art, branding, ilustración). Triggers "/image-explorer", "explora este prompt en varios modelos", "compara distintas manos", "qué modelo da mejor X".
allowed-tools: Bash, Read
---

# image-explorer — comparador multi-modelo de generación de imagen

**Skill complementaria a `image-gen`.** Mientras `image-gen` ya está calibrada para gpt-image-2 con identity lock, este explorador te deja probar el mismo prompt en N modelos para elegir cuál se siente mejor para un proyecto antes de comprometerte con una serie.

## Cuándo usar

- **Concept art** donde el estilo importa más que la precisión.
- **Branding / logos** donde la mano del modelo cambia mucho el resultado.
- Cuando **no estás seguro qué modelo da mejor X** (ej. fotografía vs ilustración vs vector).
- **Antes de comprometerte** con un modelo para una serie de N imágenes — gastar $0.20 explorando ahorra horas si el modelo elegido era el equivocado.
- Cuando el cliente pide "muéstrame opciones de estilo".

## Cuándo NO usar

- Cuando **ya sabes qué modelo quieres** — es desperdicio de tokens y dinero.
- Para imágenes con **identity lock fuerte** (references de personaje) — gpt-image-2 ya está calibrado para eso, usa la skill `image-gen`.
- Cuando **el costo te importa** y solo necesitas 1 imagen aceptable — pídele directo a flux-schnell o gpt-image-2 medium.
- Para **iteración fina** sobre 1 imagen ya elegida — no gana nada explorar otros modelos en esa fase.

## Cómo invocar

### CLI (recomendado para uso desde terminal)

```bash
# Exploración default (4 modelos, 1 imagen cada uno)
node src/image_explorer.js \
  --prompt "A jade-and-amber neon-lit alley at night, cinematic" \
  --models "gpt-image-2,flux-1.1-pro,imagen-3,ideogram-v2" \
  --output "content/explorations/test-1"

# Solo draft barato (1 modelo, 4 variantes con seeds distintos no soportado nativo —
# si quieres variantes pasa --count 3, mismo prompt 3 veces)
node src/image_explorer.js --prompt "..." --models "flux-schnell" --count 3

# Listar catálogo
node src/image_explorer.js list

# Marcar ganador después de revisar grid.html
node src/image_explorer.js pick "content/explorations/test-1" "flux-1.1-pro"
```

### Programático (desde otro script Node)

```javascript
import explorer from './src/image_explorer.js';

const result = await explorer.explore({
  prompt: "...",
  models: ['gpt-image-2', 'flux-1.1-pro', 'imagen-3', 'ideogram-v2'],
  count: 1,
  output_dir: 'content/explorations/<timestamp>',
  options: { aspect_ratio: '16:9', seed: 12345 },
  onProgress: (ev) => console.log(ev.type, ev.model || '', ev.error || ''),
});
console.log(`OK: ${result.summary.successes}/${result.summary.total_jobs}`);
```

## Modelos disponibles

| Modelo | Provider | Costo/img | Mejor para |
|---|---|---|---|
| `gpt-image-2` | OpenAI | $0.04 | Identity lock, references, edits, control alto. |
| `flux-1.1-pro` | Replicate | $0.04 | Fotorrealismo brutal, anatomía limpia, manos correctas. |
| `flux-schnell` | Replicate | $0.003 | Draft barato, shotlist masivo, prototipo rápido. |
| `imagen-3` | Replicate | $0.05 | Composición rica, fotografía natural, luz cinematográfica. |
| `ideogram-v2` | Replicate | $0.05 | Texto en imagen (carteles, logos, tipografía). |
| `recraft-v3` | Replicate | $0.04 | Branding, ilustración vectorial, design system. |
| `sd-3.5-large` | Replicate | $0.03 | Balance precio/calidad, base sólida open-source. |

## Setup previo

1. **OPENAI_API_KEY** en `.env` (para gpt-image-2). Ya lo configura `npm run setup`.
2. **REPLICATE_API_TOKEN** en `.env` (opcional). Si no está, gpt-image-2 sigue funcionando solo. Sácalo en [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens). Una sola key da acceso a FLUX, Imagen 3, Ideogram, Recraft, SD.
3. Para gpt-image-2: Python venv (`npm run setup-python`).

Si falta una key, los modelos que la requieren se **skipean automáticamente** con razón clara — la exploración sigue con los demás.

## Estructura del output

```
content/explorations/<timestamp>/
├── index.json          # estructurado para dashboard
├── grid.html           # grilla standalone (CSS embebido)
├── gpt-image-2.png
├── flux-1.1-pro.png
├── imagen-3.jpg
├── ideogram-v2.png
├── winner.png          # solo si corriste `pick`
├── winner.json         # solo si corriste `pick`
```

Abre `grid.html` directo en el navegador (no necesita server). Cada celda muestra el modelo, costo, tiempo, y un botón "Usar esta" que te indica el comando CLI exacto para fijar el ganador.

## Tips para escribir prompts cross-modelo

Los modelos tienen sintaxis y sensibilidades distintas. Para comparar **justo**:

1. **Usa lenguaje neutral, no específico de un modelo.** Evita tags estilo Midjourney (`--ar`, `--style`) o slangs de SD (`masterpiece, best quality`). Escribe en inglés natural.
2. **Sé concreto sobre composición y luz**, no solo sobre tema. Todos los modelos responden mejor.
3. **Especifica aspect ratio fuera del prompt** vía `--aspect`, no en el texto.
4. **Para texto en imagen:** menciona el texto entre comillas. Solo Ideogram lo va a hacer bien — vas a ver claro la diferencia.
5. **Para branding/vector:** Recraft brillará. Otros van a tirar fotorrealismo.
6. **Si quieres comparar identity lock:** este NO es el explorador correcto. Usa `image-gen` con references — solo gpt-image-2 lo hace bien.

### Ejemplo de prompt cross-modelo bueno

```
A misty mountain temple at dawn, low-angle shot looking up, warm
golden light filtering through cedar branches, faint figure in robes
walking up stone steps, painterly atmosphere, shallow depth of field.
```

Funciona en los 5 modelos. Compara: cuál te da el "alma" del shot.

### Ejemplo MALO

```
masterpiece, ultra-detailed, 8k, --ar 16:9 --style raw, cinematic lighting,
trending on artstation
```

Eso es lenguaje Midjourney/SD. Imagen 3 e Ideogram lo interpretan como tema literal y meten texto basura.

## Costos de exploración típica

| Combo | Costo |
|---|---|
| Solo draft (1× flux-schnell) | $0.003 |
| 4 modelos × 1 img (gpt-image-2 + flux-1.1-pro + imagen-3 + ideogram-v2) | ~$0.18 |
| 5 modelos × 1 img (incluye recraft-v3) | ~$0.22 |
| 4 modelos × 3 imgs cada uno | ~$0.54 |
| Todos los 7 × 1 img | ~$0.27 |

El explorer **te avisa antes** si la exploración va a costar > $0.50.

## Reglas duras

1. **No usar para identity lock** — eso es de `image-gen` con gpt-image-2.
2. **Después de elegir ganador, valida con `multimodal-validation`** sobre el `winner.png`.
3. **Tiempo total** depende del modelo más lento (paralelismo). Imagen 3 a veces tarda 30-60s. Si tienes prisa, omítelo.
4. **Output siempre a `content/explorations/<timestamp>/`** para portabilidad. Si pasas `--output` custom, asegúrate de que sea relativo al repo.
5. **Reporta modelo ganador en tu respuesta al usuario** (`flux-1.1-pro` o `gpt-image-2`, etc.). Igual que con `image-gen`.

## Limitaciones conocidas

- No soporta references / edit en este explorer. Si necesitas referencias visuales, usa `image-gen` (gpt-image-2 con identity lock).
- `count > 1` con mismo prompt no varía el seed automáticamente — todos los outputs del mismo modelo pueden salir parecidos. Para diversidad, llama N veces con seeds distintos (programáticamente).
- Recraft y otros modelos cambian su API en Replicate cada tanto. Si un modelo falla con 422, revisa el catálogo `MODELS_IMG.input_builder` y ajusta los inputs.

## Versión

v0 — 2026-05-09
