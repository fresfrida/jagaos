"""Live-gateway smoke test. Skips automatically if LLM_GATEWAY_API_KEY is
not set (e.g. in CI or a teammate's machine without .env) — this is the
one test in the suite that spends real tokens and touches the network, so
it stays separate from tests/test_rules_smoke.py's offline checks.

Run: pytest tests/test_gateway_live.py -v -s
"""

import os
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv()

pytestmark = pytest.mark.skipif(
    not os.environ.get("LLM_GATEWAY_API_KEY"),
    reason="LLM_GATEWAY_API_KEY not set — copy .env.example to .env to run this test",
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
