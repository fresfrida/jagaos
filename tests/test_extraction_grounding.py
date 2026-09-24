"""What the pipeline stores about a document must be grounded in the document
(2026-09-24, round 15, DECISIONS #89), end to end: a real upload through
POST /api/documents, real text extraction, the real classify node with its
grounding step, real persistence and search indexing. Only the model is replaced
(canned tool calls, recorded) — so the check being tested runs for real, and the
canned answers are exactly what the real gateway model wrote:

  - for the bug, the old prompt's answer for a business profile that never names
    an authority ("ACRA Business Profile for Sunbird Catering Services ...");
  - for the regression side, the answers it wrote for the repository's own demo
    invoice, lease, notices and constitution.

The same flow against the real gateway is
tests/test_gateway_live.py::test_a_profile_that_names_no_authority_is_described_only_with_what_it_says.
"""

import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

import app.graph.classify as classify_module
import app.graph.extract as extract_module
from app.db import get_conn, parse_description
from app.llm import LLMResult
from app.main import app
from app.rules.grounding import Source, ungrounded_names

client = TestClient(app)
CORPUS = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files"

PROFILE_LINES = [
    "BUSINESS PROFILE SUMMARY", "",
    "Entity Name: SUNBIRD CATERING SERVICES PTE. LTD.", "Unique Entity Number: 202398765M",
    "Registered Office: 55 TIONG BAHRU ROAD #03-11 SINGAPORE 160055", "Director: LEE MEI LING",
]


def _profile_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(PROFILE_LINES):
        c.drawString(72, 760 - i * 16, line)
    c.save()
    return buf.getvalue()


def _tool(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(
        content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}],
    )


def _prov(value, confidence: float = 0.95):
    return {"value": value, "confidence": confidence, "page": 1}


def _model(monkeypatch, *, classify: dict, extract_name: str, extract_args: dict) -> None:
    monkeypatch.setattr(classify_module, "call", lambda m, system, user, **kw: _tool("classify_document", classify, m))
    monkeypatch.setattr(extract_module, "call", lambda m, system, user, **kw: _tool(extract_name, extract_args, m))


def _signup(company: str = "Grounding Co") -> str:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": f"{company.replace(' ', '').lower()}@example.com", "company_name": company, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _upload(token: str, name: str, data: bytes, language: str | None = None) -> dict:
    suffix = f"?language={language}" if language else ""
    resp = client.post(f"/api/documents{suffix}", headers={"Authorization": f"Bearer {token}"},
                       files={"file": (name, data, "application/pdf")})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _document(document_id: int) -> dict:
    with get_conn() as conn:
        return dict(conn.execute("SELECT * FROM document WHERE id = ?", (document_id,)).fetchone())


def _grounding_trace(document_id: int) -> list[str]:
    with get_conn() as conn:
        return [r["decision"] for r in conn.execute(
            "SELECT decision FROM trace WHERE document_id = ? AND node = 'classify_grounding'", (document_id,)).fetchall()]


PROFILE_ANSWER = {
    "lane": "statutory", "doc_type": "ACRA Business Profile", "confidence": 0.97, "injection_suspected": False,
    "bucket": "Statutory", "vendor_name": "SUNBIRD CATERING SERVICES PTE. LTD.",
    "description": "ACRA Business Profile for Sunbird Catering Services Pte. Ltd., UEN 202398765M",
    "description_en": "ACRA Business Profile for Sunbird Catering Services Pte. Ltd., UEN 202398765M",
}
PROFILE_FIELDS = {"company_name": _prov("SUNBIRD CATERING SERVICES PTE. LTD."), "uen": _prov("202398765M")}


# --- the bug ---------------------------------------------------------------------------


def test_a_profile_that_names_no_authority_is_not_described_as_an_acra_document(monkeypatch):
    _model(monkeypatch, classify=PROFILE_ANSWER, extract_name="extract_company_profile_fields", extract_args=PROFILE_FIELDS)
    token = _signup()

    doc = _document(_upload(token, "profile.pdf", _profile_pdf())["document_id"])

    stored = parse_description(doc["description"])["en"]
    assert "ACRA" not in stored and "ACRA" not in (doc["doc_type"] or "")
    assert stored == "Business Profile for Sunbird Catering Services Pte. Ltd., UEN 202398765M"
    assert doc["doc_type"] == "Business Profile"
    assert doc["vendor_name"] is None, "the company a profile is ABOUT is not its vendor"


def test_the_stored_description_names_nothing_the_source_text_does_not(monkeypatch):
    _model(monkeypatch, classify=PROFILE_ANSWER, extract_name="extract_company_profile_fields", extract_args=PROFILE_FIELDS)
    doc = _document(_upload(_signup(), "profile.pdf", _profile_pdf())["document_id"])

    for text in parse_description(doc["description"]).values():
        assert ungrounded_names(text, Source.of(doc["extracted_text"])) == [], text


def test_the_invented_name_is_never_indexed_so_search_cannot_find_it(monkeypatch):
    _model(monkeypatch, classify=PROFILE_ANSWER, extract_name="extract_company_profile_fields", extract_args=PROFILE_FIELDS)
    doc_id = _upload(_signup(), "profile.pdf", _profile_pdf())["document_id"]

    # The index itself is asked, not GET /api/search: since round 16 (DECISIONS #90)
    # a business profile is filtered out of search results by design, which would
    # make "no ACRA hit" true for the wrong reason.
    def indexed(term: str) -> list[int]:
        with get_conn() as conn:
            return [r["rowid"] for r in conn.execute(
                "SELECT rowid FROM document_search WHERE document_search MATCH ?", (term,)).fetchall()]

    assert indexed("ACRA") == []
    assert indexed("Sunbird") == [doc_id]


def test_what_was_changed_is_recorded_in_the_trace(monkeypatch):
    _model(monkeypatch, classify=PROFILE_ANSWER, extract_name="extract_company_profile_fields", extract_args=PROFILE_FIELDS)
    doc_id = _upload(_signup(), "profile.pdf", _profile_pdf())["document_id"]

    notes = _grounding_trace(doc_id)
    assert len(notes) == 1 and "ACRA" in notes[0] and "vendor_name" in notes[0] and "doc_type" in notes[0]


def test_the_review_card_gets_no_vendor_for_a_profile(monkeypatch):
    _model(monkeypatch, classify=PROFILE_ANSWER, extract_name="extract_company_profile_fields", extract_args=PROFILE_FIELDS)
    token = _signup()
    doc_id = _upload(token, "profile.pdf", _profile_pdf())["document_id"]

    item = next(i for i in client.get("/api/review", headers={"Authorization": f"Bearer {token}"}).json() if i["document_id"] == doc_id)
    assert item["document_vendor_name"] is None and item["document_doc_type"] == "Business Profile"


def test_a_translated_description_that_repeats_the_invented_name_is_dropped_too(monkeypatch):
    answer = dict(PROFILE_ANSWER, description="Profil Perniagaan ACRA untuk Sunbird Catering Services Pte. Ltd.")
    _model(monkeypatch, classify=answer, extract_name="extract_company_profile_fields", extract_args=PROFILE_FIELDS)
    doc = _document(_upload(_signup(), "profile.pdf", _profile_pdf(), language="ms")["document_id"])

    by_language = parse_description(doc["description"])
    assert set(by_language) == {"en"}, "the Malay sentence named ACRA too, so only the grounded English is stored"
    assert "ACRA" not in by_language["en"]


def test_an_invented_authority_on_an_invoice_is_caught_too_not_just_on_profiles(monkeypatch):
    answer = {
        "lane": "invoice", "doc_type": "invoice", "confidence": 0.95, "injection_suspected": False, "bucket": "Expenses",
        "vendor_name": "Zenith Office Supplies", "description": "Invoice from Zenith Office Supplies for stationery, SGD 348.80",
        "description_en": "Invoice from Zenith Office Supplies for stationery, SGD 348.80",
    }
    fields = {"vendor": _prov("Straits Print Supplies Pte Ltd"), "invoice_no": _prov("SP-2026-1187"), "issued_on": _prov("2026-07-03"),
              "subtotal": _prov(320.0), "tax": _prov(28.8), "currency": _prov("SGD"), "total": _prov(348.8)}
    _model(monkeypatch, classify=answer, extract_name="extract_invoice_fields", extract_args=fields)
    doc = _document(_upload(_signup("Invoice Co"), "05_invoice_clean.pdf", (CORPUS / "05_invoice_clean.pdf").read_bytes())["document_id"])

    assert doc["vendor_name"] is None
    assert "Zenith" not in parse_description(doc["description"])["en"]


# --- the regression side: documents that were extracting correctly still do ----------------------------------------------


def _demo(monkeypatch, name: str, classify: dict, extract_name: str, extract_args: dict, company: str = "Grounding Co"):
    _model(monkeypatch, classify=classify, extract_name=extract_name, extract_args=extract_args)
    token = _signup(company)
    doc_id = _upload(token, name, (CORPUS / name).read_bytes())["document_id"]
    review = next(i for i in client.get("/api/review", headers={"Authorization": f"Bearer {token}"}).json() if i["document_id"] == doc_id)
    return _document(doc_id), review, doc_id


def test_the_demo_invoice_still_extracts_and_verifies_cleanly_through_the_same_path(monkeypatch):
    answer = {
        "lane": "invoice", "doc_type": "invoice", "confidence": 0.97, "injection_suspected": False, "bucket": "Expenses",
        "vendor_name": "Straits Print Supplies Pte Ltd",
        "description": "Invoice from Straits Print Supplies Pte Ltd for company stationery and letterhead printing, SGD 348.80",
        "description_en": "Invoice from Straits Print Supplies Pte Ltd for company stationery and letterhead printing, SGD 348.80",
    }
    fields = {"vendor": _prov("Straits Print Supplies Pte Ltd"), "invoice_no": _prov("SP-2026-1187"), "issued_on": _prov("2026-07-03"),
              "subtotal": _prov(320.0), "tax": _prov(28.8), "currency": _prov("SGD"), "total": _prov(348.8)}
    doc, review, doc_id = _demo(monkeypatch, "05_invoice_clean.pdf", answer, "extract_invoice_fields", fields, "Invoice Co")

    assert parse_description(doc["description"])["en"] == answer["description"]
    assert doc["vendor_name"] == "Straits Print Supplies Pte Ltd" and doc["doc_type"] == "invoice"
    assert review["reason"] == "clean", "verify found nothing wrong with a correct invoice"
    assert _grounding_trace(doc_id) == []


def test_a_notice_whose_page_prints_the_authority_keeps_it(monkeypatch):
    answer = {
        "lane": "statutory", "doc_type": "ACRA Notice of Change of Registered Office", "confidence": 0.95, "injection_suspected": False,
        "bucket": "Statutory", "vendor_name": "ACRA",
        "description": "ACRA notice of change of registered office for Bright Harbour Pte. Ltd. to 10 Anson Road, #22-01, effective 1 March 2026",
        "description_en": "ACRA notice of change of registered office for Bright Harbour Pte. Ltd. to 10 Anson Road, #22-01, effective 1 March 2026",
    }
    fields = {"doc_type": _prov(answer["doc_type"]), "subject": _prov("Change of registered office")}
    doc, review, doc_id = _demo(monkeypatch, "03_notice_office_change.pdf", answer, "extract_statutory_fields", fields, "Bright Harbour Pte Ltd")

    assert parse_description(doc["description"])["en"] == answer["description"]
    assert doc["doc_type"] == answer["doc_type"], "the page prints ACRA, so the label stays"
    assert doc["vendor_name"] == "ACRA" and _grounding_trace(doc_id) == []


def test_the_demo_lease_keeps_its_landlord_as_the_vendor(monkeypatch):
    answer = {
        "lane": "important", "doc_type": "contract", "confidence": 0.95, "injection_suspected": False, "bucket": "Contracts",
        "vendor_name": "Marina Bay Properties Pte Ltd",
        "description": "Office lease agreement with Marina Bay Properties Pte Ltd for premises at 10 Anson Road, SGD 4,500 monthly rent",
        "description_en": "Office lease agreement with Marina Bay Properties Pte Ltd for premises at 10 Anson Road, SGD 4,500 monthly rent",
    }
    doc, _, doc_id = _demo(monkeypatch, "08_lease_important.pdf", answer, "extract_invoice_fields", {}, "Bright Harbour Pte Ltd")

    assert doc["vendor_name"] == "Marina Bay Properties Pte Ltd" and _grounding_trace(doc_id) == []


def test_a_document_about_this_company_does_not_name_it_as_its_own_vendor(monkeypatch):
    answer = {
        "lane": "important", "doc_type": "contract", "confidence": 0.9, "injection_suspected": False, "bucket": "Contracts",
        "vendor_name": "Bright Harbour Pte. Ltd.", "description": "Constitution of Bright Harbour Pte. Ltd., adopted 15 January 2023",
        "description_en": "Constitution of Bright Harbour Pte. Ltd., adopted 15 January 2023",
    }
    doc, _, doc_id = _demo(monkeypatch, "02_constitution.pdf", answer, "extract_invoice_fields", {}, "Bright Harbour Pte Ltd")

    assert doc["vendor_name"] is None
    assert parse_description(doc["description"])["en"] == answer["description"], "the description was grounded and stays"
    assert "this company itself" in _grounding_trace(doc_id)[0]
