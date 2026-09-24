"""The uploader of a personal file may archive ("Delete") it (2026-09-25, round 19, DECISIONS #95).

A personal file is invisible to admin and owner (auth.may_see_document), and archiving used to be admin+, so its own
author could not remove it and nobody else could either. The rule now (auth.may_archive_document): admin and owner as
always, plus the uploader of their OWN personal file, and nothing else. In particular a `user` still cannot delete a
company document, not even one they uploaded.

Real logins and real uploads; a noise JPEG takes classify's no-text branch, so nothing here calls the gateway.
"""

import io
import random

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn
from app.main import app

client = TestClient(app)
_seed = iter(range(1, 10_000))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed) + 90_000)
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@arch.test", "company_name": "Arch Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@arch.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return {"tokens": tokens}


def _upload(team: dict, actor: str, tag: str, *, private: bool) -> int:
    suffix = "?visibility=only_me" if private else ""
    resp = client.post(
        f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]),
        files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm(team: dict, actor: str, doc: int) -> None:
    item = next(i for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json()
                if i["document_id"] == doc)
    resp = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=_headers(team["tokens"][actor]),
    )
    assert resp.status_code == 200, resp.text


def _archive(team: dict, actor: str, doc: int):
    return client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"][actor]))


def _status(doc: int) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT status FROM document WHERE id = ?", (doc,)).fetchone()["status"]


def _personal_ids(team: dict, actor: str) -> set[int]:
    return {d["id"] for d in client.get("/api/personal-files", headers=_headers(team["tokens"][actor])).json()}


# --- the uploader may -------------------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["user1", "admin", "owner"])
def test_the_uploader_can_archive_their_own_filed_personal_file_whatever_their_role(team, actor):
    doc = _upload(team, actor, "own", private=True)
    _confirm(team, actor, doc)
    assert _status(doc) == "filed"

    resp = _archive(team, actor, doc)

    assert resp.status_code == 200, resp.text
    assert _status(doc) == "archived"
    assert doc not in _personal_ids(team, actor)
    assert client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"][actor])).status_code == 404


def test_a_pending_personal_file_can_be_archived_and_its_review_item_goes_with_it(team):
    doc = _upload(team, "user1", "pend", private=True)
    assert doc in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json()}

    assert _archive(team, "user1", doc).status_code == 200

    assert doc not in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json()}
    with get_conn() as conn:
        assert conn.execute("SELECT status FROM review_item WHERE document_id = ?", (doc,)).fetchone()["status"] == "dismissed"


def test_archiving_the_same_file_twice_is_a_conflict_not_a_second_success(team):
    doc = _upload(team, "user1", "twice", private=True)
    assert _archive(team, "user1", doc).status_code == 200
    assert _archive(team, "user1", doc).status_code == 409


def test_archiving_one_private_file_leaves_the_others_alone(team):
    keep, drop = _upload(team, "user1", "keep", private=True), _upload(team, "user1", "drop", private=True)
    assert _archive(team, "user1", drop).status_code == 200
    assert _personal_ids(team, "user1") == {keep}
    assert _status(keep) == "needs_review"


# --- nobody else may --------------------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["owner", "admin", "user2", "viewer"])
def test_nobody_else_can_archive_someones_personal_file_and_it_is_a_404_not_a_403(team, actor):
    doc = _upload(team, "user1", "theirs", private=True)
    _confirm(team, "user1", doc)

    assert _archive(team, actor, doc).status_code == 404

    assert _status(doc) == "filed"
    assert doc in _personal_ids(team, "user1")


# --- scoped to personal files only ------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["user1", "user2", "viewer"])
def test_below_admin_still_cannot_archive_a_company_document_not_even_their_own(team, actor):
    doc = _upload(team, "user1", "co", private=False)
    _confirm(team, "owner", doc)

    resp = _archive(team, actor, doc)

    assert resp.status_code == 403, resp.text
    assert _status(doc) == "filed"


@pytest.mark.parametrize("actor", ["owner", "admin"])
def test_admin_and_owner_can_still_archive_a_company_document(team, actor):
    doc = _upload(team, "user1", "co2", private=False)
    _confirm(team, "owner", doc)
    assert _archive(team, actor, doc).status_code == 200
    assert _status(doc) == "archived"


def test_a_user_cannot_archive_a_colleagues_pending_company_upload(team):
    doc = _upload(team, "user2", "pendco", private=False)
    assert _archive(team, "user1", doc).status_code in (403, 404)
    assert _status(doc) == "needs_review"


def test_a_personal_file_with_no_recorded_uploader_can_be_archived_by_no_one_below_admin(team):
    doc = _upload(team, "user1", "nobody", private=True)
    with get_conn() as conn:
        conn.execute("UPDATE document SET uploaded_by_user_id = NULL WHERE id = ?", (doc,))
    assert _archive(team, "user1", doc).status_code == 404
    assert _status(doc) == "needs_review"


def test_archiving_needs_a_session(team):
    doc = _upload(team, "user1", "anon", private=True)
    assert client.post(f"/api/documents/{doc}/archive").status_code == 401
    assert _status(doc) == "needs_review"
