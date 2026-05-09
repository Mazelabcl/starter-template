---
name: frontend-design
description: Skill oficial de Anthropic para diseño frontend. Genera componentes UI accesibles, semánticos y con buena jerarquía visual a partir de specs textuales. Aplica patrones modernos (Tailwind, design tokens, componentes accesibles WAI-ARIA) y deja decisiones de framework abiertas (React/Vue/Svelte/HTML plano).
triggers: ["/frontend-design", "diseña componente", "diseña pantalla web", "diseña UI", "componente accesible", "landing page"]
allowed-tools: Read, Write, Edit, Glob
---

# frontend-design — diseño frontend con disciplina

Versión adaptada al starter de la skill oficial de Anthropic. Genera UI con criterios duros de accesibilidad, jerarquía visual y reusabilidad.

---

## Cuándo activar esta skill

Activa `frontend-design` solo si tu proyecto cumple uno o más:

1. **Proyecto build con superficie UI** — landing, app web, dashboard, panel admin.
2. **Necesitas componentes reutilizables** — design system básico o tokens.
3. **El usuario final no es técnico** — accesibilidad y claridad visual son críticas.
4. **Trabajas con stack frontend moderno** — Tailwind, React/Vue/Svelte, headless UI libraries.

### Cuándo NO activarla

- Proyectos sin UI (CLI, API, scripts, bots).
- Proyectos creativos donde la imagen es el deliverable (esos van con `image-gen`).
- Cuando el diseño visual ya está cerrado en Figma/Pencil y solo falta implementar (eso es código directo, no diseño).

---

## Qué hace

1. Toma una spec textual ("landing para SaaS B2B, hero + features + CTA + testimonios + footer") y produce el diseño:
   - Estructura semántica (HTML accesible).
   - Jerarquía visual clara (typography scale, spacing, contrast).
   - Componentes reutilizables (cards, buttons, forms con estados).
   - Tokens de color/espaciado/tipografía.
2. Aplica patrones de accesibilidad WAI-ARIA por defecto.
3. Sugiere stack mínimo si no está definido (Tailwind + framework de tu elección).
4. Genera código frontend listo para integrar.
5. Coordina con `brand-guidelines` si la skill está activa para mantener identidad visual consistente.

---

## Anti-patrones

- **Generar componentes sin tokens.** Hardcodear colores/espaciados rompe consistencia. Siempre tokens.
- **Saltarse accesibilidad.** Botón sin `aria-label`, contraste bajo, focus invisible son fail por default.
- **Mezclar lógica de negocio con presentación.** Componentes de UI deben ser tontos; lógica vive aparte.
- **Usar la skill para wireframes.** Wireframes son trabajo de Pencil/Figma, no de código.

---

## Próximos pasos (esta skill es STUB)

- [ ] Importar la skill oficial de Anthropic completa con todas sus best practices.
- [ ] Templates por tipo de página (landing, dashboard, settings, login).
- [ ] Integración con `brand-guidelines` para tokens compartidos.
- [ ] Ejemplo end-to-end (spec → diseño → código React).
- [ ] Definir stack default (sugerencia: Tailwind + React + shadcn/ui).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de importar best practices oficiales de Anthropic.
