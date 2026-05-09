# memory/ — memoria persistente del proyecto

Esta carpeta guarda el estado mutable del proyecto entre sesiones: qué construimos,
qué decidimos, qué aprendimos, qué agentes están activos. Es **del proyecto**, no
del usuario. Se queda en el repo del proyecto y viaja con él.

## Por qué existe (y por qué no es CLAUDE.md ni memoria global)

Hay tres lugares donde puede vivir información persistente. Cada uno tiene su rol:

| Dónde | Qué va | Ejemplo |
|---|---|---|
| **CLAUDE.md** del proyecto | Reglas estables, capacidades, anti-patrones del repo | "Usa pipeline-v2 antes de imágenes", "Las refs deben mencionarse en el prompt" |
| **memory/** del proyecto (esta carpeta) | Estado mutable, decisiones, lessons, equipo activo | "El 2026-05-09 decidimos cambiar a modo profundo", "El sprint 2 cerró con 3 lessons" |
| **Memoria global del usuario** (`~/.claude/projects/.../memory/`) | Reglas que aplican a TODOS los proyectos del usuario | "Aldot habla español neutro", "Aldot prefiere claude-opus-4-7 para todo" |

Si lo que tienes en mano aplica a TODOS los proyectos del usuario, no va acá.
Si es regla estable de ESTE repo (no cambia entre sesiones), va a `CLAUDE.md`, no acá.
Si es decisión / lección / estado del proyecto que sí cambia, va acá.

## Estructura

```
memory/
  README.md                  (este archivo)
  project-profile.json       (perfil del proyecto, generado por /kickoff)
  decisions.md               (log narrativo de decisiones)
  lessons.md                 (lessons del proyecto)
  active-team.json           (agentes y skills activos + métricas)
  sprint-log.md              (sprints cerrados)
  templates/                 (templates vacíos que el kickoff copia)
  schemas/                   (JSON Schemas para los archivos JSON)
  test.js                    (test de los helpers en src/memory.js)
```

Los archivos en la raíz de `memory/` no existen al inicio — los crea
`/kickoff` (Sprint 2.1) copiando desde `memory/templates/`.

## Cuándo escribir a cada archivo

### `project-profile.json`

Una sola vez en el kickoff, y se actualiza solo cuando el perfil del proyecto cambia
de verdad (ej. el modo pasa de `rapido` a `profundo`, se agrega un agente
permanente, etc.). No es un log: es un snapshot.

Ejemplo de uso desde código:

```js
import { writeProfile, readProfile } from '../src/memory.js';

writeProfile({
  project_type: 'research',
  mode: 'profundo',
  description: 'Sistema de memoria contextual para starter Mazelab.',
  created_at: new Date().toISOString(),
  owner: 'aldo@mazelab.cl',
  skills_activas: ['kickoff', 'pipeline-v2'],
  agentes_activos: ['architect-alpha'],
  sprint_inicial: 'sprint-1-fundamentos',
});
```

### `decisions.md`

Cada vez que se toma una decisión importante: arquitectónica, de proceso, de tono,
de exclusión ("no vamos a soportar X"). El criterio: *si en 6 meses alguien va a
preguntar "por qué hicimos esto así", la respuesta tiene que estar acá*.

```js
import { addDecision } from '../src/memory.js';

addDecision({
  title: 'Adoptar pipeline-v2 por defecto',
  decision: 'Todo deliverable de contenido pasa por pipeline-v2.',
  reasoning: 'El critic interno solo no atajó 2 errores que cold-reader sí cazó.',
  alternatives: 'Mantener critic solo; saltar critic e ir directo a cold-reader.',
  reversibility: 'alta',
});
```

### `lessons.md`

Cada vez que algo falló y aprendimos por qué, o algo funcionó y queremos repetirlo.
Si la lección aplica a TODOS los proyectos del usuario, va a la memoria global,
no acá.

```js
import { addLesson } from '../src/memory.js';

addLesson({
  title: 'Las refs del prompt deben mencionarse en el texto',
  context: 'Cargamos 4 refs pero el modelo ignoró 3.',
  lesson: 'Cada Image N tiene que estar nombrada literal en el prompt.',
  application: 'Antes de enviar, releer el prompt y verificar.',
});
```

### `active-team.json`

Se toca cada vez que un agente entra o sale del proyecto, y `touchAgent` se llama
en cada invocación para mantener métricas. El orquestador usa esto para decidir
"qué agente lleva más tiempo sin invocarse, ¿sigue siendo útil?".

```js
import { addAgent, addSkill, touchAgent, getActiveTeam } from '../src/memory.js';

addAgent({
  name: 'architect-alpha',
  role: 'Crea propuestas estructurales antes de Critic',
  model: 'claude-opus-4-7',
});
addSkill({ name: 'pipeline-v2' });

touchAgent('architect-alpha');

const team = getActiveTeam();
```

### `sprint-log.md`

Una entrada por sprint cerrado, no durante. Incluye objetivo, entregables y lessons
emergentes. Es la vista de pájaro que un humano nuevo puede leer y entender la
historia del proyecto en 2 minutos.

```js
import { addSprint } from '../src/memory.js';

addSprint({
  number: 1,
  objective: 'Fundamentos del pipeline',
  deliverables: ['contracts/', 'memory/', 'src/memory.js'],
  lessons: ['schemas compartidos evitan reescribir validación'],
  dates: { start: '2026-05-01', end: '2026-05-08' },
});
```

## Cómo el orquestador la lee al inicio de cada sesión

La idea es que la sesión arranque con un snapshot ligero, no con el contenido
crudo. Para eso `summarize()`:

```js
import { summarize, readProfile } from './src/memory.js';

const snap = summarize();
// snap = {
//   has_profile: true,
//   project_type: 'research',
//   mode: 'profundo',
//   description: '...',
//   sprint_inicial: 'sprint-0-discovery',
//   agentes_count: 4,
//   skills_count: 6,
//   decisiones_count: 12,
//   lecciones_count: 7,
//   sprints_completados: 2,
//   paths: { ... }
// }

if (snap.decisiones_count > 0) {
  // cargar decisions.md crudo solo si hay algo que leer
}
```

Recomendación de uso desde el orquestador:

1. Llama `summarize()` siempre. Es barato.
2. Si `has_profile === false`, propone `/kickoff`.
3. Carga `decisions.md` y `lessons.md` solo cuando vayas a tomar una decisión nueva
   o el usuario pregunte por contexto histórico.
4. `active-team.json` se carga solo cuando vayas a delegar a un agente, para saber
   qué está disponible.

## Anti-patrones (qué NO meter acá)

- **No metas info temporal del turno actual.** "El usuario me pidió X hace 5 minutos"
  no va acá. Si pasa el turno, se olvida; si se documenta, va a `decisions.md` o
  `lessons.md` sintetizado.
- **No metas reglas estables del repo.** Eso es `CLAUDE.md`. Si la regla aplica
  igual la próxima sesión sin importar qué pasó, es regla, no estado.
- **No metas reglas globales del usuario.** Si la regla aplica a todos los
  proyectos de Aldot, va a `~/.claude/projects/.../memory/`, no acá.
- **No metas dumps de conversación crudos.** El log conversacional es ruido. Lo que
  destila lecciones va a `lessons.md` y se acabó.
- **No metas archivos pesados** (research crudo, datasets, imágenes). Esos van a
  `content/`, `docs/`, `data/`. `memory/` se mantiene chico.
- **No metas secretos** (API keys, tokens). El `.env` ya tiene su lugar.
- **No edites a mano `active-team.json`** salvo emergencia. Pasa por los helpers,
  que validan contra el schema.

## Integración con `contracts/`

Los schemas en `memory/schemas/` están escritos en el mismo dialecto (draft-07,
`additionalProperties: false`, `$id` corto, mensajes en español neutro) que los
de `contracts/schemas/`. En Sprint 1.3 (pipeline-v2) los dos sistemas se cruzan:
contracts valida los hand-offs entre agentes, memory persiste lo que sale como
"verdad estable". Si hace falta, el validator de contracts puede importar también
estos schemas — la convención está alineada.

## Tests

```
node memory/test.js
```

Cubre: writeProfile válido + inválido, decisions, lessons, agentes idempotentes,
skills, touchAgent, sprint log, summarize, y readProfile sobre dir vacío.
