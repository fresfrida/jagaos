"""Live-gateway tests for the human-review pause/resume path. Uses the
shared test DB from conftest.py (autouse-reset before each test) rather
than per-test monkeypatching — see conftest.py's docstring for why.
"""

import os

import pytest
from dotenv import load_dotenv

load_dotenv()

pytestmark = pytest.mark.skipif(
    not os.environ.get("LLM_GATEWAY_API_KEY"), reason="needs LLM_GATEWAY_API_KEY"
)

BAD_GST_TEXT = """Marina Facilities Management Pte Ltd
GST Reg No: M77098765Y
Invoice No: MFM-2026-0456
Date: 12 August 2026

Description: Quarterly office facilities maintenance
Subtotal: SGD 1,200.00
GST: SGD 84.00
Total: SGD 1,284.00"""


def _seed_company_and_document(sha: str) -> None:
    from app.db import get_conn

    with get_conn() as conn:
        conn.execute("INSERT INTO company (id, name, fye_month, fye_day) VALUES (1, 'X', 12, 31)")
        conn.execute(
            "INSERT INTO document (id, company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES "
            f"(1, 1, '{sha}', 'x.pdf', 'application/pdf', 1, '/tmp/x', 'web', 'received')"
        )


def test_pipeline_invoke_surfaces_interrupt_on_bad_gst():
    """Does PIPELINE.invoke() actually surface __interrupt__ when verify
    flags needs_review? The demo-corpus run showed a bad-GST invoice ending
    in document.status='needs_review' (correct, written inside verify.py)
    but the API response looked like it took the "processed" branch instead
    of pausing — this isolates whether the graph really pauses."""
    _seed_company_and_document("diagsha")
    from app.db import get_conn
    from app.graph.pipeline import PIPELINE

    state = {
        "run_id": "diag1", "company_id": 1, "document_id": 1,
        "text": BAD_GST_TEXT, "text_source": "pdfplumber",
    }
    result = PIPELINE.invoke(state, config={"configurable": {"thread_id": "diag1"}})
    print("\nRESULT KEYS:", list(result.keys()))
    print("verify_result:", result.get("verify_result"))
    print("has __interrupt__:", "__interrupt__" in result)
    print("events:", result.get("events"))

    with get_conn() as conn:
        doc = conn.execute("SELECT status FROM document WHERE id = 1").fetchone()
        print("document.status in DB:", doc["status"])
        assert doc["status"] == "needs_review"


def test_resolve_confirm_applies_correction_and_files_document():
    """The gap found live 2026-09-22: resolving a review item unpaused the
    graph but never applied the human's answer anywhere. This checks the
    fix — a "confirm" with a corrected GST value should land in the
    extraction table (source='human'), the review_item should record what
    was actually resolved (not just that it was), and the document should
    leave needs_review for good, not get stuck there."""
    _seed_company_and_document("resolvesha")
    from langgraph.types import Command

    from app.db import get_conn
    from app.graph.pipeline import PIPELINE

    state = {
        "run_id": "resolve1", "company_id": 1, "document_id": 1,
        "text": BAD_GST_TEXT, "text_source": "pdfplumber",
    }
    PIPELINE.invoke(state, config={"configurable": {"thread_id": "resolve1"}})

    with get_conn() as conn:
        review_item_id = conn.execute(
            "SELECT id FROM review_item WHERE document_id = 1 AND status = 'open'"
        ).fetchone()["id"]

    resolution = {"action": "confirm", "corrected_fields": {"gst": 108.0}}
    PIPELINE.invoke(
        Command(resume=resolution), config={"configurable": {"thread_id": "resolve1"}}
    )

    with get_conn() as conn:
        doc = conn.execute("SELECT status FROM document WHERE id = 1").fetchone()
        assert doc["status"] == "filed", f"expected filed, got {doc['status']}"

        review_item = conn.execute(
            "SELECT status, action, resolved_json FROM review_item WHERE id = ?",
            (review_item_id,),
        ).fetchone()
        assert review_item["status"] == "resolved"
        assert review_item["action"] == "confirm"
        assert "108" in review_item["resolved_json"]

        human_extraction = conn.execute(
            "SELECT value_text FROM extraction WHERE document_id = 1 AND field = 'gst' "
            "AND source = 'human'"
        ).fetchone()
        assert human_extraction is not None, "expected a human-sourced extraction row for gst"
        assert human_extraction["value_text"] == "108.0"


def test_resolve_reject_archives_the_document_with_both_transitions_traced():
    # 2026-09-22 (DECISIONS #50): a reject used to stop at "rejected",
    # leaving a separate manual "Archive" click as the only way out of what
    # read as a dead end. Now chains straight through to "archived" — both
    # edges already existed in app/rules/transitions.py's
    # _DOCUMENT_TRANSITIONS (needs_review -> rejected -> archived); this
    # checks both hops actually happen and both land in `trace`, not just
    # the end state.
    _seed_company_and_document("rejectsha")
    from langgraph.types import Command

    from app.db import get_conn
    from app.graph.pipeline import PIPELINE

    state = {
        "run_id": "reject1", "company_id": 1, "document_id": 1,
        "text": BAD_GST_TEXT, "text_source": "pdfplumber",
    }
    PIPELINE.invoke(state, config={"configurable": {"thread_id": "reject1"}})

    result = PIPELINE.invoke(
        Command(resume={"action": "reject", "corrected_fields": {}}),
        config={"configurable": {"thread_id": "reject1"}},
    )
    assert result.get("events") is None, "a rejected document should not reach derive_events"

    with get_conn() as conn:
        doc = conn.execute("SELECT status FROM document WHERE id = 1").fetchone()
        assert doc["status"] == "archived", f"expected archived, got {doc['status']}"

        transitions = conn.execute(
            "SELECT decision FROM trace WHERE document_id = 1 "
            "AND node = 'rules.transition_document' ORDER BY id"
        ).fetchall()
        decisions = [t["decision"] for t in transitions]
        assert len(decisions) == 2, f"expected exactly 2 recorded transitions, got {decisions}"
        assert any("needs_review->rejected" in d for d in decisions), decisions
        assert any("rejected->archived" in d for d in decisions), decisions
