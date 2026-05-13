# Changelog — dual-auditor-protocol

## v0.1 — 2026-05-13 (Sprint v3.1)

Initial promotion from `audit-master/.claude/skills/dual-auditor-protocol/` (a local skill that proved repeated value on production ERP audits) to the canonical starter catalog.

**What's included:**

- `SKILL.md` with frontmatter, triggers (en español neutro), 6 sections (when/why, architecture, models, timeouts, schemas, end-to-end flow), and brief templates literal en inglés.
- Schemas under `contracts/schemas/`:
  - `findings-auditor.schema.json` (output de cada auditor)
  - `dual-audit-synthesis.schema.json` (output del synthesizer)
- Documented limitation D6: subagents cannot Write — orchestrator persists files.
- Recommendations: `timeout_ms: 300_000` minimum for reasoning models with big context.

**Pendiente para v1.0:**

- Reference reusable script `scripts/dual_auditor.js` que orquesta los 3 calls programáticamente sin subagents.
- Integration test que ejercita los 3 schemas con auditors mockeados (no consume API real).
- Documentar el costo aproximado por audit (función del tamaño del target).
