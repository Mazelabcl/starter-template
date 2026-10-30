# Cockpit de revisión

Página local donde revisas lo que hace Claude: arriba el roadmap (hecho / ahora / sigue), luego el foco ("Ahora revisas X, que conecta con Y"), y cada ítem con 👍 / 👎 + comentario. Puedes **conversar por voz** con una guía que te recorre los ítems y te pregunta tu opinión. Todo lo que guardas lo lee el orquestador en la siguiente sesión.

## Cómo abrirlo

1. `npm run cockpit`
   (esto levanta el servidor del cockpit en tu computador; déjalo corriendo en esa terminal)
2. Abre `http://localhost:7788` en el navegador.
   (si llega una revisión nueva, aparece sola; no hace falta recargar)
3. Para cerrarlo: `Ctrl + C` en la terminal del paso 1.

Si dice que el puerto está ocupado, probablemente tienes la `review-app` abierta. Ciérrala, o usa otro puerto en PowerShell:

```
$env:COCKPIT_PORT='7790'; npm run cockpit
```
(esto abre el cockpit en `http://localhost:7790`)

## Cómo se usa

1. Claude publica una revisión con `/revisar` (o `node src/cockpit.js publish <archivo.json>`).
2. Tú votas, comentas y presionas **Guardar feedback**.
3. Opcional: **Conversar sobre esta revisión** → **Hablar por voz** (o **Usar texto** si no tienes micrófono). Al final presiona **Terminar y guardar**: se guarda la conversación y un resumen (decisiones, dudas abiertas, pedidos nuevos).
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
  `{ id, title, kind: plan|council|rounds|deliverable|other, created_at, connects_to: [], context_brief, items: [{ id, title, body_md, media: [rutas relativas a la raíz], tags: [] }] }`
- `cockpit/feedback/<id>.json` (lo escribe el cockpit):
  `{ review_id, saved_at, processed, items: { <item_id>: { vote: up|down|null, comment } }, conversation: [{ who: usuario|guia, text }], summary: { decisions, open_questions, requests } | null }`
- Helpers en `src/cockpit.js`: `publishReview`, `listReviews`, `pendingFeedback`, `markProcessed`, `roadmapSnapshot`.
- `media` solo se sirve si está declarada en una revisión, dentro del proyecto y sin carpetas ocultas (`.env`, `.git`). Los HTML se muestran en sandbox.
- Ejemplo listo para probar: `node src/cockpit.js publish cockpit/ejemplo-review.json`.
