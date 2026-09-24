"""HARD-DELETE documents by id (2026-09-24, DECISIONS #91). Irreversible.

This is NOT the app's "Delete" (POST /api/documents/{id}/archive): that is a soft
delete that keeps the row, the file and the whole audit trail and merely hides the
document. This removes it for good:

  - the stored file on disk (DOCS_PATH),
  - the `document` row and its full-text-search row,
  - everything that only exists because of it: `extraction`, `review_item`, `trace`
    and `security_event` rows for it, the `event` rows it produced
    (event.source_document_id) with the `obligation` rows and `expectation` rows
    derived from those events, plus those obligations' `notification` and
    `review_item` rows,
  - and it repairs what merely POINTED at it: a compliance-checklist row that the
    document satisfied (expectation.evidence_document_id, added in round 16) is
    reopened to `missing` (through rules/transitions.reopen_expectation) and then
    re-checked, so another matching document can satisfy it again.

It refuses, and changes NOTHING, when the id does not exist, when an obligation
merely cites the document as evidence but was produced by something else
(obligation.evidence_document_id is set by nothing today, so that is unexpected
state worth a human look), or when the schema has a foreign key to
document/event/obligation that this script does not know how to handle (a table
added after it was written): it discovers references from the database itself
instead of trusting a list, so a new table stops it rather than being skipped.

Usage (run it where the database is: the box's own /opt/jaga/backend, not a
laptop; a local run only ever touches the local database):

    python scripts/purge_document.py 12 15                 # DRY RUN, prints what would go
    python scripts/purge_document.py 12 15 --apply         # does it
    python scripts/purge_document.py 12 --apply --expect "living room"
    python scripts/purge_document.py 12 --apply --vacuum

  --expect TEXT   every id's filename or description must contain TEXT (any case),
                  or nothing is done: a guard against a mistyped id.
  --vacuum        after deleting, checkpoint the WAL and VACUUM so freed pages are
                  rewritten (SQLite otherwise leaves deleted content in free pages).
                  Briefly locks the database.

What "hard" means here: unlink + SQL delete + SQLite secure_delete + a full-text
index merge. It is not forensic erasure: a filesystem snapshot or backup taken
earlier (Lightsail snapshots, if enabled) still holds the old bytes.

Exit code 0 done (or a clean dry run), 2 refused with nothing changed, 4 the rows
were deleted but a stored file could not be removed (named in the output).
"""

import argparse
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

# app.db reads JAGA_DB_PATH when it is first imported, so .env must be loaded first
# (and the repo root must be importable when this is run as a plain script).
sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from app.db import DB_PATH, get_conn, parse_description  # noqa: E402
from app.graph.derive_expectations import reconcile_expectations  # noqa: E402
from app.rules.transitions import reopen_expectation  # noqa: E402

ACTOR = "purge_document"

# The references this script knows how to satisfy. Anything else found in the
# schema makes it refuse (see check_references).
HANDLED_REFERENCES = {
    "document": {
        ("extraction", "document_id"), ("review_item", "document_id"), ("trace", "document_id"),
        ("security_event", "document_id"), ("event", "source_document_id"),
        ("expectation", "evidence_document_id"), ("obligation", "evidence_document_id"),
    },
    "event": {("expectation", "event_id"), ("obligation", "event_id")},
    "obligation": {("notification", "obligation_id"), ("review_item", "obligation_id")},
}


class PurgeRefused(Exception):
    """Nothing was changed, and why."""


@dataclass
class PurgePlan:
    document: dict
    stored_file: Path
    file_exists: bool
    file_shared: bool
    events: list[int] = field(default_factory=list)
    obligations: list[int] = field(default_factory=list)
    expectations_from_events: list[int] = field(default_factory=list)
    expectations_to_reopen: list[int] = field(default_factory=list)
    expectations_to_unlink: list[int] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)


def _marks(ids: list[int]) -> str:
    return ",".join("?" * len(ids))


def references_to(conn: sqlite3.Connection, table: str) -> set[tuple[str, str]]:
    """Every (table, column) in the database that has a foreign key to `table`."""
    found: set[tuple[str, str]] = set()
    names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    for name in names:
        for fk in conn.execute(f'PRAGMA foreign_key_list("{name}")'):
            if fk["table"] == table:
                found.add((name, fk["from"]))
    return found


def check_references(conn: sqlite3.Connection) -> None:
    for table, handled in HANDLED_REFERENCES.items():
        unknown = references_to(conn, table) - handled
        if unknown:
            listed = ", ".join(f"{t}.{c}" for t, c in sorted(unknown))
            raise PurgeRefused(
                f"the schema has a foreign key to {table} that this script does not handle: {listed}. "
                "Nothing was changed. Teach purge_document.py about it first."
            )


def _count(conn: sqlite3.Connection, sql: str, *params) -> int:
    return conn.execute(sql, params).fetchone()[0]


def plan_purge(conn: sqlite3.Connection, document_id: int, expect: str | None = None) -> PurgePlan:
    """What purging `document_id` would remove, or PurgeRefused. Reads only."""
    row = conn.execute(
        "SELECT id, company_id, filename, lane, doc_type, bucket, status, description, stored_path "
        "FROM document WHERE id = ?", (document_id,),
    ).fetchone()
    if row is None:
        raise PurgeRefused(f"document {document_id} does not exist in {Path(DB_PATH).resolve()}. Nothing was changed.")
    check_references(conn)

    description = " ".join(parse_description(row["description"]).values())
    if expect and expect.lower() not in f"{row['filename']} {description}".lower():
        raise PurgeRefused(
            f"document {document_id} ('{row['filename']}': {description or 'no description'}) does not contain "
            f"'{expect}'. Nothing was changed. Is that the right id?"
        )

    events = [r[0] for r in conn.execute("SELECT id FROM event WHERE source_document_id = ?", (document_id,))]
    obligations = [r[0] for r in conn.execute(f"SELECT id FROM obligation WHERE event_id IN ({_marks(events)})", events)] if events else []
    foreign = [
        r[0] for r in conn.execute("SELECT id FROM obligation WHERE evidence_document_id = ?", (document_id,))
        if r[0] not in obligations
    ]
    if foreign:
        raise PurgeRefused(
            f"obligation(s) {foreign} cite document {document_id} as their evidence but were not produced by it. "
            "Nothing was changed. Look at them before deleting the evidence."
        )
    from_events = [r[0] for r in conn.execute(f"SELECT id FROM expectation WHERE event_id IN ({_marks(events)})", events)] if events else []
    to_reopen: list[int] = []
    to_unlink: list[int] = []
    for exp in conn.execute("SELECT id, status FROM expectation WHERE evidence_document_id = ?", (document_id,)):
        if exp["id"] in from_events:
            continue  # deleted with its event
        (to_reopen if exp["status"] == "satisfied" else to_unlink).append(exp["id"])

    stored = Path(row["stored_path"])
    shared = _count(conn, "SELECT COUNT(*) FROM document WHERE stored_path = ? AND id != ?", row["stored_path"], document_id) > 0
    return PurgePlan(
        document={**dict(row), "description_text": description},
        stored_file=stored, file_exists=stored.exists(), file_shared=shared,
        events=events, obligations=obligations, expectations_from_events=from_events,
        expectations_to_reopen=to_reopen, expectations_to_unlink=to_unlink,
        counts={
            "extraction": _count(conn, "SELECT COUNT(*) FROM extraction WHERE document_id = ?", document_id),
            "review_item": _count(conn, "SELECT COUNT(*) FROM review_item WHERE document_id = ?", document_id),
            "trace": _count(conn, "SELECT COUNT(*) FROM trace WHERE document_id = ?", document_id),
            "security_event": _count(conn, "SELECT COUNT(*) FROM security_event WHERE document_id = ?", document_id),
        },
    )


def execute_purge(conn: sqlite3.Connection, plan: PurgePlan) -> None:
    """Deletes the rows in dependency order, inside the caller's transaction (the
    caller commits, or rolls everything back if anything here raises: foreign keys
    are ON, so a reference this missed is an IntegrityError, never a dangling row)."""
    document_id = plan.document["id"]
    if plan.obligations:
        m = _marks(plan.obligations)
        conn.execute(f"DELETE FROM notification WHERE obligation_id IN ({m})", plan.obligations)
        conn.execute(f"DELETE FROM review_item WHERE obligation_id IN ({m})", plan.obligations)
        conn.execute(f"DELETE FROM obligation WHERE id IN ({m})", plan.obligations)
    if plan.expectations_from_events:
        conn.execute(f"DELETE FROM expectation WHERE id IN ({_marks(plan.expectations_from_events)})", plan.expectations_from_events)
    if plan.events:
        conn.execute(f"DELETE FROM event WHERE id IN ({_marks(plan.events)})", plan.events)
    for expectation_id in plan.expectations_to_reopen:
        reopen_expectation(expectation_id, ACTOR, conn=conn)
    for expectation_id in plan.expectations_to_unlink:
        conn.execute("UPDATE expectation SET evidence_document_id = NULL WHERE id = ?", (expectation_id,))
    for table in ("extraction", "review_item", "trace", "security_event"):
        conn.execute(f"DELETE FROM {table} WHERE document_id = ?", (document_id,))
    conn.execute("DELETE FROM document_search WHERE rowid = ?", (document_id,))
    conn.execute("DELETE FROM document WHERE id = ?", (document_id,))


def describe(plan: PurgePlan) -> str:
    d = plan.document
    lines = [
        f"document {d['id']} (company {d['company_id']}): {d['filename']}",
        f"    {d['lane']}/{d['doc_type']}, bucket {d['bucket']}, status {d['status']}",
        f"    description: {d['description_text'] or '(none)'}",
    ]
    if plan.file_shared:
        lines.append(f"    file: {plan.stored_file} is used by another document row and will be KEPT")
    elif plan.file_exists:
        lines.append(f"    file: {plan.stored_file.resolve()} will be deleted")
    else:
        lines.append(f"    file: {plan.stored_file} is already missing on disk (nothing to delete there)")
    rows = ", ".join(f"{n} {name}" for name, n in plan.counts.items() if n)
    lines.append(f"    rows: the document, its search row{', ' + rows if rows else ''}")
    if plan.events:
        lines.append(
            f"    derived: {len(plan.events)} event(s) {plan.events}, {len(plan.obligations)} obligation(s) {plan.obligations}, "
            f"{len(plan.expectations_from_events)} checklist row(s) {plan.expectations_from_events}"
        )
    if plan.expectations_to_reopen:
        lines.append(f"    checklist rows this document satisfied, reopened to missing: {plan.expectations_to_reopen}")
    if plan.expectations_to_unlink:
        lines.append(f"    checklist rows that only referenced it, reference cleared: {plan.expectations_to_unlink}")
    return "\n".join(lines)


def _merge_search_index() -> None:
    """Merge the full-text index's segments so the deleted document's text does not
    linger in an old one (FTS5 only marks a row deleted until a merge)."""
    with get_conn(DB_PATH) as conn:
        conn.execute("INSERT INTO document_search(document_search) VALUES('optimize')")


def _checkpoint(vacuum: bool) -> None:
    """Fold the WAL into the database file and empty it (the WAL otherwise keeps the
    deleted pages' earlier images until SQLite next checkpoints), and optionally VACUUM."""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if vacuum:
            conn.execute("VACUUM")
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()


def purge_documents(
    ids: list[int], *, apply: bool = False, expect: str | None = None, vacuum: bool = False, out=print,
) -> int:
    """Plan every id first (any refusal stops everything, nothing changed), then,
    with `apply`, purge them one transaction each. Returns the exit code."""
    ids = list(dict.fromkeys(ids))
    out(f"Database: {Path(DB_PATH).resolve()}")
    try:
        with get_conn(DB_PATH) as conn:
            plans = [plan_purge(conn, i, expect) for i in ids]
    except PurgeRefused as e:
        out(f"REFUSED: {e}")
        return 2

    for plan in plans:
        out(describe(plan))
    if not apply:
        out("\nDRY RUN: nothing was changed. Re-run with --apply to delete the above for good.")
        return 0

    failed_files: list[str] = []
    companies: set[int] = set()
    for plan in plans:
        with get_conn(DB_PATH) as conn:
            conn.execute("PRAGMA secure_delete = ON")  # overwrite deleted content instead of leaving it in free pages
            execute_purge(conn, plan)
        companies.add(plan.document["company_id"])
        out(f"purged document {plan.document['id']}: rows deleted")
        if plan.file_shared or not plan.file_exists:
            continue
        try:
            plan.stored_file.unlink()
            out(f"  file removed: {plan.stored_file}")
        except OSError as e:
            failed_files.append(f"{plan.stored_file} ({e})")

    for company_id in companies:
        reconcile_expectations(company_id)  # a reopened checklist row may be satisfiable by another document
    _merge_search_index()
    _checkpoint(vacuum)
    out("checkpointed the WAL" + (" and vacuumed the database" if vacuum else ""))
    if failed_files:
        out("ROWS DELETED BUT FILE(S) NOT REMOVED, delete them by hand: " + "; ".join(failed_files))
        return 4
    out("done.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hard-delete documents by id (irreversible). Dry run unless --apply.")
    parser.add_argument("ids", nargs="+", type=int, help="document ids")
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    parser.add_argument("--expect", metavar="TEXT", help="refuse unless each document's filename or description contains TEXT")
    parser.add_argument("--vacuum", action="store_true", help="checkpoint the WAL and VACUUM afterwards")
    args = parser.parse_args(argv)
    return purge_documents(args.ids, apply=args.apply, expect=args.expect, vacuum=args.vacuum)


if __name__ == "__main__":
    sys.exit(main())
