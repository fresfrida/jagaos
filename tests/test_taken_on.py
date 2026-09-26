"""`taken_on` on POST /api/documents (round 7, S1e, DECISIONS #138): a picture's date-taken, read by the browser from the ORIGINAL photo's EXIF (which its
re-encoding drops) and sent along. The server uses it only for a company picture and only when its own EXIF read of the uploaded file found nothing; anything
invalid is ignored, never a 400. Fake OCR only: nothing here reaches the gateway."""

# app.main first (it runs load_dotenv(), see tests/test_replay_mode.py).
from app.main import app

import io
import random
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.extract.ocr as ocr_module
from app.db import get_conn
from app.extract.exif import TAKEN_ON_EARLIEST, valid_taken_on

client = TestClient(app, raise_server_exceptions=False)
_seed = iter(range(1, 100_000))
TODAY = datetime.now(timezone.utc).date()


@pytest.fixture(autouse=True)
def _no_ocr(monkeypatch):
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": "")


@pytest.fixture
def token():
    return client.post("/api/auth/dev-login", json={"email": "owner@taken.test", "company_name": "Taken Co", "fye_month": 12, "fye_day": 31}).json()["token"]


def _jpeg(exif_date: str | None = None) -> bytes:
    rng = random.Random(next(_seed))
    image = Image.new("RGB", (400, 300), (rng.randint(50, 200), rng.randint(50, 200), rng.randint(50, 200)))
    image.putpixel((rng.randint(0, 399), rng.randint(0, 299)), (5, 5, 5))          # unique bytes
    exif = Image.Exif()
    if exif_date:
        exif.get_ifd(0x8769)[0x9003] = exif_date                                     # DateTimeOriginal
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85, exif=exif)
    return buf.getvalue()


def _upload(token: str, data: bytes | None = None, **params):
    return client.post("/api/documents", params=params, files={"file": ("photo.jpg", data or _jpeg(), "image/jpeg")}, headers={"Authorization": f"Bearer {token}"})


def _occurred(doc_id: int) -> str | None:
    with get_conn() as conn:
        return conn.execute("SELECT occurred_on FROM document WHERE id = ?", (doc_id,)).fetchone()["occurred_on"]


# ---------------------------------------------------------------- the validator on its own


def test_the_validator_accepts_a_real_day_between_1990_and_tomorrow_inclusive():
    t = date(2026, 9, 27)
    assert valid_taken_on("2026-09-27", t) == "2026-09-27"
    assert valid_taken_on("2026-09-28", t) == "2026-09-28"       # tomorrow UTC: a photo taken today somewhere ahead of us
    assert valid_taken_on("2026-09-29", t) is None               # the day after tomorrow
    assert valid_taken_on("1990-01-01", t) == "1990-01-01" and TAKEN_ON_EARLIEST == date(1990, 1, 1)
    assert valid_taken_on("1989-12-31", t) is None


@pytest.mark.parametrize("raw", [None, "", " ", "abc", "2026-02-30", "2026-13-01", "2026-00-10", "20260101", "2026-9-1", "26-09-01", " 2026-09-01", "2026-09-01\n",
                                 "2026-09-01T10:00:00", "2026/09/01", "9999-12-31", "0001-01-01", "2026-09-01; DROP TABLE document", "２０２６-09-01"])
def test_the_validator_returns_none_for_anything_else_and_never_raises(raw):
    assert valid_taken_on(raw, date(2026, 9, 27)) is None


# ---------------------------------------------------------------- the upload


def test_a_picture_with_no_exif_takes_the_browsers_date_as_its_occurred_on(token):
    resp = _upload(token, is_picture="true", taken_on="2024-02-05")
    assert resp.status_code == 200 and _occurred(resp.json()["document_id"]) == "2024-02-05"


def test_the_servers_own_exif_wins_over_the_browsers_date(token):
    resp = _upload(token, _jpeg("2019:08:08 10:15:00"), is_picture="true", taken_on="2020-01-01")
    assert resp.status_code == 200 and _occurred(resp.json()["document_id"]) == "2019-08-08"


def test_a_picture_with_no_exif_and_no_taken_on_keeps_occurred_on_empty(token):
    resp = _upload(token, is_picture="true")
    assert resp.status_code == 200 and _occurred(resp.json()["document_id"]) is None     # deliberate: "the photo says" and "we guessed" are never mixed


@pytest.mark.parametrize("bad", ["abc", "2026-02-30", "1989-12-31", "20260101", "2026-9-1", "", "2026-13-40", "9999-12-31", "2026-05-01T10:00", "'; --"])
def test_a_malformed_or_out_of_range_value_is_ignored_and_the_upload_still_succeeds(token, bad):
    resp = _upload(token, is_picture="true", taken_on=bad)
    assert resp.status_code == 200 and _occurred(resp.json()["document_id"]) is None


def test_a_future_date_is_ignored_but_tomorrow_is_accepted(token):
    future = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    a = _upload(token, is_picture="true", taken_on=future)
    b = _upload(token, is_picture="true", taken_on=tomorrow)
    assert a.status_code == b.status_code == 200
    assert _occurred(a.json()["document_id"]) is None and _occurred(b.json()["document_id"]) == tomorrow


def test_a_non_picture_ignores_it(token):
    resp = _upload(token, is_picture="false", taken_on="2024-02-05")
    assert resp.status_code == 200 and _occurred(resp.json()["document_id"]) is None


def test_a_personal_file_ignores_it_by_decision(token):
    resp = _upload(token, visibility="only_me", name="My photo", is_picture="true", taken_on="2024-02-05")
    assert resp.status_code == 200 and _occurred(resp.json()["document_id"]) is None


def test_a_duplicate_upload_is_unchanged_and_the_original_date_is_kept(token):
    data = _jpeg()
    first = _upload(token, data, is_picture="true", taken_on="2024-02-05")
    again = _upload(token, data, is_picture="true", taken_on="2025-05-05")
    assert again.status_code == 200 and again.json()["status"] == "duplicate" and again.json()["document_id"] == first.json()["document_id"]
    assert _occurred(first.json()["document_id"]) == "2024-02-05"


def test_the_upload_without_the_parameter_is_exactly_as_before(token):
    with_exif = _upload(token, _jpeg("2023:12:15 09:00:00"), is_picture="true")
    assert _occurred(with_exif.json()["document_id"]) == "2023-12-15"


def test_no_value_ever_makes_the_upload_a_400(token):
    for raw in ("abc", "2026-02-30", "9999-12-31", "", "%00", "2026-09-01" * 50):
        assert _upload(token, is_picture="true", taken_on=raw).status_code == 200, raw
