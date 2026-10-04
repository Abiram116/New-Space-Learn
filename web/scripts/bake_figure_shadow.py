"""Draws the landing figure's shadow into a picture, once.

The landing page used to cast the shadow in the browser, with two
`filter: drop-shadow(...)` on the figure while it slides into place. Safari
draws that wrong — a hard-edged dark rectangle behind the figure — so the
shadow is now an image of its own, laid behind the figure and moved with it.
No filter, so nothing for a browser to get wrong, and the same pixels
everywhere.

Reads  public/student-reading.webp
Writes public/student-reading-shadow.webp   (the shadow only, on a padded canvas)
Prints the padding as fractions of the figure's box: those four numbers are
what `Landing.tsx` positions the shadow with (`FIGURE_SHADOW`).

The two shadows are the ones the CSS had — (0 10px 14px, .35) then
(0 30px 46px, .45), the second cast by the figure plus the first — measured at
the size the figure is shown (~650px tall) and scaled to this file's size.

    cd api && uv run --with pillow --with numpy python ../web/scripts/bake_figure_shadow.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PUBLIC = Path(__file__).resolve().parents[1] / "public"

#: How big the baked shadow is, against the figure's own file. It is blurry, so
#: a quarter of the size loses nothing and keeps the file small.
SCALE = 0.25
#: The figure is shown about 650px tall; its file is 2000px.
DISPLAY_TO_FILE = (0.25 * 2000) / 650
#: (offset down, blur radius, opacity) in CSS pixels, in the order they stack.
SHADOWS = ((10, 14, 0.35), (30, 46, 0.45))


def blurred(alpha: np.ndarray, down: float, sigma: float, opacity: float) -> np.ndarray:
    """The shadow `alpha` casts: moved down, blurred, faded."""
    moved = np.zeros_like(alpha)
    d = int(round(down))
    moved[d:] = alpha[: alpha.shape[0] - d] if d else alpha
    img = Image.fromarray((moved * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
    return np.asarray(img, dtype=np.float32) / 255 * opacity


def main() -> None:
    figure = Image.open(PUBLIC / "student-reading.webp").convert("RGBA")
    w, h = round(figure.width * SCALE), round(figure.height * SCALE)
    alpha = np.asarray(figure.getchannel("A").resize((w, h), Image.LANCZOS), dtype=np.float32) / 255

    biggest_blur, biggest_drop = SHADOWS[-1][1], SHADOWS[-1][0]
    sigma_of = lambda blur: blur / 2 * DISPLAY_TO_FILE  # CSS: sigma is half the blur radius
    side = int(np.ceil(3 * sigma_of(biggest_blur)))
    top = max(0, side - int(round(biggest_drop * DISPLAY_TO_FILE)))
    below = side + int(round(biggest_drop * DISPLAY_TO_FILE))  # worked out, then cut off: the floor hides it

    canvas = np.zeros((top + h + below, side + w + side), dtype=np.float32)
    canvas[top : top + h, side : side + w] = alpha

    cast = np.zeros_like(canvas)
    source = canvas
    for drop, blur, opacity in SHADOWS:
        shadow = blurred(source, drop * DISPLAY_TO_FILE, sigma_of(blur), opacity)
        cast = 1 - (1 - cast) * (1 - shadow)
        source = 1 - (1 - source) * (1 - shadow)  # the next shadow is cast by figure + this one

    cast = cast[: top + h]  # nothing under the floor
    out = np.zeros((*cast.shape, 4), dtype=np.uint8)
    out[..., 3] = np.clip(cast * 255, 0, 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(PUBLIC / "student-reading-shadow.webp", lossless=False, quality=80, alpha_quality=85, method=6)

    size = (PUBLIC / "student-reading-shadow.webp").stat().st_size
    print(f"wrote student-reading-shadow.webp  {out.shape[1]}x{out.shape[0]}  {size / 1024:.0f} KB")
    print(f"padding as a fraction of the figure's box:  left/right {side / w:.4f}  top {top / h:.4f}")
    print(f"width {(w + 2 * side) / w:.4f}  height {(top + h) / h:.4f}")


if __name__ == "__main__":
    main()
