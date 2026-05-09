# Council usage examples

Cuatro ejemplos reales de invocación, uno por council. Cada ejemplo incluye el comando exacto, los inputs, y la estructura del output esperado (no texto literal — el contenido depende del modelo).

Asume que `src/council.js` (Sprint 4.2) ya está implementado y expone CLI + API programática.

---

## Ejemplo 1 — Creative Ideation: naming de un producto

**Caso real:** Aldo está construyendo una plataforma de auditoría de campañas de marketing dirigida a agencias chilenas y necesita un nombre.

**Comando CLI:**

```bash
node src/council.js \
  --council creative-ideation \
  --question "Necesito naming para una plataforma SaaS de auditoría de campañas de marketing digital, dirigida a agencias chilenas que manejan 5 a 50 clientes simultáneos. Producto: dashboard que detecta automáticamente waste en Google Ads, Meta Ads y LinkedIn. Tono: profesional pero con personalidad, evitar nombres genéricos tipo 'AdMaster'." \
  --context "Mercado: LATAM con foco inicial en Chile. Competencia local débil, competencia global cara. Presupuesto: bootstrap." \
  --output-json result.json
```

**Estructura de output esperada (`result.json`):**

```json
{
  "council": "creative-ideation",
  "tier": 1,
  "rounds": {
    "round1": {
      "visionary": "<200-300 palabras: lectura desde la lente Rubin, qué quiere salir naturalmente>",
      "devils_advocate": "<200-300 palabras: 3 a 5 preguntas incómodas sobre el brief, supuestos cuestionados>",
      "executor": "<200-300 palabras: 3 a 5 nombres concretos accionables + dominio + paso del lunes>"
    }
  },
  "synthesis": {
    "consensus": ["<bullet>", "..."],
    "tensions": ["<tensión 1: posición A vs B>", "..."],
    "options": [
      { "name": "<opción 1>", "pros": "<1 línea>", "cons": "<1 línea>" }
    ],
    "recommendation": "<recomendación priorizada con paso del lunes>"
  },
  "usage": {
    "total_input_tokens": 4200,
    "total_output_tokens": 1800,
    "cost_usd_estimated": 0.045,
    "duration_seconds": 18
  },
  "model_trace": [
    { "persona": "visionary", "model": "anthropic/claude-sonnet-4.5", "round": 1 },
    { "persona": "devils_advocate", "model": "openai/gpt-5", "round": 1 },
    { "persona": "executor", "model": "anthropic/claude-haiku-4.5", "round": 1 },
    { "persona": "synthesizer", "model": "anthropic/claude-sonnet-4.5", "round": "synthesis" }
  ]
}
```

---

## Ejemplo 2 — Architecture Decision: monolito vs microservicios

**Caso real:** Aldo está iniciando una plataforma multi-tenant de marketing y debe decidir arquitectura base.

**Comando CLI:**

```bash
node src/council.js \
  --council architecture-decision \
  --question "Estoy iniciando una plataforma SaaS multi-tenant de auditoría de campañas. Pregunta: ¿monolito Node + Postgres con schemas por tenant (option A), monolito Node + Postgres con row-level security por tenant (option B), o microservicios desde el día 1 con Postgres dedicado por servicio (option C)?" \
  --context "Equipo: 1 persona (yo, vibe coder novato técnico que aprende rápido). Carga esperada: 50 tenants en 12 meses, picos de 100k requests/día por tenant. Presupuesto cloud: USD 200/mes los primeros 6 meses. Datos sensibles: spend de marketing por agencia, debe estar aislado." \
  --output-json arch-decision.json
```

**Estructura de output esperada:**

```json
{
  "council": "architecture-decision",
  "tier": 3,
  "rounds": {
    "round1": {
      "senior_architect": "<300-500 palabras: lectura, factores que pesan, info faltante, inclinación>",
      "performance_freak": "<300-500 palabras con cálculos de carga, bottlenecks anticipados, percentiles>",
      "security_paranoid": "<300-500 palabras: threat model, blast radius por opción, aislamiento de tenant>"
    },
    "round2": {
      "senior_architect": "<250-400 palabras: dónde coincide, dónde discrepa, posición refinada>",
      "performance_freak": "<250-400 palabras: respuesta a los argumentos contrarios>",
      "security_paranoid": "<250-400 palabras: qué cambió, qué mantiene>"
    }
  },
  "synthesis": {
    "decision_restated": "<una frase>",
    "options_considered": [
      { "option": "A: schemas por tenant", "pros": "...", "cons": "...", "main_risk": "...", "effort": "low" }
    ],
    "tradeoff_matrix": "<markdown table con 3 opciones x 6 dimensiones>",
    "tensions_resolved": ["..."],
    "tensions_open": ["<para que el humano decida>"],
    "recommendation": "<recomendación con 3 bullets de justificación + 3 hitos de validación>",
    "what_id_watch": ["<métrica 1>", "..."]
  },
  "post_synthesis": {
    "confidence_loop_ran": true,
    "final_confidence": 96
  },
  "usage": {
    "total_input_tokens": 12500,
    "total_output_tokens": 6800,
    "cost_usd_estimated": 1.15,
    "duration_seconds": 95
  }
}
```

---

## Ejemplo 3 — Strategy Calls: timing de lanzamiento del MVP

**Caso real:** Aldo está decidiendo cuándo soltar el MVP de su plataforma de auditoría.

**Comando CLI:**

```bash
node src/council.js \
  --council strategy-calls \
  --question "¿Lanzo el MVP en 2 semanas (versión cruda con 2 features funcionando: detección de waste en Google Ads + reporte semanal por email) o en 2 meses (versión con 5 features, dashboard pulido, onboarding guiado, integraciones con Meta y LinkedIn)?" \
  --context "Tengo 3 agencias chilenas comprometidas a probar gratis a cambio de feedback. Burn personal: USD 1500/mes. Runway: 6 meses. No tengo competencia directa local pero hay 2 productos globales caros (USD 200+/mes) que ningún chileno usa." \
  --output-json strategy-call.json
```

**Estructura de output esperada:**

```json
{
  "council": "strategy-calls",
  "tier": 2,
  "rounds": {
    "round1": {
      "visionary_naval": "<250-400 palabras desde lente leverage>",
      "operator_bezos": "<250-400 palabras: reversible vs irreversible, customer obsession>",
      "skeptic_pro": "<250-400 palabras: sesgos detectados, inversión del problema>"
    },
    "round2": {
      "visionary_naval": "<250-350 palabras post cross-pollination>",
      "operator_bezos": "<...>",
      "skeptic_pro": "<...>"
    }
  },
  "synthesis": {
    "decision_in_one_sentence": "<frase>",
    "reversible_or_irreversible": "reversible / irreversible",
    "consensus": ["..."],
    "tensions": ["..."],
    "options": [
      { "option": "lanzar en 2 semanas", "leverage": "...", "reversibility": "...", "critical_assumption": "..." },
      { "option": "lanzar en 2 meses", "leverage": "...", "reversibility": "...", "critical_assumption": "..." }
    ],
    "cognitive_biases_detected": ["sunk cost", "..."],
    "recommendation": "<recomendación con próximo paso del lunes>",
    "what_would_change_my_mind": ["<hecho 1>", "<hecho 2>", "<hecho 3>"]
  },
  "usage": {
    "total_input_tokens": 8500,
    "total_output_tokens": 4200,
    "cost_usd_estimated": 0.42,
    "duration_seconds": 55
  }
}
```

---

## Ejemplo 4 — Mazelab Council: priorización entre proyectos paralelos

**Caso real:** Aldo está decidiendo dónde meter sus próximos 3 meses de tiempo entre los proyectos paralelos que tiene activos.

**Comando CLI:**

```bash
node src/council.js \
  --council mazelab-council \
  --question "Tengo 3 frentes activos compitiendo por mi tiempo en los próximos 3 meses: (1) software propio de Mazelab para gestionar ventas, cuentas y operaciones del negocio principal — me hace ahorrar 20 horas/mes pero no genera ingresos directos; (2) plataforma de marketing y auditoría de campañas — potencial SaaS con 3 agencias listas para pilotar gratis, pero requiere 60% de mi tiempo durante 3 meses para llegar al MVP; (3) la comunidad filantrópica con webserie animada — proyecto de pasión, requiere 30% de mi tiempo, ingresos cero por ahora pero alto valor emocional y construye marca. ¿Cuál priorizo y por qué?" \
  --context "Burn personal: USD 1500/mes. Runway: 6 meses. Mi pareja tiene sus propios emprendimientos que también ocupan parte de mi atención (apoyo, no liderazgo)." \
  --output-json mazelab-priorities.json
```

**Estructura de output esperada:**

```json
{
  "council": "mazelab-council",
  "tier": 2,
  "rounds": {
    "round1": {
      "mazelab_visionary": "<250-400 palabras: cuál suma leverage real, cuál es trabajo lineal>",
      "mazelab_operator": "<250-400 palabras: reversible vs irreversible, qué cliente obsesivo serviría más>",
      "mazelab_creative": "<250-400 palabras: qué se siente cuando cada uno funciona, qué quiere salir>"
    },
    "round2": {
      "mazelab_visionary": "<250-350 palabras post cross-pollination>",
      "mazelab_operator": "<...>",
      "mazelab_creative": "<...>"
    }
  },
  "synthesis": {
    "decision_restated": "<una frase>",
    "reversible_or_irreversible": "reversible / irreversible",
    "consensus": ["..."],
    "tensions": ["..."],
    "options": [
      {
        "option": "priorizar plataforma de marketing 60%, software propio 20%, webserie 20%",
        "leverage": "...",
        "reversibility": "alta — si en 6 semanas no hay tracción, pivota",
        "time_cost_aldo_weekly_hours": 40,
        "impact_on_other_projects": "..."
      }
    ],
    "mazelab_specific_risks": [
      "multitarea: 3 frentes simultáneos diluyen la calidad de cada uno",
      "..."
    ],
    "recommendation": "<priorización con próximo paso del lunes>",
    "what_would_change_the_recommendation": ["..."]
  },
  "usage": {
    "total_input_tokens": 9200,
    "total_output_tokens": 4500,
    "cost_usd_estimated": 0.48,
    "duration_seconds": 62
  }
}
```

---

## Notas operativas

- Los costos en USD son estimados con los `cost_per_1m_input/output` del catálogo de `src/openrouter_client.js` y dependen del tamaño real del prompt y de la respuesta. La duración depende de la latencia de OpenRouter y del paralelismo en `chatBatch`.
- Para Tier 3 con `confidence_loop: true`, la duración puede subir 30 a 60 segundos adicionales por las iteraciones de mejora.
- Si quieres ver el output crudo de cada persona (sin la síntesis), pasa `--include-raw` al CLI.
- Si una persona falla (rate limit, timeout), el motor reporta el error en `model_trace[i].error` pero continúa con las demás. La síntesis se hace con los miembros que respondieron, marcando explícitamente quién faltó.
