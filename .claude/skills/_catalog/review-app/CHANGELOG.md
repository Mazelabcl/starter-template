# Changelog — review-app

## v0.1 — 2026-05-13 (Sprint v3.1)

Initial promotion from `audit-master/review-app/` (local app que cubría dolor real del owner para revisar audits) al catálogo canónico del starter.

**Fixes aplicados respecto al original audit-master:**

- Regex de paths cambiados a `\d+` (no hardcoded a `[1-4]`). Bloquea el bug original donde agregar bloque 5 no se detectaba.
- Detección dinámica de sprints: scan de `<data-dir>` al startup buscando `^sprint(\d+)-prs$`.
- Detección dinámica de bloques: `readdirSync` + regex `^bloque-(\d+)-.+\.md$` + sort numérico.
- Hot-reload del parser: `fs.watch` sobre `dataDir` + cada sprint, dedup por mtime.
- Cross-project: aceptar `--data-dir` flag o env var `REVIEW_APP_DATA_DIR`.
- Scroll preservation client-side: POST async sin reload, conserva posición.

**Pendiente v1.0:**

- Test XSS (`review-app-xss.test.js`) que verifica que el client nunca usa innerHTML con content de bloques o comentarios.
- Multi-reviewer (auth básica + ownership).
- Filtros y búsqueda.
- Export CSV consolidado.
