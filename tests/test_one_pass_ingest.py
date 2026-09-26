"""The photo lifecycle invariant (round 6, DECISIONS #129), proved with call spies rather than asserted in a comment:

  * an image (or each page of a multi-page upload) is read by the OCR engine AT MOST ONCE, at ingest;
  * its text is persisted once, in `document.extracted_text`;
  * every later paid call (classify, extract) is built from that persisted text and only that;
  * no paid call ever carries an image, base64, an image URL or the stored file.

The paid boundary is replaced one level below `app.llm.call`, at the OpenAI client, so the REAL `call()` runs and what the gateway
would have been sent is captured exactly. Tesseract itself is replaced by a counting stub, so the test needs no OCR binary and
no gateway key.
"""

import io
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from openai.types import CompletionUsage
from PIL import Image

import app.extract.ocr as ocr_module
import app.llm as llm
from app.db import get_conn
from app.guards.injection import untrusted_prompt
from app.main import app

client = TestClient(app, raise_server_exceptions=False)
DOCS = Path(os.environ["JAGA_DOCS_PATH"])

OCR_TEXT = "HARBOURLIGHT SUPPLY\nInvoice INV-77120\nSubtotal 4000.00\nGST 360.00\nTOTAL DUE 4360.00"

CLASSIFY = {
    "lane": "invoice", "doc_type": "invoice", "confidence": 0.95, "injection_suspected": False, "bucket": "Expenses",
    "vendor_name": "Harbourlight Supply", "description": "Invoice from Harbourlight Supply", "description_en": "Invoice from Harbourlight Supply",
}


def _prov(value):
    return {"value": value, "confidence": 0.95, "page": 1}


EXTRACT = {
    "vendor": _prov("Harbourlight Supply"), "invoice_no": _prov("INV-77120"), "issued_on": _prov("2026-09-12"),
    "subtotal": _prov(4000.0), "tax": _prov(360.0), "currency": _prov("SGD"), "total": _prov(4360.0),
}


class _Gateway:
    """What the OpenAI client would have been: records every request and answers each tool call."""

    def __init__(self):
        self.requests: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        name = (kwargs.get("tool_choice") or {}).get("function", {}).get("name") or kwargs["tools"][0]["function"]["name"]
        args = CLASSIFY if name == "classify_document" else EXTRACT if name.startswith("extract_") else {"events": []}
        call = SimpleNamespace(model_dump=lambda: {"id": "1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}})
        message = SimpleNamespace(content="", tool_calls=[call])
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=CompletionUsage(prompt_tokens=100, completion_tokens=10, total_tokens=110))


@pytest.fixture
def gateway(monkeypatch) -> _Gateway:
    gw = _Gateway()
    monkeypatch.setattr(llm, "_client", lambda: gw)
    return gw


@pytest.fixture
def ocr_reads(monkeypatch) -> list[tuple[int, int]]:
    """Counts every OCR pass (one entry per image handed to Tesseract, with its pixel size) and returns canned text."""
    reads: list[tuple[int, int]] = []

    def fake_image_to_string(image, config=""):
        reads.append(image.size)
        return OCR_TEXT

    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", fake_image_to_string)
    return reads


def _token(email: str) -> str:
    resp = client.post("/api/auth/dev-login", json={"email": email, "company_name": "One Pass Co", "fye_month": 12, "fye_day": 31})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _jpeg(size=(4000, 3000), seed=0) -> bytes:
    image = Image.new("RGB", size, (240 - seed, 238, 230))
    for x in range(0, size[0], 50):
        image.putpixel((x, 100 + seed), (20, 20, 20))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _upload(token: str, data: bytes, name="photo.jpg"):
    return client.post("/api/documents", files={"file": (name, data, "image/jpeg")}, headers={"Authorization": f"Bearer {token}"})


def _stored_text(document_id: int) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT extracted_text FROM document WHERE id = ?", (document_id,)).fetchone()["extracted_text"]


def _every_message_is_plain_text(gw: _Gateway) -> None:
    for request in gw.requests:
        for message in request["messages"]:
            assert isinstance(message["content"], str)  # never a list of blocks (no image block can exist in a string)
        blob = json.dumps(request).lower()
        for forbidden in ("image_url", "data:image", "base64", "\"image\"", ".jpg", "/data/docs", "jaga-ocr"):
            assert forbidden not in blob, forbidden


def test_a_single_photo_is_read_by_ocr_exactly_once_and_the_paid_calls_never_see_pixels(gateway, ocr_reads):
    token = _token("onepass-a@example.com")
    resp = _upload(token, _jpeg())
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]

    assert len(ocr_reads) == 1, "the image must be decoded and OCR'd once, at ingest, and never again"
    assert max(ocr_reads[0]) == 1500  # and what was read was the normalized working copy, not the 4000px original
    assert _stored_text(document_id) == OCR_TEXT  # persisted once
    assert len(gateway.requests) >= 2  # classify and extract both ran
    _every_message_is_plain_text(gateway)


def test_every_paid_call_is_built_from_the_persisted_text_and_only_that(gateway, ocr_reads):
    token = _token("onepass-b@example.com")
    document_id = _upload(token, _jpeg()).json()["document_id"]
    persisted = _stored_text(document_id)
    for request in gateway.requests:
        user = next(m["content"] for m in request["messages"] if m["role"] == "user")
        assert user == untrusted_prompt(persisted)
    assert len(ocr_reads) == 1  # producing all of those prompts cost no further OCR


def test_the_uploaded_file_is_stored_exactly_as_sent_and_no_temporary_copy_is_left_behind(gateway, ocr_reads):
    import glob
    import tempfile
    data = _jpeg()
    token = _token("onepass-c@example.com")
    before = set(glob.glob(os.path.join(tempfile.gettempdir(), "jaga-ocr-*")))
    document_id = _upload(token, data).json()["document_id"]
    with get_conn() as conn:
        row = conn.execute("SELECT stored_path, sha256, bytes FROM document WHERE id = ?", (document_id,)).fetchone()
    import hashlib
    assert hashlib.sha256(data).hexdigest() == row["sha256"] and row["bytes"] == len(data)
    assert Path(row["stored_path"]).read_bytes() == data  # the evidence is the upload, not the 1500px derivative
    assert set(glob.glob(os.path.join(tempfile.gettempdir(), "jaga-ocr-*"))) == before


def test_uploading_the_same_photo_again_reads_nothing_and_asks_the_model_nothing(gateway, ocr_reads):
    token = _token("onepass-d@example.com")
    data = _jpeg(seed=3)
    _upload(token, data)
    reads, requests = len(ocr_reads), len(gateway.requests)
    again = _upload(token, data)
    assert again.json()["status"] == "duplicate"
    assert (len(ocr_reads), len(gateway.requests)) == (reads, requests)


def test_a_multi_page_upload_is_read_once_per_page_at_the_photo_cap_and_no_image_reaches_the_gateway(gateway, ocr_reads):
    token = _token("onepass-e@example.com")
    files = [("files", (f"p{i}.jpg", _jpeg((3200, 2400), seed=i), "image/jpeg")) for i in range(3)]
    resp = client.post("/api/documents/pages", files=files, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert len(ocr_reads) == 3  # one OCR pass per page, and no second pass anywhere
    assert all(max(size) <= 1500 for size in ocr_reads)  # each page read at the photo cap
    _every_message_is_plain_text(gateway)


def test_a_scanned_pdf_a_person_uploaded_is_not_downscaled_to_the_photo_cap(monkeypatch, ocr_reads, tmp_path):
    # 1500px on an A4 page is only ~128 dpi, and this repo measured 100 dpi already missing lines, so a real scan keeps 200 dpi.
    from app.extract.ocr import PDF_OCR_DPI, extract_pdf_text
    pdf = tmp_path / "scan.pdf"
    Image.new("RGB", (1654, 2339), (255, 255, 255)).save(pdf, format="PDF", resolution=float(PDF_OCR_DPI))
    extract_pdf_text(str(pdf))
    assert ocr_reads and max(ocr_reads[0]) > 1500
    ocr_reads.clear()
    extract_pdf_text(str(pdf), max_edge=1500)
    assert max(ocr_reads[0]) == 1500


# --- the single-photo text cap (round 6, DECISIONS #129) ---------------------------------------------------------------------


def test_a_photos_ocr_text_is_capped_far_below_a_documents_before_it_reaches_the_paid_model(gateway, monkeypatch, caplog):
    import logging
    from app.guards.injection import IMAGE_TEXT_CHAR_LIMIT, LLM_TEXT_CHAR_LIMIT
    assert IMAGE_TEXT_CHAR_LIMIT == 8_000 < LLM_TEXT_CHAR_LIMIT == 50_000
    huge = "noise fragment " * 6000  # ~90,000 characters of OCR garbage from a photo that is not a document
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": huge)
    token = _token("onepass-cap@example.com")
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        document_id = _upload(token, _jpeg(seed=9)).json()["document_id"]
    assert len(_stored_text(document_id)) == len(huge.strip())  # the FULL text is still persisted for search and review
    for request in gateway.requests:
        user = next(m["content"] for m in request["messages"] if m["role"] == "user")
        assert len(user) < IMAGE_TEXT_CHAR_LIMIT + 1_000  # the wrapper plus at most the cap, never 90,000 characters
    assert any("TEXT_CAP" in r.getMessage() and "limit=8000" in r.getMessage() for r in caplog.records)
    assert not any("noise fragment" in r.getMessage() for r in caplog.records)  # the log carries counts, not text


def test_a_multi_page_document_keeps_the_documents_limit_not_the_photo_limit(gateway, monkeypatch):
    from app.guards.injection import IMAGE_TEXT_CHAR_LIMIT
    page_text = "line of a long page " * 1000  # ~20,000 characters per page: real content of a long document, not noise
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": page_text)
    token = _token("onepass-cap2@example.com")
    files = [("files", (f"p{i}.jpg", _jpeg((2000, 1500), seed=20 + i), "image/jpeg")) for i in range(2)]
    assert client.post("/api/documents/pages", files=files, headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert gateway.requests
    for request in gateway.requests:
        user = next(m["content"] for m in request["messages"] if m["role"] == "user")
        assert len(user) > IMAGE_TEXT_CHAR_LIMIT * 3  # ~40,000 characters went through: the photo cap does not apply to a document
