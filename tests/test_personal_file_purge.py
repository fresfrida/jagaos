"""The uploader deletes their own private file FOR GOOD (2026-09-25, round 20, item 6, DECISIONS #99).

Round 19 (#95) let the uploader archive it. That left a soft-deleted row nobody could see or clean up, still counting toward
the 15-file cap, so a delete could not free a slot. Now: POST /api/documents/{id}/purge (auth.may_purge_document) with the
file's exact name typed as confirmation, a rejected private file is purged as well, and archive is for company documents only.

Real logins and real uploads; noise JPEGs take classify's no-text branch, so nothing here calls the gateway.
"""

import io
import logging
import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn
from app.limits import MAX_PERSONAL_FILES
from app.main import app

client = TestClient(app)
_seed = iter(range(1, 100_000))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed) + 800_000)
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@purge.test", "company_name": "Purge Priv Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens, ids = {"owner": owner["token"]}, {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@purge.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"]}


def _upload(team: dict, actor: str, *, private: bool, tag: str = "f", data: bytes | None = None) -> int:
    suffix = "?visibility=only_me" if private else ""
    resp = client.post(
        f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]),
        files={"file": (f"{actor}-{tag}.jpg", data if data is not None else _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm_review(team: dict, actor: str, doc: int) -> None:
    item = next(i for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json() if i["document_id"] == doc)
    resp = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=_headers(team["tokens"][actor]),
    )
    assert resp.status_code == 200, resp.text


def _row(doc: int):
    with get_conn() as conn:
        return conn.execute("SELECT id, filename, status, stored_path FROM document WHERE id = ?", (doc,)).fetchone()


def _name(doc: int) -> str:
    return _row(doc)["filename"]


def _purge(team: dict, actor: str, doc: int, confirm: str | None):
    return client.post(
        f"/api/documents/{doc}/purge", json={"confirm": _name(doc) if confirm is None else confirm},
        headers=_headers(team["tokens"][actor]),
    )


def _used(team: dict, actor: str) -> int:
    return client.get("/api/limits", headers=_headers(team["tokens"][actor])).json()["personal_files_used"]


def _rows_for(table: str, doc: int) -> int:
    with get_conn() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE document_id = ?", (doc,)).fetchone()[0]


# --- the uploader may, for good -------------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["user1", "admin", "owner"])
def test_the_uploader_can_purge_their_own_filed_private_file_whatever_their_role(team, actor):
    doc = _upload(team, actor, private=True)
    _confirm_review(team, actor, doc)
    stored = Path(_row(doc)["stored_path"])
    assert stored.exists() and _used(team, actor) == 1

    response = _purge(team, actor, doc, None)

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "purged", "file_removed": True}
    assert _row(doc) is None
    assert not stored.exists(), "the stored bytes must be gone, not just the row"
    for table in ("extraction", "review_item", "trace", "security_event"):
        assert _rows_for(table, doc) == 0, table
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document_search WHERE rowid = ?", (doc,)).fetchone()[0] == 0
    assert _used(team, actor) == 0, "a delete must free the slot"
    assert client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"][actor])).status_code == 404


def test_a_pending_private_file_can_be_purged_and_its_review_item_goes_with_it(team):
    doc = _upload(team, "user1", private=True)
    assert doc in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json()}

    assert _purge(team, "user1", doc, None).status_code == 200

    assert doc not in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json()}
    assert _rows_for("review_item", doc) == 0


def test_purging_one_private_file_leaves_everything_else_alone(team):
    keep, drop = _upload(team, "user1", private=True, tag="keep"), _upload(team, "user1", private=True, tag="drop")
    company_doc = _upload(team, "user1", private=False, tag="co")
    theirs = _upload(team, "user2", private=True, tag="theirs")

    assert _purge(team, "user1", drop, None).status_code == 200

    assert _row(drop) is None
    for survivor in (keep, company_doc, theirs):
        assert _row(survivor) is not None and Path(_row(survivor)["stored_path"]).exists()


def test_a_deleted_files_bytes_can_be_uploaded_again_it_is_not_a_duplicate_of_a_ghost(team):
    data = _jpeg()
    doc = _upload(team, "user1", private=True, data=data)
    assert _purge(team, "user1", doc, None).status_code == 200

    again = client.post("/api/documents?visibility=only_me", headers=_headers(team["tokens"]["user1"]), files={"file": ("again.jpg", data, "image/jpeg")})

    assert again.status_code == 200 and again.json()["status"] != "duplicate"


def test_deleting_really_frees_a_slot_at_the_cap(team):
    docs = [_upload(team, "user1", private=True, tag=str(i)) for i in range(MAX_PERSONAL_FILES)]
    full = client.post("/api/documents?visibility=only_me", headers=_headers(team["tokens"]["user1"]), files={"file": ("x.jpg", _jpeg(), "image/jpeg")})
    assert full.status_code == 409

    assert _purge(team, "user1", docs[0], None).status_code == 200

    assert _used(team, "user1") == MAX_PERSONAL_FILES - 1
    assert _upload(team, "user1", private=True, tag="new")  # accepted again


def test_a_file_already_missing_from_disk_is_still_purged(team):
    doc = _upload(team, "user1", private=True)
    Path(_row(doc)["stored_path"]).unlink()
    response = _purge(team, "user1", doc, None)
    assert response.status_code == 200 and _row(doc) is None


def test_a_file_that_cannot_be_removed_is_said_so_and_logged_not_hidden(team, monkeypatch, caplog):
    doc = _upload(team, "user1", private=True)
    stored_path = _row(doc)["stored_path"]  # read now: by the time unlink runs the row is gone
    real_unlink = Path.unlink

    def refuse(self, *a, **k):
        if str(self) == stored_path:
            raise PermissionError("nope")
        return real_unlink(self, *a, **k)

    monkeypatch.setattr(Path, "unlink", refuse)
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        response = _purge(team, "user1", doc, None)

    assert response.status_code == 200 and response.json() == {"status": "purged", "file_removed": False}
    assert _row(doc) is None
    assert any("not removed" in r.getMessage() and r.levelno == logging.ERROR for r in caplog.records)


def test_a_purge_leaves_an_audit_line_naming_who_and_what_but_no_content(team, caplog):
    doc = _upload(team, "user1", private=True)
    name = _name(doc)

    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        _purge(team, "user1", doc, None)

    lines = [r.getMessage() for r in caplog.records if "AUDIT purge" in r.getMessage()]
    assert len(lines) == 1
    assert "user1@purge.test" in lines[0] and str(doc) in lines[0] and name in lines[0]


# --- the confirmation ------------------------------------------------------------------------------------


@pytest.mark.parametrize("typed", ["", " ", "wrong.jpg", "USER1-F.JPG", " user1-f.jpg", "user1-f.jpg ", "user1-f"])
def test_anything_but_the_exact_name_deletes_nothing(team, typed):
    doc = _upload(team, "user1", private=True, tag="f")
    assert _name(doc) == "user1-f.jpg"

    response = _purge(team, "user1", doc, typed)

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "confirmation_mismatch"
    assert _row(doc) is not None and Path(_row(doc)["stored_path"]).exists()


def test_a_body_with_no_confirmation_is_refused_and_deletes_nothing(team):
    doc = _upload(team, "user1", private=True)
    response = client.post(f"/api/documents/{doc}/purge", json={}, headers=_headers(team["tokens"]["user1"]))
    assert response.status_code == 422
    assert _row(doc) is not None


# --- nobody else, and no company document -------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["owner", "admin", "user2", "viewer"])
def test_nobody_else_can_purge_someones_private_file_and_it_is_a_404(team, actor):
    doc = _upload(team, "user1", private=True)
    _confirm_review(team, "user1", doc)

    assert _purge(team, actor, doc, _name(doc)).status_code == 404

    assert _row(doc) is not None and Path(_row(doc)["stored_path"]).exists()


@pytest.mark.parametrize("actor", ["user1", "admin", "owner"])
def test_a_company_document_cannot_be_purged_from_the_app_by_anyone_its_uploader_included(team, actor):
    doc = _upload(team, "user1", private=False)
    _confirm_review(team, "owner", doc)

    response = _purge(team, actor, doc, _name(doc))

    assert response.status_code == 403
    assert _row(doc) is not None and _row(doc)["status"] == "filed"


def test_purge_needs_a_session(team):
    doc = _upload(team, "user1", private=True)
    assert client.post(f"/api/documents/{doc}/purge", json={"confirm": _name(doc)}).status_code == 401
    assert _row(doc) is not None


def test_purging_twice_is_a_404_the_second_time(team):
    doc = _upload(team, "user1", private=True)
    name = _name(doc)
    assert _purge(team, "user1", doc, name).status_code == 200
    second = client.post(f"/api/documents/{doc}/purge", json={"confirm": name}, headers=_headers(team["tokens"]["user1"]))
    assert second.status_code == 404


def test_a_private_file_with_no_recorded_uploader_can_be_purged_by_nobody(team):
    doc = _upload(team, "user1", private=True)
    name = _name(doc)
    with get_conn() as conn:
        conn.execute("UPDATE document SET uploaded_by_user_id = NULL WHERE id = ?", (doc,))
    for actor in ("user1", "admin", "owner"):
        assert client.post(f"/api/documents/{doc}/purge", json={"confirm": name}, headers=_headers(team["tokens"][actor])).status_code == 404
    assert _row(doc) is not None


def test_an_old_archived_private_file_can_still_be_purged_by_its_owner_by_id_and_frees_its_slot(team):
    doc = _upload(team, "user1", private=True)
    with get_conn() as conn:
        conn.execute("UPDATE document SET status = 'archived' WHERE id = ?", (doc,))
    assert _used(team, "user1") == 1, "an archived private file counts until it is purged"

    assert _purge(team, "user1", doc, None).status_code == 200

    assert _used(team, "user1") == 0


# --- archive is for company documents only ---------------------------------------------------------------------


def test_a_private_file_can_no_longer_be_archived_not_even_by_its_uploader(team):
    doc = _upload(team, "user1", private=True)

    response = client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"]["user1"]))

    assert response.status_code == 403
    assert "for good" in response.json()["detail"]
    assert _row(doc)["status"] != "archived"


@pytest.mark.parametrize("actor", ["owner", "admin", "user2", "viewer"])
def test_archiving_someone_elses_private_file_is_still_a_404(team, actor):
    doc = _upload(team, "user1", private=True)
    assert client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"][actor])).status_code == 404


def test_an_admin_can_still_archive_a_company_document(team):
    doc = _upload(team, "user1", private=False)
    _confirm_review(team, "owner", doc)
    assert client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"]["admin"])).status_code == 200
    assert _row(doc)["status"] == "archived"


# --- a rejected private file is purged too ------------------------------------------------------------------


def _reject(team: dict, actor: str, doc: int):
    item = next(i for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json() if i["document_id"] == doc)
    return client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "reject", "corrected_fields": {}}, headers=_headers(team["tokens"][actor]),
    )


def test_rejecting_a_private_file_deletes_it_for_good_and_frees_the_slot(team):
    doc = _upload(team, "user1", private=True)
    stored = Path(_row(doc)["stored_path"])

    response = _reject(team, "user1", doc)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "archived"  # the answer is what it always was
    assert _row(doc) is None and not stored.exists()
    assert _used(team, "user1") == 0


def test_rejecting_a_company_document_still_archives_it_and_keeps_the_row(team):
    doc = _upload(team, "user1", private=False)

    response = _reject(team, "owner", doc)

    assert response.status_code == 200 and response.json()["status"] == "archived"
    assert _row(doc) is not None and _row(doc)["status"] == "archived"
