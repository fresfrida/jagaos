"""Stored statutory citations written with an em dash are reworded at startup, and nothing else is
touched (round 14, DECISIONS #87: the no-em-dash rule). It lived in test_visibility_toggle.py by accident of
timing, that file went with the lock toggle (round 19, DECISIONS #95), so it has its own file now."""

import sqlite3
import tempfile
from pathlib import Path

from app.db import init_db


def test_stored_citations_written_with_an_em_dash_are_reworded_and_nothing_else_is_touched():
    path = Path(tempfile.mkdtemp()) / "cit.db"
    init_db(str(path))
    dash = "—"
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO company (id, name, fye_month, fye_day) VALUES (1, 'X', 12, 31)")
        for label, citation in [
            ("a", f"Companies Act s197 {dash} Annual Return due within 7 months of FYE."),
            ("b", f"Income Tax Act {dash} Form C-S/C due unless IRAS has granted a filing waiver."),
            ("c", f"A note someone typed {dash} that must be left exactly as it is"),
        ]:
            conn.execute(
                "INSERT INTO obligation (company_id, kind, label, due_on, rule_id, citation) VALUES (1, 'k', ?, '2026-01-01', 'r', ?)",
                (label, citation),
            )
    init_db(str(path))
    init_db(str(path))  # idempotent

    with sqlite3.connect(path) as conn:
        got = dict(conn.execute("SELECT label, citation FROM obligation").fetchall())
    assert got["a"] == "Companies Act s197: Annual Return due within 7 months of FYE."
    assert got["b"] == "Income Tax Act: Form C-S/C due unless IRAS has granted a filing waiver."
    assert got["c"] == f"A note someone typed {dash} that must be left exactly as it is"
