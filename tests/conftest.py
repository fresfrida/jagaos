"""Fixes a real test-isolation bug found live 2026-09-22: app/graph/*.py
and app/rules/transitions.py all do `from app.db import DB_PATH` at module
import time, so a later test's `monkeypatch.setattr(db_module, "DB_PATH",
...)` only ever changes app.db's own attribute — every module that already
imported DB_PATH keeps writing to whichever path was current the *first*
time it was imported this session, silently. Not a production bug (the
real app is one process with one fixed DB_PATH for its whole lifetime,
which is correct) — purely a test-isolation problem from trying to swap
paths mid-session.

Fix: set JAGA_DB_PATH before anything under app/ is ever imported (conftest
collection runs before test-module imports), so every module's DB_PATH
binds to the same one test database from the start. Reset its tables
before each test instead of swapping paths.
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TEST_DB = str(Path(__file__).parent / "_test.db")
os.environ["JAGA_DB_PATH"] = _TEST_DB

# 2026-09-24: uploads in tests used to land in the real ./data/docs — the dev
# app's own document store (JAGA_DOCS_PATH became a real setting in round 9).
# A private directory per session keeps test files out of it, and lets a test
# assert "no file was left behind" against a directory it fully controls.
_TEST_DOCS = Path(tempfile.mkdtemp(prefix="jaga-test-docs-"))
os.environ["JAGA_DOCS_PATH"] = str(_TEST_DOCS)

_TABLES = [
    "notification", "security_event", "trace", "review_item", "obligation",
    "expectation", "event", "extraction",
    # document_tag/tag (2026-09-22) superseded the same day by bucket/
    # vendor_name columns on document itself (DECISIONS #42) — no join
    # tables left to reset. document_search (FTS5) has no real FK but is
    # reset here too, so a prior test's rows for a reused rowid never leak
    # into the next test.
    "document_search",
    # document_activity has no foreign keys at all (round 6, DECISIONS #129): it must survive a purge, so nothing points at it or from it.
    "document_activity",
    # download_link points at document and app_user (round 4, DECISIONS #122), so it goes before both.
    "download_link",
    "document", "session", "membership",
    # company_group after company: company.group_id points at it (round 12).
    "app_user", "company", "company_group",
]


@pytest.fixture(autouse=True)
def _gateway_calls_switched_on(monkeypatch):
    """LLM_CALLS_DISABLED (round 7, DECISIONS #132) must never leak into a test. app.main runs load_dotenv() when it is imported, so a
    developer who put the flag in their real .env would otherwise switch calls off for the whole suite, and a process that sets it in
    the environment would do the same. Every test starts with it removed; a test that wants it on sets it itself."""
    monkeypatch.delenv("LLM_CALLS_DISABLED", raising=False)


@pytest.fixture(autouse=True)
def _reset_test_db():
    from app.db import get_conn, init_db

    init_db(_TEST_DB)
    with get_conn(_TEST_DB) as conn:
        for table in _TABLES:
            conn.execute(f"DELETE FROM {table}")
    for leftover in _TEST_DOCS.iterdir():
        leftover.unlink() if leftover.is_file() else shutil.rmtree(leftover)
    yield
