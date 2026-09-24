"""derive_expectations node. Deterministic — no LLM (ARCHITECTURE.md §3).
Event -> expected document set -> gap analysis. THE table that makes gap
analysis a feature, not a slide (INDEXING.md §0). The web app calls it the
"compliance checklist" (round 16)."""

import logging
import re

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.rules.expectations import derive_expectations as rule_derive
from app.rules.transitions import transition_expectation


logger = logging.getLogger(__name__)


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


# (document id, doc_type), newest upload first.
HeldDocument = tuple[int, str]


def _held_documents(conn, company_id: int) -> list[HeldDocument]:
    """The documents this company holds, newest first — what an expectation is
    matched against, and which one of them is the evidence for it.

    A personal file (visibility != 'company', DECISIONS #85) is not held BY THE
    COMPANY: counting it would mark an expectation "satisfied" by a document
    nobody else can see, and would show everyone that such a document exists.
    Round 16 (DECISIONS #90): an archived (deleted) document is not held either.
    It used to count, which was harmless while an expectation stored only a
    status; now that a satisfied row links to its document, the link must never
    point at something the app has deleted."""
    rows = conn.execute(
        "SELECT id, doc_type FROM document WHERE company_id = ? "
        "AND status NOT IN ('quarantined', 'archived') AND visibility = 'company' "
        "AND doc_type IS NOT NULL ORDER BY received_at DESC, id DESC",
        (company_id,),
    ).fetchall()
    return [(r["id"], r["doc_type"]) for r in rows]


def _evidence_for(expected_doc_type: str, held: list[HeldDocument]) -> int | None:
    """The newest held document whose doc_type matches, or None. The same match
    rule as before (_matches_doc_type), so what counts as satisfied did not
    change; this only remembers WHICH document did it."""
    for document_id, doc_type in held:
        if _matches_doc_type(expected_doc_type, [doc_type]):
            return document_id
    return None


def reconcile_expectations(company_id: int, db_path: str | None = None) -> list[str]:
    """Re-check a company's open gaps against what it holds now.

    Expectation status is set once, at creation, against whatever documents
    existed *then*. A document that arrives later and fills an already-open gap
    never got checked against it. Confirmed live 2026-09-21 (demo corpus): the
    constitution document was uploaded after the incorporation event (from a
    different document) had already created a "missing" Company Constitution
    expectation, and it stayed "missing" forever. So every open gap is
    re-checked on every document ingested — cheap at this company's
    document-count scale; would need an index/queue at real volume.

    Round 16 (DECISIONS #90): also fills in the evidence document of a row that
    is already 'satisfied' but has none (satisfied before the column existed).
    The reads finish before any write, so a transition never waits on an open
    connection of this function's own.

    Returns one plain-English line per satisfied row it could NOT link (round 16
    follow-up, DECISIONS #92): that used to be a silent `continue`, which made
    "why is this row still without a link" impossible to answer from a log. Such a
    row stays satisfied with no evidence: it was satisfied by a document that is no
    longer HELD (archived, personal, quarantined, or re-typed to a doc_type that no
    longer matches), and only a person can say which document should stand in."""
    db_path = db_path or DB_PATH  # read at call time, so a test that repoints DB_PATH is honoured
    with get_conn(db_path) as conn:
        held = _held_documents(conn, company_id)
        candidates = conn.execute(
            "SELECT id, doc_type, label, status FROM expectation WHERE company_id = ? "
            "AND (status = 'missing' OR (status = 'satisfied' AND evidence_document_id IS NULL))",
            (company_id,),
        ).fetchall()
    unlinked: list[str] = []
    for exp in candidates:
        document_id = _evidence_for(exp["doc_type"], held)
        if document_id is None:
            if exp["status"] == "satisfied":
                held_types = sorted({doc_type for _, doc_type in held})
                unlinked.append(
                    f"expectation {exp['id']} '{exp['label']}' (company {company_id}) is satisfied but no held document "
                    f"matches its doc_type '{exp['doc_type']}'; the company holds doc_types {held_types} "
                    "(archived, personal and quarantined documents do not count)"
                )
            continue
        if exp["status"] == "missing":
            transition_expectation(exp["id"], "satisfied", actor="rules_engine",
                                    db_path=db_path, evidence_document_id=document_id)
        else:
            with get_conn(db_path) as conn:
                conn.execute("UPDATE expectation SET evidence_document_id = ? WHERE id = ?",
                             (document_id, exp["id"]))
    return unlinked


def backfill_expectation_evidence(db_path: str | None = None) -> list[str]:
    """Startup step (app/main.py::startup, EVERY start, not a one-time script):
    give every already-satisfied expectation the document that satisfies it.
    Idempotent, and a no-op once nothing is left. Returns, and logs as warnings, the
    rows it could not link (see reconcile_expectations) so the service log says why."""
    db_path = db_path or DB_PATH
    with get_conn(db_path) as conn:
        company_ids = [
            r["company_id"] for r in conn.execute(
                "SELECT DISTINCT company_id FROM expectation "
                "WHERE status = 'satisfied' AND evidence_document_id IS NULL"
            ).fetchall()
        ]
    unlinked: list[str] = []
    for company_id in company_ids:
        unlinked += reconcile_expectations(company_id, db_path)
    for line in unlinked:
        logger.warning("expectation evidence backfill: %s", line)
    return unlinked


def derive_expectations(state: PipelineState) -> PipelineState:
    created = 0
    with get_conn(DB_PATH) as conn:
        held = _held_documents(conn, state["company_id"])

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
                evidence = _evidence_for(row["doc_type"], held)
                conn.execute(
                    "INSERT INTO expectation (company_id, event_id, doc_type, label, "
                    " due_on, rule_id, status, evidence_document_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (row["company_id"], row["event_id"], row["doc_type"], row["label"],
                     row["due_on"], row["rule_id"],
                     "satisfied" if evidence is not None else "missing", evidence),
                )
                existing_rule_ids.add(row["rule_id"])
                created += 1

    reconcile_expectations(state["company_id"])
    return {"expectations_created": created}
