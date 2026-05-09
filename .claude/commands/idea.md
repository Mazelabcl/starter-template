---
description: Captura una idea cruda al backlog del roadmap sin desviar el flujo actual del proyecto
allowed-tools: Bash
---

El usuario lanzó `/idea` con un texto. La idea se debe capturar tal cual, NO ejecutar.

Argumento del usuario: "$ARGUMENTS"

Pasos:

1. Si `$ARGUMENTS` está vacío, responde: "Necesito el texto de la idea. Uso: /idea <texto>". Para.
2. Llama al helper `addIdea` desde Node:

```bash
node -e "import('./src/roadmap.js').then(m => { try { const r = m.addIdea({ text: process.argv[1] }); console.log(JSON.stringify(r)); } catch(e){ console.error(e.message); process.exit(1); } })" -- "$ARGUMENTS"
```

3. Si retorna `added: true`, responde con UNA línea breve:
   `Capturado en backlog: "<idea>". Sigues con tu tarea actual.`
4. Si retorna `added: false` con razón "duplicado", responde:
   `Esa idea ya está en el backlog del sprint actual. Sigues con tu tarea.`
5. Si hay error, reporta el mensaje del error de forma corta.

REGLAS DURAS:
- NO ejecutes la idea capturada. Solo se guarda para revisión posterior.
- NO propongas tareas, planes, ni código a partir de la idea.
- NO interrumpas el contexto previo con análisis. Una línea de confirmación, fin.
- Idioma: español neutro. Cero voseo.
