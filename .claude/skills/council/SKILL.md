---
name: council
description: Detecta cuándo conviene un council multi-modelo y orquesta la invocación. Triggers cuando el usuario discute una decisión compleja con tradeoffs reales, pide naming/ideación, debate arquitectura, o dice explícitamente "convoca un council", "/council", "consulta al council", "qué piensa el council de X". Auto-invocable sobre señales implícitas (con confirmación) y manualmente vía `/council`.
allowed-tools: Bash, Read, Edit
---

# council — detección y orquestación de councils multi-modelo

Esta skill conecta el motor de councils (`src/council.js`) con la conversación. Hace dos cosas:

1. **Detecta** señales (explícitas o implícitas) de que conviene convocar un council.
2. **Orquesta** la invocación: confirma costo, ejecuta, lee el resultado, presenta una síntesis breve, y persiste la decisión si el usuario aprueba una opción.

La skill es responsable: NO lanza councils gratis. Cada invocación cuesta dinero real (USD 0.02 a 2.50 según tier). El default es preguntar antes de gastar — solo Tier 1 muy barato puede correr sin confirmación adicional cuando ya hay confirmación previa en el turno.

---

## Sección 1 — Cuándo activar esta skill (detección)

### Señales explícitas (alta confianza, activa siempre)

Si el usuario escribe alguna de estas frases (variantes incluidas), activa la skill sin dudar:

- "convoca un council" / "convoca al council"
- "consulta al council"
- "qué piensa el council de X"
- "qué opinarían diferentes perspectivas sobre X"
- "/council" (slash command directo)
- "necesito un council para X"
- "quiero ver tradeoffs reales de X" (cuando X es una decisión)

Bajo señal explícita: confirma cuál council usar y procede al flujo de orquestación.

### Señales implícitas (media confianza, propone pero no ejecuta)

Detectas estas situaciones en la conversación sin que el usuario invoque la skill:

- El usuario está discutiendo una decisión con **tradeoffs reales** (no respuesta única correcta), por ejemplo: "monolito vs microservicios", "Postgres vs Mongo", "lanzar MVP en 2 semanas o 2 meses", "qué nombre para el producto", "subo el precio o mantengo el plan free".
- El usuario muestra señales de **estancamiento**: "no sé qué hacer", "llevo días con esto", "le doy vueltas", "tengo dos opciones y no me decido".
- El usuario plantea una **decisión difícilmente reversible** (one-way door): cambio de stack, contrato legal, lanzamiento público, naming definitivo, decisión de pricing.
- El usuario pide **brainstorming abierto** sobre algo creativo: naming, copy, posicionamiento, taglines.

Bajo señal implícita: NO ejecutes nada. Propón al usuario en una línea: "Detecto decisión X con tradeoffs reales. ¿Convoco el council `<name>`? Costo aprox: USD Y. (sí / no / otro)". Espera confirmación.

### Anti-señales (NO activar)

NO actives esta skill si:

- La pregunta tiene respuesta clara y verificable (ej. "qué año salió Python 3", "cuál es la sintaxis de async/await"). Council es overkill.
- Es una decisión personal del usuario sin tradeoffs técnicos o estratégicos (ej. "qué cenar", "qué color me gusta más"). No es para eso.
- Es una ejecución de tarea simple (ej. "escribe un email", "renombra esta variable", "fix de typo").
- Ya hay consenso aparente o contexto suficiente para resolver con un solo modelo bien promptado.
- El usuario ya decidió y solo pide ayuda con la implementación.
- Es research factual (extraer datos, traducir, resumir) — para eso un solo modelo basta o `src/research.js` con Perplexity.

### Regla del pulgar

Convoca council si la decisión cumple **al menos 2** de estos criterios:

1. Tiene **tradeoffs reales** (más de una respuesta defendible).
2. Es **difícilmente reversible** (one-way door en términos de Bezos).
3. El usuario está **estancado** o pidiendo perspectivas adicionales.
4. El **costo de equivocarse es alto** (tiempo, dinero, reputación, deuda técnica).
5. La **mejora marginal de calidad** del council justifica el costo (USD 0.02 a 2.50).

Si solo cumple 1, probablemente no necesitas council. Si cumple 3+, casi seguro sí.

---

## Sección 2 — Selección del council apropiado

Esta tabla unifica selección de council, tier, costo y política de confirmación (la sección 4 ya no repite los costos — apunta aquí):

| Tipo de pregunta | Council | Tier | Costo aprox | Política de confirmación |
|---|---|---|---|---|
| Naming, ideación creativa, brainstorming, copy, taglines | `creative-ideation` | 1 | USD 0.02–0.10 | Procede sin confirmación adicional si ya confirmó al proponer (paso 1). |
| Decisiones de negocio, estrategia, pricing, timing, posicionamiento, build vs buy | `strategy-calls` | 2 | USD 0.15–0.60 | Confirmación rápida: "Tier 2, costo aprox USD X. ¿Procedo?". |
| Decisiones específicas del proyecto Mazelab (multi-proyecto, comunidad, pareja) | `mazelab-council` | 2 | USD 0.15–0.60 | Confirmación rápida: "Tier 2, costo aprox USD X. ¿Procedo?". |
| Decisiones de arquitectura técnica, código, sistemas, esquema de datos | `architecture-decision` | 3 | USD 0.80–2.50 | Confirmación explícita con justificación de por qué Tier 3. |

### Cómo elegir cuando hay ambigüedad

- "Naming" siempre es `creative-ideation` aunque sea para Mazelab — la lente creativa importa más que el contexto.
- "Decisión técnica que afecta la estrategia" (ej. "monolito o serverless para mi startup") usa `architecture-decision` — el componente técnico domina.
- "Decisión estratégica con componente técnico" (ej. "lanzo MVP con Firebase o construyo backend propio") usa `strategy-calls` — el componente de negocio domina.
- Si la pregunta menciona explícitamente Mazelab, sus proyectos paralelos, comunidad filantrópica, webserie, o pareja → `mazelab-council`.

### Si no calza ninguno

NO inventes el council. Tienes 2 opciones:

1. **Sugiere el más cercano** y muestra por qué no es perfecto. Ej: "No tengo un council de SEO. El más cercano es `strategy-calls` porque cubre posicionamiento, aunque le falta lente técnica de SEO. ¿Lo uso, o prefieres crear uno custom (te toma ~5 min)?"
2. **Ofrece crear un custom** siguiendo la sección 5 de esta skill.

---

## Sección 3 — Flujo de orquestación

### Paso 1 — Detectar y proponer

Detectas señal (explícita o implícita). Identificas el council apropiado (sección 2). Confirmas con el usuario:

```
Detecto decisión sobre <tema>. ¿Convoco el council `<name>` (Tier <N>, costo aprox USD <X>)?
La pregunta que te plantearía es: "<reformulación clara de la decisión>".
Contexto que pasaría: <2-3 líneas con lo relevante de la conversación>.
```

Espera respuesta. Si dice "sí" o equivalente, procede. Si dice "no", para. Si dice "otro" o "cámbialo", ajusta.

### Paso 2 — Confirmación de costo (sección 4 detalla)

Si Tier 1 y costo estimado < USD 0.10: procede sin preguntar de nuevo (ya confirmó arriba).
Si Tier 2: confirmación rápida ("Tier 2, USD 0.15-0.60. ¿Procedo? sí/no").
Si Tier 3: confirmación explícita con justificación de por qué Tier 3.

### Paso 3 — Ejecutar

Genera un timestamp ISO compacto y lanza el motor:

```bash
node src/council.js \
  --council <name> \
  --question "<pregunta reformulada>" \
  --context "<contexto del proyecto, 2-5 líneas>" \
  --output councils/results/<timestamp>.json
```

Mientras corre, puedes informar al usuario en una línea: "Convocando `<name>`. Esto tarda ~30s a 3 min según el tier." Los eventos al dashboard ya los emite el motor — tú solo informas al chat.

Si el motor falla con `cost_confirmation_required`, repite paso 2 con `--confirm-expensive` agregado y vuelve a lanzar.

### Paso 4 — Leer resultado y presentar síntesis

Lee `councils/results/<timestamp>.json`. La síntesis vive en `result.synthesis`. **NO vuelques el JSON crudo al usuario.** Extrae y presenta así:

```
Council `<name>` terminó (USD <cost>, <duration>s, modelo síntesis: <model>).

Consenso (qué dijeron todas las voces):
- <bullet 1>
- <bullet 2>

Tensiones reales:
- <tema>: <persona A> dice X, <persona B> dice Y.

Opciones con tradeoffs:
1. <opción 1>: <pros/cons en 1 línea>
2. <opción 2>: <pros/cons en 1 línea>

Recomendación: <recomendación si hay una clara, o "el council no convergió, decide tú">.

[si requires_human_decision: true]
Pregunta concreta para ti: <la pregunta>.
```

Mantén la síntesis en menos de 250 palabras. Más es ruido. Si el usuario quiere ver el JSON completo, está en `councils/results/<timestamp>.json` — solo dilo si pregunta.

### Paso 5 — Persistir decisión (solo si el usuario decide)

Si el usuario elige una opción explícitamente, o aprueba la recomendación del council, llama a `addDecision()`:

```bash
node -e "import('./src/memory.js').then(m => m.addDecision({
  title: '<título corto de la decisión>',
  decision: '<qué se decidió>',
  reasoning: '<por qué — referencia al council y a las voces clave>',
  alternatives: ['<opción descartada 1>', '<opción descartada 2>'],
  reversibility: '<reversible|partial|irreversible>'
}))"
```

NO persistas si el usuario solo está leyendo la síntesis y aún no se decide. El council es input, no output final. Si el motor ya persistió automáticamente (porque `requires_human_decision: false` y `recommendation` no nulo), avisa: "El council convergió y se registró la decisión en memory/decisions.md. Avísame si quieres revertirla."

---

## Sección 4 — Confirmación de costo

La política de confirmación por tier está en la tabla unificada de la sección 2 (tier 1: procede si ya confirmó; tier 2: confirmación rápida; tier 3: confirmación explícita con justificación de por qué Tier 3).

**Regla dura:** nunca asumas que el usuario quiere gastar. Si el costo estimado es alto y la decisión no es claramente Tier 3, ofrece bajar de tier ("Esto puede correrse como Tier 2 si prefieres ahorrar; Tier 3 te da confidence loop sobre la síntesis").

Si el usuario aprueba un Tier alto pero el costo final del motor superaría USD 5, el motor lanza `cost_confirmation_required` automáticamente. Ahí pides confirmación final con el número exacto antes de pasar `--confirm-expensive`.

---

## Sección 5 — Crear council custom

Si la pregunta no calza con los 4 predefinidos y el usuario quiere uno custom:

### Flujo (solo si el usuario lo pide explícitamente)

1. Confirma que entiendes qué 3 perspectivas distintas quiere. Mínimo 2, ideal 3, máximo 5.
2. Copia `councils/templates/persona-template.json` 3 veces como base.
3. Para cada persona, customiza:
   - `id` (snake_case).
   - `actua_como` (mínimo 100 caracteres, idealmente 300+, con arquetipo + pregunta canónica + anti-patrón).
   - `model` (slug válido en `MODELS` de `src/openrouter_client.js`).
   - `temperature` (0.4-0.5 para críticos rigurosos, 0.7-0.9 para divergentes).
   - `tools` (vacío `[]` salvo que necesite datos externos).
4. Define `rounds.round1`, `rounds.round2` (si Tier 2/3), y `synthesis.model` + `synthesis.instructions`.
5. Guarda como `councils/<nombre-kebab-case>.json`.
6. Corre `node councils-config.test.js` para validar.
7. Invoca el council recién creado.

### Cuándo NO crear custom

- Si el usuario está apurado y un council cercano sirve "lo suficiente" — usa el cercano y avisa la limitación.
- Si la decisión es one-shot (no se va a repetir) — el custom no se justifica.
- La skill **NO crea councils automáticamente** sin pedido explícito. La estructura del council (qué voces, con qué sesgo, qué tier) es decisión del humano.

---

## Sección 6 — Anti-patrones

| Anti-patrón | Por qué falla |
|---|---|
| Convocar council para decisiones triviales (ej. "qué versión de Node") | El usuario se cansa, gasta dinero por nada, pierde confianza en la skill. |
| Convocar Tier 2 o 3 sin confirmación explícita | Decisión costosa tomada por la skill, no por el humano. |
| Persistir decisión sin que el usuario confirme cuál opción tomó | Memoria contaminada con "decisiones" que no son del usuario. |
| Usar council como "consulta general" para preguntas factuales | Council mejora razonamiento por divergencia; en factual es ruido caro. |
| Tratar la síntesis como verdad absoluta | El council es input para Aldo, no output final. La recomendación se discute, no se ejecuta. |
| Volcar el JSON crudo del result al chat | Ilegible, abrumador. La skill sintetiza en <250 palabras. |
| Auto-invocar sobre cualquier "discusión" sin filtrar tradeoffs reales | Activación demasiado eager, el usuario te cancela y desactiva la skill. |
| Crear councils custom sin pedido explícito | La estructura del council es decisión del humano, no de la skill. |
| Olvidar `--output` en el comando | El resultado se imprime a stdout y se pierde — no puedes leerlo después para sintetizar. |

---

## Sección 7 — Ejemplos end-to-end

### Ejemplo A — Señal explícita

**Usuario:** "Convoca un council para decidir si lanzo el MVP en 2 semanas con features mínimas o me espero 2 meses para incluir onboarding pulido."

**Skill:**
1. Detecta señal explícita ("convoca un council") + decisión estratégica con tradeoffs reales (timing de lanzamiento).
2. Identifica council: `strategy-calls` (Tier 2).
3. Confirma: "Esta es decisión estratégica de timing, irreversible en términos de momentum. Convoco `strategy-calls` (Tier 2, USD 0.15-0.60). Pregunta planteada: '¿Lanzo MVP en 2 semanas con features mínimas o espero 2 meses con onboarding pulido?'. Contexto: <2 líneas>. ¿Procedo?".
4. Usuario confirma. Skill ejecuta: `node src/council.js --council strategy-calls --question "..." --context "..." --output councils/results/2026-05-09T1430.json`.
5. Lee resultado, presenta síntesis en 200 palabras: consenso, tensiones, 3 opciones con tradeoffs, recomendación, pregunta concreta si `requires_human_decision: true`.
6. Usuario elige opción 2 ("lanzo en 3 semanas con onboarding mínimo viable"). Skill llama `addDecision()` con título + decisión + razón + reversibilidad.

### Ejemplo B — Señal implícita

**Usuario:** "Estoy diseñando el módulo de autenticación. Pensaba JWT en cookies httpOnly pero también podría ser sesiones server-side con Redis. Llevo 2 días pensándolo y no me decido."

**Skill:**
1. Detecta señal implícita: decisión técnica con tradeoffs reales + estancamiento explícito ("llevo 2 días", "no me decido") + difícilmente reversible (auth es one-way door en parte).
2. Identifica council: `architecture-decision` (Tier 3).
3. Propone (NO ejecuta): "Detecto decisión técnica de auth con tradeoffs reales y veo que estás estancado. Esto es Tier 3 porque auth es difícilmente reversible y el costo de equivocarse es alto. Convoco `architecture-decision` (USD 0.80-2.50)? La pregunta sería '¿JWT en cookies httpOnly vs sesiones server-side con Redis para autenticación de un SaaS multi-tenant?'. ¿Procedo?".
4. Usuario confirma. Skill ejecuta. Presenta síntesis. Usuario decide. Persiste.

### Ejemplo C — Anti-señal

**Usuario:** "¿Qué versión de Node uso para este proyecto?"

**Skill:**
1. Detecta: pregunta factual con respuesta clara (LTS actual). NO hay tradeoffs reales que ameriten council.
2. NO se activa. Responde directo (con un solo modelo): "Node 22 LTS hasta abril 2027. Si prefieres conservador, Node 20 LTS hasta abril 2026. Para proyectos nuevos, Node 22."

(El flujo de council custom — cuando ninguno de los 4 predefinidos calza — está cubierto en la sección 5.)

---

## Versión

v1.0 — 2026-05-09 — Sprint 4.4. Primera versión.
