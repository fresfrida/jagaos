"""SQLite (WAL) schema and connection. ARCHITECTURE.md §2.

No ORM: the schema is small and stable, and raw SQL keeps every query
inspectable in the trace panel. One connection per request, WAL mode so the
scheduler and the API can both write without locking each other out.
"""

import json
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

-- 2026-09-24 (round 12, DECISIONS #77): a group of companies under one
-- holding name. Deliberately just a label — company.group_id (a migration
-- below) points at it, and NOTHING derives access from it: who may see a
-- company is still and only the membership row for that (user, company).
-- The group is how the owner's company switcher is labelled, not a role.
CREATE TABLE IF NOT EXISTS company_group (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_user (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS membership (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES company(id),
    user_id INTEGER NOT NULL REFERENCES app_user(id),
    role TEXT NOT NULL,   -- owner | admin | user | viewer — see app/auth.py ROLE_ORDER
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, user_id)
);

CREATE TABLE IF NOT EXISTS session (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES app_user(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT
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
    uploaded_by_user_id INTEGER REFERENCES app_user(id),
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    occurred_on TEXT,
    lane TEXT,                      -- statutory | invoice | important | memory
    doc_type TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    -- received|extracted|proposed|needs_review|filed|rejected|quarantined|archived
    extracted_text TEXT,
    text_source TEXT,               -- pdfplumber | ocr | exif | none
    description TEXT,               -- one-sentence, human-readable; set by
                                     -- classify.py (app/graph/classify.py),
                                     -- editable by the user afterward
    -- 2026-09-22 (DECISIONS #42): supersedes the tag/document_tag tables —
    -- fixed taxonomy, no join tables. bucket is one of exactly Receivables|
    -- Expenses|Statutory|Operations|Contracts|Memory Lane|Miscellaneous (enforced in
    -- app code/prompt, not a SQL CHECK — a human can always correct it in
    -- review, same as every other field).
    bucket TEXT,
    vendor_name TEXT                -- counterparty read off the document
                                     -- (vendor/landlord/issuer); nullable —
                                     -- not every document has one
);

-- Real full-text search (ARCHITECTURE.md's original "SQLite FTS5" plan;
-- 2026-09-22, first implementation, tag_names column replaced by
-- bucket/vendor_name 2026-09-22 — DECISIONS #42 — when the tag system was
-- superseded). A standalone (non-contentless) FTS5 table: it stores its
-- own copy of the indexed text, which is the simplest way to keep in sync
-- correctly — every write goes through app.db.reindex_document_search()
-- below rather than app code touching this table directly. rowid IS
-- document.id (set explicitly on insert), so a document's row is always
-- `WHERE rowid = ?`, never a separate lookup column. company_id is
-- UNINDEXED (stored, not full-text-searched) so a search can be scoped
-- with a plain `AND company_id = ?` — never return a match across
-- tenants. bucket/doc_type filtering itself happens client-side over the
-- already-fetched documents list (like the tag-chip filter did) — this
-- table's job is free-text (filename/description/extracted_text), plus
-- bucket/vendor_name so a search for a vendor's name or a bucket's name
-- still works as free text too.
CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
    filename,
    doc_type,
    description,
    extracted_text,
    bucket,
    vendor_name,
    company_id UNINDEXED
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
    "ALTER TABLE document ADD COLUMN uploaded_by_user_id INTEGER REFERENCES app_user(id)",
    "ALTER TABLE document ADD COLUMN description TEXT",
    "ALTER TABLE document ADD COLUMN bucket TEXT",
    "ALTER TABLE document ADD COLUMN vendor_name TEXT",
    # 2026-09-22 (DECISIONS #42): tag/document_tag superseded by the
    # bucket/vendor_name columns above. DROP TABLE IF EXISTS is already
    # idempotent (never errors, unlike ALTER ADD COLUMN on a column that
    # exists) so these don't need the try/except below.
    "DROP TABLE IF EXISTS document_tag",
    "DROP TABLE IF EXISTS tag",
    # 2026-09-24 (company-local dates): every stored timestamp (received_at,
    # created_at, etc.) is UTC via SQLite's datetime('now') — correct
    # practice, not the bug. What was missing is a per-company IANA
    # timezone to convert through before deriving "which calendar day is
    # this" (app/graph/derive_obligations.py's FYE math, the frontend's
    # Calendar day-bucketing/"today" highlight). Defaults to Singapore —
    # every company today is one; changeable via the existing
    # PATCH /api/companies/{id}.
    "ALTER TABLE company ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Singapore'",
    # 2026-09-24 (round 12, DECISIONS #77): NULL = an ungrouped company, no
    # backfill needed. A label for the switcher, never an access rule.
    "ALTER TABLE company ADD COLUMN group_id INTEGER REFERENCES company_group(id)",
    # 2026-09-24 (round 12, DECISIONS #77): which of the caller's memberships
    # this session is scoped to. NULL = "the first membership", exactly the
    # behavior before this column existed, so every existing session (and any
    # client that never switches) is unchanged. app/auth.py re-validates it
    # against the membership table on every request — it is a preference
    # among the caller's own memberships, never a grant.
    "ALTER TABLE session ADD COLUMN current_company_id INTEGER REFERENCES company(id)",
    # 2026-09-24 (round 12, DECISIONS #79): the company's registered office,
    # the one identity field of an ACRA business profile the table had no
    # column for (uen/incorporated_on/fye_*/gst_registered already exist).
    "ALTER TABLE company ADD COLUMN registered_address TEXT",
    # 2026-09-24 (round 13, DECISIONS #85): who a document is for. 'company' is
    # every document that existed before this column and the default for a new
    # one — visible per the normal role rules. 'only_me' is a personal file:
    # visible to its uploader alone, no role exception (app/auth.py::
    # may_see_document). Anything other than 'company' is treated as private,
    # so a stray value fails closed.
    "ALTER TABLE document ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company'",
]


# Kept identical to the CREATE VIRTUAL TABLE statement inside SCHEMA above
# on purpose — this copy is used to rebuild document_search on an existing
# database where it still has the old tag_names column (see
# _rebuild_document_search_if_needed below); SCHEMA's copy only ever fires
# on a database where the table doesn't exist yet, so this one can't just
# reuse IF NOT EXISTS after a DROP TABLE in the same statement.
_DOCUMENT_SEARCH_CREATE_SQL = """
CREATE VIRTUAL TABLE document_search USING fts5(
    filename,
    doc_type,
    description,
    extracted_text,
    bucket,
    vendor_name,
    company_id UNINDEXED
)
"""


def _document_search_needs_rebuild(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_search'"
    ).fetchone()
    if row is None or row[0] is None:
        return False  # doesn't exist yet — SCHEMA's own CREATE just made the current shape
    return "tag_names" in row[0]  # old shape, from before DECISIONS #42


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
    # 2026-09-22 (DECISIONS #42): document_search's columns changed
    # (tag_names -> bucket/vendor_name) when the tag system was superseded.
    # CREATE VIRTUAL TABLE IF NOT EXISTS (in SCHEMA above) is a no-op on a
    # database that already has the table in its old shape, so upgrading
    # it needs an explicit drop + recreate + full backfill — not just
    # another idempotent ALTER-style statement in _MIGRATIONS.
    needs_rebuild = _document_search_needs_rebuild(conn)
    if needs_rebuild:
        conn.execute("DROP TABLE document_search")
        conn.execute(_DOCUMENT_SEARCH_CREATE_SQL)
    conn.commit()
    document_ids = [r[0] for r in conn.execute("SELECT id FROM document").fetchall()] if needs_rebuild else []
    conn.close()
    for document_id in document_ids:
        reindex_document_search(document_id, db_path)


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


def parse_description(raw: str | None) -> dict[str, str]:
    """`document.description` is JSON-encoded `{"en": "...", "ms": "..."}`
    since items 5/6 (2026-09-24) — one key per language a description has
    actually been generated/edited in, English always present as the
    guaranteed fallback. Reads defensively: `None`/empty is `{}` (no
    caption yet, DECISIONS #52's pending-caption state, unaffected by this
    — still not a real description); a value that isn't valid JSON is
    every pre-2026-09-24 document's plain-text description, treated as
    `{"en": <that text>}` rather than crashing on the format change — a
    live migration, not a hard cutover that breaks every existing row."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"en": raw}
    return parsed if isinstance(parsed, dict) else {"en": raw}


def description_for(raw: str | None, language: str) -> str:
    """The best available description text for `language` — that
    language's own text if a description has been generated/edited in it,
    else the guaranteed English fallback, else "" (never None — every
    caller of this already treats "" as "nothing to show")."""
    by_language = parse_description(raw)
    return by_language.get(language) or by_language.get("en") or ""


def reindex_document_search(document_id: int, db_path: str = DB_PATH) -> None:
    """Recomputes one document's document_search row from source-of-truth
    columns (document.filename/doc_type/description/extracted_text/bucket/
    vendor_name) — delete + re-insert rather than UPDATE, so the row is
    always freshly derived, never partially stale. Call this every time
    description/bucket/vendor_name or extracted_text change:
    app/graph/ingest.py (extracted_text first set), app/graph/classify.py
    (description/bucket/vendor_name first set), app/graph/extract.py (a
    deterministic bucket correction for the invoice lane — DECISIONS #42),
    and app/main.py's document-edit endpoint (any of them user-edited).

    2026-09-24 (item 6): description's every language variant is pushed
    into FTS5's single `description` column together (space-joined), not
    just one — a search for either language's words still has to match,
    and FTS5 tokenizes whatever text it's given regardless of which
    language key it came from, so no new search infrastructure is needed
    for this, just feeding it more text than before."""
    with get_conn(db_path) as conn:
        doc = conn.execute(
            "SELECT company_id, filename, doc_type, description, extracted_text, "
            "bucket, vendor_name FROM document WHERE id = ?",
            (document_id,),
        ).fetchone()
        if doc is None:
            return

        description_by_language = parse_description(doc["description"])
        description_for_search = " ".join(description_by_language.values())

        conn.execute("DELETE FROM document_search WHERE rowid = ?", (document_id,))
        conn.execute(
            "INSERT INTO document_search "
            "(rowid, filename, doc_type, description, extracted_text, bucket, "
            " vendor_name, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (document_id, doc["filename"], doc["doc_type"] or "", description_for_search,
             doc["extracted_text"] or "", doc["bucket"] or "", doc["vendor_name"] or "",
             doc["company_id"]),
        )


def build_fts5_query(raw: str) -> str:
    """Turns free-text user input into a safe FTS5 MATCH query: each word
    is stripped of quote characters and wrapped in its own quotes (so FTS5
    query-syntax operators typed by a user — NOT, OR, -, : — are treated
    as literal words, never parsed as operators) with a trailing * for
    prefix matching. Words are implicitly ANDed (FTS5's default). Returns
    "" for empty/whitespace input — callers should treat that as "no
    query", not "match everything"."""
    tokens = [t.replace('"', "") for t in raw.split()]
    return " ".join(f'"{t}"*' for t in tokens if t)
