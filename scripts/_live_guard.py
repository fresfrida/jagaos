"""The guard on the scripts that SPEND THE GATEWAY BUDGET (round 7, DECISIONS #133; DECISIONS #130 is the ruling it enforces).

seed_dev_db.py, reset_demo_data.py and evals/demo_corpus/run.py all upload documents through the real pipeline, so every run pays for
real classify and extract calls. Two refusals, both exit code 2 with a plain message:

  1. A LIVE target is refused outright, flag or no flag: JAGA_DB_PATH resolving under /opt/jaga (the Lightsail box), or a
     JAGA_API_BASE_URL whose host is not localhost, 127.0.0.1 or ::1.
  2. Anywhere else the script refuses unless it was run with --allow-gateway-spend, so spending the budget is a deliberate act.

scripts/purge_document.py is NOT guarded: it makes no gateway call. The no-gateway way to fill a database is
scripts/seed_demo_fixtures.py (run with LLM_CALLS_DISABLED=1)."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

FLAG = "--allow-gateway-spend"
LIVE_ROOT = Path("/opt/jaga")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def live_target_reasons(db_path: str | None = None, api_base: str | None = None) -> list[str]:
    """Why the target is LIVE, or [] when it is a local one. Both inputs default to what the script itself would read from the
    environment (after .env), so the check sees the same target the script would act on."""
    if db_path is None:
        db_path = os.environ.get("JAGA_DB_PATH", "./data/jaga.db")
    if api_base is None:
        api_base = os.environ.get("JAGA_API_BASE_URL", "http://127.0.0.1:8000")
    reasons: list[str] = []
    resolved = Path(db_path).expanduser().resolve()
    if resolved == LIVE_ROOT or LIVE_ROOT in resolved.parents:
        reasons.append(f"the database ({resolved}) is under {LIVE_ROOT}, which is the live server")
    host = urlparse(api_base).hostname
    if host not in LOCAL_HOSTS:
        reasons.append(f"the API base URL host ({host or api_base!r}) is not localhost, 127.0.0.1 or ::1")
    return reasons


def _refuse(message: str) -> None:
    """A plain message on stderr and exit STATUS 2 (sys.exit("text") would exit with status 1)."""
    print(message, file=sys.stderr)
    sys.exit(2)


def refuse_unless_allowed(script: str, allowed: bool, *, db_path: str | None = None, api_base: str | None = None) -> None:
    """Exit with code 2 and a plain message unless this run may spend the gateway budget. Call it FIRST in main()."""
    load_dotenv()  # the scripts read .env too; the guard must judge the same target they would
    live = live_target_reasons(db_path, api_base)
    if live:
        _refuse(
            f"REFUSED (exit 2): {script} spends the gateway budget and its target looks LIVE: {'; '.join(live)}.\n"
            "It never runs against a live target, even with the flag. To fill a database without any gateway call, use "
            "scripts/seed_demo_fixtures.py."
        )
    if not allowed:
        _refuse(
            f"REFUSED (exit 2): {script} uploads documents through the real pipeline, so every run spends the gateway budget "
            f"(DECISIONS #130). Run it again with {FLAG} only if you mean to spend it. To fill a database without any gateway "
            "call, use scripts/seed_demo_fixtures.py."
        )
