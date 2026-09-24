"""A confirmed statutory document must produce a company event (2026-09-24,
round 13, DECISIONS #84).

derive_events returned early whenever `verify_result.needs_review` was true, and
since DECISIONS #40 made that flag unconditionally true, the node did nothing for
every document from 2026-09-22 on — including ones a person had confirmed. The
unit-level live test called the node with `needs_review: False` and so could not
see it. These tests go the whole way: a real upload through POST /api/documents,
the pipeline pausing for review, a real confirm through POST /api/review/.../resolve,
and an assertion on the `event` table. Only the model is replaced (canned tool
calls, recorded), so the node's own logic — the thing that was broken — runs for
real. The same flow against the real gateway is
tests/test_gateway_live.py::test_a_confirmed_statutory_notice_produces_an_event_through_the_real_gateway.
"""

import io
import json

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

import app.graph.classify as classify_module
import app.graph.derive_events as derive_events_module
import app.graph.extract as extract_module
from app.db import get_conn
from app.llm import LLMResult
from app.main import app

client = TestClient(app)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _tool(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(
        content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}],
    )


def _pdf(tag: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, "ACRA NOTICE OF CHANGE OF REGISTERED OFFICE")
    c.drawString(72, 740, f"Ref {tag}: the registered office moves to 1 Marina Boulevard from 1 February 2026.")
    c.save()
    return buf.getvalue()


def _prov(value, confidence: float = 0.95):
    return {"value": value, "confidence": confidence, "page": 1}


@pytest.fixture
def model(monkeypatch) -> dict:
    """Canned statutory-notice classify + extract + derive_events. `calls` records
    every derive_events call, so a test can prove the model was (or was not) asked."""
    state = {"calls": [], "event": {
        "kind": "office_move", "occurred_on": "2026-02-01", "title": "Registered office moved", "confidence": 0.9,
    }, "doc_type": "Notice of Change of Registered Office"}

    def fake_classify(model_name, system, user, **kwargs):
        return _tool("classify_document", {
            "lane": "statutory", "doc_type": state["doc_type"], "confidence": 0.96, "injection_suspected": False,
            "bucket": "Statutory", "vendor_name": "ACRA",
            "description": "Notice of change of registered office", "description_en": "Notice of change of registered office",
        }, model_name)

    def fake_extract(model_name, system, user, **kwargs):
        return _tool("extract_statutory_fields", {
            "doc_type": _prov(state["doc_type"]), "subject": _prov("Change of registered office"),
            "issued_on": _prov("2026-02-01"),
        }, model_name)

    def fake_derive(model_name, system, user, **kwargs):
        state["calls"].append(user)
        return _tool("propose_event", state["event"], model_name)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    monkeypatch.setattr(derive_events_module, "call", fake_derive)
    return state


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@events.test", "company_name": "Events Co", "fye_month": 12, "fye_day": 31},
    ).json()
    added = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "user@events.test", "role": "user"}, headers=_headers(owner["token"]),
    )
    assert added.status_code == 200
    return {
        "owner": owner["token"],
        "user": client.post("/api/auth/dev-login", json={"email": "user@events.test"}).json()["token"],
    }


def _upload(token: str, tag: str, visibility: str | None = None) -> int:
    suffix = f"?visibility={visibility}" if visibility else ""
    resp = client.post(
        f"/api/documents{suffix}", headers=_headers(token),
        files={"file": (f"{tag}.pdf", _pdf(tag), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _resolve(token: str, document_id: int, action: str = "confirm"):
    item = next(i for i in client.get("/api/review", headers=_headers(token)).json() if i["document_id"] == document_id)
    return client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": action, "corrected_fields": {}}, headers=_headers(token),
    )


def _events() -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM event ORDER BY id").fetchall()]


def _trace(document_id: int, node: str) -> list[str]:
    with get_conn() as conn:
        return [r["decision"] for r in conn.execute(
            "SELECT decision FROM trace WHERE document_id = ? AND node = ? ORDER BY id", (document_id, node)).fetchall()]


def test_confirming_a_statutory_document_produces_an_event_row(team, model):
    doc = _upload(team["owner"], "confirmed-notice")
    assert _events() == [], "nothing may be derived before a person has confirmed the document"

    resolved = _resolve(team["owner"], doc)

    assert resolved.status_code == 200, resolved.text
    events = _events()
    assert len(events) == 1, events
    assert (events[0]["kind"], events[0]["occurred_on"], events[0]["source_document_id"]) == ("office_move", "2026-02-01", doc)
    assert events[0]["company_id"] == 1 or events[0]["company_id"] > 0
    assert len(model["calls"]) == 1 and "REGISTERED OFFICE" in model["calls"][0]
    assert _trace(doc, "derive_events") == ["proposed"], "the run must show the node ran"


def test_the_resolve_response_reports_the_event_it_produced(team, model):
    doc = _upload(team["owner"], "reported-notice")
    body = _resolve(team["owner"], doc).json()
    assert body["events"] and body["events"][0]["kind"] == "office_move"


def test_a_rejected_document_produces_no_event_and_never_asks_the_model(team, model):
    doc = _upload(team["owner"], "rejected-notice")
    assert _resolve(team["owner"], doc, action="reject").status_code == 200

    assert _events() == [] and model["calls"] == []
    assert _trace(doc, "derive_events") == []


def test_a_document_that_is_not_statutory_is_skipped_by_design_without_a_model_call(team, monkeypatch, model):
    def invoice_classify(model_name, system, user, **kwargs):
        return _tool("classify_document", {
            "lane": "important", "doc_type": "contract", "confidence": 0.9, "injection_suspected": False,
            "bucket": "Contracts", "vendor_name": None, "description": "A lease", "description_en": "A lease",
        }, model_name)

    monkeypatch.setattr(classify_module, "call", invoice_classify)
    doc = _upload(team["owner"], "lease")
    assert _resolve(team["owner"], doc).status_code == 200

    assert _events() == [] and model["calls"] == []


def test_a_personal_file_never_feeds_company_events_and_the_skip_is_recorded(team, model):
    doc = _upload(team["user"], "private-notice", visibility="only_me")
    assert _resolve(team["user"], doc).status_code == 200  # the uploader resolves their own

    assert _events() == [] and model["calls"] == [], "a document nobody else can see must not create a company record"
    assert _trace(doc, "derive_events") == ["skipped_personal_file"], "a skipped statutory document must say so"


def test_a_personal_file_does_not_satisfy_a_company_expectation(team, model):
    # A company document that proposes an incorporation event creates the expected-document
    # set (certificate, constitution, ...). A colleague's PERSONAL certificate must not
    # count as the company holding one.
    model["doc_type"] = "ACRA Certificate of Incorporation"
    private = _upload(team["user"], "private-certificate", visibility="only_me")
    assert _resolve(team["user"], private).status_code == 200

    model["event"] = {"kind": "incorporation", "occurred_on": "2023-01-15", "title": "Incorporated", "confidence": 0.9}
    model["doc_type"] = "Notice of Incorporation Details"  # a company document that is NOT the certificate
    shared = _upload(team["owner"], "shared-notice")
    assert _resolve(team["owner"], shared).status_code == 200

    with get_conn() as conn:
        status = conn.execute("SELECT status FROM expectation WHERE doc_type = 'certificate_of_incorporation'").fetchone()
    assert status is not None, "the incorporation event should have created the expected set"
    assert status["status"] == "missing"
