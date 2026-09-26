"""EXIF date/GPS for memory photos. GAPS.md §8: no auto-captioning
available on the gateway — a photo with no OCR-able text gets a one-line
caption from the sender instead (asked for by app/graph/ingest.py), not
guessed here."""

import re
from datetime import date, datetime, timedelta, timezone

from PIL import ExifTags, Image

TAKEN_ON_EARLIEST = date(1990, 1, 1)
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def read_exif(path: str) -> dict:
    image = Image.open(path)
    raw = image._getexif() if hasattr(image, "_getexif") else None
    if not raw:
        return {}
    tags = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}
    out: dict = {}
    for key in ("DateTimeOriginal", "DateTime"):
        if key in tags:
            try:
                out["occurred_on"] = datetime.strptime(
                    tags[key], "%Y:%m:%d %H:%M:%S"
                ).date().isoformat()
                break
            except ValueError:
                continue
    gps = tags.get("GPSInfo")
    if gps:
        out["gps"] = gps
    return out


def valid_taken_on(raw: str | None, today: date | None = None) -> str | None:
    """The date-taken a browser read from a photo's EXIF and sent along (round 7, S1e, DECISIONS #138), or None. Strictly YYYY-MM-DD, a real calendar day,
    not before 1990-01-01 and not after TOMORROW (UTC, so a photo taken today anywhere on Earth is accepted). Anything else (malformed, out of range,
    in the future, empty) is None: the caller IGNORES it, it is never an error. The server's own EXIF read always wins over it (ingest.py)."""
    if not raw or not isinstance(raw, str) or not _DAY.match(raw):
        return None
    try:
        day = date.fromisoformat(raw)
    except ValueError:
        return None
    latest = (today or datetime.now(timezone.utc).date()) + timedelta(days=1)
    return day.isoformat() if TAKEN_ON_EARLIEST <= day <= latest else None
