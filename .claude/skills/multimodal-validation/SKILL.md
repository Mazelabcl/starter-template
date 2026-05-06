---
name: multimodal-validation
description: Fuerza validación visual real (Read multimodal del PNG) después de generar imágenes con gpt-image-2 u otros. Triggers automáticamente después de cualquier llamada a generate_image/edit_image/generate_batch_async.
allowed-tools: Read, Bash
---

# multimodal-validation

**Regla de oro:** un agente NO puede reportar PASS de una imagen sin haber abierto el PNG visualmente.

## Por qué existe

Bug raíz que arregla: agentes reportan "imagen OK" basados solo en que el prompt parece correcto. Pero el modelo a veces ignora la mitad del prompt (especialmente las references no mencionadas en el texto). Validar el prompt no es validar la imagen. Ver `agent-orchestration-portable-brief.md` §1.3, §1.5, §4.6, L2.

## Cuándo se invoca

- **Automático** después de `generate_image()`, `edit_image()`, `generate_batch_async()` o cualquier llamada que produzca un PNG
- Antes de reportar al orquestador que una imagen está "lista"
- Antes de mostrar imágenes al usuario humano

## Cuándo NO se invoca

- Si el output no es una imagen (texto, código, audio, etc.)
- En batch enorme (100+) donde el orquestador decide validación por muestreo — pero al menos N=10 random deben pasar Read multimodal.

## Cómo opera

### Paso 1 — Read multimodal del PNG

Por cada imagen generada:

```
Read tool con file_path = <path al PNG generado>
```

Esto carga la imagen visualmente al contexto. Sin este paso, no estás validando — estás adivinando.

### Paso 2 — checklist visual

Por cada imagen, responde explícitamente:

1. **¿Match con el prompt textual?** ¿Aparece lo que pediste, en la pose/composición/luz pedidas?
2. **¿Match con references?** Si declaraste `Image 1` (identity lock), ¿el sujeto de la imagen generada es coherente con la ref?
3. **¿Anatomía / detalles críticos correctos?** Si el char sheet dice "ONE eye, four fingers", ¿tiene un solo ojo y cuatro dedos?
4. **¿Hay "anti-defaults" del modelo que se colaron?** (anime cuando pediste 3D, photorealistic cuando pediste painterly, etc.)
5. **¿El render style es el pedido?** (3D estilizado / painterly / etc.)

### Paso 3 — output

```
VALIDATION: PASS | FAIL

Imagen: <path>
Prompt clave: <resumen 1-línea de lo que se pidió>

Checklist:
- Match prompt: SÍ | NO — <detalle>
- Match references: SÍ | NO | N/A — <detalle>
- Anatomía/detalles: SÍ | NO — <bugs específicos>
- Anti-defaults: limpio | <cuáles aparecieron>
- Render style: correcto | <qué falla>

SI FAIL:
- Bugs visuales con cita visual: <descripción específica de qué se ve mal>
- Sugerencia de regen:
  - Reforzar en el prompt: <texto exacto a añadir>
  - Negative prompt: <qué excluir>
  - ¿Vale la pena cambiar quality/size?: <SÍ/NO>
```

### Paso 4 — si FAIL, regenerar con énfasis

No reportar PASS sin re-ejecutar y re-validar. Iterar hasta máximo 3 veces. Si después de 3 sigue mal, escalar al orquestador con los 3 PNGs como evidencia.

## Reglas duras

1. **Read multimodal es OBLIGATORIO.** No hay PASS sin abrir el PNG.
2. **Cita visual, no del prompt.** Si dices "tiene dos ojos cuando debería tener uno", lo viste en la imagen, no lo dedujiste del prompt.
3. **Si el batch tiene N imágenes y validas por muestreo**, declara explícitamente "validé N=X de Y por muestreo random".
4. **Bugs visuales se reportan con sugerencia de fix** específica al prompt — no genérica.
5. **Nunca digas "se ve bien" sin checklist.** Las 5 dimensiones siempre se evalúan.

## Versión

v0 — 2026-05-06
