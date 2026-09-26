"""scripts/rearm_review_queue.py (round 7, item S2, DECISIONS #134): after a backend restart the review items are dead (their checkpoint was in
memory); the script removes the demo PDFs and uploads them again so each has a live checkpoint. Same production configuration as
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


def _first_open_item(headers) -> dict:
    return next(i for i in client.get("/api/review", headers=headers).json() if i["document_filename"].startswith("01_"))


def test_after_a_restart_confirm_is_dead_and_rearming_makes_it_live_again(armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)                         # first arming
    item = _first_open_item(armed)
    _restart()
    dead = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=armed)
    assert dead.status_code == 410                                                # the failure the ritual exists to cure

    summary = rearm_review_queue.rearm(client, out=lambda *_: None)
    assert len(summary["removed"]) == 8 and all(not str(s).startswith("HTTP") for s in summary["outcomes"].values())
    fresh = _first_open_item(armed)
    live = client.post(f"/api/review/{fresh['id']}/resolve?thread_id={fresh['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=armed)
    assert live.status_code == 200 and live.json()["status"] == "filed"


def test_running_it_twice_ends_in_the_same_state(armed):
    rearm_review_queue.rearm(client, out=lambda *_: None)
    first = _snapshot()
    rearm_review_queue.rearm(client, out=lambda *_: None)
    assert _snapshot() == first
    assert dict(first["docs"])["07_invoice_injection_attempt.pdf"] == "quarantined" and first["open_items"] >= 7


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
