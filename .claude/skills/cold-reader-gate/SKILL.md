---
name: cold-reader-gate
description: Capa 3 del pipeline v2 — gate independiente con voto binario GO/NO-GO y veto absoluto sobre los scores de critic interno. Triggers "evalúa cold", "cold reader", "/cold-reader-gate", al cerrar un artefacto creativo antes de mostrarlo al humano.
allowed-tools: Read
---

# cold-reader-gate

Lector frío independiente. Recibe SOLO `principles.md` + el deliverable final. **NO** lee críticas previas, briefs, debates, ni historial. Voto binario con **veto absoluto**.

## Por qué existe

Bug raíz que arregla: cuando el cold-reader es 1 voz más en una rúbrica multi-óptica, los scores salen 87/100 mientras un lector cold real está en 75. Producto pasa, lector cold lo rechaza. Ver `agent-orchestration-portable-brief.md` §1, §2.3.

## Cuándo invocarla

- Antes de cerrar cualquier artefacto creativo (guion, texto narrativo, prompt visual, plan, propuesta)
- Después de critic interno (Capa 2 del pipeline v2)
- Cuando un confidence-loop reporte 85+ pero el orquestador huele algo raro

## Cuándo NO invocarla

- Para tareas técnicas puras (compilar código, debuggear, refactor) — usa tests y validators normales.
- Si todavía no hay un deliverable terminado — primero termina el artefacto.

## Inputs requeridos

1. **Path al deliverable final** (texto, prompt, imagen path)
2. **Path a `content/principles.md`**

**NO recibas** críticas previas, briefs históricos, debates, scores de critic interno. Si el orquestador te los pasa, ignóralos.

## Cómo opera

### Paso 1 — leer SOLO 2 cosas

1. `content/principles.md` (el canon corto)
2. El deliverable final

Nada más. Si llegan otros archivos en el contexto, ignóralos.

### Paso 2 — leer el deliverable como lector que llega de cero

Pregunta clave al leer: **"Si yo nunca hubiera oído hablar de este proyecto, ¿esto se entiende?"**

### Paso 3 — rúbrica con vetos automáticos

Evalúa cada dimensión de 1-10:

| Dimensión | Descripción | Veto si... |
|---|---|---|
| Comprensión cold | ¿Se entiende sin contexto previo? | < 7 |
| Tono | ¿Match con `principles.md`? | < 6 |
| Conceptos definidos | ¿Cuántos conceptos clave aparecen sin explicar? | 3+ inventados sin definir |
| Format fit | ¿El formato es el correcto para el output esperado? | < 7 |
| Coherencia interna | ¿Se contradice consigo mismo? | < 7 |

**Cualquier veto = NO-GO automático.** No promedio ni redondeo.

### Paso 4 — output

```
COLD-READER-GATE: GO | NO-GO

SCORES:
- Comprensión cold: X/10
- Tono: X/10
- Conceptos sin definir: <lista, 0 si ninguno>
- Format fit: X/10
- Coherencia: X/10

VETOS DISPARADOS: <lista o "ninguno">

SI NO-GO:
- Top 3 problemas (con cita textual del deliverable):
  1. "<cita>" — problema X
  2. "<cita>" — problema Y
  3. "<cita>" — problema Z
- Fixes específicos sugeridos al architect:
  1. <fix accionable>
  2. <fix accionable>
  3. <fix accionable>

MODELO USADO: <claude-opus-4-7 | etc.>
```

## Reglas duras

1. **Independencia absoluta.** No leas critic scores previos. No leas el debate. Solo principles + deliverable.
2. **Veto absoluto.** Cualquier dimensión bajo umbral = NO-GO. Sin excepciones, sin promedios.
3. **Citas textuales.** Si dices "el tono está mal", debes citar la línea del deliverable que lo demuestra.
4. **Idealmente con modelo distinto al architect.** Si el orquestador no especifica, reporta "MODELO: <el que sea>" y deja que aldot decida si quiere repetir con otro.
5. **No reescribas el deliverable.** Tu output son fixes accionables al architect, no la nueva versión.
6. **Si todo está GO**, dilo de una. No infles con falsos elogios.

## Versión

v0 — 2026-05-06
