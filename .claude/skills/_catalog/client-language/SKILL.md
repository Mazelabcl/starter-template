---
name: client-language
description: Forces human, jargon-free language when a deliverable targets a CLIENT or final audience (not developers). Bans technical terms (API, schema, JSON, pipeline, endpoint, deploy, roadmap, sprint, kanban) and supplies plain-language replacements. Use for any business/content/marketing artifact meant for non-technical readers.
triggers: ["/client-language", "lenguaje de cliente", "lenguaje no técnico", "sin jerga técnica", "para el cliente", "que lo entienda mi mamá", "audiencia no técnica"]
allowed-tools: Read, Write, Edit, Glob
---

# client-language — plain language for non-technical audiences

System prompt is in English (better adherence); the visible output you produce stays in neutral Spanish. This skill rewrites or guards any deliverable aimed at a final client/audience so it reads as plain human language, with zero developer jargon.

---

## Cuándo activar esta skill

Activate `client-language` when ANY of these hold:

1. The deliverable is for a **final client, customer, manager, or investor** — not for developers.
2. The project is **business, content, or marketing** and the artifact is client-facing (UI copy, proposal, report, presentation, catalog, landing).
3. The text currently contains developer jargon (API, schema, JSON, pipeline, endpoint, deploy, roadmap, sprint, kanban) that a non-technical reader would not understand.

### Cuándo NO activarla

- The deliverable is for developers or the orchestrator itself (a `/aldo/` system view, a README, code comments). Keep precise technical terms there.
- Internal technical docs where jargon is the correct, expected vocabulary.

---

## Qué hace

1. Scans the deliverable for the **jargon blacklist** below.
2. Replaces each term with its plain-language equivalent (table below).
3. Rewrites sentences so they describe **what the reader gets**, not how it is built.
4. Keeps it concrete and human: short sentences, everyday words, no acronyms unless universally known.
5. If a technical concept is unavoidable, explains it in one plain clause instead of naming it.

### Blacklist → replacement (neutral Spanish output)

| Jargon (prohibido) | Reemplazo humano |
|---|---|
| API / endpoint | "conexión" / "el sistema responde con…" |
| schema / JSON / payload | "estructura de datos" / "la información" |
| pipeline | "proceso" / "flujo de trabajo" |
| deploy / deployment | "publicar" / "poner en línea" |
| roadmap | "ruta" / "plan" |
| sprint | "siguiente tramo" / "etapa" |
| kanban | "tablero" |
| backend / frontend | "la parte interna" / "lo que se ve" |
| subagente / agente | "el sistema" / "el asistente" |
| fetch / request | "buscar" / "pedir" |
| token / prompt | "texto" / "instrucción" |
| repo / commit / merge | "archivo del proyecto" / "guardar cambios" |

The orchestrator may extend this table per client. Use the global "español neutro" rule: tú/tienes/puedes, never voseo.

---

## Anti-patrones

- **Leaving one jargon term "because it's short."** One leaked term breaks the trust of a non-technical reader.
- **Over-simplifying to the point of being vague.** Plain ≠ empty. Say concretely what the reader gets.
- **Applying this to a developer-facing doc.** Stripping precise terms from a README hurts more than helps.
- **Translating jargon literally** ("punto final" for endpoint). Use the meaning, not the dictionary.
- **Mixing layers.** If a deliverable has both a client section and an orchestrator section, only the client section gets de-jargoned.

---

## Próximos pasos (esta skill es STUB)

- [ ] Per-client glossary files (`content/glossary-<client>.md`) that extend the blacklist.
- [ ] Auto-detection: scan a deliverable and flag jargon density before the human reads it.
- [ ] Tighter handoff with `non-technical-cold-reader` (this skill rewrites, that skill vetoes).
- [ ] Examples library: before/after pairs per project type.

---

## Versión

v0.1 stub — Sprint v4 — invocable, pendiente de glosarios por cliente y auto-detección. Tema recurrente #1 del feedback-inbox (amanda-paz, mazelab-new-service).
