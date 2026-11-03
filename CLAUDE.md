# Starter Mazelab (v6-dev) — instrucciones para Claude

Starter de Aldot: cada proyecto se clona desde aquí. Es un **kit de contexto + herramientas**, no un proceso obligatorio. Usa lo que la tarea necesite.

## Reglas

1. **Idioma: español neutro.** Tuteo neutro. Cero voseo y cero regionalismos rioplatenses (vos, tenés, podés, decime, mirá, che...). Releo mi respuesta antes de enviarla.
2. **Aldot es novato (vibe coder).** TLDR primero; detalle solo si lo pide. Comandos siempre copy-paste, numerados si son 2+, cada uno con una línea de qué hace. Si hay que abrir otra terminal, digo cuál. Si hay que decidir, recomiendo una opción + 1 línea de por qué.
3. **No inventes datos del mundo real** (precios, tendencias, competidores, nombres): propón research con `node src/research.js pro "..."`.
4. **Imágenes con referencias:** cada imagen cargada se nombra en el prompt como `Image 1`, `Image 2`... (si no, el modelo la ignora) y se envía con su mimetype real (png/jpeg/webp). Después de generar, hago Read del PNG antes de dar el resultado por bueno.
5. **Council de expertos:** ante decisiones con tradeoffs reales lo propongo (`node src/council.js suggest "..."`), nunca lo corro sin un sí; `multimodel` solo con confirmación del costo (`councils/README.md`).
6. Sin emojis salvo que Aldot los pida.

## Arranque de sesión

- El hook de inicio avisa si falta `/kickoff` o faltan API keys. Si falta kickoff, propónlo; si faltan keys, propón `npm run setup`.
- `docs/company.md`: léelo solo si la tarea necesita contexto de la empresa.

## Cockpit de revisión

- Toda revisión para Aldot va al cockpit, no como muro de texto: `/revisar` arma el JSON y lo publica con `node src/cockpit.js publish <archivo>`. Después corro yo `node src/cockpit.js open <id>` (levanta el server en segundo plano y abre el navegador; Aldot no abre otra terminal) y le digo "te abrí el cockpit en el navegador". Cerrarlo: `node src/cockpit.js stop`.
- **Revisiones visuales primero:** titular + imagen; el texto solo detrás de "Ver más". Si una captura o diagrama no comunica la idea, genero una imagen con la skill `astra` (`node src/astra.js`) o `image-gen`. Cierre de sprint: `node src/cockpit.js sprint-deck <borrador>`.
- Si el hook avisa feedback pendiente: `node src/cockpit.js pending`, aplícalo ANTES de seguir y márcalo con `node src/cockpit.js done <id>`.

## API keys (`.env`)

Viven en `.env` (nunca las imprimas ni las subas a git). Los scripts de `src/` lo cargan solos. Para un script propio:

```
node --env-file=.env mi-script.js
```
(esto carga las variables del `.env` antes de correr el script)

- `OPENROUTER_API_KEY`: research (Perplexity) y councils.
- `OPENAI_API_KEY`: gpt-image-2.
- `REPLICATE_API_TOKEN`: opcional, para `image-explorer` y modelos FLUX / Ideogram / Nano Banana Pro.

## Dónde vive cada cosa

| Qué | Dónde | Cómo se usa |
|---|---|---|
| Memoria del proyecto (decisiones, lessons, equipo, sprints) | `memory/` | `src/memory.js` (`summarize()`, `addDecision()`, `addLesson()`). Detalle en `memory/README.md` |
| Roadmap y backlog | `roadmap/roadmap.md` + `roadmap/current-sprint.json` | `/idea <texto>` y `/roadmap` |
| Revisión con feedback (canónica) | `cockpit/` | `/revisar` + `node src/cockpit.js open <id>` |
| Visor de `.md` de agentes | `review-app/` | `npm run review-app` |
| Resumen visual del proyecto | `RESUMEN.html` | `/resumen` |
| Catálogo de skills opcionales | `.claude/skills/_catalog/INDEX.md` | se activan con `/kickoff` o copiando la carpeta |
| Brazos (MCP, API, CLI, plugins para ejecutar) | `brazos/directorio.json` | `node src/brazos.js status\|suggest "..."\|connect <id>` (nunca instala sin un sí) |
| Capacidades y tests | `docs/capacidades.md` | `npm test` |
| Módulos para proyectos viejos | `modulos.json` | `/importar-modulo <nombre>` (desde el proyecto viejo) |

Comandos útiles:

1. `node src/research.js pro "pregunta"` → research con fuentes (modos: `quick`, `pro`, `search`, `reason`, `deep`; `deep` tarda minutos).
2. `npm test` → corre todos los tests del starter.

**Memoria:** escribe solo en eventos significativos (una decisión, una lección, cierre de sprint). `addDecision` acepta `reversibility: 'alta' | 'media' | 'baja'`.

**Roadmap:** en `roadmap/roadmap.md` no edites a mano el contenido entre marcadores `<!-- ... -start -->` / `<!-- ... -end -->`; lo reescribe `src/roadmap.js`. El texto fuera de los marcadores sí se puede editar. Si faltan marcadores, `roadmap.js` los agrega solo.

## Qué hago cuando Aldot pide...

| Pide | Hago |
|---|---|
| Arrancar proyecto / repo recién clonado | `/kickoff` (termina en un plan de batalla en el cockpit; Sprint 1 recién tras aplicar el feedback) |
| "Qué herramienta sirve para X" | `node src/brazos.js suggest "X"` |
| "Investiga X" | `node src/research.js pro "X"` |
| "Genera imagen de X" | skill `image-gen` (si no sabe qué modelo, propón `image-explorer`) |
| Lote de imágenes donde importa el costo / "pídele a Astra" | skill `astra` (Codex con el plan de ChatGPT, sin API key) |
| Decisión con tradeoffs reales | propón `/council` con su costo |
| "Mejóralo por rondas" / rediseño audaz | `/bold-rounds <objetivo> [N]` (trabaja sobre copia; Aldot elige en el cockpit) |
| "Haz un video" | copia `_catalog/video-director` a `.claude/skills/` y úsala (efectos + HyperFrames) |
| "Haz una web" | skill `ui-ux-pro-max` si está; verifica con Playwright |
| "Crea un agente para X" | ficha en `roles/`, sin reiniciar: skill `agent-template` y `node src/roles.js` (`roles/README.md`) |
| "Cuánto gasté" / qué módulos se usan | `/uso` (no gasta tokens) |
| Idea al pasar | `/idea X` y sigo con la tarea actual |
| "Qué tenemos pendiente" | `/roadmap` |

## Feedback al starter

`feedback.md` (raíz) es el buzón para reportar fallas del **starter** (no del proyecto). Cuando Aldot diga "anota esto en feedback.md", agrega la entrada bajo `## NUEVO` con fecha, contexto, hallazgo y acción sugerida. No arregles el starter desde un proyecto consumer: solo reporta.
