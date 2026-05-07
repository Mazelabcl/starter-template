# Findings — mejoras a aplicar al starter-template

> Hallazgos en vivo durante el dogfooding del workshop2.
> Cada uno se debe propagar a la rama `feat/pipeline-v2-and-image-gen`
> (o nueva rama follow-up) antes del merge a main.

**Convención:** cada finding tiene severidad (🔴 crítico / 🟡 medio / 🟢 nice-to-have)
y propuesta concreta de cambio.

---

## F1 🔴 `npm install` no se ejecutó automáticamente

**Síntoma:** al clonar y arrancar a usar el sistema, `node src/research.js` falló
con exit 1. La causa: `dotenv` no estaba instalado porque `npm install` no se
había corrido. El error no era explicativo — solo "exit 1" silencioso.

**Por qué pasó:**
- El `postinstall` corre `setup.js` que detecta TTY → como esta sesión clónica
  fue por `git clone` directo (no `npm install` después), nunca se gatilló.
- El usuario asumió que clonar bastaba.

**Propuesta de fix:**
- README: agregar instrucción explícita "después de `git clone`, **siempre**
  corre `npm install` aunque vayas a usar el setup interactivo".
- Skill `kickoff`: como primer paso, verifica si `node_modules/` existe.
  Si no, ejecuta `npm install --ignore-scripts` antes de cualquier otra cosa.
- `src/research.js`: al arrancar, validar que `dotenv` está disponible y dar
  error explícito tipo "Falta `npm install`. Corre `npm install` primero".
- Idem `scripts/openai_images.py`: validar `openai` instalado, error explícito.

**Impacto si se aplica:** un usuario novato que clona el template no se atasca
en una falla silenciosa.

---

## F2 🔴 Sub-agentes tienen sandbox más restrictivo que el orquestador

**Síntoma:** los sub-agentes general-purpose lanzados con `Agent` no podían
ejecutar `node src/research.js` ni siquiera con `Bash(node src/research.js *)`
declarado en `.claude/settings.local.json`. Pero el orquestador (sesión principal)
sí pudo correrlo sin problema.

**Por qué pasó:** los permisos del settings local no se propagan al sandbox de
sub-agentes (al menos no automáticamente). Cada sub-agente parece arrancar con
permisos más estrechos.

**Propuesta de fix:**
- Crear documento en `.claude/skills/pipeline-v2/SKILL.md` con sección
  "Cuándo el orquestador NO debe delegar": queries de research vía `node src/research.js`
  son ejecutadas por el orquestador, NO por sub-agentes (hasta que se resuelva
  el sandbox).
- Alternativa: que el orquestador lance las queries con `run_in_background` y
  pase los outputs (paths) a un sub-agente sintetizador (este patrón funciona
  en este dogfooding — verificado).
- Documentar el workaround en CLAUDE.md del template como anti-patrón.

**Impacto:** sin esto, los usuarios novatos van a delegar research a sub-agentes
y se van a confundir cuando falle por permisos.

---

## F3 🟡 Prompts "actúa como" ricos vs minimalistas

**Síntoma:** los primeros prompts a sub-agentes empezaban con "Eres architect"
seco. Aldot intuyó que prompts más ricos ("actúa como senior X obsesionado con Y,
con N años haciendo Z") generan outputs más alineados.

**Por qué importa:** los outputs con prompt minimalista son funcionales pero
predecibles. Con persona rica, el agente trae perspectivas más específicas
y un tono más coherente con el deliverable.

**Propuesta de fix:**
- Skill `agent-template` (ya existe en el template) — agregar plantilla
  obligatoria de "Actúa como ___, con [obsesión], experto en [Y], que viene de
  [contexto], cuyo superpoder es [Z]".
- Skill `pipeline-v2` — añadir sección "Cómo escribir el prompt al architect/critic":
  ejemplos antes/después, con resultados comparados.
- Esperar el deep research de Q5 (en curso) para validar con docs oficiales
  Anthropic si "actúa como" está formalmente recomendado o si hay técnica mejor.

**Impacto:** mejor calidad consistente de los sub-agentes en cualquier proyecto futuro.

---

## F4 🟡 Settings.local.json: documentar permisos típicos esperados

**Síntoma:** tuve que ir agregando permisos a `.claude/settings.local.json`
en vivo cuando descubría que sub-agentes los necesitaban: `node src/research.js *`,
`python scripts/openai_images.py *`, `npm install *`, etc.

**Propuesta de fix:**
- En el template, `.claude/settings.local.json` viene **pre-poblado** con
  los permisos mínimos esperados para los flujos del template (research,
  imágenes, npm, pip). Que el usuario novato no tenga que adivinar qué
  permisos hacen falta.
- Ya que es `.local.json` (no se versiona normalmente), considerar generar
  un `.claude/settings.example.local.json` versionado con la plantilla de
  permisos sugerida.

---

## F5 🟢 Bug-trap "Pax contaminación" del CLAUDE.md global del orquestador

**Síntoma:** el architect R1 metió referencias a "Pax" y "character sheets"
en el outline del workshop2 sin que principles.md las mencionara. Causa:
mi memoria global como orquestador (CLAUDE.md de aldot menciona Pax como
proyecto previo) y se filtró al brief.

**Propuesta de fix:**
- Skill `pipeline-v2` — agregar regla: "El brief al architect debe incluir
  cláusula EXCLUSIONES explícitas: 'no menciones proyectos previos del
  orquestador (X, Y, Z) salvo que aparezcan en principles.md'".
- O: el architect recibe SOLO los archivos del INDEX, NO la memoria del
  orquestador como contexto extra.

---

## F6 🟢 Cold-reader gate validó B4 después de R2 — pero solo lo cazó porque Aldot leyó manualmente

**Observación:** el cold-reader-gate aún no se ejecutó en este flow (está en cola
para post-R3). Pax fue cazado por Aldot leyendo el outline R1, no por el gate.
Esto sugiere que para outputs largos (60 slides), un cold-reader humano-en-loop
puede ser tan o más útil que el agente.

**Propuesta:** la skill `cold-reader-gate` debería tener un modo "diff-mode":
en lugar de leer el outline completo, leer solo lo que cambió desde la versión
anterior. Más rápido y más detect-able.

---

## F7 🟡 `process-log/` se llena de archivos intermedios crudos (`_q1_raw.md`, etc.)

**Observación:** los outputs raw de research.js los guardé como `process-log/_q*_raw.md`
para que el sintetizador los procese. Después se borran. Pero por un momento
ensucian el directorio.

**Propuesta:** convención — archivos intermedios van a `process-log/_tmp/` que
está en `.gitignore`. Solo los reportes finales se quedan en `process-log/`.

---

## F8 🔴 Falta validación pre-flight en `kickoff`

**Síntoma:** la skill `kickoff` arranca a entrevistar al usuario sin verificar
nada del entorno. Si la API key falta o `npm install` no se hizo, el usuario
descubre el problema después de invertir 10 minutos.

**Propuesta de fix:** la skill `kickoff` debe ejecutar pre-flight checks ANTES
de la entrevista:

1. ¿`node_modules/` existe? Si no → "voy a instalar deps, espera 30s" → corre `npm install --ignore-scripts`
2. ¿`.env` existe con `OPENROUTER_API_KEY` no vacío? Si no → propone `/setup-openrouter`
3. ¿`.env` tiene `OPENAI_API_KEY` (si el proyecto va a generar imágenes)? Pregunta y propone `/setup-openai`
4. ¿Python 3.10+ + venv configurado (si va a usar gpt-image-2)? Si no → propone `npm run setup-python`

Solo después de que los checks pasen, arranca la entrevista.

---

## F9 🟢 `principles.md` debería incluir un campo "EXCLUSIONES de memoria global"

**Propuesta:** agregar sección estándar al template de principles.md:

```
## EXCLUSIONES (qué NO traer del CLAUDE.md global del orquestador)

- Otros proyectos del usuario que NO son este: <lista nombres>
- Lecciones cross-domain que NO aplican
- Convenciones de otros stacks que no aplican acá
```

Esto previene contaminación tipo F5.

---

## F10 🟡 Necesitamos meta-template de "actúa como" según el rol

**Propuesta:** documento `~/.claude/skills/agent-template/personas.md` con
plantillas pre-armadas por rol:

- Architect → "actúa como guionista senior Pixar/Apple..."
- Critic pedagogo → "actúa como profesor con 20 años enseñando a..."
- Critic showman → "actúa como director de comedia / talks TED..."
- Cold-reader → "actúa como persona que llega de cero a..."
- Frontend-builder → "actúa como dev frontend obsesionado con UX..."
- Research-validator → "actúa como editor senior The Atlantic / Axios..."

Que el orquestador no las invente cada vez. Reusable, calibradas.

---

## F11 🟡 Perplexity amplifica typos del usuario

**Síntoma:** cuando hicimos research sobre el framework "OpenClaude" (typo del
usuario por algún otro framework real), Perplexity respondió construyendo
respuestas alrededor del término inventado, atribuyendo a un creador
("Peter Steinberger") sin evidencia verificable, en lugar de proponer
"este término no existe, ¿quizás OpenInterpreter / OpenHands / etc.?".

**Por qué pasó:** Perplexity por defecto trata el query del usuario como
fuente de verdad y busca contenido que se ajuste, en lugar de cuestionar
el término.

**Propuesta de fix:**
- `src/research.js` debería envolver queries con un pre-prompt tipo:
  "Si algún término en la siguiente pregunta parece typo, error tipográfico,
   o producto inexistente, lista 3 candidatos plausibles ANTES de buscar.
   Solo si el término se confirma, procede con la búsqueda. Pregunta:
   <query original>"
- Documentar este patrón en el README como "anti-alucinación de Perplexity".
- Skill `pipeline-v2` agrega regla: cuando research devuelva una atribución
  específica (persona / repo / cita), pedirle al synthesizer que verifique
  con una query secundaria de cross-check.

**Impacto:** sin esto, los proyectos basados en research van a meter datos
inventados (alucinados por Perplexity con la cooperación del typo del usuario)
en sus deliverables.

---

## F12 🔴 Sub-agentes Opus se trababan en planificación larga (watchdog mata stream a 600s)

**Síntoma:** el architect R4 quedó "planificando" >10 min sin escribir output.
El watchdog del stream lo mató con error "no progress for 600s".

**Por qué pasó probablemente:** el prompt era extenso (3000+ palabras), incluía
mucho contexto y muchos cambios. El agente entró en modo "deliberación
extendida" antes de escribir el archivo final. El stream no emite tokens
durante esa fase.

**Propuesta de fix:**
- Brief al architect debe incluir cláusula explícita: "Empieza ESCRIBIENDO el
  archivo. No planifiques en mensajes — planifica en el header del archivo
  como comentario HTML".
- Skill `pipeline-v2` agrega regla: "agentes que escriben archivos largos
  deben hacerlo en chunks visibles, no en modo deliberación extendida".
- Posible: split de R4 en 2 mini-tareas (R4a = rellenar placeholders,
  R4b = refactor conectores), cada una más corta.

**Impacto:** sin esto, los agentes se traban en proyectos grandes y hay que
relanzarlos perdiendo tiempo + cuota.

---

## F13 🟡 Architect cuenta slides en el resumen pero los lista mal

**Síntoma:** el outline R5 tenía un resumen que decía "71 slides totales", pero
el listado real por sección sumaba 75. El sub-agente image-prompt-architect lo
detectó al iterar slide por slide. Si no lo hubiera cazado, el batch generaría
4 imágenes menos de lo necesario.

**Por qué pasó:** el architect (en R3, R4 o R5) hizo cuentas mentales mal
y nunca se validó automáticamente.

**Propuesta de fix:**
- Skill `pipeline-v2` agregar checkpoint: "después de cada R, ejecutar un
  `outline-counter` script que cuenta `## Slide` headers y compara con el
  resumen al final. Si discrepa, abortar y devolver al architect."
- O incluir el conteo automático directamente en la skill `cold-reader-gate`
  (ya tiene acceso al outline).

---

## Próximos finds (esperando a que lleguen)

- [ ] Resultado de Q5 deep research → ¿Anthropic recomienda "actúa como"? actualizar F3.
- [ ] Errores de gpt-image-2 cuando aparezcan en Fase 4.
- [ ] Issues de Vercel CLI / deploy en Fase 5.
- [ ] Tiempo total + costo total al cierre — para comparar con la estimación inicial.

---

## Plan de aplicación al template

Cuando termine el workshop2 (deliverable entregado a Aldot):

1. Crear nueva rama desde `feat/pipeline-v2-and-image-gen`: `feat/findings-from-workshop2`
2. Aplicar findings F1, F2, F4, F8 (críticos)
3. Aplicar F3, F7, F10 (medios) si hay tiempo
4. Aplicar F5, F6, F9 (nice-to-have) en otra ronda
5. PR a la rama original o directo a main según severidad
