#!/usr/bin/env python3
"""Exports a JagaOS SQLite database to ONE Postgres-compatible .sql file, for Supabase (2026-09-28).

    python3 scripts/export_to_supabase.py --db /path/to/a/COPY/of/jaga.db --out supabase-import.sql

THIS IS A LIFEBOAT, NOT A MIGRATION: the app keeps running on SQLite. This script produces one file a person pastes into the
Supabase SQL editor by hand, whenever they want an off-box copy of the data — nothing here wires the app to Postgres.

SAFETY
------
  * Reads a COPY of the live database, never the live one: a --db path under /opt/jaga (the Lightsail box) is refused outright,
    every time, with no override flag — make a copy first (the SQLite backup API any other script here uses; see
    docs/UAT-DEPLOYMENT.md, or sqlite3.Connection.backup()). Whatever path IS given is then opened with SQLite's own
    read-only mode (`mode=ro`), so this script cannot write to it even if the check above were somehow bypassed.
  * No credentials anywhere, no network call, no app change: it never connects to Postgres or Supabase itself, never imports
    anything from app/, and needs no extra Python package (stdlib sqlite3 only). It only WRITES a local .sql file.

WHAT IT DOES
------------
  * Introspects the GIVEN SQLite file's OWN schema at run time (sqlite_master, PRAGMA table_info) — zero dependency on the
    app package, so this keeps working even if the app's schema drifts from what this docstring describes today.
  * Skips FTS5's internal shadow tables (document_search and the four document_search_* tables it creates for itself) and
    any other CREATE VIRTUAL TABLE: Postgres has no FTS5, and the real content those tables index (extracted_text,
    description, filename, ...) is already exported as plain columns on `document`.
  * Emits, per real table, in this order:
      1. `CREATE TABLE` — each column's SQLite type mapped to a Postgres one (see _PG_TYPE below), NOT NULL and PRIMARY KEY
         (single- or multi-column) preserved exactly. DEFAULT is dropped: every row below is inserted with an explicit
         value for every column, so a default is never needed, and SQLite's own default EXPRESSIONS (`datetime('now')`)
         are not valid Postgres syntax to begin with.
      2. Its rows, as batched multi-row `INSERT` statements (BATCH_ROWS at a time), in the same column order SQLite
         reports, wrapped together with every CREATE TABLE in one `BEGIN; ... COMMIT;` — a paste that fails partway
         leaves NOTHING behind half-loaded; fix whatever the SQL editor's error named and paste the same file again.
    FOREIGN KEY constraints are deliberately DROPPED (so table/row order never matters — no topological sort, no deferred-
    constraint tricks that might not even be permitted in a hosted SQL editor). A lifeboat's job is to keep the DATA intact
    and queryable, not to re-enforce a dead schema's relational rules.
  * Then, OUTSIDE that transaction (so one failing index can never take the data down with it): one `CREATE [UNIQUE] INDEX`
    per real SQLite index (skipping the implicit ones a PRIMARY KEY or a column UNIQUE constraint already creates), each
    its own statement — SQLite and Postgres index DDL agree closely enough (including a partial index's `WHERE`) that a
    close-to-verbatim translation is enough for this schema; anything CREATE INDEX doesn't understand is skipped with a
    comment naming why, never silently dropped.

OUTPUT: one UTF-8 .sql file. Row counts for every exported table are printed to stdout as a receipt — compare them against
`SELECT count(*) FROM table` on the Postgres side after pasting, or use scripts/verify_supabase_export.py’s sibling checks
if this script grows one.
"""

from __future__ import annotations

import argparse
import datetime
import sqlite3
import sys
from pathlib import Path

LIVE_ROOT = Path("/opt/jaga")
BATCH_ROWS = 500  # rows per multi-row INSERT statement — small enough that no single statement is unreasonably large


def _refuse_if_live(db_path: str) -> None:
    """Refuses outright — no override flag exists for this one, on purpose. 'a COPY, never the live one' is the whole point;
    a script that could be told to point at the live file anyway is not a safety property."""
    resolved = Path(db_path).expanduser().resolve()
    if resolved == LIVE_ROOT or LIVE_ROOT in resolved.parents:
        print(
            f"REFUSED: {resolved} is under {LIVE_ROOT}, the live server. This script reads a COPY, never the live database — "
            "make one first (the SQLite backup API: sqlite3.connect(src).backup(sqlite3.connect(dst)), read-only against the "
            "live file, used elsewhere in this repo) and point --db at that copy instead.",
            file=sys.stderr,
        )
        sys.exit(2)


# ----------------------------------------------------------------------------------------------------- schema introspection

_PG_TYPE_BY_AFFINITY = [
    # (substring found in the SQLite declared type, case-insensitive) -> the Postgres type. Checked in order, SQLite's own
    # type-affinity rule order (https://www.sqlite.org/datatype3.html#determination_of_column_affinity): the first match
    # wins, so 'INT' must be checked before the catch-alls below it.
    ("INT", "bigint"),
    ("CHAR", "text"),
    ("CLOB", "text"),
    ("TEXT", "text"),
    ("BLOB", "bytea"),
    ("REAL", "double precision"),
    ("FLOA", "double precision"),
    ("DOUB", "double precision"),
    ("DECIMAL", "numeric"),
    ("NUM", "numeric"),
]


def _pg_type(sqlite_declared_type: str) -> str:
    t = (sqlite_declared_type or "").upper()
    for needle, pg in _PG_TYPE_BY_AFFINITY:
        if needle in t:
            return pg
    return "text"  # SQLite's own fallback affinity for a declared type matching none of the above


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class Table:
    def __init__(self, name: str, columns: list[dict], pk_columns: list[str]):
        self.name = name
        self.columns = columns  # each: {"name", "type" (SQLite declared), "notnull"}
        self.pk_columns = pk_columns


def _real_tables(conn: sqlite3.Connection) -> list[str]:
    """Every table except FTS5's own shadow tables and any other virtual table. A virtual table's shadow tables are named
    '<vtab>_<suffix>' by SQLite's own convention — excluded by that prefix, not a hardcoded 'document_search', so a future
    FTS5 table (or any other virtual table) is handled the same way without this script needing an update."""
    rows = conn.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").fetchall()
    virtual = {name for name, sql in rows if sql and "CREATE VIRTUAL TABLE" in sql.upper()}
    shadow_prefixes = tuple(f"{v}_" for v in virtual)
    return [
        name for name, _sql in rows
        if name not in virtual and not name.startswith(shadow_prefixes) and not name.startswith("sqlite_")
    ]


def _table_info(conn: sqlite3.Connection, table: str) -> Table:
    cols = conn.execute(f"PRAGMA table_info({_quote_ident(table)})").fetchall()
    # PRAGMA table_info columns: (cid, name, type, notnull, dflt_value, pk). pk > 0 marks a PRIMARY KEY column, numbered
    # in key order (1, 2, ...) for a composite key — sort by that number, not by column order, to get the key's real order.
    pk = sorted((r[5], r[1]) for r in cols if r[5])
    return Table(
        name=table,
        columns=[{"name": r[1], "type": r[2], "notnull": bool(r[3])} for r in cols],
        pk_columns=[name for _, name in pk],
    )


def _real_indexes(conn: sqlite3.Connection, tables: list[str]) -> list[tuple[str, str]]:
    """(name, sql) for every INDEX with its own SQL text — excludes the implicit ones SQLite creates for a PRIMARY KEY or a
    column UNIQUE constraint (those have no stored `sql`; they are already covered by the CREATE TABLE's own constraints)."""
    table_set = set(tables)
    rows = conn.execute(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name"
    ).fetchall()
    return [(name, sql) for name, tbl_name, sql in rows if tbl_name in table_set]


# ----------------------------------------------------------------------------------------------------- DDL / DML rendering


def _create_table_sql(t: Table) -> str:
    lines = []
    for c in t.columns:
        parts = [_quote_ident(c["name"]), _pg_type(c["type"])]
        if c["notnull"] or c["name"] in t.pk_columns:  # a PRIMARY KEY column is implicitly NOT NULL in Postgres too
            parts.append("NOT NULL")
        lines.append("    " + " ".join(parts))
    if t.pk_columns:
        lines.append("    PRIMARY KEY (" + ", ".join(_quote_ident(c) for c in t.pk_columns) + ")")
    return f"CREATE TABLE {_quote_ident(t.name)} (\n" + ",\n".join(lines) + "\n);"


def _sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):  # sqlite3 never hands back a bool for this schema, but handled for completeness
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, bytes):
        return "E'\\\\x" + value.hex() + "'"
    text = str(value).replace("\x00", "")  # Postgres text cannot hold a NUL byte; SQLite text should never contain one anyway
    return "'" + text.replace("'", "''") + "'"


def _insert_statements(conn: sqlite3.Connection, t: Table) -> tuple[list[str], int]:
    col_names = [c["name"] for c in t.columns]
    ident_list = ", ".join(_quote_ident(n) for n in col_names)
    select_list = ", ".join(_quote_ident(n) for n in col_names)
    rows = conn.execute(f"SELECT {select_list} FROM {_quote_ident(t.name)}").fetchall()
    statements = []
    for i in range(0, len(rows), BATCH_ROWS):
        batch = rows[i : i + BATCH_ROWS]
        values_sql = ",\n".join("    (" + ", ".join(_sql_literal(v) for v in row) + ")" for row in batch)
        statements.append(f"INSERT INTO {_quote_ident(t.name)} ({ident_list}) VALUES\n{values_sql};")
    return statements, len(rows)


def _translated_index_sql(index_sql: str) -> str | None:
    """A close-to-verbatim pass of a SQLite CREATE INDEX statement: SQLite's own syntax for a plain or partial index
    (`CREATE [UNIQUE] INDEX name ON table(cols) [WHERE ...]`) is also valid Postgres syntax for every index this schema
    actually has. Returns None (skip, never guess) for anything this simple pass does not recognize as that shape."""
    s = index_sql.strip().rstrip(";")
    upper = s.upper()
    if not (upper.startswith("CREATE INDEX") or upper.startswith("CREATE UNIQUE INDEX")):
        return None
    return s + ";"


# ------------------------------------------------------------------------------------------------------------------ main


def build_export(db_path: str) -> tuple[str, dict[str, int]]:
    """Returns (the .sql file's full text, {table: row count}). Pure function of the database's own current contents —
    no randomness, no wall-clock dependence beyond the header comment's timestamp."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = None
    try:
        tables = _real_tables(conn)
        infos = {t: _table_info(conn, t) for t in tables}
        indexes = _real_indexes(conn, tables)

        parts: list[str] = [
            "-- JagaOS -> Supabase/Postgres export (a LIFEBOAT, not a migration: the app keeps running on SQLite).",
            f"-- Generated {datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')} by scripts/export_to_supabase.py",
            f"-- Source: a copy of {Path(db_path).name} ({len(tables)} tables; FTS5's own shadow/virtual tables excluded).",
            "-- Paste this whole file into the Supabase SQL editor and run it. No credentials are in this file or in the script that made it.",
            "",
            "BEGIN;",
            "",
        ]
        counts: dict[str, int] = {}
        for name in tables:
            t = infos[name]
            parts.append(f"-- {name} ({len(t.columns)} columns" + (f", primary key {t.pk_columns}" if t.pk_columns else ", no primary key") + ")")
            parts.append(_create_table_sql(t))
            parts.append("")
            statements, row_count = _insert_statements(conn, t)
            counts[name] = row_count
            parts.extend(statements)
            if statements:
                parts.append("")
        parts.append("COMMIT;")
        parts.append("")

        if indexes:
            parts.append("-- Secondary indexes, after all data has loaded (standard bulk-load practice) and OUTSIDE the")
            parts.append("-- transaction above on purpose: one index failing here can never take the loaded data down with it.")
            for index_name, index_sql in indexes:
                translated = _translated_index_sql(index_sql)
                if translated is None:
                    parts.append(f"-- SKIPPED index {index_name!r}: not a plain CREATE [UNIQUE] INDEX this script recognizes. Original SQLite SQL:")
                    parts.append(f"-- {index_sql}")
                else:
                    parts.append(translated)
            parts.append("")
        return "\n".join(parts), counts
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, help="a COPY of the SQLite database — never a path under /opt/jaga")
    ap.add_argument("--out", default="supabase-import.sql")
    args = ap.parse_args(argv)

    if not Path(args.db).is_file():
        sys.exit(f"db not found: {args.db}")
    _refuse_if_live(args.db)

    sql_text, counts = build_export(args.db)
    Path(args.out).write_text(sql_text, encoding="utf-8")

    print(f"wrote {args.out} ({len(sql_text):,} bytes, {len(counts)} tables)")
    print("row counts (compare against the Postgres side after pasting):")
    for name, n in counts.items():
        print(f"  {name:<24} {n}")
    print(f"total rows: {sum(counts.values())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
