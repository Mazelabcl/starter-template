# `src/council.js` — Motor de councils multi-modelo

Orquesta un debate entre N personas (cada una un LLM con perspectiva propia) y produce una síntesis estructurada (consensus + tensions + options + recommendation). Es el corazón del sistema multi-modelo del starter.

## Cuándo conviene un council vs un solo modelo

Un council bien hecho mejora razonamiento por divergencia controlada. Uno mal hecho es ruido caro. La regla:

| Situación | Solo modelo | Council |
|---|---|---|
| Tarea factual (extraer datos, traducir, resumir) | sí | no |
| Decisión técnica con respuesta clara | sí | no |
| Brainstorming creativo (naming, ideación) | tibio | Tier 1 |
| Code review medianamente delicado | tibio | Tier 2 |
| Decisión arquitectónica con tradeoffs reales | no | Tier 3 |
| Estrategia de negocio / posicionamiento | no | Tier 3 |
| Cualquier cosa irreversible | no | Tier 3 |

Si no puedes nombrar al menos 2 perspectivas legítimas que disienten, no necesitas council.

## API

```javascript
import council from './src/council.js';

const result = await council.invoke({
  councilName: 'creative-ideation',  // carga councils/creative-ideation.json
  // councilConfig: { ... },          // alternativa: pasa el config inline
  question: '¿Cómo llamamos a la app?',
  context: 'App de productividad para equipos pequeños.',  // opcional
  tier: 1,  // opcional, default = config.tier_default
  onProgress: (ev) => console.log(ev.type, ev.payload),  // opcional
  confirmExpensive: false,  // si estimado > $5, requerido true
  memoryDir: './memory',  // opcional, para persistir decisiones
});
```

### Estructura del resultado

```javascript
{
  council_name: 'creative-ideation',
  tier_used: 1,
  question: '...',
  context: '...' | null,
  personas_responses: {
    round1: [{persona_id, content, tool_calls?, usage, model_used}, ...],
    round2: [...] | null
  },
  synthesis: {
    consensus_areas: ['frase corta', ...],
    tensions: [{topic, positions: [{persona_id, stance}]}],
    options: [{title, description, tradeoffs, supporting_personas}],
    recommendation: 'string' | null,
    requires_human_decision: false,
    rationale: '...'
  },
  metadata: {
    total_tokens, total_cost_usd, duration_seconds,
    personas_total, personas_alive, partial,
    synthesis_model, confidence_score, confidence_loop_iterations,
    decision_persisted
  }
}
```

## Tiers

- **Tier 1 — liviano** (~$0.01-0.05): brainstorming creativo, naming. 3 personas, todas Sonnet/Haiku. Solo Ronda 1.
- **Tier 2 — mixto** (~$0.05-0.15): code review, content review. 3 personas mezcla Claude + GPT. Ronda 1 + Ronda 2 con cross-pollination.
- **Tier 3 — crítico** (~$0.10-0.30): architecture, business strategy. 3 modelos distintos. Ronda 1 + Ronda 2 + síntesis con confidence loop hasta score 95.

El tier viene del `tier_default` del config o se pasa como parámetro.

## Ejemplo end-to-end

```javascript
import council from './src/council.js';

const result = await council.invoke({
  councilConfig: {
    name: 'naming-quick',
    tier_default: 1,
    personas: [
      {
        id: 'visionary',
        actua_como: 'Eres Naval Ravikant. Piensas en first principles, prefieres nombres ambiciosos.',
        model: 'anthropic/claude-haiku-4.5',
        temperature: 0.9,
      },
      {
        id: 'pragmatic',
        actua_como: 'Eres un product manager senior. Optimizas por dominio disponible y SEO.',
        model: 'anthropic/claude-haiku-4.5',
        temperature: 0.7,
      },
    ],
    rounds: { round1: { enabled: true } },
  },
  question: 'Nombre para una app de productividad para equipos pequeños.',
});

console.log(result.synthesis.recommendation);
console.log('costo:', result.metadata.total_cost_usd);
```

## Cómo crear un council custom

1. Crea `councils/<nombre>.json` siguiendo `councils/templates/council.schema.json`.
2. Mínimo 2 personas (sin debate no hay council). Máximo 7 (más es ruido).
3. Cada persona necesita `id`, `actua_como` (system prompt con sesgo intencional), `model` (slug OpenRouter).
4. Tools opcionales en `persona.tools`: `["perplexity_research", "image_reference", "code_simulation"]`. Solo se le ofrecen al modelo si están declaradas.
5. `rounds.round1.enabled: true` siempre. `round2.enabled: true` para Tier 2/3. `synthesis.model` opcional (default `anthropic/claude-opus-4.5`).
6. Tier 3 puede activar `post_synthesis.confidence_loop: true` para iterar la síntesis hasta score 95.

Ver `councils/templates/persona-template.json` para ejemplo de persona.

## Tools de personas

Cuando una persona declara tools y el modelo decide invocarlas durante deliberación, el motor las intercepta, las ejecuta, y devuelve el resultado al modelo para que continúe.

| Tool | Qué hace |
|---|---|
| `perplexity_research` | Llama a `src/research.js` con la query de la persona. Devuelve content + citations. |
| `image_reference` | NO genera imagen. Solo registra qué imagen sería útil. Sprint 5.1 generará realmente. |
| `code_simulation` | Pide a Claude Haiku razonar qué haría un snippet. NO ejecuta código real. |

Si una persona no declara tools en su config, no se le ofrecen — cero inflación de prompt.

## Cross-pollination (Ronda 2)

En Ronda 2, cada persona ve transcripciones LITERALES de las **otras** personas (no la suya, no notas inventadas, no resumen del moderador). El prompt le pide reaccionar específicamente: con quién coincide, con quién discrepa, qué crítica tiene.

Esto es lo que hace al council mejor que N llamadas independientes — las personas se leen entre sí y refinan.

## Síntesis estructurada

El "moderador" es una llamada extra (default `anthropic/claude-opus-4.5`) que recibe TODAS las respuestas y produce JSON con shape fijo:

- `consensus_areas`: dónde coincidieron todas.
- `tensions`: desacuerdos reales (no de tono).
- `options`: opciones concretas con tradeoffs y qué personas las apoyan.
- `recommendation`: si convergieron → string. Si no → `null`.
- `requires_human_decision`: `true` si hay tensiones no resueltas. Default conservador.
- `rationale`: 1-3 frases de por qué esa síntesis.

JSON estructurado en vez de prosa libre — eso permite que el caller (skill council) tome decisiones programáticas.

## Costo y límites

- Antes de invocar, el motor estima costo total con `estimateCouncilCost()`. Si supera $5 USD, lanza `CouncilError code: 'cost_confirmation_required'` salvo que pases `confirmExpensive: true`.
- Timeouts por tier: Tier 1 = 5 min, Tier 2 = 10 min, Tier 3 = 20 min.
- Si una persona falla, retry una vez. Si vuelve a fallar, el council continúa con N-1 personas y marca `metadata.partial: true`.
- Si quedan menos de 2 personas vivas, el council falla — sin debate no hay council.

## Memoria automática

Si la síntesis tiene `requires_human_decision: false` y `recommendation` no nulo, el motor llama automáticamente a `memory.addDecision()` con el shape del council. Eso queda en `memory/decisions.md`.

Si `requires_human_decision: true`, NO escribe a memoria — el caller decide qué hacer.

## CLI

```
node src/council.js --council creative-ideation --question "Nombre para mi app" --tier 1 --output result.json
```

Opciones: `--council`, `--config`, `--question`, `--context`, `--tier`, `--output`, `--confirm-expensive`, `--memory-dir`, `--silent`.

## Cómo escala

- **+1 persona**: +1 llamada en R1, +1 en R2, +contexto en síntesis. Costo lineal hasta ~5 personas, luego la síntesis empieza a verse cara por el contexto.
- **+1 ronda**: aumenta latencia y costo lineal. Más rondas raramente mejoran calidad después de R2 (la cross-pollination ya extrajo lo importante).
- **Confidence loop**: hasta 3 iteraciones extra de síntesis. Solo en Tier 3 — para Tier 1/2 es overhead inútil.

## Errores comunes

- `council_not_found`: revisa que el archivo exista en `councils/<name>.json`.
- `invalid_config`: el config no pasó schema. El mensaje lista qué falta.
- `cost_confirmation_required`: pasa `confirmExpensive: true`.
- `insufficient_personas`: menos de 2 personas vivas tras Ronda 1. Casi siempre = API key sin créditos o modelos rotos.
- `invalid_synthesis_json`: el moderador no devolvió JSON parseable. Cambiar `synthesis.model` a uno más obediente con instrucciones (Opus, GPT-5).
