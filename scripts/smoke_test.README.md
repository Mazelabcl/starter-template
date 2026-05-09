# Smoke test del starter v3

Un comando que en menos de 90 segundos te dice si el sistema completo funciona end-to-end. Pensado para correrse antes de empezar un proyecto serio, no para CI continuo.

## Cómo ejecutar

```bash
npm run smoke           # completo (~60-90s, gasta ~USD 0.05 en API credits)
npm run smoke:quick     # rápido (<15s, sin gastos de red)
node scripts/smoke_test.js --verbose   # detalle de cada check
node scripts/smoke_test.js --help      # ayuda
```

## Modos disponibles

| Modo | Tiempo | Costo | Cuándo usarlo |
|------|--------|-------|---------------|
| default | 60-90s | ~USD 0.05 | Antes de empezar proyecto serio. Una vez por sesión real. |
| `--quick` | <15s | USD 0 | Después de cambios al setup, para validar estructura. |
| `--verbose` | igual que arriba | igual | Cuando algo falla y necesitas ver detalle. |

## Qué chequea cada check

| # | Nombre | Costo | Lo que valida |
|---|--------|-------|---------------|
| 1 | Variables de entorno | 0 | `OPENROUTER_API_KEY` y `OPENAI_API_KEY` presentes y no son placeholders. |
| 2 | Hand-off contracts | 0 | `emitOutput` y `consumeInput` con `architect-output.schema.json`, más rechazo de outputs inválidos. |
| 3 | Memoria del proyecto | 0 | `writeProfile`, `addAgent`, `addDecision`, `addLesson`, `summarize` retornan conteos correctos. |
| 4 | Dashboard server | 0 | `startServer(0)` levanta en puerto libre, `/api/state` responde 200 con JSON válido. |
| 5 | Perplexity research | ~USD 0.002 | `research('quick', ...)` retorna content + al menos 1 cita con URL parseable. |
| 6 | gpt-image-2 | ~USD 0.04 | `python scripts/openai_images.py generate` produce un PNG real >10KB con magic bytes válidos. |
| 7 | Multimodal flow | 0 | `image-gen-output` schema acepta el PNG del check 6 (o un PNG mínimo en `--quick`). |
| 8 | Pipeline-v2 integration | 0 | `pipeline-v2-integration.test.js` corre como subprocess y termina con exit 0. |

## Output esperado en éxito

```
--- Smoke Test Mazelab Starter v3 ---

Aviso: el check 5 (Perplexity) puede tomar hasta 30 segundos.
Aviso: el check 6 (gpt-image-2) puede tomar hasta 60 segundos.

[1/8] Variables de entorno... OK (0.0s)
[2/8] Hand-off contracts cycle... OK (0.1s)
[3/8] Memoria del proyecto... OK (0.1s)
[4/8] Dashboard server up... OK (0.2s)
[5/8] Perplexity research... OK (3.4s)
[6/8] gpt-image-2 generación... OK (28.1s)
[7/8] Multimodal validation flow... OK (0.0s)
[8/8] Pipeline-v2 integration... OK (1.8s)

Sistema verde. 8 de 8 checks OK.
```

## Mensajes de error comunes y cómo arreglarlos

### `Falta archivo .env`
El smoke test no encuentra `.env` en la raíz del repo.
**Fix:** corre `npm run setup`. Eso crea `.env` interactivamente.

### `falta(n) variable(s) en .env: OPENAI_API_KEY`
La variable existe en `.env` pero está vacía o no aparece.
**Fix:** edita `.env` y rellena la key. Formato esperado: `OPENAI_API_KEY=sk-proj-...`

### `variable(s) con valor placeholder`
La key sigue siendo el texto de ejemplo (`sk-or-v1-pega-aqui-tu-key`).
**Fix:** reemplaza con tu key real de OpenRouter / OpenAI.

### `OpenRouter rechazó la key`
La key existe pero OpenRouter responde 401/403.
**Fix:** revisa que la key sea la actual en https://openrouter.ai/keys y que tenga saldo.

### `OPENAI_API_KEY inválida o expirada`
**Fix:** genera nueva key en https://platform.openai.com/api-keys, actualiza `.env`.

### `cuota OpenAI agotada o rate-limited`
**Fix:** verifica billing en https://platform.openai.com/account/billing. gpt-image-2 requiere tier con saldo.

### `no module named 'openai'`
Falta el venv de Python o las dependencias.
**Fix:** corre `npm run setup` (incluye crear venv + instalar `openai`).

### `pipeline-v2-integration.test.js exit=1`
Algo del repo cambió y rompió la integración. Corre el test directo para ver detalle:
```bash
node pipeline-v2-integration.test.js
```

### `timeout (Xms) en <check>`
Algún check tomó demasiado. Causa común: red lenta o API saturada. Reintenta o usa `--quick` para saltarlo.

## Cuándo correrlo

- **Antes de empezar un proyecto serio.** Una vez. Confirma que el sistema completo está verde.
- **Después de cambios al setup** (rotaste API keys, recreaste venv, actualizaste deps).
- **Después de actualizar dependencias** (`npm update` o cambios en `requirements.txt`).
- **Cuando algo se siente raro** y quieres descartar problema sistémico antes de debuggear código de proyecto.

No lo corras en cada commit — para eso están los tests específicos (`npm run test:contracts`, `npm run test:dashboard`, etc.). El smoke test gasta API credits reales.
