"""Merge ordered page images into one PDF (2026-09-24, round 12, DECISIONS
#78) — the "several photos of one document" upload.

The merged file is an ordinary image-only PDF, so it goes through the SAME
ingest path as any scanned PDF (app/graph/ingest.py -> ocr.extract_pdf_text);
there is no second extraction route for multi-page. Pillow alone writes it
(`save_all=True`), so no new dependency.
"""

import time
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.extract.ocr import PDF_OCR_DPI


_FIXED_STAMP = time.gmtime(0)


class PageImageError(Exception):
    """One of the page files could not be read as an image. `page` is
    1-based, in the order the pages were given."""

    def __init__(self, page: int):
        super().__init__(f"page {page} is not a readable image")
        self.page = page


def merge_images_to_pdf(image_paths: list[str], out_path: str) -> int:
    """Write `image_paths`, in order, as the pages of one PDF at `out_path`;
    returns the page count.

    Each page is EXIF-transposed first (a phone photo often stores its
    rotation as a flag, and Pillow does not apply it on its own) and flattened
    to RGB, since a PDF page cannot carry every mode a PNG can. The page is
    written at ocr.PDF_OCR_DPI so that rasterizing it for OCR at that same
    resolution hands Tesseract the original pixels back, not a resampled copy.

    Raises PageImageError for a file Pillow cannot decode."""
    pages: list[Image.Image] = []
    try:
        for number, path in enumerate(image_paths, start=1):
            try:
                with Image.open(Path(path)) as img:
                    page = (ImageOps.exif_transpose(img) or img).convert("RGB")
                    page.load()
            except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
                raise PageImageError(number) from None
            pages.append(page)
        # Fixed title and dates: Pillow stamps "now" and the output file's own
        # (random temp) name into the PDF by default, so the same photos merged
        # twice would hash differently and the duplicate check in ingest
        # (document.sha256) could never recognise a re-upload of the same set.
        pages[0].save(
            out_path, format="PDF", save_all=True, append_images=pages[1:], resolution=float(PDF_OCR_DPI),
            title="Scan", creationDate=_FIXED_STAMP, modDate=_FIXED_STAMP,
        )
        return len(pages)
    finally:
        for page in pages:
            page.close()
