"""EXIF date/GPS for memory photos. GAPS.md §8: no auto-captioning
available on the gateway — a photo with no OCR-able text gets a one-line
caption from the sender instead (asked for by app/graph/ingest.py), not
guessed here."""

from datetime import datetime

from PIL import ExifTags, Image


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
