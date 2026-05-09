---
name: superpowers-full
description: Versión completa del set de superpowers (spec-driven development, code review profundo, debug disciplinado, refactor seguro). Aplica a proyectos software de complejidad media-alta donde la disciplina ligera de `quality-mindset` y las 5 reglas de `superpowers-pr` no alcanzan. Importa el set completo de [obra/superpowers](https://github.com/obra/superpowers) (~80 skills) y deja al usuario activar las sub-skills que necesite.
triggers: ["/superpowers-full", "spec driven", "code review profundo", "debug riguroso", "refactor seguro", "tdd estricto"]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# superpowers-full — disciplina software completa

Diferencia clara con las otras dos:

- **`quality-mindset`** (core) — disciplina universal mínima viable. Aplica a cualquier proyecto, con o sin Git formal.
- **`superpowers-pr`** (catálogo) — 5 reglas duras para Git/PR/code review formal. Solo proyectos con flujo PR real.
- **`superpowers-full`** (catálogo, esta skill) — set completo: spec-driven, TDD estricto, debug riguroso, refactor seguro, branching disciplinado. Para proyectos software complejos donde aporta tener todo el toolkit.

---

## Cuándo activar esta skill

Activa `superpowers-full` solo si tu proyecto cumple uno o más:

1. **Proyecto software de complejidad media-alta** — más de 1000 LOC, varios módulos, equipo o usuario único exigente.
2. **Quieres aplicar TDD estricto o spec-driven development** — escribir spec antes de tocar código, tests antes de implementación.
3. **El proyecto requiere debug riguroso** — bugs intermitentes, race conditions, problemas que no se reproducen fácil.
4. **Necesitas refactor seguro de código legacy** — cambios grandes en código existente con tests insuficientes.

### Cuándo NO activarla

- Proyectos creativos (content, marketing, research). Esto es disciplina software, no creativa.
- Proyectos pequeños donde `quality-mindset` ya cubre lo necesario.
- Vibe coding rápido. La fricción de spec-driven no aporta cuando el objetivo es prototipar.
- Si solo necesitas reglas de PR, usa `superpowers-pr` (más enfocada).

---

## Qué hace

1. Importa el set completo de superpowers como referencia (link al repo upstream).
2. Activa sub-skills según necesidad: `spec-driven-dev`, `tdd-strict`, `debug-rigorous`, `refactor-safe`, `branching-disciplined`, `commit-atomic`, `review-deep`, etc.
3. Aplica disciplina antes de cada cambio: spec → test → implementation → review → commit.
4. Proporciona checklists para cada fase del ciclo de desarrollo.
5. Integra con `superpowers-pr` cuando el proyecto también usa flujo PR formal (no son excluyentes).

---

## Anti-patrones

- **Activar todo el set sin curar.** ~80 skills es ruido. Selecciona las 5-10 que apliquen al proyecto.
- **Aplicar spec-driven a tareas triviales.** Spec antes de cambio de 5 líneas es overhead. Reserva para features no triviales.
- **Mezclar con `quality-mindset` sin claridad.** Si activas `superpowers-full`, deja `quality-mindset` como capa base; no dupliques reglas.
- **Esperar que la skill compile/ejecute código.** Esto es disciplina + checklists, no ejecución automática.

---

## Próximos pasos (esta skill es STUB)

- [ ] Inventariar las ~80 sub-skills del repo upstream (obra/superpowers) y listar las que se traen al starter.
- [ ] Mapear qué sub-skills son core de `superpowers-full` vs opcionales.
- [ ] Integrar `confidence-loop` para validar specs y refactors.
- [ ] Ejemplo end-to-end: spec → tests → implementation → review en un cambio real.
- [ ] Decidir si las sub-skills relevantes se mueven al `_catalog/` como skills independientes (probable: sí, especialmente `spec-driven-dev` y `tdd-strict`).

---

## Referencias upstream

- [obra/superpowers](https://github.com/obra/superpowers) — set completo (~80 skills).
- [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) — selección curada por Karpathy.

---

## Versión

v0.1 stub — Sprint 5.2 — invocable como referencia, pendiente de inventario de sub-skills relevantes.
