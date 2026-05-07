---
name: pipeline-v2
description: Orquesta el flujo de creación de cualquier artefacto creativo del proyecto — Capa 0 (principles) → Capa 1 (architect) → Capa 2 (critic interno) → Capa 3 (cold-reader gate) → Capa 4 (humano decide). Triggers "construye X", "vamos a crear Y", "/pipeline-v2", o cualquier creación no trivial.
allowed-tools: Read, Write, Glob, Task
---

# pipeline-v2 — orquestación de artefactos creativos

Este es el flujo estándar para crear cualquier cosa no trivial en el proyecto. Sin esto, los agentes drifteán y los outputs pasan validación interna pero fallan en lectura cold.

## Cuándo invocarla

- Cualquier creación no trivial: guion, texto narrativo, plan, propuesta, set de imágenes, agente nuevo, skill nueva, código de feature significativo
- Después de `/kickoff` cuando el usuario pide un primer entregable concreto

## Cuándo NO invocarla

- Tareas triviales (typo, one-liner, explicación de algo existente)
- Tareas puramente técnicas con tests automáticos como verificación (compilar Pine, correr lint, etc.) — usa los validators del dominio.
- Cuando el usuario explícitamente pide un draft rápido sin gates

## Las 5 capas (orden no negociable)

### Capa 0 — `content/principles.md` cargado al tope de cada brief

Cada agente que invoques recibe **literal** el contenido de `principles.md` al inicio de su prompt. **NO** un resumen. Literal.

Si `principles.md` no existe → frena y corre `/kickoff` primero.

### Capa 0.5 — `content/INDEX.md` decide qué archivos cargar

Para la tarea actual, mira la tabla del INDEX y carga **solo** los archivos listados como obligatorios + los aplicables. **No** cargues el repo entero. Reduce drift por extrapolación.

### Capa 1 — Architect / creator

Inputs al agente:
- `principles.md` literal
- `process-log/00-decisions.md` (decisiones humanas son ley)
- Archivos del INDEX para la tarea
- Brief específico de la tarea

Output:
- Deliverable
- Notas de proceso (qué archivos leyó, qué decisiones tomó, qué modelo usó)

**En R2+ aplica protocolo "DIFF de pérdidas"**: antes de iterar, lista 5 cosas del R1 que NO debe perder al cambiar. Pegar literal al brief de R2.

### Capa 2 — Critic interno multi-óptica

3-4 ópticas relevantes al artefacto. Por ejemplo, para un guion:
- Showrunner / experto en estructura narrativa
- Experto en formato del medio (video corto, landing, post)
- Voice del cliente / brand DNA

**NO incluye cold-reader.** Esa va separada en Capa 3.

Output: scores + lista de must-fix accionables con cita textual.

### Capa 3 — Cold-reader gate (skill `cold-reader-gate`)

Independiente. Lee SOLO `principles.md` + deliverable final. Voto binario GO/NO-GO con veto absoluto. Idealmente con modelo distinto al architect.

### Capa 4 — Humano decide

Si Capa 3 = GO → al humano (aldot).
Si Capa 3 = NO-GO → vuelve a Capa 1 con los fixes de cold-reader.

## Cómo lo orquesto paso a paso

```
1. Verifico principles.md existe → si no, /kickoff primero. STOP si no.
2. Leo INDEX.md → identifico qué cargar para esta tarea.
3. Leo 00-decisions.md → reviso si hay decisiones que apliquen.
4. Lanzo architect (Agent o Skill o agente especializado) con brief armado.
   - Pegar principles.md literal al tope.
   - Pegar archivos de INDEX relevantes.
   - Pegar brief específico.
   - Pedir reportar modelo usado.
5. Lanzo critic interno (3-4 ópticas, paralelo cuando son independientes).
6. Si critic detecta must-fix → vuelve a architect (R2 con DIFF de pérdidas).
7. Cuando architect+critic convergen → invoco cold-reader-gate skill.
8. Si NO-GO → vuelve a Capa 1 con fixes específicos. Máximo 3 ciclos.
9. Si GO → presento al humano + escribo process-log/XX-{tarea}-{ronda}.md.
```

## Regla anti-watchdog para sub-agentes Opus en outputs largos

Cuando lances un agente que escribe archivos largos (outline >50 slides,
código >500 líneas, guion >3000 palabras), incluye **literal** en el brief
esta cláusula al inicio:

```
EMPIEZA YA. Lee inputs, después escribe el archivo INMEDIATAMENTE.
No planifiques en mensajes — planifica en comentario HTML al tope.
Tu plan vive en el archivo, no en la conversación.
```

**Por qué:** sin esto, el sub-agente puede entrar en "deliberación
extendida" y el watchdog del stream lo mata a los 600s sin progreso.
Caso real: F12 en `process-log/findings-for-template.md` — el architect
R4 quedó >10 min sin escribir y el stream se cortó.

Patrón de mitigación adicional: split de tareas grandes en 2 mini-tareas
más cortas (ej. R4a = rellenar placeholders, R4b = refactor conectores)
cuando el output esperado es muy extenso.

## Reglas duras

1. **principles.md literal, no resumido.** Resumir = drift garantizado.
2. **INDEX manda qué cargar.** Cargar más = drift por contexto extra.
3. **DIFF de pérdidas en R2+.** Sin esto, cada ronda pierde lo bueno de la anterior.
4. **Cold-reader es independiente.** No le pases historial. Si lo haces, su veto deja de servir.
5. **Modelo tracking.** Cada agente reporta el modelo usado.
6. **Validation multimodal en imágenes.** Skill `multimodal-validation` obligatoria.
7. **Refs mencionadas en texto del prompt.** Cada `Image N` declarada DEBE estar nombrada en el prompt.
8. **Idioma del proyecto.** Forzado al inicio de cada brief, según `principles.md`.

## Anti-patrones (NO hacer)

| Anti-patron | Por qué falla |
|---|---|
| Lanzar architect con 15+ archivos de contexto | Drift por extrapolación |
| Critic con cold-reader como voz más en rúbrica | Self-confirming, scores inflados |
| Validation textual sin Read multimodal del PNG | Bugs visuales se escapan |
| Refs cargadas pero no mencionadas en texto del prompt | Modelo las ignora |
| Múltiples R1, R2, R3 sin DIFF de pérdidas | Cada ronda pierde lo bueno del anterior |
| Pasar paths absolutos dispersos al usuario | Friction de copy-paste, mejor subcarpetas |

## Versión

v0 — 2026-05-06 — derivado del manual portable.
