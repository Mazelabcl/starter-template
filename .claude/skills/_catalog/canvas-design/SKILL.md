---
name: canvas-design
description: Diseño en canvas HTML5/SVG generativo — composiciones programáticas, infografías, dashboards visuales custom, generative art. Útil cuando el output es visual pero NO es una imagen rasterizada generada por modelo (`image-gen`), sino código que dibuja en runtime.
triggers: ["/canvas-design", "diseño canvas", "svg generativo", "infografía programática", "dashboard visual custom", "p5js", "d3"]
allowed-tools: Read, Write, Edit, Glob
---

# canvas-design — diseño programático en canvas/SVG

Útil cuando el deliverable visual es código que dibuja (canvas/SVG/D3/p5.js), no una imagen generada por modelo. Aplica a infografías programáticas, dashboards con visualizaciones custom, y arte generativo.

---

## Cuándo activar esta skill

Activa `canvas-design` solo si tu proyecto cumple uno o más:

1. **Visualización de datos custom** — D3, Observable Plot, Chart.js custom.
2. **Generative art** — p5.js, three.js, código que produce visuales únicos en runtime.
3. **Infografías programáticas** — el contenido cambia con datos, no es una imagen estática.
4. **Dashboards con UI no-estándar** — mapas custom, gráficos no cubiertos por libs estándar.

### Cuándo NO activarla

- Cuando el output es una imagen rasterizada que un modelo puede generar — usa `image-gen` con `gpt-image-2`.
- Cuando alcanza una librería de gráficos lista (Chart.js default, Recharts) — no necesitas skill, solo la lib.
- Cuando el diseño es UI estática — usa `frontend-design`.

---

## Qué hace

1. Recomienda librería según caso:
   - **Visualización de datos**: D3.js, Observable Plot, Visx.
   - **Generative art / interactivo**: p5.js, three.js (3D), regl.
   - **Composición simple**: Canvas API nativa, SVG raw.
2. Genera el código del canvas/SVG con criterios:
   - Responsive (no asume viewport fijo).
   - Performance (offscreen canvas, requestAnimationFrame, no leaks).
   - Accesibilidad (ARIA labels, fallback textual para SVG).
3. Maneja exportación:
   - Canvas → PNG (toDataURL/toBlob).
   - SVG → archivo o inline en HTML.
   - Captura de animación a video (MediaRecorder API).
4. Coordina con `brand-guidelines` para tokens de color/tipografía consistentes.

---

## Anti-patrones

- **Usar canvas para UI estándar.** Botones, formularios, listas — eso es HTML normal. Canvas es para lo que HTML no puede.
- **No considerar accesibilidad.** Canvas/SVG sin texto alternativo es invisible para screen readers.
- **Animaciones sin respetar `prefers-reduced-motion`.** Usuarios con vértigo necesitan opt-out.
- **Leaks de animación.** No cancelar `requestAnimationFrame` al desmontar componente = consumo CPU eterno.
- **Mezclar lógica de datos con renderizado.** Separa el modelo (datos) del view (canvas/SVG).

---

## Próximos pasos (esta skill es STUB)

- [ ] Decision tree: tipo de visualización → librería.
- [ ] Templates de visualizaciones comunes (bar chart custom, network graph, mapa SVG).
- [ ] Patrones de exportación a PNG/SVG/video.
- [ ] Integración con `brand-guidelines` para tokens.
- [ ] Ejemplo end-to-end (datos JSON → D3 viz interactiva).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de decision tree y templates.
