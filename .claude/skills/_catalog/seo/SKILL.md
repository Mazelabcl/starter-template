---
name: seo
description: SEO técnico y de contenido para proyectos web — keyword research, meta tags, headings, schema markup, internal linking, audit de contenido orgánico. Versión proyecto-local. Para SEO estratégico complejo (planes de contenido multi-mes), usa las skills globales `seo-strategist` y `seo-content-creator`.
triggers: ["/seo", "keyword research", "optimizar página seo", "meta título", "meta descripción", "schema markup", "audit seo", "contenido orgánico"]
allowed-tools: Read, Write, Edit, Glob, Bash
---

# seo — SEO técnico + contenido

Skill proyecto-local de SEO. Cubre lo táctico (optimización de página, meta tags, keywords concretas) sin pretender reemplazar las skills globales `seo-strategist` (estrategia agresiva) ni `seo-content-creator` (creación de artículos largos).

---

## Cuándo activar esta skill

Activa `seo` solo si tu proyecto cumple uno o más:

1. **Proyecto build con landing/web** que necesita posicionamiento orgánico.
2. **Proyecto business con contenido** (blog, recursos) como canal de captación.
3. **Proyecto content recurrente** (blog corporativo, recursos educacionales) que se publican en sitio propio.
4. **Audit de un sitio existente** — revisar meta, headings, schema, performance.

### Cuándo NO activarla

- Proyectos sin sitio público (interno, B2B con flujo cerrado, herramientas privadas).
- Cuando el canal es exclusivamente paid (ads), no orgánico.
- Cuando el alcance es solo redes (IG/TikTok/LinkedIn) — esas plataformas no usan SEO clásico.
- Si necesitas estrategia agresiva multi-mes con plan de contenidos completo, usa `seo-strategist` (skill global).
- Si necesitas redactar artículos SEO largos optimizados, usa `seo-content-creator` (skill global).

---

## Qué hace

1. Aplica niveles según necesidad:
   - **Keyword research básico**: identifica 3-5 keywords objetivo por página.
   - **On-page**: meta title, meta description, H1/H2/H3 jerárquicos, internal linking.
   - **Schema markup**: JSON-LD para tipos relevantes (Article, Product, LocalBusiness, FAQ).
   - **Audit técnico ligero**: indexabilidad, robots.txt, sitemap, canonical, mobile-friendly, Core Web Vitals.
2. Genera meta tags listos para integrar (`<title>`, `<meta name="description">`, OG tags, Twitter cards).
3. Optimiza contenido existente sin reescribirlo — sugerencias quirúrgicas, no re-escritura completa.
4. Coordina:
   - Con `seo-strategist` (skill global del usuario) para estrategia macro.
   - Con `seo-content-creator` (skill global) para artículos largos.
   - Con `marketing` y `brand-guidelines` para mantener voz consistente.

---

## Anti-patrones

- **Keyword stuffing.** Repetir la keyword 20 veces baja ranking, no lo sube.
- **Meta description duplicada.** Cada página merece su propia description, alineada al intent.
- **H1 múltiples.** Un H1 por página. Múltiples H1s confunden a los crawlers.
- **Ignorar intent del usuario.** Optimizar para keyword sin entender qué busca el usuario detrás = tráfico que no convierte.
- **Schema sin validar.** Genera JSON-LD pero corre el [Rich Results Test](https://search.google.com/test/rich-results) antes de publicar.

---

## Próximos pasos (esta skill es STUB)

- [ ] Decision tree: tipo de página → keywords + meta + schema.
- [ ] Templates de meta tags por tipo (artículo, landing producto, página servicio).
- [ ] Integración con `src/research.js` (Perplexity) para keyword research automatizado.
- [ ] Auditor: dado un HTML, reportar gaps de SEO técnico.
- [ ] Decisión clara: cuándo delegar a las skills globales (`seo-strategist`, `seo-content-creator`) vs hacerlo proyecto-local.

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de templates y auditor.
