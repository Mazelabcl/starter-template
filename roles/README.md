# Fichas de rol

TLDR: una ficha en esta carpeta + el agente general de Claude Code = un especialista al instante. **No hay que reiniciar.**

Claude Code carga `.claude/agents/*.md` solo al iniciar la sesión, así que un agente nuevo exige reiniciar. Una ficha no: su contenido viaja dentro del prompt.

## Ficha o archivo fijo

| Necesitas | Usa |
|---|---|
| Un especialista con personalidad, objetivo y contexto (casi siempre) | **Ficha** en `roles/` |
| Prohibirle herramientas de verdad (por ejemplo, que no pueda escribir) | Ficha con `herramientas_restringidas: true` **y** archivo fijo en `.claude/agents/`, creado con la skill `agent-template`. Hay que reiniciar: `/exit` y luego `claude -c` |

## Cómo se usa

1. `node src/roles.js crear --id seo-local --actua-como "Local SEO specialist, 10 years with neighborhood shops, obsessed with map-pack rankings." --objetivo "Make the landing rank for neighborhood searches." --modelo sonnet --contexto content/principles.md`
   (esto crea `roles/seo-local.md` y lo registra en `memory/active-team.json`)
2. `node src/roles.js prompt seo-local "Revisa los títulos de la landing"`
   (esto imprime el prompt completo: rol, objetivo, instrucciones, archivos de contexto, tarea y regla de idioma)
3. El orquestador llama a su herramienta Agent con `subagent_type: general-purpose`, ese prompt y `model` de la ficha (`--json` entrega los tres campos listos).

`node src/roles.js list` muestra las fichas y avisa cuáles están inválidas.

## Formato

```markdown
---
id: seo-local
actua_como: "Local SEO specialist, 10 years with neighborhood shops, obsessed with map-pack rankings."
objetivo: "Make the landing rank for neighborhood searches."
modelo: sonnet
contexto:
  - "content/principles.md"
herramientas_restringidas: false
---

- Stay inside the objective; if the task needs something else, say so instead of doing it.
- Do not invent search volumes: mark them as needing research.
```

| Campo | Qué es |
|---|---|
| `id` | Minúsculas y guiones. Igual al nombre del archivo. |
| `actua_como` | Persona en inglés: especialidad, años, qué le obsesiona. Misma idea que `actua_como` en `councils/personas/`. |
| `objetivo` | Qué debe lograr en este proyecto, en inglés. |
| `modelo` | `haiku`, `sonnet`, `opus` o vacío (hereda el del orquestador). |
| `contexto` | Archivos que lee antes de empezar. Relativos al proyecto, sin `..`, sin `.env` ni `.git`. |
| `herramientas_restringidas` | `true` solo si el rol necesita un archivo fijo de agente. |
| Cuerpo | Instrucciones breves en inglés. |

Las instrucciones van en inglés; la salida del agente, en español neutro (la regla la agrega `src/roles.js` al componer el prompt). El formato se valida con `roles/role.schema.json`.

Con `herramientas_restringidas: true`, `prompt` avisa y `--json` entrega como `subagent_type` el agente fijo: el agente general tendría todas las herramientas.
