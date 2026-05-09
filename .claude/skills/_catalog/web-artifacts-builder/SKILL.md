---
name: web-artifacts-builder
description: Construye artifacts web interactivos autocontenidos — HTML+JS+CSS en un solo archivo, sin build step, sin dependencias externas pesadas. Útil para demos, prototipos compartibles, herramientas one-off, calculadoras, visualizaciones embebibles.
triggers: ["/web-artifacts-builder", "artifact web", "demo en html", "calculadora interactiva", "prototipo en una página", "herramienta one-off"]
allowed-tools: Read, Write, Edit, Glob
---

# web-artifacts-builder — artifacts web autocontenidos

Genera HTML+JS+CSS en un solo archivo. Pensado para demos, prototipos rápidos, herramientas one-off — todo lo que NO necesita build step ni dependencias pesadas.

---

## Cuándo activar esta skill

Activa `web-artifacts-builder` solo si tu proyecto cumple uno o más:

1. **Demo o prototipo** que el usuario quiere compartir como un solo archivo (sin npm install).
2. **Herramienta one-off** — calculadora, conversor, visualización rápida — que vive en un HTML.
3. **Artifact embebible** — algo que un blog post o documentación puede iframe-ar directamente.
4. **Test de concepto rápido** antes de invertir en proyecto build completo.

### Cuándo NO activarla

- Proyectos con build step real (React/Vue/Svelte con Vite/Webpack) — usa `frontend-design`.
- Apps con backend, auth, persistencia compleja — eso es build serio, no artifact.
- Cuando el output esperado es un design (Figma/Pencil), no código ejecutable.
- Proyectos de larga duración. Artifacts son descartables; lo serio va en proyecto build.

---

## Qué hace

1. Pregunta:
   - ¿Qué hace el artifact? (calculadora, visualización, formulario, juego, demo de API).
   - ¿Es interactivo o visual estático?
   - ¿Necesita persistir estado? (localStorage, query params, no persiste).
   - ¿Hay branding o es vanilla?
2. Genera un HTML autocontenido:
   - `<style>` inline con CSS moderno (custom properties, grid, flexbox).
   - `<script>` inline con JS vanilla o tipo módulo (`<script type="module">`).
   - Sin dependencias npm. Si necesitas libs, usa CDN (esm.sh, jsdelivr) con import maps.
   - Mobile-friendly por default.
3. Incluye:
   - Meta viewport correcto.
   - Theme dark/light si aplica.
   - Accesibilidad básica (labels, focus visible, contraste OK).
   - Print stylesheet si el artifact debe imprimirse.
4. Sugiere cómo compartir: archivo único, GitHub Gist, hosted en Vercel/Cloudflare Pages.
5. Coordina con `brand-guidelines` si está activa para tokens consistentes.

---

## Anti-patrones

- **Cargar React/Vue solo para 50 líneas de código.** Vanilla JS es más rápido y portable.
- **Inline 500KB de imagen base64.** Pesa el archivo y degrada experiencia. Usa URL externa o asset separado.
- **Olvidar mobile.** El usuario va a abrirlo en su teléfono. Si no funciona en pantallas pequeñas, no funciona.
- **Hardcodear paths absolutos** (`file:///C:/...`). El artifact se rompe en cualquier otra máquina.
- **Sin meta viewport.** Mobile zoom-out por default = inutil.

---

## Próximos pasos (esta skill es STUB)

- [ ] Templates de artifacts comunes (calculadora, visualización data, formulario, juego simple, demo API).
- [ ] CSS reset moderno + tokens base aplicables a cualquier artifact.
- [ ] Patrones de import maps para libs externas (D3, htmx, alpine).
- [ ] Decisión clara: cuándo "graduar" un artifact a proyecto build (frontend-design).
- [ ] Ejemplo end-to-end (calculadora financiera en un HTML).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de templates y patrones de import maps.
