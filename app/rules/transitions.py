"""Authority separation. ARCHITECTURE.md §5.2: obligation/expectation
status changes exist ONLY here, reachable only from the deterministic
`verify` node, the scheduler, and (later) an authenticated human action —
never from an LLM node's output. An injected "mark this obligation complete"
has no function to call: no LLM node imports this module.

Every transition takes an explicit `actor` so the audit trail (PLATFORM.md
§2, added later) can say who — a person, "scheduler", or "rules_engine" —
never "the AI decided".
"""

from typing import Literal

from app.db import DB_PATH, get_conn

ObligationStatus = Literal[
    "open", "notified", "escalated", "awaiting_confirmation",
    "satisfied", "waived", "overdue",
]
ExpectationStatus = Literal[
    "missing", "acknowledged_missing", "waived", "satisfied",
]
DocumentStatus = Literal[
    "received", "proposed", "needs_review", "filed", "rejected", "quarantined",
]

_OBLIGATION_TRANSITIONS: dict[str, set[str]] = {
    "open": {"notified", "awaiting_confirmation", "satisfied", "waived"},
    "notified": {"escalated", "awaiting_confirmation", "satisfied", "waived", "overdue"},
    "escalated": {"awaiting_confirmation", "satisfied", "waived", "overdue"},
    "awaiting_confirmation": {"satisfied", "open"},
    "overdue": {"satisfied", "waived", "escalated"},
    "satisfied": set(),
    "waived": set(),
}

_EXPECTATION_TRANSITIONS: dict[str, set[str]] = {
    "missing": {"acknowledged_missing", "waived", "satisfied"},
    "acknowledged_missing": {"satisfied", "waived"},
    "waived": set(),
    "satisfied": set(),
}

_DOCUMENT_TRANSITIONS: dict[str, set[str]] = {
    "received": {"proposed", "quarantined"},
    "proposed": {"needs_review", "filed", "quarantined"},
    # A human confirming or correcting a flagged document — the resolve
    # endpoint (app/main.py), never an LLM node.
    "needs_review": {"filed", "rejected"},
    "filed": set(),
    "rejected": set(),
    "quarantined": set(),
}


class InvalidTransition(Exception):
    pass


def transition_obligation(
    obligation_id: int,
    new_status: ObligationStatus,
    actor: str,
    evidence_document_id: int | None = None,
    db_path: str = DB_PATH,
) -> None:
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT status FROM obligation WHERE id = ?", (obligation_id,)
        ).fetchone()
        if row is None:
            raise ValueError(f"obligation {obligation_id} not found")
        current = row["status"]
        if new_status not in _OBLIGATION_TRANSITIONS.get(current, set()):
            raise InvalidTransition(f"obligation {current} -> {new_status} not allowed")
        if evidence_document_id is not None:
            conn.execute(
                "UPDATE obligation SET status = ?, evidence_document_id = ? WHERE id = ?",
                (new_status, evidence_document_id, obligation_id),
            )
        else:
            conn.execute(
                "UPDATE obligation SET status = ? WHERE id = ?",
                (new_status, obligation_id),
            )
        conn.execute(
            "INSERT INTO trace (run_id, node, decision, at) "
            "VALUES ('transition', 'rules.transition_obligation', ?, datetime('now'))",
            (f"{current}->{new_status} by {actor}",),
        )


def transition_document(
    document_id: int,
    new_status: DocumentStatus,
    actor: str,
    db_path: str = DB_PATH,
) -> None:
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT status FROM document WHERE id = ?", (document_id,)
        ).fetchone()
        if row is None:
            raise ValueError(f"document {document_id} not found")
        current = row["status"]
        if new_status not in _DOCUMENT_TRANSITIONS.get(current, set()):
            raise InvalidTransition(f"document {current} -> {new_status} not allowed")
        conn.execute(
            "UPDATE document SET status = ? WHERE id = ?",
            (new_status, document_id),
        )
        conn.execute(
            "INSERT INTO trace (run_id, document_id, node, decision, at) "
            "VALUES ('transition', ?, 'rules.transition_document', ?, datetime('now'))",
            (document_id, f"{current}->{new_status} by {actor}"),
        )


def transition_expectation(
    expectation_id: int,
    new_status: ExpectationStatus,
    actor: str,
    db_path: str = DB_PATH,
) -> None:
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT status FROM expectation WHERE id = ?", (expectation_id,)
        ).fetchone()
        if row is None:
            raise ValueError(f"expectation {expectation_id} not found")
        current = row["status"]
        if new_status not in _EXPECTATION_TRANSITIONS.get(current, set()):
            raise InvalidTransition(f"expectation {current} -> {new_status} not allowed")
        conn.execute(
            "UPDATE expectation SET status = ? WHERE id = ?",
            (new_status, expectation_id),
        )
        conn.execute(
            "INSERT INTO trace (run_id, node, decision, at) "
            "VALUES ('transition', 'rules.transition_expectation', ?, datetime('now'))",
            (f"{current}->{new_status} by {actor}",),
        )
