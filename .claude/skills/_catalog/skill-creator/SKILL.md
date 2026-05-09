---
name: skill-creator
description: Genera nuevas skills custom para el proyecto siguiendo la estructura canónica del starter (frontmatter + secciones requeridas + CHANGELOG). Usar cuando el usuario detecta una disciplina recurrente que merece una skill propia y aún no existe en core ni en `_catalog/`.
triggers: ["/skill-creator", "crea una skill", "necesito una skill nueva", "skill custom para X", "agrega skill al catálogo"]
allowed-tools: Read, Write, Edit, Glob
---

# skill-creator — generador de skills nuevas

Genera la estructura mínima invocable de una skill: `SKILL.md` con frontmatter completo y `CHANGELOG.md`. Pensada para que el usuario no tenga que recordar el formato del starter cada vez que quiere agregar una skill.

---

## Cuándo activar esta skill

Activa `skill-creator` cuando:

1. **Identificaste una disciplina recurrente** que se repite en 3+ tareas y aún no está cubierta por una skill core ni del `_catalog/`.
2. **Necesitas formalizar un patrón** que hasta ahora vive en briefs sueltos (lista de pasos, criterios, anti-patrones).
3. El usuario dice explícitamente "crea una skill para X" o invoca `/skill-creator`.

### Cuándo NO activarla

- Si la disciplina ya existe como skill (revisa `_catalog/INDEX.md` primero).
- Si la "skill" sería un wrapper trivial sobre una herramienta existente — eso vive como utility en `src/`, no como skill.
- Si el patrón aplica una sola vez. Skills son para disciplinas recurrentes.

---

## Qué hace

1. Pregunta al usuario el dominio, el problema concreto, los triggers que la dispararían y qué outputs produce.
2. Genera `<nombre>/SKILL.md` con frontmatter (`name`, `description`, `triggers`, `allowed-tools` opcional) + las 4 secciones requeridas:
   - Cuándo activar
   - Qué hace
   - Anti-patrones
   - Próximos pasos
3. Genera `<nombre>/CHANGELOG.md` con versión inicial v0.1.
4. Pregunta al usuario si la skill va al `_catalog/` (opcional) o directo a `.claude/skills/<skill>/` (activa).
5. Después de crearla, recomienda correr `confidence-loop` sobre la skill para llevarla a 95+/100.

---

## Anti-patrones

- **Crear skills genéricas sin triggers concretos.** Si los triggers son vagos ("cuando se necesite"), la skill termina en ruido.
- **Duplicar funcionalidad core.** Antes de crear, verifica `_catalog/INDEX.md` y la lista de skills core en `kickoff/detector.js`.
- **Skills sin sección de "Cuándo NO usar".** Una skill sin criterios de exclusión se aplica fuera de su dominio y rompe contexto.
- **Generar skill completa con todas las best practices en una sola pasada.** Mejor stub funcional + iteración con `confidence-loop`.

---

## Próximos pasos (esta skill es STUB)

- [ ] Agregar plantilla literal de SKILL.md y CHANGELOG.md como archivos referenciables.
- [ ] Integrar `confidence-loop` automáticamente al cerrar la creación.
- [ ] Investigar si conviene script `scripts/new_skill.js` que automatice el scaffolding.
- [ ] Ejemplo end-to-end (crear una skill desde cero con esta misma skill).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de ejemplos completos.
