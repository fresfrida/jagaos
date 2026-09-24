"""The "Only me" section's backend (2026-09-25, round 19, DECISIONS #94).

A personal file (`visibility != 'company'`) is its uploader's alone (auth.may_see_document,
unchanged since round 13) and, since this round, it is ALSO out of the company's own views:
GET /api/documents and GET /api/search never list it, for anyone, its uploader included, and
the uploader's own list of them is GET /api/personal-files. These tests pin both halves, and
that nobody else can reach the list's contents. Real logins and real uploads; a blank JPEG has
no OCR text, so classify takes its deterministic no-text branch and nothing calls the gateway.
"""

import io
import random

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn
from app.main import app

client = TestClient(app)
_counter = iter(range(50_000, 60_000))
ROLES = ["owner", "admin", "user1", "user2", "viewer"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_counter))
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post("/api/auth/dev-login", json={"email": "owner@personal.test", "company_name": "Personal Co", "fye_month": 12, "fye_day": 31}).json()
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@personal.test"
        assert client.post(f"/api/companies/{owner['company']['id']}/members", json={"email": email, "role": role}, headers=_headers(owner["token"])).status_code == 200
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return {"tokens": tokens, "company": owner["company"]["id"]}


def _upload(team: dict, actor: str, tag: str, visibility: str | None = None) -> int:
    suffix = f"?visibility={visibility}" if visibility else ""
    resp = client.post(f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]), files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")})
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _ids(team: dict, actor: str, path: str) -> set[int]:
    resp = client.get(path, headers=_headers(team["tokens"][actor]))
    assert resp.status_code == 200, resp.text
    return {d["id"] for d in resp.json()}


def test_a_user_with_no_private_files_gets_an_empty_list(team):
    _upload(team, "user1", "company-doc")

    assert client.get("/api/personal-files", headers=_headers(team["tokens"]["user1"])).json() == []


def test_the_list_holds_the_callers_own_private_uploads_and_no_company_document(team):
    mine = _upload(team, "user1", "mine", visibility="only_me")
    company = _upload(team, "user1", "shared")

    assert _ids(team, "user1", "/api/personal-files") == {mine}
    assert company not in _ids(team, "user1", "/api/personal-files")


@pytest.mark.parametrize("actor", ["owner", "admin", "user2", "viewer"])
def test_no_other_role_or_member_sees_someone_elses_private_files(team, actor):
    mine = _upload(team, "user1", "secret", visibility="only_me")

    assert mine not in _ids(team, actor, "/api/personal-files")
    assert mine not in _ids(team, actor, "/api/documents")
    assert mine not in _ids(team, actor, "/api/search?q=secret")
    assert client.get(f"/api/documents/{mine}/file", headers=_headers(team["tokens"][actor])).status_code == 404


@pytest.mark.parametrize("actor", ["owner", "admin", "user1"])
def test_each_role_sees_only_its_own_private_files_in_its_own_list(team, actor):
    ids = {who: _upload(team, who, f"own-{who}", visibility="only_me") for who in ("owner", "admin", "user1", "user2")}

    assert _ids(team, actor, "/api/personal-files") == {ids[actor]}


def test_a_private_file_is_not_in_the_company_list_or_search_even_for_its_uploader(team):
    """The move (DECISIONS #94): until the lock toggle was removed the uploader saw it inline."""
    mine = _upload(team, "user1", "onlymine", visibility="only_me")

    assert mine not in _ids(team, "user1", "/api/documents")
    assert mine not in _ids(team, "user1", "/api/search?q=onlymine")
    assert client.get(f"/api/documents/{mine}/file", headers=_headers(team["tokens"]["user1"])).status_code == 200, "still reachable by id, under the unchanged rule"


def test_a_company_document_is_still_listed_and_searchable_and_not_in_the_personal_list(team):
    shared = _upload(team, "user1", "sharedtag")
    with get_conn() as conn:  # filed, so every role may see it
        conn.execute("UPDATE document SET status = 'filed' WHERE id = ?", (shared,))

    for actor in ROLES:
        assert shared in _ids(team, actor, "/api/documents"), actor
        assert shared in _ids(team, actor, "/api/search?q=sharedtag"), actor
    assert shared not in _ids(team, "user1", "/api/personal-files")


def test_a_private_file_pending_review_is_listed_and_still_reaches_only_its_uploaders_queue(team):
    mine = _upload(team, "user1", "pendingprivate", visibility="only_me")

    assert mine in _ids(team, "user1", "/api/personal-files")
    queue = {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json()}
    assert mine in queue
    for actor in ("owner", "admin", "user2"):
        assert mine not in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json()}


def test_an_archived_private_file_is_not_listed(team):
    mine = _upload(team, "user1", "gone", visibility="only_me")
    with get_conn() as conn:
        conn.execute("UPDATE document SET status = 'archived' WHERE id = ?", (mine,))

    assert mine not in _ids(team, "user1", "/api/personal-files")


def test_an_unrecognised_visibility_value_fails_closed_as_personal_in_both_lists(team):
    mine = _upload(team, "user1", "weird")
    with get_conn() as conn:
        conn.execute("UPDATE document SET visibility = 'everyone-but-nobody' WHERE id = ?", (mine,))

    assert mine in _ids(team, "user1", "/api/personal-files")
    assert mine not in _ids(team, "user1", "/api/documents")
    assert mine not in _ids(team, "owner", "/api/personal-files")


def test_the_rows_have_the_shape_the_company_list_has_so_one_component_renders_both(team):
    mine = _upload(team, "user1", "shape", visibility="only_me")
    company = _upload(team, "user1", "shapeco")
    with get_conn() as conn:
        conn.execute("UPDATE document SET status = 'filed' WHERE id = ?", (company,))

    personal_row = next(d for d in client.get("/api/personal-files", headers=_headers(team["tokens"]["user1"])).json() if d["id"] == mine)
    company_row = next(d for d in client.get("/api/documents", headers=_headers(team["tokens"]["user1"])).json() if d["id"] == company)

    assert set(personal_row) == set(company_row)
    assert personal_row["visibility"] == "only_me" and personal_row["can_edit"] is True
    assert "uploaded_by_user_id" not in personal_row, "the uploader's id is not sent to the client"


def test_a_members_private_files_in_one_company_are_not_listed_when_they_act_in_another(team):
    mine = _upload(team, "user1", "elsewhere", visibility="only_me")
    other = client.post("/api/auth/dev-login", json={"email": "user1@personal.test", "company_name": "Second Co", "fye_month": 6, "fye_day": 30}).json()

    listed = client.get("/api/personal-files", headers=_headers(other["token"])).json()

    assert mine not in {d["id"] for d in listed}


def test_it_needs_a_session(team):
    assert client.get("/api/personal-files").status_code == 401


def test_the_calendar_reads_the_company_list_so_a_private_file_is_not_on_it_either(team):
    mine = _upload(team, "user1", "calendarcheck", visibility="only_me")

    assert mine not in _ids(team, "user1", "/api/documents")  # the list CalendarHub and DatesView read
