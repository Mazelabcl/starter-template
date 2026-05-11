# Decisiones del proyecto

Las decisiones registradas en este archivo son del **proyecto consumer** (lo que tú decides para tu proyecto al usar el starter), NO del starter mismo.

Para registrar una decisión, usa `addDecision()` del módulo `src/memory.js`:

```js
import { addDecision } from './src/memory.js';
addDecision({
  title: 'Título corto',
  decision: 'Qué se decidió',
  reasoning: 'Por qué',
  alternatives: 'Qué se descartó y por qué',
  reversibility: 'alta' // | 'media' | 'baja'
});
```

Las decisiones del starter mismo (cómo se construyó) viven en `process-log/00-decisions.md`.
