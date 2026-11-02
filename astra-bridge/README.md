# astra-bridge: puente automático con Astra (Codex)

Astra es OpenAI Codex instalado en este computador. Genera imágenes con la cuota del plan de ChatGPT, sin API key. Este puente lo usa sin que nadie copie y pegue: `src/astra.js` escribe el pedido, corre `codex exec` en segundo plano, valida los PNG y deja el resultado.

## Uso

1. `node src/astra.js estado` → revisa que Codex esté instalado y con sesión de ChatGPT.
2. `node src/astra.js pedir --prompt "a flat orange circle icon on white" --out assets/astra/circulo/` → genera 1 imagen (unos 30-60 s).
3. `node src/astra.js lote pedidos.json` → varios pedidos seguidos (`--concurrencia 2` como máximo recomendado).

Opciones de `pedir`: `--n 1-4`, `--size 1:1|16:9|9:16|1536x1024`, `--refs a.png,b.png` (en el prompt se nombran `Image 1`, `Image 2`...), `--intencion`, `--evitar`, `--id`, `--timeout 600`.

## Carpetas

| Carpeta | Qué guarda | ¿Va a git? |
|---|---|---|
| `pedidos/<id>.json` | el pedido (prompt, formato, refs, nombres esperados, estado) | no |
| `resultados/<id>.json` | estado (`ok`, `parcial`, `error`), archivos, duración, error y cola de la salida de Codex | no |

Las imágenes quedan en la carpeta `--out`, con nombres `<slug>_v1.png` o `<slug>_v1-a.png`, `-b`... (igual que el puente manual). Nunca se sobrescribe una versión anterior.

## Si algo falla

- "Codex no está instalado": instala la app Codex desde Microsoft Store o `npm i -g @openai/codex`.
- "sin sesión iniciada": abre una terminal PowerShell nueva y corre el comando `login` que muestra `estado`.
- Error de cuota (`usage limit`): se agotó la cuota de imágenes del plan; espera a que se renueve o usa la skill `image-gen` (API, con costo).
