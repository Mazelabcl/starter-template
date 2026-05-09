---
name: webapp-testing
description: Testing general de webapps a través de la pirámide completa — unit (lógica pura), integration (módulos juntos), E2E (flujos críticos). Decide qué tipo de test corresponde a cada caso y mantiene la pirámide saludable (muchos unit, algunos integration, pocos E2E críticos).
triggers: ["/webapp-testing", "qué test poner", "estrategia de testing", "pirámide de tests", "test coverage", "decidir test e2e o unit"]
allowed-tools: Read, Write, Edit, Glob, Bash
---

# webapp-testing — estrategia de testing para webapps

Más amplia que `playwright`. Esta skill decide QUÉ tipo de test corresponde a cada caso (unit, integration, E2E) y mantiene la pirámide saludable. Si ya decidiste E2E con Playwright, usa la skill `playwright` directamente.

---

## Cuándo activar esta skill

Activa `webapp-testing` solo si tu proyecto cumple uno o más:

1. **Proyecto build con tests heterogéneos** — mezcla de lógica pura, módulos integrados y flujos UI.
2. **Necesitas decidir estrategia de testing desde cero** — qué stack, qué pirámide, qué cobertura razonable.
3. **El proyecto ya tiene tests pero la pirámide está rota** — todo E2E (lento) o todo unit (no detecta integration bugs).
4. **Quieres TDD pero no sabes en qué nivel atacar primero.**

### Cuándo NO activarla

- Proyectos sin UI ni lógica compleja (scripts simples, prototipos).
- Cuando ya elegiste stack específico (Playwright, Vitest, Jest) — usa la skill correspondiente.
- Proyectos creativos sin código relevante a testear.

---

## Qué hace

1. Audita el código para detectar qué tipo de test corresponde a cada módulo:
   - **Lógica pura** (funciones sin side effects) → unit test.
   - **Integración entre módulos** (módulos llamándose entre sí, mocks de externals) → integration.
   - **Flujos críticos del usuario** (login, checkout, cambios persistidos) → E2E.
2. Recomienda stack según el proyecto:
   - Vitest/Jest para unit + integration.
   - Playwright/Cypress para E2E (delega a `playwright` si Playwright es elegido).
   - MSW para mocks de red.
3. Mantiene la pirámide: muchos unit (~70%), algunos integration (~20%), pocos E2E críticos (~10%).
4. Define criterios de cobertura razonables (no obsesionarse con 100% — cubrir lo que importa).
5. Genera plan de testing inicial cuando el proyecto arranca.

---

## Anti-patrones

- **Pirámide invertida** — todo son tests E2E porque "es lo que se ve". Lentos, frágiles, caros.
- **Pirámide aplastada** — solo unit tests, ningún integration ni E2E. Los unit pasan pero los flujos reales rompen.
- **Cobertura como métrica única.** 95% de cobertura con tests débiles no dice nada. Calidad > cantidad.
- **Tests que dependen de orden.** Cada test debe correr aislado.
- **Testear implementación en lugar de comportamiento.** Tests acoplados a implementación se rompen al refactor.

---

## Próximos pasos (esta skill es STUB)

- [ ] Plantilla de plan de testing (qué se testea unit, qué integration, qué E2E).
- [ ] Stack default recomendado (Vitest + MSW + Playwright).
- [ ] Auditor automático de pirámide actual del proyecto.
- [ ] Ejemplos end-to-end de cada nivel.
- [ ] Integración con `superpowers-full` cuando el proyecto adopta TDD estricto.

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de plantillas y auditor.
