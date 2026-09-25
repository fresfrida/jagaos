"""One lock for every PDF page render in this process (2026-09-25, round 20, DECISIONS #97).

PDFium, which pdfplumber's `page.to_image` renders through (via pypdfium2), is not thread-safe.
Reproduced in isolation: two threads rendering different PDFs at the same time abort the whole
interpreter (exit code 134), with no Python traceback, while one at a time (or any number behind a
lock) is fine. This API runs its sync endpoints and its ingest pipeline in a thread pool, so two things
that render can genuinely overlap: the OCR of a scanned upload (app/extract/ocr.py) and a thumbnail
request (app/thumbnails.py). Both take this lock around the render itself, and nothing else, so the
slow parts (OCR, JPEG encoding, disk) still run in parallel.

Anything new that renders a PDF page in this process must hold it too.
"""

import threading

PDFIUM_LOCK = threading.Lock()
