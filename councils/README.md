# Councils

Councils son grupos de personas (LLMs con personalidad y rol asignados) que deliberan sobre una pregunta y producen una decisión mejor que cualquiera de ellas individualmente. Funcionan con el motor de `src/council.js` (Sprint 4.2) y el cliente unificado de OpenRouter (`src/openrouter_client.js`).

## Filosofía de diseño

Cuando armé estos councils me obsesioné con una sola cosa: **cada persona debe traer una perspectiva DISTINTA, no ser una variante del mismo arquetipo**. Tres optimistas no es un council, es un grupo de WhatsApp. Tres pesimistas tampoco. Lo que produce buenas decisiones es la fricción entre lentes que no comparten supuestos.

Reglas que apliqué a cada council:

1. **Perspectivas, no estilos.** El visionary, el devils_advocate y el executor del Creative Council no son la misma persona con tres tonos. Ven el mundo distinto: uno busca esencia, otro busca puntos ciegos, otro busca el siguiente paso del lunes.
2. **Modelos distintos por persona.** Mezclamos Anthropic, OpenAI y DeepSeek para evitar el sesgo compartido del entrenamiento. Si las 3 voces fueran del mismo proveedor, sus blind spots colapsan.
3. **Temperatura modulada por rol.** El visionario corre en `0.8-0.9` (queremos divergencia). El operador corre en `0.4-0.5` (queremos consistencia y rigor).
4. **Tools opcionales y dirigidos.** Solo el devils_advocate del Creative Council tiene `perplexity_research` — es quien necesita datos para criticar. No todos los miembros usan tools, porque el ruido cuesta dinero y latencia.
5. **`actua_como` específico, evocativo, anti-genérico.** "Eres un crítico" es vacío. "Eres un crítico ácido tipo Kara Swisher que pregunta lo que nadie quiere preguntar" tiene fuerza. Cada `actua_como` cita un arquetipo real, una pregunta canónica, y un anti-patrón que el modelo debe evitar.

## Los 4 councils predefinidos

| Council | Tier | Perspectivas | Cuándo invocar |
|---|---|---|---|
| `creative-ideation` | 1 | visionary + devils_advocate + executor | Naming, brainstorming abierto, ideación de producto, tagline, copy. |
| `architecture-decision` | 3 | senior_architect + performance_freak + security_paranoid | Decisiones técnicas con costo de cambio alto: monolito vs microservicios, elección de DB, esquema de auth. |
| `strategy-calls` | 2 | visionary_naval + operator_bezos + skeptic_pro | Decisiones estratégicas: pricing, timing de lanzamiento, priorización de roadmap, posicionamiento. |
| `mazelab-council` | 2 | mazelab_visionary + mazelab_operator + mazelab_creative | Decisiones específicas del contexto Mazelab (negocio + plataforma de marketing + comunidad filantrópica con webserie + apoyo a la pareja). |

## Tier system

| Tier | Costo aproximado | Estructura | Cuándo |
|---|---|---|---|
| 1 | USD 0.02 a 0.10 por consulta | round1 únicamente, sin cross-pollination | Decisiones reversibles, ideación, naming. |
| 2 | USD 0.15 a 0.60 por consulta | round1 + round2 con cross-pollination, synthesis Opus | Decisiones estratégicas con costo medio. |
| 3 | USD 0.80 a 2.50 por consulta | round1 + round2, synthesis Opus, `confidence_loop: true` post-synthesis | Decisiones irreversibles, arquitectura, contratos legales. |

Costos calculados sobre los `cost_per_1m_input` y `cost_per_1m_output` de los modelos elegidos asumiendo prompts de 2-4k tokens y respuestas de 500-1500 tokens por persona y ronda.

## Cómo invocar

### Vía CLI (cuando Sprint 4.2 termine `src/council.js`)

```bash
node src/council.js --council creative-ideation --question "Necesito naming para una plataforma de auditoría de campañas de marketing dirigida a agencias chilenas. Tono: profesional pero con personalidad."
```

### Vía API programática

```js
import { runCouncil } from './src/council.js';
import config from './councils/architecture-decision.json' with { type: 'json' };

const result = await runCouncil(config, {
  question: 'Estoy construyendo una plataforma multi-tenant de marketing. ¿Monolito Node + Postgres con schemas por tenant, o microservicios desde el día 1?',
  context: 'Equipo de 1 persona (yo, vibe coder), ~50 clientes objetivo en 12 meses, presupuesto cloud bajo.',
});

console.log(result.synthesis);
console.log('Costo estimado:', result.usage.cost_usd_estimated);
```

El motor de `src/council.js` expone (Sprint 4.2):
- `runCouncil(config, { question, context, signal })` — corre el council completo, retorna `{ round1, round2?, synthesis, usage, model_trace }`.
- `loadCouncil(name)` — carga un JSON desde `councils/<name>.json`.

## Cómo crear un council custom

1. Copia uno de los 4 JSONs como base (`creative-ideation.json` para Tier 1, `strategy-calls.json` para Tier 2, `architecture-decision.json` para Tier 3).
2. Ajusta `name` (kebab-case) y `description`.
3. Reemplaza las personas:
   - `id` en snake_case.
   - `actua_como` con un párrafo específico (mínimo 100 caracteres, idealmente 300+). Cita un arquetipo, una pregunta canónica del rol, y un anti-patrón.
   - `model` debe ser un slug que existe en `MODELS` de `src/openrouter_client.js`.
   - `temperature` calibrada al rol (0.4 para críticos rigurosos, 0.7-0.9 para divergentes).
   - `tools` solo si la persona necesita datos externos.
4. Ajusta `rounds.round1.instructions` y, si es Tier 2 o 3, `rounds.round2.instructions`.
5. Define `synthesis.model` y `synthesis.instructions` con estructura de salida concreta (consensus / tensions / options / recommendation, etc.).
6. Decide `post_synthesis.confidence_loop` — `true` solo para Tier 3 o decisiones críticas.
7. Corre `node councils-config.test.js` para validar.

## Mazelab Council — propuesta default

`mazelab-council.json` es una **propuesta default que Claude armó para Aldo**. La composición actual es:

- **mazelab_visionary** (estilo Naval Ravikant) — leverage, asymmetric bets, specific knowledge.
- **mazelab_operator** (estilo Jeff Bezos) — customer obsession, day-1, reversible vs irreversible.
- **mazelab_creative** (estilo Rick Rubin) — preguntas obvias, esencia, observación sin imponer.

**Aldo: revisa esta composición**. Si tienes mentores reales, advisors específicos, o quieres que tu pareja sea una de las voces (con su perspectiva real, no un arquetipo), edita `mazelab-council.json` directamente. Algunas alternativas razonables que podrías querer:

- Reemplazar `mazelab_creative` por una voz que represente a tu pareja, con `actua_como` redactado a partir de cómo ella piensa los emprendimientos.
- Reemplazar `mazelab_visionary` por un mentor real que ya tienes (con su perspectiva, no la de Naval).
- Agregar un cuarto miembro si quieres una voz que represente a la comunidad filantrópica con webserie animada.

El motor de councils acepta cualquier número de personas (típicamente 3 a 5). Más allá de 5 el costo y latencia explotan y la síntesis se diluye.

## Tools disponibles

Los `tools` referenciados por las personas son etiquetas semánticas que el motor de `src/council.js` (Sprint 4.2) resuelve internamente:

- `perplexity_research` — busca en internet vía Perplexity Sonar.
- `code_simulation` — corre snippets de código en sandbox para validar performance o lógica.

Si una persona no tiene tools, recibe el array vacío `[]`.
