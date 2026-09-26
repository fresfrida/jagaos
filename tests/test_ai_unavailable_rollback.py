"""What a failed request leaves behind, and what a failed derive_events costs (round 7, DECISIONS #132).

B1: `ingest()` commits the document row BEFORE the pipeline runs, and a re-upload of the same bytes is answered "duplicate" for ever, so a
row left behind by a gateway failure is a dead end. `_process_upload` now removes the row its own request created, through app/purge.py,
before it answers 503; the retry then works. B2: `derive_events` runs only after a person has confirmed the document, so when the
gateway is unavailable there it degrades (a trace row, no events, `events_derived: false`) instead of failing a filing that is already
done. Fake clients and canned model answers only; nothing here can reach the real gateway.
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
from reportlab.pdfgen import canvas

# app.main FIRST, on purpose: it runs load_dotenv() when imported, and app.llm reads LLM_GATEWAY_API_KEY once, at ITS import. This file sorts
# before every other test module, so importing app.llm (or anything that does) ahead of app.main would freeze an empty key for the whole
# session and break unrelated tests that need one to get past _client().
import app.main as main_module
from app.main import app

import app.extract.ocr as ocr_module
import app.graph.classify as classify_module
import app.graph.derive_events as derive_events_module
import app.graph.extract as extract_module
import app.llm as llm
from app.activity import operator
from app.db import get_conn
from app.llm import LLMResult, LLMUnavailable
from app.purge import PurgeRefused, purge_now

client = TestClient(app, raise_server_exceptions=False)
_real_roll_back = main_module._roll_back_unfinished_upload  # captured at import: tests that disable it to get the row still need the real one
DOCS = Path(os.environ["JAGA_DOCS_PATH"])
UNAVAILABLE = {"code": "ai_unavailable", "message": "AI is temporarily unavailable. Please try again shortly."}
OPERATOR = "system: AI unavailable"
_seed = iter(range(1, 100_000))


# ---------------------------------------------------------------- shared fakes


def _response(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "http://gateway.test/v1/chat/completions"))


def _rate_limit() -> Exception:
    return openai.RateLimitError("rate limited", response=_response(429), body=None)


class _Gateway:
    """A fake OpenAI client. Answers classify and extract with a well-formed invoice; call number N raises `raises[N]` instead."""

    def __init__(self, raises: dict[int, Exception] | None = None):
        self.calls = 0
        self.raises = raises or {}
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls += 1
        if self.calls in self.raises:
            raise self.raises[self.calls]
        name = kwargs["tool_choice"]["function"]["name"]
        prov = lambda v: {"value": v, "confidence": 0.95, "page": 1}  # noqa: E731
        args = (
            {"lane": "invoice", "doc_type": "invoice", "confidence": 0.9, "injection_suspected": False, "bucket": "Expenses",
             "vendor_name": "Acme", "description": "Invoice from Acme", "description_en": "Invoice from Acme"}
            if name == "classify_document" else
            {"vendor": prov("Acme"), "invoice_no": prov("INV-1"), "issued_on": prov("2026-09-12"), "subtotal": prov(100.0),
             "tax": prov(9.0), "currency": prov("SGD"), "total": prov(109.0)}
        )
        call = SimpleNamespace(model_dump=lambda: {"id": "1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}})
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="", tool_calls=[call]))],
            usage=CompletionUsage(prompt_tokens=120, completion_tokens=15, total_tokens=135),
        )


@pytest.fixture
def fake_ocr(monkeypatch):
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": "HARBOURLIGHT SUPPLY Invoice INV-1 TOTAL 109.00")


def _token(email="owner@rollback.test") -> str:
    resp = client.post("/api/auth/dev-login", json={"email": email, "name": "Rollback Owner", "company_name": "Rollback Co", "fye_month": 12, "fye_day": 31})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), random.Random(next(_seed)).randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(token: str, data: bytes, name="invoice.jpg"):
    return client.post("/api/documents", files={"file": (name, data, "image/jpeg")}, headers=_h(token))


def _count(table: str) -> int:
    with get_conn() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def _documents() -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT id, status, lifecycle_id, stored_path FROM document ORDER BY id")]


def _activity() -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT lifecycle_id, action, actor_user_id, actor_name FROM document_activity ORDER BY id")]


def _stored_files() -> list[str]:
    return sorted(p.name for p in DOCS.iterdir())


def _lines(caplog, prefix: str) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith(prefix)]


# ---------------------------------------------------------------- B1: the rollback


def test_purge_now_accepts_an_unfinished_row_with_no_archive_and_no_purge_request(monkeypatch, fake_ocr):
    """The precondition finding, proved on real data: plan_purge has no status check, so the row a failed upload leaves behind (received,
    not archived, never asked to be purged) can be purged as it is. The rollback is disabled here so the row exists to try it on."""
    monkeypatch.setattr(main_module, "_roll_back_unfinished_upload", lambda *a, **k: None)
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    assert _upload(_token(), _jpeg()).status_code == 503
    (row,) = _documents()
    assert row["status"] == "received"
    with get_conn() as conn:
        flags = conn.execute("SELECT purge_requested_at FROM document WHERE id = ?", (row["id"],)).fetchone()
    assert flags["purge_requested_at"] is None
    assert purge_now(row["id"], actor=operator(OPERATOR)) == []  # no PurgeRefused, no file left unremoved
    assert _documents() == []


def test_a_failure_on_the_first_call_leaves_nothing_but_history(monkeypatch, fake_ocr, caplog):
    token = _token()
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        resp = _upload(token, _jpeg())
    assert resp.status_code == 503 and resp.json()["detail"] == UNAVAILABLE
    assert _documents() == []                        # no document row
    assert _stored_files() == []                     # no stored file in JAGA_DOCS_PATH
    assert _count("document_search") == 0            # no search row
    assert _count("trace") == 0 and _count("review_item") == 0 and _count("extraction") == 0
    history = _activity()                            # what is left: Uploaded, then Deleted by the operator
    assert [h["action"] for h in history] == ["uploaded", "deleted"]
    assert len({h["lifecycle_id"] for h in history}) == 1
    assert history[0]["actor_name"] == "Rollback Owner" and history[0]["actor_user_id"] is not None
    assert history[1]["actor_name"] == OPERATOR and history[1]["actor_user_id"] is None
    assert _lines(caplog, "AI_UNAVAILABLE_ROLLBACK") == ["AI_UNAVAILABLE_ROLLBACK document_id=1 outcome=purged files_not_removed=0"]


def test_a_failure_after_classify_removes_the_proposed_row_and_its_trace_but_the_usage_line_keeps_the_tokens(monkeypatch, fake_ocr, caplog):
    token = _token()
    gateway = _Gateway(raises={2: _rate_limit()})
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    seen: list[tuple] = []
    real_roll_back = main_module._roll_back_unfinished_upload

    def watching(document_id, *, created_here):
        with get_conn() as conn:
            seen.append((
                conn.execute("SELECT status FROM document WHERE id = ?", (document_id,)).fetchone()["status"],
                [tuple(r) for r in conn.execute("SELECT node, decision FROM trace WHERE document_id = ? ORDER BY id", (document_id,))],
            ))
        real_roll_back(document_id, created_here=created_here)

    monkeypatch.setattr(main_module, "_roll_back_unfinished_upload", watching)
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        resp = _upload(token, _jpeg())
    assert resp.status_code == 503 and gateway.calls == 2
    (status_seen, trace_seen), = seen                # the state the rollback was looking at: classified, with its trace rows
    assert status_seen == "proposed" and trace_seen[0][0] == "classify" and {node for node, _ in trace_seen} <= {"classify", "classify_grounding"}
    assert _documents() == [] and _stored_files() == [] and _count("trace") == 0 and _count("document_search") == 0
    assert [h["action"] for h in _activity()] == ["uploaded", "deleted"]
    (usage,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("LLM_USAGE ") and '"purpose": "classify"' in r.getMessage()]
    assert '"input_tokens": 120' in usage and '"output_tokens": 15' in usage  # the spend is still on the record


def test_the_retry_of_the_same_bytes_works_end_to_end(monkeypatch, fake_ocr):
    token = _token()
    data = _jpeg()
    gateway = _Gateway(raises={1: _rate_limit()})
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    assert _upload(token, data).status_code == 503
    first_lifecycle = _activity()[0]["lifecycle_id"]

    second = _upload(token, data)                    # the very same file, the gateway now answering
    assert second.status_code == 200, second.text
    assert second.json().get("status") != "duplicate"
    (row,) = _documents()
    assert row["status"] == "needs_review" and row["lifecycle_id"] != first_lifecycle
    assert len(_stored_files()) == 1 and _count("review_item") == 1
    actions = [(h["lifecycle_id"] == first_lifecycle, h["action"]) for h in _activity()]
    assert actions == [(True, "uploaded"), (True, "deleted"), (False, "uploaded")]


def test_a_duplicate_is_never_rolled_back_because_no_pipeline_ran_for_it(monkeypatch, fake_ocr):
    token = _token()
    data = _jpeg()
    monkeypatch.setattr(llm, "_client", lambda: _Gateway())
    assert _upload(token, data).status_code == 200
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    again = _upload(token, data)
    assert again.status_code == 200 and again.json()["status"] == "duplicate"
    (row,) = _documents()
    assert row["status"] == "needs_review" and len(_stored_files()) == 1


@pytest.mark.parametrize("what", ["status_needs_review", "status_filed", "has_extraction", "has_review_item", "not_created_here"])
def test_a_row_that_is_not_unfinished_or_not_ours_is_kept(monkeypatch, fake_ocr, caplog, what):
    """Only received/proposed with no extraction and no review item, created by this request, may be removed: anything else is kept,
    logged, and the caller still answers 503."""
    monkeypatch.setattr(main_module, "_roll_back_unfinished_upload", lambda *a, **k: None)   # get the row without rolling it back
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    assert _upload(_token(), _jpeg()).status_code == 503
    (row,) = _documents()
    with get_conn() as conn:
        if what.startswith("status_"):
            conn.execute("UPDATE document SET status = ? WHERE id = ?", (what.removeprefix("status_"), row["id"]))
        elif what == "has_extraction":
            conn.execute("INSERT INTO extraction (document_id, field, value_text, confidence, extractor_version, source) VALUES (?, 'x', '1', 1.0, '1', 'llm')", (row["id"],))
        elif what == "has_review_item":
            company = conn.execute("SELECT company_id FROM document WHERE id = ?", (row["id"],)).fetchone()[0]
            conn.execute("INSERT INTO review_item (company_id, document_id, reason, question, proposed_json, status) VALUES (?, ?, 'r', 'q', '{}', 'open')", (company, row["id"]))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        _real_roll_back(row["id"], created_here=what != "not_created_here")
    (line,) = _lines(caplog, "AI_UNAVAILABLE_ROLLBACK")
    assert "outcome=kept" in line
    assert len(_documents()) == 1 and len(_stored_files()) == 1  # nothing removed


def test_a_rollback_that_is_refused_still_answers_503_and_says_so(monkeypatch, fake_ocr, caplog):
    def refused(*args, **kwargs):
        raise PurgeRefused("the schema has a reference this code does not handle: sentinel-detail-must-not-be-logged")

    monkeypatch.setattr(main_module, "purge_now", refused)
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        resp = _upload(_token(), _jpeg())
    assert resp.status_code == 503 and resp.json()["detail"] == UNAVAILABLE   # not a 500, and the original cause is the one reported
    assert _lines(caplog, "AI_UNAVAILABLE_ROLLBACK") == ["AI_UNAVAILABLE_ROLLBACK document_id=1 outcome=failed error=PurgeRefused"]
    assert len(_documents()) == 1                                             # the row is still there, as the log line says


def test_a_rollback_that_hits_an_unexpected_error_still_answers_503(monkeypatch, fake_ocr, caplog):
    def boom(*args, **kwargs):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(main_module, "purge_now", boom)
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        resp = _upload(_token(), _jpeg())
    assert resp.status_code == 503 and resp.json()["detail"] == UNAVAILABLE
    assert _lines(caplog, "AI_UNAVAILABLE_ROLLBACK") == ["AI_UNAVAILABLE_ROLLBACK document_id=1 outcome=failed error=RuntimeError"]
    assert "disk on fire" not in caplog.text


def test_a_file_that_cannot_be_removed_is_counted_and_the_answer_is_still_503(monkeypatch, fake_ocr, caplog):
    monkeypatch.setattr(main_module, "purge_now", lambda *a, **k: ["/data/docs/x.jpg ([Errno 13] Permission denied)"])
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        resp = _upload(_token(), _jpeg())
    assert resp.status_code == 503
    assert _lines(caplog, "AI_UNAVAILABLE_ROLLBACK") == ["AI_UNAVAILABLE_ROLLBACK document_id=1 outcome=purged files_not_removed=1"]
    assert "Permission denied" not in caplog.text and "/data/docs" not in caplog.text


def test_the_multi_page_upload_rolls_back_the_same_way(monkeypatch, fake_ocr):
    token = _token()
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    files = [("files", (f"p{i}.jpg", _jpeg(), "image/jpeg")) for i in (1, 2)]
    resp = client.post("/api/documents/pages", files=files, headers=_h(token))
    assert resp.status_code == 503, resp.text
    assert _documents() == [] and _stored_files() == []
    assert [h["action"] for h in _activity()] == ["uploaded", "deleted"]


# ---------------------------------------------------------------- B2: derive_events degrades


def _tool(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
                     tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}])


def _pdf(tag: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, "ACRA NOTICE OF CHANGE OF REGISTERED OFFICE")
    c.drawString(72, 740, f"Ref {tag}: the registered office moves to 1 Marina Boulevard from 1 February 2026.")
    c.save()
    return buf.getvalue()


def _prov(value):
    return {"value": value, "confidence": 0.95, "page": 1}


@pytest.fixture
def statutory(monkeypatch) -> dict:
    """Canned statutory classify and extract (module-level fakes, so only derive_events can reach the gateway); derive_events is
    left to each test."""
    def fake_classify(model_name, system, user, **kwargs):
        return _tool("classify_document", {
            "lane": "statutory", "doc_type": "Notice of Change of Registered Office", "confidence": 0.96, "injection_suspected": False,
            "bucket": "Statutory", "vendor_name": "ACRA", "description": "Notice of change of registered office",
            "description_en": "Notice of change of registered office"}, model_name)

    def fake_extract(model_name, system, user, **kwargs):
        return _tool("extract_statutory_fields", {"doc_type": _prov("Notice of Change of Registered Office"),
                                                  "subject": _prov("Change of registered office"), "issued_on": _prov("2026-02-01")}, model_name)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    return {}


def _upload_pdf(token: str, tag: str) -> int:
    resp = client.post("/api/documents", headers=_h(token), files={"file": (f"{tag}.pdf", _pdf(tag), "application/pdf")})
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _resolve(token: str, document_id: int):
    item = next(i for i in client.get("/api/review", headers=_h(token)).json() if i["document_id"] == document_id)
    return client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=_h(token))


def _trace(document_id: int, node: str) -> list[str]:
    with get_conn() as conn:
        return [r["decision"] for r in conn.execute("SELECT decision FROM trace WHERE document_id = ? AND node = ? ORDER BY id", (document_id, node))]


def _status(document_id: int) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT status FROM document WHERE id = ?", (document_id,)).fetchone()["status"]


def _degraded(resolved, document_id: int) -> None:
    assert resolved.status_code == 200, resolved.text   # no 500, no 503: the filing is done
    body = resolved.json()
    assert body["status"] == "filed" and body["events"] == [] and body["events_derived"] is False
    assert _status(document_id) == "filed"                              # human_review's write; derive_events wrote no status
    assert _trace(document_id, "derive_events") == ["skipped_llm_unavailable"]
    assert _trace(document_id, "archive") == ["events=0 expectations=0 obligations=0"]   # derive_expectations and archive still ran
    assert _count("event") == 0


def test_llm_unavailable_inside_derive_events_files_the_document_and_says_no_events_were_derived(monkeypatch, statutory):
    token = _token("owner@b2.test")
    doc = _upload_pdf(token, "unavailable-a")

    def unavailable(*args, **kwargs):
        raise LLMUnavailable("gateway unavailable")

    monkeypatch.setattr(derive_events_module, "call", unavailable)
    _degraded(_resolve(token, doc), doc)


def test_a_real_gateway_failure_at_derive_events_degrades_through_the_real_call(monkeypatch, statutory):
    """The real llm.call() with a fake client that answers 429: SDK error -> LLMUnavailable -> the node's own catch."""
    token = _token("owner@b2.test")
    doc = _upload_pdf(token, "unavailable-b")
    monkeypatch.setattr(llm, "_client", lambda: _Gateway(raises={1: _rate_limit()}))
    _degraded(_resolve(token, doc), doc)


def test_the_kill_switch_turned_on_before_the_confirm_degrades_it_the_same_way(monkeypatch, statutory):
    token = _token("owner@b2.test")
    doc = _upload_pdf(token, "unavailable-c")
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    _degraded(_resolve(token, doc), doc)


def test_the_normal_path_still_derives_the_event_and_reports_events_derived_true(monkeypatch, statutory):
    token = _token("owner@b2.test")
    doc = _upload_pdf(token, "normal")
    monkeypatch.setattr(derive_events_module, "call", lambda model_name, system, user, **kw: _tool(
        "propose_event", {"kind": "office_move", "occurred_on": "2026-02-01", "title": "Registered office moved", "confidence": 0.9}, model_name))
    resolved = _resolve(token, doc)
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["status"] == "filed" and body["events_derived"] is True and len(body["events"]) == 1
    assert _count("event") == 1 and _trace(doc, "derive_events") == ["proposed"]


def test_a_model_that_proposes_no_event_is_not_a_degrade(monkeypatch, statutory):
    token = _token("owner@b2.test")
    doc = _upload_pdf(token, "no-event")
    monkeypatch.setattr(derive_events_module, "call", lambda model_name, system, user, **kw: LLMResult(
        content="no_event", tool_calls=None, model=model_name, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1))
    body = _resolve(token, doc).json()
    assert body["events"] == [] and body["events_derived"] is True and _trace(doc, "derive_events") == ["no_event"]


def test_a_document_that_is_not_statutory_never_touches_the_gateway_and_reports_events_derived_true(monkeypatch):
    token = _token("owner@b2.test")
    gateway = _Gateway()
    monkeypatch.setattr(llm, "_client", lambda: gateway)
    monkeypatch.setattr(ocr_module.pytesseract, "image_to_string", lambda image, config="": "HARBOURLIGHT SUPPLY Invoice INV-1 TOTAL 109.00")
    doc = _upload(token, _jpeg()).json()["document_id"]
    calls_after_upload = gateway.calls
    body = _resolve(token, doc).json()
    assert gateway.calls == calls_after_upload            # derive_events made no call for an invoice
    assert body["events_derived"] is True and _trace(doc, "derive_events") == []
