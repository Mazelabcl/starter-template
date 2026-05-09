# INDEX — router de archivos del proyecto

> Cada agente carga SOLO los archivos relevantes a su tarea. No el repo entero. Este INDEX dice qué cargar para qué.

## Tabla de carga obligatoria por tarea

| Tarea | Carga obligatoria | Carga si aplica |
|---|---|---|
| Cualquier output | `content/principles.md` + este INDEX + `memory/decisions.md` | `memory/lessons.md` si hay aprendizaje relevante |
| Texto narrativo / pitch / contenido | + glosario, lore, ejemplos previos del proyecto | concept arts contextuales |
| Visual / imagen | + style-guide, char-sheets relevantes | brand-guidelines del cliente |
| Personaje o entidad nueva | + lore, canon-cast | research previo si hay |
| Código | + módulo(s) relevante(s) | tests, docs |
| Decisión de proceso | + `memory/decisions.md` completo | sprint-log para contexto |

## Archivos canónicos del proyecto

- `content/principles.md` — qué ES y qué NO ES (Capa 0 del pipeline v2)
- `content/INDEX.md` — este archivo
- `memory/project-profile.json` — perfil del proyecto (tipo, modo, owner, stack)
- `memory/decisions.md` — decisiones humanas (ley)
- `memory/lessons.md` — lessons del proyecto
- `memory/active-team.json` — agentes y skills activos
- `memory/sprint-log.md` — sprints cerrados con sus deliverables y lessons
- `roadmap/roadmap.md` — sprint actual y backlog
- (añadir aquí archivos que se vayan creando: lore.md, style-guide.md, char-sheets/, docs/AS-IS.md, etc.)

## Reglas de carga

1. **No cargues el repo entero.** Solo lo que esta tabla indica para tu tarea concreta.
2. **Principles primero, literal.** Sin resumir. Si tu output va a contradecirlos, frena.
3. **Decisions es ley.** Si una decisión registrada bloquea tu propuesta, no la propongas — pregunta.
4. **Si el archivo no existe**, no lo inventes. Reporta al orquestador que falta y pide que lo cree el agente correspondiente.

## Versión

v0 — {{FECHA}} — generado por la skill `/kickoff` v3.
