"""Thumbnails for PHOTOS, the second cache-control on /file, and the rules they share with a PDF's thumbnail (round 7, S1e stage 1, DECISIONS #138).

The Company Files list used to download every photo in full (12 photos, 6.36 MB) to draw 48 px previews. An image now has a thumbnail of about 400 px, served
by the same endpoint under EXACTLY the same access rules as a PDF's, cached in the same file (`<sha256>.jpg`, so purge already removes it). The server does
not downscale the upload itself; the browser already sends a 2000 px JPEG. Fake OCR only: nothing here can reach the gateway."""

# app.main first (it runs load_dotenv(), see tests/test_replay_mode.py).
from app.main import app

import io
import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from reportlab.pdfgen import canvas

import app.extract.ocr as ocr_module
import app.thumbnails as thumbnails
from app.activity import operator
from app.db import get_conn
from app.purge import purge_now

client = TestClient(app, raise_server_exceptions=False)
_seed = iter(range(1, 100_000))


@pytest.fixture(autouse=True)
def _private_thumbnail_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(thumbnails, "THUMBS_PATH", tmp_path / "thumbs")
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": "")   # a photo has no text; no OCR binary needed


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team():
    owner = client.post("/api/auth/dev-login", json={"email": "owner@thumb.test", "name": "Olivia Owner", "company_name": "Thumb Co", "fye_month": 12, "fye_day": 31}).json()
    company = owner["company"]["id"]
    out = {"owner": owner["token"], "company": company}
    for key, role in (("admin", "admin"), ("user", "user"), ("other", "user"), ("viewer", "viewer")):
        assert client.post(f"/api/companies/{company}/members", json={"email": f"{key}@thumb.test", "name": key.title(), "role": role}, headers=_h(owner["token"])).status_code == 200
        out[key] = client.post("/api/auth/dev-login", json={"email": f"{key}@thumb.test"}).json()["token"]
    stranger = client.post("/api/auth/dev-login", json={"email": "s@else.test", "company_name": "Else Co", "fye_month": 12, "fye_day": 31}).json()
    out["stranger"] = stranger["token"]
    return out


def _jpeg(size=(3000, 2000), orientation: int | None = None) -> bytes:
    rng = random.Random(next(_seed))
    image = Image.new("RGB", size, (rng.randint(60, 200), rng.randint(60, 200), rng.randint(60, 200)))
    for x in range(0, size[0], 97):
        image.putpixel((x, rng.randint(0, size[1] - 1)), (10, 10, 10))     # unique bytes: sha256 is unique per document
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=88, exif=exif)
    return buf.getvalue()


def _picture(token: str, data: bytes | None = None, filename="photo.jpg", **params) -> int:
    """Upload a photo; `params` are query parameters (visibility, and `name` for a personal file's own name)."""
    resp = client.post("/api/documents", params={"is_picture": "true", **params}, files={"file": (filename, data or _jpeg(), "image/jpeg")}, headers=_h(token))
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _row(doc_id: int) -> dict:
    with get_conn() as conn:
        return dict(conn.execute("SELECT * FROM document WHERE id = ?", (doc_id,)).fetchone())


def _thumb(token: str, doc_id: int):
    return client.get(f"/api/documents/{doc_id}/thumbnail", headers=_h(token))


def _size(content: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(content)).size


# ---------------------------------------------------------------- what the thumbnail is


def test_a_photo_thumbnail_is_a_jpeg_of_at_most_400_px_with_the_private_cache_header(team):
    doc = _picture(team["owner"])
    resp = _thumb(team["owner"], doc)
    assert resp.status_code == 200 and resp.headers["content-type"] == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=3600"
    assert max(_size(resp.content)) == 400 and Image.open(io.BytesIO(resp.content)).format == "JPEG"
    assert len(resp.content) < 60_000 < len(_jpeg())                        # a small fraction of the photo


def test_the_constants_are_separate_and_the_pdf_size_is_unchanged():
    assert thumbnails.IMAGE_THUMB_MAX_SIDE == 400 and thumbnails.THUMB_MAX_SIDE == 320


def test_a_small_photo_is_never_enlarged(team):
    resp = _thumb(team["owner"], _picture(team["owner"], _jpeg((200, 120))))
    assert _size(resp.content) == (200, 120)


def test_the_orientation_flag_is_applied_so_a_sideways_phone_photo_is_upright(team):
    landscape_flagged_portrait = _jpeg((3000, 2000), orientation=6)          # stored 3000x2000, displayed rotated: 2000x3000
    size = _size(_thumb(team["owner"], _picture(team["owner"], landscape_flagged_portrait)).content)
    assert size[1] > size[0] and max(size) == 400                            # taller than wide, not sideways


def test_a_png_and_a_grey_image_also_get_a_jpeg_thumbnail(team):
    buf = io.BytesIO()
    Image.new("L", (1200, 900), 128).save(buf, format="PNG")
    resp = client.post("/api/documents", params={"is_picture": "true"}, files={"file": ("scan.png", buf.getvalue(), "image/png")}, headers=_h(team["owner"]))
    thumb = _thumb(team["owner"], resp.json()["document_id"])
    assert thumb.status_code == 200 and Image.open(io.BytesIO(thumb.content)).mode == "RGB"


# ---------------------------------------------------------------- the cache


def test_the_second_request_is_served_from_the_cache_file_and_makes_nothing(team, monkeypatch):
    doc = _picture(team["owner"])
    made = []
    real = thumbnails._render_image
    monkeypatch.setattr(thumbnails, "_render_image", lambda *a: made.append(a) or real(*a))
    first, second = _thumb(team["owner"], doc), _thumb(team["owner"], doc)
    assert first.content == second.content and len(made) == 1
    assert (thumbnails.THUMBS_PATH / f"{_row(doc)['sha256']}.jpg").is_file()  # the same cache file a PDF thumbnail uses


def test_a_corrupt_image_is_a_404_and_is_not_cached(team):
    doc = _picture(team["owner"])
    Path(_row(doc)["stored_path"]).write_bytes(b"this is not an image at all")
    assert _thumb(team["owner"], doc).status_code == 404
    assert not (thumbnails.THUMBS_PATH / f"{_row(doc)['sha256']}.jpg").exists()


def test_a_missing_stored_file_is_a_404(team):
    doc = _picture(team["owner"])
    Path(_row(doc)["stored_path"]).unlink()
    assert _thumb(team["owner"], doc).status_code == 404


def test_a_type_that_is_neither_a_pdf_nor_an_image_is_a_404(team):
    resp = client.post("/api/documents", params={"visibility": "only_me", "name": "note"}, files={"file": ("note.txt", b"just words", "text/plain")}, headers=_h(team["owner"]))
    assert _thumb(team["owner"], resp.json()["document_id"]).status_code == 404


def test_a_pdf_thumbnail_is_unchanged_at_320(team):
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, f"TAX INVOICE {next(_seed)}")
    c.save()
    doc = client.post("/api/documents", params={"visibility": "only_me", "name": "invoice"}, files={"file": ("invoice.pdf", buf.getvalue(), "application/pdf")}, headers=_h(team["owner"])).json()["document_id"]
    thumb = _thumb(team["owner"], doc)
    assert thumb.status_code == 200 and max(_size(thumb.content)) <= 320


# ---------------------------------------------------------------- who may have one: exactly the rules of the file itself


def test_a_personal_photos_thumbnail_is_its_uploaders_alone(team):
    doc = _picture(team["user"], visibility="only_me", name="my photo")
    assert _thumb(team["user"], doc).status_code == 200
    for other in ("owner", "admin", "other", "viewer"):
        assert _thumb(team[other], doc).status_code == 404, other            # not even an admin or the owner


def test_another_companys_user_gets_404_and_so_does_an_archived_document(team):
    doc = _picture(team["owner"])
    assert _thumb(team["stranger"], doc).status_code == 404
    assert client.post(f"/api/documents/{doc}/archive", headers=_h(team["owner"])).status_code == 200
    assert _thumb(team["owner"], doc).status_code == 404


def test_a_pending_photo_is_visible_to_its_uploader_and_admins_but_not_a_colleague_or_a_viewer(team):
    doc = _picture(team["user"])
    assert _row(doc)["status"] == "needs_review"
    assert _thumb(team["user"], doc).status_code == 200 and _thumb(team["admin"], doc).status_code == 200
    assert _thumb(team["other"], doc).status_code == 404 and _thumb(team["viewer"], doc).status_code == 404


def test_a_purge_requested_photo_keeps_its_thumbnail_for_the_owner_only(team):
    doc = _picture(team["user"])
    assert client.post(f"/api/documents/{doc}/request-purge", headers=_h(team["owner"])).status_code == 200
    assert _thumb(team["owner"], doc).status_code == 200                      # the owner still sees it, marked, until the team removes it
    for other in ("admin", "user", "viewer"):
        assert _thumb(team[other], doc).status_code == 404, other


def test_the_same_rules_hold_for_a_pdf_and_a_photo_side_by_side(team):
    """One rule, two types: a colleague's pending PDF and a colleague's pending photo are answered alike."""
    photo = _picture(team["user"])
    assert [_thumb(team[k], photo).status_code for k in ("user", "admin", "other", "viewer", "stranger")] == [200, 200, 404, 404, 404]


# ---------------------------------------------------------------- purge, and the file's own cache header


def test_purge_removes_the_photos_thumbnail_and_its_file(team):
    doc = _picture(team["owner"])
    assert _thumb(team["owner"], doc).status_code == 200
    row = _row(doc)
    cache = thumbnails.THUMBS_PATH / f"{row['sha256']}.jpg"
    assert cache.is_file() and Path(row["stored_path"]).is_file()
    assert purge_now(doc, actor=operator("test-operator")) == []
    assert not cache.exists() and not Path(row["stored_path"]).exists()


def test_the_file_endpoint_carries_the_private_cache_header_and_keeps_its_validators(team):
    doc = _picture(team["owner"])
    resp = client.get(f"/api/documents/{doc}/file", headers=_h(team["owner"]))
    assert resp.status_code == 200 and resp.headers["cache-control"] == "private, max-age=3600"
    assert resp.headers.get("etag") and resp.headers.get("last-modified")     # unchanged
    assert client.get(f"/api/documents/{doc}/file", headers=_h(team["stranger"])).status_code == 404   # the file's own rule is unchanged


def test_a_failed_thumbnail_is_never_an_exception(monkeypatch, tmp_path):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"\xff\xd8\xff garbage")
    assert thumbnails.get_image_thumbnail("a" * 64, str(bad)) is None
    assert thumbnails.get_image_thumbnail("a" * 64, str(tmp_path / "missing.jpg")) is None
