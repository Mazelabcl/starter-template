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

## Setup previo (verificar)

1. `OPENAI_API_KEY` presente en `.env` o `.env.local` (skill aborta si falta).
2. Python venv activado y `openai` instalado (lo hace `npm run setup`).
3. Si se usan references: paths a las imágenes existen.

## Cómo opera

### Caso A — Imagen única sin references

```bash
python scripts/openai_images.py generate "<prompt>" "<output_path>" --quality medium
```

### Caso B — Imagen con references (identity lock)

**REGLA L3 (no negociable):** cada `Image N` que pongas en el array DEBE estar mencionada en el texto del prompt. Si no, el modelo la ignora.

```bash
python scripts/openai_images.py edit "<prompt con menciones explícitas a Image 1, 2, ...>" '["ref1.png","ref2.png"]' "<output_path>"
```

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
2. **L3 — Refs en texto del prompt.** Cada `Image N` mencionada explícitamente.
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

v0 — 2026-05-06
