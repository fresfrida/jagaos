"""HARD-DELETE every document tagged deployment='vercel', plus everything that only exists because of it (2026-09-28,
DECISIONS #150). Built to run unattended, once a day, from cron: the Vercel deployment's manual-entry uploads (DECISIONS
#147/#148) are demo/portfolio data with no real retention need, and this keeps them from accumulating on the shared box
forever.

Reuses app/purge.py's exact document-deletion machinery — the SAME code POST /api/documents/{id}/purge and
scripts/purge_document.py use (dependency-ordered delete, stored-file and thumbnail cleanup, checklist-row reopening,
WAL checkpoint) — so a Vercel row is removed exactly as thoroughly as any other hard-deleted document, never a
bespoke, less-careful DELETE. This script's own job is just deciding WHICH ids: every document currently tagged
deployment='vercel', full stop.

Scope, deliberately narrow and deliberately unconditional:
  * The WHERE clause names 'vercel' explicitly, never "!= 'aws'" — a future third deployment value defaults to being
    LEFT ALONE, not swept up by a change to some other part of the schema.
  * Unconditional on status: a Vercel document still sitting in Needs Review, one already filed, one quarantined —
    all of them go. This script does not distinguish "reviewed" from "not yet reviewed"; if that should ever change,
    decide it explicitly here, not by silently narrowing the query.
  * A 'vercel' PERSONAL (Only me) file is included too: deployment is set on every new document regardless of
    visibility (app/main.py::_process_upload), and nothing here re-derives that distinction.

Usage (run it where the database is: the box's own /opt/jaga/backend):

    python scripts/purge_vercel_deployment_rows.py                            # DRY RUN, prints/logs what would go
    python scripts/purge_vercel_deployment_rows.py --apply --actor "NAME"     # does it

  --actor NAME   required with --apply (app/purge.py's own rule): recorded in each deleted document's history as who
                 deleted it (activity.operator) — always a truthful operator label, never left blank.
  --vacuum       after deleting, checkpoint the WAL and VACUUM (see app/purge.py's own docstring on what that means).
  --log PATH     append a timestamped record of this run here too, in addition to stdout (default: a `logs/` folder
                 next to wherever this script's own copy lives — on the box that resolves to
                 /opt/jaga/backend/logs/purge_vercel.log with no flag needed; overridable for a different layout).

Exit code 0 done (or a clean dry run, including "0 found"), 2 refused with nothing changed (app/purge.py's own
refusals: an id that vanished between the query and the delete, or a foreign key the shared purge code does not yet
handle), 4 rows deleted but a stored file could not be removed (named in the output).

Cron (installed 2026-09-28 on the Lightsail box, the `jaga` user's own crontab — docs/DECISIONS.md #150):
    # 04:00 Asia/Singapore = 20:00 UTC (the box's system clock is UTC — confirmed via timedatectl; neither zone
    # observes DST, so this offset never shifts).
    0 20 * * * cd /opt/jaga/backend && .venv/bin/python3 scripts/purge_vercel_deployment_rows.py --apply --actor "cron: nightly vercel-deployment purge" >> logs/purge_vercel_cron.log 2>&1

Manual one-off wipe, the exact same effect, run any time:
    cd /opt/jaga/backend && .venv/bin/python3 scripts/purge_vercel_deployment_rows.py --apply --actor "manual: vercel-deployment wipe"
"""

import argparse
import datetime
import sys
from pathlib import Path

# app.db reads JAGA_DB_PATH when it is first imported, so .env must be loaded first (and the repo root must be
# importable when this is run as a plain script) — same pattern as scripts/purge_document.py.
sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from app import activity  # noqa: E402
from app.db import DB_PATH, get_conn  # noqa: E402
from app.purge import purge_documents  # noqa: E402

# Resolves to <the deployed copy's own parent>/logs/purge_vercel.log — on the box that IS
# /opt/jaga/backend/logs/purge_vercel.log with no --log flag needed at all, because this script lives at
# /opt/jaga/backend/scripts/purge_vercel_deployment_rows.py there.
DEFAULT_LOG = Path(__file__).parent.parent / "logs" / "purge_vercel.log"


def vercel_document_ids() -> list[int]:
    """Every document currently tagged deployment='vercel', oldest first. Read-only; a plain scan of the whole
    table (the box's document count is small enough that no index is worth adding just for this)."""
    with get_conn(DB_PATH) as conn:
        return [r[0] for r in conn.execute("SELECT id FROM document WHERE deployment = 'vercel' ORDER BY id")]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    parser.add_argument("--actor", metavar="NAME", help="who is deleting (required with --apply)")
    parser.add_argument("--vacuum", action="store_true", help="checkpoint the WAL and VACUUM afterwards")
    parser.add_argument(
        "--log", metavar="PATH", default=str(DEFAULT_LOG),
        help=f"append a timestamped record of this run here too, besides stdout (default: {DEFAULT_LOG})",
    )
    args = parser.parse_args(argv)

    log_path = Path(args.log)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_fh = log_path.open("a", encoding="utf-8")

    def out(line: str) -> None:
        # Every line purge_documents() prints (the database path, one describe() block per document, the final
        # DRY RUN/done/REFUSED line) goes to BOTH stdout (so a manual run sees it directly, and cron's own
        # redirect still captures it as a fallback) and this run's dedicated log file.
        print(line)
        log_fh.write(line + "\n")
        log_fh.flush()

    try:
        started = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        out(f"\n=== {started} {'APPLY' if args.apply else 'DRY RUN'} ===")

        ids = vercel_document_ids()
        if not ids:
            out("0 deployment='vercel' documents found. Nothing to do.")
            return 0
        out(f"{len(ids)} deployment='vercel' document(s) found: {ids}")

        actor = activity.operator(args.actor) if args.actor and args.actor.strip() else None
        return purge_documents(ids, apply=args.apply, vacuum=args.vacuum, actor=actor, out=out)
    finally:
        log_fh.close()


if __name__ == "__main__":
    sys.exit(main())
