"""scripts/rearm_review_queue.py (round 7, item S2, DECISIONS #134): after a backend restart the review items are dead (their checkpoint was in
memory); the script removes the demo PDFs and uploads the FOUR SAFE ones again (05 to 08; S1f, the statutory 01 to 04 are never uploaded because confirming
one creates 2023 events inside a seeded company incorporated in 2016) so each has a live checkpoint. Same production configuration as
tests/test_replay_mode.py: replay on, kill switch armed, no key, no client can be built."""

# app.main first (see tests/test_replay_mode.py for why).
import app.main as main_module
from app.main import app

import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.graph.pipeline as pipeline_module
import app.llm as llm
from app.db import get_conn

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
import rearm_review_queue  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)
REPLAY = Path(__file__).parent.parent / "evals" / "replay"
OWNER = "owner_priya@try-demo.test"


class _NoClientMayBeBuilt:
    def __init__(self, *args, **kwargs):
        raise AssertionError("a gateway client was constructed")


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv("LLM_REPLAY_DIR", str(REPLAY))
    monkeypatch.setenv("LLM_CALLS_DISABLED", "1")
    monkeypatch.setattr(llm, "API_KEY", "")
    monkeypatch.setattr(llm, "_client", _NoClientMayBeBuilt)
    monkeypatch.setattr(llm, "OpenAI", _NoClientMayBeBuilt)
    resp = client.post("/api/auth/dev-login", json={"email": OWNER, "name": "Priya Ramanathan", "company_name": "Rearm Co", "fye_month": 12, "fye_day": 31})
    return {"Authorization": "Bearer " + resp.json()["token"]}


def _restart() -> None:
    """What a backend restart does to the review checkpoints: they are gone (MemorySaver is in memory)."""
    pipeline_module.PIPELINE.checkpointer.storage.clear()


def _snapshot() -> dict:
    with get_conn() as conn:
        docs = sorted((r["filename"], r["status"]) for r in conn.execute("SELECT filename, status FROM document"))
        open_items = conn.execute("SELECT COUNT(*) FROM review_item WHERE status = 'open'").fetchone()[0]
    return {"docs": docs, "open_items": open_items}


SAFE = ["05_invoice_clean.pdf", "06_invoice_bad_gst.pdf", "07_invoice_injection_attempt.pdf", "08_lease_important.pdf"]
STATUTORY = ["01_certificate_of_incorporation.pdf", "02_constitution.pdf", "03_notice_office_change.pdf", "04_notice_corpsec_change.pdf"]


def _first_open_item(headers) -> dict:
    return next(i for i in client.get("/api/review", headers=headers).json() if i["document_filename"].startswith("05_"))


def _upload_all_eight(headers) -> None:
    """A company that already holds an OLDER full set of the eight demo PDFs (what production may have)."""
    for pdf in sorted((Path(__file__).parent.parent / "evals" / "demo_corpus" / "files").glob("*.pdf")):
        assert client.post("/api/documents", files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")}, headers=headers).status_code == 200


def _filenames() -> list[str]:
    with get_conn() as conn:
        return sorted(r["filename"] for r in conn.execute("SELECT filename FROM document"))


def _event_count() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) FROM event").fetchone()[0]


def test_after_a_restart_confirm_is_dead_and_rearming_makes_it_live_again(armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)                         # first arming
    item = _first_open_item(armed)
    _restart()
    dead = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=armed)
    assert dead.status_code == 410                                                # the failure the ritual exists to cure

    summary = rearm_review_queue.rearm(client, out=lambda *_: None)
    assert len(summary["removed"]) == 4 and all(not str(s).startswith("HTTP") for s in summary["outcomes"].values())
    fresh = _first_open_item(armed)
    live = client.post(f"/api/review/{fresh['id']}/resolve?thread_id={fresh['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=armed)
    assert live.status_code == 200 and live.json()["status"] == "filed"


def test_running_it_twice_ends_in_the_same_state(armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)
    first = _snapshot()
    rearm_review_queue.rearm(client, out=lambda *_: None)
    assert _snapshot() == first
    assert dict(first["docs"])["07_invoice_injection_attempt.pdf"] == "quarantined" and first["open_items"] == 4


def test_it_removes_only_the_demo_pdfs_and_history_names_the_operator(armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)
    other = client.post("/api/documents", params={"visibility": "only_me", "name": "My note"}, files={"file": ("note.txt", b"a personal note", "text/plain")}, headers=armed)
    assert other.status_code == 200
    rearm_review_queue.rearm(client, out=lambda *_: None)
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE filename = 'My note'").fetchone()[0] == 1
        deleted = conn.execute("SELECT DISTINCT actor_name FROM document_activity WHERE action = 'deleted'").fetchall()
    assert [r["actor_name"] for r in deleted] == ["system: rearm review queue"]


def test_it_refuses_unless_the_server_says_it_is_in_replay_mode(monkeypatch, armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)
    before = _snapshot()
    monkeypatch.delenv("LLM_REPLAY_DIR")                                          # the server is no longer in replay mode
    said = []
    with pytest.raises(SystemExit) as raised:
        rearm_review_queue.rearm(client, out=said.append)
    assert raised.value.code == 2 and "not in replay mode" in said[0]
    assert _snapshot() == before                                                  # nothing was removed, nothing uploaded


def test_it_refuses_when_the_owner_cannot_sign_in(armed):
    said = []
    with pytest.raises(SystemExit) as raised:
        rearm_review_queue.rearm(client, owner_email="nobody@nowhere.test", out=said.append)
    assert raised.value.code == 2


# ---------------------------------------------------------------- S1f: only the four safe files are ever uploaded


def test_by_default_it_uploads_exactly_the_four_safe_files_and_never_a_statutory_one(armed):
    summary = rearm_review_queue.rearm(client, out=lambda *_: None)
    assert sorted(summary["outcomes"]) == sorted(SAFE)
    assert _filenames() == sorted(SAFE)
    assert not any(name in _filenames() for name in STATUTORY)


def test_confirming_the_safe_files_creates_no_event_so_nothing_contradicts_the_seeded_checklist(armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)
    for item in client.get("/api/review", headers=armed).json():
        if item["document_filename"].startswith(("05_", "06_", "08_")):
            done = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=armed)
            assert done.status_code == 200, (item["document_filename"], done.text)
    assert _event_count() == 0                                                     # no 2023 incorporation event, no event of any kind


@pytest.mark.parametrize("only, expected", [("05", ["05_invoice_clean.pdf"]), ("05,06", ["05_invoice_clean.pdf", "06_invoice_bad_gst.pdf"]),
                                            ("08_lease_important.pdf", ["08_lease_important.pdf"]), (" 06 , 05 ", ["05_invoice_clean.pdf", "06_invoice_bad_gst.pdf"]),
                                            ("05,05", ["05_invoice_clean.pdf"])])
def test_only_narrows_the_set_by_prefix_or_file_name(armed, only, expected):
    summary = rearm_review_queue.rearm(client, only=only, out=lambda *_: None)
    assert sorted(summary["outcomes"]) == sorted(expected) and _filenames() == sorted(expected)


@pytest.mark.parametrize("only", ["01", "02", "03", "04", "01_certificate_of_incorporation.pdf", "05,01", "04_notice_corpsec_change.pdf,06", "09", "nonsense.pdf", "1", "0"])
def test_only_refuses_a_statutory_or_unknown_name_with_exit_2_and_changes_nothing(armed, only):
    _upload_all_eight(armed)
    before = (_snapshot(), _event_count())
    said = []
    with pytest.raises(SystemExit) as raised:
        rearm_review_queue.rearm(client, only=only, out=said.append)
    assert raised.value.code == 2 and said[0].startswith("REFUSED (exit 2): --only accepts only 05, 06, 07, 08")
    assert (_snapshot(), _event_count()) == before                                 # nothing removed, nothing uploaded


def test_the_refusal_says_why_a_statutory_file_is_refused(armed):
    said = []
    with pytest.raises(SystemExit):
        rearm_review_queue.rearm(client, only="03", out=said.append)
    assert "03_notice_office_change.pdf is a statutory demo file" in said[0] and "2023" in said[0] and "2016" in said[0]
    said.clear()
    with pytest.raises(SystemExit):
        rearm_review_queue.rearm(client, only="xyz", out=said.append)
    assert "'xyz' is not a demo file" in said[0]


def test_a_bad_only_is_refused_from_the_command_line_before_any_server_is_contacted(capsys):
    with pytest.raises(SystemExit) as raised:
        rearm_review_queue.main(["--only", "01", "--base-url", "http://127.0.0.1:9"])   # nothing listens there: a refusal that came first never tries
    assert raised.value.code == 2 and "statutory demo file" in capsys.readouterr().out


def test_a_company_holding_all_eight_ends_with_only_the_four_after_a_run_and_a_second_run_is_the_same(armed):
    _upload_all_eight(armed)
    assert len(_filenames()) == 8
    summary = rearm_review_queue.rearm(client, out=lambda *_: None)
    assert len(summary["removed"]) == 8                                            # the removal step still finds all eight
    assert _filenames() == sorted(SAFE)                                            # and only the four come back
    first = _snapshot()
    rearm_review_queue.rearm(client, out=lambda *_: None)
    assert _snapshot() == first


def test_the_only_me_file_survives_and_history_names_the_operator_even_when_all_eight_were_removed(armed):
    _upload_all_eight(armed)
    client.post("/api/documents", params={"visibility": "only_me", "name": "My note"}, files={"file": ("note.txt", b"a personal note", "text/plain")}, headers=armed)
    rearm_review_queue.rearm(client, out=lambda *_: None)
    assert "My note" in _filenames()
    with get_conn() as conn:
        deleted = {r["actor_name"] for r in conn.execute("SELECT DISTINCT actor_name FROM document_activity WHERE action = 'deleted'")}
        n = conn.execute("SELECT COUNT(*) FROM document_activity WHERE action = 'deleted'").fetchone()[0]
    assert deleted == {"system: rearm review queue"} and n == 8


def test_the_replay_mode_refusal_still_holds_with_only(monkeypatch, armed):
    _upload_all_eight(armed)
    before = _snapshot()
    monkeypatch.delenv("LLM_REPLAY_DIR")
    said = []
    with pytest.raises(SystemExit) as raised:
        rearm_review_queue.rearm(client, only="05", out=said.append)
    assert raised.value.code == 2 and "not in replay mode" in said[0] and _snapshot() == before


# ---- DECISIONS #140: dry run, refusal of seeded evidence, count assertions -------------------------------------------------------------------

def _archive_demo_copy(name: str) -> int:
    """Make a demo copy look like the 2026-09-27 originals: archived, with an event derived from it."""
    with get_conn() as conn:
        row = conn.execute("SELECT id, company_id FROM document WHERE filename = ?", (name,)).fetchone()
        conn.execute("UPDATE document SET status = 'archived' WHERE id = ?", (row["id"],))
        conn.execute("INSERT INTO event (company_id, kind, occurred_on, title, confidence, status, source_document_id) VALUES (?, 'incorporation', '2016-03-14', 'x', 1.0, 'confirmed', ?)", (row["company_id"], row["id"]))
        return row["id"]


def test_dry_run_changes_nothing_and_says_what_it_would_do(armed, capsys):
    _upload_all_eight(armed)
    before = _snapshot()
    lines: list[str] = []
    summary = rearm_review_queue.rearm(client, dry_run=True, out=lines.append)
    assert _snapshot() == before
    assert summary["dry_run"] is True and len(summary["would_remove"]) == 8 and summary["would_upload"] == SAFE
    assert any("DRY RUN" in l for l in lines)


def test_it_refuses_to_remove_an_archived_copy_or_one_with_derived_events_and_changes_nothing(armed):
    _upload_all_eight(armed)
    doc_id = _archive_demo_copy("01_certificate_of_incorporation.pdf")
    before, events = _snapshot(), _event_count()
    lines: list[str] = []
    with pytest.raises(SystemExit) as exit_info:
        rearm_review_queue.rearm(client, out=lines.append)
    assert exit_info.value.code == 2
    assert _snapshot() == before and _event_count() == events
    assert any(f"document {doc_id} is archived" in l and "Nothing was changed" in l for l in lines)


def test_dry_run_reports_the_refusal_a_real_run_would_make(armed):
    _upload_all_eight(armed)
    _archive_demo_copy("01_certificate_of_incorporation.pdf")
    summary = rearm_review_queue.rearm(client, dry_run=True, out=lambda *_: None)
    assert summary["blockers"] and "archived" in summary["blockers"][0]


def test_a_count_change_after_the_removal_exits_3(armed, monkeypatch):
    _upload_all_eight(armed)
    real = rearm_review_queue._counts
    calls = {"n": 0}

    def drifting(conn, company_id):
        calls["n"] += 1
        got = real(conn, company_id)
        if calls["n"] == 2:  # the count taken after the removal
            got["events"] += 1
        return got

    monkeypatch.setattr(rearm_review_queue, "_counts", drifting)
    with pytest.raises(SystemExit) as exit_info:
        rearm_review_queue.rearm(client, out=lambda *_: None)
    assert exit_info.value.code == 3
