---
name: marketing
description: Skills genéricas de marketing — copy publicitario, posts para redes, anuncios, email marketing, lanzamiento de productos. Aplica frameworks probados (AIDA, PAS, problem-agitate-solve) y voice de la marca. Coordina con `seo` y `brand-guidelines` cuando están activas.
triggers: ["/marketing", "copy publicitario", "post redes", "email marketing", "anuncio", "lanzamiento", "campaña"]
allowed-tools: Read, Write, Edit, Glob
---

# marketing — copy y campañas

Skill genérica para output de marketing: posts, anuncios, emails, copy publicitario. Aplica frameworks clásicos sin reinventarlos cada vez.

---

## Cuándo activar esta skill

Activa `marketing` solo si tu proyecto cumple uno o más:

1. **Proyecto business o content** — el deliverable incluye copy comercial.
2. **Lanzamiento de producto** — necesitas mensajes alineados (hero, ads, posts, email).
3. **Campaña multi-canal** — la misma idea adaptada a Instagram, LinkedIn, email, blog.
4. **Marca que necesita voz consistente** en su comunicación pública.

### Cuándo NO activarla

- Producto técnico interno sin lado comercial (skill irrelevante).
- Investigación o documentación neutral (no es marketing, es research/docs).
- Cuando el copy ya está escrito y solo necesitas optimizarlo para SEO — usa `seo`.

---

## Qué hace

1. Pregunta:
   - ¿Para qué canal? (Instagram post, LinkedIn artículo, anuncio Google, email cold, email nurture).
   - ¿Stage del funnel? (awareness, consideration, decision, retention).
   - ¿Audiencia y dolor concreto?
   - ¿Llamada a la acción específica?
2. Aplica framework según caso:
   - **AIDA** (Attention, Interest, Desire, Action) — anuncios y landing.
   - **PAS** (Problem, Agitate, Solve) — emails cold y posts orgánicos.
   - **Before/After/Bridge** — testimonios y case studies.
   - **4 Cs** (Clear, Concise, Compelling, Credible) — copy general.
3. Genera output en formato del canal (caption con emoji opcional para IG, párrafos sin emoji para LinkedIn formal, subject line + body para email).
4. Lee `content/brand.md` si `brand-guidelines` está activa para aplicar voice & tone.
5. Coordina con `seo` si el output es contenido orgánico (blog, landing).
6. Coordina con `image-gen` si el copy va con visual.

---

## Anti-patrones

- **Copy genérico tipo "innovate, transform, leverage".** Vacío, intercambiable, no conecta.
- **Aplicar AIDA donde no corresponde.** Email a un cliente de 5 años no necesita awareness; necesita deepening.
- **Ignorar el canal.** Caption de IG con párrafos formales, post de LinkedIn con emoji puberto — fail.
- **CTA débil o ausente.** Si la pieza no sabe qué quiere que el lector haga, la pieza falló.
- **Hardcodear tono cuando hay `brand.md`.** Siempre lee la guía primero.

---

## Próximos pasos (esta skill es STUB)

- [ ] Templates por canal (IG caption, LinkedIn post, email cold, email nurture, anuncio Google, anuncio Meta).
- [ ] Decision tree: stage del funnel + canal → framework recomendado.
- [ ] Integración formal con `brand-guidelines` (lee `brand.md` antes de cada output).
- [ ] Integración con `seo` para contenido orgánico.
- [ ] Auditor: dado un copy, reportar si aplica el framework correctamente y si conecta con el dolor real.

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de templates por canal y decision tree.
