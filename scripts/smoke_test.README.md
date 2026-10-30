# Smoke test del starter v6

Un comando que en menos de 90 segundos te dice si las piezas principales funcionan (keys, memoria, research, imágenes). Pensado para correrse antes de empezar un proyecto serio, no para CI continuo.

## Cómo ejecutar

```bash
npm run smoke           # completo (~60-90s, gasta ~USD 0.05 en API credits)
npm run smoke:quick     # rápido (segundos, sin gastos de red)
node scripts/smoke_test.js --verbose   # detalle de cada check
node scripts/smoke_test.js --help      # ayuda
```

## Modos disponibles

| Modo | Tiempo | Costo | Cuándo usarlo |
|------|--------|-------|---------------|
| default | 60-90s | ~USD 0.05 | Antes de empezar proyecto serio. Una vez por sesión real. |
| `--quick` | segundos | USD 0 | Después de cambios al setup, para validar estructura. |
| `--verbose` | igual que arriba | igual | Cuando algo falla y necesitas ver detalle. |

## Qué chequea cada check

| # | Nombre | Costo | Lo que valida |
|---|--------|-------|---------------|
| 1 | Variables de entorno | 0 | `OPENROUTER_API_KEY` y `OPENAI_API_KEY` presentes y no son placeholders. |
| 2 | Memoria del proyecto | 0 | `writeProfile`, `addAgent`, `addDecision`, `addLesson`, `summarize` retornan conteos correctos. |
| 3 | Perplexity research | ~USD 0.002 | `research('quick', ...)` retorna content + al menos 1 fuente con URL parseable. |
| 4 | gpt-image-2 | ~USD 0.04 | `python scripts/openai_images.py generate` produce un PNG real >10KB con magic bytes válidos. |

## Output esperado en éxito

```
--- Smoke Test Mazelab Starter v6 ---

Aviso: el check 3 (Perplexity) puede tomar hasta 30 segundos.
Aviso: el check 4 (gpt-image-2) puede tomar hasta 60 segundos.

[1/4] Variables de entorno... OK (0.0s)
[2/4] Memoria del proyecto... OK (0.1s)
[3/4] Perplexity research... OK (3.4s)
[4/4] gpt-image-2 generación... OK (28.1s)

Sistema verde. 4 de 4 checks OK.
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

### `timeout (Xms) en <check>`
Algún check tomó demasiado. Causa común: red lenta o API saturada. Reintenta o usa `--quick` para saltarlo.

## Cuándo correrlo

- **Antes de empezar un proyecto serio.** Una vez. Confirma que el sistema completo está verde.
- **Después de cambios al setup** (rotaste API keys, recreaste venv, actualizaste deps).
- **Después de actualizar dependencias** (`npm update` o cambios en `requirements.txt`).
- **Cuando algo se siente raro** y quieres descartar problema sistémico antes de debuggear código de proyecto.

No lo corras en cada commit — para eso están los tests específicos (`npm test`). El smoke test gasta API credits reales.
