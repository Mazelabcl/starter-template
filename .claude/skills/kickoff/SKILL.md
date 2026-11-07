---
name: kickoff
description: Entrevista adaptativa al iniciar un proyecto y PLAN DE BATALLA revisable en el cockpit (TLDRs, equipo con "actúa como", brazos conectados/faltantes, proceso, councils, riesgos). Deja project-profile.json + active-team.json + principles.md + sprint inicial. Triggers "/kickoff", "vamos a empezar", "nuevo proyecto", "qué construimos hoy".
allowed-tools: Read, Write, Edit, Glob, Bash
---

# kickoff — entrevista + plan de batalla

Goal: listen, detect the project, ask only what matters, then present a **battle plan** the user reviews in the cockpit (votes, comments or voice). Nothing is persisted before the user confirms, and Sprint 1 never starts before the plan feedback is applied.

All user-facing text in neutral Spanish (tuteo, zero voseo). The user is a novice: TLDR first, copy-paste commands with "(esto hace X)", no jargon.

## When to use / not

- Use: `/kickoff`, fresh clone, "vamos a empezar", or `memory/project-profile.json` missing.
- Do not restart if a valid profile exists: offer "ajustar perfil" instead. Not for one-off questions.
- Reversible: if the user says "reinicia" / "vuelve atrás", resume from that step.

## Step 0 — Pre-flight (silent if all is OK)

1. No `node_modules/` → offer `npm install` (ask first).
2. `.env` missing or `OPENROUTER_API_KEY` empty/placeholder → offer `npm run setup` (OpenRouter required; OpenAI and Replicate optional, skippable). Only mention what is missing; then go to Step 1.

## Step 1 — Greeting (literal, one question)

```
Hola, soy el starter de Mazelab. Te acompaño en cualquier proyecto: software,
contenido, research o negocio. Te hago 3 a 5 preguntas cortas y te muestro un
plan de batalla (equipo, herramientas y pasos) que revisas antes de empezar.

Dime en una frase qué quieres construir o resolver.
```

## Step 2 — Detect (deterministic, do not read detector.js)

```
node .claude/skills/kickoff/detector.js detect "<texto del usuario>"
```
Returns `{ type, size, output, confidence }`. `type` ∈ research | build | content | business | personal | mixed. Tiebreakers: build beats business and content (a landing with photos is built as software; the creative part becomes arms). If `confidence < 2`, ask once: "¿Esto va más por (a) contenido, (b) software, (c) investigar, (d) negocio, (e) algo personal, (f) otra cosa?" and re-run detect on both texts.

## Step 3 — Adaptive questions (max 5, one at a time)

| type | Ask (only what is missing) |
|---|---|
| build | ¿Para quién es? · ¿Stack o integraciones obligadas? · ¿Flujo crítico que debe funcionar primero? · ¿Plazo o presupuesto? |
| content | ¿Para quién y dónde se publica? · ¿Tono? · ¿Marca o referencias? · ¿Cuántas piezas y para cuándo? |
| business | ¿Qué proceso atacamos? · ¿Dónde duele hoy? · ¿Hay datos o documentos? · ¿Horizonte? |
| research | ¿Profundidad? · ¿Fuentes preferidas o vetadas? · ¿Qué decisión tomarás con esto? · ¿Formato? |
| personal | ¿Qué quieres mejorar? · ¿Qué probaste antes? · ¿Cuánto tiempo al día? |
| mixed | ¿Resultado tangible al final? · ¿Quién lo usa? · ¿Para cuándo? → re-run detect |

Never invent real-world data (prices, competitors): mark it as research for Sprint 1.

## Step 4 — Gather the inputs of the plan (run, do not show raw output)

```
node .claude/skills/kickoff/detector.js contrast <type> "<todas las respuestas>"
node .claude/skills/kickoff/detector.js sprint <type> <rapido|profundo>
node src/brazos.js suggest "<descripción + respuestas>" --estado
```
- Skills: curated stack + `extras` from contrast. Read `.claude/skills/_catalog/skills-catalog.json` and reason fit; warn if a proposed skill is `stub`. Final-client audience → propose `client-language` (+ `non-technical-cold-reader` if critical). Video → `video-director`.
- Brazos (arms) = any integration needed to EXECUTE (MCP, API, CLI, skill, library, plugin). `brazos.js` says which are connected, missing auth, or not installed.
- Councils: list the 2-4 decisions with real tradeoffs that will come up; `plan.js` routes each one to a template.

## Step 5 — Build the BATTLE PLAN draft

Write `memory/plan-de-batalla.borrador.json` (format: `ejemplo-plan-borrador.json` in this folder):

- `tldr_usuario`: what the user asked, in their terms (2-3 lines).
- `tldr_orquestador`: how you would do it: sprints, key stack, where the user approves.
- `equipo[]`: 3-5 members. Each: `id`, `rol`, `actua_como` (rich persona: specialty, years, what they obsess about), `por_que` (why THIS project needs this role), `entrega[]`, `brazos[]` (ids from the directory), `nuevo: true` (a new role card, no restart) or `origen` (existing agent/skill) or `ficha: <id>` (existing card, fills the rest). `herramientas_restringidas: true` only if tools must really be forbidden.
- `proceso`: `sprints[]` (numero, objetivo, entregables, gate) + `intervenciones[]` (where the user acts: approvals, credentials only they can authorize, real data they must provide).
- `decisiones[]`, `riesgos[]` (`{ riesgo, mitigacion }`).
- The plan becomes a picture deck (org, flow, timeline; full text stays behind "Ver más"), so also give the short labels of 2-5 words: `titular` (max 10 words), `tldr_pasos[]`, and `corto` on team members, sprints, decisions (`{ texto, corto }`) and risks; plus `nota`, `icono` and `gate_corto` where they help.

Then build and publish:
```
node .claude/skills/kickoff/plan.js build memory/plan-de-batalla.borrador.json
node src/cockpit.js publish memory/plan-de-batalla.json
```
(the first fills brazos with real status + connect commands, councils with cost, and a `context_brief` for the voice guide; the second publishes it as a `kind: "plan"` review)

## Step 6 — Chat output (5 lines max)

First open the cockpit yourself (the user never opens a second terminal): `node src/cockpit.js open <id>` (starts the server in the background if needed and opens the browser on the plan). Then paste the 5-line TLDR that `plan.js` prints; its last line is:
`Te abrí el cockpit en el navegador: vota, comenta o conversa por voz y guarda el feedback.` If `open` could not launch the browser, give the URL it printed. Manual fallback only if `open` fails: `npm run cockpit` in another terminal.
Do not dump the plan in the chat.

## Step 7 — Apply feedback (gate before Sprint 1)

When the user says they saved feedback (or the session hook warns):
1. `node src/cockpit.js pending` → apply every vote/comment/voice decision to the draft (drop rejected members or arms, add requests).
2. If changes are substantial, bump `version` and re-run Step 5 (`plan-de-batalla-v2`); otherwise confirm in chat.
3. `node src/cockpit.js done <review_id>`.
4. Only then persist (Step 8) and start Sprint 1.

## Step 8 — Persist (only after the plan is approved)

```js
import { writeProfile, addSkill } from './src/memory.js';
import { startSprint } from './src/roadmap.js';
import { CORE_SKILLS } from './.claude/skills/kickoff/detector.js';
writeProfile({ project_type, mode, description /* ≤240 chars */, created_at: new Date().toISOString(),
  owner, skills_activas: [...CORE_SKILLS, ...approvedSkills], agentes_activos: approvedAgentNames,
  sprint_inicial: 'sprint-1', tags: [type, size] });
for (const name of [...CORE_SKILLS, ...approvedSkills]) addSkill({ name, notas: why });
startSprint({ number: 1, objective: plan.proceso.sprints[0].objetivo }); // NEVER addSprint here: that is for closing (closeSprint)
```
- `content/principles.md` from `content/principles.template.md` (fill the `{{...}}`; "Qué NO ES" comes from rejected items and risks). `content/INDEX.md` from `content/INDEX.template.md`. Never hand-edit between the markers of `roadmap/roadmap.md`; `startSprint` fills it.
- Activate approved catalog skills: copy `.claude/skills/_catalog/<skill>` to `.claude/skills/<skill>`.
- Approved arms: show `node src/brazos.js connect <id>` for each missing one, and offer `node src/brazos.js mcp-json <ids...>` (preview; `--write` only with a yes). Never install anything without a yes.
- Record explicit user decisions from the review with `addDecision`.

## Step 9 — The team becomes role cards (no restart)

Ask once before creating the cards, unless the user already said: `¿Qué modelo usa el equipo? Sonnet (equilibrado), Opus (más potente, gasta más), Haiku (más barato) o uno distinto por rol.` Pass the answer as `--modelo`; do not pick for them. For every approved member (except an `origen` that is already an agent file), write persona and objective in English and run (add the skill's `SKILL.md` to `--contexto` if `origen` names one):
```
node src/roles.js crear --id <id> --actua-como "<persona>" --objetivo "<goal>" [--modelo sonnet] [--contexto a.md,b.md]
```
(creates `roles/<id>.md` and registers it in `active-team.json`; it works at once). To use a member: `node src/roles.js prompt <id> "tarea"`, then the Agent tool with `subagent_type: general-purpose`, that prompt and the card's `model` (`roles/README.md`).

Only if `herramientas_restringidas: true`: add `--herramientas-restringidas`, invoke `agent-template` for the fixed file in `.claude/agents/`, and warn literally (the user must reiniciar Claude Code):
```
Creé el agente <nombre>. Reinicia Claude Code para que cargue: escribe /exit y luego claude -c (retoma esta conversación). Mientras tanto uso un agente general con el mismo rol, sin esa restricción.
```

## Step 10 — Close

```
Listo. Guardé el perfil, el equipo, los principios y el Sprint 1 en memory/, content/ y roadmap/.
Tip: para prompts largos dicta con Win+H (macOS: doble Fn); ver docs/voice-input-guide.md.
Si quieres validar que todo arranca limpio: npm run smoke:quick (no gasta créditos).
¿Empezamos con el primer entregable del Sprint 1?
```

## Anti-patterns

1. More than 5 adaptive questions, or a form-like interview.
2. Generic team or arms: every `por_que` and every arm must cite this project's words.
3. Persisting or starting Sprint 1 before the cockpit feedback is applied.
4. Installing MCPs/plugins or writing `.mcp.json` without an explicit yes.
5. Dumping the plan in the chat instead of the cockpit.
6. Inventing real-world data: mark it as research (`node src/research.js pro "..."`).
7. Creating `.claude/agents/` files for roles that do not restrict tools; invoking a new fixed agent in the same session (it will not load).

## References

- `detector.js` (CLI: detect | stack | sprint | contrast), `plan.js` (battle plan), `ejemplo-plan-borrador.json` (cafetería example), `EXAMPLES.md` (full flows), `CHANGELOG.md`.
- `brazos/README.md` (arms directory), `cockpit/README.md` (review contract), `councils/README.md`.
