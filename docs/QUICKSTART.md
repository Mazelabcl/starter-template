# Quickstart de 5 minutos

Para alguien que clona el starter por primera vez. Al terminar tienes un proyecto listo para arrancar con Claude Code.

## Paso 1 — Clonar el template

Mientras v3 vive en branch separada (no mergeada a main todavía), clonas con `-b v3`:

```bash
git clone -b v3 https://github.com/Mazelabcl/starter-template.git mi-proyecto
cd mi-proyecto
```

Cuando v3 se mergee a main, podrás clonar sin el flag `-b v3`.

## Paso 2 — Setup interactivo

```bash
npm install
```

`npm install` corre `setup.js` en postinstall. Te pide:

- **OpenRouter API key** (`OPENROUTER_API_KEY`) — research vía Perplexity, councils multi-modelo. Recomendada. Sácala en <https://openrouter.ai/keys>. Formato `sk-or-v1-...`.
- **OpenAI API key** (`OPENAI_API_KEY`) — gpt-image-2, TTS de voice-mode. Opcional. Antes verifica en <https://platform.openai.com/settings/organization/general> que tu org diga Individual Approved + Business Approved. Formato `sk-proj-...`.
- **Replicate API token** (`REPLICATE_API_TOKEN`) — image-explorer multi-modelo: FLUX, Imagen 3, Ideogram, Recraft, SD 3.5. Opcional. Sin esto, image-explorer queda con solo gpt-image-2 disponible. Formato `r8_...`.

También detecta Python 3.10+ y crea un venv con `openai` instalado. Si Python falta, te muestra cómo instalarlo según tu sistema operativo.

Si saltaste alguna key, después puedes configurarla con los slash `/setup-openrouter` o `/setup-openai`.

## Paso 3 — Arrancar todo con un comando

```bash
npm start
```

Levanta el dashboard (HTML simple de estado) en background, abre el browser en <http://localhost:7777/>, y te muestra el próximo paso.

El dashboard muestra una tabla de tareas en vivo (Agente, Estado, Modelo, Tokens, Summary) + pestañas Sprint / Roadmap / Chat, con una barra de métricas en el header. Mientras Claude trabaja, se actualiza solo vía SSE.

Si prefieres levantar solo el dashboard en otro terminal: `npm run dashboard` (override de puerto en Mac/Linux: `DASHBOARD_PORT=9000 npm run dashboard`; en Windows PowerShell: `$env:DASHBOARD_PORT='9000'; npm run dashboard`).

### Antes de trabajar en serio — smoke test (recomendado)

```bash
npm run smoke
```

8 checks end-to-end en ~60-90s, gasta ~USD 0.05 en API. Valida: variables de entorno, hand-off contracts, memoria del proyecto, dashboard server, Perplexity research, gpt-image-2 generación, multimodal validation flow, pipeline-v2 integration.

Si está verde, el sistema completo funciona. Si algún check falla, el output te dice qué arreglar (errores comunes documentados en `scripts/smoke_test.README.md`).

Versión sin gasto de red (estructura solamente):

```bash
npm run smoke:quick
```

## Paso 4 — Arrancar Claude Code

Abre Claude Code en este repo. En el primer prompt, escribe:

```
/kickoff
```

La entrevista adaptativa detecta qué tipo de proyecto vas a hacer (build / business / content / research / personal), recomienda el stack de skills opcionales que necesitas, y persiste todo en `memory/project-profile.json` + `memory/active-team.json`. Después puedes arrancar.

## Paso 5 — Captura rápida de ideas (opcional)

Mientras trabajas, sin desviar el flujo:

```
/idea quiero probar agregar un dashboard de cohorts de usuarios
```

Va al backlog del sprint actual. No ejecuta nada. Una línea de confirmación, fin.

## Tips por capacidad

| Cuándo usar | Comando | Costo aproximado |
|---|---|---|
| Decisión técnica/estratégica con tradeoffs reales | `/council` | USD 0.02 a 2.50 según tier |
| Explorar prompt de imagen en N modelos | `node src/image_explorer.js --prompt "..." --models "gpt-image-2,flux-1.1-pro,imagen-3"` | ~USD 0.18 por 4 modelos |
| Imagen con personaje consistente (refs + identity lock) | Skill `image-gen` (vía conversación) | USD 0.04 a 0.25 según quality/size |
| Escuchar respuesta larga mientras haces otra cosa | `/voz-on` (luego sigue normal) | ~USD 0.015 cada 1000 chars |
| Research factual con citas | `node src/research.js pro "tu pregunta"` | USD 0.001 a 0.01 |
| Mejorar artefacto hasta 95+/100 | `/confidence-loop` | sin costo extra (modelo principal) |

## Errores comunes y cómo arreglarlos

### `Faltan dependencias. Corre primero: npm install`

Lanzaste `npm run setup` antes de `npm install`. Corre `npm install` y vuelve a intentar.

### `falta(n) variable(s) en .env: OPENAI_API_KEY`

La key existe en `.env` pero está vacía o no aparece. Edita `.env` o corre `/setup-openai` desde Claude Code.

### `variable(s) con valor placeholder`

La key sigue siendo el texto de ejemplo (`sk-or-v1-pega-aqui-tu-key`). Reemplaza con tu key real.

### `Python 3.10+ no detectado`

Necesitas Python para gpt-image-2. Instálalo según tu OS (instrucciones en el output del setup) y vuelve a correr `npm run setup`.

### `no module named 'openai'`

Falta el venv de Python o las dependencias, o estás invocando el `python` del sistema en vez del intérprete del venv (donde vive `openai`). Corre `npm run setup` (incluye crear venv + instalar `openai`) y al ejecutar el wrapper usa el python del `.venv`: `.venv\Scripts\python.exe` en Windows, `.venv/bin/python` en Mac/Linux.

### `cuota OpenAI agotada o rate-limited`

Verifica billing en <https://platform.openai.com/account/billing>. gpt-image-2 requiere tier con saldo.

### El dashboard no actualiza

Probablemente SSE bloqueado por proxy o red corporativa. El dashboard cae a polling cada 2s automáticamente — si no, refresca la página manualmente. Logs del server en stdout.

### Claude Code no reconoce un slash command

Cierra y reabre Claude Code. Los slash commands se cargan al inicio de sesión. Si los acabas de agregar, no los ve hasta reabrir.

## Próximos pasos

- Lee [`README.md`](../README.md) para vista general de capacidades.
- Lee [`CLAUDE.md`](../CLAUDE.md) si quieres entender cómo Claude opera dentro del repo.
- Catálogo de skills opcionales: [`.claude/skills/_catalog/INDEX.md`](../.claude/skills/_catalog/INDEX.md).
- MCPs recomendados por perfil: [`docs/mcps-recomendados.md`](mcps-recomendados.md).
