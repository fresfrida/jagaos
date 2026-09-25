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
    "archived",
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
    "received": {"proposed", "quarantined", "archived"},
    "proposed": {"needs_review", "filed", "quarantined", "archived"},
    # A human confirming or correcting a flagged document — the resolve
    # endpoint (app/main.py), never an LLM node.
    "needs_review": {"filed", "rejected", "archived"},
    "filed": {"archived"},
    "rejected": {"archived"},
    # 2026-09-22: archive is a deliberate escape hatch from a dead-end
    # quarantine (DECISIONS #37, supersedes #33's "don't add one yet" for
    # this specific case — thought through separately, as #33 asked).
    # Archive is soft (document/audit trail untouched, just hidden from
    # default views) so this doesn't weaken the quarantine guardrail itself.
    "quarantined": {"archived"},
    # No restore path on purpose — "don't build a full trash/restore UI".
    "archived": set(),
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


def file_personal_document(document_id: int, actor: str, db_path: str = DB_PATH) -> None:
    """received -> filed, for ONE kind of document only: a PERSONAL file (visibility other than 'company'), named by the
    person who put it in Only me (round 21, A3, DECISIONS #101). It is the one place a document reaches `filed` without
    passing classify, extract, verify and a human confirmation; that reversal of DECISIONS #40 is scoped to personal files
    and enforced HERE, from the row itself: a company document (or an unknown visibility, which fails closed as company)
    is refused, so no caller can use this to skip review. The person's own act of naming the file is the confirmation.

    Deliberately not an edge in _DOCUMENT_TRANSITIONS: `received -> filed` stays impossible for every other document."""
    with get_conn(db_path) as conn:
        row = conn.execute("SELECT status, visibility FROM document WHERE id = ?", (document_id,)).fetchone()
        if row is None:
            raise ValueError(f"document {document_id} not found")
        if row["visibility"] in (None, "company"):
            raise InvalidTransition("only a personal file may be filed without review")
        if row["status"] != "received":
            raise InvalidTransition(f"document {row['status']} cannot be filed as a personal file, only a received one")
        conn.execute("UPDATE document SET status = 'filed' WHERE id = ?", (document_id,))
        conn.execute(
            "INSERT INTO trace (run_id, document_id, node, decision, at) "
            "VALUES ('transition', ?, 'rules.file_personal_document', ?, datetime('now'))",
            (document_id, f"received->filed by {actor} (personal file, no review)"),
        )


def reopen_expectation(
    expectation_id: int,
    actor: str,
    db_path: str = DB_PATH,
    conn=None,
) -> None:
    """satisfied -> missing, for ONE case only: the document that satisfied the
    expectation has been hard-deleted (scripts/purge_document.py, DECISIONS #91).

    Deliberately not a transition in _EXPECTATION_TRANSITIONS (a satisfied row
    never goes back through the state machine): it is an administrative
    correction, kept here so that every write to an expectation's status still
    lives in this one module. Refuses anything that is not currently satisfied.
    Pass `conn` to run inside the caller's transaction (a second connection
    would wait on the caller's write lock); the caller then commits."""
    def apply(c) -> None:
        row = c.execute("SELECT status FROM expectation WHERE id = ?", (expectation_id,)).fetchone()
        if row is None:
            raise ValueError(f"expectation {expectation_id} not found")
        if row["status"] != "satisfied":
            raise InvalidTransition(f"expectation {row['status']} cannot be reopened, only a satisfied one")
        c.execute("UPDATE expectation SET status = 'missing', evidence_document_id = NULL WHERE id = ?", (expectation_id,))
        c.execute(
            "INSERT INTO trace (run_id, node, decision, at) "
            "VALUES ('transition', 'rules.reopen_expectation', ?, datetime('now'))",
            (f"satisfied->missing by {actor} (evidence purged)",),
        )

    if conn is not None:
        apply(conn)
        return
    with get_conn(db_path) as own:
        apply(own)


def transition_expectation(
    expectation_id: int,
    new_status: ExpectationStatus,
    actor: str,
    db_path: str = DB_PATH,
    evidence_document_id: int | None = None,
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
        # evidence_document_id (round 16, DECISIONS #90): the document that
        # satisfied it. COALESCE so a transition that names none (waive,
        # acknowledge) never erases one that is already recorded.
        conn.execute(
            "UPDATE expectation SET status = ?, "
            "evidence_document_id = COALESCE(?, evidence_document_id) WHERE id = ?",
            (new_status, evidence_document_id, expectation_id),
        )
        conn.execute(
            "INSERT INTO trace (run_id, node, decision, at) "
            "VALUES ('transition', 'rules.transition_expectation', ?, datetime('now'))",
            (f"{current}->{new_status} by {actor}",),
        )
