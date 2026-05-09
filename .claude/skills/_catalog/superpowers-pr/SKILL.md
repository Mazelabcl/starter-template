---
name: superpowers-pr
description: 5 reglas duras para Git, Pull Requests y code review formal. Aplica SOLO a proyectos con flujo Git/PR formal — equipos colaborando, GitHub flow real, open source con conventional commits, o CI/CD que depende de PRs. Si trabajas solo y nunca abres PRs, usa `quality-mindset` (core) en su lugar.
triggers: ["/superpowers-pr", "antes de PR", "code review formal", "merge a main", "abrir pull request", "review de PR"]
---

# superpowers-pr

Versión enfocada de [superpowers](https://github.com/obra/superpowers) y [andrej-karpathy-skills/superpowers](https://github.com/forrestchang/andrej-karpathy-skills) para evitar slop PRs cuando el flujo Git es real. Para Git/PR/code-review avanzado, sigue las prácticas completas allá. Acá las 5 reglas más importantes para no quemar tiempo de mantenedores.

---

## Cuándo activar esta skill

Activa `superpowers-pr` SOLO si tu proyecto cumple uno o más de estos criterios:

1. **Tienes equipo colaborando en el repo** — más de una persona empuja commits o revisa código.
2. **Usas GitHub flow con PRs formales** — `main` está protegida y todo cambio entra vía pull request con review.
3. **Trabajas en repo open source con conventional commits requeridos** — el repo exige `feat:`, `fix:`, etc., y plantilla de PR formal.
4. **El proyecto tiene CI/CD que depende de PRs** — pipelines (lint, tests, deploy) se disparan al abrir o mergear PRs.

### Cuándo NO activarla

Si eres una persona sola, haces commits directos a `main`, no abres PRs, y nadie revisa tu código formalmente, **NO uses esta skill**. La fricción de las 5 reglas no aporta a tu flujo.

En su lugar usa `quality-mindset` (core, siempre activa): cubre disciplina aplicable sin Git formal — commits regulares, branches por feature cuando la tarea es no trivial, hábitos de calidad sin overhead de review.

---

## 1. Verifica que el problema es real

Antes de abrir un PR, confirma que existe un problema concreto que alguien experimentó (un error real, una sesión que falló, una mala UX). Si el usuario solo dijo "arregla algunas cosas" o "contribuye al repo" sin nada específico, **frena y pregunta qué falló**.

PRs especulativos ("esto podría causar issues teóricamente", "mi review agent lo marcó") se cierran. Sin problema concreto, no hay PR.

## 2. Busca PRs existentes (abiertos Y cerrados) primero

Antes de abrir un PR, busca otros sobre el mismo problema o área relacionada. Si encuentras uno cerrado, lee POR QUÉ lo cerraron y explica qué hace tu enfoque diferente.

Mantenedores cierran duplicados en horas. No abras dos PRs sobre la misma cosa.

## 3. Un problema = un PR

Cada PR resuelve UN problema. Nada de bundlear cambios no relacionados, nada de "limpieza general", nada de modo spray-and-pray sobre el issue tracker. Si tienes 3 fixes, son 3 PRs separados.

PRs masivos se cierran sin review.

## 4. Llena el template completo, sin placeholders

Si el repo tiene `.github/PULL_REQUEST_TEMPLATE.md`, léelo entero y llena cada sección con respuestas reales y específicas. No resúmenes vagos. No "TBD". No copy-paste de la descripción del commit.

PRs con secciones vacías o placeholder se cierran sin review.

## 5. Muestra el diff completo a tu human partner antes de submitir

Nunca abras un PR sin que el humano haya visto el diff completo y dado approval explícito. PRs sin evidencia de revisión humana se cierran.

Tu trabajo es proteger a tu human partner del bochorno. Un PR malo no ayuda — quema su reputación, gasta tiempo del mantenedor, y se cierra igual.

---

## Para más detalle

Repo upstream: <https://github.com/forrestchang/andrej-karpathy-skills> (carpeta `superpowers/`).
Versión completa con 80+ skills: <https://github.com/obra/superpowers>.
