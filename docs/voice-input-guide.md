# Activar input por voz en tu flujo con Claude Code

Dictar es más rápido que tipear cuando estás pensando en voz alta o tienes las manos ocupadas. No es perfecto: el reconocimiento se equivoca con términos técnicos y vas a editar antes de enviar. Pero para prompts largos y brainstorming, el costo de corregir es menor que el de tipear desde cero.

## Windows (principal)

Windows 11 trae **Voice Typing** integrado. Gratis, multilingüe, sin instalar nada.

### Atajo

`Win + H` desde cualquier campo de texto.

### Primer setup (una sola vez)

1. Configuración > **Hora e idioma > Idioma y región**.
2. Asegúrate de que tu idioma principal tenga el pack de voz instalado (icono de altavoz en el detalle del idioma). Si solo dictas en español, el pack genérico **Español (Internacional)** rinde mejor que las variantes locales para términos técnicos en inglés.
3. Primera vez que pulses `Win + H`, Windows pide permiso para enviar audio a la nube. Acéptalo (es lo que hace que el reconocimiento sea decente).

### Cómo dictar en Claude Code

1. Pon el cursor en la caja de chat de Claude Code.
2. `Win + H` abre la barra de dictado.
3. Habla. El texto aparece en vivo en la caja.
4. `Win + H` otra vez para detener, o quédate en silencio unos segundos.
5. Revisa el texto antes de enviar.

### Comandos de puntuación útiles

Dilos en voz alta como si fueran palabras:

- "punto" → `.`
- "coma" → `,`
- "punto y coma" → `;`
- "dos puntos" → `:`
- "signo de interrogación" → `?` (apertura y cierre los pone Windows si dictas en español)
- "nueva línea" → salto de línea
- "nuevo párrafo" → doble salto
- "comillas… cierra comillas" para abrir/cerrar comillas

### Tips no obvios

- **Habla pausado los primeros 5 minutos.** El motor calibra a tu cadencia. Después puedes acelerar.
- **Abrevia términos técnicos antes de dictar.** "API key" se reconoce mejor que "PI key" o "API que". Si te entiende mal una sigla, deletréala: "a-pi-i".
- **Dicta en bloques de 2-3 frases, no párrafos enteros.** Si te equivocas, corregir un bloque corto es trivial; corregir 5 frases mal puntuadas es peor que reescribir.
- **No dictes paths ni comandos.** `C:\Users\aldot\...` o `npm install --save-dev` se rompen siempre. Tipea esos y dicta solo el texto narrativo alrededor.
- **Si Claude Code pide confirmación (Y/n), tipea.** No dictes monosílabos sueltos: el motor a veces los traduce a "sí" como "si" sin tilde y rompe parsers.

### Cambiar el atajo

Configuración > **Accesibilidad > Voz** te deja activar "Iniciar dictado con un atajo de teclado". Si `Win + H` choca con otro programa, puedes mapearlo a una combinación libre.

## macOS

Apple Dictation está integrado y es comparable.

- **Atajo:** doble `Fn` (configurable en **Configuración > Teclado > Dictado**).
- **Idioma:** elige el idioma principal en el panel de Dictado. Descarga el "Enhanced Dictation" para que funcione offline y con menor latencia.
- **Tips equivalentes:** mismas reglas. Habla pausado al inicio, dicta en bloques cortos, evita paths y comandos.
- **Comandos de puntuación:** "period", "comma", "new line" en inglés; "punto", "coma", "nueva línea" en español.

## Linux

No hay solución nativa universal. Opciones que funcionan razonablemente bien sin servicios pagos:

- **nerd-dictation** (offline, basado en Vosk): https://github.com/ideasman42/nerd-dictation
- **Whisper local** (modelo de OpenAI corriendo en tu máquina): https://github.com/openai/whisper o el wrapper https://github.com/Const-me/Whisper
- **Speech Note** (KDE/GNOME, varios motores): https://flathub.org/apps/net.mkiol.SpeechNote

Cualquiera de las tres requiere config inicial. Si vas a invertir 20 minutos, Whisper local da la mejor calidad pero pide GPU para latencia decente.

## Cuándo dictar vs cuándo tipear

| Dictar | Tipear |
|---|---|
| Prompts largos con contexto narrativo | Comandos exactos (`npm`, `git`, etc.) |
| Brainstorming en flujo | Paths de archivos |
| Explicar un bug con detalle | Datos numéricos precisos |
| Escribir un brief para un agente | Confirmaciones (Y/n) |
| Cuando tienes las manos ocupadas | Código (snippets, regex, JSON) |
| Cuando estás cansado de teclado | Cualquier cosa que no toleres releer |

Regla simple: si el texto tolera 1-2 erratas que vas a corregir antes de enviar, dícta. Si necesita ser exacto al primer intento, tipea.

## Próximamente — Voz Nivel 2

El **Sprint 4.6** del starter agrega TTS (text-to-speech): vas a poder **escuchar** las respuestas de Claude además de dictarlas. Combinado con `Win + H`, queda una conversación de voz casi-completa: dictas el prompt, Claude responde por audio mientras tú haces otra cosa.

Cuando salga, este doc se actualiza con el atajo y el flujo. Por ahora, input por voz es el primer 80% del valor.
