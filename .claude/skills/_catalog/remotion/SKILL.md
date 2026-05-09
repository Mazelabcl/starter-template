---
name: remotion
description: Video programático con Remotion — videos generados desde React, con datos dinámicos, animaciones por código, y render server-side. Útil para videos de marketing personalizado, lyric videos, explainers data-driven, o cualquier video donde el contenido cambia con datos.
triggers: ["/remotion", "video programático", "remotion", "video desde react", "video con datos", "lyric video", "explainer animado"]
allowed-tools: Read, Write, Edit, Glob, Bash
---

# remotion — video programático con React

Genera videos desde código (React + Remotion). Útil cuando el video es data-driven (cambia con datos de cada usuario/producto/cliente) o cuando el equipo prefiere control programático sobre After Effects.

---

## Cuándo activar esta skill

Activa `remotion` solo si tu proyecto cumple uno o más:

1. **Video data-driven** — el mismo video plantilla se renderiza con datos distintos (videos personalizados por cliente, lyric videos por canción, explainers por producto).
2. **El equipo prefiere código** — React, animaciones por matemática, no After Effects.
3. **Necesitas render server-side** — generar videos automáticos como respuesta a un evento (lambda, API).
4. **Pipeline CI/CD que produce videos** — integraste video al deploy.

### Cuándo NO activarla

- Video único hand-crafted — After Effects o Premiere son mejores para eso.
- Video corto descartable (un Reel) — graba con teléfono y edita rápido, no programes.
- Video AI generativo (Sora, Veo, Seedance) — esos no usan Remotion, son modelos.
- Equipo sin React — la curva de aprendizaje no se justifica.

---

## Qué hace

1. Bootstrap proyecto Remotion (`npx create-video`) si no existe.
2. Genera componentes React como "scenes" del video, con `<Sequence>` para timing.
3. Define props del video como entrada de datos (cada render con props distintos = video distinto).
4. Aplica animaciones por código:
   - `interpolate()` para transiciones suaves.
   - `spring()` para movimiento natural.
   - `useCurrentFrame()` + `useVideoConfig()` para timing absoluto.
5. Renderiza:
   - Local: `npx remotion render <component> out.mp4`.
   - Server-side: `@remotion/lambda` para AWS Lambda; o `@remotion/cloudrun` para GCP.
6. Sugiere asset pipeline (audio, fonts, imágenes) que respete licencias.

---

## Anti-patrones

- **Hardcodear contenido en el componente.** Si el video es plantilla, el contenido viene por props; si va hardcodeado, el video no es reutilizable.
- **Animaciones lineales.** `interpolate` lineal se ve robotic. Usa `easing` o `spring`.
- **Audio sin sincronizar al frame.** Remotion trabaja en frames; el audio debe alinearse a frame específico, no a tiempo en segundos.
- **Render local para producción.** Servidor de render en máquina personal no escala. Para producción usa Lambda/Cloudrun.
- **Olvidar fonts.** Sin embedded fonts, el render del servidor usará fallback feo.

---

## Próximos pasos (esta skill es STUB)

- [ ] Templates de videos comunes (lyric video, explainer, video personalizado, social ad).
- [ ] Integración con `image-gen` (assets generados que entran al video).
- [ ] Pipeline server-side (Lambda) configurado.
- [ ] Asset library con fonts y música libres de licencia.
- [ ] Ejemplo end-to-end (datos JSON → video MP4 personalizado).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de templates y pipeline server-side.
