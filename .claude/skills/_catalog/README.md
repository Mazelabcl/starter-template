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

Razón: cargar 19 skills "por si acaso" termina en ruido y skills muertas que el usuario nunca invocó. Mejor catalogo curado + activación deliberada.

## Skills disponibles en `_catalog/`

Tabla completa con triggers y casos de uso: ver `INDEX.md`. Resumen aquí:

| Skill | Para qué sirve | Cuándo activarla |
|---|---|---|
| `superpowers-pr` | 5 reglas duras para Git/PR/code review formal | Solo proyectos con flujo Git/PR formal. Si trabajas solo, usa `quality-mindset` (core). |
| `superpowers-full` | Set completo (~80 skills) — spec-driven, TDD estricto, refactor seguro | Proyectos build de complejidad alta donde `quality-mindset` no alcanza. |
| `skill-creator` | Genera nuevas skills custom con frontmatter + 4 secciones requeridas | Cuando aparece disciplina recurrente sin cobertura existente. |
| `frontend-design` | Skill oficial Anthropic para UI accesible y semántica | Build con superficie web (landing, dashboard, panel admin). |
| `playwright` | Tests E2E con selectores resilientes | Build con webapp y flujos críticos. |
| `webapp-testing` | Estrategia de pirámide (unit/integration/E2E) | Build sin stack de testing decidido. |
| `pdf-skill` | Generación, parsing y manipulación de PDFs | Build/business que produce o recibe PDFs. |
| `xlsx` | Lectura/escritura/generación de Excel | Business donde el cliente vive en planillas. |
| `canvas-design` | Visualización programática (D3, p5, SVG) | Content/build con visualización custom no rasterizada. |
| `brand-guidelines` | Mantiene `content/brand.md` con identidad + voz | Content recurrente, business con marca, build con UI. |
| `marketing` | Copy publicitario con frameworks (AIDA, PAS, BAB) | Business/content con lado comercial. |
| `seo` | SEO técnico + on-page proyecto-local | Build/business/content con sitio web público. |
| `remotion` | Video programático React-based | Content/marketing con videos data-driven. |
| `web-artifacts-builder` | HTML autocontenido (demos, prototipos one-off) | Demos, prototipos, herramientas one-off. |

Sprint 5.2 pobló este catálogo a partir del análisis de skills curadas que vio Aldo. Casi todas son **stubs funcionales v0.1** (invocables pero pendientes de profundización). La excepción es `superpowers-pr`, que llegó a v2.0 en Sprint 3.2.

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
