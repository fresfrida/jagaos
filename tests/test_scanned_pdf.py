"""Image-only ("scanned") PDFs (2026-09-24). Uploading one used to return
HTTP 500: app/extract/pdf.py finds no text layer and routes to OCR, but
app/extract/ocr.py could only open a raw image (`Image.open` on a PDF raises
UnidentifiedImageError) — and app/graph/ingest.py had already copied the
file into permanent storage, so every failure also left a file with no
document row. No gateway key needed: pure Pillow, pdfplumber's bundled
pypdfium2 and local Tesseract, with classify's LLM call mocked at the
upload level. Skips (not fails) without a Tesseract binary, like
tests/test_ocr.py.
"""

import io
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

import app.extract.ocr as ocr_module
import app.graph.classify as classify_module
from app.db import get_conn
from app.extract.ocr import extract_pdf_text
from app.graph.ingest import _local_text
from app.llm import LLMResult
from app.main import app

pytesseract = pytest.importorskip("pytesseract")

try:
    pytesseract.get_tesseract_version()
except Exception:  # pragma: no cover - environment-dependent
    pytest.skip("tesseract binary not installed", allow_module_level=True)

client = TestClient(app, raise_server_exceptions=False)
DOCS = Path(os.environ["JAGA_DOCS_PATH"])
FONT = ImageFont.load_default(size=64)


def _scan_page(*lines: str) -> Image.Image:
    """A page image with no text layer once saved into a PDF."""
    page = Image.new("RGB", (1654, 2339), "white")  # A4 at 200 dpi
    draw = ImageDraw.Draw(page)
    for i, line in enumerate(lines):
        draw.text((120, 160 + i * 130), line, fill="black", font=FONT)
    return page


def _image_only_pdf(*pages: Image.Image) -> bytes:
    buf = io.BytesIO()
    pages[0].save(buf, format="PDF", save_all=True, append_images=list(pages[1:]), resolution=200)
    return buf.getvalue()


def _stored_files() -> list[Path]:
    return [p for p in DOCS.iterdir() if p.is_file()]


def _signup(email: str, company: str) -> str:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": company, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def test_an_image_only_pdf_is_read_page_by_page_in_order(tmp_path):
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(_image_only_pdf(
        _scan_page("INVOICE ALPHA", "Total 111.00"),
        _scan_page("PAGE TWO BRAVO", "Total 222.00"),
    ))

    text = extract_pdf_text(str(pdf))

    assert "ALPHA" in text and "BRAVO" in text
    assert text.index("ALPHA") < text.index("BRAVO")
    assert "111.00" in text and "222.00" in text


def test_ingest_routes_an_image_only_pdf_to_ocr_instead_of_raising(tmp_path):
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(_image_only_pdf(_scan_page("HARBOURVIEW SUPPLIES", "Total 545.00")))

    text, source = _local_text(pdf, "application/pdf")

    assert source == "ocr"
    assert "HARBOURVIEW" in text


def test_a_born_digital_pdf_still_uses_its_text_layer(tmp_path):
    from reportlab.pdfgen import canvas

    pdf = tmp_path / "digital.pdf"
    c = canvas.Canvas(str(pdf))
    c.drawString(72, 720, "Born digital invoice with a real text layer for pdfplumber")
    c.save()

    text, source = _local_text(pdf, "application/pdf")

    assert source == "pdfplumber"
    assert "Born digital" in text


def test_pages_beyond_the_cap_are_not_ocrd(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr_module, "MAX_PDF_OCR_PAGES", 2)
    pdf = tmp_path / "long.pdf"
    pdf.write_bytes(_image_only_pdf(*[_scan_page(f"PAGEMARK{n}") for n in (1, 2, 3, 4)]))

    text = extract_pdf_text(str(pdf))

    assert "PAGEMARK1" in text and "PAGEMARK2" in text
    assert "PAGEMARK3" not in text and "PAGEMARK4" not in text


def test_uploading_an_image_only_pdf_succeeds_end_to_end_and_stores_exactly_one_file(monkeypatch):
    captured: list[str] = []

    def fake_call(model, system, user, **kwargs):
        captured.append(user)
        args = {
            "lane": "important", "doc_type": "contract", "confidence": 0.9, "injection_suspected": False,
            "bucket": "Contracts", "vendor_name": None,
            "description": "Scanned lease", "description_en": "Scanned lease",
        }
        return LLMResult(content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
                          tool_calls=[{"function": {"name": "classify_document", "arguments": json.dumps(args)}}])

    monkeypatch.setattr(classify_module, "call", fake_call)
    token = _signup("scanned@example.com", "Scanned Co")

    resp = client.post(
        "/api/documents",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("scan.pdf", _image_only_pdf(_scan_page("LEASE AGREEMENT", "Unit 12 04 rent 4800")), "application/pdf")},
    )

    assert resp.status_code == 200, resp.text
    with get_conn() as conn:
        rows = conn.execute("SELECT extracted_text, text_source, stored_path FROM document").fetchall()
    assert len(rows) == 1
    assert rows[0]["text_source"] == "ocr"
    assert "LEASE" in rows[0]["extracted_text"] and "AGREEMENT" in rows[0]["extracted_text"]
    # The model was given the OCR text (this is what the crash prevented).
    assert captured and "LEASE" in captured[0]
    assert [str(p) for p in _stored_files()] == [rows[0]["stored_path"]]


def test_a_failed_ingest_leaves_no_file_behind():
    token = _signup("orphan@example.com", "Orphan Co")
    before = _stored_files()

    resp = client.post(
        "/api/documents",
        headers={"Authorization": f"Bearer {token}"},
        # Not a readable PDF at all: extraction raises after upload, the way
        # the image-only PDF used to.
        files={"file": ("broken.pdf", b"%PDF-1.4 this is not a real pdf", "application/pdf")},
    )

    assert resp.status_code == 500
    assert _stored_files() == before, "a failed ingest must not leave a stored file with no document row"
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == 0
