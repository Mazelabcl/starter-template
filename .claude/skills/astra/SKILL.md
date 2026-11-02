---
name: astra
description: Generate images through Astra (OpenAI Codex installed on this PC) using the ChatGPT plan quota, fully automatic via src/astra.js (no API key, no human copy-paste). Triggers "pídele a Astra", "genera con Astra", "imágenes con el plan de ChatGPT", "/astra", or any image batch where cost matters more than speed.
allowed-tools: Read, Write, Bash, Glob
---

# astra — automatic image bridge to Codex

`src/astra.js` writes a request to `astra-bridge/pedidos/<id>.json`, runs `codex exec` non-interactively, validates the PNGs and writes `astra-bridge/resultados/<id>.json`. No human in the loop.

## Astra vs image-gen (API): which one

| Situation | Use |
|---|---|
| Batches, storyboards, variants, drafts; cost matters | **astra** (plan quota, USD 0 extra) |
| Many images in parallel, deadline in minutes | **image-gen** (API, parallel, ~USD 0.04+ each) |
| Strict API features: exact size/quality params, masks/inpainting, transparent background, deterministic batch | **image-gen** |
| Strict identity lock with several refs that must be honored exactly | try astra with `--refs`; if it drifts twice, switch to image-gen |
| `estado` says not installed / no session / quota exhausted | **image-gen** (and tell the user the fix) |

Astra is ~30-60 s per image and effectively sequential (one ChatGPT account). Max `--n 4` per request, `--concurrencia` ≤ 2 recommended (3 hard cap).

## Steps

1. Check once per session: `node src/astra.js estado`. If it fails, show the user the `Cómo arreglarlo` line verbatim and stop (or fall back to image-gen if they agree).
2. Write the prompt in English, concrete (subject, style, light, composition). If you pass refs, name them in the prompt as `Image 1`, `Image 2`... in the same order as `--refs` (starter rule 4).
3. Run one request (Bash timeout ≥ 700000 ms):
   ```
   node src/astra.js pedir --prompt "..." --out assets/astra/<slug>/ [--n 2] [--size 16:9] [--refs a.png,b.png] [--evitar "text, frames"]
   ```
   Several requests: write a JSON array (same keys: prompt, out, n, size, refs, intencion, evitar, id) and run `node src/astra.js lote <file.json>`. For long batches use `run_in_background`.
4. Read `astra-bridge/resultados/<id>.json`: `estado` is `ok`, `parcial` or `error`; `archivos` lists the PNGs; `error` explains failures (timeout, refusal "NO-PUDE", quota).
5. **Always Read every PNG** (multimodal) before calling it done (skill multimodal-validation). If it does not match, re-run with a corrected prompt; the bridge never overwrites, it creates `_v2`.

## Rules

- Never edit `~/.codex/config.toml`, never run `codex login`/`logout` yourself: only show the command to the user.
- Never print the content of `~/.codex/auth.json`.
- Do not call Codex in tests: inject `execCodex` and `status` (see `astra.test.js`).
- On `usage limit` / quota errors, do not retry in a loop: report and propose image-gen.

## Messages to the user (Spanish, verbatim templates)

Respond with:
- Success: `Listo: Astra generó <N> imagen(es) en <S> s → <rutas>. Ya las revisé.`
- Not installed: `Astra no está disponible: Codex no está instalado. Instala la app Codex desde Microsoft Store o corre en PowerShell: npm i -g @openai/codex`
- No session: `Astra necesita que inicies sesión una vez. En una terminal PowerShell nueva corre: <comando de estado>  (abre el navegador; entra con tu cuenta de ChatGPT)`
- Quota: `Se agotó la cuota de imágenes del plan de ChatGPT. Puedo seguir con la API (image-gen, ~USD 0.04 por imagen) si me das el sí.`
