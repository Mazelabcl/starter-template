# {{PROYECTO}} — Principios

> Documento canónico del proyecto. Cualquier agente lo lee LITERAL al tope de su brief — no resumido. Si lo que va a producir contradice un principio, frena y pregunta al orquestador.

## Qué ES este proyecto

{{DESCRIPCION}}

Tipo: **{{TIPO}}** · Modo: **{{MODO}}**

## Qué NO ES

- {{NO_ES_1}}
- {{NO_ES_2}}
- {{NO_ES_3}}

## Audiencia

{{AUDIENCIA}}

## Tono no negociable

- {{TONO_1}}
- {{TONO_2}}
- Idioma: español neutro. Cero voseo (vos / tenés / podés / decime), cero regionalismos rioplatenses.

## Outputs esperados

- {{OUTPUT_1}}
- {{OUTPUT_2}}

## Restricciones duras

- {{RESTRICCION_SI}}
- {{RESTRICCION_NO}}

## Reglas para cualquier agente

1. Lee este archivo + `content/INDEX.md` + `memory/decisions.md` (si tiene contenido) antes de generar output.
2. Si tu output contradice un principio, frena y pregunta.
3. Reporta el modelo que usaste (`claude-opus-4-7`, `gpt-image-2`, etc.).
4. Si generas imágenes: haz Read multimodal del PNG después (skill `multimodal-validation`).
5. Si generas prompts con references: cada `Image N` declarada debe estar mencionada en el texto del prompt.
6. Antes de cerrar un deliverable importante: pasa por pipeline-v2 (architect → critic → cold-reader → humano).

## Versión

v0 — {{FECHA}} — generado por la skill `/kickoff` v3.
