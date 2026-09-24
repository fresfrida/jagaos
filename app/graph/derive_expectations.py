"""derive_expectations node. Deterministic — no LLM (ARCHITECTURE.md §3).
Event -> expected document set -> gap analysis. THE table that makes gap
analysis a feature, not a slide (INDEXING.md §0)."""

import re

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.rules.expectations import derive_expectations as rule_derive
from app.rules.transitions import transition_expectation


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _matches_doc_type(expected_doc_type: str, held_doc_types: list[str]) -> bool:
    """classify.py's doc_type is free text ("ACRA Certificate of
    Incorporation"); expectation.doc_type is a fixed slug
    ("certificate_of_incorporation"). Confirmed live 2026-09-21 (demo corpus
    run): exact-match against these never matched, so every expectation
    showed "missing" even when the document was right there. Substring
    match on normalized slugs is a real fix, not a complete one — a
    genuinely different doc_type wording (e.g. "Reg. of Members" for
    "share_register") would still miss. Semantic/LLM matching is the
    proper fix; noted in docs/KANBAN.md."""
    expected_slug = _slug(expected_doc_type)
    for held in held_doc_types:
        held_slug = _slug(held)
        if expected_slug in held_slug or held_slug in expected_slug:
            return True
    return False


def derive_expectations(state: PipelineState) -> PipelineState:
    created = 0
    with get_conn(DB_PATH) as conn:
        held_doc_types = [
            r["doc_type"]
            for r in conn.execute(
                # A personal file (visibility != 'company', DECISIONS #85) is not
                # held BY THE COMPANY: counting it would mark an expectation
                # "satisfied" by a document nobody else can see, and would show
                # everyone that such a document exists.
                "SELECT DISTINCT doc_type FROM document WHERE company_id = ? "
                "AND status != 'quarantined' AND visibility = 'company' AND doc_type IS NOT NULL",
                (state["company_id"],),
            ).fetchall()
        ]

        for event in state.get("events", []):
            # Dedupe per company+rule_id, not per event_id: a second document
            # that triggers the same kind of event (e.g. two documents both
            # read as "incorporation") should not re-ask the same expected
            # document twice. Confirmed live 2026-09-21: without this, the
            # demo corpus produced duplicate "Certificate of Incorporation"
            # rows from two different documents both proposing an
            # incorporation event.
            existing = conn.execute(
                "SELECT rule_id FROM expectation WHERE company_id = ?",
                (state["company_id"],),
            ).fetchall()
            existing_rule_ids = {r["rule_id"] for r in existing}

            rows = rule_derive(state["company_id"], event["id"], event["kind"],
                                event["occurred_on"])
            for row in rows:
                if row["rule_id"] in existing_rule_ids:
                    continue
                status = "satisfied" if _matches_doc_type(row["doc_type"], held_doc_types) else "missing"
                conn.execute(
                    "INSERT INTO expectation (company_id, event_id, doc_type, label, "
                    " due_on, rule_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (row["company_id"], row["event_id"], row["doc_type"], row["label"],
                     row["due_on"], row["rule_id"], status),
                )
                existing_rule_ids.add(row["rule_id"])
                created += 1

        # Reconciliation: expectation status above is set once, at creation
        # time, against whatever documents existed *then*. A document that
        # arrives later and fills an already-open gap never got checked
        # against it. Confirmed live 2026-09-21 (demo corpus): the
        # constitution document was uploaded after the incorporation event
        # (from a different document) had already created a "missing"
        # Company Constitution expectation, and it stayed "missing" forever.
        # Re-check every open gap on every document ingested — cheap at this
        # company's document-count scale; would need an index/queue at
        # real volume.
        still_missing = conn.execute(
            "SELECT id, doc_type FROM expectation WHERE company_id = ? AND status = 'missing'",
            (state["company_id"],),
        ).fetchall()
        for exp in still_missing:
            if _matches_doc_type(exp["doc_type"], held_doc_types):
                transition_expectation(exp["id"], "satisfied", actor="rules_engine",
                                        db_path=DB_PATH)

    return {"expectations_created": created}
