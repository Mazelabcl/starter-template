"""
replicate_images.py — wrapper Replicate parametrizado por modelo.

Un solo wrapper para dos modelos vía Replicate, con la MISMA firma pública que
scripts/openai_images.py para que la skill image-gen elija modelo sin cambiar el
patrón de uso:
    generate_image(prompt, output_path, size, ..., model="flux2-dev")
    edit_image(prompt, input_image_paths, output_path, ..., model="flux2-dev")

Modelos soportados (--model):
    flux2-dev       → black-forest-labs/flux-2-dev   (~$0.012/img, barato, acepta refs)
    ideogram-v3     → ideogram-ai/ideogram-v3-turbo  ($0.03, texto en imagen / diseño)
    nano-banana-pro → google/nano-banana-pro         (~$0.04/img, Nano Banana Pro vía
                      Replicate, hasta 14 refs, fuerte en consistencia de identidad)

Params de referencia VERIFICADOS (2026-06-02):
- FLUX.2 dev: refs vía input_image, input_image_2, input_image_3, ... (URLs o
  base64 data URIs). Confirmado en https://docs.bfl.ml/flux_2/flux2_image_editing
  y la collection de Replicate. La doc BFL documenta URLs explícitamente; Replicate
  acepta además data URIs base64 (convención estándar de file inputs de Replicate),
  que es lo que usamos para refs locales. Ver INCERTIDUMBRES si una variante rechaza
  el data URI.
- Ideogram v3: refs de estilo vía style_reference_images (lista, hasta 3 imágenes,
  JPEG/PNG/WebP, máx 10MB total). Confirmado en el schema de Replicate
  (https://replicate.com/ideogram-ai/ideogram-v3-turbo/api/schema, vía búsqueda).
  No combinar con style_type/style_hex.
- Nano Banana Pro (google/nano-banana-pro): refs vía image_input (ARRAY de URIs,
  hasta 14 imágenes). Verificado en el OpenAPI schema de Replicate
  (https://replicate.com/api/models/google/nano-banana-pro/versions,
  version 712e06a8e122fb7c8dae55dcf7ad6a8e717afb7b1c41c889fc8c5132fd42f374):
  input.image_input = {type: array, items: {type: string, format: uri}}.
  El formato uri acepta URLs públicas o data URIs base64 (convención de file
  inputs de Replicate), que es lo que usamos para refs locales. Output controlado
  por output_format (jpg|png) — forzamos png para coincidir con los .png que
  escribe el wrapper. resolution (1K|2K|4K, default 2K) y aspect_ratio
  (default match_input_image) quedan en sus defaults salvo override vía extra.

Uso:
    python scripts/replicate_images.py generate "un perro azul" out.png --model flux2-dev
    python scripts/replicate_images.py edit "Image 1: el perro. Hazlo rojo." in.png out.png --model flux2-dev

    from scripts.replicate_images import generate_image, edit_image

Requiere REPLICATE_API_TOKEN en .env / .env.local. Si falta, el wrapper falla
con un mensaje claro.
"""
import os, sys, time, base64, json, argparse, re
from pathlib import Path
import urllib.request
import urllib.error


def _load_env():
    """Carga .env y .env.local manualmente sin python-dotenv (mismo patrón que
    openai_images.py)."""
    root = Path(__file__).resolve().parent.parent
    for name in [".env", ".env.local"]:
        env_path = root / name
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k and v:
                        os.environ.setdefault(k, v)


_load_env()

# slug → ruta del modelo en Replicate. Sin versión pin: usamos el endpoint
# /models/{owner}/{name}/predictions que resuelve a la última versión oficial.
_MODELS = {
    "flux2-dev": "black-forest-labs/flux-2-dev",
    "ideogram-v3": "ideogram-ai/ideogram-v3-turbo",
    "nano-banana-pro": "google/nano-banana-pro",
}
DEFAULT_MODEL = "flux2-dev"
API_BASE = "https://api.replicate.com/v1"


def _token():
    tok = os.environ.get("REPLICATE_API_TOKEN")
    if not tok:
        raise RuntimeError(
            "Falta REPLICATE_API_TOKEN. Configúralo en .env:\n"
            "  REPLICATE_API_TOKEN=r8_...\n"
            "Sácalo en https://replicate.com/account/api-tokens"
        )
    return tok


# ── Reglas de referencia (idénticas a openai_images.py v4.1 / D12) ──────────
_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _mime_for(path):
    """Mimetype explícito por extensión. Para Replicate se usa al construir el
    data URI (data:image/webp;base64,...) — un mime incorrecto hace que el modelo
    ignore/rechace la ref (misma causa raíz que D12 en OpenAI)."""
    ext = os.path.splitext(path)[1].lower()
    return _MIME_BY_EXT.get(ext, "image/png")


def _assert_refs_mentioned(prompt, input_image_paths):
    """Guard mention-check (REGLA L3 / D12). Si hay refs cargadas pero el prompt
    no menciona 'Image 1', el modelo no sabe a qué ref te refieres. El concepto es
    el mismo aunque Replicate pase las refs por campos nombrados (input_image /
    style_reference_images) en lugar de un array crudo: el prompt debe seguir
    nombrando Image 1/2... para correlacionar texto y refs."""
    if input_image_paths and not re.search(r"Image\s*1", prompt, re.IGNORECASE):
        raise ValueError(
            "Refs cargadas pero el prompt no menciona 'Image 1'. "
            "Regla: cada Image N debe nombrarse en el prompt o el modelo la ignora."
        )


def _data_uri(path):
    """Convierte una ref local a data URI base64 con su mimetype. Replicate acepta
    URLs públicas o data URIs en sus file inputs; como las refs son locales (sin
    URL pública) usamos data URI. Lee binario y cierra el handle dentro del with."""
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f"data:{_mime_for(path)};base64,{data}"


def _build_input(model_slug, prompt, input_image_paths, size, extra=None):
    """Arma el dict `input` según el modelo. Aquí viven los nombres de param
    VERIFICADOS por modelo."""
    inp = {"prompt": prompt}
    if extra:
        inp.update(extra)

    if model_slug == "flux2-dev":
        # FLUX.2 dev: refs vía input_image, input_image_2, input_image_3, ...
        # (verificado en docs BFL). La primera es input_image; las siguientes
        # llevan sufijo numérico empezando en 2.
        for i, p in enumerate(input_image_paths):
            field = "input_image" if i == 0 else f"input_image_{i + 1}"
            inp[field] = _data_uri(p)
    elif model_slug == "ideogram-v3":
        # Ideogram v3: refs de estilo vía style_reference_images (lista, hasta 3).
        if input_image_paths:
            inp["style_reference_images"] = [_data_uri(p) for p in input_image_paths]
    elif model_slug == "nano-banana-pro":
        # Nano Banana Pro: refs vía image_input (ARRAY de URIs, hasta 14). El orden
        # del array = Image 1, Image 2, ... que el prompt debe nombrar (guard).
        if input_image_paths:
            inp["image_input"] = [_data_uri(p) for p in input_image_paths]
        # Forzar PNG: el wrapper escribe archivos .png; el default del modelo es jpg.
        inp.setdefault("output_format", "png")
    return inp


def _normalize_model(model):
    if model not in _MODELS:
        raise ValueError(
            f"Modelo desconocido '{model}'. Opciones: {', '.join(_MODELS)}"
        )
    return model


def _run_prediction(model, prompt, input_image_paths, size):
    """Crea una prediction en Replicate y hace polling hasta succeeded/failed.
    Devuelve la URL (o data URI) de la imagen de salida."""
    model = _normalize_model(model)
    slug = _MODELS[model]
    tok = _token()
    payload = {"input": _build_input(model, prompt, input_image_paths, size)}
    url = f"{API_BASE}/models/{slug}/predictions"
    headers = {
        "Authorization": f"Bearer {tok}",
        "Content-Type": "application/json",
        # Prefer: wait deja que Replicate bloquee hasta ~60s antes de responder,
        # reduciendo el polling. Si excede, caemos al loop de polling de abajo.
        "Prefer": "wait",
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            pred = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:800]
        raise RuntimeError(f"Replicate API error {e.code}: {detail}") from e

    pred = _poll_until_done(pred, tok)
    return _extract_output_url(pred)


def _poll_until_done(pred, tok, max_wait=300):
    """Si la prediction no terminó con Prefer:wait, hace polling al get_url."""
    deadline = time.time() + max_wait
    while pred.get("status") in ("starting", "processing"):
        if time.time() > deadline:
            raise RuntimeError("Replicate prediction timeout (>300s).")
        get_url = pred.get("urls", {}).get("get")
        if not get_url:
            break
        time.sleep(2)
        req = urllib.request.Request(get_url, headers={"Authorization": f"Bearer {tok}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            pred = json.loads(r.read().decode("utf-8"))
    if pred.get("status") != "succeeded":
        raise RuntimeError(
            f"Replicate prediction status={pred.get('status')}: {pred.get('error')}"
        )
    return pred


def _extract_output_url(pred):
    """La salida de Replicate es un string URL o una lista de URLs según el modelo."""
    out = pred.get("output")
    if isinstance(out, list):
        if not out:
            raise RuntimeError("Replicate devolvió output vacío.")
        return out[0]
    if isinstance(out, str):
        return out
    raise RuntimeError(f"Formato de output inesperado de Replicate: {type(out)}")


def _download(url_or_datauri, output_path):
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    if url_or_datauri.startswith("data:"):
        b64 = url_or_datauri.split(",", 1)[1]
        with open(output_path, "wb") as f:
            f.write(base64.b64decode(b64))
    else:
        with urllib.request.urlopen(url_or_datauri, timeout=120) as r:
            data = r.read()
        with open(output_path, "wb") as f:
            f.write(data)
    return output_path


def generate_image(prompt, output_path="output.png", size="1024x1024",
                   quality="medium", model=DEFAULT_MODEL):
    """Genera imagen desde texto (sin references).

    `size`/`quality` se aceptan por compatibilidad de firma con openai_images.py;
    no se mapean a params de Replicate (cada modelo gestiona aspect_ratio/resolution
    distinto — ver INCERTIDUMBRES)."""
    out = _run_prediction(model, prompt, [], size)
    return _download(out, output_path)


def edit_image(prompt, input_image_paths, output_path="edited.png", size="1024x1024",
              quality="medium", model=DEFAULT_MODEL):
    """Genera imagen con references. input_image_paths = lista de paths.
    Refs posicionales: orden del array = Image 1, Image 2, ..."""
    if isinstance(input_image_paths, str):
        input_image_paths = [input_image_paths]
    _assert_refs_mentioned(prompt, input_image_paths)
    out = _run_prediction(model, prompt, input_image_paths, size)
    return _download(out, output_path)


# ── CLI ────────────────────────────────────────────────────────────────
def _cli():
    p = argparse.ArgumentParser(
        description="Replicate wrapper (FLUX.2 dev / Ideogram v3 / Nano Banana Pro)")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="Genera imagen desde texto")
    g.add_argument("prompt")
    g.add_argument("output", nargs="?", default="output.png")
    g.add_argument("--size", default="1024x1024")
    g.add_argument("--model", default=DEFAULT_MODEL, choices=list(_MODELS))

    e = sub.add_parser("edit", help="Genera/edita con references")
    e.add_argument("prompt")
    e.add_argument("inputs", help="Path a imagen o JSON-array de paths")
    e.add_argument("output", nargs="?", default="edited.png")
    e.add_argument("--size", default="1024x1024")
    e.add_argument("--model", default=DEFAULT_MODEL, choices=list(_MODELS))

    args = p.parse_args()

    if args.cmd == "generate":
        path = generate_image(args.prompt, args.output, args.size, model=args.model)
        print(f"OK: {path}")
    elif args.cmd == "edit":
        try:
            inputs = json.loads(args.inputs)
            if not isinstance(inputs, list):
                inputs = [args.inputs]
        except Exception:
            inputs = [args.inputs]
        path = edit_image(args.prompt, inputs, args.output, args.size, model=args.model)
        print(f"OK: {path}")


if __name__ == "__main__":
    _cli()
