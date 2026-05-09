---
name: playwright
description: Testing UI con Playwright. Genera y mantiene tests E2E para webapps (navegación, forms, auth, flujos críticos). Aplica selectores resilientes (data-testid > role > text), espera por estado en lugar de timeouts fijos, y deja screenshots/traces para debug.
triggers: ["/playwright", "test e2e", "test ui", "playwright test", "automatizar test web", "regresión visual"]
allowed-tools: Read, Write, Edit, Glob, Bash
---

# playwright — testing UI E2E

Skill especializada en escribir y mantener tests Playwright para webapps. Más enfocada que `webapp-testing` (que es general); úsala cuando ya elegiste Playwright como stack.

---

## Cuándo activar esta skill

Activa `playwright` solo si tu proyecto cumple uno o más:

1. **Webapp con UI compleja** — flujos multi-página, auth, formularios largos, state cliente.
2. **Necesitas tests E2E confiables** — los unitarios y de integración no alcanzan, hay que probar el navegador.
3. **Stack ya tiene o adoptará Playwright** — no instalas Cypress ni Selenium en paralelo.
4. **Quieres regresión visual** — screenshots automáticos comparados entre runs.

### Cuándo NO activarla

- Proyectos sin UI o que no son webapps (CLIs, APIs puras, bots de chat).
- Proyectos donde testing unitario es suficiente (lógica pura, sin browser).
- Si vas a usar Cypress/Selenium en lugar de Playwright — activa la skill correspondiente o usa `webapp-testing` genérica.
- Prototipos descartables (E2E es overkill).

---

## Qué hace

1. Genera tests Playwright con estructura estándar (`test.describe`, `test.beforeEach`, `expect(page).toHave...`).
2. Aplica jerarquía de selectores resilientes:
   - 1ª opción: `data-testid` (estable, no rompe con cambios visuales).
   - 2ª: `role` + accessible name (semántico).
   - 3ª: `text` (frágil con i18n, último recurso).
4. Reemplaza timeouts fijos (`waitForTimeout(2000)`) por waits semánticos (`waitFor`, `expect.toBeVisible`).
5. Configura traces, screenshots y videos solo en fallos (no en cada run).
6. Sugiere fixtures para auth, datos comunes y limpieza entre tests.
7. Integra con CI (GitHub Actions) si el proyecto tiene flujo PR formal.

---

## Anti-patrones

- **Usar selectores frágiles.** `.css-xyz123` o XPath largo se rompe al primer refactor.
- **`waitForTimeout` arbitrario.** Espera por estado real (elemento visible, request completado), no por ms fijos.
- **Tests sin cleanup.** Datos de un test sucio contaminan al siguiente. Cada test arranca limpio.
- **Tests E2E para todo.** E2E son lentos y frágiles; reserva para flujos críticos. Lógica unitaria va con `webapp-testing` o tests unitarios convencionales.

---

## Próximos pasos (esta skill es STUB)

- [ ] Templates de tests por tipo de flujo (login, checkout, CRUD básico).
- [ ] Configuración estándar de `playwright.config.ts` (browsers, retries, traces).
- [ ] Integración con CI (GitHub Actions workflow).
- [ ] Patrones para tests con auth state cacheado (storageState).
- [ ] Ejemplo end-to-end real (test de login + dashboard navigation).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de templates y ejemplos reales.
