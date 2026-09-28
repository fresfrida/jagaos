"""Two deployments, one shared backend, deliberately different upload behaviour while the kill switch is armed and a file has no
replay fixture (2026-09-28, DECISIONS #147): the AWS box refuses outright (a friendlier message than before); the Vercel deployment
lets the upload through with AI skipped entirely, so a judge still sees a document get filed. There is no second backend and no
per-deployment LLM_CALLS_DISABLED — the split is decided by the request's own Origin header (app/main.py::MANUAL_ENTRY_ORIGINS).

Every test here uses replay_on (tests/test_replay_mode.py's fixture): the kill switch armed, no API key, and the gateway client
constructor itself replaced by one that fails the test — so a passing test here is proof no real (or fake) gateway call was even
attempted, not just that none happened to fire."""

import io
import json
import os
import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.extract.ocr as ocr_module
import app.main as main_module
from app.main import app
from app.db import get_conn
from app.llm import LLMUnavailable
from PIL import Image

client = TestClient(app, raise_server_exceptions=False)
_seed = iter(range(1, 100_000))

VERCEL = "https://jagaos.vercel.app"
DISABLED = {"code": "uploads_disabled_demo_box", "message": "Uploads are disabled on this shared demo box."}


class _NoClientMayBeBuilt:
    def __init__(self, *args, **kwargs):
        raise AssertionError("a gateway client was constructed")


@pytest.fixture
def replay_on(monkeypatch):
    import app.llm as llm

    monkeypatch.setenv("LLM_REPLAY_DIR", str(Path(__file__).parent.parent / "evals" / "replay"))
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "API_KEY", "")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)


@pytest.fixture
def real_text(monkeypatch):
    """Plenty of real, non-empty OCR text — proves skip_ai bypasses the LLM deliberately, not by accident of the existing
    no-OCR-text fallback (which never calls it either, but for a different, unrelated reason)."""
    monkeypatch.setattr(
        ocr_module.pytesseract, "image_to_string",
        lambda image, config="": "Straits Print Supplies Pte Ltd\nInvoice No: SP-1\nTotal: SGD 100.00",
    )


def _token(email="owner@manual.test") -> str:
    resp = client.post("/api/auth/dev-login", json={"email": email, "name": "Manual Owner", "company_name": "Manual Co", "fye_month": 12, "fye_day": 31})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _h(token: str, origin: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if origin is not None:
        headers["Origin"] = origin
    return headers


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), random.Random(next(_seed)).randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(token: str, origin: str | None, name="unrecorded.jpg"):
    return client.post("/api/documents", files={"file": (name, _jpeg(), "image/jpeg")}, headers=_h(token, origin))


def _document(document_id: int) -> dict:
    with get_conn() as conn:
        return dict(conn.execute("SELECT * FROM document WHERE id = ?", (document_id,)).fetchone())


def _review_item(document_id: int) -> dict:
    with get_conn() as conn:
        return dict(conn.execute("SELECT * FROM review_item WHERE document_id = ? ORDER BY id DESC LIMIT 1", (document_id,)).fetchone())


# ---------------------------------------------------------------- the AWS box's own origin (and no Origin at all): unchanged, friendlier message


def test_no_origin_is_refused_with_the_new_friendly_message_not_the_generic_one(replay_on, real_text):
    resp = _upload(_token(), origin=None)
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_the_aws_boxs_own_origin_is_refused_the_same_way(replay_on, real_text):
    resp = _upload(_token(), origin="https://jagaos.13-251-52-222.nip.io")
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_a_refused_upload_leaves_no_row_behind(replay_on, real_text):
    token = _token()
    before = _document_count()
    assert _upload(token, origin=None).status_code == 503
    assert _document_count() == before


def _document_count() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) FROM document").fetchone()[0]


# ---------------------------------------------------------------- the Vercel origin: let through, AI skipped entirely


def test_vercel_origin_lets_an_unrecorded_upload_through_with_ai_skipped(replay_on, real_text):
    resp = _upload(_token(), origin=VERCEL)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "needs_review"
    doc = _document(body["document_id"])
    assert doc["status"] == "needs_review"
    assert doc["lane"] == "important" and doc["doc_type"] == "other" and doc["bucket"] is None and doc["description"] is None
    item = _review_item(body["document_id"])
    assert item["reason"] == "ai_skipped_manual_entry"
    # extract's own skip marker ({"skipped": true, ...}, no extractor for lane=important) — the review card's parseProposed only
    # treats a Provenance-shaped {value, confidence} entry as an extracted field, so this renders as zero extracted fields
    # ("skipped"/"reason" are neither), exactly like any other lane with no extractor.
    proposed = json.loads(item["proposed_json"])
    assert proposed.get("skipped") is True and not any(isinstance(v, dict) and "confidence" in v for v in proposed.values())


def test_no_classify_or_extract_trace_row_is_written_for_a_skipped_document(replay_on, real_text):
    """classify and extract both skip the gateway silently (no trace row, the same convention is_picture already uses); verify's
    own bookkeeping row still fires unconditionally for every document that reaches needs_review, skip_ai or not."""
    resp = _upload(_token(), origin=VERCEL)
    with get_conn() as conn:
        rows = conn.execute("SELECT node FROM trace WHERE document_id = ?", (resp.json()["document_id"],)).fetchall()
    assert [r["node"] for r in rows] == ["verify"]


def test_the_reviewer_can_still_accept_it_after_filling_in_the_blanks(replay_on, real_text):
    token = _token()
    resp = _upload(token, origin=VERCEL)
    document_id, thread_id = resp.json()["document_id"], resp.json()["thread_id"]
    edit = client.patch(f"/api/documents/{document_id}", json={"bucket": "Miscellaneous", "doc_type": "Other", "description": "A test document, entered by hand"}, headers=_h(token))
    assert edit.status_code == 200, edit.text
    review_item_id = _review_item(document_id)["id"]
    resolved = client.post(f"/api/review/{review_item_id}/resolve?thread_id={thread_id}", json={"action": "confirm", "corrected_fields": {}}, headers=_h(token))
    assert resolved.status_code == 200, resolved.text
    assert _document(document_id)["status"] == "filed"
    # lane stayed "important": a manually-entered document has no way to become a statutory event today (KANBAN) — no crash either way.
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM event WHERE source_document_id = ?", (document_id,)).fetchone()[0] == 0


def test_a_recorded_file_still_replays_normally_from_the_vercel_origin_manual_entry_never_applies(replay_on):
    """Replay is checked BEFORE the origin split (app/main.py): a file with a fixture is never treated as manual entry, from
    either origin — the two are independent, and replay wins when both could apply."""
    pdf = (Path(__file__).parent.parent / "evals" / "demo_corpus" / "files" / "01_certificate_of_incorporation.pdf").read_bytes()
    resp = client.post("/api/documents", files={"file": ("01_certificate_of_incorporation.pdf", pdf, "application/pdf")}, headers=_h(_token(), VERCEL))
    assert resp.status_code == 200, resp.text
    doc = _document(resp.json()["document_id"])
    assert doc["lane"] == "statutory" and doc["doc_type"] == "Certificate of Incorporation"  # the real replayed answer, not the manual-entry stub


def test_only_me_and_picture_uploads_are_unaffected_either_origin_they_already_never_call_the_gateway(replay_on):
    token = _token()
    resp = client.post(
        "/api/documents?visibility=only_me&name=keepsake", files={"file": ("keepsake.jpg", _jpeg(), "image/jpeg")},
        headers=_h(token, None),
    )
    assert resp.status_code == 200, resp.text  # unaffected by MANUAL_ENTRY_ORIGINS: personal files never reach the pipeline at all


def test_manual_entry_origins_env_override(monkeypatch, replay_on, real_text):
    monkeypatch.setenv("MANUAL_ENTRY_ORIGINS", "https://staging.example.test, https://jagaos.vercel.app")
    import importlib

    importlib.reload(main_module)
    try:
        assert main_module.MANUAL_ENTRY_ORIGINS == {"https://staging.example.test", "https://jagaos.vercel.app"}
        resp = TestClient(main_module.app, raise_server_exceptions=False).post(
            "/api/documents", files={"file": ("x.jpg", _jpeg(), "image/jpeg")},
            headers=_h(_token(), "https://staging.example.test"),
        )
        assert resp.status_code == 200, resp.text
    finally:
        importlib.reload(main_module)  # restore the default for every test after this one
