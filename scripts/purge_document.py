"""HARD-DELETE documents by id (2026-09-24, DECISIONS #91). Irreversible.

This is NOT the app's "Delete" (POST /api/documents/{id}/archive): that is a soft
delete that keeps the row, the file and the whole audit trail and merely hides the
document. This removes it for good:

  - the stored file on disk (DOCS_PATH) and, for a PDF, its cached first-page thumbnail (THUMBS_PATH),
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
import sys
from pathlib import Path

# app.db reads JAGA_DB_PATH when it is first imported, so .env must be loaded first
# (and the repo root must be importable when this is run as a plain script).
sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

# The implementation moved to app/purge.py in round 20 (DECISIONS #99) so the API can use it too; these names are
# re-exported because scripts/reset_demo_data.py and the tests import them from here.
from app import activity  # noqa: E402
from app.db import DB_PATH  # noqa: E402
from app.purge import (  # noqa: E402,F401
    ACTOR,
    HANDLED_REFERENCES,
    PurgePlan,
    PurgeRefused,
    apply_plans,
    check_references,
    describe,
    execute_purge,
    plan_purge,
    purge_documents,
    references_to,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hard-delete documents by id (irreversible). Dry run unless --apply.")
    parser.add_argument("ids", nargs="+", type=int, help="document ids")
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    parser.add_argument("--expect", metavar="TEXT", help="refuse unless each document's filename or description contains TEXT")
    parser.add_argument("--vacuum", action="store_true", help="checkpoint the WAL and VACUUM afterwards")
    parser.add_argument(
        "--actor", metavar="NAME",
        help="who is deleting (required with --apply): recorded in the document's history as the person who deleted it, exactly as typed",
    )
    args = parser.parse_args(argv)
    actor = activity.operator(args.actor) if args.actor and args.actor.strip() else None
    return purge_documents(args.ids, apply=args.apply, expect=args.expect, vacuum=args.vacuum, actor=actor)


if __name__ == "__main__":
    sys.exit(main())
