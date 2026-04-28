---
name: karpathy-rules
description: 4 reglas core de coding (de Andrej Karpathy) que Claude debe aplicar siempre al escribir código.
---

# karpathy-rules

Reglas extraídas literal del repo [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) (CLAUDE.md), basado en [observaciones de Andrej Karpathy](https://x.com/karpathy/status/2015883857489522876) sobre errores típicos de LLMs al codear.

**Tradeoff:** estas reglas priorizan cautela sobre velocidad. Para tareas triviales (typo, one-liner obvio), usa criterio.

---

## 1. Think Before Coding

**No asumas. No escondas confusión. Saca a la luz los tradeoffs.**

Antes de implementar:
- Declara tus supuestos explícitamente. Si tienes dudas, pregunta.
- Si hay múltiples interpretaciones, presenta todas — no elijas en silencio.
- Si existe un enfoque más simple, dilo. Empuja de vuelta cuando corresponda.
- Si algo no está claro, frena. Nombra qué te confunde. Pregunta.

## 2. Simplicity First

**El mínimo código que resuelve el problema. Nada especulativo.**

- Sin features más allá de lo pedido.
- Sin abstracciones para código de uso único.
- Sin "flexibilidad" o "configurabilidad" no solicitada.
- Sin manejo de errores para escenarios imposibles.
- Si escribiste 200 líneas y podían ser 50, reescríbelo.

**El test:** ¿Diría un ingeniero senior que esto está sobrecomplicado? Si sí, simplifica.

## 3. Surgical Changes

**Toca solo lo que debes. Limpia solo tu propio desorden.**

Cuando edites código existente:
- No "mejores" código adyacente, comentarios o formato.
- No refactorices cosas que no están rotas.
- Imita el estilo existente, aunque tú lo harías distinto.
- Si ves código muerto no relacionado, menciónalo — no lo borres.

Cuando tus cambios dejen huérfanos:
- Elimina imports/variables/funciones que TUS cambios dejaron sin uso.
- No elimines código muerto preexistente sin que te lo pidan.

**El test:** cada línea cambiada debe trazarse directamente a la solicitud del usuario.

## 4. Goal-Driven Execution

**Define criterios de éxito. Itera hasta verificar.**

Transforma tareas imperativas en objetivos verificables:

| En vez de... | Transforma a... |
|--------------|-----------------|
| "Agrega validación" | "Escribe tests para inputs inválidos, y haz que pasen" |
| "Arregla el bug" | "Escribe un test que lo reproduzca, y haz que pase" |
| "Refactoriza X" | "Asegura que los tests pasen antes y después" |

Para tareas multi-paso, declara un plan breve:

```
1. [Paso] → verifica: [check]
2. [Paso] → verifica: [check]
3. [Paso] → verifica: [check]
```

Criterios fuertes permiten que el LLM itere solo. Criterios débiles ("haz que funcione") obligan a clarificar a cada rato.

---

**Estas reglas funcionan si ves:** menos cambios innecesarios en diffs, menos reescrituras por sobrecomplicación, preguntas clarificadoras antes de implementar (no después del error), PRs limpios sin refactors paralelos.
