"""Derive every logo file from the one master, web/src/assets/logo-mark.png (2026-09-25, DECISIONS #114).

    python scripts/make_logo_assets.py

The master is the mark as supplied: a 500x500 PNG, a black rounded square with a white and sage shape, on an OPAQUE WHITE
background with some compression noise at its edges. Left as it is, a favicon would show a white box in a dark browser tab, and a
28px logo would download 127KB. So this script leaves the master alone and writes, from it:

    web/src/assets/logo-mark-112.png   the mark in the header and footer (sections use components/ui/Logo.tsx): 28px, sharp at 4x
    web/public/icon-32.png             the browser tab
    web/public/icon-192.png            the PWA manifest and the larger tab icon
    web/public/icon-512.png            the PWA manifest (Chrome wants one of 512)
    web/public/apple-touch-icon.png    iOS home screen: opaque, full bleed, because iOS rounds the corners itself

Every derivative has TRANSPARENT corners (except the Apple one): the white outside the rounded square is found by flood fill from the
four corners and removed, and the anti-aliased edge is turned into real alpha, so the square sits cleanly on any background. The
master also carries a stray 2px solid-black column down its right edge (an export artefact, separated from the mark by white): only
the part connected to the centre of the mark is kept, and the result is cropped tight to the square so the icon fills its box.
Pillow only. Re-run it if the master is replaced (a clean export of the mark, ideally vector or a transparent PNG, would be better
than this one: see docs/KANBAN.md).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
MASTER = REPO / "web" / "src" / "assets" / "logo-mark.png"
BLACK = 11  # the mark's own black (the centre pixel of the master), so edge pixels can be recoloured to it
OUTSIDE = 235  # a corner-connected pixel at least this bright is background, not the mark
BAND = 3  # how many pixels in from the background the anti-aliased edge can reach


def with_transparent_corners(master: Image.Image) -> Image.Image:
    rgba = master.convert("RGBA")
    w, h = rgba.size
    lum = rgba.convert("L").load()

    outside = bytearray(w * h)
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        if 0 <= x < w and 0 <= y < h and not outside[y * w + x] and lum[x, y] >= OUTSIDE:
            outside[y * w + x] = 1
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    if not outside[0]:
        raise SystemExit("The master's corner is not a bright background: this script expects the mark on a white square.")

    # Keep only what is connected to the centre of the mark (the square, with the white and sage shape inside it): a stray
    # non-white column at the edge, separated from it by background, is not part of the artwork.
    keep = bytearray(w * h)
    stack = [(w // 2, h // 2)]
    while stack:
        x, y = stack.pop()
        if 0 <= x < w and 0 <= y < h and not keep[y * w + x] and not outside[y * w + x]:
            keep[y * w + x] = 1
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    for i in range(w * h):
        if not keep[i]:
            outside[i] = 1

    pixels = rgba.load()
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if outside[i]:
                pixels[x, y] = (BLACK, BLACK, BLACK, 0)
                continue
            # An edge pixel is a blend of the mark's black and the white behind it: its alpha is how much black is in it.
            near = any(
                0 <= x + dx < w and 0 <= y + dy < h and outside[(y + dy) * w + x + dx]
                for dx in range(-BAND, BAND + 1) for dy in range(-BAND, BAND + 1)
            )
            if near:
                alpha = max(0.0, min(1.0, (255 - lum[x, y]) / (255 - BLACK)))
                pixels[x, y] = (BLACK, BLACK, BLACK, round(alpha * 255))
    # Crop tight to the square (padded to a true square, transparent), so the icon fills its box instead of floating in a margin.
    left, top, right, bottom = rgba.getchannel("A").getbbox()
    side = max(right - left, bottom - top)
    tight = Image.new("RGBA", (side, side), (BLACK, BLACK, BLACK, 0))
    tight.paste(rgba.crop((left, top, right, bottom)), ((side - (right - left)) // 2, (side - (bottom - top)) // 2))
    return tight


def resized(image: Image.Image, size: int) -> Image.Image:
    # Through premultiplied alpha, so the transparent edge does not pick up a dark or light halo.
    return image.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


def main() -> int:
    if not MASTER.exists():
        raise SystemExit(f"No master at {MASTER}")
    mark = with_transparent_corners(Image.open(MASTER))
    out = {
        REPO / "web" / "src" / "assets" / "logo-mark-112.png": resized(mark, 112),
        REPO / "web" / "public" / "icon-32.png": resized(mark, 32),
        REPO / "web" / "public" / "icon-192.png": resized(mark, 192),
        REPO / "web" / "public" / "icon-512.png": resized(mark, 512),
    }
    for path, image in out.items():
        image.save(path, optimize=True)
    apple = Image.new("RGBA", (180, 180), (BLACK, BLACK, BLACK, 255))
    apple.alpha_composite(resized(mark, 180))
    apple.convert("RGB").save(REPO / "web" / "public" / "apple-touch-icon.png", optimize=True)

    for path in [*out, REPO / "web" / "public" / "apple-touch-icon.png"]:
        print(f"{path.relative_to(REPO)!s:<44} {Image.open(path).size}  {path.stat().st_size / 1024:6.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
