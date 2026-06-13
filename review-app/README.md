# review-app — local HTTP reviewer + output viewer

Local HTTP app (Node native, zero deps) with **two modes**:

- **sprint mode** — review structured blocks of a sprint (PRs, audit findings, deliverables), marking each item (test/acceptance check inside the block) as `OK` or `Feedback` with optional comment.
- **viewer mode (A1, Sprint v4)** — the **canonical surface to read agent output of any project**: lists ANY `.md` in a directory with a TLDR (H1 + first paragraph) and, on click, renders the `.md`. If a `.md` has front-matter with `model:`, it's shown for traceability.

Sprint v3.1 — promoted from `audit-master/review-app/`. Sprint v4 — added viewer mode.

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

Custom port (the server has no `--port` flag — set the env var):

```bash
# Mac/Linux:
REVIEW_APP_PORT=9090 node review-app/server.js
# Windows PowerShell:
$env:REVIEW_APP_PORT='9090'; node review-app/server.js
```

## Modes — sprint vs viewer

The mode is resolved as: `--mode viewer|sprint` flag (or `REVIEW_APP_MODE` env) wins; otherwise **autodetect** — if the data dir has NO `sprint<N>-prs/` folders but DOES have loose `.md` files, it's **viewer**; otherwise **sprint**.

```bash
# Viewer mode: read any .md output of agents in a directory.
node review-app/server.js --mode viewer --data-dir /path/to/content/output
# autodetect also picks viewer if the dir has .md files and no sprint<N>-prs folders.
```

**Viewer = the canonical HTML surface to read agent output of any project.** Each `.md` shows a TLDR (H1 + first paragraph) in the index; clicking renders it. Front-matter `model:` is surfaced when present.

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
| `GET /api/health` | Health check + `mode` + sprints_loaded count. |
| `GET /api/mode` | Modo activo (`sprint` o `viewer`) + data_dir. |
| `GET /api/sprints` | (sprint) Lista de sprints detectados. |
| `GET /api/sprint/:id` | (sprint) Bloques del sprint. `:id` matches `\d+`. |
| `GET /api/bloque/:sprint/:bloque` | (sprint) Markdown del bloque como JSON. Ambos `\d+`. |
| `GET /raw/bloque/:sprint/:bloque` | (sprint) Markdown raw con header `text/markdown`. |
| `GET /api/review/:sprint/:bloque` | (sprint) Decisiones persistidas. |
| `POST /api/review/:sprint/:bloque/:test` | (sprint) Marca test N como `ok` o `feedback`. |
| `GET /api/viewer/files` | (viewer) Lista de `.md` del data dir con `{ name, title, tldr, model }`. |
| `GET /api/viewer/file/:name` | (viewer) `.md` como JSON `{ name, title, model, content }`. Anti-traversal. |
| `GET /raw/viewer/:name` | (viewer) Markdown raw con header `text/markdown`. |

## Hot-reload

`fs.watch` sobre `<data-dir>` invalida la cache del parser. Agregar un bloque nuevo, renombrar uno, o editar un `.md` no requiere reiniciar el server.

## XSS safety

TODO render del markdown crudo o de comentarios del reviewer va por `textContent`. NUNCA `innerHTML` con datos del backend. Si llegan tags HTML en el contenido, se escapan automáticamente.

## Limitaciones conocidas

- Sin auth — pensado para localhost. NO exponer al público sin proxy con auth.
- Single-user — no maneja conflicto si dos reviewers editan a la vez.
- No filtros (planeado v1.0).
- No export CSV consolidado (planeado v1.0).
