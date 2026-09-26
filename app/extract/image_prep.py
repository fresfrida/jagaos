"""Authoritative server-side image preprocessing (round 6, DECISIONS #129).

The web client already downscales a photo to 2000px at JPEG quality 0.85 before it uploads (web/src/lib/imageNormalize.ts), but
that only covers the browser: a direct API call, a future Telegram or email channel, and every page of a multi-page upload arrive
at whatever size the sender chose (a 12 megapixel phone photo is ordinary). The server therefore normalizes on its own, and
does not rely on the client having done it.

WHAT IS NORMALIZED, AND WHAT IS NOT. Only a WORKING DERIVATIVE, the copy Tesseract reads: EXIF orientation applied, the longest
edge cut to MAX_EDGE (never enlarged), re-encoded as a JPEG at JPEG_QUALITY. The uploaded file itself, its sha256 (the duplicate
check), its stored copy and the download served from it are exactly what the person sent; the derivative is a temporary file,
removed as soon as the OCR pass that needed it has finished (`working_copy` below). Nothing here decides what the paid model sees:
the gateway is text-only and never receives an image at all (MDs/GAPS.md §8); this bounds the local OCR pass, the one place
pixels are read.
"""

from __future__ import annotations

import logging
import os
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from PIL import Image, ImageOps

# The longest edge, in pixels, of what OCR reads, and the JPEG quality of the derivative. Approximate targets from the round's own
# brief ("about 1500px, about quality 80"), kept as named constants so the numbers are one edit, not a hunt.
MAX_EDGE = 1500
JPEG_QUALITY = 80

# Same logger the rest of the backend writes its service-journal lines to (main.py's `_audit`).
_log = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class PrepReport:
    """What preprocessing did, as numbers only (never pixels or text), for the logs and for tests."""

    width_before: int
    height_before: int
    width_after: int
    height_after: int
    bytes_before: int | None
    bytes_after: int | None

    @property
    def resized(self) -> bool:
        return (self.width_after, self.height_after) != (self.width_before, self.height_before)


def _flatten_to_rgb(image: Image.Image) -> Image.Image:
    """A JPEG has no alpha: a transparent PNG is composited onto white (what a scan of paper would be), not onto black."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.getchannel("A"))
        return canvas
    return image.convert("RGB")


def normalize_image(image: Image.Image, max_edge: int = MAX_EDGE) -> Image.Image:
    """EXIF orientation applied FIRST (the resize is of the upright picture), flattened to RGB, then the longest edge cut to
    `max_edge` if and only if it is longer: an image already within the limit comes back the same size, never enlarged."""
    upright = ImageOps.exif_transpose(image) or image
    rgb = _flatten_to_rgb(upright)
    longest = max(rgb.size)
    if longest <= max_edge:
        return rgb
    scale = max_edge / longest
    size = (max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale)))
    return rgb.resize(size, Image.LANCZOS)


def prepare_working_copy(source: str, destination: str, max_edge: int = MAX_EDGE, quality: int = JPEG_QUALITY) -> PrepReport:
    """Write the normalized derivative of the image at `source` to `destination` (a JPEG) and say what changed."""
    with Image.open(source) as original:
        # "Before" is the UPRIGHT size: a portrait photo stored as landscape pixels plus a rotation flag is a portrait picture.
        upright_size = (ImageOps.exif_transpose(original) or original).size
        prepared = normalize_image(original, max_edge)
        prepared.save(destination, format="JPEG", quality=quality)
    return PrepReport(
        width_before=upright_size[0], height_before=upright_size[1],
        width_after=prepared.size[0], height_after=prepared.size[1],
        bytes_before=os.path.getsize(source), bytes_after=os.path.getsize(destination),
    )


@contextmanager
def working_copy(source: str, max_edge: int = MAX_EDGE, quality: int = JPEG_QUALITY) -> Iterator[str]:
    """Yield the path of a normalized temporary derivative of `source`, and delete it on the way out, however the block ends.
    Logs one line of numbers (dimensions and encoded sizes before and after) so a slow or noisy OCR pass can be correlated with the
    picture it read."""
    handle, path = tempfile.mkstemp(prefix="jaga-ocr-", suffix=".jpg")
    os.close(handle)
    try:
        report = prepare_working_copy(source, path, max_edge, quality)
        _log.info(
            "IMAGE_PREP size_before=%sx%s size_after=%sx%s bytes_before=%s bytes_after=%s resized=%s",
            report.width_before, report.height_before, report.width_after, report.height_after,
            report.bytes_before, report.bytes_after, report.resized,
        )
        yield path
    finally:
        Path(path).unlink(missing_ok=True)
