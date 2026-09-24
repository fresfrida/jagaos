"""scripts/reset_demo_data.py: wipe the demo scope and re-seed it (2026-09-24, DECISIONS #91).

The seed goes through the API exactly as in real use; here the "server" is the app
in-process (TestClient) with the model canned, and the corpus is three small PDFs
in a temp directory. What is pinned:
  - a run restores exactly the clean seed, and a second run right after it produces
    the same state (no duplicates, no errors, no orphaned files);
  - tampering (a changed role, a deleted document, an extra member, a renamed
    company) is repaired;
  - nothing outside the scope is touched (a bystander company, a non-demo account, a
    demo account's membership elsewhere);
  - it refuses, changing nothing, when the script and the server are not on the same
    database, when a non-seeded company is in scope, or when the corpus is missing;
  - a dry run changes nothing.
"""

import io
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import app.graph.classify as classify_module  # noqa: E402
import reset_demo_data  # noqa: E402
import seed_dev_db  # noqa: E402
from app.db import get_conn  # noqa: E402
from app.llm import LLMResult  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
DOCS = Path(__import__("os").environ["JAGA_DOCS_PATH"])


def _pdf(tag: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, f"DEMO DOCUMENT {tag}")
    c.save()
    return buf.getvalue()


@pytest.fixture
def corpus(tmp_path) -> Path:
    folder = tmp_path / "corpus"
    folder.mkdir()
    for name in ("01_a.pdf", "02_b.pdf", "03_c.pdf"):
        (folder / name).write_bytes(_pdf(name))
    return folder


@pytest.fixture(autouse=True)
def canned_model(monkeypatch):
    def fake_classify(model, system, user, **kwargs):
        return LLMResult(content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1, tool_calls=[
            {"function": {"name": "classify_document", "arguments": json.dumps({
                "lane": "important", "doc_type": "contract", "confidence": 0.9, "injection_suspected": False,
                "bucket": "Contracts", "vendor_name": None, "description": "A contract", "description_en": "A contract"})}}])

    monkeypatch.setattr(classify_module, "call", fake_classify)


def run(corpus, **kwargs) -> tuple[int, str]:
    lines: list[str] = []
    code = reset_demo_data.reset(client, files_dir=corpus, out=lines.append, **kwargs)
    return code, "\n".join(lines)


def _state() -> dict:
    with get_conn() as conn:
        return reset_demo_data.fingerprint(conn)


def _files() -> set[str]:
    return {p.name for p in DOCS.iterdir()}


def _counts() -> dict[str, int]:
    tables = ["company", "company_group", "app_user", "membership", "document", "review_item", "event", "obligation", "expectation", "trace"]
    with get_conn() as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def _bystander() -> dict:
    """A company, an owner, a document with a file, an event and an obligation that have nothing to do with the demo."""
    owner = client.post("/api/auth/dev-login", json={"email": "someone@real.test", "company_name": "Real Co", "fye_month": 12, "fye_day": 31}).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}
    doc_id = client.post("/api/documents", headers=headers, files={"file": ("real.pdf", _pdf("real"), "application/pdf")}).json()["document_id"]
    with get_conn() as conn:
        event = conn.execute("INSERT INTO event (company_id, kind, occurred_on, title, source_document_id) VALUES (?, 'incorporation', '2026-01-01', 'Real event', ?)", (owner["company"]["id"], doc_id)).lastrowid
        conn.execute("INSERT INTO obligation (company_id, event_id, kind, label, due_on, rule_id, citation) VALUES (?, ?, 'ar', 'Real AR', '2026-07-31', 'r', 'c')", (owner["company"]["id"], event))
    return {"company_id": owner["company"]["id"], "headers": headers, "doc_id": doc_id}


def _bystander_rows(b: dict) -> tuple:
    with get_conn() as conn:
        return (
            tuple(map(tuple, conn.execute("SELECT id, name FROM company WHERE id = ?", (b["company_id"],)).fetchall())),
            tuple(map(tuple, conn.execute("SELECT id, filename, status FROM document WHERE company_id = ?", (b["company_id"],)).fetchall())),
            tuple(map(tuple, conn.execute("SELECT id, title FROM event WHERE company_id = ?", (b["company_id"],)).fetchall())),
            tuple(map(tuple, conn.execute("SELECT id, label FROM obligation WHERE company_id = ?", (b["company_id"],)).fetchall())),
        )


def test_a_fresh_database_gets_exactly_the_clean_seed(corpus):
    code, out = run(corpus, apply=True)

    assert code == 0, out
    state = _state()
    assert sorted(n for n, *_ in state["companies"]) == sorted(reset_demo_data.SEEDED_NAMES)
    assert all(group == "Try Demo Holdings" for _, group, *_ in state["companies"])
    assert len([m for m in state["memberships"] if m[0] == "Try Demo Pte Ltd"]) == 6
    assert sorted(f for _, f, _ in state["documents"]) == ["01_a.pdf", "02_b.pdf", "03_c.pdf"]
    with get_conn() as conn:
        reset_demo_data.verify_clean_seed(conn, corpus)  # raises if anything differs


def test_running_it_twice_in_a_row_gives_the_same_clean_state(corpus):
    assert run(corpus, apply=True)[0] == 0
    first, first_counts, first_files = _state(), _counts(), len(_files())

    code, out = run(corpus, apply=True)

    assert code == 0, out
    assert _state() == first, "the second run produced a different state"
    assert _counts() == first_counts, "rows were duplicated or left behind"
    assert len(_files()) == first_files == 3, "stored files were orphaned or duplicated"
    assert "Wiped 3 company(ies), 3 document(s), 3 file(s) removed" in out


def test_tampering_is_repaired(corpus):
    assert run(corpus, apply=True)[0] == 0
    clean = _state()
    with get_conn() as conn:
        main = conn.execute("SELECT id FROM company WHERE name = 'Try Demo Pte Ltd'").fetchone()["id"]
        conn.execute("UPDATE membership SET role = 'owner' WHERE company_id = ? AND user_id = (SELECT id FROM app_user WHERE email = 'viewer@try-demo.test')", (main,))
        conn.execute("DELETE FROM review_item WHERE document_id = (SELECT id FROM document WHERE filename = '01_a.pdf')")
        conn.execute("UPDATE document SET status = 'archived' WHERE filename = '02_b.pdf'")
        conn.execute("INSERT INTO app_user (email, name) VALUES ('judge@else.test', 'Judge')")
        conn.execute("INSERT INTO membership (company_id, user_id, role) VALUES (?, (SELECT id FROM app_user WHERE email = 'judge@else.test'), 'admin')", (main,))
        conn.execute("UPDATE app_user SET name = 'Hacked' WHERE email = 'admin@try-demo.test'")
    assert _state() != clean

    code, out = run(corpus, apply=True)

    assert code == 0, out
    assert _state() == clean
    with get_conn() as conn:
        assert conn.execute("SELECT name FROM app_user WHERE email = 'admin@try-demo.test'").fetchone()["name"] == "Demo Admin"
        assert conn.execute("SELECT COUNT(*) FROM app_user WHERE email = 'judge@else.test'").fetchone()[0] == 1, "a non-demo account's user row is kept, only its membership goes"


def test_a_company_that_no_longer_carries_a_seeded_name_is_not_wiped_without_being_asked(corpus):
    assert run(corpus, apply=True)[0] == 0
    with get_conn() as conn:
        conn.execute("UPDATE company SET name = 'Renamed By A Prefill Pte Ltd' WHERE name = 'Try Demo Trading Pte Ltd'")
    before = _counts()

    code, out = run(corpus, apply=True)

    assert code == 1
    assert "NOT a seeded name" in out and "--include-unrecognised" in out and "nothing was changed" in out
    assert _counts() == before

    code, out = run(corpus, apply=True, include_unrecognised=True)
    assert code == 0, out
    assert sorted(n for n, *_ in _state()["companies"]) == sorted(reset_demo_data.SEEDED_NAMES)


def test_nothing_outside_the_demo_scope_is_touched(corpus):
    assert run(corpus, apply=True)[0] == 0
    bystander = _bystander()
    before, files_before = _bystander_rows(bystander), _files()
    with get_conn() as conn:  # a demo account is also a member of someone else's company
        conn.execute("INSERT INTO membership (company_id, user_id, role) VALUES (?, (SELECT id FROM app_user WHERE email = 'admin@try-demo.test'), 'viewer')", (bystander["company_id"],))

    code, out = run(corpus, apply=True)

    assert code == 0, out
    assert _bystander_rows(bystander) == before
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (bystander["doc_id"],)).fetchone()[0] == 1
        assert conn.execute(
            "SELECT role FROM membership WHERE company_id = ? AND user_id = (SELECT id FROM app_user WHERE email = 'admin@try-demo.test')",
            (bystander["company_id"],)).fetchone()["role"] == "viewer", "a demo account's membership OUTSIDE the scope is left alone"
    assert client.get("/api/documents", headers=bystander["headers"]).json()[0]["id"] == bystander["doc_id"]
    assert files_before <= _files(), "the bystander's stored file is still there"


def test_the_plan_names_what_is_left_alone(corpus):
    assert run(corpus, apply=True)[0] == 0
    bystander = _bystander()
    with get_conn() as conn:
        conn.execute("INSERT INTO membership (company_id, user_id, role) VALUES (?, (SELECT id FROM app_user WHERE email = 'admin@try-demo.test'), 'viewer')", (bystander["company_id"],))

    code, out = run(corpus, apply=False)

    assert code == 0
    assert "LEFT ALONE (outside the scope): admin@try-demo.test is viewer of company" in out and "Real Co" in out


def test_a_dry_run_changes_nothing_and_says_what_it_would_wipe(corpus):
    assert run(corpus, apply=True)[0] == 0
    before, files = _counts(), _files()

    code, out = run(corpus, apply=False)

    assert code == 0
    assert "DRY RUN: nothing was changed" in out
    assert "wipe company" in out and "Try Demo Pte Ltd" in out and "3 document(s)" in out
    assert "Server check: ok" in out
    assert _counts() == before and _files() == files


def test_it_refuses_when_the_server_is_not_on_the_same_database(corpus):
    assert run(corpus, apply=True)[0] == 0
    before = _counts()

    def elsewhere(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/health":
            return httpx.Response(200, json={"status": "ok"})
        if request.url.path == "/api/auth/dev-login":
            return httpx.Response(200, json={"token": "t"})
        return httpx.Response(200, json=[{"id": 9001, "name": "Try Demo Pte Ltd", "role": "owner", "group_id": None, "group_name": None}])

    lines: list[str] = []
    with httpx.Client(base_url="http://other", transport=httpx.MockTransport(elsewhere)) as other:
        code = reset_demo_data.reset(other, apply=True, files_dir=corpus, out=lines.append)

    text = "\n".join(lines)
    assert code == 1
    assert "not using the same database" in text and "9001" in text
    assert _counts() == before


def test_it_refuses_when_the_server_is_unreachable(corpus):
    before = _counts()

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    lines: list[str] = []
    with httpx.Client(base_url="http://down", transport=httpx.MockTransport(down)) as gone:
        code = reset_demo_data.reset(gone, apply=True, files_dir=corpus, out=lines.append)

    assert code == 1 and "not reachable" in "\n".join(lines)
    assert _counts() == before


def test_it_refuses_before_wiping_when_the_corpus_is_missing(corpus, tmp_path):
    assert run(corpus, apply=True)[0] == 0
    before = _counts()

    code, out = run(tmp_path / "no-such-folder", apply=True)

    assert code == 1 and "no demo corpus PDFs" in out
    assert _counts() == before


def test_a_file_the_server_calls_a_duplicate_is_reported_not_swallowed(corpus):
    # someone else's company already holds byte-identical file: document hashes are unique across the whole database
    client.post("/api/auth/dev-login", json={"email": "holder@real.test", "company_name": "Holder Co", "fye_month": 1, "fye_day": 1})
    token = client.post("/api/auth/dev-login", json={"email": "holder@real.test"}).json()["token"]
    client.post("/api/documents", headers={"Authorization": f"Bearer {token}"}, files={"file": ("01_a.pdf", (corpus / "01_a.pdf").read_bytes(), "application/pdf")})

    code, out = run(corpus, apply=True)

    assert code == 1
    assert "RESET FAILED AFTER THE WIPE" in out and "duplicates" in out and "01_a.pdf" in out


def test_the_wipe_alone_removes_the_scope_and_keeps_the_demo_accounts(corpus):
    assert run(corpus, apply=True)[0] == 0
    with get_conn() as conn:
        plan = reset_demo_data.plan_wipe(conn)
        reset_demo_data.wipe(conn, plan)
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM company").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM company_group").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM app_user").fetchone()[0] == 6, "the six demo accounts are kept"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_seed_still_works_the_old_way_and_reads_the_group_back_through_the_server(corpus):
    result = seed_dev_db.seed(client, files_dir=corpus)

    assert [u[0] for u in result["uploads"]] == ["01_a.pdf", "02_b.pdf", "03_c.pdf"]
    assert seed_dev_db.seed(client, files_dir=corpus)["uploads"] == [], "a second plain seed uploads nothing (it skips what exists)"


def test_seed_fails_loudly_when_the_group_label_is_not_visible_through_the_server(corpus, monkeypatch):
    real_get = client.get

    def hide_groups(url, *a, **k):
        response = real_get(url, *a, **k)
        if url == "/api/auth/companies":
            body = [{**c, "group_name": None} for c in response.json()]
            return httpx.Response(200, json=body)
        return response

    monkeypatch.setattr(client, "get", hide_groups)

    with pytest.raises(seed_dev_db.SeedError, match="different databases"):
        seed_dev_db.seed(client, files_dir=corpus)


def test_a_seed_that_does_not_come_out_clean_is_reported_not_accepted(corpus, monkeypatch):
    real_seed = seed_dev_db.seed

    def seed_then_lose_a_member(*args, **kwargs):
        result = real_seed(*args, **kwargs)
        with get_conn() as conn:
            conn.execute("DELETE FROM membership WHERE user_id = (SELECT id FROM app_user WHERE email = 'viewer@try-demo.test')")
        return result

    monkeypatch.setattr(seed_dev_db, "seed", seed_then_lose_a_member)

    code, out = run(corpus, apply=True)

    assert code == 1
    assert "RESET FAILED AFTER THE WIPE" in out and "NOT the clean seed" in out and "viewer@try-demo.test" in out


def test_verify_clean_seed_names_what_differs(corpus):
    assert run(corpus, apply=True)[0] == 0
    with get_conn() as conn:
        conn.execute("UPDATE membership SET role = 'admin' WHERE user_id = (SELECT id FROM app_user WHERE email = 'user1@try-demo.test')")
        conn.execute("UPDATE document SET filename = 'someone-replaced-it.pdf' WHERE filename = '02_b.pdf'")
    with get_conn() as conn:
        with pytest.raises(reset_demo_data.ResetRefused) as problem:
            reset_demo_data.verify_clean_seed(conn, corpus)

    assert "memberships differ" in str(problem.value) and "documents are" in str(problem.value)


def test_the_schema_check_passes_here_and_explains_an_old_database():
    import sqlite3

    with get_conn() as conn:
        assert reset_demo_data.schema_problem(conn) is None

    old = sqlite3.connect(":memory:")
    old.row_factory = sqlite3.Row
    old.execute("CREATE TABLE expectation (id INTEGER PRIMARY KEY, doc_type TEXT)")
    assert "predates round 16" in reset_demo_data.schema_problem(old)


def test_the_plan_reports_the_schema_check(corpus):
    code, out = run(corpus, apply=False)

    assert code == 0 and "Schema check: ok" in out
