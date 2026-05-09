# Decisiones del proyecto

Log narrativo de decisiones importantes. Append-only por convención.
Cada decisión tiene fecha, qué se decidió, por qué, qué alternativas se descartaron,
y qué tan reversible es. Si nunca te toca volver atrás, la decisión sigue siendo útil
porque el proyecto que viene atrás puede mirar acá y entender por qué las cosas son
como son sin tener que reconstruir el debate.

Formato por entrada (mantén el orden de campos):

```
## YYYY-MM-DD: <título corto>

**Decisión:** Qué se decidió, en una frase.
**Razón:** Por qué se decidió eso. La razón principal, no todo el debate.
**Alternativas consideradas:** Qué otras opciones había y por qué no.
**Reversibilidad:** alta | media | baja
```

---

<!--
## 2026-05-08: Adoptamos pipeline-v2 para todo deliverable de contenido

**Decisión:** Cualquier capítulo, artículo o concept-art pasa por pipeline-v2.
**Razón:** En el sprint 0 el critic interno solo no atajó dos errores que cold-reader sí cazó.
**Alternativas consideradas:** Mantener critic solo (más rápido pero baja calidad). Saltar critic e ir directo a cold-reader (pierde scoring numérico).
**Reversibilidad:** alta — basta apagar la skill pipeline-v2 en project-profile.json.
-->
