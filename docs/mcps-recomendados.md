# MCPs recomendados

Los MCP servers (Model Context Protocol) son **distintos** a las skills. Una skill es un archivo markdown con instrucciones que Claude lee; un MCP server es un proceso externo que expone herramientas a Claude vía protocolo. Por eso viven en el `mcpServers` de `~/.claude/settings.json`, no en `.claude/skills/`.

Este doc lista los MCPs útiles para distintos perfiles de proyecto. Aldo decide cuáles instalar según necesidad — no son ni core ni catálogo, son ortogonales.

---

## MCPs útiles por perfil

### Build software (codebase grande)

- **Context7** — búsqueda semántica sobre codebase. Útil cuando Grep/Glob no alcanza (codebase >50 archivos, queries que necesitan entender intent del código). [Repo](https://github.com/upstash/context7).
- **GitHub MCP** — lectura/escritura sobre repos, issues, PRs, releases. Útil con flujo PR formal. [Repo](https://github.com/github/github-mcp-server).
- **Codebase-memory MCP** — memoria persistente del codebase entre sesiones. Útil en proyectos de larga duración con decisiones técnicas acumuladas que se pierden entre conversaciones.

### Research / análisis

- **Firecrawl** — scraping web optimizado para LLMs (devuelve markdown estructurado en lugar de HTML crudo). Útil cuando research requiere pulling de fuentes externas masivamente. [Repo](https://github.com/mendableai/firecrawl-mcp-server).
- **Obsidian-MCP** — integra el vault Obsidian del usuario con Claude. Útil para research/personal con vault existente. [Repo](https://github.com/MarkusPfundstein/mcp-obsidian).

### Personal / journaling

- **Obsidian-MCP** — idem.

### Cualquier perfil con TradingView

- **TradingView MCP** — control y lectura de chart TradingView, Pine Script. Aldot ya lo tiene. Solo aplica a proyectos de trading/finanzas.

### Cualquier perfil con diseño Pencil

- **Pencil MCP** — edición de archivos `.pen`. Aldot ya lo tiene. Solo aplica a proyectos con diseño en Pencil.

---

## Cómo agregar un MCP a Claude Code

1. **Encuentra el comando de instalación** del MCP en su repo (cada uno trae instrucciones específicas).
2. **Edita `~/.claude/settings.json`** y agrega bloque dentro de `mcpServers`:

```json
{
  "mcpServers": {
    "nombre-del-mcp": {
      "command": "npx",
      "args": ["-y", "@scope/nombre-del-mcp"],
      "env": {
        "API_KEY": "tu-key-si-aplica"
      }
    }
  }
}
```

3. **Reinicia Claude Code** (cierra y vuelve a abrir la sesión, o reinicia el proceso). Los MCPs se cargan al inicio.
4. **Verifica disponibilidad** — debería aparecer en el system reminder al inicio de la conversación con sus herramientas listadas.

Para detalles oficiales: <https://docs.anthropic.com/claude/docs/mcp> (documentación de Anthropic sobre MCP).

---

## Cuándo activar cada uno

| MCP | Activa si... |
|---|---|
| Context7 | Codebase >50 archivos y haces queries semánticas frecuentes ("dónde se gestiona X", "qué módulos tocan Y") |
| Codebase-memory | Proyecto build de >1 mes con muchas decisiones técnicas acumuladas |
| Obsidian-MCP | Tienes vault Obsidian con notas/research que quieres que Claude lea |
| Firecrawl | Research recurrente que requiere scraping (>5 fuentes externas por sesión) |
| GitHub MCP | Trabajas con GitHub formal (issues, PRs, releases, CI), no commits sueltos |

---

## MCPs vs skills — recordatorio

| | Skill | MCP server |
|---|---|---|
| Qué es | Markdown con instrucciones que Claude lee | Proceso externo que expone herramientas |
| Ubicación | `.claude/skills/<name>/SKILL.md` | `~/.claude/settings.json` (bloque `mcpServers`) |
| Activación | Automática (core) o vía kickoff/manual (catálogo) | Configuración global del usuario |
| Reinicio | No requiere | Sí, al agregar/quitar MCPs |
| Costo | Sin costo (lo carga Claude del repo) | Depende del MCP (algunos requieren API keys de pago) |

---

## Anti-patrones con MCPs

- **Instalar todo MCP que veas.** Cada MCP suma latencia al startup y ruido en el contexto. Activa solo los que vas a usar la próxima semana.
- **Confundir MCP con skill.** Si lo que necesitas es disciplina (qué hacer, qué evitar), eso es skill. Si necesitas herramienta nueva (lee X, escribe Y), eso es MCP o utility en `src/`.
- **API keys en código.** Las API keys de MCPs van a `env` del settings o a `.env` que el MCP lea — nunca al código fuente.
