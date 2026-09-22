"""SQLite (WAL) schema and connection. ARCHITECTURE.md §2.

No ORM: the schema is small and stable, and raw SQL keeps every query
inspectable in the trace panel. One connection per request, WAL mode so the
scheduler and the API can both write without locking each other out.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = os.environ.get("JAGA_DB_PATH", "./data/jaga.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS company (
    id INTEGER PRIMARY KEY,
    uen TEXT,
    name TEXT NOT NULL,
    incorporated_on TEXT,
    fye_month INTEGER NOT NULL,
    fye_day INTEGER NOT NULL,
    gst_registered INTEGER NOT NULL DEFAULT 0,
    gst_period TEXT,
    dormant INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES company(id),
    sha256 TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    stored_path TEXT NOT NULL,
    source_channel TEXT NOT NULL,   -- telegram | web | email
    source_identity TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    occurred_on TEXT,
    lane TEXT,                      -- statutory | invoice | important | memory
    doc_type TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    -- received|extracted|proposed|needs_review|filed|rejected|quarantined
    extracted_text TEXT,
    text_source TEXT                -- pdfplumber | ocr | exif | none
);

CREATE TABLE IF NOT EXISTS extraction (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES document(id),
    field TEXT NOT NULL,
    value_text TEXT,
    value_num REAL,
    value_date TEXT,
    confidence REAL NOT NULL,
    page INTEGER,
    char_start INTEGER,
    char_end INTEGER,
    extractor_version TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'llm'
    -- llm | human — a human correction INSERTs a new row rather than
    -- overwriting the model's original guess, so both stay on record
    -- (the product's own "provenance" pitch applies to corrections too)
);

CREATE TABLE IF NOT EXISTS event (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES company(id),
    kind TEXT NOT NULL,
    -- incorporation|office_move|corpsec_change|director_change|
    -- gst_registration|first_employee|fy_end|dormancy
    occurred_on TEXT NOT NULL,
    title TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    status TEXT NOT NULL DEFAULT 'confirmed',
    source_document_id INTEGER REFERENCES document(id)
);

CREATE TABLE IF NOT EXISTS expectation (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL,
    event_id INTEGER REFERENCES event(id),
    doc_type TEXT NOT NULL,
    label TEXT NOT NULL,
    due_on TEXT,
    rule_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'missing'
    -- missing | acknowledged_missing | waived | satisfied  (PLATFORM.md §2)
);

CREATE TABLE IF NOT EXISTS obligation (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL,
    event_id INTEGER REFERENCES event(id),
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    due_on TEXT NOT NULL,
    lead_days INTEGER NOT NULL DEFAULT 30,
    rule_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    -- open|notified|escalated|awaiting_confirmation|satisfied|waived|overdue
    evidence_document_id INTEGER REFERENCES document(id),
    citation TEXT NOT NULL,
    risk TEXT NOT NULL DEFAULT 'standard'
);

CREATE TABLE IF NOT EXISTS review_item (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL,
    document_id INTEGER REFERENCES document(id),
    obligation_id INTEGER REFERENCES obligation(id),
    reason TEXT NOT NULL,
    question TEXT NOT NULL,
    proposed_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open|resolved|dismissed
    resolved_by TEXT,
    resolved_at TEXT,
    action TEXT,          -- confirm | reject — what the human decided
    resolved_json TEXT    -- the corrected fields actually applied, distinct
                           -- from proposed_json (what the model guessed)
);

CREATE TABLE IF NOT EXISTS trace (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL,
    company_id INTEGER,
    document_id INTEGER REFERENCES document(id),
    node TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    decision TEXT,
    confidence REAL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_event (
    id INTEGER PRIMARY KEY,
    document_id INTEGER REFERENCES document(id),
    kind TEXT NOT NULL,
    -- injection_suspected | duplicate | schema_violation | low_confidence
    detail TEXT NOT NULL,
    action TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification (
    id INTEGER PRIMARY KEY,
    obligation_id INTEGER NOT NULL REFERENCES obligation(id),
    channel TEXT NOT NULL,
    tier TEXT NOT NULL,   -- T-60 | T-30 | T-7 | T-1 | second_contact
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    delivered INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_document_company ON document(company_id);
CREATE INDEX IF NOT EXISTS idx_obligation_company_status ON obligation(company_id, status);
CREATE INDEX IF NOT EXISTS idx_expectation_company_status ON expectation(company_id, status);
CREATE INDEX IF NOT EXISTS idx_trace_run ON trace(run_id);
"""


# Columns added after a table's first CREATE — CREATE TABLE IF NOT EXISTS
# won't retrofit these onto a database that already exists. No migration
# framework yet (ARCHITECTURE.md §9 names one as future work); this is the
# whole "migrations" story for now, and it's fine at this scale — each
# statement is idempotent (ignores "duplicate column" if already applied).
_MIGRATIONS = [
    "ALTER TABLE extraction ADD COLUMN source TEXT NOT NULL DEFAULT 'llm'",
    "ALTER TABLE review_item ADD COLUMN action TEXT",
    "ALTER TABLE review_item ADD COLUMN resolved_json TEXT",
]


def init_db(db_path: str = DB_PATH) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    for stmt in _MIGRATIONS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e):
                raise
    conn.commit()
    conn.close()


@contextmanager
def get_conn(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
