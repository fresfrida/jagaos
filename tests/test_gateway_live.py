"""Live-gateway smoke test. Opt-in only: skips unless RUN_LIVE_GATEWAY_TESTS=1 is
set, on top of needing LLM_GATEWAY_API_KEY — this is the one test file in the
suite that spends real tokens and touches the network, so it stays separate
from tests/test_rules_smoke.py's offline checks and out of the default
`pytest tests/` run (a full run with .env present used to fire all of these
every time, which is real gateway budget spent just from running the suite).

Run: RUN_LIVE_GATEWAY_TESTS=1 pytest tests/test_gateway_live.py -v -s
"""

import os
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv()

pytestmark = pytest.mark.skipif(
    not (os.environ.get("LLM_GATEWAY_API_KEY") and os.environ.get("RUN_LIVE_GATEWAY_TESTS") == "1"),
    reason="set RUN_LIVE_GATEWAY_TESTS=1 (and LLM_GATEWAY_API_KEY) to run this — spends real gateway tokens",
)

SAMPLE_INVOICE_TEXT = """Acme Supplies Pte Ltd
Invoice No: INV-2026-0042
Date: 15 March 2026
GST Reg No: M12345678X

Item: Office supplies
Subtotal: SGD 500.00
GST (9%): SGD 45.00
Total: SGD 545.00"""


@pytest.fixture
def seeded_company():
    """Uses the shared test DB from conftest.py (reset before every test)
    rather than its own tmp_path — see conftest.py's docstring: modules
    under app/ bind DB_PATH once at first import, so a fixture pointing at
    its own private db here would be silently ignored by app.graph.*."""
    from app.db import get_conn

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO company (id, name, fye_month, fye_day) "
            "VALUES (1, 'Test Pte Ltd', 12, 31)"
        )
        conn.execute(
            "INSERT INTO document (id, company_id, sha256, filename, media_type, "
            "bytes, stored_path, source_channel, status) VALUES "
            "(1, 1, ?, 'invoice.pdf', 'application/pdf', 100, '/tmp/x', 'web', 'received')",
            (uuid.uuid4().hex,),
        )


def test_classify_then_extract_then_verify_on_real_invoice(seeded_company):
    from app.db import get_conn
    from app.graph.classify import classify
    from app.graph.extract import extract
    from app.graph.verify import verify

    state = {
        "run_id": "gateway_smoke",
        "company_id": 1,
        "document_id": 1,
        "text": SAMPLE_INVOICE_TEXT,
        "text_source": "pdfplumber",
    }

    state.update(classify(state))
    assert state["classify_result"]["lane"] == "invoice"
    # DECISIONS #42: classify.py always proposes Expenses for lane=invoice —
    # it runs before extraction, so it can't yet know whether the vendor is
    # this company itself.
    assert state["classify_result"]["bucket"] == "Expenses"

    state.update(extract(state))
    fields = state["extract_result"]
    for field in ("subtotal", "tax", "total"):  # 2026-09-24: gst renamed to tax (item 10)
        assert field in fields, f"{field} missing from extraction — {fields}"
        assert fields[field]["value"] is not None

    # DECISIONS #42's amendment: the invoice's vendor ("Acme Supplies Pte
    # Ltd") doesn't match the seeded company's own name ("Test Pte Ltd"),
    # so extract.py must leave classify.py's provisional Expenses as-is —
    # not flip it to Receivables. bucket lives on the document row, not in
    # extract_result (extract.py writes it directly, deterministically).
    with get_conn() as conn:
        doc = conn.execute("SELECT bucket, occurred_on FROM document WHERE id = 1").fetchone()
    assert doc["bucket"] == "Expenses"
    # DECISIONS #42's occurred_on gap fix: populated from the invoice's own
    # issued_on date ("15 March 2026" in SAMPLE_INVOICE_TEXT above), not
    # left null the way only-EXIF-populates-it used to leave every invoice.
    assert doc["occurred_on"] == "2026-03-15"

    state.update(verify(state))
    assert state["verify_result"]["ok"] is True, state["verify_result"]["reasons"]
    # 2026-09-22 (DECISIONS #40): no document is ever auto-filed, even a
    # clean one — needs_review is now unconditional outside the injection
    # quarantine branch. `ok=True` here is what still distinguishes "clean"
    # from "flagged" now that both go to review.
    assert state["verify_result"]["needs_review"] is True


SAMPLE_SELF_ISSUED_INVOICE_TEXT = """Test Pte Ltd
Invoice No: INV-2026-0099
Date: 20 March 2026
GST Reg No: M87654321X

Bill To: Some Customer Pte Ltd

Item: Consulting services
Subtotal: SGD 1000.00
GST (9%): SGD 90.00
Total: SGD 1090.00"""


def test_extract_flips_bucket_to_receivables_when_vendor_is_this_company(seeded_company):
    # DECISIONS #42's amendment: an invoice this company itself issued (its
    # own name as the vendor line) must land in Receivables, not the
    # Expenses default — the one case classify.py's prompt explicitly can't
    # resolve on its own (see SYSTEM in app/graph/classify.py).
    from app.db import get_conn
    from app.graph.classify import classify
    from app.graph.extract import extract

    state = {
        "run_id": "gateway_smoke_receivables",
        "company_id": 1,
        "document_id": 1,
        "text": SAMPLE_SELF_ISSUED_INVOICE_TEXT,
        "text_source": "pdfplumber",
    }

    state.update(classify(state))
    assert state["classify_result"]["lane"] == "invoice"

    state.update(extract(state))
    vendor = state["extract_result"]["vendor"]["value"]
    assert vendor, f"expected a vendor to be extracted — {state['extract_result']}"

    with get_conn() as conn:
        doc = conn.execute("SELECT bucket FROM document WHERE id = 1").fetchone()
    # seeded_company's name is "Test Pte Ltd" (this file's fixture above) —
    # the same name SAMPLE_SELF_ISSUED_INVOICE_TEXT uses as its vendor line.
    assert doc["bucket"] == "Receivables", (
        f"vendor {vendor!r} should have matched company 'Test Pte Ltd'"
    )


SAMPLE_STATUTORY_TEXT = """ACRA Notice of Change of Registered Office

To: The Directors, Test Pte Ltd (UEN: 202612345A)

This is to notify you that the company's registered office address has
been changed with effect from 1 February 2026 to:
1 Marina Boulevard, #28-00, Singapore 018989

This notification is filed pursuant to Section 142 of the Companies Act.

Please retain this notice for your records."""


def test_derive_events_on_real_statutory_letter(seeded_company):
    from app.graph.derive_events import derive_events

    state = {
        "run_id": "gateway_smoke_events",
        "company_id": 1,
        "document_id": 1,
        "text": SAMPLE_STATUTORY_TEXT,
        "text_source": "pdfplumber",
        "classify_result": {"lane": "statutory", "doc_type": "notice_of_change"},
        "verify_result": {"ok": True, "needs_review": False},
    }

    result = derive_events(state)
    events = result["events"]
    assert len(events) == 1, f"expected one proposed event, got {events}"
    assert events[0]["kind"] == "office_move"
    assert events[0]["occurred_on"] == "2026-02-01"


def test_diagnose_raw_tool_call_shape():
    """Not an assertion test — prints the gateway's raw tool-call arguments
    and the schema we sent, so a field-dropping mismatch is visible without
    an ad hoc script. Run with -s to see output."""
    import json

    from app.guards.injection import UNTRUSTED_TEMPLATE
    from app.llm import call
    from app.models import InvoiceFields, to_tool

    tool = to_tool(InvoiceFields, "extract_invoice_fields", "Extract invoice fields.")
    print("\n--- SCHEMA required ---")
    print(tool["function"]["parameters"].get("required"))
    print("--- SCHEMA properties keys ---")
    print(list(tool["function"]["parameters"].get("properties", {}).keys()))

    user = UNTRUSTED_TEMPLATE.format(document_text=SAMPLE_INVOICE_TEXT)
    r = call(
        "sonnet4.5", "Extract fields.", user, tools=[tool],
        tool_choice={"type": "function", "function": {"name": "extract_invoice_fields"}},
    )
    print("--- RAW ARGS ---")
    print(r.tool_calls[0]["function"]["arguments"])
    print("--- finish info ---")
    print("input_tokens", r.input_tokens, "output_tokens", r.output_tokens)


# --- round 12 (DECISIONS #79): a real ACRA-shaped PDF through the real pipeline ---


def _upload_sample_and_confirm(pdf_name: str, email: str) -> tuple[dict, dict, int]:
    """Uploads evals/samples/files/<pdf_name> through the real POST
    /api/documents (ingest, real gateway classify + extract, verify), has the
    owner confirm it in the review queue, and returns (extracted fields the
    review card would show, the prefill endpoint's answer, document id)."""
    import json
    from pathlib import Path

    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": "Old Name Pte Ltd", "fye_month": 12, "fye_day": 31},
    ).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}
    sample = Path(__file__).parent.parent / "evals" / "samples" / "files" / pdf_name
    resp = client.post(
        "/api/documents", headers=headers, files={"file": (pdf_name, sample.read_bytes(), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]

    item = next(i for i in client.get("/api/review", headers=headers).json() if i["document_id"] == document_id)
    proposed = json.loads(item["proposed_json"])
    resolve = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=headers,
    )
    assert resolve.status_code == 200, resolve.text
    prefill = client.get(f"/api/documents/{document_id}/company-profile", headers=headers)
    assert prefill.status_code == 200, prefill.text
    return proposed, prefill.json(), document_id


def test_acra_business_profile_extracts_through_the_real_gateway():
    from app.db import get_conn
    from app.graph.classify import is_company_profile_doc_type

    proposed, prefill, document_id = _upload_sample_and_confirm("acra_business_profile.pdf", "liveacra@example.com")

    with get_conn() as conn:
        doc = conn.execute("SELECT lane, doc_type, bucket FROM document WHERE id = ?", (document_id,)).fetchone()
    assert doc["lane"] == "statutory" and doc["bucket"] == "Statutory", dict(doc)
    assert is_company_profile_doc_type(doc["doc_type"]), doc["doc_type"]

    # The company-profile shape, not the filing-notice one — chosen by the real model's own doc_type.
    assert "company_name" in proposed and "reference_no" not in proposed, proposed

    assert "HARBOURLIGHT" in prefill["name"].upper()
    assert prefill["uen"] == "202412345K"
    assert (prefill["fye_month"], prefill["fye_day"]) == (6, 30)
    assert prefill["gst_registered"] is True
    assert "ROBINSON" in prefill["registered_address"].upper() and "048547" in prefill["registered_address"]


def test_a_sparse_acra_profile_leaves_the_missing_values_null_through_the_real_gateway():
    _, prefill, _ = _upload_sample_and_confirm("acra_business_profile_sparse.pdf", "livesparse@example.com")

    assert "HARBOURLIGHT" in prefill["name"].upper() and prefill["uen"] == "202412345K"
    # The document states neither a financial year end nor a GST status; the
    # model was told never to infer them (from the incorporation date, say).
    assert prefill["fye_month"] is None and prefill["fye_day"] is None, prefill
    assert prefill["gst_registered"] in (None, False) and prefill["gst_registered"] is not True, prefill


# --- round 13 (DECISIONS #84): the confirm -> event chain against the real gateway ---


def test_a_confirmed_statutory_notice_produces_an_event_through_the_real_gateway():
    """derive_events sat dead from 2026-09-22 (a stale needs_review guard, since
    DECISIONS #40 made that flag permanently true). The mocked-model twin of this is
    tests/test_derive_events_pipeline.py; this one has a real model classify, extract
    and propose the event, and a person confirm it."""
    from pathlib import Path

    from fastapi.testclient import TestClient

    from app.db import get_conn
    from app.main import app

    client = TestClient(app)
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "liveevents@example.com", "company_name": "Live Events Pte Ltd", "fye_month": 12, "fye_day": 31},
    ).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}
    notice = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files" / "03_notice_office_change.pdf"

    uploaded = client.post(
        "/api/documents", headers=headers, files={"file": (notice.name, notice.read_bytes(), "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    document_id = uploaded.json()["document_id"]
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM event").fetchone()[0] == 0, "nothing before a person confirms"
        assert conn.execute("SELECT lane FROM document WHERE id = ?", (document_id,)).fetchone()["lane"] == "statutory"

    item = next(i for i in client.get("/api/review", headers=headers).json() if i["document_id"] == document_id)
    resolved = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=headers,
    )
    assert resolved.status_code == 200, resolved.text

    with get_conn() as conn:
        events = [dict(r) for r in conn.execute("SELECT kind, occurred_on, source_document_id FROM event").fetchall()]
        ran = [r["decision"] for r in conn.execute(
            "SELECT decision FROM trace WHERE document_id = ? AND node = 'derive_events'", (document_id,)).fetchall()]
    assert ran == ["proposed"], f"derive_events did not run and propose: {ran}"
    assert events and events[0]["kind"] == "office_move" and events[0]["source_document_id"] == document_id, events
    assert events[0]["occurred_on"] == "2026-03-01"


# --- round 15 (DECISIONS #89): what the model writes may only name what the page names ---


def _upload_real(pdf_path, email: str, company: str = "Grounding Live Pte Ltd") -> tuple[dict, dict]:
    """Uploads a real file through POST /api/documents (real ingest, real gateway
    classify + extract, verify); returns (the stored document row, its review item)."""
    from fastapi.testclient import TestClient

    from app.db import get_conn
    from app.main import app

    client = TestClient(app)
    owner = client.post(
        "/api/auth/dev-login", json={"email": email, "company_name": company, "fye_month": 12, "fye_day": 31},
    ).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}
    resp = client.post("/api/documents", headers=headers,
                       files={"file": (pdf_path.name, pdf_path.read_bytes(), "application/pdf")})
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]
    with get_conn() as conn:
        doc = dict(conn.execute("SELECT * FROM document WHERE id = ?", (document_id,)).fetchone())
    item = next(i for i in client.get("/api/review", headers=headers).json() if i["document_id"] == document_id)
    return doc, item


def test_a_profile_that_names_no_authority_is_described_only_with_what_it_says():
    from pathlib import Path

    from app.db import parse_description
    from app.rules.grounding import Source, ungrounded_names

    sample = Path(__file__).parent.parent / "evals" / "samples" / "files" / "business_profile_no_authority.pdf"
    doc, item = _upload_real(sample, "livegrounding@example.com")

    assert "ACRA" not in doc["extracted_text"], "the fixture must not name the authority, or this proves nothing"
    descriptions = parse_description(doc["description"])
    assert descriptions, "a description was still produced"
    for text in descriptions.values():
        assert "ACRA" not in text, text
        assert ungrounded_names(text, Source.of(doc["extracted_text"])) == [], text
    assert "ACRA" not in (doc["doc_type"] or "")
    assert doc["vendor_name"] is None, "the company a business profile is about is not its vendor"
    assert item["document_vendor_name"] is None


def test_a_correct_invoice_still_extracts_and_verifies_cleanly_with_the_grounding_check_in_place():
    from pathlib import Path

    from app.db import parse_description

    invoice = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files" / "05_invoice_clean.pdf"
    doc, item = _upload_real(invoice, "liveinvoicegrounding@example.com", company="Invoice Live Pte Ltd")

    assert "Straits Print" in parse_description(doc["description"])["en"], doc["description"]
    assert doc["vendor_name"] and "Straits Print" in doc["vendor_name"]
    assert doc["lane"] == "invoice" and item["reason"] == "clean", item["reason"]


def test_a_ppn_invoice_keeps_its_tax_label_through_the_real_gateway(tmp_path):
    """Round 16, item 11: the extraction prompt says tax_label is copied verbatim and
    never assumed to be GST. The offline tests (tests/test_tax_label_verbatim.py)
    cover the code around the model; this asks the real model, on a real
    Indonesian PPN invoice in IDR, and checks the label and currency come back as
    printed and that nothing flags a correct foreign invoice."""
    import json

    from reportlab.pdfgen import canvas

    path = tmp_path / "ppn_invoice.pdf"
    page = canvas.Canvas(str(path))
    for i, line in enumerate([
        "PT SUMBER MAKMUR ABADI", "Jl. Jenderal Sudirman No. 12, Jakarta", "FAKTUR PENJUALAN / INVOICE",
        "Invoice No: SMA-2026-0417", "Date: 3 July 2026", "Customer: Bright Harbour Pte Ltd",
        "Item: Kertas HVS A4 (500 rim)", "Subtotal: IDR 10000000", "PPN 11%: IDR 1100000", "Total: IDR 11100000",
    ]):
        page.drawString(72, 780 - i * 18, line)
    page.save()

    doc, item = _upload_real(path, "liveppn@example.com", company="Bright Harbour Pte Ltd")

    assert doc["lane"] == "invoice"
    proposed = json.loads(item["proposed_json"])
    assert "PPN" in proposed["tax_label"]["value"], proposed["tax_label"]
    assert "GST" not in proposed["tax_label"]["value"].upper()
    assert proposed["currency"]["value"].upper() in ("IDR", "RP"), proposed["currency"]
    assert item["reason"] == "clean", item["reason"]


# ---- round 18 (DECISIONS #93): a company's own constitution is statutory --------------------

CORPUS = None


def _corpus(name: str):
    from pathlib import Path

    return Path(__file__).parent.parent / "evals" / "demo_corpus" / "files" / name


def test_a_constitution_classifies_as_a_statutory_company_constitution_through_the_real_pipeline():
    """Round 15's rewording of the statutory lane moved 02_constitution.pdf to important/contract,
    where it could never satisfy the checklist. Real gateway, real classify node."""
    doc, item = _upload_real(_corpus("02_constitution.pdf"), "liveconstitution@example.com", company="Bright Harbour Pte Ltd")

    assert doc["lane"] == "statutory", (doc["lane"], doc["doc_type"])
    assert "constitution" in (doc["doc_type"] or "").lower(), doc["doc_type"]
    assert doc["bucket"] == "Statutory"
    assert "ACRA" not in (doc["doc_type"] or ""), "round 15's no-invented-authority rule still holds"


def test_a_lease_still_classifies_as_an_important_contract_through_the_real_pipeline():
    doc, _ = _upload_real(_corpus("08_lease_important.pdf"), "liveleaseguard@example.com", company="Bright Harbour Pte Ltd")

    assert (doc["lane"], doc["doc_type"], doc["bucket"]) == ("important", "contract", "Contracts")


@pytest.mark.parametrize("filename,lane", [
    ("01_certificate_of_incorporation.pdf", "statutory"),
    ("03_notice_office_change.pdf", "statutory"),
    ("04_notice_corpsec_change.pdf", "statutory"),
    ("05_invoice_clean.pdf", "invoice"),
    ("06_invoice_bad_gst.pdf", "invoice"),
])
def test_the_rest_of_the_demo_corpus_keeps_its_lane_with_the_constitution_clause_in_the_prompt(filename, lane):
    doc, _ = _upload_real(_corpus(filename), f"livecorpus-{filename[:2]}@example.com", company="Bright Harbour Pte Ltd")

    assert doc["lane"] == lane, (filename, doc["lane"], doc["doc_type"])


def test_a_confirmed_certificate_and_constitution_satisfy_both_checklist_rows_with_links_through_the_real_gateway():
    """The user-facing goal, end to end and unmocked: upload and confirm the certificate and
    the constitution; both checklist rows end up satisfied by THEIR document (round 18)."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    owner = client.post("/api/auth/dev-login", json={
        "email": "liveboth@example.com", "company_name": "Bright Harbour Pte Ltd", "fye_month": 12, "fye_day": 31}).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}

    def upload_and_confirm(name: str) -> int:
        path = _corpus(name)
        resp = client.post("/api/documents", headers=headers, files={"file": (path.name, path.read_bytes(), "application/pdf")})
        assert resp.status_code == 200, resp.text
        document_id = resp.json()["document_id"]
        item = next(i for i in client.get("/api/review", headers=headers).json() if i["document_id"] == document_id)
        done = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
                           json={"action": "confirm", "corrected_fields": {}}, headers=headers)
        assert done.status_code == 200, done.text
        return document_id

    certificate = upload_and_confirm("01_certificate_of_incorporation.pdf")
    constitution = upload_and_confirm("02_constitution.pdf")

    rows = {r["doc_type"]: r for r in client.get("/api/expectations", headers=headers).json()}
    assert (rows["certificate_of_incorporation"]["status"], rows["certificate_of_incorporation"]["evidence_document_id"]) == ("satisfied", certificate)
    assert (rows["constitution"]["status"], rows["constitution"]["evidence_document_id"]) == ("satisfied", constitution)
    # a second incorporation-like document must not double the obligations
    rule_ids = [o["rule_id"] for o in client.get("/api/obligations", headers=headers).json()]
    assert len(rule_ids) == len(set(rule_ids)), rule_ids
