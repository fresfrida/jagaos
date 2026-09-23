"""Tesseract OCR for scans and photos of printed documents. GAPS.md §8."""

import pytesseract
from PIL import Image, ImageOps


def extract_text(path: str) -> str:
    image = Image.open(path)
    # EXIF-rotation correction (2026-09-23, live regression report) —
    # PIL does NOT auto-rotate on EXIF Orientation the way a browser's
    # <img>/createImageBitmap() does; a portrait phone photo commonly
    # stores landscape pixels plus a rotation flag, and feeding that
    # straight to Tesseract produces near-unusable OCR. Confirmed live
    # with a synthetic EXIF-rotated invoice image before shipping this:
    # unfixed, 44 chars of garbage ('gz\n&\n2 2 $ 8g...'); with
    # exif_transpose(), 126 chars of genuinely readable text (vendor,
    # invoice no, date, amounts). `or image` covers the (documented but
    # essentially never hit for a real photo) case where the function
    # returns None.
    #
    # This mainly protects upload paths that bypass the frontend's own
    # normalization (direct API calls, a future Telegram/email source
    # channel — see `document.source_channel`) — `web/src/lib/
    # imageNormalize.ts`'s docstring states `createImageBitmap()` already
    # applies EXIF-orientation correction by default in every shipping
    # browser, so a real upload through the actual web UI should already
    # arrive with upright pixels and nothing for this to correct. If a
    # live regression persists after this fix for a *web-uploaded* photo,
    # the more likely explanation is the separate, already-known, already-
    # deferred gap this file's own history flags — no deskew/crop/quality
    # preprocessing at all (`docs/KANBAN.md` Backlog) — not EXIF rotation.
    image = ImageOps.exif_transpose(image) or image
    # --psm 6 ("assume a single uniform block of text") — the default PSM 3
    # ("fully automatic" page segmentation) was confirmed live to silently
    # drop a right-aligned numeric table column on a real invoice (labels
    # like "Sub Total" came through, their values did not). Verified
    # against the actual stored image, no regression on the rest of that
    # document's OCR output (2026-09-22).
    return pytesseract.image_to_string(image, config="--psm 6").strip()
