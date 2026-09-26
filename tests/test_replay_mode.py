"""Replay mode (round 7, item S2, DECISIONS #134): app/llm.py::call() answers from recorded fixtures under evals/replay/ so the REAL pipeline
runs end to end and only the model's answer is canned.

Every test here runs with NO gateway client: `llm._client` and the SDK class itself are replaced by constructors that fail the test, and the
configuration that matters on the production box is exercised as it will be there: LLM_REPLAY_DIR set, the kill switch LLM_CALLS_DISABLED=1
armed, and no API key."""

# app.main first: it runs load_dotenv(), and app.llm reads the API key once at its own import (see tests/test_ai_unavailable_rollback.py).
import app.main as main_module
from app.main import app

import hashlib
import io
import json
import logging
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

import app.graph.classify as classify_module
import app.graph.derive_events as derive_events_module
import app.graph.extract as extract_module
import app.llm as llm
from app.db import get_conn
from app.models import ClassifyResult, InvoiceFields, ProposedEvent, StatutoryFields

client = TestClient(app, raise_server_exceptions=False)
REPO = Path(__file__).parent.parent
REPLAY = REPO / "evals" / "replay"
PDFS = REPO / "evals" / "demo_corpus" / "files"
DOCS = Path(os.environ["JAGA_DOCS_PATH"])
RUN_IDS = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()[:12] for p in sorted(PDFS.glob("*.pdf"))}
SCHEMAS = {"extract_invoice_fields": InvoiceFields, "extract_statutory_fields": StatutoryFields}


class _NoClientMayBeBuilt:
    def __init__(self, *args, **kwargs):
        raise AssertionError("a gateway client was constructed in replay mode")


@pytest.fixture
def replay_on(monkeypatch):
    """The production demo configuration: replay on, kill switch armed, no key, and no client can be built."""
    monkeypatch.setenv("LLM_REPLAY_DIR", str(REPLAY))
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "API_KEY", "")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)


def _call(purpose="classify", run_id=RUN_IDS["01_certificate_of_incorporation.pdf"], document_id=5):
    return llm.call("sonnet4.5", "system", "user text", purpose=purpose, document_id=document_id, run_id=run_id)


# ---------------------------------------------------------------- call(): the replay branch


def test_a_hit_is_a_free_replay_answer_that_never_builds_a_client(replay_on):
    result = _call()
    assert result.model == "replay" and result.input_tokens == 0 and result.output_tokens == 0 and result.cost_usd == 0.0
    assert result.total_tokens == 0 and result.content == ""
    (tool_call,) = result.tool_calls
    assert tool_call["type"] == "function" and tool_call["function"]["name"] == "classify_document"
    args = json.loads(tool_call["function"]["arguments"])
    assert ClassifyResult(**args).doc_type == "Certificate of Incorporation"


def test_replay_answers_before_the_kill_switch_and_an_unrecorded_call_is_still_refused(replay_on):
    assert llm.calls_disabled() is True
    assert _call().model == "replay"                                                  # recorded: answered although the switch is armed
    with pytest.raises(llm.LLMUnavailable):
        _call(run_id="000000000000")                                                  # unrecorded: falls through to the switch


def test_a_miss_falls_through_to_the_real_path_when_calls_are_allowed(monkeypatch):
    monkeypatch.setenv("LLM_REPLAY_DIR", str(REPLAY))
    asked = []

    class _Gateway:
        chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: asked.append(kw) or SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="real", tool_calls=None))], usage=None)))

    monkeypatch.setattr(llm, "_client", lambda: _Gateway())
    assert _call(run_id="000000000000").content == "real" and len(asked) == 1         # a miss reached the normal path
    asked.clear()
    assert _call().model == "replay" and asked == []                                  # a hit did not


def test_the_miss_policy_is_a_named_constant_and_raise_refuses_a_miss(replay_on, monkeypatch):
    assert llm.REPLAY_ON_MISS == "fall_through"
    monkeypatch.setattr(llm, "REPLAY_ON_MISS", "raise")
    monkeypatch.delenv("LLM_CALLS_DISABLED")
    with pytest.raises(llm.LLMUnavailable):
        _call(run_id="000000000000")                                                  # refused although calls are allowed
    assert _call().model == "replay"


def test_replay_is_off_by_default_even_though_fixtures_exist(monkeypatch):
    monkeypatch.delenv("LLM_REPLAY_DIR", raising=False)
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    assert llm.replay_configured() is False and llm.replay_available(RUN_IDS["01_certificate_of_incorporation.pdf"]) is False
    with pytest.raises(llm.LLMUnavailable):
        _call()


def test_a_hit_logs_one_numbers_only_line(replay_on, caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        _call(document_id=42)
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("LLM_REPLAY")]
    assert line == f"LLM_REPLAY purpose=classify run_id={RUN_IDS['01_certificate_of_incorporation.pdf']} document_id=42"
    assert not any(r.getMessage().startswith("LLM_USAGE") for r in caplog.records)  # nothing was billed


@pytest.mark.parametrize("run_id, purpose", [("../../etc/passwd", "classify"), ("e2168103e4d6", "../classify"), ("E2168103E4D6", "classify"),
                                            ("e2168103e4d", "classify"), ("e2168103e4d6", "classify.json"), (None, "classify"), ("", "classify")])
def test_a_hostile_or_malformed_key_can_never_name_a_file(replay_on, run_id, purpose):
    assert llm._replay_file(run_id, purpose) is None


def test_an_unreadable_fixture_is_a_miss_not_a_crash(monkeypatch, tmp_path, caplog):
    (tmp_path / "abcdef012345.classify.json").write_text("{ not json")
    (tmp_path / "abcdef012345.extract.json").write_text(json.dumps({"tool_name": "x", "arguments": "not a dict"}))
    monkeypatch.setenv("LLM_REPLAY_DIR", str(tmp_path))
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        for purpose in ("classify", "extract"):
            with pytest.raises(llm.LLMUnavailable):
                _call(purpose=purpose, run_id="abcdef012345")
    assert sum(r.getMessage().startswith("LLM_REPLAY_UNREADABLE") for r in caplog.records) == 2


# ---------------------------------------------------------------- the fixtures themselves


def _fixtures():
    return sorted(REPLAY.glob("*.json"))


def test_every_demo_pdf_has_a_classify_fixture_named_by_its_own_hash():
    assert len(RUN_IDS) == 8
    for name, run_id in RUN_IDS.items():
        assert (REPLAY / f"{run_id}.classify.json").is_file(), name


@pytest.mark.parametrize("path", _fixtures(), ids=lambda p: p.name)
def test_every_fixture_validates_against_the_schema_the_node_uses(path):
    fx = json.loads(path.read_text())
    assert path.name == f"{fx['run_id']}.{fx['purpose']}.json" and fx["run_id"] in RUN_IDS.values()
    args = fx["arguments"]
    if fx["purpose"] == "classify":
        assert fx["tool_name"] == classify_module.TOOL["function"]["name"]
        ClassifyResult(**args)
    elif fx["purpose"] == "extract":
        assert fx["tool_name"] in SCHEMAS and fx["tool_name"] in (extract_module.to_tool(cls, name, "d")["function"]["name"] for name, cls in SCHEMAS.items())
        SCHEMAS[fx["tool_name"]](**args)
    else:
        assert fx["purpose"] == "derive_events" and fx["tool_name"] == derive_events_module.TOOL["function"]["name"]
        ProposedEvent(**args)


@pytest.mark.parametrize("path", _fixtures(), ids=lambda p: p.name)
def test_every_fixture_says_which_fields_are_authored_and_which_are_recorded(path):
    fx = json.loads(path.read_text())
    prov = fx["provenance"]
    assert prov["source"]["db"] in ("data/jaga.db", "evals/demo_corpus/demo.db") and prov["built_on"]
    assert set(prov["fields"]) == set(fx["arguments"])
    if fx["purpose"] == "classify":
        assert prov["authored"] == ["description", "description_en", "bucket", "vendor_name"]
        assert {k for k, v in prov["fields"].items() if v == "authored"} == set(prov["authored"])
        assert prov["fields"]["lane"] == "recorded" and prov["fields"]["doc_type"] == "recorded"
    else:
        assert prov["authored"] == [] and all(v.startswith("recorded") for v in prov["fields"].values())


# ---------------------------------------------------------------- the whole pipeline on the recorded files, in the production configuration


def _login():
    resp = client.post("/api/auth/dev-login", json={"email": "owner@try-demo.test", "name": "Priya Ramanathan", "company_name": "Replay Co", "fye_month": 12, "fye_day": 31})
    assert resp.status_code == 200, resp.text
    return {"Authorization": "Bearer " + resp.json()["token"]}


def _upload(headers, name: str):
    return client.post("/api/documents", files={"file": (name, (PDFS / name).read_bytes(), "application/pdf")}, headers=headers)


def _row(document_id: int) -> dict:
    with get_conn() as conn:
        return dict(conn.execute("SELECT * FROM document WHERE id = ?", (document_id,)).fetchone())


def _fields(document_id: int) -> dict:
    with get_conn() as conn:
        return {r["field"]: json.loads(r["value_text"]) for r in conn.execute("SELECT field, value_text FROM extraction WHERE document_id = ?", (document_id,))}


def _trace(document_id: int, node: str) -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM trace WHERE document_id = ? AND node = ? ORDER BY id", (document_id, node))]


@pytest.fixture
def uploaded(replay_on, caplog):
    headers = _login()
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        ids = {}
        for name in RUN_IDS:
            resp = _upload(headers, name)
            assert resp.status_code == 200, (name, resp.text)
            ids[name] = resp.json()["document_id"]
    return {"headers": headers, "ids": ids, "caplog": caplog}


def test_the_recorded_files_take_the_real_pipeline_in_the_armed_switch_configuration(uploaded):
    ids = uploaded["ids"]
    for name in ("01_certificate_of_incorporation.pdf", "02_constitution.pdf", "03_notice_office_change.pdf", "04_notice_corpsec_change.pdf", "05_invoice_clean.pdf"):
        assert _row(ids[name])["status"] == "needs_review", name          # verify always asks a human (DECISIONS #40)
    cert = _row(ids["01_certificate_of_incorporation.pdf"])
    assert (cert["lane"], cert["doc_type"]) == ("statutory", "Certificate of Incorporation") and cert["bucket"] == "Statutory"
    assert _fields(ids["01_certificate_of_incorporation.pdf"])["reference_no"] == "202312345A"   # the recorded field, through the real extract node
    assert _fields(ids["05_invoice_clean.pdf"])["total"] == 348.8
    assert _row(ids["05_invoice_clean.pdf"])["vendor_name"] == "Straits Print Supplies Pte Ltd"


def test_the_gst_mismatch_invoice_lands_in_the_review_queue_with_its_reason(uploaded):
    doc = _row(uploaded["ids"]["06_invoice_bad_gst.pdf"])
    assert doc["status"] == "needs_review"
    queue = client.get("/api/review", headers=uploaded["headers"]).json()
    item = next(i for i in queue if i["document_id"] == doc["id"])
    assert "gst" in item["reason"].lower(), item["reason"]                 # the deterministic arithmetic check, from the recorded numbers
    assert _fields(doc["id"])["tax"] == 84.0 and _fields(doc["id"])["subtotal"] == 1200.0


def test_the_injection_attempt_is_quarantined_by_verifys_own_regex(uploaded):
    assert _row(uploaded["ids"]["07_invoice_injection_attempt.pdf"])["status"] == "quarantined"


def test_the_lease_is_important_and_makes_no_extraction_call(uploaded):
    doc = _row(uploaded["ids"]["08_lease_important.pdf"])
    assert doc["lane"] == "important" and doc["bucket"] == "Contracts"
    assert _trace(doc["id"], "extract") == [] and len(_trace(doc["id"], "classify")) == 1


def test_a_human_confirm_files_the_document_and_derive_events_runs_from_the_replayed_answer(uploaded):
    doc_id = uploaded["ids"]["01_certificate_of_incorporation.pdf"]
    item = next(i for i in client.get("/api/review", headers=uploaded["headers"]).json() if i["document_id"] == doc_id)
    resolved = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=uploaded["headers"])
    assert resolved.status_code == 200, resolved.text                    # a live checkpoint: not the 410 of a directly written item
    body = resolved.json()
    assert body["status"] == "filed" and body["events_derived"] is True and body["events"][0]["kind"] == "incorporation"
    with get_conn() as conn:
        event = dict(conn.execute("SELECT kind, occurred_on, title FROM event WHERE source_document_id = ?", (doc_id,)).fetchone())
    assert event == {"kind": "incorporation", "occurred_on": "2023-01-15", "title": "BRIGHT HARBOUR PTE. LTD. incorporated"}
    (derive,) = _trace(doc_id, "derive_events")
    assert derive["model"] == "replay" and derive["input_tokens"] == 0 and derive["output_tokens"] == 0 and derive["cost_usd"] == 0.0


def test_every_model_row_in_the_trace_says_replay_with_zero_tokens_and_no_client_was_built(uploaded):
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT node, model, input_tokens, output_tokens, cost_usd FROM trace WHERE model IS NOT NULL")]
    assert len(rows) == 8 + 7                                            # 8 classify + 7 extract (the lease has no extractor); derive_events waits for a confirm
    assert all(r["model"] == "replay" and r["input_tokens"] == 0 and r["output_tokens"] == 0 and r["cost_usd"] == 0.0 for r in rows)
    lines = [r.getMessage() for r in uploaded["caplog"].get_records("setup")]  # the uploads ran in the fixture (the setup phase)
    assert sum(l.startswith("LLM_REPLAY ") for l in lines) == 15 and not any(l.startswith("LLM_USAGE") for l in lines)
    # a client constructor that fails the test was in place for every call above (the replay_on fixture): none was reached


def test_an_unrecorded_file_in_that_same_configuration_gets_the_503_and_leaves_nothing_behind(replay_on):
    headers = _login()
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, "TAX INVOICE Nobody Recorded This Ltd Invoice No: NR-1 Total: SGD 10.00")
    c.save()
    files_before = sorted(p.name for p in DOCS.iterdir())
    resp = client.post("/api/documents", files={"file": ("unrecorded.pdf", buf.getvalue(), "application/pdf")}, headers=headers)
    assert resp.status_code == 503 and resp.json()["detail"]["code"] == "ai_unavailable"
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == 0 and conn.execute("SELECT COUNT(*) FROM document_activity").fetchone()[0] == 0
    assert sorted(p.name for p in DOCS.iterdir()) == files_before


def test_uploading_a_recorded_file_a_second_time_is_a_duplicate_and_costs_nothing(uploaded):
    again = _upload(uploaded["headers"], "05_invoice_clean.pdf")
    assert again.status_code == 200 and again.json()["status"] == "duplicate"


# ---------------------------------------------------------------- the server says it is in replay mode, and says so at boot


def test_health_reports_replay_as_a_bare_yes_or_no(monkeypatch):
    monkeypatch.delenv("LLM_REPLAY_DIR", raising=False)
    assert client.get("/api/health").json() == {"status": "ok", "replay": False}
    monkeypatch.setenv("LLM_REPLAY_DIR", str(REPLAY))
    assert client.get("/api/health").json() == {"status": "ok", "replay": True}   # a boolean: no path, no other detail


def test_startup_warns_loudly_when_replay_is_on(monkeypatch, caplog):
    monkeypatch.setenv("LLM_REPLAY_DIR", str(REPLAY))
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        main_module.startup()
    (line,) = [r.getMessage() for r in caplog.records if "LLM_REPLAY_DIR is ON" in r.getMessage()]
    assert "DECISIONS #134" in line and "2026-09-28" in line
    caplog.clear()
    monkeypatch.delenv("LLM_REPLAY_DIR")
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        main_module.startup()
    assert not any("LLM_REPLAY_DIR" in r.getMessage() for r in caplog.records)
