"""
gpt-image-2 wrapper.

Uso:
    # CLI rápido:
    python scripts/openai_images.py generate "un perro azul" output.png
    python scripts/openai_images.py edit "haz el perro rojo" input.png output.png

    # Importar desde otro script Python:
    from scripts.openai_images import generate_image, edit_image, generate_batch_async
"""
import os, sys, base64, asyncio, json, argparse, re
from pathlib import Path

try:
    from openai import OpenAI, AsyncOpenAI
except ImportError:
    print("❌ Falta dependencia 'openai' en el venv de Python.")
    print("   Causa probable: no corriste el setup de Python todavía.")
    print("   Corre: npm run setup-python   (o `npm run setup` para el flow completo)")
    print("   Si ya tienes .venv creado, activalo y corre: pip install -r requirements.txt")
    sys.exit(1)


def _load_env():
    """Carga .env y .env.local manualmente sin python-dotenv."""
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

MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
FALLBACK_MODEL = "gpt-image-2-2026-04-21"
DEFAULT_CONCURRENCY = int(os.environ.get("OPENAI_IMAGE_CONCURRENCY", "8"))


def _client():
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Falta OPENAI_API_KEY. Corre: npm run setup")
    return OpenAI(api_key=key)


def _async_client():
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Falta OPENAI_API_KEY. Corre: npm run setup")
    return AsyncOpenAI(api_key=key)


def _save_b64(b64_data: str, output_path: str):
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(base64.b64decode(b64_data))


# Mapeo extensión → mimetype. Causa raíz del bug de refs: la SDK de OpenAI, al
# recibir un file handle crudo (open(p,"rb")), infiere el mimetype del nombre y
# rechaza SILENCIOSAMENTE formatos como .webp/.jpg → la ref nunca llega al modelo
# y éste "describe" en vez de usar la imagen real. Pasar file tuples
# (basename, fileobj, mimetype) explícitos lo arregla.
_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _mime_for(path):
    ext = os.path.splitext(path)[1].lower()
    return _MIME_BY_EXT.get(ext, "image/png")


def _assert_refs_mentioned(prompt, input_image_paths):
    """Guard mention-check (REGLA L3). Si hay refs cargadas pero el prompt no
    menciona 'Image 1', el modelo las ignora — convertimos esa disciplina en un
    guardrail real en vez de solo prosa en la skill."""
    if input_image_paths and not re.search(r"Image\s*1", prompt, re.IGNORECASE):
        raise ValueError(
            "Refs cargadas pero el prompt no menciona 'Image 1'. "
            "Regla: cada Image N debe nombrarse en el prompt o el modelo la ignora."
        )


def _open_file_tuples(input_image_paths):
    """Abre cada ref como file tuple (basename, fileobj, mimetype). El caller es
    responsable de cerrar los file handles (devueltos en la posición [1])."""
    return [
        (os.path.basename(p), open(p, "rb"), _mime_for(p))
        for p in input_image_paths
    ]


def generate_image(prompt, output_path="output.png", size="1024x1024", quality="medium"):
    """Genera imagen desde texto (sin references)."""
    client = _client()
    try:
        result = client.images.generate(model=MODEL, prompt=prompt, size=size, quality=quality)
    except Exception as e:
        if "model_not_found" in str(e):
            result = client.images.generate(model=FALLBACK_MODEL, prompt=prompt, size=size, quality=quality)
        else:
            raise
    _save_b64(result.data[0].b64_json, output_path)
    return output_path


def edit_image(prompt, input_image_paths, output_path="edited.png", size="1024x1024", quality="medium"):
    """Edita/genera imagen con references. input_image_paths = lista de paths."""
    client = _client()
    if isinstance(input_image_paths, str):
        input_image_paths = [input_image_paths]
    _assert_refs_mentioned(prompt, input_image_paths)
    file_tuples = _open_file_tuples(input_image_paths)
    try:
        image_arg = file_tuples if len(file_tuples) > 1 else file_tuples[0]
        try:
            result = client.images.edit(
                model=MODEL,
                image=image_arg,
                prompt=prompt, size=size, quality=quality
            )
        except Exception as e:
            if "model_not_found" in str(e):
                for _, f, _m in file_tuples: f.seek(0)
                result = client.images.edit(
                    model=FALLBACK_MODEL,
                    image=image_arg,
                    prompt=prompt, size=size, quality=quality
                )
            else:
                raise
    finally:
        for _, f, _m in file_tuples: f.close()
    _save_b64(result.data[0].b64_json, output_path)
    return output_path


async def _edit_async(client_async, prompt, input_image_paths, output_path, size, quality):
    if isinstance(input_image_paths, str):
        input_image_paths = [input_image_paths]
    if input_image_paths:
        _assert_refs_mentioned(prompt, input_image_paths)
        file_tuples = _open_file_tuples(input_image_paths)
        try:
            result = await client_async.images.edit(
                model=MODEL,
                image=file_tuples if len(file_tuples) > 1 else file_tuples[0],
                prompt=prompt, size=size, quality=quality
            )
        finally:
            for _, f, _m in file_tuples: f.close()
    else:
        result = await client_async.images.generate(model=MODEL, prompt=prompt, size=size, quality=quality)
    _save_b64(result.data[0].b64_json, output_path)
    return output_path


async def generate_batch_async(jobs, max_concurrent=None):
    """
    Procesa N jobs en paralelo. CADA job es independiente (no depende del anterior).
    jobs = lista de dicts: {prompt, output_path, input_image_paths?, size?, quality?}
    max_concurrent: si None, usa OPENAI_IMAGE_CONCURRENCY del env (default 8).
                    Subir a 15-20 en tiers altos de OpenAI; bajar si hay rate limits.
    """
    if max_concurrent is None:
        max_concurrent = DEFAULT_CONCURRENCY
    client_async = _async_client()
    sem = asyncio.Semaphore(max_concurrent)

    async def with_sem(j):
        async with sem:
            return await _edit_async(
                client_async,
                prompt=j["prompt"],
                input_image_paths=j.get("input_image_paths", []),
                output_path=j["output_path"],
                size=j.get("size", "1024x1024"),
                quality=j.get("quality", "medium"),
            )

    return await asyncio.gather(*[with_sem(j) for j in jobs], return_exceptions=True)


def run_batch(jobs, max_concurrent=None):
    """Wrapper sync para correr generate_batch_async desde código sync."""
    return asyncio.run(generate_batch_async(jobs, max_concurrent))


# ── CLI ────────────────────────────────────────────────────────────────
def _cli():
    p = argparse.ArgumentParser(description="gpt-image-2 wrapper")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="Genera imagen desde texto")
    g.add_argument("prompt")
    g.add_argument("output", nargs="?", default="output.png")
    g.add_argument("--size", default="1024x1024")
    g.add_argument("--quality", default="medium", choices=["low", "medium", "high"])

    e = sub.add_parser("edit", help="Edita/genera con references")
    e.add_argument("prompt")
    e.add_argument("inputs", help="Path a imagen o JSON-array de paths")
    e.add_argument("output", nargs="?", default="edited.png")
    e.add_argument("--size", default="1024x1024")
    e.add_argument("--quality", default="medium", choices=["low", "medium", "high"])

    b = sub.add_parser("batch", help="Batch paralelo desde JSON file")
    b.add_argument("jobs_json", help="Path a JSON con array de jobs")
    b.add_argument("--concurrent", type=int, default=None)

    args = p.parse_args()

    if args.cmd == "generate":
        path = generate_image(args.prompt, args.output, args.size, args.quality)
        print(f"OK: {path}")
    elif args.cmd == "edit":
        try:
            inputs = json.loads(args.inputs)
            if not isinstance(inputs, list): inputs = [args.inputs]
        except Exception:
            inputs = [args.inputs]
        path = edit_image(args.prompt, inputs, args.output, args.size, args.quality)
        print(f"OK: {path}")
    elif args.cmd == "batch":
        jobs = json.loads(Path(args.jobs_json).read_text(encoding="utf-8"))
        results = run_batch(jobs, args.concurrent)
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                print(f"[{i}] FALLO: {r}")
            else:
                print(f"[{i}] OK: {r}")


if __name__ == "__main__":
    _cli()
