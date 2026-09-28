"""scripts/purge_vercel_deployment_rows.py (2026-09-28, DECISIONS #150): this script's OWN job is picking which ids
(every document currently tagged deployment='vercel', unconditionally) and logging the run; the actual delete
mechanics (dependency order, file/thumbnail cleanup, checklist reopening, WAL checkpoint) are app/purge.py's, already
covered end to end by tests/test_purge_document.py — not re-proven here."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import purge_vercel_deployment_rows as script  # noqa: E402
from app.db import get_conn  # noqa: E402


def _company() -> int:
    with get_conn() as conn:
        return conn.execute("INSERT INTO company (name, fye_month, fye_day) VALUES ('Purge-Vercel Co', 12, 31)").lastrowid


def _document(company_id: int, deployment: str, name: str, tmp_path: Path) -> dict:
    path = tmp_path / f"{name}.pdf"
    path.write_bytes(f"%PDF {name}".encode())
    with get_conn() as conn:
        doc_id = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, "
            "status, deployment) VALUES (?, ?, ?, 'application/pdf', 10, ?, 'web', 'needs_review', ?)",
            (company_id, f"sha-{name}", f"{name}.pdf", str(path), deployment),
        ).lastrowid
    return {"id": doc_id, "path": path}


def run(args: list[str], capsys, tmp_path: Path) -> tuple[int, str]:
    """script.main(), with --log ALWAYS forced into tmp_path unless the test passed its own — so a test run never
    writes into this repo's real (gitignored, but still real) logs/ directory via the script's own default path."""
    if "--log" not in args:
        args = [*args, "--log", str(tmp_path / "test.log")]
    code = script.main(args)
    return code, capsys.readouterr().out


def test_a_dry_run_with_no_vercel_rows_says_so_and_changes_nothing(capsys, tmp_path):
    c = _company()
    with get_conn() as conn:
        aws_count_before = conn.execute("SELECT COUNT(*) FROM document").fetchone()[0]

    code, out = run([], capsys, tmp_path)

    assert code == 0
    assert "0 deployment='vercel' documents found" in out
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == aws_count_before


def test_it_finds_only_vercel_rows_and_never_touches_an_aws_row(tmp_path, capsys):
    c = _company()
    aws_doc = _document(c, "aws", "stays", tmp_path)
    vercel_doc = _document(c, "vercel", "goes", tmp_path)

    code, out = run(["--apply", "--actor", "test-operator"], capsys, tmp_path)

    assert code == 0, out
    assert str(vercel_doc["id"]) in out and "goes.pdf" in out
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (vercel_doc["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (aws_doc["id"],)).fetchone()[0] == 1
    assert aws_doc["path"].exists() and not vercel_doc["path"].exists()


def test_multiple_vercel_rows_of_any_status_are_all_swept_unconditionally(tmp_path, capsys):
    c = _company()
    docs = [_document(c, "vercel", f"v{i}", tmp_path) for i in range(3)]
    with get_conn() as conn:
        conn.execute("UPDATE document SET status = 'filed' WHERE id = ?", (docs[0]["id"],))
        conn.execute("UPDATE document SET status = 'quarantined' WHERE id = ?", (docs[1]["id"],))
        # docs[2] stays 'needs_review' from the fixture

    code, out = run(["--apply", "--actor", "test-operator"], capsys, tmp_path)

    assert code == 0, out
    with get_conn() as conn:
        for doc in docs:
            assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc["id"],)).fetchone()[0] == 0


def test_a_personal_only_me_vercel_row_is_swept_too(tmp_path, capsys):
    """deployment is set on every new document regardless of visibility (app/main.py); this script does not
    re-derive that distinction, so a personal file tagged 'vercel' goes the same as a company one."""
    c = _company()
    doc = _document(c, "vercel", "personal", tmp_path)
    with get_conn() as conn:
        conn.execute("UPDATE document SET visibility = 'only_me' WHERE id = ?", (doc["id"],))

    code, out = run(["--apply", "--actor", "test-operator"], capsys, tmp_path)

    assert code == 0, out
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc["id"],)).fetchone()[0] == 0


def test_dry_run_reports_the_vercel_rows_but_deletes_nothing(tmp_path, capsys):
    c = _company()
    doc = _document(c, "vercel", "kept-for-now", tmp_path)

    code, out = run([], capsys, tmp_path)  # no --apply

    assert code == 0
    assert str(doc["id"]) in out and "DRY RUN" in out
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc["id"],)).fetchone()[0] == 1
    assert doc["path"].exists()


def test_apply_without_an_actor_is_refused_exactly_like_the_shared_purge_code(tmp_path, capsys):
    c = _company()
    doc = _document(c, "vercel", "protected", tmp_path)

    code, out = run(["--apply"], capsys, tmp_path)  # no --actor

    assert code == 2 and "REFUSED" in out and "--actor" in out
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc["id"],)).fetchone()[0] == 1


def test_every_run_is_appended_to_the_log_file_with_a_timestamp(tmp_path, capsys):
    c = _company()
    doc = _document(c, "vercel", "logged", tmp_path)
    log_path = tmp_path / "purge_vercel.log"

    run(["--apply", "--actor", "test-operator", "--log", str(log_path)], capsys, tmp_path)

    text = log_path.read_text()
    assert "APPLY" in text and str(doc["id"]) in text and "logged.pdf" in text
    # a second run (nothing left to delete) appends rather than overwriting the first run's record
    run(["--log", str(log_path)], capsys, tmp_path)
    text_after = log_path.read_text()
    assert text_after.startswith(text) and "0 deployment='vercel' documents found" in text_after


def test_the_default_log_path_is_relative_to_this_scripts_own_location(monkeypatch, tmp_path):
    """On the box this script lives at /opt/jaga/backend/scripts/..., so the default (no --log flag at all)
    must resolve to /opt/jaga/backend/logs/purge_vercel.log — one directory up from scripts/, not the caller's cwd."""
    assert script.DEFAULT_LOG == Path(script.__file__).parent.parent / "logs" / "purge_vercel.log"
