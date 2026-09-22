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
from pathlib import Path

import pytest

_TEST_DB = str(Path(__file__).parent / "_test.db")
os.environ["JAGA_DB_PATH"] = _TEST_DB

_TABLES = [
    "notification", "security_event", "trace", "review_item", "obligation",
    "expectation", "event", "extraction", "document", "session", "membership",
    "app_user", "company",
]


@pytest.fixture(autouse=True)
def _reset_test_db():
    from app.db import get_conn, init_db

    init_db(_TEST_DB)
    with get_conn(_TEST_DB) as conn:
        for table in _TABLES:
            conn.execute(f"DELETE FROM {table}")
    yield
