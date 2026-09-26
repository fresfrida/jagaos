"""The gateway spend kill switch and the clean failure path (round 7, DECISIONS #132).

DECISIONS #130 bans spending the gateway budget on seeding, resets and evals; this is the code that enforces it. `app.llm.call()` is the
one place a client is built, so the switch (env LLM_CALLS_DISABLED) lives there and is checked FIRST: with it on, no client is built and
nothing is sent. A gateway that is transiently unavailable (429, timeout, connection failure, 5xx) becomes the same `LLMUnavailable`,
and the upload path answers 503 {code: ai_unavailable, message} instead of a bare 500. Everything here uses fake clients; no test can
reach the real gateway.
"""

import io
import json
import logging
import os
import random
from pathlib import Path
from types import SimpleNamespace

import httpx
import openai
import pytest
from fastapi.testclient import TestClient
from openai.types import CompletionUsage
from PIL import Image

import app.extract.ocr as ocr_module
import app.llm as llm
import app.main as main_module
from app.db import get_conn
from app.main import app

client = TestClient(app, raise_server_exceptions=False)
DOCS = Path(os.environ["JAGA_DOCS_PATH"])
UNAVAILABLE = {"code": "ai_unavailable", "message": "AI is temporarily unavailable. Please try again shortly."}
SECRET_BODY = "SECRET-RESPONSE-BODY-DO-NOT-LOG"
_seed = iter(range(1, 100_000))


class _NoClientMayBeBuilt:
    """Stands in for the OpenAI class and for llm._client: constructing one at all fails the test."""

    def __init__(self, *args, **kwargs):
        raise AssertionError("a gateway client was constructed while calls are switched off")


class _Gateway:
    """A fake OpenAI client: answers every tool call from `replies`, or raises what `raises` says (per call number, 1-based)."""

    def __init__(self, raises: dict[int, Exception] | None = None):
        self.calls = 0
        self.raises = raises or {}
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls += 1
        if self.calls in self.raises:
            raise self.raises[self.calls]
        if not kwargs.get("tools"):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=None))], usage=CompletionUsage(prompt_tokens=10, completion_tokens=2, total_tokens=12))
        name = (kwargs.get("tool_choice") or {}).get("function", {}).get("name") or kwargs["tools"][0]["function"]["name"]
        args = (
            {"lane": "invoice", "doc_type": "invoice", "confidence": 0.9, "injection_suspected": False, "bucket": "Expenses",
             "vendor_name": "Acme", "description": "Invoice from Acme", "description_en": "Invoice from Acme"}
            if name == "classify_document" else {}
        )
        call = SimpleNamespace(model_dump=lambda: {"id": "1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}})
        message = SimpleNamespace(content="", tool_calls=[call])
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=CompletionUsage(prompt_tokens=10, completion_tokens=2, total_tokens=12))


def _response(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "http://gateway.test/v1/chat/completions"))


def _sdk_errors() -> dict[str, Exception]:
    request = httpx.Request("POST", "http://gateway.test/v1/chat/completions")
    return {
        "rate_limit": openai.RateLimitError(SECRET_BODY, response=_response(429), body=None),
        "timeout": openai.APITimeoutError(request=request),
        "connection": openai.APIConnectionError(message=SECRET_BODY, request=request),
        "internal_500": openai.InternalServerError(SECRET_BODY, response=_response(500), body=None),
        "bad_gateway_502": openai.InternalServerError(SECRET_BODY, response=_response(502), body=None),
        "unavailable_503": openai.InternalServerError(SECRET_BODY, response=_response(503), body=None),
    }


def _call():
    return llm.call("sonnet4.5", "system", "user text", purpose="classify", document_id=7)


# ---------------------------------------------------------------- the switch


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "True", "yes", "YES", " yes ", " 1 "])
def test_the_truthy_values_switch_calls_off(monkeypatch, value):
    monkeypatch.setenv("LLM_CALLS_DISABLED", value)
    assert llm.calls_disabled() is True


@pytest.mark.parametrize("value", ["", " ", "0", "false", "no", "off", "2", "enabled", "on", "y"])
def test_anything_else_leaves_calls_on(monkeypatch, value):
    monkeypatch.setenv("LLM_CALLS_DISABLED", value)
    assert llm.calls_disabled() is False


def test_unset_is_on_by_default_so_production_is_unchanged(monkeypatch):
    monkeypatch.delenv("LLM_CALLS_DISABLED", raising=False)
    assert llm.calls_disabled() is False


def test_with_the_switch_on_call_raises_and_no_client_is_ever_built(monkeypatch):
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)  # llm._client itself must not be reached
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)   # nor the SDK class beneath it
    with pytest.raises(llm.LLMUnavailable):
        _call()


def test_with_the_switch_on_even_a_missing_api_key_is_not_reached(monkeypatch):
    """The switch comes before _client(), whose own RuntimeError (no key) would otherwise fire first."""
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "API_KEY", "")
    with pytest.raises(llm.LLMUnavailable):
        _call()


def test_the_switch_is_read_when_call_runs_not_when_the_module_was_imported(monkeypatch):
    gateway = _Gateway()
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    with pytest.raises(llm.LLMUnavailable):
        _call()
    assert gateway.calls == 0
    monkeypatch.setenv("LLM_CALLS_DISABLED", "0")
    _call()
    assert gateway.calls == 1  # flipped back with no reimport: the very next call goes through


def test_the_disabled_line_carries_only_the_purpose_and_the_document_id(monkeypatch, caplog):
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        with pytest.raises(llm.LLMUnavailable):
            llm.call("sonnet4.5", "SYSTEM-PROMPT-TEXT", "USER-DOCUMENT-TEXT", purpose="extract", document_id=9)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("LLM_UNAVAILABLE")]
    assert lines == ["LLM_UNAVAILABLE reason=disabled purpose=extract document_id=9"]


# ---------------------------------------------------------------- the SDK errors that become LLMUnavailable


@pytest.mark.parametrize("name", list(_sdk_errors()))
def test_a_transient_or_refusal_sdk_error_becomes_llm_unavailable_with_the_original_as_its_cause(monkeypatch, caplog, name):
    error = _sdk_errors()[name]
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: error}))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        with pytest.raises(llm.LLMUnavailable) as raised:
            _call()
    assert raised.value.__cause__ is error
    # numbers-only: the class and the status, never the SDK's own text (which can echo a response body) or the prompt
    assert SECRET_BODY not in str(raised.value)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("LLM_UNAVAILABLE")]
    assert len(lines) == 1
    assert type(error).__name__ in lines[0] and "purpose=classify" in lines[0] and "document_id=7" in lines[0]
    assert SECRET_BODY not in lines[0] and "user text" not in lines[0] and "system" not in lines[0]


def test_the_status_of_a_status_error_is_in_the_line(monkeypatch, caplog):
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _sdk_errors()["unavailable_503"]}))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        with pytest.raises(llm.LLMUnavailable):
            _call()
    assert any("InternalServerError status=503" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("error", [
    openai.BadRequestError("Only the approved model is allowed", response=_response(400), body=None),
    openai.AuthenticationError("bad key", response=_response(401), body=None),
    openai.PermissionDeniedError("nope", response=_response(403), body=None),
    openai.NotFoundError("no route", response=_response(404), body=None),
    openai.UnprocessableEntityError("schema", response=_response(422), body=None),
], ids=lambda e: type(e).__name__)
def test_every_other_error_propagates_unchanged(monkeypatch, error):
    """What this gateway sends when the budget runs out was never recorded (MDs/GAPS.md has only the 400 on the model alias), so
    nothing besides 429, timeout, connection and 5xx is mapped."""
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: error}))
    with pytest.raises(type(error)) as raised:
        _call()
    assert raised.value is error and not isinstance(raised.value, llm.LLMUnavailable)


def test_a_bug_of_ours_is_not_swallowed_into_llm_unavailable(monkeypatch):
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: KeyError("our own bug")}))
    with pytest.raises(KeyError):
        _call()


# ---------------------------------------------------------------- the upload path


def _token(email: str = "owner@switch.test") -> str:
    resp = client.post("/api/auth/dev-login", json={"email": email, "name": "Switch Owner", "company_name": "Switch Co", "fye_month": 12, "fye_day": 31})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed))
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


def _post_document(token: str, data: bytes | None = None, name="receipt.jpg", mime="image/jpeg", **params):
    """A company document. Its text comes from the `fake_ocr` fixture in the tests that get as far as reading it."""
    return client.post("/api/documents", params=params, files={"file": (name, data if data is not None else _jpeg(), mime)}, headers=_h(token))


def _counts() -> dict[str, int]:
    with get_conn() as conn:
        return {t: conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"] for t in ("document", "document_activity", "trace", "review_item")}


def _stored_files() -> list[str]:
    return sorted(p.name for p in DOCS.iterdir())


@pytest.fixture
def no_gateway_at_all(monkeypatch):
    """Switch on, and make constructing any client fail the test: what `call()` must never reach."""
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)


@pytest.fixture
def fake_ocr(monkeypatch):
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": "HARBOURLIGHT SUPPLY Invoice INV-1 TOTAL 100.00")


def test_a_company_document_is_refused_with_a_503_before_anything_is_written(no_gateway_at_all):
    token = _token()
    before, files_before = _counts(), _stored_files()
    resp = _post_document(token)
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"] == UNAVAILABLE
    assert _counts() == before               # no document row, no history event, no trace, no review item
    assert _stored_files() == files_before   # no stored file left in the document store


def test_a_company_photo_set_is_refused_the_same_way(no_gateway_at_all):
    token = _token()
    before, files_before = _counts(), _stored_files()
    resp = client.post("/api/documents/pages", files=[("files", ("p1.jpg", _jpeg(), "image/jpeg")), ("files", ("p2.jpg", _jpeg(), "image/jpeg"))], headers=_h(token))
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"] == UNAVAILABLE
    assert _counts() == before and _stored_files() == files_before


def test_a_picture_upload_makes_no_gateway_call_so_it_still_succeeds(no_gateway_at_all, fake_ocr):
    """classify skips its call for a picture, its lane has no extractor and only the statutory lane derives events: zero calls."""
    token = _token()
    resp = _post_document(token, _jpeg(), name="holiday.jpg", mime="image/jpeg", is_picture="true")
    assert resp.status_code == 200, resp.text
    assert resp.json().get("status") != "duplicate"
    counts = _counts()
    assert counts["document"] == 1 and counts["document_activity"] == 1


def test_an_only_me_upload_never_enters_the_pipeline_so_it_still_succeeds(no_gateway_at_all):
    token = _token()
    resp = client.post("/api/documents", params={"visibility": "only_me", "name": "Passport"}, files={"file": ("passport.jpg", _jpeg(), "image/jpeg")}, headers=_h(token))
    assert resp.status_code == 200, resp.text
    counts = _counts()
    assert counts["document"] == 1 and counts["review_item"] == 0  # filed on the spot, no review, no gateway


def test_the_refusal_is_the_same_shape_the_web_client_already_reads(no_gateway_at_all):
    """{code, message} under `detail`, as _clean_personal_details answers (apiClient.ts ApiError parses it)."""
    detail = _post_document(_token()).json()["detail"]
    assert set(detail) == {"code", "message"} and "—" not in detail["message"]


def test_with_the_switch_off_the_same_upload_reaches_the_gateway_and_succeeds(monkeypatch, fake_ocr):
    gateway = _Gateway()
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    resp = _post_document(_token())
    assert resp.status_code == 200, resp.text
    assert gateway.calls >= 1


@pytest.mark.parametrize("name", ["rate_limit", "timeout", "connection", "internal_500", "unavailable_503"])
def test_a_real_gateway_failure_mid_pipeline_is_a_503_not_a_500(monkeypatch, fake_ocr, name):
    gateway = _Gateway(raises={1: _sdk_errors()[name]})
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    resp = _post_document(_token())
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"] == UNAVAILABLE
    assert SECRET_BODY not in resp.text


def test_a_failure_after_classify_succeeded_is_a_503_too(monkeypatch, fake_ocr):
    """classify answers, then extract's call fails: the same clean answer."""
    gateway = _Gateway(raises={2: _sdk_errors()["rate_limit"]})
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    resp = _post_document(_token())
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"] == UNAVAILABLE
    assert gateway.calls == 2


def test_a_400_from_the_gateway_is_still_not_dressed_up_as_unavailable(monkeypatch, fake_ocr):
    gateway = _Gateway(raises={1: openai.BadRequestError("Only the approved model is allowed", response=_response(400), body=None)})
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    resp = _post_document(_token())
    assert resp.status_code == 500  # unchanged: a real bug or a config error should stay loud, not read as "try again shortly"


# ---------------------------------------------------------------- boot


def test_startup_warns_once_when_the_switch_is_on(monkeypatch, caplog):
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        main_module.startup()
    assert sum("LLM_CALLS_DISABLED is on" in r.getMessage() for r in caplog.records) == 1


def test_startup_is_silent_about_it_when_the_switch_is_off(monkeypatch, caplog):
    monkeypatch.delenv("LLM_CALLS_DISABLED", raising=False)
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        main_module.startup()
    assert not any("LLM_CALLS_DISABLED" in r.getMessage() for r in caplog.records)
