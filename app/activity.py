"""The durable human history of a document (round 6, DECISIONS #129).

Five things a person can do to a document are recorded, at the successful mutation boundary and in the caller's transaction where
one exists: Uploaded, Edited, Purge requested, Purge cancelled, Deleted. This is a separate record from `trace`: trace is the
engineering log of what the pipeline and the rules did (model calls, transitions) and is removed with the document; this is what
people did, and it OUTLIVES the document, including a hard purge (see the `document_activity` comment in app/db.py for why it has no
foreign keys and is keyed by `lifecycle_id`, not `document.id`).

The action codes are internal. The API and the database carry them; the UI maps each to localized plain language and never renders
a code (web/src/features/ops/HistoryPanel.tsx).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

UPLOADED = "uploaded"
EDITED = "edited"
PURGE_REQUESTED = "purge_requested"
PURGE_CANCELLED = "purge_cancelled"
DELETED = "deleted"
ACTIONS = (UPLOADED, EDITED, PURGE_REQUESTED, PURGE_CANCELLED, DELETED)


@dataclass(frozen=True)
class Actor:
    """Who did it, as a SNAPSHOT: `name` is what the person was called at the time (their name, else their email), so a later rename
    or a person leaving the company does not rewrite history. `user_id` is None for someone who is not a user of the app (an
    operator running scripts/purge_document.py, a non-web ingestion source); `name` then says who, honestly, and is never made up."""

    user_id: int | None
    name: str | None


def actor_of(membership) -> Actor:
    """The signed-in caller (an `auth.CurrentMembership`): their display name at this moment, else their email."""
    name = (membership.name or "").strip() or membership.email
    return Actor(user_id=membership.user_id, name=name)


def actor_for_user(conn: sqlite3.Connection, user_id: int | None, fallback: str | None = None) -> Actor:
    """The named user's snapshot (name, else email), or `fallback` (a non-web source's identity) when there is no user."""
    if user_id is not None:
        row = conn.execute("SELECT name, email FROM app_user WHERE id = ?", (user_id,)).fetchone()
        if row is not None:
            return Actor(user_id=user_id, name=(row["name"] or "").strip() or row["email"])
    return Actor(user_id=None, name=(fallback or "").strip() or None)


def operator(label: str) -> Actor:
    """A person or process acting outside the app (the purge script's `--actor`): no user id, and the label exactly as given."""
    label = label.strip()
    if not label:
        raise ValueError("an operator actor needs a name")
    return Actor(user_id=None, name=label)


def record(conn: sqlite3.Connection, *, lifecycle_id: str, company_id: int, action: str, actor: Actor) -> None:
    """Append one event. The caller passes its own connection, so the event commits or rolls back with the change it describes."""
    if action not in ACTIONS:
        raise ValueError(f"unknown document activity {action!r}")
    conn.execute(
        "INSERT INTO document_activity (lifecycle_id, company_id, action, actor_user_id, actor_name) VALUES (?, ?, ?, ?, ?)",
        (lifecycle_id, company_id, action, actor.user_id, actor.name),
    )


def record_for_document(conn: sqlite3.Connection, document_id: int, action: str, actor: Actor) -> bool:
    """`record`, looking the document's lifecycle id and company up by its current row id. False (nothing recorded) when the row is
    already gone; every caller that must record a deletion does so BEFORE the row is removed."""
    row = conn.execute("SELECT lifecycle_id, company_id FROM document WHERE id = ?", (document_id,)).fetchone()
    if row is None or row["lifecycle_id"] is None:
        return False
    record(conn, lifecycle_id=row["lifecycle_id"], company_id=row["company_id"], action=action, actor=actor)
    return True


def summaries_for(conn: sqlite3.Connection, document_ids: list[int]) -> dict[int, dict]:
    """{document_id: {"count": n}} for every listed document that has any history, in ONE grouped query for the whole page, never one
    per card (the list, search and personal-files responses carry it so a card's collapsed "History · N activities" needs no fetch;
    the entries themselves are fetched lazily when a card is opened). A document with no events is simply absent."""
    if not document_ids:
        return {}
    marks = ",".join("?" * len(document_ids))
    rows = conn.execute(
        f"SELECT d.id AS document_id, COUNT(a.id) AS n FROM document d JOIN document_activity a ON a.lifecycle_id = d.lifecycle_id "
        f"WHERE d.id IN ({marks}) GROUP BY d.id",
        document_ids,
    ).fetchall()
    return {r["document_id"]: {"count": r["n"]} for r in rows}


def history_for(conn: sqlite3.Connection, lifecycle_id: str, company_id: int) -> list[dict]:
    """A document's events, oldest first. Scoped to the company as well as the lifecycle id, so one company's history can never be read
    through another's document. The internal user id is not returned: the name snapshot is what a reader is shown."""
    rows = conn.execute(
        "SELECT action, actor_name, at FROM document_activity WHERE lifecycle_id = ? AND company_id = ? ORDER BY id",
        (lifecycle_id, company_id),
    ).fetchall()
    return [{"action": r["action"], "actor_name": r["actor_name"], "at": r["at"]} for r in rows]
