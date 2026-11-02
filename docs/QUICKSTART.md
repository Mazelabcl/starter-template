# Quickstart de 5 minutos

Para quien clona el starter por primera vez. Al terminar tienes un proyecto listo para trabajar con Claude Code.

> **Atajo en Windows:** si ya instalaste el atajo (`powershell -ExecutionPolicy Bypass -File scripts\instalar-atajo.ps1`, una sola vez), escribe `nuevo-proyecto mi-proyecto` en una ventana nueva de PowerShell y te saltas los pasos 1, 2 y 4: clona, copia tu `.env`, instala y abre Claude Code con `/kickoff`.

## Paso 1 — Clonar el template

```bash
git clone https://github.com/Mazelabcl/starter-template.git mi-proyecto
cd mi-proyecto
```
(descarga el starter en la carpeta `mi-proyecto` y entra en ella)

## Paso 2 — Instalar y configurar keys

```bash
npm install
```
(instala dependencias y corre `setup.js`, que te pide las API keys)

El setup te pide:

- **OpenRouter** (`OPENROUTER_API_KEY`) — research con Perplexity y councils. Obligatoria. Sácala en <https://openrouter.ai/keys>. Formato `sk-or-v1-...`.
- **OpenAI** (`OPENAI_API_KEY`) — gpt-image-2. Opcional. Antes verifica en <https://platform.openai.com/settings/organization/general> que tu organización esté verificada. Formato `sk-proj-...`.
- **Replicate** (`REPLICATE_API_TOKEN`) — image-explorer y modelos FLUX / Ideogram / Nano Banana Pro. Opcional. Formato `r8_...`.

También detecta Python 3.10+ y crea un venv con `openai`. Si falta Python, te dice cómo instalarlo.

Si saltaste una key, configúrala después con `/setup-openrouter` o `/setup-openai` dentro de Claude Code.

## Paso 3 — Smoke test (recomendado)

```bash
npm run smoke
```
(4 checks reales: keys, memoria, research y una imagen; ~USD 0.05)

Sin gastar nada:

```bash
npm run smoke:quick
```
(solo revisa keys y memoria, sin llamadas a APIs)

Errores comunes de cada check: `scripts/smoke_test.README.md`.

## Paso 4 — Arrancar Claude Code

Abre Claude Code en la carpeta y escribe:

```
/kickoff
```

La entrevista detecta el tipo de proyecto (build / business / content / research / personal), recomienda skills opcionales y deja listos `memory/project-profile.json`, `memory/active-team.json` y el Sprint 1 en `roadmap/`.

## Paso 5 — Capturar ideas sin perder el foco (opcional)

```
/idea probar una landing con video de fondo
```

Va al backlog del sprint. No ejecuta nada.

## Tips por capacidad

| Cuándo usar | Comando | Costo aproximado |
|---|---|---|
| Research con fuentes | `node src/research.js pro "tu pregunta"` | USD 0.001 a 0.01 |
| Research profundo (tarda minutos) | `node src/research.js deep "tu pregunta"` | USD 0.05 a 0.20 |
| Decisión con tradeoffs reales | `/council` | USD 0.02-0.05 (multimodel ~USD 0.30-0.50) |
| Explorar un prompt de imagen en varios modelos | `node src/image_explorer.js --prompt "..." --models "gpt-image-2,flux-1.1-pro"` | ~USD 0.18 por 4 modelos |
| Imagen con personaje consistente | skill `image-gen` (en conversación) | USD 0.04 a 0.25 |
| Revisar entregables en el navegador | `npm run review-app` | sin costo |

## Errores comunes

### `Faltan dependencias. Corre primero: npm install`
Lanzaste `npm run setup` antes de `npm install`. Corre `npm install` y reintenta.

### `variable(s) con valor placeholder`
La key sigue siendo el texto de ejemplo (`sk-or-v1-pega-aqui-tu-key`). Reemplázala por tu key real en `.env`.

### `Python 3.10+ no detectado`
Instala Python según tu sistema (el setup te muestra cómo) y corre `npm run setup`.

### `no module named 'openai'`
Usa el Python del venv: `.venv\Scripts\python.exe` en Windows, `.venv/bin/python` en Mac/Linux. Si no existe, corre `npm run setup`.

### `Timeout: el modelo no terminó en ...ms` (research `deep`)
Sube el límite: `node src/research.js deep "pregunta" --timeout-ms=600000` (10 minutos).

### Claude Code no reconoce un slash command
Cierra y reabre Claude Code: los commands se cargan al iniciar la sesión.

## Próximos pasos

- [`README.md`](../README.md): vista general.
- [`docs/capacidades.md`](capacidades.md): qué usar y qué test correr.
- [`.claude/skills/_catalog/INDEX.md`](../.claude/skills/_catalog/INDEX.md): skills opcionales.
- [`docs/mcps-recomendados.md`](mcps-recomendados.md): MCPs por perfil.
