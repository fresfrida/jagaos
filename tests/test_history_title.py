"""The business title next to the person in History (round 7, S3, DECISIONS #136): `membership.title`, nullable, per company.

A title is display text ("Corp Sec", "HR & Finance Manager"). It is not a role: nothing in the app reads it to decide what anyone may do, and
there is no UI to edit it. History returns it as `actor_title`, joined on the actor's user id AND the document's company, and still never returns
the internal user id."""

import json
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import get_conn, init_db
from app.main import app
from app.activity import operator
from app.purge import purge_now

client = TestClient(app)


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team():
    owner = client.post("/api/auth/dev-login", json={"email": "owner@title.test", "name": "Olivia Owner", "company_name": "Title Co", "fye_month": 12, "fye_day": 31}).json()
    company = owner["company"]["id"]
    for email, name, role in (("cs@title.test", "Cora Sec", "user"), ("plain@title.test", "Pat Plain", "user")):
        assert client.post(f"/api/companies/{company}/members", json={"email": email, "name": name, "role": role}, headers=_h(owner["token"])).status_code == 200
    return {"owner": owner["token"], "cs": client.post("/api/auth/dev-login", json={"email": "cs@title.test"}).json()["token"],
            "plain": client.post("/api/auth/dev-login", json={"email": "plain@title.test"}).json()["token"], "company": company}


def _title(company: int, email: str, title: str | None) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE membership SET title = ? WHERE company_id = ? AND user_id = (SELECT id FROM app_user WHERE email = ?)", (title, company, email))


def _upload(token: str, tag: str) -> int:
    resp = client.post("/api/documents", params={"visibility": "only_me", "name": tag}, files={"file": (f"{tag}.txt", tag.encode() * 3, "text/plain")}, headers=_h(token))
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _company_doc(company: int, uploader_email: str, tag: str) -> int:
    """A company document row written the way ingest() does, so History has an Uploaded event, without running the pipeline."""
    from app.graph.ingest import ingest

    path = Path(tempfile.mkdtemp()) / f"{tag}.txt"
    path.write_text(tag * 5)
    with get_conn() as conn:
        uid = conn.execute("SELECT id FROM app_user WHERE email = ?", (uploader_email,)).fetchone()["id"]
    return ingest(company_id=company, source_path=str(path), filename=path.name, source_channel="web", uploaded_by_user_id=uid)["document_id"]


def _history(token: str, doc: int) -> list[dict]:
    resp = client.get(f"/api/documents/{doc}/history", headers=_h(token))
    assert resp.status_code == 200, resp.text
    return resp.json()["entries"]


# ---------------------------------------------------------------- the migration


def test_the_column_is_added_to_an_old_database_and_a_second_start_changes_nothing(tmp_path):
    db = str(tmp_path / "old.db")
    init_db(db)
    con = sqlite3.connect(db)
    con.execute("INSERT INTO company (name, fye_month, fye_day) VALUES ('C', 12, 31)")
    con.execute("INSERT INTO app_user (email, name) VALUES ('a@x.test', 'A')")
    con.execute("INSERT INTO membership (company_id, user_id, role) VALUES (1, 1, 'owner')")
    con.execute("ALTER TABLE membership DROP COLUMN title")               # an OLD-shape database: membership without the column
    con.commit()
    assert "title" not in [r[1] for r in con.execute("PRAGMA table_info(membership)")]
    con.close()

    init_db(db)                                                           # the next start adds it
    init_db(db)                                                           # and a second start is a no-op
    con = sqlite3.connect(db)
    cols = [r[1] for r in con.execute("PRAGMA table_info(membership)")]
    assert cols.count("title") == 1
    assert con.execute("SELECT role, title FROM membership").fetchall() == [("owner", None)]   # existing rows kept, title empty
    con.close()


def test_a_fresh_database_has_the_column_too(tmp_path):
    db = str(tmp_path / "fresh.db")
    init_db(db)
    con = sqlite3.connect(db)
    assert [r for r in con.execute("PRAGMA table_info(membership)") if r[1] == "title"][0][2] == "TEXT"
    assert [r for r in con.execute("PRAGMA table_info(membership)") if r[1] == "title"][0][3] == 0   # nullable
    con.close()


# ---------------------------------------------------------------- History returns it


def test_history_returns_the_title_the_actor_holds_in_that_company(team):
    _title(team["company"], "cs@title.test", "Corp Sec")
    doc = _company_doc(team["company"], "cs@title.test", "titled")
    (entry,) = _history(team["owner"], doc)
    assert entry["action"] == "uploaded" and entry["actor_name"] == "Cora Sec" and entry["actor_title"] == "Corp Sec"


def test_a_person_with_no_title_gets_null_and_a_blank_title_is_null_too(team):
    doc = _company_doc(team["company"], "plain@title.test", "untitled")
    assert _history(team["owner"], doc)[0]["actor_title"] is None
    _title(team["company"], "plain@title.test", "   ")
    assert _history(team["owner"], doc)[0]["actor_title"] is None


def test_an_operator_has_no_user_and_so_no_title(team):
    doc = _company_doc(team["company"], "cs@title.test", "operated")
    _title(team["company"], "cs@title.test", "Corp Sec")
    with get_conn() as conn:
        lifecycle = conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (doc,)).fetchone()["lifecycle_id"]
    purge_now(doc, actor=operator("system: cleanup"))
    with get_conn() as conn:
        rows = conn.execute("SELECT a.action, a.actor_name, m.title FROM document_activity a LEFT JOIN membership m ON m.user_id = a.actor_user_id "
                            "AND m.company_id = a.company_id WHERE a.lifecycle_id = ? ORDER BY a.id", (lifecycle,)).fetchall()
    assert [(r["action"], r["actor_name"], r["title"]) for r in rows] == [("uploaded", "Cora Sec", "Corp Sec"), ("deleted", "system: cleanup", None)]
    from app.activity import history_for
    with get_conn() as conn:
        entries = history_for(conn, lifecycle, team["company"])
    assert [(e["action"], e["actor_title"]) for e in entries] == [("uploaded", "Corp Sec"), ("deleted", None)]


def test_a_persons_title_in_another_company_never_appears(team):
    """One person, two companies, two titles: each company's History shows the title held THERE."""
    second = client.post("/api/auth/dev-login", json={"email": "owner@title.test", "company_name": "Second Co", "fye_month": 6, "fye_day": 30}).json()["company"]["id"]
    assert client.post(f"/api/companies/{second}/members", json={"email": "cs@title.test", "name": "Cora Sec", "role": "user"},
                       headers=_h(client.post("/api/auth/dev-login", json={"email": "owner@title.test"}).json()["token"])).status_code in (200, 403)
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM membership WHERE company_id = ? AND user_id = (SELECT id FROM app_user WHERE email = 'cs@title.test')", (second,)).fetchone():
            conn.execute("INSERT INTO membership (company_id, user_id, role) SELECT ?, id, 'user' FROM app_user WHERE email = 'cs@title.test'", (second,))
    _title(team["company"], "cs@title.test", "Corp Sec")
    _title(second, "cs@title.test", "Finance Lead")
    first_doc, second_doc = _company_doc(team["company"], "cs@title.test", "one"), _company_doc(second, "cs@title.test", "two")
    with get_conn() as conn:
        from app.activity import history_for
        first = history_for(conn, conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (first_doc,)).fetchone()[0], team["company"])
        other = history_for(conn, conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (second_doc,)).fetchone()[0], second)
    assert first[0]["actor_title"] == "Corp Sec" and other[0]["actor_title"] == "Finance Lead"


def test_the_internal_user_id_is_still_never_returned(team):
    _title(team["company"], "cs@title.test", "Corp Sec")
    doc = _company_doc(team["company"], "cs@title.test", "leak")
    body = client.get(f"/api/documents/{doc}/history", headers=_h(team["owner"])).text
    (entry,) = json.loads(body)["entries"]
    assert set(entry) == {"action", "actor_name", "actor_title", "at"}
    assert "user_id" not in body and "actor_user_id" not in body


def test_the_visibility_and_company_scoping_of_history_is_unchanged(team):
    """A personal file's history is still the owner's alone and another company's document is still a 404."""
    personal = _upload(team["cs"], "mine")
    assert client.get(f"/api/documents/{personal}/history", headers=_h(team["cs"])).status_code == 200
    assert client.get(f"/api/documents/{personal}/history", headers=_h(team["plain"])).status_code == 404
    other_owner = client.post("/api/auth/dev-login", json={"email": "other@else.test", "company_name": "Else Co", "fye_month": 12, "fye_day": 31}).json()["token"]
    doc = _company_doc(team["company"], "cs@title.test", "scoped")
    assert client.get(f"/api/documents/{doc}/history", headers=_h(other_owner)).status_code == 404


def test_a_title_changes_no_permission(team):
    """A title is display text: a Corp Sec titled `user` may still not do what only an owner may."""
    _title(team["company"], "cs@title.test", "Corp Sec")
    doc = _company_doc(team["company"], "plain@title.test", "perm")
    assert client.post(f"/api/documents/{doc}/request-purge", headers=_h(team["cs"])).status_code in (403, 404)
