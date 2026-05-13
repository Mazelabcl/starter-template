---
name: review-app
description: Local HTTP app (Node native, zero deps) for reviewing PRs/blocks of a sprint, marking each test as OK or Feedback, and persisting decisions to disk. Cross-sprint, cross-project, hot-reload of the parser. Promoted from audit-master in Sprint v3.1 as canonical starter skill. Triggers ("review-app", "revisar PRs en HTTP", "marcar OK/Feedback", "/review-app", "abrir review-app").
allowed-tools: Read, Bash, Glob
---

# review-app — local HTTP app for reviewing PRs / sprint blocks

This skill provides a tiny local HTTP server + frontend that lets the human review **structured blocks of a sprint** (typically PRs, audit findings, or sprint deliverables) and mark each item (typically a test or acceptance check inside the block) as `OK` or `Feedback` with optional comment. Decisions persist to disk so a session can be paused and resumed.

The pattern was promoted from `audit-master/review-app/` in Sprint v3.1 after the owner confirmed it covered real pain for vibe-coder review of audits. Sprint v3.1 also refactored the original implementation to fix three hardcoded references to "blocks 1–4" (now dynamic) and to make the app cross-sprint and cross-project.

## When to use this skill

Activate `review-app` when:

- The project has **multiple PRs or audit blocks** that need human review one-by-one.
- The owner wants a **stable URL** to chase progress without re-running scripts.
- Reviews are **resumable** — you may close the tab, come back tomorrow, and pick up where you left off.
- The output should be **persistable** as JSON for downstream tooling (CI gates, dashboards).

### When NOT to use

- Single-PR review — just use GitHub's PR UI.
- Pre-merge code review where the canonical tool is `superpowers-pr`.
- Reviews that need real-time multi-user collaboration (review-app is single-user, single-machine).

## Quick start

```bash
# Default — review all sprints under audit/sprintN-prs/ of the current repo.
node review-app/server.js

# Open http://localhost:7788 in your browser.
```

```bash
# Cross-project: point at another repo's audit dir.
REVIEW_APP_DATA_DIR=/path/to/other-repo/audit node review-app/server.js
# or:
node review-app/server.js --data-dir /path/to/other-repo/audit
```

## Directory convention (input)

The app discovers sprints and blocks dynamically by scanning the data dir:

```
<data-dir>/
├── sprint1-prs/            ← any "sprint<N>-prs" matching this regex is detected
│   ├── INDEX.md            ← title (first H1) + description (first paragraph)
│   ├── bloque-1-foo.md     ← regex `^bloque-(\d+)-.+\.md$`
│   ├── bloque-2-bar.md
│   └── bloque-7-baz.md     ← skipping numbers is OK; sort is numeric
├── sprint2-prs/
│   ├── INDEX.md
│   └── bloque-1-quux.md
└── sprint10-prs/           ← double-digit sprint numbers work
    ├── INDEX.md
    └── bloque-1-grault.md
```

Each `bloque-<N>-<slug>.md` is parsed for **tests** — typically a numbered checklist that the reviewer marks OK or Feedback. The parser detects tests as lines matching `^- \[(\s|x|X)\]\s+` (markdown checkbox bullets) but tolerates variations.

## Directory convention (output)

```
<data-dir>/
└── reviews/
    └── sprint<N>/
        └── bloque-<M>.json    ← per-block decisions persisted as JSON
```

Each `bloque-<M>.json` shape:

```json
{
  "sprint": 1,
  "bloque": 2,
  "filename": "bloque-2-bar.md",
  "reviewed_at": "2026-05-13T12:34:56Z",
  "decisions": [
    { "test_index": 0, "status": "ok", "comment": "" },
    { "test_index": 1, "status": "feedback", "comment": "el caso edge X falló" }
  ]
}
```

## Endpoints

| Endpoint | Qué hace |
|---|---|
| `GET /` | Sirve el frontend estático. |
| `GET /api/sprints` | Lista de sprints detectados con `{ id, title, description, block_count }`. |
| `GET /api/sprint/:id` | Bloques de un sprint específico. `id` matches `\d+`. |
| `GET /api/bloque/:sprint/:bloque` | Markdown crudo del bloque. Ambos IDs `\d+`. |
| `GET /raw/bloque/:sprint/:bloque` | Igual que el anterior pero con header `text/markdown` para previews. |
| `POST /api/review/:sprint/:bloque/:test` | Persiste decisión para un test específico. Body `{ status: "ok"\|"feedback", comment: "..." }`. |
| `GET /api/review/:sprint/:bloque` | Devuelve las decisiones persistidas de ese bloque. |
| `GET /api/health` | Liveness check. Devuelve `{ ok: true, data_dir, sprints_loaded }`. |

**Importante:** TODOS los regex de path usan `\d+`. NO hay hardcodes a un rango específico de bloques.

## Detección dinámica

- **Sprints:** al startup, `readdirSync(dataDir)` y matchea `^sprint(\d+)-prs$`. Si después se agrega un sprint nuevo, hot-reload lo detecta automáticamente.
- **Bloques:** al cargar un sprint, `readdirSync(sprintDir)` y matchea `^bloque-(\d+)-.+\.md$`. Sort numérico por el primer grupo.
- **Hot-reload:** `fs.watch` sobre `dataDir` y cada `sprintN-prs/`. Cuando cambia un `.md`, invalidamos la cache de ese sprint y re-parseamos al próximo request. mtime se usa para dedup.

## XSS safety (client)

TODO render del markdown crudo o de comentarios del reviewer va por `textContent` o por el sanitizer mínimo de la app (mismo invariante ADR-02 que el dashboard). Si llegan tags `<script>`, `<iframe>` o `on*=` en el contenido del block o comentario, se escapan. Test `review-app-xss.test.js` (no incluido en v0.1, pendiente v1.0) cubre esto.

## Scroll preservation

Al marcar `OK` o `Feedback`, el cliente NO recarga la página completa — actualiza solo el item local + POST async. La posición de scroll se preserva. Si el usuario está revisando el bloque 5 y marca el test 12, sigue viendo el test 12 después del save (no rebota al top).

## Cross-project

Por defecto el server resuelve `dataDir = <repo-root>/audit`. Para cambiarlo:

- **Env var:** `REVIEW_APP_DATA_DIR=/path/to/other-repo/audit node review-app/server.js`
- **CLI flag:** `node review-app/server.js --data-dir /path/to/other-repo/audit`

Esto permite usar la review-app del starter para revisar un audit de otro proyecto sin clonar nada.

## Anti-patterns

- ❌ Hardcodear rangos de bloques (`/^bloque-[1-4]$/`). El bug original de audit-master era exactamente esto. Usa `\d+`.
- ❌ Confiar en que el array de bloques de un sprint nunca cambia. Hot-reload del parser cuesta poco y previene "agregué bloque 5 y la app no lo ve".
- ❌ Renderizar el markdown del bloque con `innerHTML`. ADR-02: textContent o sanitizer estricto.
- ❌ Reload completo de la página al guardar una decisión. Pierde scroll y vuelve agotador a revisar 50+ tests. Update local + POST async.
- ❌ Asumir que la data vive en el repo del starter. El owner puede querer revisar audits de otros repos.

## Próximos pasos hacia v1.0

- `review-app-xss.test.js` que verifica que el frontend no usa `innerHTML` con contenido de bloques o comentarios.
- Soporte para múltiples reviewers (auth básica + ownership por reviewer).
- Filtros: solo bloques sin review, solo tests con `feedback`, búsqueda por keyword.
- Export consolidado: `npm run review-app:export-csv` que escribe todas las decisiones a CSV para analítica.

## Versión

v0.1 — 2026-05-13 — promovida desde `audit-master/review-app/` en Sprint v3.1. Fixes incluidos respecto al original: regex `\d+` (no `[1-4]`), detección dinámica de sprints, hot-reload del parser, cross-project via `--data-dir`/env var, scroll preservation client-side. Pendiente v1.0: tests XSS + filtros + multi-reviewer + CSV export.
