---
description: Arma una revisión del trabajo actual y la publica en el cockpit (roadmap + votos + conversación por voz)
allowed-tools: Bash, Read, Write
---

Aldot lanzó `/revisar`. Convierte el trabajo reciente en una revisión del cockpit, en vez de mostrarlo como texto en la consola.

Foco opcional del usuario: "$ARGUMENTS"

Pasos:

1. Antes de nada, corre `node src/cockpit.js pending`. Si hay feedback pendiente, aplícalo primero (o pregúntale a Aldot) y márcalo con `node src/cockpit.js done <id>`.
2. Decide qué se revisa: lo último que hiciste o lo que pide `$ARGUMENTS`. Entre 2 y 8 láminas; cada ítem es UNA idea que Aldot puede aprobar o rechazar (una decisión, un entregable, una opción, una imagen).

   **Visual primero.** Prueba: Aldot debe entender qué pasó y qué se le pide en 30 segundos sin leer un párrafo. Cada lámina = titular grande + imagen grande + hasta 3 números. Máximo unas 12 palabras a la vista además de las etiquetas. Si una captura o un diagrama no comunica la idea, genera una imagen con la skill `astra` (`node src/astra.js`) o `image-gen` y mírala antes de publicarla.
3. Escribe el JSON en `cockpit/reviews/_borrador.json` con este contrato (no cambies nombres de campos):

```json
{
  "id": "slug-corto-sin-espacios",
  "title": "Qué se revisa, en lenguaje simple",
  "kind": "plan | council | rounds | deliverable | other",
  "connects_to": ["sprint o tarea del roadmap con que conecta"],
  "context_brief": "3-8 frases para la guía de voz: qué se hizo, por qué, qué decisión necesitas de Aldot y qué NO está en juego.",
  "items": [
    {
      "id": "item-1",
      "title": "Título corto",
      "headline": "Titular de máximo 10 palabras",
      "ask": "¿Lo apruebas?",
      "visual": { "type": "image", "path": "content/output/imagen.png" },
      "stats": [{ "value": "3", "label": "pantallas nuevas" }],
      "body_md": "Detalle opcional: solo se abre con Ver más."
    }
  ]
}
```

   Tipos de `visual` (rutas relativas a la raíz, sin `..` ni carpetas ocultas; ejemplos en `cockpit/README.md`):
   - `image`: captura o imagen. Puede llevar `hotspots`.
   - `before_after`: `before` + `after` con slider. Lo mejor para mostrar un cambio.
   - `compare`: 2 o 3 `options` con `image`, para elegir con un clic.
   - `diagram` con `kind`: `flow` (pasos), `org` (equipo), `timeline` (pasado/ahora/sigue) o `connects` (con qué se conecta).

   Español neutro, sin jerga: Aldot es novato. `context_brief` lo usa la guía de voz: incluye lo que necesita para explicar y preguntar, no repitas los ítems.
4. Publica y borra el borrador:

```bash
node src/cockpit.js publish cockpit/reviews/_borrador.json --estricto
```
(esto valida el JSON y lo guarda como `cockpit/reviews/<id>.json`; si hay errores, los lista todos; `--estricto` rechaza ítems sin visual o con titular largo: corrígelos y repite)

Luego borra `cockpit/reviews/_borrador.json`.

   **Cierre de sprint:** en vez de lo anterior, escribe un borrador como `cockpit/ejemplo-sprint-deck.json` (lo entregado en capturas, 3 números, lo que sigue y la decisión que se necesita) y publícalo:

```bash
node src/cockpit.js sprint-deck <borrador.json> --estricto
```
(esto arma una presentación para directorio y la publica como revisión)

5. Abre el cockpit tú mismo (Aldot NO abre otra terminal):

```bash
node src/cockpit.js open <id>
```
(esto levanta el servidor del cockpit en segundo plano si no estaba corriendo y abre el navegador en la revisión; si ya estaba abierto, solo abre la pestaña)

6. Responde a Aldot en máximo 3 líneas:
   - Qué publicaste (título y número de ítems).
   - "Te abrí el cockpit en el navegador." (si el comando dijo que no pudo abrir el navegador, pásale la URL que imprimió)
   - "Mira las láminas y vota con un clic: se guarda solo. Lo leo al continuar."
7. Cuando Aldot vuelva, lee `node src/cockpit.js pending`, aplica el feedback (decisiones, pedidos, votos negativos con su comentario) y márcalo con `node src/cockpit.js done <id>`.
