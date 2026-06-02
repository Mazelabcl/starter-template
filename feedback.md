# feedback.md — del starter Mazelab

Buzón para reportar findings sobre el **starter-template Mazelab** (skills faltantes, scripts rotos, anti-patrones en docs, contracts que no encajan en uso real). **NO** es para bugs/features del proyecto consumer.

**Para reportar algo del starter, agrega tu finding bajo `## NUEVO`.** El usuario solo dice "anota en feedback.md" — la estructura de abajo es self-documented, no necesitas preguntar formato. Fecha + contexto + finding + acción sugerida (opcional). Texto libre OK si es claro.

**Si parcheaste a mano un script/archivo DEL STARTER en este proyecto** (no del consumer), anótalo con el tag `[UPSTREAM-FIX]` al inicio del título — el orquestador del starter lo prioriza sobre features para que el fix suba al starter rápido. Ejemplo: `## 2026-06-02 — [UPSTREAM-FIX] openai_images.py ignora refs .webp`.

**Cómo se procesa:** cuando aldot retoma sesión sobre el starter, le da esta ruta al orquestador del starter, que lee `## NUEVO`, sincroniza al inbox global, aplica fixes y mueve lo procesado a `## Archivo` con fecha. **No arregles el starter desde el proyecto consumer** — tu rol es reportar.

---

## NUEVO (sin procesar)

<!-- Los agentes del proyecto escriben sus findings acá, al final de esta sección. Formato libre, una entry por finding:
## YYYY-MM-DD — <título corto>
Contexto: qué estaba haciendo el proyecto cuando apareció.
Finding: qué del starter falla / falta / molesta.
Acción sugerida (opcional): qué cambiar en el starter.
-->

(vacío)

---

## Archivo (ya procesado por el orquestador del starter)

<!-- El orquestador del starter mueve acá lo que ya sincronizó al inbox global y/o arregló, anotando la fecha de proceso. -->

(vacío)
