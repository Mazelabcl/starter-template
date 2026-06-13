---
description: Genera RESUMEN.html autocontenido del estado del proyecto (sprint + decisiones + consumo).
---

# /resumen

Genera un `RESUMEN.html` autocontenido (datos inline, abre con doble-click, sin servidor) con el estado actual del proyecto.

## Qué hacer

1. **Redacta un TLDR en lenguaje NO técnico** (2-4 frases) que resuma para Aldot qué pasó en la sesión / dónde está el proyecto. Nada de jerga (API, schema, endpoint, etc.). Tono directo.
2. **Lista 1-4 "próximas acciones"**, también en lenguaje simple, como cosas concretas que el usuario o el sistema harán a continuación.
3. **Ejecuta el script** pasando el TLDR como primer argumento y cada acción como argumento siguiente:

   ```
   node scripts/build_resumen.js "<tldr no técnico>" "<acción 1>" "<acción 2>"
   ```

   El script lee solo: `roadmap/current-sprint.json`, `memory/decisions.md` y `dashboard/history/events.log` (si existen). Degrada con gracia si falta alguno — no rompe.

4. **Avisa al usuario la ruta del HTML generado** (la imprime el script: `RESUMEN.html` en la raíz del repo) y dile que lo abra con doble-click.

## Reglas

- El TLDR y las próximas acciones los redactas TÚ — el script NO los infiere. Si no los pasas, el HTML queda con un placeholder visible.
- Español neutro. Cero voseo ni regionalismos.
- No inventes datos del sprint/decisiones/consumo: esos salen de los archivos. Tú solo aportas la narrativa del TLDR y las acciones.
