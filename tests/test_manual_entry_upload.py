"""Two deployments, one shared backend, deliberately different upload behaviour depending on which frontend a
request came from (2026-09-28, DECISIONS #151 — supersedes #147). The AWS box refuses an upload that would need the
gateway only while the shared kill switch is armed and the file has no replay fixture (unchanged, this round).
The Vercel deployment is a browse-only playground with ZERO model spend, by policy: ANY company, non-picture upload
from a Vercel origin is refused with the SAME friendly message, UNCONDITIONALLY — independent of the kill switch's
own state and independent of whether a replay fixture exists for that exact file. There is no second backend and no
per-deployment LLM_CALLS_DISABLED — the split is decided by the request's own Origin header
(app/main.py::MANUAL_ENTRY_ORIGINS), checked in `_process_upload` before ingest() ever runs.

DECISIONS #147's earlier design — let a Vercel upload through with AI skipped, a human fills it in by hand
(classify.py's skip_ai branch, PipelineState.skip_ai) — is superseded for the Vercel origin specifically: that
mechanism is left in the code, unused, rather than deleted; nothing in this file exercises it anymore, because no
live caller can reach it.

Every test here uses a guard fixture (kill switch on, or explicitly off) that ALSO replaces the gateway client
constructor with one that fails the test — so a passing test is proof no real (or fake) gateway call was even
attempted, not just that none happened to fire, in either configuration."""

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
    """The kill switch armed, no replay fixture directory configured by default (individual tests that need a
    recorded fixture set LLM_REPLAY_DIR themselves) — the AWS box's usual posture."""
    import app.llm as llm

    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "API_KEY", "")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)


@pytest.fixture
def replay_fixtures(monkeypatch):
    """Adds a real replay fixture directory on top of replay_on, for the one test that must prove the Vercel
    refusal applies even to a file that HAS a recorded (free, 0-token) replay answer."""
    monkeypatch.setenv("LLM_REPLAY_DIR", str(Path(__file__).parent.parent / "evals" / "replay"))


@pytest.fixture
def kill_switch_off(monkeypatch):
    """The headline new behaviour (DECISIONS #151): the Vercel refusal must hold even when the shared kill switch
    is OFF — the state judges see live on the AWS box today. Explicitly clears both env vars (never trusts a
    default) and still guards client construction, so a bug that let a Vercel request reach the gateway fails
    this test loudly instead of silently making a real call."""
    import app.llm as llm

    monkeypatch.delenv("LLM_CALLS_DISABLED", raising=False)
    monkeypatch.delenv("LLM_REPLAY_DIR", raising=False)
    monkeypatch.setattr(llm, "API_KEY", "")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)


@pytest.fixture
def real_text(monkeypatch):
    """Plenty of real, non-empty OCR text — proves a refusal is a deliberate decision, not an accident of the
    unrelated no-OCR-text fallback (which never calls the gateway either, for a different reason)."""
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


def _document_count() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) FROM document").fetchone()[0]


# ---------------------------------------------------------------- the AWS box's own origin (and no Origin at all): unchanged


def test_no_origin_is_refused_with_the_friendly_message_kill_switch_on(replay_on, real_text):
    resp = _upload(_token(), origin=None)
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_the_aws_boxs_own_origin_is_refused_the_same_way_kill_switch_on(replay_on, real_text):
    resp = _upload(_token(), origin="https://jagaos.13-251-52-222.nip.io")
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_a_refused_aws_origin_upload_leaves_no_row_behind(replay_on, real_text):
    token = _token()
    before = _document_count()
    assert _upload(token, origin=None).status_code == 503
    assert _document_count() == before


def test_a_recorded_file_from_the_aws_origin_still_replays_normally_kill_switch_on(replay_on, replay_fixtures):
    """The kill-switch-only refusal still has its replay exception — unchanged by DECISIONS #151, which only ever
    ADDS an earlier, unconditional check for the Vercel origin specifically."""
    pdf = (Path(__file__).parent.parent / "evals" / "demo_corpus" / "files" / "01_certificate_of_incorporation.pdf").read_bytes()
    resp = client.post("/api/documents", files={"file": ("01_certificate_of_incorporation.pdf", pdf, "application/pdf")}, headers=_h(_token(), "https://jagaos.13-251-52-222.nip.io"))
    assert resp.status_code == 200, resp.text
    doc = _document(resp.json()["document_id"])
    assert doc["lane"] == "statutory" and doc["doc_type"] == "Certificate of Incorporation"


# ---------------------------------------------------------------- the Vercel origin: refused unconditionally (DECISIONS #151)


def test_vercel_origin_is_refused_with_the_same_friendly_message_kill_switch_on(replay_on, real_text):
    resp = _upload(_token(), origin=VERCEL)
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_vercel_origin_is_refused_even_when_the_kill_switch_is_off(kill_switch_off, real_text):
    """The headline behaviour: unlike the AWS box's own refusal, this one does NOT depend on calls_disabled() at
    all. This is the exact configuration judges see live on the AWS box today (real model calls proceeding for
    that origin) — proving the Vercel origin is refused here, with the client-construction guard never tripping,
    is proof the gate is independent of the switch, not merely coincidentally correct while it happens to be on."""
    resp = _upload(_token(), origin=VERCEL)
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_vercel_origin_is_refused_even_for_a_file_with_a_recorded_replay_fixture(replay_on, replay_fixtures):
    """No replay exception for the Vercel origin (unlike the AWS box's own kill-switch refusal, tested above): a
    file that WOULD have replayed for free is refused all the same — "zero model spend" is read literally, with
    no carve-out for the free/replayed case."""
    pdf = (Path(__file__).parent.parent / "evals" / "demo_corpus" / "files" / "01_certificate_of_incorporation.pdf").read_bytes()
    resp = client.post("/api/documents", files={"file": ("01_certificate_of_incorporation.pdf", pdf, "application/pdf")}, headers=_h(_token(), VERCEL))
    assert resp.status_code == 503
    assert resp.json()["detail"] == DISABLED


def test_a_refused_vercel_origin_upload_leaves_no_row_behind(replay_on, real_text):
    token = _token()
    before = _document_count()
    assert _upload(token, origin=VERCEL).status_code == 503
    assert _document_count() == before


def test_only_me_and_picture_uploads_from_vercel_are_unaffected_they_already_never_call_the_gateway(kill_switch_off):
    """DECISIONS #151 only touches the company + not-a-picture shape (the one that would reach the gateway); a
    picture (deterministic, no gateway call, DECISIONS #52) and a personal file (no pipeline at all, DECISIONS
    #101) from the Vercel origin are unaffected, in either kill-switch state."""
    token = _token()
    resp = client.post(
        "/api/documents?is_picture=true", files={"file": ("pic.jpg", _jpeg(), "image/jpeg")}, headers=_h(token, VERCEL),
    )
    assert resp.status_code == 200, resp.text
    resp2 = client.post(
        "/api/documents?visibility=only_me&name=keepsake", files={"file": ("keepsake.jpg", _jpeg(), "image/jpeg")}, headers=_h(token, VERCEL),
    )
    assert resp2.status_code == 200, resp2.text


def test_manual_entry_origins_env_override_is_also_refused_unconditionally(monkeypatch, kill_switch_off):
    monkeypatch.setenv("MANUAL_ENTRY_ORIGINS", "https://staging.example.test, https://jagaos.vercel.app")
    import importlib

    importlib.reload(main_module)
    try:
        assert main_module.MANUAL_ENTRY_ORIGINS == {"https://staging.example.test", "https://jagaos.vercel.app"}
        resp = TestClient(main_module.app, raise_server_exceptions=False).post(
            "/api/documents", files={"file": ("x.jpg", _jpeg(), "image/jpeg")},
            headers=_h(_token(), "https://staging.example.test"),
        )
        assert resp.status_code == 503
        assert resp.json()["detail"] == DISABLED
    finally:
        importlib.reload(main_module)  # restore the default for every test after this one


# ---------------------------------------------------------------- the deployment column (DECISIONS #148) still records correctly
# for the two upload shapes that still reach ingest() from a Vercel origin: a picture, and a personal (Only me) file.


def test_a_vercel_origin_picture_upload_is_still_recorded_as_deployment_vercel(kill_switch_off):
    resp = client.post(
        "/api/documents?is_picture=true", files={"file": ("pic2.jpg", _jpeg(), "image/jpeg")}, headers=_h(_token(), VERCEL),
    )
    assert resp.status_code == 200, resp.text
    assert _document(resp.json()["document_id"])["deployment"] == "vercel"


def test_a_vercel_origin_personal_file_is_still_recorded_as_deployment_vercel(kill_switch_off):
    resp = client.post(
        "/api/documents?visibility=only_me&name=keepsake2", files={"file": ("keepsake2.jpg", _jpeg(), "image/jpeg")}, headers=_h(_token(), VERCEL),
    )
    assert resp.status_code == 200, resp.text
    assert _document(resp.json()["document_id"])["deployment"] == "vercel"


def test_an_aws_origin_or_no_origin_upload_is_recorded_as_deployment_aws(kill_switch_off):
    token = _token()
    for origin in (None, "https://jagaos.13-251-52-222.nip.io"):
        resp = client.post(
            "/api/documents?is_picture=true", files={"file": (f"pic-{origin}.jpg", _jpeg(), "image/jpeg")},
            headers=_h(token, origin),
        )
        assert resp.status_code == 200, resp.text
        assert _document(resp.json()["document_id"])["deployment"] == "aws"


def test_a_duplicate_upload_never_overwrites_the_existing_rows_deployment(kill_switch_off):
    token = _token()
    first = client.post(
        "/api/documents?is_picture=true", files={"file": ("dup.jpg", (data := _jpeg()), "image/jpeg")},
        headers=_h(token, VERCEL),
    )
    assert first.status_code == 200 and _document(first.json()["document_id"])["deployment"] == "vercel"
    again = client.post(
        "/api/documents?is_picture=true", files={"file": ("dup.jpg", data, "image/jpeg")},
        headers=_h(token, None),  # a different origin, same bytes
    )
    assert again.status_code == 200 and again.json()["status"] == "duplicate"
    assert _document(first.json()["document_id"])["deployment"] == "vercel"  # unchanged by the second request's own origin
