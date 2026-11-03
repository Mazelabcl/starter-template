# Cockpit de revisión

Página local donde revisas lo que hace Claude **mirando, no leyendo**. El inicio es una línea de tiempo de sprints con una miniatura por revisión. Cada revisión se abre como una presentación: una idea por pantalla (titular grande, imagen grande, números grandes), con flechas o deslizando el dedo, y un clic para votar. El detalle queda detrás de **Ver más**. El botón **Qué puedo pedir** explica lo que puedes pedirle a Claude. También puedes **conversar por voz** con una guía. Lo que votas se guarda solo y lo lee el orquestador en la siguiente sesión.

## Cómo abrirlo

No tienes que hacer nada: cuando Claude publica una revisión, él mismo corre

```
node src/cockpit.js open <id>
```
(esto levanta el servidor del cockpit en segundo plano si no estaba corriendo y abre tu navegador en esa revisión; no necesitas otra terminal)

- Si ya estaba abierto, solo abre la pestaña. Si llega una revisión nueva, aparece sola.
- Si el puerto 7788 está ocupado (por ejemplo, por la `review-app`), usa el siguiente libre (7789, 7790...) y te da la URL correcta.
- Para cerrarlo: `node src/cockpit.js stop` (o `npm run cockpit:stop`).
- El servidor guarda su PID en `cockpit/.server.pid` y su log en `cockpit/.server.log` (ambos ignorados por git). Si algo falla, el comando muestra las últimas líneas del log.

Modo manual (opcional, en primer plano): `npm run cockpit` y abre `http://localhost:7788`; se cierra con `Ctrl + C`. Para otro puerto en PowerShell:

```
$env:COCKPIT_PORT='7790'; npm run cockpit
```
(esto abre el cockpit en `http://localhost:7790`)

## Cómo se usa

1. Claude publica una revisión con `/revisar` (o `node src/cockpit.js publish <archivo.json>`).
2. Tú miras cada lámina y votas con un clic. Se guarda solo; la lámina final resume tus votos.
3. Opcional: **Conversar** → **Hablar por voz** (o **Usar texto** si no tienes micrófono). Al final presiona **Terminar y guardar**: se guarda la conversación y un resumen (decisiones, dudas abiertas, pedidos nuevos).
4. En la siguiente sesión, el aviso de inicio le dice a Claude que hay feedback pendiente. Claude lo lee con `node src/cockpit.js pending`, lo aplica y lo marca con `node src/cockpit.js done <id>`.

## Cómo funciona la voz

- Usa OpenAI Realtime por WebRTC (audio directo entre tu navegador y OpenAI, sin pasar por el server).
- Tu `OPENAI_API_KEY` **nunca** llega al navegador: el server pide a OpenAI una clave temporal (`ek_...`) que vence en 10 minutos y sirve solo para esa conversación.
- La guía recibe el contexto que escribió Claude (`context_brief`) y los ítems. No es Claude: no ejecuta nada, solo te pregunta y anota.
- Modelo por defecto: `gpt-realtime-2.1-mini`, voz `marin`, transcripción en español. Se cambian con `COCKPIT_VOICE_MODEL` y `COCKPIT_VOICE` en `.env`.
- La conversación se corta sola a los 20 minutos.
- El chat de texto usa OpenRouter (`OPENROUTER_API_KEY`), modelo `anthropic/claude-haiku-4.5` (cambiable con `COCKPIT_CHAT_MODEL`).

## Cuánto cuesta

Precios de `gpt-realtime-2.1-mini` verificados en la página de precios de OpenAI (oct-2026): audio de entrada USD 10 y de salida USD 20 por millón de tokens; entrada en caché USD 0,30. Transcripción `gpt-4o-mini-transcribe`: ~USD 0,003 por minuto.

Estimación **no verificada** (la conversión minutos → tokens de audio es aproximada): **~USD 0,02 a 0,05 por minuto** de conversación con el modelo mini, o sea ~USD 0,20 a 0,50 una revisión de 10 minutos. El modelo grande (`gpt-realtime-2.1`) cuesta unas 3 veces más. El chat de texto cuesta menos de un centavo por revisión.

## Para agentes: contrato de datos

- `cockpit/reviews/<id>.json` (lo escribe el agente u orquestador):
  `{ id, title, kind: plan|council|rounds|deliverable|other, created_at, sprint?, connects_to: [], context_brief, items: [item] }`
- `item`: `{ id, title, headline, visual, stats?, ask?, kicker?, body_md?, media?, tags? }`. `headline` (máximo 10 palabras), `visual` y hasta 3 `stats` `{ value, label }` se ven en la lámina; `body_md` solo detrás de **Ver más**. Las revisiones viejas (solo `title`, `body_md`, `media`) se siguen viendo.
- `cockpit/feedback/<id>.json` (lo escribe el cockpit):
  `{ review_id, saved_at, processed, items: { <item_id>: { vote: up|down|null, comment } }, conversation: [{ who: usuario|guia, text }], summary: { decisions, open_questions, requests } | null }`
- Helpers en `src/cockpit.js`: `publishReview`, `reviewWarnings`, `buildSprintDeck`, `listReviews`, `pendingFeedback`, `markProcessed`, `roadmapSnapshot`.
- Las imágenes de `media` y `visual` solo se sirven si están declaradas en una revisión, dentro del proyecto y sin carpetas ocultas (`.env`, `.git`). Los HTML se muestran en sandbox.
- Ejemplo listo para probar: `node src/cockpit.js publish cockpit/ejemplo-review.json`.

### Tipos de `visual`

Se dibujan en el cockpit, sin servicios externos (`cockpit/public/visuals.js` y `diagrams.js`).

```json
{ "type": "image", "path": "shots/home.png", "path_mobile": "shots/home-m.png", "hotspots": [{ "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.2, "label": "Botón nuevo" }] }
{ "type": "before_after", "before": "a.png", "after": "b.png", "hotspots": [], "views": [{ "label": "Celular", "device": "mobile", "before": "a-m.png", "after": "b-m.png" }] }
{ "type": "compare", "options": [{ "id": "a", "label": "Opción A", "image": "a.png", "image_mobile": "a-m.png", "item": "item-que-recibe-el-voto" }, { "id": "b", "label": "Opción B", "icon": "rocket" }] }
{ "type": "diagram", "kind": "flow", "steps": [{ "label": "Copia", "icon": "copy" }, { "parallel": [{ "label": "Ciega" }, { "label": "Con contexto" }] }, { "label": "Tú eliges", "tone": "you" }] }
{ "type": "diagram", "kind": "org", "lead": { "label": "Orquestador" }, "members": [{ "label": "Desarrollador", "note": "Landing", "icon": "code", "badge": "Nuevo" }] }
{ "type": "diagram", "kind": "timeline", "items": [{ "label": "Kickoff", "state": "past" }, { "label": "Sprint 1", "state": "current" }, { "label": "Sprint 2", "state": "next" }] }
{ "type": "diagram", "kind": "connects", "center": "Tu proyecto", "links": [{ "label": "Supabase", "state": "missing" }, { "label": "Canva", "state": "ok" }] }
```

- Coordenadas de `hotspots`: de 0 a 1 respecto de la imagen.
- `compare`: si una opción trae `item`, elegirla vota ese ítem (`up`) y limpia los de las otras opciones. Si no, vota el propio ítem y anota `Elegida: <label>` en el comentario. El feedback sigue siendo `items{<id>:{vote,comment}}`.
- Íconos disponibles: `ICONS` en `cockpit/public/diagrams.js`.

### Avisos al publicar

`publishReview` avisa por consola si un ítem no trae `visual` o `headline`, o si el titular pasa de 10 palabras. Con `node src/cockpit.js publish <archivo> --estricto` esos ítems se rechazan.

### Cierre de sprint

`node src/cockpit.js sprint-deck <borrador.json> [--estricto]` arma la presentación para directorio: resumen con 3 números, lo entregado en capturas, lo que sigue y la decisión pendiente. Formato: `cockpit/ejemplo-sprint-deck.json`.

### Qué puedo pedir

El contenido vive en `cockpit/public/capacidades.json`. Para sumar una capacidad, agrega una tarjeta: `id`, `title`, `tag`, `diagram`, `phrase` (o `modes[]`) y `more`.

### Prueba con navegador

`npm run cockpit:check` recorre láminas, slider, teclado, swipe, votos y "Ver más" en escritorio y celular, con datos temporales. Necesita una vez `npm install --no-save playwright-core`.
