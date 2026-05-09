# Dashboard UI — guía rápida (Sprint 2.3a)

UI vanilla (HTML + CSS + JS, cero dependencias). Servida por `dashboard/server.js` en
el puerto `7777`.

## Layout

- **Header (arriba):** título + banner del proyecto (icono según `project_type`,
  descripción, tags) + chips de métricas (tokens, completadas, fallos, councils,
  imágenes, uptime) + indicador de conexión.
- **Sidebar izquierdo (colapsable, persistido en localStorage):** sprint actual con
  barra de progreso, skills activas como chips, equipo activo (agentes ordenados
  por uso), contratos declarados (`contracts/declared/`), enlace para descargar
  `/api/state`.
- **Kanban central:** cuatro columnas — `En cola`, `Trabajando`, `Completadas`,
  `Falladas`. Cada tarjeta muestra título, agente con tooltip de su rol, skill
  invocada (chip violeta), archivos en uso (con "ver más" si pasan de 3), tiempo
  transcurrido (live para `running`) y tokens estimados.

## Estados visuales

| Color  | Significa                                                  |
| ------ | ---------------------------------------------------------- |
| Verde  | éxito (tareas completadas, conexión SSE viva)              |
| Cyan   | trabajando (border pulsante en cards `running`)            |
| Violeta| skill o council invocados                                  |
| Amarillo| advertencia, fallback a polling                          |
| Rojo   | fallo de tarea, servidor caído, indicador `down`           |

Una tarjeta `running` tiene borde pulsante cyan. Una `failed` tiene borde rojo,
ícono "!" en la esquina y la razón del fallo en `title` (hover).

## Conexión al server

1. **Carga inicial:** `GET /api/state` se llama una vez para pintar todo.
2. **Live updates:** `EventSource('/api/events')` (SSE). Cada evento `state` dispara
   un re-fetch + re-render incremental.
3. **Fallback (3 errores SSE seguidos):** polling cada 2 s contra `/api/state`.
   Indicador pasa a amarillo.
4. **Servidor caído:** indicador rojo con mensaje "servidor caído, reintentando…",
   reintenta cada 5 s.

Cada segundo se actualizan los contadores live (uptime + duración de tareas
`running`) sin tocar al server.

## Render incremental

El kanban no hace re-render completo. Cada `<article class="task">` lleva un
`data-task-id`. En cada actualización: las tarjetas vivas se reusan (solo se
actualizan los slots que cambiaron), las nuevas se insertan con animación
`slide-in`, y las que ya no aplican se eliminan.

## Persistencia local

Solo flags de UI bajo el namespace `mz.dashboard.*`:

- `mz.dashboard.sidebar` → `open` o `closed`.

## Estado vacío

Si no hay tareas, eventos ni tokens consumidos, aparece un banner sobre el kanban
con un comando de ejemplo de `update_state.js` para generar actividad de prueba.
Si no hay perfil del proyecto, el banner del header sugiere `/kickoff`.

## Próximamente (Sprint 2.3b)

- Panel inferior con timeline en vivo de eventos.
- Modal de replay para hacer scrubbing temporal sobre `/api/history`.
- Botón "Exportar log" en el sidebar.

Los hooks ya están reservados en el HTML (comentarios `<!-- 2.3b: ... -->`) y el
CSS (variable `--timeline-h: 0px` que 2.3b cambia a `240px`).
