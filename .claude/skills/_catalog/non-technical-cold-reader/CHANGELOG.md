# Changelog — non-technical-cold-reader

## v0.1 — Sprint v4 (2026-06)

- Skill creada. System prompt en inglés, triggers en español (regla 6).
- Gate independiente con voto binario GO/NO-GO que veta un deliverable de cliente si contiene jerga técnica.
- Mismo principio que `cold-reader-gate` pero enfocado en legibilidad para audiencia no técnica.
- Complemento de `client-language` (esa reescribe; esta veta). Flujo típico: client-language reescribe → este gate veta si algo se filtró.
- Pendiente v1.0: read LLM opcional para frases borderline, perfiles de jerga por audiencia, contrato de handoff con client-language.
