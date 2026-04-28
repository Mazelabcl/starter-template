# Starter Template — instrucciones para Claude

Este es un starter de aldot. Cada nuevo proyecto se clona desde acá.

## Antes de cualquier cosa

1. Si el usuario aún no ha configurado la API key, sugiere correr `/setup-openrouter` (slash command) o `npm run setup`. Detecta esto chequeando si existe `.env` con `OPENROUTER_API_KEY` no vacío.
2. Lee `docs/company.md` para entender el contexto de la empresa del usuario (si está poblado). Aplica ese contexto en research/contenido/agentes.

## Capacidades disponibles

- **Research vía Perplexity (OpenRouter):** `node src/research.js <quick|pro|search|reason|deep> "<pregunta>"`. Usa `pro` por default. Devuelve contenido + citations.
- **Crear agentes especializados:** invoca skill `agent-template` (vive en `.claude/skills/agent-template/SKILL.md`) cuando el usuario pida "crea un agente para X".
- **Reglas de coding:** la skill `karpathy-rules` define 4 reglas que aplico siempre que escriba código.

## Modelo operativo

- Para tareas que requieran info actualizada de internet → SIEMPRE usa research.js con modelo `pro` o `search`. NO inventes datos.
- Para crear agentes nuevos en este proyecto → usa skill agent-template, guárdalos en `.claude/agents/`.
- Para Git/PR/code review → sigue las prácticas de la skill superpowers-lite.

## Tono / idioma

Español-CL, tutea, directo. Usuario es novato — explica decisiones técnicas en lenguaje simple.
