# Council de expertos

Un council reúne a varias **personas expertas** (CTO, devops, product manager, usuario novato, un visionario inspirado en Steve Jobs...) para mirar una tarea desde ángulos que tú quizá no considerarías. No votan ni eligen ganador: cada una opina por separado y después un integrador **fusiona** las amenazas, oportunidades e ideas de todas en una propuesta mejorada, diciendo quién vio cada cosa ("esto lo vio el devops").

## Cómo funciona

1. **Fase 1 (independiente):** cada persona responde en paralelo, sin ver a las demás. Devuelve amenazas, oportunidades, ideas, su preocupación principal y qué la haría cambiar de opinión.
2. **Fase 2 (fusión):** un modelo de otra familia (si las personas usan mayormente Claude, el integrador es GPT o Gemini) recibe las respuestas **anónimas** (Voz A, B, C) y arma la propuesta integrada, la lista de aportes (adoptados o no, con el porqué), las tensiones y una recomendación. La recomendación **nunca** queda vacía: la duda se expresa con la confianza (alta, media, baja).
3. **Fase 3 opcional (`--redteam`):** el contrarian ataca la propuesta. Si encuentra algo serio, el integrador la parcha; si solo hay detalles, se detiene ahí.

Cada persona recibe automáticamente `content/principles.md`, las decisiones recientes de `memory/decisions.md` y los archivos que pases con `--files`.

## Comandos

1. `node src/council.js suggest "describe tu tarea"` → (esto propone qué council te sirve, con costo y tiempo)
2. `node src/council.js list` → (esto lista plantillas y personas)
3. `node src/council.js run --template nueva-funcionalidad --question "¿X o Y?" --files docs/spec.md` → (esto corre el council y guarda el resultado)
4. Agrega `--dry-run` → (esto muestra costo y tiempo estimados sin gastar nada)

Opciones de `run`: `--personas cto,pm` (elegir voces a mano), `--crear "Rol: foco"`, `--guardar`, `--redteam`, `--mode multimodel`, `--context "..."`, `--yes` (confirma el costo).

## Tres formas de elegir a los expertos

1. **Tú eliges:** `node src/council.js run --personas cto,steve-jobs --question "¿X o Y?"` → (usa personas que ya existen, sin plantilla; si un id no existe, el error lista los válidos)
2. **Creas el tuyo:** `node src/council.js run --personas cto --crear "Experta en aforo de eventos: mira seguridad y permisos" --question "¿X o Y?"` → (antes de los dos puntos va el rol y después el foco; se puede repetir y combinar con `--personas`)
3. **Que lo arme Claude:** dile "arma tú el panel de expertos". → (elige de 3 a 5 expertos, te muestra por qué cada uno y el costo, y corre solo si dices que sí)

Un experto de `--crear` vive solo en esa corrida. Agrega `--guardar` para dejarlo en `councils/personas/` y reutilizarlo con `--personas`.

## Modos y costo

| Modo | Cuándo | Costo aprox. | Tiempo |
|---|---|---|---|
| `personas` (default) | casi siempre | USD 0.02-0.05 | 40-100 s |
| `multimodel` | arquitectura difícil y cara de revertir | USD 0.30-0.50 | 2-5 min |

`multimodel` (o cualquier council de más de USD 0.50) exige `--yes`: es tu confirmación del costo.

## Plantillas

| Plantilla | Personas |
|---|---|
| `nueva-funcionalidad` | CTO + PM + UX + usuario novato |
| `arquitectura-critica` | CTO + SRE + seguridad + contrarian (multimodel + red team) |
| `lanzamiento-marketing` | growth + storyteller + ventas + cliente |
| `diseno-visual` | director de arte + UX + visionario |
| `precio-negocio` | CFO + ventas + cliente |
| `contenido-creativo` | storyteller + director de arte + audiencia objetivo |
| `naming` | storyteller + ventas + usuario novato + contrarian |
| `estrategia` | PM + CFO + visionario + contrarian (red team) |

Personas base (16; `steve-jobs` es un alias de `visionario`): `cto`, `sre`, `seguridad`, `datos`, `pm`, `ux-research`, `growth`, `cfo`, `ventas`, `cliente`, `director-arte`, `storyteller`, `visionario`, `contrarian`, `usuario-novato`, `audiencia`.

## Dónde queda el resultado

- `councils/results/<id>.json`: todo (respuestas de cada persona, fusión, red team, costo real).
- `cockpit/reviews/<id>.json`: la revisión para el cockpit, en láminas: la recomendación con sus pasos, quién participó (diagrama), una lámina por tensión para elegir un lado con un clic y un aporte por lámina, los adoptados primero. Cada titular dice el contenido en máximo 10 palabras (lo escribe el integrador en el campo `titular`); el detalle queda detrás de "Ver más".

El council **nunca** escribe en `memory/`. Si decides algo a partir de él, Claude lo registra con `addDecision()` solo cuando tú lo confirmas.

## Agregar una persona o plantilla

Lo más rápido para una persona: `--crear "Rol: foco" --guardar` en una corrida. Para ajustarla a mano:

1. Copia un JSON de `councils/personas/` (o `councils/templates/`) con otro nombre.
2. Edítalo: el `id` debe ser igual al nombre del archivo.
3. Corre `node councils-library.test.js` → (esto valida que el archivo esté bien formado)

Una persona puede estar "inspirada en" alguien real, pero nunca dice ser esa persona.
