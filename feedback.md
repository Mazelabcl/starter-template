# feedback.md — del starter Mazelab

Buzón para reportar findings sobre el **starter-template Mazelab** (skills faltantes, scripts rotos, anti-patrones en docs). **NO** es para bugs/features del proyecto consumer.

**Para reportar algo del starter, agrega tu finding bajo `## NUEVO`.** El usuario solo dice "anota en feedback.md" — la estructura de abajo es self-documented, no necesitas preguntar formato. Fecha + contexto + finding + acción sugerida (opcional). Texto libre OK si es claro.

**Si parcheaste a mano un script/archivo DEL STARTER en este proyecto** (no del consumer), anótalo con el tag `[UPSTREAM-FIX]` al inicio del título — el orquestador del starter lo prioriza sobre features para que el fix suba al starter rápido. Ejemplo: `## 2026-06-02 — [UPSTREAM-FIX] openai_images.py ignora refs .webp`.

**Cómo se procesa:** cuando aldot retoma sesión sobre el starter, le da esta ruta al orquestador del starter, que lee `## NUEVO`, sincroniza al inbox global, aplica fixes y mueve lo procesado a `## Archivo` con fecha. **No arregles el starter desde el proyecto consumer** — tu rol es reportar.

---

## NUEVO (sin procesar)

<!-- Los agentes del proyecto escriben sus findings acá, al final de esta sección. Formato libre, una entry por finding:
## YYYY-MM-DD — <título corto>
Contexto: qué estaba haciendo el proyecto cuando apareció.
Finding: qué del starter falla / falta / molesta.
Acción sugerida (opcional): qué cambiar en el starter.
-->

(vacío: las 7 entradas del 2026-11-06 se procesaron ese mismo día en la rama `fix/tokens` y están en Archivo)

---

## Archivo (ya procesado por el orquestador del starter)

<!-- El orquestador del starter mueve acá lo que ya sincronizó al inbox global y/o arregló, anotando la fecha de proceso. -->

## 2026-11-06 — LÉEME PRIMERO: pedido de Aldo al dueño del starter (prioridad alta)
**Procesado 2026-11-06 (rama `fix/tokens`):** los 6 arreglos pedidos están hechos y medidos; detalle en cada entrada de abajo.
Aldo hace muchos proyectos chicos de marketing de eventos (memory, ruleta, juegos con webcam, ideas rápidas). El starter debe partir rápido con Replicate, OpenRouter/Perplexity, Bold Rounds y councils **sin transformarse en un devorador de tokens**. Hoy lo es: en Weddi, 2 corridas se comieron dos ventanas completas de 5 horas. Arreglos pedidos, en este orden (detalle en las entradas de abajo):
1. **Aislar las sesiones hijas** (`claude -p` de variantes y personas del council): que no hereden skills, plugins, CLAUDE.md global ni MCP del usuario. Meta: contexto inicial < 15 mil tokens (hoy ~55 mil para un encargo de ~1.200).
2. **Separar idear de construir** en Bold Rounds: Opus idea sin herramientas y con contexto mínimo; la construcción va aparte, con tope de turnos y sin auto-verificación (hoy son 60-76 turnos por variante). **No bajar a Sonnet la ideación**: Aldo busca ideas fuera de la caja.
3. **Council modo entrevista sin sesiones completas**: las personas solo producen texto. Usar llamadas directas al modelo (o OpenRouter barato para la audiencia) y Opus solo para coaches e integrador.
4. **Presupuesto visible antes de correr**: al iniciar, estimar "esto gasta ~X % de tu ventana de 5 h" y preguntar. En serie por defecto, no en paralelo.
5. **Robustez desatendida**: timeouts reales, límite de uso tratado como "reintentar", `node --check`, esperas cortas.
6. **Página de revisión visual**, generada por el helper, no inventada por cada orquestador.
Base del código: rama `feat/rondas-producto-involucramiento` (sin merge a v6). Ya trae `--modo producto`, `--involucramiento`, comentarios que van a la variante con contexto, y council con motor agentes y modo entrevista. Los arreglos de arriba van sobre esa rama, antes del merge.

### Cómo funcionó la corrida de Weddi (para reproducir el problema)
- **Council entrevista** (~50 sesiones `claude -p`): cada coach escribe preguntas por separado → cada persona de audiencia responde sola → una repregunta por persona → cada coach propone innovaciones → un integrador fusiona con atribución → `councils/results/<id>-hallazgos.md`. Transcripciones en `C:\Users\aldot\.gemini\antigravity\scratch\Mazelab-dev\Experimentos\Weddi\weddi-innovacion-claude-council\innovacion\resultados\rama3-council\councils\`.
- **Cada ronda**: `prepare N` (copia la working + prompt-blind/prompt-context) → `run N` (2 `claude -p` en paralelo; cada uno idea, programa la demo y escribe notes.md) → `after N` (capturas + diff + rechazo) → el orquestador Opus mira PNG y notes y hace `apply N <variante> --auto --razon` → `review N`.
- Corridas: `rounds-personas` (demo de experiencia, lente novia/novio alternada) y `rounds-plataforma` (demo comercial, foco en ventas), en las ramas 2 (sin council) y 3 (con `--hallazgos`).

## 2026-11-06 — Bold Rounds + council se volvieron un devorador de tokens (dato medido)
**Procesado 2026-11-06:** `src/claude_aislado.js` aísla cada `claude -p` (`--safe-mode --strict-mcp-config`, `--effort` explícito, `--max-turns`, timeout que mata el árbol): contexto inicial 52 K → 6-8 K. Cada variante idea (Opus, solo Read, ≤6 turnos) y construye aparte (Sonnet, solo edición, ≤25 turnos, sin capturas), en serie; presupuesto en tokens y % de ventana antes de `init`. Ronda real en cafeteria-90s: ~60 K tokens y ~1 min por variante (Weddi: ~3 M).
Contexto: Weddi (proyecto viejo al que se le importaron bold-rounds y council con importar_modulo.js). Dos ramas en paralelo, 20 rondas cada una en modo producto con involucramiento auto, y dos councils en modo entrevista con motor agentes (6 coaches × 8 novias/novios; 5 coaches × 5 actores de venta). Se agotó dos veces el límite de 5 horas.
Finding (registros locales, últimas 30 h): 96 sesiones `claude -p` de variantes = ~60 % del consumo; orquestadores y agentes = ~22 %. Cada variante abrió con **~55 mil tokens de contexto antes de leer nada del proyecto**, y el encargo real (prompt-blind.md, 4 KB ≈ 1.200 tokens) era **~2 %** de eso. Después corrió **60-76 turnos**, con el contexto creciendo hasta ~150-167 mil, y releyó todo en cada turno (~6,6 M tokens leídos por variante). Output de 80-165 mil por variante (esfuerzo high heredado). La mayoría de los turnos eran Bash, Grep y verificaciones, no ideación.
Acción sugerida:
1. Aislar las variantes: `claude -p` no debe heredar skills, plugins, CLAUDE.md global ni MCP del usuario (evaluar `--strict-mcp-config` con config vacía, `--setting-sources project` o equivalentes; verificar flags reales). Meta: contexto inicial < 15 mil.
2. Separar **idear** de **construir**: la idea audaz (Opus, pocos turnos, sin herramientas, ~5 mil tokens) se escribe primero; la implementación va después con tope de turnos (`--max-turns`) y sin auto-verificación por capturas (eso ya lo hace `after`).
3. Tope de turnos y de tiempo por variante, y un presupuesto de tokens estimado al hacer `init` ("esta corrida gastará ~X % de tu ventana de 5 h, ¿sigo?").
4. Correr las ramas en serie, no en paralelo, salvo que el usuario lo pida.
5. Mantener Opus en la ideación: Aldo no quiere bajar a Sonnet porque busca ideas fuera de la caja. Ahorrar en el contexto y en los turnos, no en la creatividad.

## 2026-11-06 — Council modo entrevista con motor agentes = ~50 sesiones completas
**Procesado 2026-11-06:** nuevo `node src/council.js entrevista`: una llamada sin herramientas por fase para todos los coaches y una corta por persona; coaches/integrador por `claude -p` aislado (Opus) u OpenRouter (USD), audiencia por OpenRouter barato o Haiku; presupuesto y `--yes` obligatorio. Real 2×2: 8 llamadas, 34 K tokens, 98 s, USD 0.
Contexto: mismo caso. Cada coach, cada persona de audiencia, cada repregunta y el integrador corrieron como sesión `claude -p` completa.
Finding: preguntas y respuestas de personas son texto corto; no necesitan una sesión de Claude Code con herramientas y ~55 mil tokens de base.
Acción sugerida: para entrevistas, usar llamadas directas al modelo sin herramientas (una sola llamada por fase con todas las personas, o OpenRouter barato para la audiencia y Opus solo para coaches e integrador). Mostrar costo estimado antes de correr.

## 2026-11-06 — [UPSTREAM-FIX pendiente] fallos de robustez en corridas desatendidas
**Procesado 2026-11-06:** timeout real por fase que mata el árbol (`taskkill /T /F`); `run N --fondo` + `espera N` (máx. 240 s por llamada); `after` marca `reintentar` ante "hit your limit" (no rechaza) y corre `node --check` de JS y `<script>` cambiados; aviso de enchufe/suspensión en `init` y `run`.
Contexto: corrida nocturna con el PC suspendido y luego límite de uso.
Finding: (a) los orquestadores esperaban con comandos largos y el watchdog de 600 s los mató; (b) quedaron procesos `claude -p` colgados 7 h sin timeout efectivo; (c) `after` trata el aviso de límite de uso como rechazo de calidad y no como fallo reintentable; (d) 4 variantes entregaron JS con errores de sintaxis.
Acción sugerida: timeout real por variante que mate el proceso; esperas de ≤4 min en la skill; `after` detecta "hit your limit" → estado `reintentar`; `node --check` automático de los JS cambiados; avisar al iniciar que el PC debe estar enchufado y sin suspensión.

## 2026-11-06 — La página de revisión final no se entiende
**Procesado 2026-11-06:** `node scripts/bold_rounds.js resumen` publica en el cockpit una ronda por lámina: titular, antes/después, "Qué gana el usuario", botón Probar (demo en sandbox), chip de veredicto, detalle en "Ver más" y glosario de 5 términos. Reusa el contrato del cockpit (campos `gain`, `chip`, `try` y visual `glossary`).
Contexto: Aldo abrió el index.html de la rama 2 (20 rondas).
Finding: "muy largo, mucho texto, no entiendo bien las definiciones" (ciega, contexto, señal, veredicto, categoría…). Aldo decide mirando, no leyendo.
Acción sugerida: una ronda por pantalla: titular grande, antes/después en imagen, una línea "qué gana la pareja", botón "Probar" y un chip de veredicto. El detalle va detrás de "Ver más" y hay un glosario de 5 términos en lenguaje simple. Hacerla parte del helper (`bold_rounds.js resumen`), no algo que cada orquestador invente.

## 2026-11-06 — Rutas siempre absolutas
**Procesado 2026-11-06:** los helpers imprimen rutas absolutas (prompts, capturas, copia de trabajo, resultados del council) y las skills bold-rounds/council lo exigen como regla.
Finding: los reportes daban rutas como `innovacion/resultados/<rama>/index.html`, que a un novato no le sirven.
Acción sugerida: en skills y reportes, siempre la ruta absoluta completa, lista para abrir.

## 2026-11-06 — Nota de entorno (no es del starter)
**Procesado 2026-11-06:** `/uso` (terminal y página) avisa qué MCP cargan en todos los proyectos (alcance usuario y `.mcp.json` en carpetas superiores), solo nombres, sin tocar la configuración. Medido: con TradingView en `C:\Users\aldot\.mcp.json` la sesión base era 52 K; tras vaciarlo, 35 K.
Finding: el MCP de TradingView está en `C:\Users\aldot\.mcp.json` (carpeta de usuario, más arriba que todos los proyectos), así que se carga en TODOS los proyectos, incluidas las variantes. Algo parecido pasa con las skills y agentes de Pax, SEO y trading en `~/.claude/`. El usuario lo está limpiando. No es el culpable principal (con tool search solo entran los nombres y su guía, unos pocos miles de tokens), pero suma en cada turno de cada sesión.
Acción sugerida: mover TradingView al `.mcp.json` del proyecto Trading-Final; el starter podría advertir en `/uso` qué MCP globales cargan en todas partes.
