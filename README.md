# Starter Template

Repo base para iniciar proyectos con Claude Code + OpenRouter (Perplexity) + capacidad de crear agentes.

## Quickstart (3 minutos)

```bash
# 1. Clonar
git clone https://github.com/Mazelabcl/starter-template mi-proyecto
cd mi-proyecto

# 2. Instalar
npm install

# 3. Configurar API key (elige una)
npm run setup                    # interactivo desde terminal
# o desde Claude Code:
# escribe /setup-openrouter

# 4. Probar
node src/research.js quick "qué hora es en Tokio"
```

## Modelos disponibles

| Alias | Modelo | Uso |
|---|---|---|
| `quick` | sonar | Pregunta rápida |
| `pro` (default) | sonar-pro | Investigación general |
| `search` | sonar-pro-search | Búsqueda agéntica |
| `reason` | sonar-reasoning-pro | Análisis profundo |
| `deep` | sonar-deep-research | Multi-paso |

## Estructura

- `src/research.js` — wrapper OpenRouter + CLI
- `setup.js` — config interactivo de la API key
- `.claude/skills/` — skills disponibles (karpathy-rules, agent-template, superpowers-lite)
- `.claude/commands/setup-openrouter.md` — slash command para configurar la key
- `docs/company.md` — info de tu empresa (poblar antes de empezar)

## Agregar info de tu empresa

Edita `docs/company.md` con: qué hace tu empresa, servicios, audiencia, tono. Claude lo usará automáticamente.
