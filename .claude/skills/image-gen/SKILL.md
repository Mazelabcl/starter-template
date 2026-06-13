---
name: image-gen
description: Genera imágenes con gpt-image-2 aplicando IDENTITY LOCK + reglas de references + paralelismo agresivo. Triggers "genera imagen", "crea concept art", "render de", "/image-gen", batch de imágenes para un proyecto.
allowed-tools: Read, Write, Bash, Glob
---

# image-gen — wrapper gpt-image-2 con identity lock

**Skill central para cualquier output visual del proyecto.** Aplica todas las lecciones aprendidas (L2, L3, L4, L8 del manual).

## Cuándo invocarla

- "Genera una imagen de X"
- "Crea concept art / character render / scene render"
- Batch de N imágenes para un mismo proyecto (storyboard, set de assets, etc.)
- Cuando el usuario pide imágenes con personajes consistentes (identity lock)

## Cuándo NO invocarla

- Imágenes con stock / generación que no requiera consistency (usa generate_image directo sin identity lock).
- Edición de imágenes ya existentes que no son del proyecto (caso de uso fuera de scope).

## Selección de modelo (D13)

Hay 4 modelos pre-configurados, **todos con la misma firma** (`generate_image` / `edit_image`) y **las mismas reglas de referencia** (archivo real como ref, nunca descripción + guard mention-check "Image 1" + mimetype correcto). Cambia el script, no el patrón de uso.

| Modelo | Script | Precio aprox. | Fuerte en | Refs |
|---|---|---|---|---|
| **gpt-image-2** (default) | `scripts/openai_images.py` | ~$0.21 high / ~$0.04 medium | Máxima calidad con refs | file tuples |
| **FLUX.2 dev** | `scripts/replicate_images.py --model flux2-dev` | ~$0.012 (≈15x más barato) | Económico, acepta refs | `input_image`, `input_image_2`... |
| **Ideogram 3** | `scripts/replicate_images.py --model ideogram-v3` | ~$0.03 | Texto en imagen / diseño | `style_reference_images` (hasta 3) |
| **Nano Banana Pro** | `scripts/replicate_images.py --model nano-banana-pro` | ~$0.04 | Refs fuertes (hasta 14), consistencia de identidad | `image_input` (array, hasta 14) |

**Ruta de Nano Banana Pro = Replicate (no Gemini directo).** Se accede vía `scripts/replicate_images.py --model nano-banana-pro` (modelo `google/nano-banana-pro` en Replicate), con la misma firma y reglas que el resto. Requiere `REPLICATE_API_TOKEN`. Existe también `scripts/gemini_images.py` como **ruta alternativa opcional** para quien tenga `GEMINI_API_KEY` y prefiera la API de Gemini directa — pero la ruta canónica del starter es Replicate, porque ese es el token que el setup configura.

**Regla de presentación:** cuando se discuta generar imágenes, el orquestador **PRESENTA las opciones al usuario** antes de elegir:

> "Tenemos gpt-image-2 (mejor calidad, ~$0.21), FLUX.2 dev (15x más barato, ~$0.012, acepta refs), Ideogram 3 (texto en imagen, $0.03), Nano Banana Pro (refs fuertes hasta 14, ~$0.04). Recomiendo X para tu caso. ¿Cuál prefieres?"

— y **espera la elección**. Default **gpt-image-2** si el usuario no especifica y la calidad importa.

Todos respetan la misma regla de referencias: pasar el archivo real como ref (nunca describirlo en texto) + nombrar cada `Image N` en el prompt (guard `ValueError` si hay refs sin "Image 1"). FLUX, Ideogram y Nano Banana Pro corren por Replicate y requieren `REPLICATE_API_TOKEN`; la ruta alternativa `gemini_images.py` requiere `GEMINI_API_KEY` (o `GOOGLE_API_KEY`) — si falta el token correspondiente, el wrapper falla con mensaje claro de setup.

## Setup previo (verificar)

1. `OPENAI_API_KEY` presente en `.env` o `.env.local` (skill aborta si falta).
2. Python venv activado y `openai` instalado (lo hace `npm run setup`).
3. Si se usan references: paths a las imágenes existen.

## Cómo opera

### Caso A — Imagen única sin references

`openai` solo está instalado en el `.venv`. Usa el intérprete del venv, no el `python` del sistema: `.venv\Scripts\python.exe` en Windows, `.venv/bin/python` en Mac/Linux.

```bash
# Windows:
.venv\Scripts\python.exe scripts/openai_images.py generate "<prompt>" "<output_path>" --quality medium
# Mac/Linux:
.venv/bin/python scripts/openai_images.py generate "<prompt>" "<output_path>" --quality medium
```

### Caso B — Imagen con references (identity lock)

**REGLA L3 (no negociable):** cada `Image N` que pongas en el array DEBE estar mencionada en el texto del prompt. Si no, el modelo la ignora. Esto ahora es un **guardrail real**: `edit_image` lanza `ValueError` si cargas refs y el prompt no contiene "Image 1" (regex `Image\s*1`, case-insensitive). No es solo prosa.

```bash
# Windows:
.venv\Scripts\python.exe scripts/openai_images.py edit "<prompt con menciones explícitas a Image 1, 2, ...>" '["ref1.png","ref2.png"]' "<output_path>"
# Mac/Linux:
.venv/bin/python scripts/openai_images.py edit "<prompt con menciones explícitas a Image 1, 2, ...>" '["ref1.png","ref2.png"]' "<output_path>"
```

## REGLA DE ORO — `images.edit` trata las references POSICIONALMENTE

> Adaptada del proceso validado de Mazelab (~70 renders operacionales). Es la causa raíz de casi todos los fallos de fidelidad cuando se usan refs.

El modelo **NO lee nombres de archivo**. Las references llegan como un array y se referencian por su POSICIÓN: **Image 1, Image 2, Image 3, ...** según el ORDEN en que se pasan en `input_image_paths`. Si pasas `["foto_real.png", "canon_logo.png"]`, entonces "Image 1" = la foto real y "Image 2" = el canon del logo. Cambiar el orden cambia qué es cada Image N.

### Plantilla obligatoria del prompt con refs

```
<Tipo de imagen> of <sujeto>. Use the reference images:

- Image 1: shows <qué muestra>. Match EXACTLY <qué tomar de ahí: identidad / forma / proporciones>.
- Image 2: shows <qué muestra>. Use for <qué tomar: paleta / atmósfera / props>.
- Image 3: shows <qué muestra>. Use for <qué tomar>.

<Descripción espacial: izq/centro/der + dimensiones aproximadas en cm/m para que el modelo proporcione>.

<Estilo / fondo / luz canónica>.
```

### Anti-pattern crítico — NUNCA describir un objeto que ya existe como archivo

**NUNCA describas en texto un componente, personaje u objeto cuando existe el archivo de referencia.** Si describes "un tótem gris de 1.5m con pantalla táctil" en vez de pasar la foto real como `Image 1` y decir "Image 1: shows the totem, match EXACTLY", el modelo **aproxima** e inventa — se pierde el objeto real. La referencia visual siempre gana sobre la descripción textual.

### Qué NO hacer (lecciones del canon Mazelab)

- ❌ Describir componentes en texto cuando existe el archivo de referencia (pierdes el objeto real).
- ❌ Decir "match the canonical reference" sin indicar QUÉ Image N es el canon.
- ❌ Pasar 5+ imágenes con elementos competitivos — cuando hay sobrecarga el modelo aproxima en vez de copiar. Limita a 3-5 refs centrales.
- ❌ Over-spec de detalles sutiles (un "stepped L-profile" exagerado puede salir como escalera).
- ❌ Cargar una ref en el array sin nombrarla literal en el prompt (el guardrail ahora lo bloquea, pero la disciplina va primero).

### Qué SÍ hacer

- ✅ Pasar fotos reales / char sheets como `Image 1` cuando existen.
- ✅ Pasar canons de componentes como `Image 2, 3, ...` en orden estable.
- ✅ Nombrar cada `Image N` literal en el prompt con "shows X / match EXACTLY / use for Y".
- ✅ Indicar dimensiones aproximadas (cm/m) para que el modelo proporcione bien.
- ✅ Mantener 3-5 elementos centrales por prompt.

### Caso C — Batch paralelo (N imágenes independientes)

Crea un JSON `jobs.json`:

```json
[
  {
    "prompt": "...",
    "input_image_paths": ["refs/char_sheet.png"],
    "output_path": "content/output/scene_01.png",
    "size": "1024x1024",
    "quality": "medium"
  },
  {
    "prompt": "...",
    "output_path": "content/output/scene_02.png"
  }
]
```

```bash
python scripts/openai_images.py batch jobs.json --concurrent 8
```

**Concurrencia:**
- Default: 8 (seguro en cualquier tier).
- Tier alto OpenAI: subir a 15-20 con `--concurrent 15`.
- Si hay rate limit: bajar a 4-6.
- Var de entorno opcional: `OPENAI_IMAGE_CONCURRENCY=15` en `.env`.

## Plantilla de prompt con IDENTITY LOCK

Cuando hay personajes consistentes (REGLA L4):

```
[IDENTITY LOCK BLOCK]
The character in this scene must visually match Image 1 — exact same proportional language,
exact same facial structure, exact same costume design vocabulary, exact same color treatment.
[Anatomía clave si es no-humano: ej. ONE eye, ONE pupil, no two pupils, four fingers, etc.]

[SUBJECT BLOCK]
[descripción de pose, expresión, costume del momento]

[COMPOSITION BLOCK]
[plano, ángulo, regla compositiva, headroom]

[LIGHT + PALETTE BLOCK]
[fuente diegética, dirección, paleta canónica con HEX si aplica]

[STYLE / RENDER BLOCK]
The render is [stylized 3D / painterly / etc.]. NOT 2D, NOT painterly, NOT illustration.
[O lo que sea contra los anti-default del modelo].

[REFERENCE INTEGRATION]
Image 1 establishes IDENTITY LOCK. Image 2 provides [palette/atmosphere]. Image 3 [props/composition].

[NEGATIVE]
Do not include: [anatomía mal, accesorios no canónicos, render contrario, anime, photorealistic, etc.]
```

## Después de generar (OBLIGATORIO)

1. Invoca skill `multimodal-validation` por cada imagen generada.
2. Si FAIL → regenera con fixes específicos del validator. Máximo 3 intentos.
3. Si después de 3 intentos sigue FAIL → escala al orquestador con los 3 PNGs.

## Reglas duras

1. **L2 — Validation multimodal obligatoria.** Sin Read del PNG no hay PASS.
2. **L3 — Refs en texto del prompt.** Cada `Image N` mencionada explícitamente. Las refs son POSICIONALES (orden del array = Image 1, 2, 3...). `edit_image` lanza `ValueError` si hay refs y el prompt no nombra "Image 1".
3. **L4 — IDENTITY LOCK explícito** cuando hay personajes consistentes ("match exactly", "ONE eye", etc.).
4. **L8 — Paralelo cuando jobs son independientes.** No corras secuencial si no hay dependencia.
5. **Output a subcarpetas, no a paths dispersos.** Usa `content/output/<scene_or_asset>/` para portabilidad.
6. **Reporta modelo usado:** `gpt-image-2` o fallback `gpt-image-2-2026-04-21`.
7. **Nunca subas references al texto del prompt si no vas a mencionarlas.** Si están cargadas pero no nombradas, las ignora — bug crítico.

## Pricing real (referencia rápida)

| Quality | 1024×1024 | 1024×1536 / 1536×1024 |
|---|---|---|
| low | ~$0.011 | ~$0.018 |
| medium | ~$0.04 | ~$0.06-0.07 |
| high | ~$0.17 | ~$0.25 |

Las references NO suben costo significativo. Quality + aspect ratio dominan.

## Versión

v0.1 — 2026-06-02 — Sprint v4.1. Importa la REGLA DE ORO de Mazelab (refs posicionales + anti-pattern "no describir lo que existe como archivo") y documenta el guardrail mention-check de `edit_image` (D12). v0 — 2026-05-06.
