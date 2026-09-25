"""First-page thumbnails of PDFs (2026-09-25, round 20, item 5).

WHEN: lazily, on the first request for one (GET /api/documents/{id}/thumbnail), not at
ingest. Nothing in the upload pipeline changes, an existing document needs no backfill,
and a document nobody looks at costs nothing.

HOW: the same call the OCR step already makes for a scanned PDF
(pdfplumber's `page.to_image`, which renders through pypdfium2), first page only, at 72 dpi,
scaled to fit THUMB_MAX_SIDE and saved as a JPEG.

WHERE: a file cache, THUMBS_PATH (JAGA_THUMBS_PATH, default ./data/thumbnails, next to the
stored documents in ./data/docs), one file per document CONTENT: `<sha256>.jpg`. Stored files
are named by the same hash (ingest.py) and a hash is unique across the database, so a
thumbnail can never be stale and never belongs to two documents. It is written to a temp file
and renamed into place, so a reader never sees half of one and two racing renders are harmless.
It is derived data of a document that may be a personal file, so whoever deletes the document's
stored file (scripts/purge_document.py, scripts/reset_demo_data.py) deletes this too:
remove_thumbnail().

BOUNDS: one render at a time in the whole process. PDFium is not thread-safe (two renders at once
abort the interpreter, reproduced in isolation), so the render holds the lock the OCR step also
holds (app/extract/pdfium_lock.py). A page list asks for many thumbnails together; they queue,
each takes tens of milliseconds, and JPEG encoding and disk writes happen outside the lock.
Any failure to render (a corrupt or password-protected PDF, no pages) is None, never an exception,
so the caller answers 404 and the page keeps its generic icon. A failure is not cached; the next
request tries once more.

WHO MAY SEE ONE is decided by the endpoint, with the rule that guards the file itself.
"""

import logging
import os
import threading
from pathlib import Path

import pdfplumber

from app.extract.pdfium_lock import PDFIUM_LOCK

logger = logging.getLogger(__name__)

THUMBS_PATH = Path(os.environ.get("JAGA_THUMBS_PATH", "./data/thumbnails"))
THUMB_MAX_SIDE = 320
JPEG_QUALITY = 80
RENDER_DPI = 72


def thumbnail_path(sha256: str) -> Path:
    """Where the thumbnail for content `sha256` lives (whether or not it exists yet). The hash
    is our own (hex digest of the stored bytes), never a client's string, but it is checked
    anyway: a path built from anything else must not leave THUMBS_PATH."""
    if not sha256 or not all(c in "0123456789abcdef" for c in sha256.lower()):
        raise ValueError("not a sha256 hex digest")
    return THUMBS_PATH / f"{sha256.lower()}.jpg"


def _render(pdf_path: str, destination: Path) -> bool:
    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages:
            return False
        with PDFIUM_LOCK:  # PDFium is not thread-safe (pdfium_lock.py); only the render itself is held
            if destination.is_file():  # another request finished it while this one waited its turn
                return True
            image = pdf.pages[0].to_image(resolution=RENDER_DPI).original
    image = image.convert("RGB")
    image.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE))
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_name(f"{destination.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        image.save(temp, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    return True


def get_pdf_thumbnail(sha256: str, pdf_path: str) -> Path | None:
    """The cached thumbnail for this PDF, rendering it first if there is none. None when the
    PDF cannot be rendered."""
    destination = thumbnail_path(sha256)
    if destination.is_file():
        return destination
    try:
        return destination if _render(pdf_path, destination) else None
    except Exception:  # a corrupt, encrypted or otherwise unreadable PDF: no thumbnail, not a 500
        logger.warning("could not render a thumbnail for %s", pdf_path, exc_info=True)
        return None


def remove_thumbnail(sha256: str) -> bool:
    """Delete this content's thumbnail if there is one. True if a file was removed."""
    try:
        path = thumbnail_path(sha256)
    except ValueError:
        return False
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
