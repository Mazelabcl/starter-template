# INDEX del catálogo de skills opcionales

Navegación rápida del `_catalog/`. Skills aquí están **disponibles pero no activas por defecto**. Se activan vía `/kickoff` según perfil del proyecto, o manualmente con `cp -r _catalog/<skill> ../<skill>`.

Skills core (siempre activas) NO viven aquí — viven en `.claude/skills/<skill>/`. Lista completa: ver `kickoff/detector.js → CORE_SKILLS`.

## Tabla de skills opcionales

| Skill | Descripción 1 línea | Triggers principales | Para qué tipo de proyecto | Costo |
|---|---|---|---|---|
| `superpowers-pr` | 5 reglas duras para Git/PR/code review formal | "antes de PR", "code review formal", "merge a main" | build con flujo PR formal (equipo, GitHub flow, CI/CD) | sin costo |
| `superpowers-full` | Set completo (~80 skills): spec-driven, TDD estricto, debug riguroso, refactor seguro | "spec driven", "tdd estricto", "refactor seguro" | build complejo (>1000 LOC, equipo exigente) | sin costo |
| `skill-creator` | Genera SKILL.md + CHANGELOG.md en formato del starter | "crea una skill", "skill custom para X" | cualquier proyecto donde aparece disciplina recurrente | sin costo |
| `frontend-design` | Skill oficial Anthropic para diseño UI accesible | "diseña componente", "diseña pantalla web", "landing page" | build con superficie UI (web, dashboard, panel) | sin costo |
| `playwright` | Tests E2E con Playwright (selectores resilientes, traces) | "test e2e", "playwright test", "regresión visual" | build con webapp y flujos críticos a testear | sin costo |
| `webapp-testing` | Estrategia de testing — pirámide saludable (unit/integration/E2E) | "estrategia de testing", "qué test poner" | build sin stack de testing decidido | sin costo |
| `pdf-skill` | Generación, parsing, manipulación de PDFs | "generar pdf", "parsear pdf", "extraer texto pdf" | build/business que produce o recibe PDFs | sin costo |
| `xlsx` | Lectura/escritura/generación de Excel | "generar excel", "leer xlsx", "parsear planilla" | business donde el cliente vive en planillas | sin costo |
| `canvas-design` | Diseño programático en canvas/SVG (D3, p5, three) | "svg generativo", "infografía programática", "p5js" | content/build con visualización custom | sin costo |
| `brand-guidelines` | Mantiene `content/brand.md` con identidad visual + voz | "guía de marca", "identidad visual", "tokens de color" | content recurrente, business con marca, build con UI | sin costo |
| `marketing` | Copy publicitario, posts, anuncios, emails (AIDA, PAS, BAB) | "copy publicitario", "post redes", "email marketing" | business/content con lado comercial | sin costo |
| `seo` | SEO técnico + on-page proyecto-local (meta, schema, headings) | "keyword research", "meta título", "schema markup" | build/business/content con sitio web público | sin costo |
| `remotion` | Video programático con React (data-driven, server-side render) | "video programático", "remotion", "lyric video" | content/marketing con videos personalizados | sin costo |
| `web-artifacts-builder` | HTML+JS+CSS autocontenido (demos, prototipos one-off) | "artifact web", "demo en html", "calculadora interactiva" | prototipos, demos, herramientas one-off | sin costo |
| `dual-auditor-protocol` | Audita un deliverable con DOS modelos en paralelo (Claude + GPT) + synthesizer que cruza findings | "audit con doble auditor", "audit con dos modelos", "/dual-audit", "audit de código de producción" | build/business-with-software con código de producción, audits de alto riesgo | ~2.5× costo de un audit single (3 calls) |
| `review-app` | App HTTP local (Node nativo, cero deps) para revisar PRs/bloques de un sprint marcando OK/Feedback. Modo viewer: lee cualquier `.md` de un directorio con TLDR. Cross-sprint, cross-project, hot-reload | "review-app", "revisar PRs en HTTP", "marcar OK/Feedback", "/review-app", "ver output de agentes" | build/business-with-software con audits de código o entregables que necesitan review humano repetido | sin costo |
| `client-language` | Fuerza lenguaje humano sin jerga técnica cuando el deliverable es para cliente/audiencia final. Lista negra de términos + reemplazos | "lenguaje de cliente", "sin jerga técnica", "para el cliente", "audiencia no técnica", "/client-language" | business/content/marketing con audiencia final no técnica | sin costo |
| `non-technical-cold-reader` | Gate binario GO/NO-GO que veta un deliverable de cliente si contiene jerga técnica. Complemento de `client-language` (esa reescribe, esta veta) | "veta jerga técnica", "lo entendería un no técnico", "cold reader no técnico", "/non-technical-cold-reader" | business/content/marketing antes de mostrar al cliente final | sin costo |

Total: 18 skills opcionales en `_catalog/`.

> **Fuente machine-readable:** `_catalog/skills-catalog.json` es la fuente única para el kickoff (lista core + catalog con `triggers`, `when_to_use`, `output`, `status`, `cost_hint`). Este INDEX.md es la vista humana. El JSON se regenera con `node scripts/build_skills_catalog.js`. Si agregas/quitas una skill, regenera el JSON y corre `npm run test:skills-catalog`.

## MCPs disponibles (NO son skills — son MCP servers)

Los siguientes son MCP servers (no skills tradicionales). Se instalan distinto: configuración en `~/.claude/settings.json` con bloque `mcpServers`. Detalles en `docs/mcps-recomendados.md`.

| MCP | Para qué sirve | Cuándo activarlo |
|---|---|---|
| **Context7** | Búsqueda semántica sobre codebases grandes | Build/research con codebase >50 archivos donde Grep/Glob no alcanzan |
| **Codebase-memory MCP** | Memoria persistente del codebase entre sesiones | Build de larga duración (>1 mes) con muchas decisiones acumuladas |
| **Obsidian-MCP** | Integra notas/research en Obsidian con Claude | Research/personal con vault Obsidian existente |
| **Firecrawl** | Scraping web optimizado para LLMs (extrae estructura) | Research que requiere pulling de fuentes externas masivamente |
| **GitHub MCP** | Lectura/escritura sobre repos, issues, PRs | Build con GitHub flow real, gestión de issues automatizada |

Cómo agregar un MCP: ver `docs/mcps-recomendados.md` y la doc oficial de cada uno.

## Diferencia rápida con skills core

| | Core | Catálogo |
|---|---|---|
| Ubicación | `.claude/skills/<skill>/` | `.claude/skills/_catalog/<skill>/` |
| Activación | Automática, siempre | Manual o vía kickoff |
| Disciplina | Universal | Específica de un perfil |
| Ejemplo | `quality-mindset`, `pipeline-v2` | `playwright`, `marketing` |

## Cómo agregar una skill nueva al catálogo

1. Crea `_catalog/<skill-name>/SKILL.md` con frontmatter (`name`, `description`, `triggers`, `allowed-tools` opcional) + las 4 secciones requeridas: Cuándo activar, Qué hace, Anti-patrones, Próximos pasos.
2. Crea `_catalog/<skill-name>/CHANGELOG.md` con versión inicial.
3. Agrega fila a la tabla de este INDEX.
4. Si la skill aplica a un perfil específico, agrégala a `STACK_BY_TYPE` en `kickoff/detector.js` con un `why` claro.
5. Corre `confidence-loop` sobre la skill nueva para llevarla a 95+/100.

## Estado de las skills (Sprint 5.2)

Casi todas las skills del catálogo son **stubs funcionales v0.1**: invocables (frontmatter completo + 4 secciones requeridas) pero pendientes de profundización con best practices completas, templates literales, ejemplos end-to-end. Cada SKILL.md lista en su sección "Próximos pasos" qué le falta para llegar a v1.0.

La excepción es `superpowers-pr`, que llegó a v2.0 en Sprint 3.2 con contenido completo y refinado.
