---
description: Arma una revisión del trabajo actual y la publica en el cockpit (roadmap + votos + conversación por voz)
allowed-tools: Bash, Read, Write
---

Aldot lanzó `/revisar`. Convierte el trabajo reciente en una revisión del cockpit, en vez de mostrarlo como texto en la consola.

Foco opcional del usuario: "$ARGUMENTS"

Pasos:

1. Antes de nada, corre `node src/cockpit.js pending`. Si hay feedback pendiente, aplícalo primero (o pregúntale a Aldot) y márcalo con `node src/cockpit.js done <id>`.
2. Decide qué se revisa: lo último que hiciste o lo que pide `$ARGUMENTS`. Entre 2 y 8 ítems; cada ítem es UNA cosa que Aldot puede aprobar o rechazar (una decisión, un entregable, una opción, una imagen).
3. Escribe el JSON en `cockpit/reviews/_borrador.json` con este contrato (no cambies nombres de campos):

```json
{
  "id": "slug-corto-sin-espacios",
  "title": "Qué se revisa, en lenguaje simple",
  "kind": "plan | council | rounds | deliverable | other",
  "connects_to": ["sprint o tarea del roadmap con que conecta", "otra pieza"],
  "context_brief": "3-8 frases para la guía de voz: qué se hizo, por qué, qué decisión necesitas de Aldot y qué NO está en juego.",
  "items": [
    { "id": "item-1", "title": "Título corto", "body_md": "Explicación breve en markdown simple.", "media": ["content/output/imagen.png"], "tags": ["etiqueta"] }
  ]
}
```

   - `media`: rutas relativas a la raíz del proyecto (imágenes, video, html). Sin `..` ni carpetas ocultas.
   - Español neutro, sin jerga: Aldot es novato.
   - `context_brief` lo usa la guía de voz: incluye lo que necesita para explicar y preguntar, no repitas los ítems.
4. Publica y borra el borrador:

```bash
node src/cockpit.js publish cockpit/reviews/_borrador.json
```
(esto valida el JSON y lo guarda como `cockpit/reviews/<id>.json`; si hay errores, los lista todos: corrígelos y repite)

Luego borra `cockpit/reviews/_borrador.json`.

5. Responde a Aldot en máximo 3 líneas:
   - Qué publicaste (título y número de ítems).
   - Cómo verlo:
     1. `npm run cockpit` (esto abre el servidor del cockpit; déjalo corriendo en otra terminal)
     2. Abre `http://localhost:7788/#/r/<id>` (si ya estaba abierto, aparece solo)
   - "Vota, comenta o conversa por voz y presiona Guardar feedback. Lo leo al continuar."
6. Cuando Aldot vuelva, lee `node src/cockpit.js pending`, aplica el feedback (decisiones, pedidos, votos negativos con su comentario) y márcalo con `node src/cockpit.js done <id>`.
