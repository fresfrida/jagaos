"""scripts/purge_document.py: HARD delete of documents by id (2026-09-24, DECISIONS #91).

Two kinds of test. The first builds a full graph by SQL (a document with its file,
search row, extractions, trace, security event, an event it produced, the obligation
and checklist row derived from that event, a notification and a review item on the
obligation) so every reference the script must clear exists, next to a second
document that must come through untouched. The second goes through the real upload
and confirm endpoints (canned model) so the event, obligation and checklist rows are
the ones the pipeline really writes, and purges that.
"""

import io
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import app.graph.classify as classify_module  # noqa: E402
import app.graph.derive_events as derive_events_module  # noqa: E402
import app.graph.extract as extract_module  # noqa: E402
import purge_document  # noqa: E402
from app.db import DB_PATH, get_conn, reindex_document_search  # noqa: E402
from app.llm import LLMResult  # noqa: E402
from app.main import app  # noqa: E402

MARKER = "zqxjmarker8841"


@pytest.fixture
def world(tmp_path):
    """Company 1 with document A (everything hangs off it) and document B (must
    survive), and an unrelated company 2 with its own document."""
    with get_conn() as conn:
        for name in ("Purge Co", "Bystander Co"):
            conn.execute("INSERT INTO company (name, fye_month, fye_day) VALUES (?, 12, 31)", (name,))
        c1, c2 = [r["id"] for r in conn.execute("SELECT id FROM company ORDER BY id")]

    def document(company_id: int, name: str, description: str = "") -> dict:
        path = tmp_path / f"{name}.pdf"
        path.write_bytes(f"%PDF {name}".encode())
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, "
                "lane, doc_type, bucket, status, description, extracted_text) "
                "VALUES (?, ?, ?, 'application/pdf', 10, ?, 'web', 'statutory', 'Certificate of Incorporation', "
                "'Statutory', 'filed', ?, ?)",
                (company_id, f"sha-{name}", f"{name}.pdf", str(path), json.dumps({"en": description}), f"text of {name} {description}"),
            )
            doc_id = cur.lastrowid
        reindex_document_search(doc_id)
        return {"id": doc_id, "path": path, "company_id": company_id}

    a = document(c1, "doc-a", f"a certificate {MARKER}")
    b = document(c1, "doc-b", "a constitution")
    other = document(c2, "doc-other", "someone else's")

    with get_conn() as conn:
        def add(sql: str, *params) -> int:
            return conn.execute(sql, params).lastrowid

        for doc in (a, b, other):
            add("INSERT INTO extraction (document_id, field, value_text, confidence, extractor_version) VALUES (?, 'x', 'y', 0.9, 'v')", doc["id"])
            add("INSERT INTO trace (run_id, company_id, document_id, node) VALUES ('r', ?, ?, 'classify')", doc["company_id"], doc["id"])
            add("INSERT INTO security_event (document_id, kind, detail, action) VALUES (?, 'duplicate', 'again', 'skipped')", doc["id"])
            add("INSERT INTO review_item (company_id, document_id, reason, question, proposed_json) VALUES (?, ?, 'clean', '[]', '{}')", doc["company_id"], doc["id"])
        event = add("INSERT INTO event (company_id, kind, occurred_on, title, source_document_id) VALUES (?, 'incorporation', '2026-01-15', 'Incorporated', ?)", c1, a["id"])
        obligation = add(
            "INSERT INTO obligation (company_id, event_id, kind, label, due_on, rule_id, citation) VALUES (?, ?, 'ar', 'File AR', '2026-07-31', 'r1', 'c')",
            c1, event,
        )
        add("INSERT INTO notification (obligation_id, channel, tier) VALUES (?, 'email', 'T-30')", obligation)
        add("INSERT INTO review_item (company_id, obligation_id, reason, question, proposed_json) VALUES (?, ?, 'o', '[]', '{}')", c1, obligation)
        # checklist rows: one produced by A's event and satisfied by B, one produced elsewhere and satisfied by A
        from_event = add(
            "INSERT INTO expectation (company_id, event_id, doc_type, label, rule_id, status, evidence_document_id) "
            "VALUES (?, ?, 'constitution', 'Constitution', 'k1', 'satisfied', ?)", c1, event, b["id"],
        )
        other_event = add("INSERT INTO event (company_id, kind, occurred_on, title, source_document_id) VALUES (?, 'corpsec_change', '2026-02-01', 'Change', ?)", c1, b["id"])
        satisfied_by_a = add(
            "INSERT INTO expectation (company_id, event_id, doc_type, label, rule_id, status, evidence_document_id) "
            "VALUES (?, ?, 'certificate_of_incorporation', 'Certificate', 'k2', 'satisfied', ?)", c1, other_event, a["id"],
        )
    return {"a": a, "b": b, "other": other, "c1": c1, "c2": c2, "event": event, "obligation": obligation,
            "from_event": from_event, "satisfied_by_a": satisfied_by_a}


def _count(sql: str, *params) -> int:
    with get_conn() as conn:
        return conn.execute(sql, params).fetchone()[0]


def _row_counts() -> dict[str, int]:
    tables = ["document", "extraction", "trace", "security_event", "review_item", "event", "obligation", "notification", "expectation", "document_search"]
    with get_conn() as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def purge(ids, **kwargs) -> tuple[int, str]:
    lines: list[str] = []
    code = purge_document.purge_documents(list(ids), out=lines.append, **kwargs)
    return code, "\n".join(lines)


def test_a_dry_run_says_what_would_go_and_changes_nothing(world):
    before = _row_counts()

    code, out = purge([world["a"]["id"]])

    assert code == 0
    assert "DRY RUN" in out and "doc-a.pdf" in out and "will be deleted" in out
    assert "event(s)" in out and "obligation(s)" in out
    assert _row_counts() == before
    assert world["a"]["path"].exists()


def test_apply_removes_the_file_the_row_the_search_row_and_everything_derived(world):
    a = world["a"]

    code, out = purge([a["id"]], apply=True)

    assert code == 0, out
    assert not a["path"].exists()
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", a["id"]) == 0
    assert _count("SELECT COUNT(*) FROM document_search WHERE rowid = ?", a["id"]) == 0
    for table in ("extraction", "trace", "security_event", "review_item"):
        assert _count(f"SELECT COUNT(*) FROM {table} WHERE document_id = ?", a["id"]) == 0, table
    # the derived rows: the event A produced, the obligation and checklist row from that event, and the
    # obligation's own notification and review item
    assert _count("SELECT COUNT(*) FROM event WHERE id = ?", world["event"]) == 0
    assert _count("SELECT COUNT(*) FROM obligation WHERE id = ?", world["obligation"]) == 0
    assert _count("SELECT COUNT(*) FROM notification WHERE obligation_id = ?", world["obligation"]) == 0
    assert _count("SELECT COUNT(*) FROM review_item WHERE obligation_id = ?", world["obligation"]) == 0
    assert _count("SELECT COUNT(*) FROM expectation WHERE id = ?", world["from_event"]) == 0
    with get_conn() as conn:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == [], "no dangling reference is left"


def test_everything_else_comes_through_untouched(world):
    purge([world["a"]["id"]], apply=True)

    for key in ("b", "other"):
        doc = world[key]
        assert doc["path"].exists()
        assert _count("SELECT COUNT(*) FROM document WHERE id = ?", doc["id"]) == 1
        assert _count("SELECT COUNT(*) FROM document_search WHERE rowid = ?", doc["id"]) == 1
        for table in ("extraction", "trace", "security_event", "review_item"):
            assert _count(f"SELECT COUNT(*) FROM {table} WHERE document_id = ?", doc["id"]) == 1, (key, table)
    assert _count("SELECT COUNT(*) FROM company") == 2
    assert _count("SELECT COUNT(*) FROM event WHERE source_document_id = ?", world["b"]["id"]) == 1  # B's own event


def test_a_checklist_row_the_document_satisfied_is_reopened_not_left_claiming_it_is_held(world):
    with get_conn() as conn:  # nothing else held is a certificate, so nothing can take over
        conn.execute("UPDATE document SET doc_type = 'Company Constitution' WHERE id = ?", (world["b"]["id"],))

    purge([world["a"]["id"]], apply=True)

    with get_conn() as conn:
        row = conn.execute("SELECT status, evidence_document_id FROM expectation WHERE id = ?", (world["satisfied_by_a"],)).fetchone()
        trace = [r["decision"] for r in conn.execute("SELECT decision FROM trace WHERE node = 'rules.reopen_expectation'")]
    assert (row["status"], row["evidence_document_id"]) == ("missing", None)
    assert trace == ["satisfied->missing by purge_document (evidence purged)"]


def test_another_matching_document_takes_over_the_reopened_row(world):
    """B is a Certificate of Incorporation too (the fixture gives every document that doc_type),
    so once A is gone the reopened row is satisfied again, by B."""
    purge([world["a"]["id"]], apply=True)

    # both fixture documents carry the doc_type 'Certificate of Incorporation', so reconcile relinks to the survivor
    with get_conn() as conn:
        row = conn.execute("SELECT status, evidence_document_id FROM expectation WHERE id = ?", (world["satisfied_by_a"],)).fetchone()
    assert (row["status"], row["evidence_document_id"]) == ("satisfied", world["b"]["id"])


def test_a_nonexistent_id_is_refused_loudly_and_changes_nothing(world):
    before = _row_counts()

    code, out = purge([987654], apply=True)

    assert code == 2
    assert "REFUSED" in out and "987654 does not exist" in out
    assert _row_counts() == before


def test_one_bad_id_stops_the_whole_batch_before_anything_is_deleted(world):
    before = _row_counts()

    code, out = purge([world["a"]["id"], 987654], apply=True)

    assert code == 2 and "REFUSED" in out
    assert _row_counts() == before and world["a"]["path"].exists()


def test_a_foreign_key_the_script_does_not_know_about_stops_it(world):
    with get_conn() as conn:
        conn.execute("CREATE TABLE zz_added_later (id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES document(id))")
        conn.execute("INSERT INTO zz_added_later (document_id) VALUES (?)", (world["a"]["id"],))
    try:
        before = _row_counts()
        code, out = purge([world["a"]["id"]], apply=True)

        assert code == 2
        assert "zz_added_later.document_id" in out and "does not handle" in out
        assert _row_counts() == before and world["a"]["path"].exists()
    finally:
        with get_conn() as conn:
            conn.execute("DROP TABLE zz_added_later")


def test_an_obligation_that_only_cites_the_document_as_evidence_is_not_silently_deleted_or_orphaned(world):
    with get_conn() as conn:
        conn.execute("UPDATE obligation SET evidence_document_id = ? WHERE id = ?", (world["b"]["id"], world["obligation"]))
        other_event = conn.execute("SELECT id FROM event WHERE source_document_id = ?", (world["b"]["id"],)).fetchone()["id"]
        stray = conn.execute(
            "INSERT INTO obligation (company_id, event_id, kind, label, due_on, rule_id, citation, evidence_document_id) "
            "VALUES (?, ?, 'x', 'Cites B', '2026-08-01', 'r2', 'c', ?)", (world["c1"], other_event, world["b"]["id"]),
        ).lastrowid

    code, out = purge([world["b"]["id"]], apply=True)

    assert code == 2 and str(stray) in out and "cite document" in out
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", world["b"]["id"]) == 1


def test_expect_guards_against_a_mistyped_id(world):
    code, out = purge([world["b"]["id"]], apply=True, expect="living room")
    assert code == 2 and "does not contain 'living room'" in out
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", world["b"]["id"]) == 1

    code, _ = purge([world["b"]["id"]], apply=True, expect="CONSTITUTION")  # any case, description or filename
    assert code == 0
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", world["b"]["id"]) == 0


def test_a_file_already_missing_is_reported_not_an_error(world):
    world["a"]["path"].unlink()

    code, out = purge([world["a"]["id"]], apply=True)

    assert code == 0
    assert "already missing on disk" in out
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", world["a"]["id"]) == 0


def test_a_file_another_row_still_uses_is_kept(world):
    with get_conn() as conn:
        conn.execute("UPDATE document SET stored_path = ? WHERE id = ?", (str(world["a"]["path"]), world["b"]["id"]))

    code, out = purge([world["a"]["id"]], apply=True)

    assert code == 0 and "will be KEPT" in out
    assert world["a"]["path"].exists()


def test_a_file_that_cannot_be_removed_is_named_and_the_exit_code_says_so(world, monkeypatch):
    def refuse(self, *a, **k):
        raise PermissionError("nope")

    monkeypatch.setattr(Path, "unlink", refuse)

    code, out = purge([world["a"]["id"]], apply=True)

    assert code == 4 and "doc-a.pdf" in out and "delete them by hand" in out
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", world["a"]["id"]) == 0


def test_a_failure_part_way_rolls_the_whole_document_back(world, monkeypatch):
    """Deletion is one transaction: if a step raises, no row of that document is gone."""
    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(purge_document, "reopen_expectation", boom)
    before = _row_counts()

    with pytest.raises(RuntimeError):
        purge([world["a"]["id"]], apply=True)

    assert _row_counts() == before and world["a"]["path"].exists()


@pytest.mark.parametrize("vacuum", [False, True])
def test_the_deleted_text_is_not_left_in_the_database_file(world, vacuum):
    """secure_delete + the full-text index merge + a WAL checkpoint (and, with --vacuum, a vacuum):
    a marker unique to the purged document is in the file before, and gone from the database and
    its WAL after. The no-vacuum case is the one that shows secure_delete and the checkpoint work."""
    def db_bytes() -> bytes:
        data = Path(DB_PATH).read_bytes()
        wal = Path(str(DB_PATH) + "-wal")
        return data + (wal.read_bytes() if wal.exists() else b"")

    assert MARKER.encode() in db_bytes(), "the marker must be findable first, or the test proves nothing"

    code, out = purge([world["a"]["id"]], apply=True, vacuum=vacuum)

    assert code == 0 and "checkpointed the WAL" in out and ("vacuumed" in out) is vacuum
    assert MARKER.encode() not in db_bytes()


# ---- through the real pipeline --------------------------------------------------------------

client = TestClient(app)


def _tool(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
                     tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}])


def _pdf(tag: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, f"CERTIFICATE OF INCORPORATION {tag}")
    c.save()
    return buf.getvalue()


def test_purging_a_confirmed_statutory_document_removes_what_the_pipeline_derived_from_it(monkeypatch):
    def prov(v):
        return {"value": v, "confidence": 0.95, "page": 1}

    monkeypatch.setattr(classify_module, "call", lambda model, system, user, **kw: _tool("classify_document", {
        "lane": "statutory", "doc_type": "Certificate of Incorporation", "confidence": 0.96, "injection_suspected": False,
        "bucket": "Statutory", "vendor_name": None, "description": "Certificate of incorporation", "description_en": "Certificate of incorporation"}, model))
    monkeypatch.setattr(extract_module, "call", lambda model, system, user, **kw: _tool("extract_statutory_fields", {
        "doc_type": prov("Certificate of Incorporation"), "subject": prov("The company"), "issued_on": prov("2026-01-15")}, model))
    monkeypatch.setattr(derive_events_module, "call", lambda model, system, user, **kw: _tool("propose_event", {
        "kind": "incorporation", "occurred_on": "2026-01-15", "title": "Company incorporated", "confidence": 0.9}, model))
    owner = client.post("/api/auth/dev-login", json={"email": "owner@purge.test", "company_name": "Pipeline Co", "fye_month": 12, "fye_day": 31}).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}
    doc_id = client.post("/api/documents", headers=headers, files={"file": ("cert.pdf", _pdf("one"), "application/pdf")}).json()["document_id"]
    item = next(i for i in client.get("/api/review", headers=headers).json() if i["document_id"] == doc_id)
    assert client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=headers).status_code == 200
    stored = Path(_count_value("SELECT stored_path FROM document WHERE id = ?", doc_id))
    assert stored.exists()
    assert _count("SELECT COUNT(*) FROM event WHERE source_document_id = ?", doc_id) == 1
    assert _count("SELECT COUNT(*) FROM obligation") >= 1, "the pipeline derived obligations from the event"
    assert _count("SELECT COUNT(*) FROM expectation") >= 1

    code, out = purge([doc_id], apply=True)

    assert code == 0, out
    assert not stored.exists()
    assert _count("SELECT COUNT(*) FROM document WHERE id = ?", doc_id) == 0
    assert _count("SELECT COUNT(*) FROM event") == 0
    assert _count("SELECT COUNT(*) FROM obligation") == 0
    assert _count("SELECT COUNT(*) FROM expectation") == 0
    assert client.get("/api/documents", headers=headers).json() == []
    with get_conn() as conn:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def _count_value(sql: str, *params):
    with get_conn() as conn:
        return conn.execute(sql, params).fetchone()[0]


# ---- the reopen helper on its own -------------------------------------------------------------

def test_reopen_expectation_only_reopens_a_satisfied_row(world):
    from app.rules.transitions import InvalidTransition, reopen_expectation

    with get_conn() as conn:
        missing = conn.execute(
            "INSERT INTO expectation (company_id, doc_type, label, rule_id, status) VALUES (?, 'x', 'X', 'k9', 'missing')", (world["c1"],)).lastrowid
    with pytest.raises(InvalidTransition):
        reopen_expectation(missing, "test")
    with pytest.raises(ValueError):
        reopen_expectation(424242, "test")

    reopen_expectation(world["satisfied_by_a"], "test")  # its own connection when none is passed

    assert _count_value("SELECT status FROM expectation WHERE id = ?", world["satisfied_by_a"]) == "missing"
    assert _count_value("SELECT evidence_document_id FROM expectation WHERE id = ?", world["satisfied_by_a"]) is None
