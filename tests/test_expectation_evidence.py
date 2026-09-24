"""A satisfied compliance-checklist row knows WHICH document satisfied it
(2026-09-24, round 16, DECISIONS #90).

`expectation` stored only a status; the checklist could say "held" but not show
the file. `expectation.evidence_document_id` (same pattern as
obligation.evidence_document_id) is set wherever a match is found, and
GET /api/expectations sends it only to a caller who may see that document.

Real uploads through POST /api/documents, real confirms through
POST /api/review/.../resolve; only the model is canned, so derive_expectations
(the code under test) runs for real. What counts as "satisfied" did not change,
and the last tests pin that.
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
from app.graph.derive_expectations import backfill_expectation_evidence
from app.llm import LLMResult
from app.main import app

client = TestClient(app)

INCORPORATION = {"kind": "incorporation", "occurred_on": "2026-01-15", "title": "Company incorporated", "confidence": 0.9}


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
    c.drawString(72, 760, f"STATUTORY DOCUMENT {tag}")
    c.drawString(72, 740, "Issued in respect of the company named above on 15 January 2026.")
    c.save()
    return buf.getvalue()


def _prov(value, confidence: float = 0.95):
    return {"value": value, "confidence": confidence, "page": 1}


@pytest.fixture
def model(monkeypatch) -> dict:
    """Canned classify (doc_type set per test), extract and derive_events. The
    event is an incorporation unless a test sets `event` to None."""
    state = {"doc_type": "Certificate of Incorporation", "event": INCORPORATION}

    def fake_classify(model_name, system, user, **kwargs):
        return _tool("classify_document", {
            "lane": "statutory", "doc_type": state["doc_type"], "confidence": 0.96, "injection_suspected": False,
            "bucket": "Statutory", "vendor_name": None,
            "description": f"{state['doc_type']} for the company", "description_en": f"{state['doc_type']} for the company",
        }, model_name)

    def fake_extract(model_name, system, user, **kwargs):
        return _tool("extract_statutory_fields", {
            "doc_type": _prov(state["doc_type"]), "subject": _prov("The company"), "issued_on": _prov("2026-01-15"),
        }, model_name)

    def fake_derive(model_name, system, user, **kwargs):
        if state["event"] is None:
            return LLMResult(content="no_event", model=model_name, input_tokens=1, output_tokens=1,
                             cost_usd=0.0, latency_ms=1, tool_calls=[])
        return _tool("propose_event", state["event"], model_name)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    monkeypatch.setattr(derive_events_module, "call", fake_derive)
    return state


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@evidence.test", "company_name": "Evidence Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user", "user"), ("viewer", "viewer")]:
        email = f"{name}@evidence.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members", json={"email": email, "role": role},
            headers=_headers(owner["token"]),
        ).status_code == 200
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return tokens


def _upload(token: str, tag: str) -> int:
    resp = client.post("/api/documents", headers=_headers(token),
                       files={"file": (f"{tag}.pdf", _pdf(tag), "application/pdf")})
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm(token: str, document_id: int) -> None:
    item = next(i for i in client.get("/api/review", headers=_headers(token)).json() if i["document_id"] == document_id)
    resp = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text


def _checklist(token: str) -> dict[str, dict]:
    rows = client.get("/api/expectations", headers=_headers(token)).json()
    return {r["doc_type"]: r for r in rows}


def _incorporate(team: dict, model: dict) -> int:
    """Upload + confirm the certificate, which raises the incorporation event and
    with it the four expectations. Returns the certificate's document id."""
    model["doc_type"] = "Certificate of Incorporation"
    document_id = _upload(team["owner"], "certificate")
    _confirm(team["owner"], document_id)
    return document_id


def test_a_row_satisfied_when_it_is_created_names_the_document_that_did_it(team, model):
    certificate = _incorporate(team, model)

    checklist = _checklist(team["owner"])

    assert checklist["certificate_of_incorporation"]["status"] == "satisfied"
    assert checklist["certificate_of_incorporation"]["evidence_document_id"] == certificate
    for missing in ("constitution", "share_register", "annual_return"):
        assert checklist[missing]["status"] == "missing"
        assert checklist[missing]["evidence_document_id"] is None


def test_a_document_that_arrives_later_satisfies_the_row_and_becomes_its_evidence(team, model):
    _incorporate(team, model)
    model["doc_type"], model["event"] = "Company Constitution", None
    constitution = _upload(team["owner"], "constitution")

    _confirm(team["owner"], constitution)

    row = _checklist(team["owner"])["constitution"]
    assert (row["status"], row["evidence_document_id"]) == ("satisfied", constitution)


def test_a_satisfied_row_keeps_its_evidence_when_a_second_matching_document_arrives(team, model):
    _incorporate(team, model)
    model["event"] = None
    model["doc_type"] = "Company Constitution"
    first = _upload(team["owner"], "constitution-a")
    _confirm(team["owner"], first)
    second = _upload(team["owner"], "constitution-b")
    _confirm(team["owner"], second)
    # Already satisfied by the first; a second matching document does not move
    # the link (a satisfied row is never re-evaluated).
    assert _checklist(team["owner"])["constitution"]["evidence_document_id"] == first


def test_a_pending_colleagues_upload_is_never_shown_as_evidence_to_someone_who_cannot_see_it(team, model):
    """`user` cannot see another user's pending upload (DECISIONS #83); the checklist
    must not reveal it by linking to it. Owner and admin, who review it, may."""
    _incorporate(team, model)
    model["event"], model["doc_type"] = None, "Company Constitution"
    pending = _upload(team["user"], "users-pending-constitution")  # left unconfirmed
    model["doc_type"] = "Certificate of Incorporation"
    other = _upload(team["owner"], "second-certificate")
    _confirm(team["owner"], other)  # any confirm re-checks every open row

    assert _checklist(team["owner"])["constitution"]["evidence_document_id"] == pending
    assert _checklist(team["admin"])["constitution"]["evidence_document_id"] == pending
    assert _checklist(team["user"])["constitution"]["evidence_document_id"] == pending  # their own upload
    assert _checklist(team["viewer"])["constitution"]["evidence_document_id"] is None
    # The status itself is company state and is not hidden.
    assert _checklist(team["viewer"])["constitution"]["status"] == "satisfied"


def test_evidence_that_has_since_been_deleted_is_not_offered(team, model):
    certificate = _incorporate(team, model)
    assert client.post(f"/api/documents/{certificate}/archive", headers=_headers(team["owner"])).status_code == 200

    row = _checklist(team["owner"])["certificate_of_incorporation"]

    assert row["status"] == "satisfied"  # a deleted file does not un-satisfy history
    assert row["evidence_document_id"] is None


def test_a_deleted_document_no_longer_counts_as_held_for_a_still_missing_row(team, model):
    _incorporate(team, model)
    model["event"], model["doc_type"] = None, "Company Constitution"
    constitution = _upload(team["owner"], "constitution")
    _confirm(team["owner"], constitution)
    # A second, never-satisfied row: annual return. Archive a matching document,
    # then confirm something else: the row must stay missing, not link to it.
    model["doc_type"] = "Annual Return"
    annual = _upload(team["owner"], "annual-return")
    assert client.post(f"/api/documents/{annual}/archive", headers=_headers(team["owner"])).status_code == 200
    model["doc_type"] = "Certificate of Incorporation"
    _confirm(team["owner"], _upload(team["owner"], "another-certificate"))

    row = _checklist(team["owner"])["annual_return"]

    assert (row["status"], row["evidence_document_id"]) == ("missing", None)


def test_startup_backfill_gives_an_already_satisfied_row_its_document(team, model):
    certificate = _incorporate(team, model)
    with get_conn() as conn:  # a row satisfied before the column existed
        conn.execute("UPDATE expectation SET evidence_document_id = NULL")
    assert _checklist(team["owner"])["certificate_of_incorporation"]["evidence_document_id"] is None

    backfill_expectation_evidence()

    row = _checklist(team["owner"])["certificate_of_incorporation"]
    assert (row["status"], row["evidence_document_id"]) == ("satisfied", certificate)
    backfill_expectation_evidence()  # idempotent
    assert _checklist(team["owner"])["certificate_of_incorporation"]["evidence_document_id"] == certificate


def test_a_personal_file_never_satisfies_or_evidences_a_row(team, model):
    _incorporate(team, model)
    model["event"], model["doc_type"] = None, "Company Constitution"
    resp = client.post("/api/documents?visibility=only_me", headers=_headers(team["owner"]),
                       files={"file": ("private.pdf", _pdf("private"), "application/pdf")})
    _confirm(team["owner"], resp.json()["document_id"])

    row = _checklist(team["owner"])["constitution"]

    assert (row["status"], row["evidence_document_id"]) == ("missing", None)


def test_the_checklist_is_still_scoped_to_the_callers_company(team, model):
    _incorporate(team, model)
    outsider = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@elsewhere.test", "company_name": "Elsewhere Co", "fye_month": 1, "fye_day": 1},
    ).json()["token"]

    assert client.get("/api/expectations", headers=_headers(outsider)).json() == []


# ---- the startup backfill: does it run, and what does it say when it cannot link a row --------

def _satisfied_row_without_evidence(doc_type_held: str | None, *, status: str = "filed", visibility: str = "company") -> dict:
    """A company with one expectation that is 'satisfied' but has no evidence (the shape of a row
    satisfied before the column existed), and, unless doc_type_held is None, one document."""
    with get_conn() as conn:
        company = conn.execute("INSERT INTO company (name, fye_month, fye_day) VALUES ('Backfill Co', 12, 31)").lastrowid
        document = None
        if doc_type_held is not None:
            document = conn.execute(
                "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, doc_type, status, visibility) "
                "VALUES (?, 'sha-backfill', 'held.pdf', 'application/pdf', 1, 'x', 'web', ?, ?, ?)",
                (company, doc_type_held, status, visibility),
            ).lastrowid
        expectation = conn.execute(
            "INSERT INTO expectation (company_id, doc_type, label, rule_id, status) VALUES (?, 'certificate_of_incorporation', 'Certificate of Incorporation', 'k1', 'satisfied')",
            (company,),
        ).lastrowid
    return {"company": company, "document": document, "expectation": expectation}


def _evidence_of(expectation_id: int):
    with get_conn() as conn:
        return conn.execute("SELECT status, evidence_document_id FROM expectation WHERE id = ?", (expectation_id,)).fetchone()


def test_the_app_startup_runs_the_backfill_on_every_start():
    """Through the real startup hook, not by calling the function: the round-16 tests called
    backfill_expectation_evidence() directly, so nothing failed when the call in startup() was
    not what made a production row link."""
    world = _satisfied_row_without_evidence("Certificate of Incorporation")
    assert _evidence_of(world["expectation"])["evidence_document_id"] is None

    with TestClient(app):  # entering the context runs the app's startup events
        pass

    row = _evidence_of(world["expectation"])
    assert (row["status"], row["evidence_document_id"]) == ("satisfied", world["document"])

    with TestClient(app):  # a second start changes nothing
        pass
    assert _evidence_of(world["expectation"])["evidence_document_id"] == world["document"]


@pytest.mark.parametrize("held,status,visibility,why", [
    (None, "filed", "company", "the company holds no document at all"),
    ("Certificate of Incorporation", "archived", "company", "its document was deleted (archived)"),
    ("Certificate of Incorporation", "filed", "only_me", "its document is a personal file"),
    ("Certificate of Incorporation", "quarantined", "company", "its document is quarantined"),
    ("contract", "filed", "company", "its document is now typed as something that does not match"),
])
def test_a_satisfied_row_no_held_document_matches_stays_as_it_is_and_the_startup_says_why(held, status, visibility, why, caplog):
    world = _satisfied_row_without_evidence(held, status=status, visibility=visibility)

    with caplog.at_level("WARNING"):
        with TestClient(app):
            pass

    row = _evidence_of(world["expectation"])
    assert (row["status"], row["evidence_document_id"]) == ("satisfied", None), why
    lines = [r.getMessage() for r in caplog.records if "expectation evidence backfill" in r.getMessage()]
    assert len(lines) == 1, why
    assert f"expectation {world['expectation']}" in lines[0] and "'certificate_of_incorporation'" in lines[0]
    assert "no held document matches" in lines[0]
    assert ("['contract']" in lines[0]) is (held == "contract"), "the log names what the company DOES hold"


def test_only_the_rows_it_could_not_link_are_reported():
    from app.graph.derive_expectations import backfill_expectation_evidence

    world = _satisfied_row_without_evidence("Certificate of Incorporation")
    with get_conn() as conn:
        stray = conn.execute(
            "INSERT INTO expectation (company_id, doc_type, label, rule_id, status) VALUES (?, 'constitution', 'Company Constitution', 'k2', 'satisfied')",
            (world["company"],),
        ).lastrowid

    unlinked = backfill_expectation_evidence()

    assert len(unlinked) == 1 and f"expectation {stray}" in unlinked[0]
    assert _evidence_of(world["expectation"])["evidence_document_id"] == world["document"]
    assert _evidence_of(stray)["evidence_document_id"] is None
