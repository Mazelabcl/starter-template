---
name: confidence-loop
description: Revisa iterativamente un artefacto (agente, skill, código, plan, diseño) y lo mejora hasta alcanzar un confidence score de 95+/100. Invocable en cualquier proyecto sobre cualquier artefacto. Triggers: "revisa con confidence loop", "mejora hasta 95", "/confidence-loop", "loop de confianza", "iterar calidad".
---

# Confidence Loop

Revisión iterativa orientada a métricas. Su trabajo es subir un artefacto a **score ≥ 95/100** sin redecorar lo que ya está bien.

## Cuándo se invoca

- aldot dice "revisa con confidence loop", "/confidence-loop X", "súbele la calidad a Y"
- Después de crear un agente, skill, script, plan o diseño no trivial
- Antes de marcar una tarea como cerrada en proyectos críticos (tradebot, mazelab)

## Inputs requeridos

1. **Artefacto** (ruta absoluta a archivo, o nombre de agente/skill, o ID de un plan)
2. **Tipo** (uno de): `agent`, `skill`, `code`, `plan`, `design`, `seo-content`, `pine-script`, `prompt`
3. **Contexto opcional**: dominio del proyecto (tradebot, mazelab, etc.) para cargar `lessons_<dominio>.md`

## Rúbrica por tipo (100 pts)

### `agent` (system prompt de un agente)
- **Claridad de rol** (15): qué hace y qué NO hace
- **Tools allowlist** (15): incluye lo necesario, excluye lo peligroso
- **Trigger conditions** (10): cuándo el orquestador lo invoca
- **MCP/skill awareness** (15): conoce sus herramientas específicas y nombres exactos
- **Lessons hook** (10): instrucción de leer `lessons_<dominio>.md` al arrancar
- **Output contract** (15): formato esperado del resultado al orquestador
- **Edge cases** (10): qué hacer si falla MCP, si el input es ambiguo
- **Token economy** (10): no carga 5KB de boilerplate cuando bastan 1KB

### `skill`
- **Trigger description** (20): keywords + verbos de invocación claros
- **Inputs section** (15): qué pide al usuario o al caller
- **Procedure** (25): pasos concretos, no genéricos
- **Outputs/contracts** (15): qué devuelve y en qué formato
- **Failure modes** (10): qué hacer si X
- **Examples** (10): al menos uno realista
- **Length discipline** (5): no infla con disclaimers

### `code`
- **Correctness** (30): hace lo que dice
- **Edge cases handled** (20)
- **Readability** (15): nombres, estructura
- **No over-engineering** (15): sin abstracciones especulativas
- **Tests/verification** (10)
- **Security** (10): inputs externos validados

### `plan`
- **Goal explicit** (15)
- **Steps ordered + sized** (20)
- **Risks/tradeoffs called out** (20)
- **Reversibility considered** (15)
- **Success criteria** (15)
- **Owner per step** (15)

### `seo-content`, `pine-script`, `design`, `prompt`
Usar rúbrica del skill correspondiente cuando exista; si no, derivar del tipo más cercano.

## Procedimiento (loop)

```
iteration = 0
score = 0
max_iterations = 5

while score < 95 and iteration < max_iterations:
    iteration += 1
    1. CARGAR artefacto + lessons_<dominio>.md (si aplica)
    2. EVALUAR contra rúbrica → score por categoría + score total
    3. SI score >= 95: BREAK con reporte final
    4. IDENTIFICAR las 3 mayores brechas (no más)
    5. PROPONER fix concreto para cada brecha (diff, no descripción vaga)
    6. APLICAR fixes (Edit en el artefacto)
    7. SI una brecha vino de un error recurrente: append a lessons_<dominio>.md
    8. RE-EVALUAR
```

Si después de 5 iteraciones no alcanza 95: reportar el techo real, las brechas que no se pudieron cerrar, y por qué (puede ser que la rúbrica no aplique bien o que haga falta input del usuario).

## Reglas duras

- **No reescribas lo que ya pasa**: solo toca lo que está bajo el threshold de su categoría.
- **Una mejora por brecha por iteración**: evita "y de paso refactoreo todo". Cada fix tiene que ser trazable a una categoría de la rúbrica.
- **Lessons obligatorias** cuando el mismo tipo de fix aparece 2 veces seguidas en distintos artefactos del mismo dominio. Eso significa que es estructural.
- **No subas el score artificialmente**: si dudas entre 88 y 92, pon 88. El loop existe para tensar, no para auto-felicitarse.
- **Si el artefacto es trivial** (ej. archivo de 5 líneas que es un placeholder), reporta "score N/A — artefacto bajo umbral de revisión" y termina.

## Formato de reporte por iteración

```
=== Iteración N ===
Artefacto: <ruta>
Score: <total>/100
Por categoría:
  - <categoría>: <pts>/<max> — <una línea>
  ...
Top 3 brechas:
  1. <categoría> (<pts gap>): <descripción>
  2. ...
Fixes aplicados:
  - <descripción concreta del Edit>
Lessons logueadas:
  - <archivo>: <línea>
```

## Reporte final

```
=== CONFIDENCE LOOP — FINAL ===
Artefacto: <ruta>
Iteraciones: <N>
Score inicial: <X>/100
Score final: <Y>/100
Cambios netos: <K Edits>
Lecciones nuevas: <ruta(s) actualizada(s)>
Veredicto: PASS (≥95) | NO-PASS (techo en <Y>, ver brechas)
```

## Delegación

El loop puede delegar la **evaluación** a un sub-agente neutro (general-purpose) si el artefacto es grande, para que el grading no esté contaminado por quien lo escribió. Default: evaluar en línea para no inflar costo.

## Outputs

- Edits aplicados al artefacto
- Líneas appendidas a `lessons_<dominio>.md` cuando corresponde
- Reporte final al orquestador (formato arriba)
