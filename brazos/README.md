# Brazos — integraciones para ejecutar

**TLDR:** un "brazo" es cualquier integración que le permite a Claude **hacer** cosas, no solo planearlas: un MCP (Vercel, Supabase, Higgsfield), una API (OpenAI, Replicate), una CLI (`gh`, `vercel`), una skill, una librería o un plugin. Este directorio dice cuáles existen, para qué sirven, si ya están conectados en tu computador y cómo conectar los que faltan.

## Comandos

1. `node src/brazos.js status`
   (revisa cada brazo y dice: conectado / falta auth / no instalado / revisar a mano. Tarda ~15 s la primera vez porque consulta `claude mcp list`; después usa una caché de 10 min)
2. `node src/brazos.js suggest "landing con pedidos online y video para Instagram"`
   (propone los brazos que convienen para ese proyecto, con una razón por cada uno)
3. `node src/brazos.js connect vercel-mcp`
   (imprime los pasos exactos para conectarlo; **no instala nada por ti**)
4. `node src/brazos.js mcp-json vercel-mcp supabase-mcp`
   (muestra el `.mcp.json` del proyecto con esos MCP; si te parece bien, repite con `--write` para guardarlo)
5. `node src/brazos.js list`
   (lista todas las entradas)

Opciones: `status --sin-mcp` (no consulta `claude mcp list`), `status --refrescar` (ignora la caché), `--json` (salida para agentes), `suggest --top=5`, `suggest --estado` (agrega el estado de cada brazo).

Si las keys viven en otro `.env`, cárgalo antes: `node --env-file=.env src/brazos.js status` (esto carga las variables del `.env` antes de revisar; nunca se imprimen sus valores).

## Estados

| Estado | Qué significa | Qué hacer |
|---|---|---|
| conectado | Instalado y con credencial | Usarlo |
| falta auth | Instalado, pero falta la key en `.env` o autenticar en `/mcp` | `connect <id>` y sigue la parte de credencial |
| no instalado | No aparece (MCP, CLI, plugin o archivo) | `connect <id>` |
| revisar a mano | No se puede detectar solo (check `manual`) o el MCP no conecta | Revisar el link de la doc |

## Formato de una entrada (`directorio.json`)

Valida contra `directorio.schema.json`. Campos:

- `id`, `nombre`, `tipo` (`api|mcp|cli|skill|libreria|plugin|conector`), `categoria` (`web|datos|research|creativo-imagen|creativo-video|creativo-3d|audio|marketing|trading|productividad|deploy`).
- `para_que` (una línea), `cuando_usar`, `keywords` (para `suggest`), `link`, `costo`, `oficial`, `recomendado` (opcional, desempata).
- `como_conectar`: `comando` copy-paste (opcional) + `pasos`.
- `auth`: `necesita`, `credencial` y `env_var` (nombre de la variable en `.env`, nunca el valor).
- `check`: lista de `{ tipo: env|mcp|cli|file|plugin|manual, valor, rol?: instalacion|auth }`. `env` cuenta como auth; el resto como instalación.
- `mcp` (opcional): lo que se escribe en `.mcp.json` (`url` + `transport`, o `command` + `args`; keys como `${VAR}`).
- `riesgos`, `verificado` (`ok`, `fecha`, `fuente`): `ok: true` solo si el comando o la URL se vio en una página oficial.

## Agregar un brazo

1. Agrega la entrada en `directorio.json` (copia una parecida).
2. Verifica el comando contra la doc oficial; si no puedes, deja `verificado.ok: false`.
3. Corre `node brazos.test.js` (esto valida el schema y los checks).

## Gotchas conocidos

- **Vercel detecta Python** por los `*.py` y `requirements.txt` del starter: crea un `.vercelignore` con `scripts/`, `requirements.txt` y `.venv/` antes del primer deploy.
- **Windows y el SDK de openai:** Smart App Control puede bloquear la DLL `jiter`. Ruta B: Replicate (`nano-banana-pro`) o llamar la API con `fetch` desde Node.
- Los MCP nuevos solo aparecen después de **reiniciar Claude Code**.
