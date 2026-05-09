# quality-mindset — CHANGELOG

## v1.0 — 2026-05-09 (Sprint 3.1)

Primera versión de la skill. Criada del replanteamiento de `superpowers-lite` + ampliación a tareas no-código.

### Razón de existir

`superpowers-lite` (versión vieja, pre-v3) era 100% Git/PR/code-review. Solo aplicaba a flujos formales con PRs en GitHub. En la práctica, Aldo (vibe coder, dueño de Mazelab) NUNCA la había invocado — porque no abre PRs formales. La skill estaba presente pero muerta.

`quality-mindset` cubre el vacío real: la disciplina mínima viable aplicable a CUALQUIER tipo de tarea no trivial — research, ideación, código, contenido, decisiones. No reemplaza a las otras skills core, las antecede y se conecta con ellas.

### Agregado

- **Las 4 disciplinas como columna vertebral**: spec mínimo (antes) → plan visible (antes) → ejecución con validación intermedia (durante) → cierre validado (después). Cada una con qué es, por qué importa, ejemplo concreto y anti-patrón.
- **Disciplina Git baseline** sin ceremonia de PRs. Define qué SÍ (commits cuando un cambio lógico está completo, mensajes imperativos descriptivos, branch para features grandes) y qué NO (PRs formales, commits "wip"/"fix", commits gigantes, branches obligatorias).
- **Tabla de mensajes de commit bueno vs malo** con 7 ejemplos contrastantes y patrón sugerido (`<verbo imperativo> <qué> [<por qué si no es obvio>]`).
- **Conexión explícita con karpathy-rules**: las 4 reglas Karpathy son la versión específica para código de la disciplina 3 (ejecución con validación intermedia). No reemplazan, anidan.
- **Conexión explícita con pipeline-v2**: las 5 capas de pipeline-v2 son la implementación específica de quality-mindset cuando la tarea es crear un artefacto creativo no trivial. Quality-mindset es más amplio.
- **3 ejemplos end-to-end contrastantes**: tarea de código (fix de bug en API), tarea creativa (nombre de producto B2B), tarea de research (mercado de starter templates).
- **Sección Anti-patrones** con 10 patrones específicos (no genéricos), cada uno con explicación de por qué falla.
- **Integración con memoria** (`addDecision`, `addLesson`) con regla del pulgar: solo loguear lo que tendría valor recordar en 6 meses.

### Filosofía codificada

- Skill **opinada**, no manual de procesos. Vibe coders se aburren con manuales.
- **Ejemplos reales**, no abstractos.
- Anti-patrones **específicos**, no genéricos.
- **Cero jerga innecesaria**. "Spec" se explica en una frase la primera vez.
- Spec en 3 líneas máximo (Problema | Criterio éxito | Tiempo). Si no cabe, no es spec.
- Plan en 2-5 bullets máximo. Si tiene sub-bullets de sub-bullets, ya no es plan.
- 4 disciplinas, no 7. Las que NO eliminé son las que SIEMPRE valen la pena.

### Relación con superpowers-lite

`superpowers-lite` se mueve a `_catalog/superpowers-pr/` (Sprint 3.2 lo hará en paralelo). Sigue disponible como skill opcional para proyectos con equipo formal y PRs en GitHub. NO se borra — se desactiva del default y queda disponible si el contexto cambia.

### Breaking changes

Ninguno. `quality-mindset` es skill nueva, no reemplaza a otra activa. `karpathy-rules` y `pipeline-v2` siguen funcionando idénticas — esta skill las anida, no las modifica.
