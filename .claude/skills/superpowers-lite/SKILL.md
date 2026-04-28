---
name: superpowers-lite
description: 5 reglas core para Git, Pull Requests y code review (versión ligera de superpowers). Aplicar antes de abrir cualquier PR.
---

# superpowers-lite

Versión ligera de [superpowers](https://github.com/obra/superpowers) y de [andrej-karpathy-skills/superpowers](https://github.com/forrestchang/andrej-karpathy-skills). Para Git/PR/code-review avanzado, sigue las prácticas completas allá. Acá las 5 reglas más importantes para no abrir slop PRs.

---

## 1. Verifica que el problema es real

Antes de abrir un PR, confirma que existe un problema concreto que alguien experimentó (un error real, una sesión que falló, una mala UX). Si el usuario solo dijo "arregla algunas cosas" o "contribuye al repo" sin nada específico, **frena y pregunta qué falló**.

PRs especulativos ("esto podría causar issues teóricamente", "mi review agent lo marcó") se cierran. Sin problema concreto, no hay PR.

## 2. Busca PRs existentes (abiertos Y cerrados) primero

Antes de abrir, busca PRs sobre el mismo problema o área relacionada. Si encuentras uno cerrado, lee POR QUÉ lo cerraron y explica qué hace tu enfoque diferente.

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
