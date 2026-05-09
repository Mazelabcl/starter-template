# Hand-off contracts

## Qué problema resuelve

En un pipeline multi-agente cada agente produce un archivo y el siguiente agente lo consume. Cuando los agentes no se comunican bien (campos faltantes, paths rotos, JSON malformado, schema cambiado en silencio), el agente B trabaja sobre data corrupta y el bug aparece dos pasos después, lejos de la causa.

Este sistema fuerza un contrato explícito en cada hand-off:

- el agente productor declara qué produce y contra qué schema
- el agente consumidor declara qué espera y contra qué schema
- antes de que el consumidor procese, el contrato se valida
- si falla, error claro al instante con el path exacto que rompió

No reemplaza tests ni revisión humana. Detecta el subconjunto de bugs que se filtran entre agentes por incompatibilidad de formatos.

## Estructura

```
contracts/
  README.md             este archivo
  validator.js          validación contra JSON Schema (CLI + API)
  helpers.js            emitOutput / consumeInput / declareContract
  test.js               test de smoke del flujo completo
  schemas/              schemas iniciales (architect, critic, cold-reader, image-gen, research)
  declared/             contratos declarados por agente (auditoría, generado en runtime)
```

## Cómo declarar un contract para un agente nuevo

Un contract describe inputs, outputs, precondiciones y postcondiciones de un agente. Se declara una sola vez al cargar el agente (o al inicio del pipeline) y queda persistido en `contracts/declared/<agent>.json` para auditoría posterior.

```js
import { declareContract } from './contracts/helpers.js';

declareContract({
  agent: 'architect-pax',
  inputs: [
    { schema: 'research-output', path: 'content/research/world.json', optional: true },
  ],
  outputs: [
    { schema: 'architect-output', path: 'content/architect/proposal.json' },
  ],
  preconditions: ['content/principles.md existe y no está vacío'],
  postconditions: ['proposal.json tiene al menos 1 section'],
});
```

Las precondiciones/postcondiciones son texto humano. No se evalúan automáticamente — sirven para que el orquestador o un humano decida si lanzar al agente. Si más adelante quieres precondiciones ejecutables, hay `assertFileExists(label, path)` en `helpers.js`.

## Cómo se valida en cada hand-off

Dos puntos de validación:

1. **Al emitir.** El productor llama `emitOutput(agent, schemaId, output, path)`. Valida contra el schema antes de escribir. Si falla, lanza `ContractViolation` y no escribe nada — así no contamina disco con archivos corruptos.

2. **Al consumir.** El consumidor llama `consumeInput(agent, expectedSchemaId, path)`. Re-valida antes de procesar. Detecta si el archivo fue modificado a mano, si el schema evolucionó, o si el productor era de una versión vieja.

Ambas funciones lanzan `ContractViolation` (extiende `Error`) con mensajes legibles que indican agente, schema, path y campo específico que falló.

## Ejemplos copy-pasteables

### 1. Architect emite, Critic consume

```js
import { emitOutput, consumeInput } from './contracts/helpers.js';

const proposal = {
  agent: 'architect-pax',
  model: 'claude-opus-4-7',
  produced_at: new Date().toISOString(),
  artifact_kind: 'capitulo',
  title: 'Cap 03 — El Espejo',
  sections: [
    { id: 's1', heading: 'Apertura', intent: 'tono y locación' },
    { id: 's2', heading: 'Conflicto', intent: 'detonante', depends_on: ['s1'] },
  ],
};

emitOutput('architect-pax', 'architect-output', proposal, 'content/architect/cap03.json');

const consumed = consumeInput('critic-pax', 'architect-output', 'content/architect/cap03.json');
console.log(consumed.title);
```

### 2. Cold reader gate

```js
import { emitOutput } from './contracts/helpers.js';

emitOutput('cold-reader', 'cold-reader-output', {
  agent: 'cold-reader',
  model: 'claude-opus-4-7',
  produced_at: new Date().toISOString(),
  target_artifact: 'content/architect/cap03.json',
  vote: 'NO-GO',
  reason: 'el capítulo viola principio P03: protagonista actúa fuera de carácter',
  blocking_principles: ['P03'],
}, 'content/cold-reader/cap03.json');
```

Si pasas `vote: 'NO-GO'` sin `reason`, el contrato falla — la regla de oro del cold reader.

### 3. Validación CLI (útil en pre-commit hooks o CI)

```bash
node contracts/validator.js validate architect-output content/architect/cap03.json
node contracts/validator.js list
```

Exit code 0 si valida, 1 si no, 2 si los argumentos están mal.

## Schemas iniciales

| Schema id              | Producido por                          |
|------------------------|----------------------------------------|
| `architect-output`     | Capa 1 — Architect                     |
| `critic-output`        | Capa 2 — Critic interno multi-óptica   |
| `cold-reader-output`   | Capa 3 — Cold reader gate              |
| `image-gen-output`     | Skill image-gen (gpt-image-2)          |
| `research-output`      | `src/research.js` (Perplexity)         |

Para añadir uno nuevo: deja un archivo `<id>.schema.json` en `schemas/` con `$id` y `$schema` declarados. El validator los descubre al arranque.

## Convenciones de diseño

- **Estricto pero no claustrofóbico.** `additionalProperties: false` por defecto para detectar fields que se cuelan por error. Si necesitas extensión, agrega el field al schema.
- **`produced_at` y `model` en todos los outputs.** Es el mínimo para reproducibilidad y auditoría.
- **Mensajes de error en español.** El usuario es novato, los errores tienen que leerse claros.
- **Cero dependencias más allá de ajv.** Mantener el footprint pequeño.

## Test

```bash
node contracts/test.js
```

Demuestra: éxito de hand-off válido, rechazo de output incompleto, error claro ante schema desconocido.
