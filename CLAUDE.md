# Starter Template — instrucciones para Claude

Este es el starter de Aldot. Cada nuevo proyecto se clona desde acá. Cualquier persona novata debe poder arrancar sin fricción.

## Antes de cualquier cosa

1. **Si `content/principles.md` no existe o está vacío** → propone correr `/kickoff`. Esa skill entrevista al usuario y autogenera `principles.md` + `INDEX.md`. **NO** procedas a construir nada antes de tener un canon corto.
2. **Si las API keys no están configuradas** (no hay `.env` con `OPENROUTER_API_KEY` y/o `OPENAI_API_KEY`) → sugiere `npm run setup` (interactivo) o los slash `/setup-openrouter` y `/setup-openai`.
3. **Lee `process-log/00-decisions.md`** — son decisiones humanas (ley). Cualquier output que las contradiga, frena.
4. **Lee `docs/company.md`** si tiene contenido — es el contexto de la empresa del usuario.

## Capacidades disponibles

- **Research vía Perplexity (OpenRouter)**: `node src/research.js <quick|pro|search|reason|deep> "<pregunta>"`. Default `pro`. Para info actualizada de internet, **siempre** úsalo — no inventes datos.
- **Imágenes con gpt-image-2** (Python): `python scripts/openai_images.py generate|edit|batch …`. La skill `image-gen` lo orquesta con identity lock + paralelismo.
- **Skill `kickoff`** — entrevista inicial del proyecto, autogenera `principles.md` + `INDEX.md`.
- **Skill `pipeline-v2`** — orquesta architect → critic → cold-reader → humano para cualquier creación no trivial.
- **Skill `cold-reader-gate`** — lectura cold con veto absoluto. Independiente.
- **Skill `multimodal-validation`** — fuerza Read del PNG después de cualquier imagen generada.
- **Skill `image-gen`** — wrapper gpt-image-2 con IDENTITY LOCK + reglas de references + batch paralelo.
- **Skill `agent-template`** — genera nuevos agentes especializados con score base ≥92.
- **Skill `karpathy-rules`** — 4 reglas para escribir código limpio.
- **Skill `superpowers-lite`** — 5 reglas para Git/PR.

## Modelo operativo (pipeline v2)

1. **Capa 0 — `content/principles.md` literal al tope de cada brief.** No resumido. Si no existe → `/kickoff` primero.
2. **Capa 0.5 — `content/INDEX.md` decide qué cargar.** No el repo entero.
3. **Capa 1 — Architect** crea el deliverable.
4. **Capa 2 — Critic interno multi-óptica** (3-4 voces, sin cold-reader).
5. **Capa 3 — Cold-reader gate** (skill `cold-reader-gate`) — independiente, voto binario, veto absoluto.
6. **Capa 4 — Humano decide** sobre lo que pasó cold-reader.

## Reglas duras

1. **Idioma — español neutro.** Cero voseo, cero regionalismos rioplatenses (vos/tenés/podés/decime/etc.). Tuteo neutro. **Auto-check antes de enviar:** releo mi propio output, si encuentro regionalismos, reescribo.
2. **Validación multimodal en imágenes — obligatorio.** Después de `generate_image()` / `edit_image()`, hago Read del PNG. Sin esto no hay PASS.
3. **Refs declaradas DEBEN mencionarse en el texto del prompt.** Cada `Image N` cargada en el array tiene que estar nombrada literal en el prompt — si no, el modelo la ignora.
4. **DIFF de pérdidas en R2+.** Antes de iterar una segunda ronda, listo 5 cosas del R1 que NO debo perder.
5. **Cold-reader es independiente.** No le paso debate previo, briefs históricos, ni scores de critic. Solo `principles.md` + deliverable.
6. **Modelo tracking obligatorio.** Cada output reporta el modelo usado (`claude-opus-4-7`, `gpt-image-2`, etc.).
7. **Subcarpetas, no paths dispersos.** Outputs van a `content/output/<scene_or_asset>/` para portabilidad.
8. **Paralelismo agresivo en imágenes independientes.** Si N jobs no dependen entre sí, batch async con `max_concurrent` alto (default 8, hasta 15-20 en tier alto).

## Anti-patrones (NO hacer)

- Lanzar agente con 15+ archivos de contexto histórico.
- Critic con cold-reader como una voz más en la rúbrica.
- Validation textual sin Read del PNG.
- Refs cargadas pero no mencionadas en el texto.
- Iterar R2/R3 sin DIFF de pérdidas.
- Crear agentes nuevos a media sesión y usarlos en la misma sesión (no cargan).
- Pasar paths absolutos dispersos al usuario para refs.

## Tono

- Aldot es novato — explica decisiones técnicas en lenguaje simple.
- Directo, sin jerga gratuita.
- Sin emojis salvo que el usuario los pida.
