"""Async wiring for jaga-vision captioning (2026-09-23, DECISIONS #55).
Pure DB + HTTP + a mocked network call — no gateway key, no torch/
transformers in this suite's own dependencies. The real vision service
(vision/app.py) has its own isolated venv and is verified separately
(see docs/DECISIONS.md #55's verification notes); what this file checks
is app/main.py's side of the wiring: the upload endpoint must never wait
on, or have its own success depend on, the captioning call.
"""

import io

from fastapi.testclient import TestClient
from PIL import Image

import app.main as main_module
from app.db import description_for, get_conn
from app.main import app

client = TestClient(app)


def _fake_image_bytes() -> bytes:
    # A real, valid JPEG — app/graph/ingest.py's image branch calls
    # PIL.Image.open() on it (OCR + EXIF), which raises on anything that
    # isn't genuinely decodable, unlike the PDF branch elsewhere in this
    # test suite that tolerates near-arbitrary bytes.
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color=(200, 180, 150)).save(buf, format="JPEG")
    return buf.getvalue()


def _signup(email: str, company_name: str) -> dict:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": company_name, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_picture_upload_response_does_not_depend_on_the_caption_call(monkeypatch):
    # The vision call is mocked to fail outright — if the upload response
    # depended on it in any way (awaited it, wrapped it in a try/except
    # that still touched the response body, etc.), this would surface
    # here as a 500 or a hung request. It must not: a slow, down, or
    # erroring jaga-vision is exactly the case DECISIONS #55 designed
    # around (fire-and-forget BackgroundTasks, existing pending-caption
    # state on failure).
    calls = []

    def fake_post(url, json, timeout):
        calls.append({"url": url, "json": json, "timeout": timeout})
        raise RuntimeError("simulated jaga-vision failure (connection refused)")

    monkeypatch.setattr(main_module.httpx, "post", fake_post)

    owner = _signup("visioncap-fail@example.com", "Vision Cap Fail Co")
    files = {"file": ("photo.jpg", _fake_image_bytes(), "image/jpeg")}
    resp = client.post(
        "/api/documents?source_channel=web&is_picture=true",
        files=files,
        headers=_auth_headers(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "needs_review"

    # TestClient runs BackgroundTasks inline after the response is built
    # (unlike a real deployed server, where they run genuinely after the
    # response is sent) — so by this point the mocked call has already
    # fired once, with the URL/timeout this module is actually configured
    # with, not a hardcoded guess in the test.
    assert len(calls) == 1
    assert calls[0]["url"] == main_module.CAPTION_SERVICE_URL
    assert calls[0]["timeout"] == main_module.CAPTION_TIMEOUT_SECONDS
    assert "path" in calls[0]["json"]

    # The simulated failure must leave description in its existing
    # pending-caption NULL state, not an exception, not a partial write.
    with get_conn() as conn:
        doc = conn.execute(
            "SELECT description FROM document WHERE id = ?", (body["document_id"],)
        ).fetchone()
    assert doc["description"] is None


def test_picture_upload_caption_call_fills_pending_description_on_success(monkeypatch):
    def fake_post(url, json, timeout):
        class _Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"caption": "a photo of a wooden desk"}

        return _Resp()

    monkeypatch.setattr(main_module.httpx, "post", fake_post)

    owner = _signup("visioncap-ok@example.com", "Vision Cap OK Co")
    files = {"file": ("photo.jpg", _fake_image_bytes(), "image/jpeg")}
    resp = client.post(
        "/api/documents?source_channel=web&is_picture=true",
        files=files,
        headers=_auth_headers(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]

    with get_conn() as conn:
        doc = conn.execute(
            "SELECT description FROM document WHERE id = ?", (document_id,)
        ).fetchone()
    # 2026-09-24 (items 5/6): description is JSON-encoded now
    # ({"en": "..."} — jaga-vision's BLIP model is English-only, no
    # language selection to honor here); description_for() reads it back
    # the same way a real caller (the frontend, or another backend node)
    # would, rather than asserting on the raw storage format directly.
    assert description_for(doc["description"], "en") == "a photo of a wooden desk"


def test_a_successful_caption_writes_a_trace_row_with_no_token_cost(monkeypatch):
    # Round 4, item 6 (DECISIONS #122): before this fix, a captioned picture's
    # trace panel showed nothing at all, which read as no AI having run, when
    # a real (local, zero-cost) model call had. This pins the row it now
    # writes: its own node, the local model's name, the caption as what it
    # decided, and NO token/cost fields (a local model has no token cost).
    def fake_post(url, json, timeout):
        class _Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"caption": "a photo of a wooden desk"}

        return _Resp()

    monkeypatch.setattr(main_module.httpx, "post", fake_post)

    owner = _signup("visioncap-trace@example.com", "Vision Cap Trace Co")
    files = {"file": ("photo.jpg", _fake_image_bytes(), "image/jpeg")}
    resp = client.post(
        "/api/documents?source_channel=web&is_picture=true",
        files=files,
        headers=_auth_headers(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]

    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM trace WHERE document_id = ? AND node = 'caption'", (document_id,)
        ).fetchone()
    assert row is not None
    assert row["model"] == "blip-image-captioning-base"
    assert row["decision"] == "a photo of a wooden desk"
    assert row["input_tokens"] is None
    assert row["output_tokens"] is None
    assert row["cost_usd"] is None
    assert row["company_id"] is not None
    assert row["run_id"]  # non-empty, derived from the document's own sha256


def test_a_failed_caption_writes_no_trace_row(monkeypatch):
    # The existing failure path (description stays pending) must not gain a
    # side effect: no caption means nothing was decided, so no trace row.
    def fake_post(url, json, timeout):
        raise RuntimeError("simulated jaga-vision failure (connection refused)")

    monkeypatch.setattr(main_module.httpx, "post", fake_post)

    owner = _signup("visioncap-trace-fail@example.com", "Vision Cap Trace Fail Co")
    files = {"file": ("photo.jpg", _fake_image_bytes(), "image/jpeg")}
    resp = client.post(
        "/api/documents?source_channel=web&is_picture=true",
        files=files,
        headers=_auth_headers(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]

    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM trace WHERE document_id = ? AND node = 'caption'", (document_id,)
        ).fetchone()
    assert row is None


def test_non_picture_upload_never_calls_the_vision_service(monkeypatch):
    # The background task is scheduled only for is_picture=True uploads
    # (app/main.py::upload_document) — a normal document upload must not
    # touch jaga-vision at all, even indirectly.
    calls = []
    monkeypatch.setattr(main_module.httpx, "post", lambda *a, **k: calls.append(1))

    owner = _signup("visioncap-notpicture@example.com", "Vision Cap Not Picture Co")
    files = {"file": ("photo.jpg", _fake_image_bytes(), "image/jpeg")}
    resp = client.post(
        "/api/documents?source_channel=web&is_picture=false",
        files=files,
        headers=_auth_headers(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
