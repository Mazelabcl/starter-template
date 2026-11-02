---
description: Trae un módulo del starter v6 (cockpit, bold-rounds, council, brazos, video-director) a este proyecto VIEJO sin pisar nada. Uso /importar-modulo <nombre> [ruta-del-starter-v6]
---

El usuario quiere traer a ESTE proyecto (uno creado con un starter viejo) un módulo del starter v6: `$ARGUMENTS`.

Rules: Spanish neutro, no voseo, no regionalismos rioplatenses. The user is a novice: TLDR first, no walls of text. Never overwrite an existing file. Never print `.env` content.

1. **Find the v6 source.** Second argument if given; otherwise `C:\Users\aldot\.gemini\antigravity\scratch\Starter-template\repo`. Check that `<origen>/modulos.json` and `<origen>/scripts/importar_modulo.js` exist. If the source checkout is not on the v6 branch (or a v6-based branch), say so and stop. If this folder IS the starter itself, stop: the command runs inside the old project.
2. **If no module name was given** (or it is not in the manifest), run `node "<origen>/scripts/importar_modulo.js" list` and ask which one. Dependencies come along automatically (e.g. `bold-rounds` brings `cockpit`, because `scripts/bold_rounds.js` imports `src/cockpit.js`; `cockpit` and `council` bring `base`).
3. **Plan first (no writes):**
   ```
   node "<origen>/scripts/importar_modulo.js" <nombre> --dry-run
   ```
   (esto muestra qué archivos se copiarían, cuáles ya existen con otro contenido y qué cambia en package.json, sin escribir nada)
   - If it stops with a **CommonJS** error: explain in 2 lines and recommend option 1 (rename the project's CommonJS files to `.cjs`, update their `require` paths, add `"type": "module"`). Do it only after an explicit yes, then run the dry-run again.
   - If there are **conflicts** in `base` files (`src/load_env.js`, `src/openrouter_client.js`, `src/memory.js`, `src/roadmap.js`) and the report says a file does not export what the module needs, tell the user and propose: back up their file as `<archivo>.viejo.js`, take the starter's version, and re-apply their local changes. Only with a yes.
4. **Import:**
   ```
   node "<origen>/scripts/importar_modulo.js" <nombre>
   ```
   (copia los archivos que faltan, agrega dependencias, scripts npm y líneas de .gitignore que no estaban, corre npm install y luego los comandos de verificación del módulo)
   - It never overwrites: every conflict is listed and the user's file stays intact. For each conflict, show a short diff summary (`git diff --no-index <archivo> "<origen>/<archivo>"`, max 10 lines) and ask whether to keep theirs or take the starter's.
   - The cockpit check publishes and opens the example review in the browser, then closes it and deletes the example (that is the real run). If the user does not want the browser opened, set `COCKPIT_NO_BROWSER=1` for that run.
   - Exit code 2 = something failed in npm install or verification: read the `FALLA` lines, fix the cause (missing export, missing dependency, CommonJS file) and re-run the import (it is idempotent: identical files are skipped).
5. **Report in max 5 lines:** modules imported, files copied (count), conflicts (list), verification OK/FALLA, and the one command to try it (e.g. `/revisar`, `/bold-rounds`, `/council`, `node src/brazos.js status`). Skills and commands copied into `.claude/` are visible without restarting Claude Code; if a hook or `settings.json` changed, ask the user to restart.
6. Do not commit unless the user asks.
