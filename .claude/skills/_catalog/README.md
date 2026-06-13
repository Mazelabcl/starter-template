# `_catalog/` — skills opcionales

Este directorio contiene skills **disponibles pero no activas por defecto**. Existen como recursos curados que el `kickoff` activa según el perfil del proyecto, o que el usuario puede mover manualmente cuando las necesita.

## Filosofía

El starter no carga toda skill que existe. Solo las **core** (siempre activas, definidas en `kickoff/detector.js → CORE_SKILLS`) acompañan cada proyecto sin discusión:

- `pipeline-v2`
- `cold-reader-gate`
- `multimodal-validation`
- `karpathy-rules`
- `confidence-loop`
- `agent-template`
- `quality-mindset` (core en v3, cubre disciplina sin Git formal)
- `council` (core en v3 desde Sprint 4.4, requiere estar siempre cargada para auto-detectar señales de decisiones que ameritan deliberación multi-modelo)

El resto vive acá. El `kickoff` lee el perfil del proyecto (tipo, tamaño, modo) y propone qué skills opcionales activar. El usuario aprueba antes de mover nada.

Razón: cargar toda skill "por si acaso" termina en ruido y skills muertas que el usuario nunca invocó. Mejor catalogo curado + activación deliberada.

## Skills disponibles en `_catalog/`

El catálogo completo y vigente (skills, triggers, `when_to_use`, status, costo) vive en `INDEX.md`. La fuente machine-readable es `skills-catalog.json` (regenerable con `node scripts/build_skills_catalog.js`). No dupliques la lista aquí — `INDEX.md` es la vista humana y el JSON es la fuente única (D9).

MCPs (Context7, Codebase-memory, Obsidian-MCP, Firecrawl, GitHub MCP) NO viven en este catálogo porque no son skills tradicionales — son MCP servers. Detalles en `docs/mcps-recomendados.md`.

## Cómo activar una skill manualmente

### Opción A — copiar (recomendada en Windows)

```bash
cp -r .claude/skills/_catalog/<skill> .claude/skills/<skill>
```

La skill queda activa en el proyecto. Los cambios futuros al catálogo no la afectan.

### Opción B — symlink (Linux/macOS o Windows con symlinks habilitados)

```bash
ln -s ../_catalog/<skill> .claude/skills/<skill>
```

La skill activa apunta al catálogo. Cualquier mejora al catálogo se refleja al instante.

### Opción C — vía kickoff

Cuando corres `/kickoff`, el detector recomienda las skills opcionales que aplican a tu perfil. Si aceptas, kickoff las copia desde `_catalog/` a `.claude/skills/` automáticamente.

## Cómo agregar una skill nueva al catálogo

1. Crea `_catalog/<skill-name>/SKILL.md` con frontmatter completo (`name`, `description`, `triggers`).
2. Agrega una sección "Cuándo activar esta skill" con criterios concretos. Si los criterios son vagos, la skill termina en ruido.
3. Agrega `_catalog/<skill-name>/CHANGELOG.md` con el origen y versión inicial.
4. Actualiza la tabla de este README.
5. Si la skill aplica a un perfil específico, agrégala al `STACK_BY_TYPE` en `kickoff/detector.js` con un `why` claro.

## Diferencia con skills core

| | Core | Catálogo |
|---|---|---|
| Ubicación | `.claude/skills/<skill>/` | `.claude/skills/_catalog/<skill>/` |
| Activación | Automática, siempre | Manual o vía kickoff según perfil |
| Disciplina aplicable | Universal (cualquier tipo de proyecto) | Específica de un perfil o flujo |
| Ejemplo | `quality-mindset`, `karpathy-rules` | `superpowers-pr`, `seo` |
