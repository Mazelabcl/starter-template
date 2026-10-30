---
name: council
description: Expert-persona council (CTO, devops, PM, novice user, Steve Jobs-inspired visionary...). Each persona answers independently, then a synthesizer MERGES their threats, opportunities and ideas into one improved proposal with every contribution attributed. Proactively PROPOSE it (never run it silently) on decisions with real tradeoffs, new features, naming, strategy or architecture. Triggers "convoca un council", "/council", "consulta al council", "qué opinaría un CTO", "dame otras perspectivas".
allowed-tools: Bash, Read, Edit
---

# council: expert personas that merge, not vote

Engine: `src/council.js`. Personas: `councils/personas/*.json` (16). Templates (situation -> personas): `councils/templates/*.json`. Results: `councils/results/<id>.json` + cockpit review `cockpit/reviews/<id>.json`. Details for humans: `councils/README.md`.

## When to propose a council

Propose one (one line, see below) when the user faces a choice where smart people would disagree:

- a new feature or flow ("¿agrego X?", "¿cómo debería funcionar Y?")
- naming, tagline, positioning
- strategy: what to prioritize, build vs buy, pricing
- architecture that is expensive to reverse (DB, auth, infra, providers)
- launch, campaign or creative direction

Do NOT propose one when the answer is verifiable: a bug, a failing test, "how does library X work", syntax, anything docs or a quick test can settle. Also not for trivial or easily reversible choices, and not twice for the same decision.

## How to propose it

1. Run the suggester with the user's own words:
   ```bash
   node src/council.js suggest "<texto de la tarea>"
   ```
   (add `--llm` only if no template matched and the decision clearly deserves a council)
2. Show the user the literal line it prints, e.g.:
   `Para esto te sirve un council de CTO + Product manager + Investigador UX + Usuario novato (plantilla "nueva-funcionalidad", ~USD 0.03, ~40-100 s). ¿Lo armo?`
3. Wait for a yes. If the user wants other voices, swap with `--personas a,b,c` (ids from `node src/council.js list`).

## How to run it

```bash
node src/council.js run --template <id> --question "<pregunta concreta>" --files <archivos relevantes>
```

- The engine injects `content/principles.md` and recent `memory/decisions.md` by itself. Add with `--files` the 1-3 files the decision is really about (spec, current code, brief). Short `--context "..."` for facts that live only in the chat.
- Phrase the question as a decision with its options: "¿X o Y para Z, dado W?".
- It prints the estimated cost and time before calling any model.
- `--redteam`: the contrarian attacks the merged proposal and the synthesizer patches it. Use it for high-stakes or one-way decisions.
- `--mode multimodel`: strong models from >=3 families (Claude, GPT, Gemini, Grok). ONLY for hard, high-stakes architecture. Costs ~USD 0.3-0.5 and needs `--yes`. Before adding `--yes`, ask:
  `Este council usa modelos fuertes de varias familias y cuesta ~USD <costo>. ¿Lo corro?`
- `--dry-run` shows cost/time without running.

Rules: never add `--yes` without the user's explicit OK for that cost. Never pass secrets or `.env` content in `--files`/`--context`.

## How to present the result

1. The run already wrote the cockpit review (`cockpit/reviews/<id>.json`). If `src/cockpit.js` exists, publish/open it the way that module documents; otherwise tell the user the file path.
2. In chat, give exactly the 5-line TLDR the CLI printed (recommendation, confidence, key contributions with who saw them, main tension, cost + where to vote). Do not dump the JSON.
3. Invite review: `Revisa la propuesta en el cockpit y vota cada aporte con pulgar arriba o abajo; con eso ajusto el plan.`
4. Attribution matters: when you mention an idea, say who saw it ("esto lo vio el devops").

## After the user decides

The council never writes to memory. Only when the user explicitly picks a direction, record it with `addDecision()` from `src/memory.js` (title, decision, reasoning citing the council id, alternatives, reversibility). If they only read it, do nothing.

## Personas and templates

- 16 personas in 5 groups: technical (cto, sre, seguridad, datos), product (pm, ux-research, growth), business (cfo, ventas, cliente), creative (director-arte, storyteller), wildcards (visionario, contrarian, usuario-novato, audiencia).
- Templates: nueva-funcionalidad, arquitectura-critica (multimodel + redteam), lanzamiento-marketing, diseno-visual, precio-negocio, contenido-creativo, naming, estrategia (redteam).
- New persona: copy one JSON in `councils/personas/`, edit it, then run `node councils-library.test.js`. Personas may be "inspired by" a real person, never claim to BE them.

## Anti-patterns

| Don't | Do instead |
|---|---|
| Run a council without asking | Propose with the literal line, wait for yes |
| Ask a vague question ("¿qué opinan?") | A decision with options and constraints |
| Run without the files the decision is about | Pass them with `--files` |
| Present a winner or a vote count | Present the merged proposal and who saw what |
| Paste the raw JSON in chat | 5-line TLDR + cockpit |
| Use multimodel for everyday choices | Default personas mode (~USD 0.03) |
| Save the result to memory automatically | `addDecision()` only after the user decides |

## Failure handling

- `cost_confirmation_required`: show the cost line and ask; rerun with `--yes` only after a yes.
- `insufficient_personas` / `merge_failed`: report it in one line (usually network or key). Suggest `npm run setup` if the key is missing.
- `partial: true` in the result: say which persona failed; the rest of the council is still valid.
