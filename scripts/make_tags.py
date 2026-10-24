"""Make a printable PDF of every ArUco tag in the arena, labeled.

    python scripts/make_tags.py            # writes tags.pdf
    python scripts/make_tags.py --mm 60    # bigger tags

Print at 100% scale (no "fit to page"). Needs opencv-contrib-python and reportlab.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engram.vision.overhead import DICTIONARY  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arena", default=str(ROOT / "fixtures/lab/arena.json"))
    ap.add_argument("--mm", type=float, default=50.0, help="tag width in millimeters")
    ap.add_argument("--out", default="tags.pdf")
    args = ap.parse_args()

    import cv2
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    arena = json.loads(Path(args.arena).read_text())
    items = [(o["tag"], o["name"], "object") for o in arena["objects"]]
    items += [(int(k), v.replace("_", " "), "zone") for k, v in arena["zone_tags"].items()]
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DICTIONARY))

    tmp = Path(tempfile.mkdtemp())
    pdf = canvas.Canvas(args.out, pagesize=letter)
    page_w, page_h = letter
    # The black square is args.mm wide; the white margin around it adds a quarter on each side.
    size = args.mm * mm * 500 / 400
    cell_w, cell_h = size + 20 * mm, size + 22 * mm
    cols = max(1, int((page_w - 20 * mm) // cell_w))
    rows = max(1, int((page_h - 30 * mm) // cell_h))
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(10 * mm, page_h - 12 * mm, f"ENGRAM tags ({DICTIONARY}, {args.mm:.0f} mm). Print at 100% scale.")
    for n, (tag, label, kind) in enumerate(items):
        if n and n % (cols * rows) == 0:
            pdf.showPage()
        slot = n % (cols * rows)
        x = 10 * mm + (slot % cols) * cell_w + 5 * mm
        y = page_h - 22 * mm - (slot // cols + 1) * cell_h + 14 * mm
        png = tmp / f"{tag}.png"
        # The white border around the black square is required for detection.
        img = cv2.aruco.generateImageMarker(dictionary, tag, 400)
        img = cv2.copyMakeBorder(img, 50, 50, 50, 50, cv2.BORDER_CONSTANT, value=255)
        cv2.imwrite(str(png), img)
        pdf.drawImage(str(png), x, y, size, size)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(x, y - 6 * mm, f"{label}")
        pdf.setFont("Helvetica", 9)
        pdf.drawString(x, y - 11 * mm, f"{kind} tag {tag}")
    pdf.save()
    print(f"wrote {args.out} with {len(items)} tags")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
