"""The web client's page cap must equal the backend's (2026-09-24, round 12,
DECISIONS #78). The backend's is app/extract/ocr.py's MAX_PDF_OCR_PAGES — the
number of pages its OCR reads and the most POST /api/documents/pages accepts.
The client keeps its own copy (web/src/features/upload/uploadSelection.ts) so
it can refuse a longer set before uploading; if the two drift, either the UI
offers a set the server rejects or it refuses one the server would take.
Same guard, same reason, as tests/test_buckets.py.
"""

import re
from pathlib import Path

from app.extract.ocr import MAX_PDF_OCR_PAGES

FRONTEND = Path(__file__).parent.parent / "web" / "src" / "features" / "upload" / "uploadSelection.ts"


def test_the_web_clients_page_cap_matches_the_backends():
    match = re.search(r"export const MAX_PAGES = (\d+)", FRONTEND.read_text())
    assert match, "MAX_PAGES is no longer declared in uploadSelection.ts"
    assert int(match.group(1)) == MAX_PDF_OCR_PAGES
