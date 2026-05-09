# image_explorer — comparador multi-modelo de generación de imagen

**Sprint 5.1 v3 del starter template Mazelab.**

Explora un mismo prompt en N modelos de imagen (gpt-image-2, FLUX, Imagen 3, Ideogram, Recraft, SD 3.5) en paralelo y arma una grilla HTML para comparar la "mano" de cada uno antes de comprometerte con uno para una serie.

## Quickstart

```bash
# 1. Setup keys (1 vez)
npm run setup
#   → te pide OPENAI_API_KEY (gpt-image-2) y REPLICATE_API_TOKEN (resto, opcional).

# 2. Explora un prompt en 4 modelos
node src/image_explorer.js \
  --prompt "A jade-and-amber neon-lit alley at dawn, cinematic" \
  --models "gpt-image-2,flux-1.1-pro,imagen-3,ideogram-v2"

# 3. Abre grid.html en el navegador (no necesita server)
#    El explorer te imprime el path exacto.

# 4. Marca el ganador
node src/image_explorer.js pick "content/explorations/<timestamp>" "flux-1.1-pro"
#    Crea winner.png + winner.json en el directorio.
```

## API programática

```javascript
import explorer from './src/image_explorer.js';

const result = await explorer.explore({
  prompt: "...",
  models: ['gpt-image-2', 'flux-1.1-pro', 'imagen-3', 'ideogram-v2'],
  count: 1,                                      // imágenes por modelo
  output_dir: 'content/explorations/run-1',     // opcional
  options: {
    aspect_ratio: '16:9',                        // 1:1 | 16:9 | 9:16 | 4:3 | 3:4
    seed: 12345,                                 // opcional, donde el modelo lo soporte
  },
  onProgress: (event) => {
    // event.type: 'plan' | 'cost_warning' | 'start' | 'done' | 'finished'
    console.log(event);
  },
});

console.log(`OK: ${result.summary.successes}/${result.summary.total_jobs}`);
console.log(`Costo: $${result.summary.total_cost_usd_estimated}`);
```

## Catálogo de modelos (`MODELS_IMG`)

| ID | Provider | Costo/img | Capabilities | Mejor para |
|---|---|---|---|---|
| `gpt-image-2` | OpenAI | $0.04 | identity_lock, references, edit | Personajes consistentes, edición con refs. |
| `flux-1.1-pro` | Replicate | $0.04 | photorealism, anatomy_clean, detail | Fotorrealismo, anatomía, manos. |
| `flux-schnell` | Replicate | $0.003 | draft, fast, cheap | Draft barato, shotlist masivo. |
| `imagen-3` | Replicate | $0.05 | photography, composition | Composición rica, luz natural. |
| `ideogram-v2` | Replicate | $0.05 | text_in_image, typography | Texto en imagen (carteles, logos). |
| `recraft-v3` | Replicate | $0.04 | branding, vector, illustration | Branding, vector, design system. |
| `sd-3.5-large` | Replicate | $0.03 | general, flexible | Balance precio/calidad. |

## Diseño

### Por qué Replicate como router único

Replicate da acceso a **FLUX, Imagen 3, Ideogram, Recraft, SD 3.5** y muchos más con **una sola API key** (`REPLICATE_API_TOKEN`). Esto evita pedirle al usuario 4-5 keys distintas. Para gpt-image-2 mantenemos el camino directo vía OpenAI (script Python existente con identity lock + batch async).

Setup total: **2 API keys** (`OPENAI_API_KEY` + `REPLICATE_API_TOKEN`).

### Manejo de fallos parciales

Si un modelo falla en una exploración de 4, los **otros siguen normal**. El index.json registra el fallo (`ok: false, error: "..."`) y la grilla HTML lo muestra como celda con "FALLO" para que veas qué pasó. Solo si TODOS fallan, el comando exit 1.

Si falta una API key, los modelos que la requieren se **skipean automáticamente** con razón clara — los demás corren igual. No falla la exploración entera.

### Estructura del output

```
content/explorations/<timestamp>/
├── index.json          # estructurado, parseable
├── grid.html           # standalone, abrible en navegador sin server
├── gpt-image-2.png
├── flux-1.1-pro.png
├── imagen-3.jpg
├── ideogram-v2.png
├── winner.png          # solo si corriste `pick <model>`
└── winner.json         # solo si corriste `pick <model>`
```

### Formato `index.json`

```json
{
  "version": 1,
  "created_at": "2026-05-09T10:30:00.000Z",
  "prompt": "...",
  "options": { "aspect_ratio": "16:9" },
  "output_dir": "/abs/path",
  "models_requested": [...],
  "models_run": [...],
  "models_skipped": [{ "model": "...", "reason": "..." }],
  "count_per_model": 1,
  "parallelism": 4,
  "results": [
    {
      "ok": true,
      "model": "flux-1.1-pro",
      "provider": "replicate",
      "path": "...",
      "filename": "flux-1.1-pro.png",
      "bytes": 234567,
      "cost_usd": 0.04,
      "elapsed_ms": 8240,
      "raw": { "metrics": {...} }
    }
  ],
  "summary": {
    "total_jobs": 4,
    "successes": 4,
    "failures": 0,
    "total_cost_usd_estimated": 0.18,
    "wall_time_ms_max": 12340
  }
}
```

El dashboard puede consumir esto directo sin parseo custom — los campos están estables.

## Tips para prompts cross-modelo

Los modelos tienen sensibilidades distintas. Para comparar **justo**:

1. **Lenguaje neutral**, no específico de un modelo. Evita tags Midjourney (`--ar`) o slangs SD (`masterpiece, best quality`).
2. **Concreto sobre composición y luz**, no solo sobre tema.
3. **Aspect ratio vía `--aspect`**, no en el texto.
4. **Texto en imagen entre comillas** — solo Ideogram lo hace bien, ahí ves la diferencia.

### Bueno

```
A misty mountain temple at dawn, low-angle shot looking up, warm golden light
filtering through cedar branches, faint figure in robes walking up stone steps,
painterly atmosphere, shallow depth of field.
```

### Malo

```
masterpiece, ultra-detailed, 8k, --ar 16:9 --style raw, cinematic lighting,
trending on artstation
```

## Costos de exploración típica

| Combo | Costo |
|---|---|
| Solo draft (1× flux-schnell) | $0.003 |
| 4 modelos × 1 img (default) | ~$0.18 |
| 5 modelos × 1 img | ~$0.22 |
| 4 modelos × 3 imgs | ~$0.54 |
| 7 modelos × 1 img | ~$0.27 |

El explorer **te avisa** si la exploración va a costar > $0.50.

## Tests

```bash
node image-explorer.test.js
```

6 tests:
1. Catálogo MODELS_IMG estructurado.
2. validateKeys lanza error claro si falta key.
3. compareGrid genera HTML válido.
4. pickWinner copia archivos correctamente.
5. (live) flux-schnell genera PNG > 50KB. SKIP si no hay REPLICATE_API_TOKEN.
6. (live) gpt-image-2 vía Python genera PNG > 50KB. SKIP si no hay OPENAI_API_KEY.

## Limitaciones conocidas

- **Sin references / edit en este explorer.** Para identity lock con references usa `image-gen` (gpt-image-2 directo).
- **`count > 1` no varía seeds automáticamente.** Outputs del mismo modelo pueden salir parecidos. Para diversidad, llama N veces con seeds distintos.
- **APIs Replicate cambian.** Si un modelo falla con 422, revisa `MODELS_IMG[<id>].input_builder` y ajusta los inputs según docs actuales del modelo en replicate.com.
- **Imagen 3** a veces tarda 30-60s. El paralelismo absorbe pero el wall time queda dominado por el más lento.
- **Tier OpenAI** de gpt-image-2 puede rate-limitearte si combinas con batches del image-gen al mismo tiempo. El explorer no rate-limita; bajá `--count` si pasa.

## Versión

v0 — 2026-05-09 (Sprint 5.1 v3)
