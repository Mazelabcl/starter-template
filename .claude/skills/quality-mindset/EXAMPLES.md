# quality-mindset — ejemplos end-to-end (secundarios)

Este archivo NO se carga al invocar la skill. Lo lees solo si necesitas ver
las 4 disciplinas aplicadas a tareas que no son código. El ejemplo principal
(tarea de código) vive en `SKILL.md`.

---

## Escenario B — Tarea creativa

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

---

## Escenario C — Tarea de research

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
