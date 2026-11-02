# kickoff — ejemplos end-to-end

Este archivo NO se carga al invocar la skill. Lo lees solo si necesitas ver el
flujo completo del kickoff aplicado a un caso concreto. La lógica vive en
`SKILL.md`; el detector determinístico en `detector.js`.

---

## Escenario A — meme rápido para Instagram

```
[USUARIO clona el repo]
KICKOFF: Hola, soy el starter template de Mazelab. Antes de empezar dime
en una frase qué quieres construir o resolver hoy.

USUARIO: necesito un meme para Instagram sobre que los lunes son lentos.

[detectSignals → type=content, size=rapido, output=imagen, confidence=3]

KICKOFF: Va, content rápido. Tres preguntas cortas:

1. ¿Tono? (juguetón, irónico, ácido, melancólico…)

USUARIO: ácido pero no agresivo, tipo Liana Finck.

2. ¿Hay paleta o marca que respetar?

USUARIO: no, libre.

3. ¿Una sola pieza o varias?

USUARIO: una sola, para hoy.

KICKOFF:

Esto es lo que entendí:

Proyecto: Meme ácido para Instagram sobre lunes lentos.
Tipo: content (palabras clave: "meme", "Instagram") · pieza única.
Tamaño: rapido · Modo: rapido

Stack recomendado:
- image-gen — genera la imagen final con identity lock.
- image-explorer — explora 3-4 variantes antes de cerrar dirección.
- brand-guidelines — opcional, solo si más adelante quieres formalizar tu look.
- multimodal-validation — fuerza que yo lea el PNG antes de dártelo.
(además de las skills core: multimodal-validation, agent-template)

Sprint 1 sugerido — Producir el primer artefacto creativo y validarlo con cold-reader:
- principles.md y INDEX.md generados por kickoff
- 1 pieza creativa (imagen/copy/post) revisada en frío antes de mostrarla
- Lessons del primer ciclo registradas en lessons.md

¿Confirmas o ajustas algo?

USUARIO: dale.

[Persistencia → writeProfile, addSkill x10, startSprint (NO addSprint — D7)]
[Crea content/principles.md, content/INDEX.md, roadmap/roadmap.md]

KICKOFF: Listo. Guardé... ¿empezamos con el meme?
```

---

## Escenario B — digitalizar área de ventas de empresa

```
USUARIO: voy a digitalizar el área de ventas de mi empresa, somos 4 personas y todo está en planillas.

[detectSignals → type=business, size=grande, output=mixed, confidence=4]

KICKOFF: Va, business grande. Cuatro preguntas:

1. ¿Qué proceso concreto te duele más hoy? (lead capture, seguimiento, cotización, cierre, post-venta)

USUARIO: el seguimiento. Se nos pierden leads en planillas distintas.

2. ¿Tienes alguna herramienta ya en uso o partimos de cero?

USUARIO: usamos Google Sheets. No queremos pagar HubSpot todavía.

3. ¿Qué horizonte? (semanas, meses)

USUARIO: idealmente 1 mes para tener algo usable.

4. ¿Quién va a usarlo además de ti? (perfiles técnicos, no técnicos)

USUARIO: yo y dos vendedores que no son técnicos.

KICKOFF:

Esto es lo que entendí:

Proyecto: Digitalizar seguimiento de leads de ventas (4 personas, sin HubSpot).
Tipo: business (frase: "digitalizar el área de ventas") · proceso real con usuarios.
Tamaño: grande · Modo: profundo (varios sprints, decisiones con impacto)

Stack recomendado:
- council — decisiones de proceso tienen ángulos comerciales y técnicos a la vez.
- cold-reader-gate — antes de proponer un cambio operativo, lo leemos en frío.
- agent-template — modelaremos roles (vendedor, follow-up, reporte) como agentes para tareas repetitivas.
- seo-strategist — opcional, solo si después atacamos captura orgánica de leads.
(además de las skills core)

Sprint 1 sugerido — Mapear el proceso a digitalizar y proponer la primera versión:
- principles.md y INDEX.md generados por kickoff
- Mapa actual del proceso (estado AS-IS) en docs/
- Propuesta TO-BE con 3 cambios concretos prioritizados

¿Confirmas o ajustas?

USUARIO: confirma.

[Persistencia + creación de archivos]
```

> Nota v4: los escenarios A y B muestran la entrevista. Desde v4 el cierre ya no es un bloque de texto en el chat sino el plan de batalla en el cockpit (escenario C).

---

## Escenario C — landing + pedidos para una cafetería (plan de batalla, v4)

```
USUARIO: Landing + mini app para una cafetería de barrio en Santiago que quiere
pedidos online, con fotos generadas por IA y un video corto para Instagram.

[detect → type=build (tiebreaker build > content), size=medio, output=codigo]

KICKOFF: 1. ¿Quién la usa? → clientes del barrio, desde el celular.
         2. ¿Delivery o retiro? → retiro en el local, pagando online.
         3. ¿Qué debe funcionar primero? → elegir del menú, pagar y que el local vea el pedido.
         4. ¿Plazo y presupuesto? → 3-4 semanas, presupuesto chico.

[contrast build → extras: video-director · brazos.js suggest --estado · council suggest]
[borrador → memory/plan-de-batalla.borrador.json (ver ejemplo-plan-borrador.json)]
[plan.js build → memory/plan-de-batalla.json · cockpit.js publish · cockpit.js open <id>]

KICKOFF (chat, 5 líneas):
Plan de batalla listo: Cafetería de barrio en Santiago: landing + pedidos online.
Equipo: Desarrollador fullstack (agente nuevo), Directora de arte gastronómica, Director de video para reels, Especialista en marketing local y SEO.
Brazos: 14 sugeridos, 8 por conectar.
Sprint 1: Datos reales y dirección de arte.
Te abrí el cockpit en el navegador: vota, comenta o conversa por voz y guarda el feedback.

[Aldot vota y conversa por voz → Guardar feedback]
[cockpit.js pending → ajustar → (v2 si hay cambios grandes) → done → persistir → crear agente nuevo + aviso de reinicio]
```

La cantidad de brazos "por conectar" depende de cada computador (`node src/brazos.js status`).
