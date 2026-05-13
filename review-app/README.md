# review-app — local HTTP reviewer for sprint blocks / PRs

Local HTTP app (Node native, zero deps) for reviewing **structured blocks of a sprint** — typically PRs, audit findings, or sprint deliverables — and marking each item (test/acceptance check inside the block) as `OK` or `Feedback` with optional comment.

Sprint v3.1 — promoted from `audit-master/review-app/`.

## Quick start

```bash
# Default — reviews live under <repo-root>/audit/sprint<N>-prs/
node review-app/server.js

# Open http://localhost:7788
```

Cross-project:

```bash
# Point at another repo's audit dir.
REVIEW_APP_DATA_DIR=/path/to/other-repo/audit node review-app/server.js
# or:
node review-app/server.js --data-dir /path/to/other-repo/audit
```

Custom port:

```bash
REVIEW_APP_PORT=9090 node review-app/server.js
```

## Directory convention

**Input** (auto-detected from `<data-dir>`):

```
<data-dir>/
├── sprint1-prs/
│   ├── INDEX.md            (optional — first H1 = title, first paragraph = description)
│   ├── bloque-1-foo.md     (regex: ^bloque-(\d+)-.+\.md$)
│   ├── bloque-2-bar.md
│   └── bloque-7-baz.md     (numbers can skip; sorted numerically)
├── sprint2-prs/
└── sprint10-prs/
```

**Output** (persisted by the app):

```
<data-dir>/reviews/
└── sprint<N>/
    └── bloque-<M>.json     ({ sprint, bloque, reviewed_at, decisions: [...] })
```

## Tests inside a block

The parser auto-detects checkbox markdown items as "tests":

```markdown
- [ ] Test 1 — el endpoint devuelve 200
- [x] Test 2 — el output incluye el campo `foo`
- [ ] Test 3 — error si falta auth
```

Each one shows up in the UI with two buttons (`OK` / `Feedback`) plus a comment input. Decisions persist on click — no reload, no lost scroll.

## Endpoints (all dynamic, no hardcoded ranges)

| Endpoint | Qué hace |
|---|---|
| `GET /` | Frontend estático. |
| `GET /api/health` | Health check + sprints_loaded count. |
| `GET /api/sprints` | Lista de sprints detectados. |
| `GET /api/sprint/:id` | Bloques del sprint. `:id` matches `\d+`. |
| `GET /api/bloque/:sprint/:bloque` | Markdown del bloque como JSON. Ambos `\d+`. |
| `GET /raw/bloque/:sprint/:bloque` | Markdown raw con header `text/markdown`. |
| `GET /api/review/:sprint/:bloque` | Decisiones persistidas. |
| `POST /api/review/:sprint/:bloque/:test` | Marca test N como `ok` o `feedback`. |

## Hot-reload

`fs.watch` sobre `<data-dir>` invalida la cache del parser. Agregar un bloque nuevo, renombrar uno, o editar un `.md` no requiere reiniciar el server.

## XSS safety

TODO render del markdown crudo o de comentarios del reviewer va por `textContent`. NUNCA `innerHTML` con datos del backend. Si llegan tags HTML en el contenido, se escapan automáticamente.

## Limitaciones conocidas

- Sin auth — pensado para localhost. NO exponer al público sin proxy con auth.
- Single-user — no maneja conflicto si dos reviewers editan a la vez.
- No filtros (planeado v1.0).
- No export CSV consolidado (planeado v1.0).
