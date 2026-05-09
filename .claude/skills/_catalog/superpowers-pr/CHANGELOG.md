# CHANGELOG — superpowers-pr

## v2.0 — 2026-05-09 (Sprint 3.2 v3)

### Cambios

- **Renombrada** de `superpowers-lite` a `superpowers-pr`. El nombre nuevo deja claro el dominio (Pull Requests / code review formal) y evita la confusión de "lite" como sinónimo de "general".
- **Movida** de `.claude/skills/superpowers-lite/` a `.claude/skills/_catalog/superpowers-pr/`. Ahora vive en el catálogo de skills opcionales.
- **Scope clarificado**: la skill ya NO se activa por defecto. Aplica solo a proyectos con flujo Git/PR formal (equipo, GitHub flow real, open source con conventional commits, o CI/CD que depende de PRs).
- **Description reformulada** para que `kickoff` la pueda activar automáticamente solo cuando el perfil del proyecto la requiera.
- **Triggers acotados** a contextos PR-específicos: `/superpowers-pr`, `antes de PR`, `code review formal`, `merge a main`, `abrir pull request`, `review de PR`. Se quitaron triggers genéricos.
- **Sección nueva "Cuándo activar esta skill"** al inicio con 4 criterios concretos + criterio de exclusión explícito (si trabajas solo y no abres PRs, usa `quality-mindset`).
- **Contenido core preservado**: las 5 reglas (problema real, búsqueda de PRs previos, un problema = un PR, template completo, diff a humano antes de submit) se mantienen, con afinaciones menores para que el lenguaje sea consistente con el scope nuevo.

### Breaking change

Si tu proyecto referenciaba `superpowers-lite` por nombre (en briefs, comandos, scripts, prompts), la referencia ahora rompe. Migración:

- **Si lo usabas para disciplina general (commits, branches, calidad sin PRs formales)** → reemplaza por `quality-mindset` (skill core nueva en v3, siempre activa, cubre exactamente ese caso).
- **Si lo usabas específicamente para flujo PR / code review formal** → activa `superpowers-pr` desde el catálogo (`cp -r .claude/skills/_catalog/superpowers-pr .claude/skills/superpowers-pr`) o deja que `kickoff` lo active según el perfil del proyecto.

### Razón del cambio

En v2, el nombre `superpowers-lite` sugería "versión liviana de algo más grande" sin precisar dominio. Aldo (vibe coder solo, sin PRs formales) descubrió que probablemente nunca la había usado porque su flujo no incluye PRs. La skill aporta cuando hay revisor humano formal — fuera de ese contexto es fricción inútil.

La separación clarifica:

- **`quality-mindset` (core)**: disciplina universal, aplicable con o sin Git formal.
- **`superpowers-pr` (catálogo)**: disciplina específica del flujo PR/review formal.

---

## v1.0 — origen (v2 del starter)

Versión inicial como `superpowers-lite`. Cinco reglas core para Git/PR/code-review derivadas de:

- [obra/superpowers](https://github.com/obra/superpowers) — set completo (80+ skills).
- [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) — carpeta `superpowers/`.

Aplicaba "antes de abrir cualquier PR" sin matizar perfil de proyecto.
