"""The durable human history of a document (round 6, DECISIONS #129; app/activity.py).

Five actions are recorded (Uploaded, Edited, Purge requested, Purge cancelled, Deleted), each with an actor NAME SNAPSHOT and a UTC
timestamp, in `document_activity`, which is keyed by an immutable `lifecycle_id` (not the reusable `document.id`) and has no foreign
key to anything so that a hard purge cannot erase it. Real logins and real uploads through the API; noise JPEGs take classify's
no-text branch, so nothing here calls the gateway (the one test that needs classify to WRITE fields replaces the model call).
"""

import io
import json
import random
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))  # the purge CLI lives beside the other operator scripts

import app.activity as activity
import app.graph.classify as classify_module
import app.graph.extract as extract_module
from app.activity import operator
from app.db import get_conn, init_db
from app.llm import LLMResult
from app.main import app
from app.purge import check_references, purge_documents, purge_now, references_to
import purge_document  # noqa: E402

client = TestClient(app)
_seed = iter(range(1, 100_000))
UTC_FORMAT = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed) + 700_000)
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@act.test", "name": "Frida Owner", "company_name": "Activity Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens, ids = {"owner": owner["token"]}, {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@act.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members", json={"email": email, "role": role}, headers=_h(owner["token"]),
        ).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    with get_conn() as conn:  # named people, except user2, who has only an email
        conn.execute("UPDATE app_user SET name = 'Wei Admin' WHERE id = ?", (ids["admin"],))
        conn.execute("UPDATE app_user SET name = 'Uma User' WHERE id = ?", (ids["user1"],))
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"]}


def _upload(team, actor, *, private=False, tag="f") -> int:
    resp = client.post(
        "/api/documents" + ("?visibility=only_me" if private else ""), headers=_h(team["tokens"][actor]),
        files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm(team, doc) -> None:
    owner = _h(team["tokens"]["owner"])
    item = next(i for i in client.get("/api/review", headers=owner).json() if i["document_id"] == doc)
    assert client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
                       json={"action": "confirm", "corrected_fields": {}}, headers=owner).status_code == 200


def _filed(team, tag="f", actor="user1") -> int:
    doc = _upload(team, actor, tag=tag)
    _confirm(team, doc)
    return doc


def _lifecycle(doc) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (doc,)).fetchone()["lifecycle_id"]


def _events(lifecycle: str) -> list[tuple]:
    with get_conn() as conn:
        return [tuple(r) for r in conn.execute(
            "SELECT action, actor_name, actor_user_id FROM document_activity WHERE lifecycle_id = ? ORDER BY id", (lifecycle,))]


def _history(team, actor, doc):
    return client.get(f"/api/documents/{doc}/history", headers=_h(team["tokens"][actor]))


def _ask(team, doc):
    return client.post(f"/api/documents/{doc}/request-purge", headers=_h(team["tokens"]["owner"]))


# --- the five actions, with names and times ------------------------------------------------------------------------------------


def test_upload_records_uploaded_by_the_uploader_with_their_name_and_a_utc_timestamp(team):
    doc = _upload(team, "user1")
    entries = _history(team, "owner", doc).json()["entries"]
    assert [(e["action"], e["actor_name"]) for e in entries] == [("uploaded", "Uma User")]
    assert UTC_FORMAT.match(entries[0]["at"])
    when = datetime.strptime(entries[0]["at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    assert abs(datetime.now(timezone.utc) - when) < timedelta(seconds=30)  # UTC, not local time
    assert set(entries[0]) == {"action", "actor_name", "actor_title", "at"}  # the internal user id is not exposed


def test_a_person_with_no_name_is_recorded_by_their_email_not_left_blank(team):
    doc = _upload(team, "user2")
    assert _history(team, "owner", doc).json()["entries"][0]["actor_name"] == "user2@act.test"


def test_the_actor_is_a_snapshot_a_later_rename_does_not_rewrite_history(team):
    doc = _upload(team, "user1")
    with get_conn() as conn:
        conn.execute("UPDATE app_user SET name = 'Renamed Person' WHERE id = ?", (team["ids"]["user1"],))
    client.patch(f"/api/documents/{doc}", json={"description": "now edited"}, headers=_h(team["tokens"]["user1"]))
    names = [e["actor_name"] for e in _history(team, "owner", doc).json()["entries"]]
    assert names == ["Uma User", "Renamed Person"]  # the upload keeps the name it had; the edit carries the new one


def test_a_real_edit_records_edited_by_the_editor(team):
    doc = _filed(team)
    resp = client.patch(f"/api/documents/{doc}", json={"description": "Corrected caption", "vendor_name": "Acme"}, headers=_h(team["tokens"]["admin"]))
    assert resp.status_code == 200
    entries = _history(team, "owner", doc).json()["entries"]
    assert [(e["action"], e["actor_name"]) for e in entries] == [("uploaded", "Uma User"), ("edited", "Wei Admin")]


def test_an_edit_that_changes_nothing_creates_no_history(team):
    doc = _filed(team)
    headers = _h(team["tokens"]["admin"])
    client.patch(f"/api/documents/{doc}", json={"vendor_name": "Acme", "description": "Caption"}, headers=headers)
    before = _events(_lifecycle(doc))
    for body in ({}, {"vendor_name": "Acme"}, {"vendor_name": "Acme", "description": "Caption"}):  # the same values, again
        assert client.patch(f"/api/documents/{doc}", json=body, headers=headers).status_code == 200
    assert _events(_lifecycle(doc)) == before


def test_a_purge_request_records_the_request_and_never_an_accidental_deleted(team):
    doc = _filed(team)
    assert _ask(team, doc).status_code == 200
    kinds = [e[0] for e in _events(_lifecycle(doc))]
    assert kinds == ["uploaded", "purge_requested"]  # the internal archive transition is a rule, not a Delete
    assert _events(_lifecycle(doc))[-1][1] == "Frida Owner"


def test_cancelling_the_request_records_purge_cancelled_after_the_restore(team):
    doc = _filed(team)
    _ask(team, doc)
    assert client.post(f"/api/documents/{doc}/cancel-purge-request", headers=_h(team["tokens"]["owner"])).status_code == 200
    assert [e[0] for e in _events(_lifecycle(doc))] == ["uploaded", "purge_requested", "purge_cancelled"]


def test_a_refused_cancel_records_nothing(team):
    doc = _filed(team)
    before = _events(_lifecycle(doc))
    assert client.post(f"/api/documents/{doc}/cancel-purge-request", headers=_h(team["tokens"]["owner"])).status_code == 409  # nothing to cancel
    assert client.post(f"/api/documents/{doc}/cancel-purge-request", headers=_h(team["tokens"]["user1"])).status_code in (403, 404)
    assert _events(_lifecycle(doc)) == before


def test_an_ordinary_company_files_delete_reads_as_deleted(team):
    doc = _filed(team)
    life = _lifecycle(doc)
    assert client.post(f"/api/documents/{doc}/archive", headers=_h(team["tokens"]["admin"])).status_code == 200
    assert _events(life)[-1][:2] == ("deleted", "Wei Admin")


def test_rejecting_an_upload_in_review_is_recorded_as_deleted(team):
    doc = _upload(team, "user1")
    owner = _h(team["tokens"]["owner"])
    item = next(i for i in client.get("/api/review", headers=owner).json() if i["document_id"] == doc)
    life = _lifecycle(doc)
    assert client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
                       json={"action": "reject", "corrected_fields": {}}, headers=owner).status_code == 200
    assert [e[:2] for e in _events(life)] == [("uploaded", "Uma User"), ("deleted", "Frida Owner")]


def test_the_model_writing_fields_is_never_recorded_as_a_human_edit_but_a_review_time_correction_is(team, monkeypatch):
    def tool(name, args):
        return LLMResult(content="", model="m", input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
                         tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}])
    monkeypatch.setattr(classify_module, "call", lambda m, s, u, **k: tool("classify_document", {
        "lane": "invoice", "doc_type": "invoice", "confidence": 0.95, "injection_suspected": False, "bucket": "Expenses",
        "vendor_name": "Model Vendor", "description": "Model wrote this", "description_en": "Model wrote this"}))
    prov = lambda v: {"value": v, "confidence": 0.9, "page": 1}  # noqa: E731
    monkeypatch.setattr(extract_module, "call", lambda m, s, u, **k: tool("extract_invoice_fields", {
        "vendor": prov("Model Vendor"), "invoice_no": prov("1"), "issued_on": prov("2026-01-01"), "subtotal": prov(10.0),
        "tax": prov(0.9), "currency": prov("SGD"), "total": prov(10.9)}))
    # a photo with OCR-less pixels has no text, so give the pipeline text by patching ingest's reader
    import app.graph.ingest as ingest_module
    monkeypatch.setattr(ingest_module, "_local_text", lambda path, media_type, ocr_max_edge=None: ("Invoice 1 total 10.90 Model Vendor", "ocr"))
    doc = _upload(team, "user1", tag="model")
    life = _lifecycle(doc)
    with get_conn() as conn:  # classify really did write the description and vendor: it just isn't a human edit
        assert conn.execute("SELECT vendor_name FROM document WHERE id = ?", (doc,)).fetchone()["vendor_name"] == "Model Vendor"
    assert [e[0] for e in _events(life)] == ["uploaded"]
    # what the review card does: PATCH the document-level fields it changed, THEN resolve
    assert client.patch(f"/api/documents/{doc}", json={"vendor_name": "Corrected Vendor"}, headers=_h(team["tokens"]["owner"])).status_code == 200
    _confirm(team, doc)
    assert [e[:2] for e in _events(life)] == [("uploaded", "Uma User"), ("edited", "Frida Owner")]


# --- hard deletion: the history survives it --------------------------------------------------------------------------------------


def test_a_private_files_hard_delete_records_deleted_and_the_history_outlives_the_row(team):
    doc = _upload(team, "user1", private=True, tag="mine")
    life = _lifecycle(doc)
    name = client.get("/api/personal-files", headers=_h(team["tokens"]["user1"])).json()[0]["filename"]
    resp = client.post(f"/api/documents/{doc}/purge", json={"confirm": name}, headers=_h(team["tokens"]["user1"]))
    assert resp.status_code == 200, resp.text
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc,)).fetchone()[0] == 0  # the row really is gone
    assert [e[:2] for e in _events(life)] == [("uploaded", "Uma User"), ("deleted", "Uma User")]


def test_the_operators_final_purge_records_the_operator_truthfully_not_a_made_up_person(team):
    doc = _filed(team)
    _ask(team, doc)
    life = _lifecycle(doc)
    assert purge_documents([doc], apply=True, actor=operator("alice (operator)"), out=lambda _l: None) == 0
    assert _events(life) == [("uploaded", "Uma User", team["ids"]["user1"]), ("purge_requested", "Frida Owner", team["ids"]["owner"]),
                             ("deleted", "alice (operator)", None)]  # no user id: this was not a signed-in user


def test_the_purge_cli_refuses_to_apply_without_saying_who_is_deleting(team, capsys):
    doc = _filed(team)
    _ask(team, doc)
    lines: list[str] = []
    assert purge_documents([doc], apply=True, out=lines.append) == 2
    assert any("--actor" in line for line in lines)
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc,)).fetchone()[0] == 1  # nothing was deleted
    assert purge_document.main([str(doc), "--apply"]) == 2
    assert purge_document.main([str(doc), "--apply", "--actor", "  "]) == 2  # a blank name is not a name


def test_a_reused_document_id_never_inherits_the_old_history(team):
    doc = _upload(team, "user1", tag="first")
    old_life = _lifecycle(doc)
    purge_now(doc, actor=operator("op"))
    new_doc = _upload(team, "user2", tag="second")
    assert new_doc == doc, "SQLite hands the deleted highest id out again: this is exactly the collision the lifecycle id prevents"
    new_life = _lifecycle(new_doc)
    assert new_life != old_life
    assert [e[:2] for e in _events(new_life)] == [("uploaded", "user2@act.test")]
    assert [e[:2] for e in _events(old_life)] == [("uploaded", "Uma User"), ("deleted", "op")]
    assert [e["action"] for e in _history(team, "owner", new_doc).json()["entries"]] == ["uploaded"]


def test_the_history_table_has_no_foreign_key_and_is_not_a_reference_a_purge_must_satisfy():
    with get_conn() as conn:
        assert conn.execute("PRAGMA foreign_key_list('document_activity')").fetchall() == []
        assert all(table != "document_activity" for table, _column in references_to(conn, "document"))
        check_references(conn)  # the purge safety check still passes with the new table in the schema


# --- the identifier and the backfill ------------------------------------------------------------------------------------------------


def test_every_new_document_gets_a_lifecycle_id_even_from_a_raw_insert_and_it_cannot_be_changed(team):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, status) "
            "VALUES (?, 'rawsha1', 'raw.pdf', 'application/pdf', 1, '/tmp/x', 'web', 'filed')", (team["company_id"],))
        first = conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (cur.lastrowid,)).fetchone()[0]
        cur2 = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, status) "
            "VALUES (?, 'rawsha2', 'raw2.pdf', 'application/pdf', 1, '/tmp/x', 'web', 'filed')", (team["company_id"],))
        second = conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (cur2.lastrowid,)).fetchone()[0]
    assert first and second and first != second and len(first) == 32
    with pytest.raises(sqlite3.DatabaseError, match="immutable"):
        with get_conn() as conn:
            conn.execute("UPDATE document SET lifecycle_id = 'somethingelse' WHERE id = ?", (cur.lastrowid,))
    with pytest.raises(sqlite3.DatabaseError, match="immutable"):
        with get_conn() as conn:
            conn.execute("UPDATE document SET lifecycle_id = NULL WHERE id = ?", (cur.lastrowid,))


def test_backfill_gives_each_existing_document_one_uploaded_event_and_is_idempotent(team):
    from app.db import DB_PATH
    with get_conn() as conn:
        for i, uploader in enumerate([team["ids"]["user1"], team["ids"]["user2"], None]):
            conn.execute(
                "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, status, "
                "uploaded_by_user_id, received_at) VALUES (?, ?, ?, 'application/pdf', 1, '/tmp/x', 'web', 'filed', ?, ?)",
                (team["company_id"], f"bf{i}", f"old{i}.pdf", uploader, f"2026-03-0{i + 1} 08:15:00"))
        # simulate a database from before this feature: no lifecycle ids, no history
        conn.execute("DROP TRIGGER document_lifecycle_id_immutable")
        conn.execute("UPDATE document SET lifecycle_id = NULL")
        conn.execute("DELETE FROM document_activity")
    init_db(DB_PATH)
    init_db(DB_PATH)  # run twice: the second run must add nothing
    with get_conn() as conn:
        rows = [tuple(r) for r in conn.execute(
            "SELECT d.filename, a.action, a.actor_name, a.at FROM document d JOIN document_activity a ON a.lifecycle_id = d.lifecycle_id "
            "ORDER BY d.filename")]
        assert conn.execute("SELECT COUNT(*) FROM document WHERE lifecycle_id IS NULL").fetchone()[0] == 0
    assert rows == [("old0.pdf", "uploaded", "Uma User", "2026-03-01 08:15:00"),
                    ("old1.pdf", "uploaded", "user2@act.test", "2026-03-02 08:15:00"),
                    ("old2.pdf", "uploaded", None, "2026-03-03 08:15:00")]  # an upload with no user is honestly nameless


def test_an_unknown_action_is_refused_by_the_code_and_by_the_database(team):
    with get_conn() as conn:
        with pytest.raises(ValueError):
            activity.record(conn, lifecycle_id="x", company_id=1, action="renamed", actor=operator("op"))
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO document_activity (lifecycle_id, company_id, action) VALUES ('x', 1, 'renamed')")


# --- who may read a history ---------------------------------------------------------------------------------------------------------


def test_another_companys_owner_gets_the_same_404_as_for_a_missing_document(team):
    doc = _filed(team)
    other = client.post("/api/auth/dev-login", json={"email": "owner@elsewhere.test", "company_name": "Elsewhere Co", "fye_month": 6, "fye_day": 30}).json()
    assert client.get(f"/api/documents/{doc}/history", headers=_h(other["token"])).status_code == 404
    assert client.get("/api/documents/99999/history", headers=_h(other["token"])).status_code == 404
    assert client.get(f"/api/documents/{doc}/history").status_code == 401


def test_a_colleagues_pending_upload_is_hidden_from_a_user_who_may_not_see_it(team):
    doc = _upload(team, "user1")  # waiting for review
    assert _history(team, "user1", doc).status_code == 200  # theirs
    assert _history(team, "owner", doc).status_code == 200  # admin and owner see pending uploads
    assert _history(team, "user2", doc).status_code == 404  # another user does not, exactly as for the card and the file
    assert _history(team, "viewer", doc).status_code == 404


def test_a_personal_file_history_is_its_uploaders_alone_not_even_the_owners(team):
    doc = _upload(team, "user1", private=True, tag="p")
    assert _history(team, "user1", doc).status_code == 200
    for other in ("owner", "admin", "user2", "viewer"):
        assert _history(team, other, doc).status_code == 404, other


def test_the_owner_can_still_open_history_on_a_purge_pending_card_and_nobody_else_can(team):
    doc = _filed(team)
    _ask(team, doc)
    entries = _history(team, "owner", doc).json()["entries"]
    assert [e["action"] for e in entries] == ["uploaded", "purge_requested"]
    for other in ("admin", "user1", "viewer"):
        assert _history(team, other, doc).status_code == 404, other  # to everyone but the owner it is deleted


def test_one_companys_events_are_never_returned_through_another_companys_lifecycle_id(team):
    doc = _filed(team)
    life = _lifecycle(doc)
    with get_conn() as conn:
        conn.execute("INSERT INTO document_activity (lifecycle_id, company_id, action, actor_name) VALUES (?, 999999, 'edited', 'Intruder')", (life,))
    names = [e["actor_name"] for e in _history(team, "owner", doc).json()["entries"]]
    assert "Intruder" not in names


# --- the list summary ------------------------------------------------------------------------------------------------------------------


def test_lists_and_search_carry_an_activity_count_and_it_is_one_grouped_query_not_n(team, monkeypatch):
    a, b = _filed(team, tag="a"), _filed(team, tag="b")
    client.patch(f"/api/documents/{a}", json={"vendor_name": "Acme"}, headers=_h(team["tokens"]["admin"]))
    calls = []
    real = activity.summaries_for
    monkeypatch.setattr(activity, "summaries_for", lambda conn, ids: calls.append(list(ids)) or real(conn, ids))
    rows = {d["id"]: d for d in client.get("/api/documents", headers=_h(team["tokens"]["owner"])).json()}
    assert len(calls) == 1 and set(calls[0]) >= {a, b}  # ONE call for the whole page
    assert rows[a]["activity_summary"] == {"count": 2} and rows[b]["activity_summary"] == {"count": 1}
    assert "trace_summary" not in rows[a]  # replaced, not kept beside it
    personal = _upload(team, "user1", private=True, tag="s")
    assert client.get("/api/personal-files", headers=_h(team["tokens"]["user1"])).json()[0]["activity_summary"] == {"count": 1}
    assert personal


def test_a_document_with_no_recorded_activity_has_no_summary_not_a_zero(team):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, status) "
            "VALUES (?, 'noact', 'x.pdf', 'application/pdf', 1, '/tmp/x', 'web', 'filed')", (team["company_id"],))
    row = next(d for d in client.get("/api/documents", headers=_h(team["tokens"]["owner"])).json() if d["filename"] == "x.pdf")
    assert row["activity_summary"] is None
