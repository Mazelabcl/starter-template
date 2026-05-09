---
name: quality-mindset
description: Disciplina estratégica mínima viable para CUALQUIER tarea no trivial — research, ideación, código, contenido, decisiones. 4 momentos clave (spec mínimo → plan visible → ejecución validada → cierre validado) + Git baseline sin ceremonia. Triggers automáticos al iniciar tarea no trivial, al detectar plan vago, al pedir cierre de algo, "vamos a hacer X", "ayúdame con Y", "/quality-mindset".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# quality-mindset — disciplina mínima viable para cualquier tarea

Esta es la skill core de la v3. Se carga siempre. No reemplaza pipeline-v2 ni karpathy-rules — los antecede. Es la base estratégica que dice "antes de empezar cualquier cosa que importe, sigue estos 4 momentos".

La filosofía: la diferencia entre un vibe coder que progresa y uno que acumula deuda no es velocidad ni proceso pesado. Es cuatro disciplinas pequeñas, aplicadas sin ceremonia. Si tomas 90 segundos para spec + plan antes de empezar, te ahorras 30 minutos de drift después.

---

## Cuándo aplica esta skill

**SÍ aplica:**
- Cualquier tarea que tome más de 15 minutos.
- Cualquier tarea con más de 1 paso significativo.
- Research, ideación, código nuevo, contenido, decisiones entre alternativas, planning de cualquier tipo.
- Especialmente: tareas donde el "criterio de éxito" no es obvio ("mejora esto", "ayúdame con X", "construye Y").

**NO aplica:**
- Respuestas conversacionales rápidas.
- Tareas triviales: rename de variable, fix de typo, one-liner obvio, lectura de un solo archivo.
- Cuando el usuario pide explícitamente un draft rápido sin disciplina ("dame algo, no pienses mucho").

**Regla del pulgar:** si dudas, aplícala. Cuesta 90 segundos. Saltarla y descubrir a los 20 minutos que estabas resolviendo el problema equivocado cuesta mucho más.

---

## Las 4 disciplinas

### 1. Spec mínimo (antes de empezar)

**Qué es:** un párrafo de 3 líneas máximo que captura `Problema | Criterio de éxito | Tiempo esperado`. NO es un PRD. NO tiene secciones. Cabe en un comentario.

**Por qué importa:** sin spec, "ayúdame con la API" puede significar 5 cosas distintas. Con spec, las 5 alternativas se reducen a 1 antes de tocar nada.

**Formato sugerido:**

```
Problema: el endpoint /users devuelve 500 cuando el usuario no tiene perfil.
Criterio de éxito: GET /users/:id sin perfil devuelve 404 con mensaje claro, test pasa.
Tiempo esperado: 30 minutos.
```

**Ejemplo aplicado a contenido:**

```
Problema: necesito un nombre para el producto B2B de Mazelab.
Criterio de éxito: 5 candidatos que pasen filtro de "pronunciable, dominio .com disponible, no choque con marca existente".
Tiempo esperado: 1 hora con council.
```

**Anti-patrón:** spec a posteriori. Si lo escribes después de haber empezado a ejecutar, no es spec — es post-rationalización. Pierde su valor de filtro.

### 2. Plan visible (antes de actuar)

**Qué es:** 2-5 bullets que describen cómo vas a abordar la tarea. Mencionar tradeoffs principales si los hay. Ofrecer al usuario para que ajuste antes de ejecutar.

**Por qué importa:** te alinea con el usuario sin trabarte en waterfall. Si el plan está mal, lo corrige en 30 segundos. Si lo descubre después de ejecutar, son 30 minutos perdidos.

**Ejemplo aplicado:**

```
Plan:
- Reproducir el 500 con un test que falla (verificación primero).
- Identificar dónde se cae: probable join sin LEFT en la query del perfil.
- Arreglar la query, hacer pasar el test.
- Verificar que ningún otro test rompió.
Tradeoff: podría agregarse un check defensivo en el handler pero prefiero arreglar la causa real.
```

**Por qué NO es waterfall:** el plan no es contrato. Es brújula. Si en el paso 2 descubres que la causa real era otra, ajustas el plan en una línea y sigues. La regla es "alineación sí, atadura no".

**Anti-patrón:** plan que se convierte en spec disfrazado. Si tus bullets tienen 4 sub-bullets cada uno, ya no es plan — es waterfall. Compacta.

### 3. Ejecución con validación intermedia (durante)

**Qué es:** cambios pequeños y reversibles, validar después de cada paso significativo, comunicar updates breves al usuario.

**Por qué importa:** el costo de un error que se descubre 5 pasos después es 10x el costo del error que se descubre en el paso siguiente. Validación intermedia es la diferencia entre "funcionó al primer intento" y "tuve que rehacer todo".

**Cómo se ve en la práctica:**
- Después de cada paso significativo: ¿el sistema sigue corriendo? ¿el test pasa? ¿el output tiene sentido?
- Update al usuario en 1 línea cuando termina un paso clave: "Reproduje el bug con un test que falla. Procedo a arreglar la query."
- Si descubres algo inesperado: detén la ejecución, reporta, espera ajuste.

**Para tareas no-código:** el principio es el mismo. En research, eso es "validar que la primera fuente coincide con lo que dice una segunda antes de seguir". En contenido, eso es "validar que el primer párrafo cumple el tono antes de escribir 5 más".

**Anti-patrón:** validación que se vuelve TDD obsesivo cuando no hay tests. La validación es proporcional al riesgo. Para un script de 50 líneas no necesitas suite de tests — necesitas correrlo una vez y confirmar que el output es razonable.

### 4. Cierre validado (después)

**Qué es:** verificar contra el criterio de éxito definido en el spec. Si aplica, commit con mensaje descriptivo. Si emergió una lección que vale recordar en 6 meses, capturarla.

**Por qué importa:** sin cierre validado, "creo que funciona" pasa por "está listo". Y aparece roto 2 días después. El cierre cuesta 1 minuto. Saltarlo cuesta retrabajos.

**Checklist mínimo de cierre:**
- ¿Cumple el criterio de éxito que definí en el spec?
- Si toqué código: commit con mensaje descriptivo (ver sección Git baseline).
- Si tomé una decisión importante (entre alternativas): registrar con `addDecision` (ver sección Memoria).
- Si emergió un patrón de fallo o una receta que funcionó: registrar con `addLesson`.
- Reportar al usuario lo que se hizo en 2-3 líneas máximo.

**Anti-patrón:** cierre por inercia. Si terminaste de escribir código pero el criterio de éxito decía "test pasa" y no corriste el test, no es cierre — es declaración de victoria prematura.

---

## Disciplina Git baseline

Esta es la parte concreta que más fricción genera con vibe coders. Lo simplifico al mínimo viable: lo que SÍ y lo que NO.

### SÍ haces

- **Commit cuando un cambio lógico está completo.** Definición de "completo": el repo en ese estado tiene sentido. Si alguien clonara en ese commit, podría correr el código. NO hace falta que sea un sprint terminado — basta con un cambio coherente.
- **Mensaje de commit en 1 línea, modo imperativo, explica el WHY.** Bueno: "Corrige 500 en /users cuando perfil no existe". Malo: "fix".
- **Branch por feature grande** (>1 día de trabajo o >5 commits). Para cambios pequeños, commitea directo a la rama actual.
- **Pull antes de empezar** si trabajas con otros (raro en proyectos vibe coder solos, pero útil cuando aplica).

### NO haces

- **NO PRs formales.** Esto es Mazelab vibe coder. Si llegas a tener equipo y GitHub formal, activa la skill `superpowers-pr` (en `_catalog/`).
- **NO commits de "wip" o "fix".** Si no sabes qué pones en el mensaje, el cambio no está completo.
- **NO commits gigantes que mezclan 5 cambios distintos.** Si tu diff toca 4 features no relacionadas, son 4 commits.
- **NO branches obligatorias para todo.** El overhead supera el beneficio en cambios pequeños.

### Mensajes de commit — bueno vs malo

| Bueno | Malo | Por qué |
|---|---|---|
| `Corrige 500 en /users cuando perfil no existe` | `fix` | El bueno explica QUÉ y dónde; el malo no dice nada |
| `Reduce timeout de research a 30s para evitar bloqueos en CI` | `fix timeout` | El bueno dice el porqué; el malo solo el qué |
| `Agrega skill quality-mindset (4 disciplinas + Git baseline)` | `add quality mindset` | Modo imperativo + scope claro |
| `Renombra getProfile a fetchProfile para coincidir con la API` | `rename function` | Sin contexto, "rename function" es ruido |
| `Mueve superpowers-lite a _catalog/ porque vibe coders no abren PRs formales` | `move skill` | Bueno explica el WHY que importa en 6 meses |
| `Corrige test de memory.js que fallaba en Windows por path separator` | `fix test` | Bueno indica plataforma + causa raíz |
| `Refactor schema validation a contracts/helpers para reuso` | `refactor` | Bueno especifica el qué y el motivo |

**Patrón:** `<verbo imperativo> <qué> [<por qué si no es obvio>]`. 50-72 caracteres es el sweet spot. Si necesitas más, agrega cuerpo del commit con contexto adicional, pero la primera línea es la que importa.

---

## Cómo se conecta con karpathy-rules

`karpathy-rules` son 4 reglas tácticas para cuando la tarea es **escribir código**:
1. Think before coding.
2. Simplicity first.
3. Surgical changes.
4. Goal-driven execution.

Estas 4 reglas son la versión específica para código de la **disciplina 3 (ejecución con validación intermedia)** de quality-mindset. No la reemplazan ni se contradicen con ella — la concretan para el dominio de código.

Cuando la tarea es código:
- Quality-mindset disciplina 1 + 2 (spec + plan) sigue aplicando.
- Durante la ejecución, las 4 reglas Karpathy son tu guía táctica.
- Disciplina 4 (cierre + commit) sigue aplicando al final.

Cuando la tarea NO es código (research, ideación, contenido), Karpathy no aplica. Solo quality-mindset.

---

## Cómo se conecta con pipeline-v2

`pipeline-v2` es la implementación específica de quality-mindset cuando la tarea es **crear un artefacto creativo no trivial** (guion, agente nuevo, plan, set de imágenes, etc.). Sus 5 capas (Capa 0 contexto → architect → critic → cold-reader → humano) son una expansión de las 4 disciplinas:

- Capa 0 (contexto + memoria) implementa la disciplina 1 (spec mínimo + carga de canon).
- Capa 1 (architect) implementa la disciplina 2 (plan + ejecución del primer draft).
- Capas 2-3 (critic + cold-reader) implementan la disciplina 3 (validación intermedia, en este caso multi-óptica).
- Capa 4 (humano + memoria) implementa la disciplina 4 (cierre validado + lesson/decision).

Quality-mindset es más amplio. Aplica a tareas que NO ameritan pipeline-v2 (un fix de bug, un research corto, un commit de refactor). Pipeline-v2 aplica solo cuando estás creando algo creativo no trivial.

**Regla de decisión rápida:** ¿la tarea amerita un cold-reader gate? → pipeline-v2. ¿No? → quality-mindset solo.

---

## Anti-patrones

| Anti-patrón | Por qué falla |
|---|---|
| Spec demasiado largo (10+ líneas) | Si no cabe en 3 líneas, no es spec — es PRD; tú no necesitas PRD |
| Spec a posteriori (escrito después de empezar) | Pierde la función de filtro; te confirmas a ti mismo |
| Plan que se convierte en waterfall (sub-bullets de sub-bullets) | Te traba en planeación; el plan es brújula no contrato |
| Validación obsesiva tipo TDD cuando no hay tests | El costo supera al beneficio; valida proporcional al riesgo |
| Commits gigantes mezclando 5 cambios distintos | Imposible de revertir, imposible de revisar, imposible de entender en 6 meses |
| Commits con "fix" / "wip" / "stuff" como mensaje | El commit existe para hablarle a tu yo del futuro; "wip" no le dice nada |
| Cierre por inercia ("creo que funciona") sin verificar criterio | Bug aparece 2 días después en producción |
| `addLesson` por cada turno de la sesión | La memoria pierde valor cuando se llena de ruido; loguea solo lo que servirá en 6 meses |
| Saltarse spec porque "es obvio lo que tengo que hacer" | El 30% de las veces NO era obvio y descubres a los 20 min que era distinto |
| Branch para cada cambio pequeño | El overhead supera el beneficio; usa branches solo para feature grandes |

---

## Ejemplos end-to-end

### Escenario A — Tarea de código

Usuario: "el endpoint /users me devuelve 500 cuando el usuario no tiene perfil, ayúdame".

**Spec mínimo:**
```
Problema: GET /users/:id devuelve 500 cuando el usuario no tiene perfil asociado.
Criterio de éxito: devuelve 404 con mensaje claro, test que reproduce el caso pasa.
Tiempo esperado: 30 minutos.
```

**Plan visible:**
```
- Escribir test que reproduzca el 500 (debe fallar primero).
- Identificar la query culpable (probable join sin LEFT).
- Ajustar la query y/o handler.
- Hacer pasar el test, validar que otros tests no rompieron.
```

**Ejecución con validación intermedia** (aplicando karpathy-rules):
- Escribo el test → corre y falla con 500. Confirmado.
- Localizo la query → uso `INNER JOIN` con tabla `profiles`. Bingo.
- Cambio a `LEFT JOIN` y agrego check `if (!profile) return res.status(404).json({...})` en el handler.
- Corro el test → pasa. Corro la suite → todos verdes.

**Cierre validado:**
- Criterio de éxito: cumplido (404 con mensaje, test pasa).
- Commit: `Corrige 500 en /users/:id cuando el usuario no tiene perfil`.
- Lección: ninguna que merezca recordar en 6 meses (es un fix estándar).

### Escenario B — Tarea creativa

Usuario: "necesito nombre para el producto B2B nuevo de Mazelab".

**Spec mínimo:**
```
Problema: el producto B2B aún no tiene nombre y bloquea el deck para inversores.
Criterio de éxito: 5 candidatos que pasen filtros (pronunciable en ES/EN, .com disponible, no choque con marca existente).
Tiempo esperado: 1 hora con council.
```

**Plan visible:**
```
- Cargar contexto: principles.md + INDEX.md (Mazelab brand voice).
- Lanzar council de 3 ópticas (lingüística, branding, dominio técnico) con architect creativo.
- Critic interno filtra los obvios fails.
- Cold-reader gate sobre los 5 finalistas.
- Yo (Aldo) decido entre los que pasaron.
Tradeoff: descarto generadores random — quiero nombres con intención semántica.
```

**Ejecución:** invoco `pipeline-v2` (la tarea amerita cold-reader gate). Architect produce 12 candidatos. Critic filtra 5. Cold-reader vota GO sobre 4 de los 5. Reporto al usuario.

**Cierre validado:**
- Criterio de éxito: cumplido (5 candidatos pasaron filtros — uno cayó en cold-reader).
- Decisión registrada vía `addDecision`: "Producto B2B se llamará X. Alternativas Y, Z. Razón: cumple los 3 filtros + matches mejor con tono Mazelab".
- Lección: ninguna esta vez.

### Escenario C — Tarea de research

Usuario: "investiga el mercado de starter templates para AI engineers, estoy considerando publicar el mío".

**Spec mínimo:**
```
Problema: no sé si publicar el starter v3 como público tiene mercado.
Criterio de éxito: 1 página con TAM aproximado, 3-5 competidores principales, gap que mi starter cubre, recomendación GO/NO-GO.
Tiempo esperado: 45 minutos.
```

**Plan visible:**
```
- Lanzar Perplexity deep research con query enfocada (TAM + competidores + gap).
- Validar 2-3 datos clave con segunda búsqueda (no confiar en una sola fuente).
- Sintetizar en página única con recomendación.
Tradeoff: research deep es lento (5-10 min); alternativa rápida es Perplexity pro pero pierde profundidad.
```

**Ejecución con validación intermedia:**
- Corro `node src/research.js deep "..."` → recibo output.
- Validación: el dato "TAM ~$200M" se contrasta con segunda búsqueda focalizada → confirma rango.
- Sintetizo página única.

**Cierre validado:**
- Criterio de éxito: cumplido (página única con los 4 elementos pedidos).
- Lección capturada vía `addLesson`: "Para validar TAM en research, hacer cross-check con segunda fuente — Perplexity deep solo a veces sobrestima". Esta sí merece recordar en 6 meses porque va a aplicar a futuros research.

---

## Integración con memoria

Quality-mindset usa `src/memory.js` de forma minimalista. NO logueas cada paso de cada tarea. Solo lo que tendría valor recordar en 6 meses.

### Cuándo llamar `addDecision`

- Tomaste una decisión entre alternativas concretas, donde la elección no era obvia.
- Ejemplo: "elegí Postgres sobre SQLite para producción porque necesitamos concurrencia real".
- NO ejemplo: "elegí usar `const` en vez de `let`".

### Cuándo llamar `addLesson`

- Emergió un patrón de fallo identificable que volverá a aparecer.
- Emergió una receta que funcionó y tiene chance de aplicar de nuevo.
- Ejemplo: "Cuando research arroja un TAM, validar con segunda fuente porque deep tiende a sobrestimar".
- NO ejemplo: "hoy aprendí que `forEach` no soporta `await`" (cualquier dev lo googlea en 5 segundos).

### Cuándo NO llamar nada

- Tarea trivial cerrada sin sorpresas.
- Decisión obvia sin alternativas reales.
- Lo que ya está en `principles.md` o `process-log/00-decisions.md`.

**Regla del pulgar para memoria:** si dudas si vale la pena loguear, no la loguees. Una memoria curada de 20 entradas es 100x más útil que una memoria exhaustiva de 500.

---

## Versión

v1.0 — 2026-05-09 — Sprint 3.1. Primera versión. Ver `CHANGELOG.md`.
