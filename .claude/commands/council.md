---
description: Convoca un council multi-modelo para deliberar sobre una decisión compleja. Sin argumentos lista los councils disponibles. Con `<name> "pregunta"` invoca directo. Con `new` inicia creación de council custom.
allowed-tools: Bash, Read, Edit
---

El usuario lanzó `/council` con argumento: "$ARGUMENTS".

La lógica completa de detección, selección y orquestación vive en la skill `council` (`.claude/skills/council/SKILL.md`). Este slash es la entrada manual rápida. Despacha según el primer token de `$ARGUMENTS`.

## Caso 1 — sin argumento (listar)

Si `$ARGUMENTS` está vacío, lista los 4 councils predefinidos con descripción + costo y pregunta cuál invocar:

```
Councils disponibles:

1. creative-ideation (Tier 1, USD 0.02-0.10)
   Naming, ideación creativa, brainstorming, copy, taglines.
   3 voces: visionary (Rick Rubin), devils_advocate (Kara Swisher), executor (founder YC).

2. architecture-decision (Tier 3, USD 0.80-2.50)
   Decisiones técnicas con costo de cambio alto: monolito vs microservicios, elección de DB, auth.
   3 voces: senior_architect, performance_freak, security_paranoid.

3. strategy-calls (Tier 2, USD 0.15-0.60)
   Decisiones estratégicas: pricing, timing, roadmap, posicionamiento, build vs buy.
   3 voces: visionary_naval, operator_bezos, skeptic_pro.

4. mazelab-council (Tier 2, USD 0.15-0.60)
   Decisiones específicas del contexto Mazelab (multi-proyecto, comunidad, pareja).
   3 voces: mazelab_visionary, mazelab_operator, mazelab_creative.

Uso: /council <name> "pregunta concreta"
Para crear uno custom: /council new
```

Pregunta al usuario: "¿Cuál uso, y para qué pregunta?". Espera respuesta y procede como Caso 2.

## Caso 2 — `<name> "pregunta"` (invocación directa)

Si el primer token es uno de los 4 nombres válidos (`creative-ideation`, `architecture-decision`, `strategy-calls`, `mazelab-council`):

1. Extrae el resto de `$ARGUMENTS` como la pregunta. Si no hay pregunta, pídela al usuario.
2. Aplica la política de confirmación de costo de la skill `council` sección 4:
   - Tier 1: procede.
   - Tier 2: pregunta breve "Tier 2, USD 0.15-0.60. ¿Procedo?".
   - Tier 3: pregunta explícita con justificación "Tier 3 porque <razón>. Costo aprox USD 0.80-2.50. ¿Procedo?".
3. Genera timestamp ISO compacto (ej. `date +%Y-%m-%dT%H%M`) y ejecuta:

```bash
node src/council.js --council <name> --question "<pregunta>" --output councils/results/<timestamp>.json
```

4. Si el motor falla con `cost_confirmation_required`, repite confirmación con costo exacto y vuelve a lanzar con `--confirm-expensive`.
5. Lee `councils/results/<timestamp>.json` y presenta la síntesis siguiendo el formato de la skill `council` sección 3 paso 4 (consenso / tensiones / opciones / recomendación, máx 250 palabras).
6. Si el usuario decide explícitamente una opción al leer la síntesis, persiste con `addDecision()` (skill `council` sección 3 paso 5).

## Caso 3 — `new` (crear custom)

El usuario quiere crear un council custom. Sigue el flujo de la skill `council` sección 5:

1. Pregunta al usuario: "¿Qué decisión vas a evaluar repetidamente con este council? (eso me dice qué perspectivas necesita)". Espera respuesta.
2. Pregunta: "¿Qué 3 perspectivas distintas quieres? Para cada una necesito: (a) arquetipo o estilo, (b) qué pregunta canónica hace ese rol, (c) qué anti-patrón evita". Espera respuesta.
3. Pregunta: "¿Qué tier (1=liviano, 2=cross-pollination, 3=crítico con confidence loop)? El tier define costo aprox y rounds.".
4. Pregunta: "¿Qué nombre kebab-case le ponemos al council? (ej. `copy-review`, `pricing-decision`)".
5. Copia `councils/templates/persona-template.json` 3 veces como base, customiza cada persona con los datos del usuario, ajusta `rounds` según tier elegido, define `synthesis.model` (default `anthropic/claude-opus-4.5`) y `synthesis.instructions` apropiadas al dominio.
6. Guarda como `councils/<nombre>.json`.
7. Corre `node councils-config.test.js` para validar. Si falla, reporta los errores y pide al usuario corregir el input.
8. Si pasa, confirma: "Council `<nombre>` creado y validado. ¿Lo invoco ahora con una pregunta de prueba, o solo lo dejo guardado para uso futuro?".

## Caso 4 — argumento desconocido

Si el primer token no es ninguno de los 4 nombres válidos ni `new`, responde:

```
Comando no reconocido. Uso:
- /council                          (lista councils)
- /council <name> "pregunta"        (invoca directo, name ∈ {creative-ideation, architecture-decision, strategy-calls, mazelab-council})
- /council new                      (crea custom)
```

No inventes councils ni acciones.

## REGLAS DURAS

- Idioma: español neutro. Cero voseo, cero regionalismos rioplatenses.
- NUNCA invocas un council Tier 2 o 3 sin confirmación explícita del usuario.
- NUNCA persistes decisión sin confirmación explícita de qué opción eligió el usuario.
- NUNCA vuelques el JSON crudo del result al chat — sintetiza en <250 palabras.
- Resultados van SIEMPRE a `councils/results/<timestamp>.json` (no a stdout).
- Si la skill `council` está cargada, delega la lógica de detección a ella; este slash es solo entrada manual rápida.
