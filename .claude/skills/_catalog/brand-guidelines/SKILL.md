---
name: brand-guidelines
description: Mantiene la identidad visual coherente entre piezas — tokens de color, tipografía, espaciado, voice & tone. Aplica antes de generar imagen/copy/diseño para asegurar consistencia. Persiste guía en `content/brand.md` y la lee cada vez que otra skill produce output con identidad.
triggers: ["/brand-guidelines", "guía de marca", "identidad visual", "paleta", "tipografía", "tone of voice", "tokens de color"]
allowed-tools: Read, Write, Edit, Glob
---

# brand-guidelines — guía de marca persistente

Mantiene la identidad del proyecto en un archivo único (`content/brand.md`) que otras skills (`image-gen`, `frontend-design`, `canvas-design`, `marketing`) consultan antes de producir output.

---

## Cuándo activar esta skill

Activa `brand-guidelines` solo si tu proyecto cumple uno o más:

1. **Proyecto creativo recurrente** — vas a producir 5+ piezas y necesitas que se vean del mismo universo.
2. **Empresa con identidad visual** (logo, paleta, tipografía existentes) que hay que respetar.
3. **Proyecto build con UI** que va a tener design system.
4. **Marketing recurrente** — campañas, posts, emails que deben sentir continuidad.

### Cuándo NO activarla

- Pieza única descartable (un meme, un copy de un día).
- Cliente que aún no tiene marca y solo está experimentando — la guía aparece al cerrar dirección, no antes.
- Proyectos research/personal sin componente público.

---

## Qué hace

1. Pregunta al usuario los componentes de marca:
   - Color palette (primarios, secundarios, accents, neutrals).
   - Tipografía (display, body, mono).
   - Voz y tono (formal/informal, técnico/casual, cálido/frío).
   - Logo (link al SVG/PNG).
   - No-negociables visuales (cosas que NUNCA hacer — colores prohibidos, estilos vetados).
2. Persiste todo en `content/brand.md` con estructura estándar.
3. Cuando otra skill (image-gen, frontend-design, marketing) va a producir output, lee `brand.md` primero y aplica los tokens.
4. Si el usuario itera la marca, actualiza `brand.md` con versión + fecha. La guía evoluciona.
5. Audita output post-generación: ¿usa los tokens correctos? Si no, marca como inconsistente y propone fix.

---

## Anti-patrones

- **Crear guía sin proyecto.** Si el cliente no tiene 3 piezas hechas, la guía es ficción. Mejor producir 3 piezas, ahí emerge la guía.
- **Guía rígida que no admite excepciones.** El brand evoluciona; bloquear iteración mata la skill.
- **Mezclar guía con tokens de implementación.** La guía es semántica (`color-primary`, `tone-formal`); los tokens técnicos viven en CSS variables o el design system.
- **Ignorar voice & tone.** Brand no es solo visual; cómo escribes también es marca.

---

## Próximos pasos (esta skill es STUB)

- [ ] Plantilla literal de `content/brand.md` con secciones requeridas.
- [ ] Auditor automático: dado un output (texto, imagen, código UI), reportar si respeta la guía.
- [ ] Integración con `image-gen` (extender el IDENTITY LOCK con tokens del brand).
- [ ] Integración con `frontend-design` (tokens CSS generados desde la guía).
- [ ] Ejemplo end-to-end (definir guía Mazelab + producir 3 piezas que la respeten).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de plantilla y auditor.
