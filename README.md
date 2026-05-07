# Starter Template

Repo base para iniciar proyectos con Claude Code. Incluye:

- **Pipeline v2** de orquestación de agentes (architect → critic → cold-reader → humano).
- **Entrevista `/kickoff`** que autogenera el canon del proyecto.
- **Research** vía Perplexity (OpenRouter).
- **Imágenes** con gpt-image-2 + identity lock + batch paralelo.

Diseñado para que cualquier persona novata pueda clonar y arrancar.

## Quickstart (3 minutos)

```bash
# 1. Clonar
git clone https://github.com/Mazelabcl/starter-template mi-proyecto
cd mi-proyecto

# 2. Instalar — el setup automático te pide las API keys e instala Python deps
npm install

# 3. Copiar permisos sugeridos para Claude Code (evita prompts en cada comando)
cp .claude/settings.example.local.json .claude/settings.local.json
# (en Windows PowerShell: Copy-Item .claude/settings.example.local.json .claude/settings.local.json)
```

> **Importante:** copia `.claude/settings.example.local.json` a
> `.claude/settings.local.json` antes de correr el primer flujo. Trae los
> permisos típicos (`npm`, `node src/research.js`, `python scripts/openai_images.py`,
> `git`, etc.) ya pre-aprobados, así Claude Code no te pregunta en cada paso.

`npm install` corre `setup.js` que:
- Te pide la **OpenRouter API key** (research) — opcional pero recomendada.
- Te pide la **OpenAI API key** (gpt-image-2) — opcional, solo si vas a generar imágenes.
- Detecta **Python 3.10+**. Si está, crea un `venv` e instala `openai` automáticamente. Si no, te muestra cómo instalarlo según tu sistema operativo.

```bash
# 3. Abrir Claude Code y escribir:
/kickoff
```

El comando `/kickoff` te entrevista y genera `content/principles.md` + `content/INDEX.md` con tu proyecto definido. Después, todo lo que crees pasa por **pipeline v2**.

## Cómo funciona el pipeline v2

Cada vez que pides crear algo no trivial (guion, imágenes, plan, código de feature):

```
Capa 0  — content/principles.md   (canon del proyecto, definido en /kickoff)
Capa 0.5 — content/INDEX.md       (decide qué archivos cargar para la tarea)
Capa 1  — Architect                (crea el deliverable)
Capa 2  — Critic interno multi-óptica
Capa 3  — Cold-reader gate         (lectura independiente, voto GO/NO-GO con veto absoluto)
Capa 4  — Humano (tú) decide
```

Esto evita que los agentes generen cosas que pasan validación interna pero fallan al leer en frío.

## Capacidades

### Research (texto)

```bash
node src/research.js quick "qué hora es en Tokio"
```

| Alias | Modelo | Uso |
|---|---|---|
| `quick` | sonar | Pregunta rápida |
| `pro` (default) | sonar-pro | Investigación general |
| `search` | sonar-pro-search | Búsqueda agéntica |
| `reason` | sonar-reasoning-pro | Análisis profundo |
| `deep` | sonar-deep-research | Multi-paso |

### Imágenes (gpt-image-2)

```bash
# Una imagen
python scripts/openai_images.py generate "un perro azul" output.png --quality medium

# Imagen con references (identity lock)
python scripts/openai_images.py edit "match exactly Image 1" '["char_sheet.png"]' scene01.png

# Batch paralelo (hasta 8-20 simultáneas según tier OpenAI)
python scripts/openai_images.py batch jobs.json --concurrent 8
```

La skill `image-gen` lo orquesta con todas las reglas (identity lock, refs en texto del prompt, validación multimodal después).

### Slash commands disponibles

- `/kickoff` — entrevista inicial del proyecto
- `/setup-openrouter` — configura la key de OpenRouter
- `/setup-openai` — configura la key de OpenAI

## Estructura

```
starter-template/
├── content/                 # principles.md, INDEX.md, lore, char-sheets, outputs (vacío al clonar)
├── process-log/             # 00-decisions.md (decisiones humanas — ley)
├── scripts/                 # openai_images.py
├── src/                     # research.js
├── docs/company.md          # contexto de tu empresa (poblar si aplica)
├── .claude/
│   ├── skills/
│   │   ├── kickoff/         # entrevista inicial
│   │   ├── pipeline-v2/     # orquestación de capas
│   │   ├── cold-reader-gate/# capa 3 independiente
│   │   ├── multimodal-validation/  # forzar Read del PNG
│   │   ├── image-gen/       # wrapper gpt-image-2
│   │   ├── agent-template/  # generar agentes con score ≥92
│   │   ├── karpathy-rules/  # 4 reglas de coding
│   │   └── superpowers-lite/# 5 reglas Git/PR
│   └── commands/
│       ├── kickoff.md
│       ├── setup-openrouter.md
│       └── setup-openai.md
├── CLAUDE.md                # instrucciones operativas
├── setup.js                 # setup interactivo
├── requirements.txt         # deps Python (openai)
└── package.json
```

## Costos referenciales gpt-image-2

| Quality | 1024×1024 | 1024×1536 |
|---|---|---|
| low | ~$0.011 | ~$0.018 |
| medium | ~$0.04 | ~$0.06-0.07 |
| high | ~$0.17 | ~$0.25 |

Las references no suben el costo significativamente.

## Para agregar info de tu empresa

Edita `docs/company.md` con: qué hace tu empresa, servicios, audiencia, tono. Claude lo lee como contexto base.

## Versión

v0.2 — pipeline v2 + gpt-image-2 + entrevista /kickoff.
