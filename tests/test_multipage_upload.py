"""Several photos of one document -> one document (2026-09-24, round 12,
DECISIONS #78). POST /api/documents/pages merges the ordered images into one
image-only PDF and hands it to the same ingest as any scanned PDF, so this
checks the whole chain with real Pillow, real pdfplumber and real Tesseract;
only the two LLM calls are replaced by canned tool calls (and recorded, so
"the model was given every page" is asserted, not assumed). No gateway key.
Skips, not fails, without a Tesseract binary (same as tests/test_scanned_pdf.py).
"""

import io
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

import app.graph.classify as classify_module
import app.graph.extract as extract_module
from app.db import get_conn
from app.extract.merge import PageImageError, merge_images_to_pdf
from app.extract.ocr import MAX_PDF_OCR_PAGES
from app.guards.injection import LLM_TEXT_CHAR_LIMIT, untrusted_prompt
from app.llm import LLMResult
from app.main import app

pytesseract = pytest.importorskip("pytesseract")
try:
    pytesseract.get_tesseract_version()
except Exception:  # pragma: no cover - environment-dependent
    pytest.skip("tesseract binary not installed", allow_module_level=True)

client = TestClient(app, raise_server_exceptions=False)
DOCS = Path(os.environ["JAGA_DOCS_PATH"])
FONT = ImageFont.load_default(size=44)

PAGES = [
    ["HARBOURLIGHT SUPPLY", "Invoice INV-77120", "Carton of paper 520.00"],
    ["PAGE TWO CONTINUED", "Ergonomic chair 1250.00"],
    ["Subtotal 4000.00", "GST 360.00", "TOTAL DUE 4360.00"],
]


def _photo(lines: list[str], seed: int = 0) -> bytes:
    image = Image.new("RGB", (1500, 2000), (243 - seed, 241, 236))
    draw = ImageDraw.Draw(image)
    for i, line in enumerate(lines):
        draw.text((110, 150 + i * 92), line, fill=(28, 28, 30), font=FONT)
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _signup(email: str, company: str = "Pages Co") -> str:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": company, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _tool_response(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(
        content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}],
    )


@pytest.fixture
def seen_by_model(monkeypatch) -> list[str]:
    """Canned invoice-lane classify + extract; returns the user prompts the
    model was sent, so a test can assert what text it actually received."""
    prompts: list[str] = []

    def fake_classify(model, system, user, **kwargs):
        prompts.append(user)
        return _tool_response("classify_document", {
            "lane": "invoice", "doc_type": "invoice", "confidence": 0.95, "injection_suspected": False,
            "bucket": "Expenses", "vendor_name": "Harbourlight Supply",
            "description": "Invoice from Harbourlight Supply", "description_en": "Invoice from Harbourlight Supply",
        }, model)

    def prov(value):
        return {"value": value, "confidence": 0.95, "page": 3}

    def fake_extract(model, system, user, **kwargs):
        prompts.append(user)
        return _tool_response("extract_invoice_fields", {
            "vendor": prov("Harbourlight Supply"), "invoice_no": prov("INV-77120"),
            "issued_on": prov("2026-09-12"), "subtotal": prov(4000.0), "tax": prov(360.0),
            "currency": prov("SGD"), "total": prov(4360.0),
        }, model)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    return prompts


def _post_pages(token: str, photos: list[bytes], names: list[str] | None = None):
    names = names or [f"IMG_{i + 1}.jpg" for i in range(len(photos))]
    return client.post(
        "/api/documents/pages",
        headers={"Authorization": f"Bearer {token}"},
        files=[("files", (n, p, "image/jpeg")) for n, p in zip(names, photos)],
    )


def _stored_files() -> list[Path]:
    return [p for p in DOCS.iterdir() if p.is_file()]


def _document() -> dict:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM document").fetchall()
    assert len(rows) == 1, f"expected exactly one document row, got {len(rows)}"
    return dict(rows[0])


def test_three_photos_become_one_document_whose_text_holds_every_page_in_order(seen_by_model):
    token = _signup("pages@example.com")

    resp = _post_pages(token, [_photo(p, seed=i) for i, p in enumerate(PAGES)])

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "needs_review"
    doc = _document()
    assert doc["media_type"] == "application/pdf" and doc["text_source"] == "ocr"
    assert doc["filename"] == "IMG_1-3-pages.pdf"
    text = doc["extracted_text"]
    for marker in ("[Page 1]", "[Page 2]", "[Page 3]", "HARBOURLIGHT", "TWO CONTINUED", "4360.00"):
        assert marker in text, marker
    assert text.index("[Page 1]") < text.index("[Page 2]") < text.index("[Page 3]")
    assert [str(p) for p in _stored_files()] == [doc["stored_path"]], "exactly one stored file"


def test_the_model_is_given_every_page_not_just_the_first(seen_by_model):
    token = _signup("modelsees@example.com")
    assert _post_pages(token, [_photo(p, seed=i) for i, p in enumerate(PAGES)]).status_code == 200
    assert seen_by_model, "the model was never called"
    for prompt in seen_by_model:  # classify's and extract's
        assert "TOTAL DUE" in prompt and "TWO CONTINUED" in prompt and "HARBOURLIGHT" in prompt


def test_the_order_of_the_files_is_the_order_of_the_pages(seen_by_model):
    token = _signup("order@example.com")
    photos = [_photo(p, seed=i) for i, p in enumerate(PAGES)]

    assert _post_pages(token, list(reversed(photos))).status_code == 200

    text = _document()["extracted_text"]
    assert text.index("TOTAL DUE") < text.index("TWO CONTINUED") < text.index("HARBOURLIGHT")


def test_uploading_the_same_pages_again_is_recognised_as_a_duplicate(seen_by_model):
    token = _signup("dupe@example.com")
    photos = [_photo(p, seed=i) for i, p in enumerate(PAGES)]
    first = _post_pages(token, photos)
    second = _post_pages(token, photos)

    assert first.json()["status"] == "needs_review"
    assert second.json()["status"] == "duplicate"
    assert second.json()["document_id"] == first.json()["document_id"]


def test_a_single_file_is_refused_here_because_it_is_an_ordinary_upload():
    token = _signup("one@example.com")
    resp = _post_pages(token, [_photo(PAGES[0])])
    assert resp.status_code == 400 and "at least 2" in resp.json()["detail"].lower()


def test_more_pages_than_the_ocr_cap_are_refused_not_silently_dropped():
    token = _signup("toomany@example.com")
    resp = _post_pages(token, [_photo(["x"], seed=i % 5) for i in range(MAX_PDF_OCR_PAGES + 1)])
    assert resp.status_code == 400 and str(MAX_PDF_OCR_PAGES) in resp.json()["detail"]
    assert _stored_files() == []


def test_a_page_that_is_not_an_image_is_a_400_naming_the_page_and_leaves_nothing_behind():
    token = _signup("badpage@example.com")
    resp = _post_pages(token, [_photo(PAGES[0]), b"%PDF-1.4 not an image", _photo(PAGES[2])])

    assert resp.status_code == 400
    assert "Page 2" in resp.json()["detail"]
    assert _stored_files() == []
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == 0


def test_a_viewer_cannot_upload_pages(seen_by_model):
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "pagesowner@example.com", "company_name": "Viewer Pages Co", "fye_month": 1, "fye_day": 1},
    ).json()
    added = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "pagesviewer@example.com", "role": "viewer"},
        headers={"Authorization": f"Bearer {owner['token']}"},
    )
    assert added.status_code == 200
    viewer = client.post("/api/auth/dev-login", json={"email": "pagesviewer@example.com"}).json()["token"]

    assert _post_pages(viewer, [_photo(p) for p in PAGES]).status_code == 403
    assert _stored_files() == []


def test_the_single_file_upload_is_unchanged_by_the_shared_helper(seen_by_model):
    token = _signup("single@example.com")
    resp = client.post(
        "/api/documents", headers={"Authorization": f"Bearer {token}"},
        files={"file": ("one.jpg", _photo(PAGES[2]), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    doc = _document()
    assert doc["media_type"] == "image/jpeg" and "[Page" not in doc["extracted_text"]


# --- the merge step on its own ------------------------------------------------


def test_merging_is_byte_identical_for_identical_pages(tmp_path):
    paths = []
    for i, page in enumerate(PAGES):
        path = tmp_path / f"p{i}.jpg"
        path.write_bytes(_photo(page, seed=i))
        paths.append(str(path))
    a, b = tmp_path / "a.pdf", tmp_path / "b.pdf"

    assert merge_images_to_pdf(paths, str(a)) == 3
    merge_images_to_pdf(paths, str(b))

    assert a.read_bytes() == b.read_bytes()


def test_a_phone_photo_stored_sideways_with_an_exif_rotation_flag_is_turned_upright(tmp_path):
    import pdfplumber

    landscape = Image.new("RGB", (400, 200), "white")  # pixels wider than tall...
    exif = Image.Exif()
    exif[0x0112] = 6  # ...but flagged "rotate 90 degrees to display"
    path = tmp_path / "sideways.jpg"
    landscape.save(path, exif=exif)
    out = tmp_path / "out.pdf"

    merge_images_to_pdf([str(path), str(path)], str(out))

    with pdfplumber.open(out) as pdf:
        assert pdf.pages[0].height > pdf.pages[0].width, "the EXIF rotation was not applied"


def test_a_file_pillow_cannot_decode_names_its_page(tmp_path):
    good = tmp_path / "good.jpg"
    good.write_bytes(_photo(PAGES[0]))
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"definitely not an image")

    with pytest.raises(PageImageError) as excinfo:
        merge_images_to_pdf([str(good), str(bad)], str(tmp_path / "out.pdf"))
    assert excinfo.value.page == 2


# --- page markers in OCR text ------------------------------------------------------


def _pdf_of(tmp_path, pages: list[list[str]]):
    from app.extract.ocr import extract_pdf_text

    paths = []
    for i, lines in enumerate(pages):
        path = tmp_path / f"p{i}.jpg"
        path.write_bytes(_photo(lines, seed=i))
        paths.append(str(path))
    out = tmp_path / "out.pdf"
    merge_images_to_pdf(paths, str(out))
    return extract_pdf_text(str(out))


def test_a_scan_of_only_blank_pages_still_reads_as_empty_so_classify_takes_its_no_text_branch(tmp_path):
    assert _pdf_of(tmp_path, [[], []]) == ""


def test_a_blank_page_between_readable_ones_gets_no_marker(tmp_path):
    text = _pdf_of(tmp_path, [["FIRST PAGE ALPHA"], [], ["THIRD PAGE GAMMA"]])
    assert "[Page 1]" in text and "[Page 3]" in text and "[Page 2]" not in text


def test_a_single_page_scan_is_returned_exactly_as_before_with_no_marker(tmp_path):
    text = _pdf_of(tmp_path, [["ONLY PAGE DELTA"]])
    assert "DELTA" in text and "[Page" not in text


# --- the model sees the whole document ------------------------------------------


def test_a_long_document_reaches_the_model_whole_up_to_the_shared_limit():
    text = "x" * 30_000  # the old per-node cut was 12,000 characters
    assert text in untrusted_prompt(text)


def test_only_text_beyond_the_shared_limit_is_cut():
    prompt = untrusted_prompt("§" * (LLM_TEXT_CHAR_LIMIT + 5_000))  # a character the wrapper text never uses
    assert prompt.count("§") == LLM_TEXT_CHAR_LIMIT
