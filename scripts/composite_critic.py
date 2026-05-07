"""Composite del crítico flaco (PNG existente) sobre slides marcadas.

Lee image-jobs.json, busca jobs con needs_composite=true,
y aplica el overlay del PNG sobre la imagen base generada.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
JOBS_FILE = ROOT / "content" / "output" / "workshop2" / "image-jobs.json"
SLIDES_DIR = ROOT / "content" / "output" / "workshop2" / "slides"
COMPOSITES_DIR = ROOT / "content" / "output" / "workshop2" / "slides_composite"
COMPOSITES_DIR.mkdir(exist_ok=True)


def composite_overlay(base_path, overlay_path, output_path, scale=0.55, position="right"):
    """Compone el overlay PNG sobre la imagen base.

    scale: tamaño del overlay relativo al alto de la base (0.55 = 55% del alto).
    position: 'right' / 'left' / 'center' — dónde ubicar el personaje.
    """
    base = Image.open(base_path).convert("RGBA")
    overlay = Image.open(overlay_path).convert("RGBA")

    # Escalar overlay
    new_height = int(base.height * scale)
    aspect = overlay.width / overlay.height
    new_width = int(new_height * aspect)
    overlay_resized = overlay.resize((new_width, new_height), Image.LANCZOS)

    # Posicionar
    margin = int(base.width * 0.05)  # 5% margen
    if position == "right":
        x = base.width - new_width - margin
    elif position == "left":
        x = margin
    else:  # center
        x = (base.width - new_width) // 2
    y = base.height - new_height - margin  # ancla al piso de la imagen

    # Pegar con alpha
    base.paste(overlay_resized, (x, y), overlay_resized)

    # Guardar como PNG con alpha
    base.save(output_path, "PNG")
    return output_path


def main():
    jobs = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
    composite_jobs = [j for j in jobs if j.get("needs_composite")]
    print(f"Composite jobs: {len(composite_jobs)}")

    for job in composite_jobs:
        slide_id = job.get("slide_id", str(job.get("slide_number")))
        base_path = ROOT / job["output_path"]
        overlay_rel = job.get("composite_overlay")
        if not overlay_rel:
            print(f"[{slide_id}] SIN overlay declarado, saltando")
            continue
        overlay_path = ROOT / overlay_rel

        if not base_path.exists():
            print(f"[{slide_id}] FALTA base {base_path}")
            continue
        if not overlay_path.exists():
            print(f"[{slide_id}] FALTA overlay {overlay_path}")
            continue

        # Output: misma slide pero en slides_composite/
        out_path = COMPOSITES_DIR / base_path.name

        # Posición: por default derecha. Slide 53 quizás centro (es la slide del crítico aprobando).
        position = "right"
        scale = 0.55
        if slide_id in ("53",):
            position = "center"
            scale = 0.7  # más grande, momento héroe

        composite_overlay(base_path, overlay_path, out_path, scale=scale, position=position)
        print(f"[{slide_id}] OK: {out_path}")

    print(f"\nDone. Composites en: {COMPOSITES_DIR}")


if __name__ == "__main__":
    main()
