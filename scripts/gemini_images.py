"""
gemini_images.py — wrapper Nano Banana Pro (Gemini 3 Pro Image).

MISMA firma pública que scripts/openai_images.py para que la skill image-gen
elija modelo sin cambiar el patrón de uso:
    generate_image(prompt, output_path, size, ...)         # text-to-image
    edit_image(prompt, input_image_paths, output_path, ...) # con references

Modelo de imagen: gemini-3-pro-image (Nano Banana Pro). Refs fuertes — soporta
hasta 14 imágenes de referencia (hasta 6 de objetos + hasta 5 de personajes,
según docs). Verificado en https://ai.google.dev/gemini-api/docs/image-generation
(2026-06-02): endpoint generateContent, refs como inline_data {mime_type, data}
en contents[].parts[], generationConfig.responseModalities=["TEXT","IMAGE"],
imagen de salida en parts[].inline_data.data (base64).

Uso:
    # CLI rápido:
    python scripts/gemini_images.py generate "un perro azul" output.png
    python scripts/gemini_images.py edit "Image 1: el perro. Hazlo rojo." input.png output.png

    # Importar desde otro script Python:
    from scripts.gemini_images import generate_image, edit_image

Requiere GEMINI_API_KEY o GOOGLE_API_KEY en .env / .env.local. Si falta, el
wrapper falla con un mensaje claro de cómo configurarla.
"""
import os, sys, base64, json, argparse, re
from pathlib import Path

# Usamos REST puro vía urllib (stdlib) para no exigir el SDK google-genai.
# Si el repo agrega google-genai al requirements.txt más adelante, este wrapper
# sigue funcionando igual — REST es el contrato estable.
import urllib.request
import urllib.error


def _load_env():
    """Carga .env y .env.local manualmente sin python-dotenv (mismo patrón que
    openai_images.py para mantener un solo mecanismo de carga en el repo)."""
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

# Verificado en docs Gemini (2026-06-02): el modelo de imagen actual es
# gemini-3-pro-image (Nano Banana Pro). Override por env si Google renombra.
MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3-pro-image")
API_BASE = "https://generativelanguage.googleapis.com/v1/models"


def _api_key():
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError(
            "Falta GEMINI_API_KEY (o GOOGLE_API_KEY). Configúrala en .env:\n"
            "  GEMINI_API_KEY=tu-key\n"
            "Sácala en https://aistudio.google.com/apikey"
        )
    return key


# ── Reglas de referencia (idénticas a openai_images.py v4.1 / D12) ──────────
_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _mime_for(path):
    """Mimetype explícito por extensión. Mismo motivo que en openai_images.py:
    pasar el mime correcto evita que la API rechace/ignore silenciosamente la
    ref (.webp/.jpg). Para Gemini el mime va dentro de inline_data.mime_type."""
    ext = os.path.splitext(path)[1].lower()
    return _MIME_BY_EXT.get(ext, "image/png")


def _assert_refs_mentioned(prompt, input_image_paths):
    """Guard mention-check (REGLA L3 / D12). Si hay refs cargadas pero el prompt
    no menciona 'Image 1', el modelo no sabe a qué ref te refieres — convertimos
    esa disciplina en un guardrail real. Aplica a Gemini igual que a OpenAI: las
    refs viajan como inline_data en orden, y el prompt debe nombrarlas Image 1/2..."""
    if input_image_paths and not re.search(r"Image\s*1", prompt, re.IGNORECASE):
        raise ValueError(
            "Refs cargadas pero el prompt no menciona 'Image 1'. "
            "Regla: cada Image N debe nombrarse en el prompt o el modelo la ignora."
        )


def _inline_parts(input_image_paths):
    """Lee cada ref como inline_data base64 con su mimetype. Lee binario y cierra
    el handle dentro del with (try/finally implícito) — no quedan handles abiertos."""
    parts = []
    for p in input_image_paths:
        with open(p, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        parts.append({"inline_data": {"mime_type": _mime_for(p), "data": data}})
    return parts


def _save_b64(b64_data: str, output_path: str):
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(base64.b64decode(b64_data))


def _extract_image_b64(resp_json):
    """Extrae el primer inline_data.data (base64) de la respuesta generateContent.
    La API usa snake_case (inline_data) o camelCase (inlineData) según versión —
    toleramos ambos."""
    for cand in resp_json.get("candidates", []):
        content = cand.get("content", {})
        for part in content.get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if inline and inline.get("data"):
                return inline["data"]
    raise RuntimeError(
        "La respuesta de Gemini no contenía imagen (parts[].inline_data.data vacío). "
        f"Respuesta cruda: {json.dumps(resp_json)[:800]}"
    )


def _post(prompt, input_image_paths):
    """Construye contents[].parts[] = [{text}, {inline_data}...] y llama
    generateContent. Refs en orden = Image 1, Image 2, ... (posicional, igual
    que la regla de oro de openai_images.py)."""
    key = _api_key()
    parts = [{"text": prompt}]
    parts.extend(_inline_parts(input_image_paths))
    payload = {
        "contents": [{"parts": parts}],
        # responseModalities verificado en docs: pide explícitamente IMAGE en la salida.
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    url = f"{API_BASE}/{MODEL}:generateContent?key={key}"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp_json = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:800]
        raise RuntimeError(f"Gemini API error {e.code}: {detail}") from e
    return _extract_image_b64(resp_json)


def generate_image(prompt, output_path="output.png", size="1024x1024", quality="medium"):
    """Genera imagen desde texto (sin references).

    `size` y `quality` se aceptan por compatibilidad de firma con openai_images.py.
    Gemini gestiona la resolución internamente — no se mapean a params de la API
    (la doc no expone un campo de tamaño equivalente; ver INCERTIDUMBRES)."""
    b64 = _post(prompt, [])
    _save_b64(b64, output_path)
    return output_path


def edit_image(prompt, input_image_paths, output_path="edited.png", size="1024x1024", quality="medium"):
    """Genera imagen con references (refs fuertes — fortaleza de Nano Banana Pro).
    input_image_paths = lista de paths. Refs posicionales: orden del array =
    Image 1, Image 2, ..."""
    if isinstance(input_image_paths, str):
        input_image_paths = [input_image_paths]
    _assert_refs_mentioned(prompt, input_image_paths)
    b64 = _post(prompt, input_image_paths)
    _save_b64(b64, output_path)
    return output_path


# ── CLI ────────────────────────────────────────────────────────────────
def _cli():
    p = argparse.ArgumentParser(description="Nano Banana Pro (gemini-3-pro-image) wrapper")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="Genera imagen desde texto")
    g.add_argument("prompt")
    g.add_argument("output", nargs="?", default="output.png")
    g.add_argument("--size", default="1024x1024")
    g.add_argument("--quality", default="medium", choices=["low", "medium", "high"])

    e = sub.add_parser("edit", help="Genera/edita con references")
    e.add_argument("prompt")
    e.add_argument("inputs", help="Path a imagen o JSON-array de paths")
    e.add_argument("output", nargs="?", default="edited.png")
    e.add_argument("--size", default="1024x1024")
    e.add_argument("--quality", default="medium", choices=["low", "medium", "high"])

    args = p.parse_args()

    if args.cmd == "generate":
        path = generate_image(args.prompt, args.output, args.size, args.quality)
        print(f"OK: {path}")
    elif args.cmd == "edit":
        try:
            inputs = json.loads(args.inputs)
            if not isinstance(inputs, list):
                inputs = [args.inputs]
        except Exception:
            inputs = [args.inputs]
        path = edit_image(args.prompt, inputs, args.output, args.size, args.quality)
        print(f"OK: {path}")


if __name__ == "__main__":
    _cli()
