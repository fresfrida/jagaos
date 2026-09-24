"""One user, several companies, one active at a time (2026-09-24, round 12,
DECISIONS #77). The schema always allowed several membership rows for one
user (UNIQUE(company_id, user_id) is per pair); what did not exist was any
way to use a second one — every session resolved to the first membership
forever. This covers the switch, and what must NOT change with it: a single-
company user's behavior, and the rule that a company id is only ever a
selection among the caller's OWN memberships.
"""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn
from app.main import app

client = TestClient(app)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color=color).save(buf, format="JPEG")
    return buf.getvalue()


def _new_company(email: str, name: str) -> dict:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": name, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _login(email: str) -> dict:
    resp = client.post("/api/auth/dev-login", json={"email": email})
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
def holding() -> dict:
    """A group of three companies, all owned by one person; the first also
    has a plain `user` and a `viewer` who belong to that company only."""
    first = _new_company("owner@holding.test", "Holding Alpha Pte Ltd")
    ids = {"alpha": first["company"]["id"]}
    ids["beta"] = _new_company("owner@holding.test", "Holding Beta Pte Ltd")["company"]["id"]
    ids["gamma"] = _new_company("owner@holding.test", "Holding Gamma Pte Ltd")["company"]["id"]

    with get_conn() as conn:
        group_id = conn.execute("INSERT INTO company_group (name) VALUES ('Holding Group')").lastrowid
        conn.execute("UPDATE company SET group_id = ? WHERE id IN (?, ?, ?)", (group_id, *ids.values()))

    owner_token = _login("owner@holding.test")["token"]
    for email, role in [("user@holding.test", "user"), ("viewer@holding.test", "viewer")]:
        added = client.post(
            f"/api/companies/{ids['alpha']}/members",
            json={"email": email, "role": role}, headers=_headers(owner_token),
        )
        assert added.status_code == 200, added.text
    return {
        "ids": ids,
        "owner": owner_token,
        "user": _login("user@holding.test")["token"],
        "viewer": _login("viewer@holding.test")["token"],
    }


def _me(token: str) -> dict:
    resp = client.get("/api/auth/me", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _switch(token: str, company_id: int):
    return client.post("/api/auth/switch-company", json={"company_id": company_id}, headers=_headers(token))


def test_a_new_session_still_starts_on_the_first_company(holding):
    assert _me(holding["owner"])["company"]["id"] == holding["ids"]["alpha"]


def test_the_owner_sees_every_company_they_hold_grouped_by_the_group(holding):
    rows = client.get("/api/auth/companies", headers=_headers(holding["owner"])).json()
    assert [r["id"] for r in rows] == list(holding["ids"].values())
    assert {r["group_name"] for r in rows} == {"Holding Group"}
    assert {r["role"] for r in rows} == {"owner"}


@pytest.mark.parametrize("actor", ["user", "viewer"])
def test_a_user_or_viewer_sees_only_their_one_company_and_no_hint_of_a_group(holding, actor):
    # alpha IS in a group — a non-owner must still get no group_id/group_name.
    rows = client.get("/api/auth/companies", headers=_headers(holding[actor])).json()
    assert [r["id"] for r in rows] == [holding["ids"]["alpha"]]
    assert rows[0]["group_id"] is None and rows[0]["group_name"] is None


def test_switching_changes_what_me_reports_and_what_data_endpoints_return(holding):
    ids, owner = holding["ids"], holding["owner"]
    for company, colour in (("alpha", (200, 0, 0)), ("beta", (0, 200, 0))):
        assert _switch(owner, ids[company]).status_code == 200
        up = client.post(
            "/api/documents", headers=_headers(owner),
            files={"file": (f"{company}-swx.jpg", _jpeg(colour), "image/jpeg")},
        )
        assert up.status_code == 200, up.text

    assert _switch(owner, ids["beta"]).json()["company"]["id"] == ids["beta"]
    assert _me(owner)["company"]["id"] == ids["beta"]
    beta_docs = client.get("/api/documents", headers=_headers(owner)).json()
    assert [d["filename"] for d in beta_docs] == ["beta-swx.jpg"]

    assert _switch(owner, ids["alpha"]).status_code == 200
    alpha_docs = client.get("/api/documents", headers=_headers(owner)).json()
    assert [d["filename"] for d in alpha_docs] == ["alpha-swx.jpg"]
    # The review queue and search follow the active company too, not just documents.
    assert {i["document_filename"] for i in client.get("/api/review", headers=_headers(owner)).json()} == {"alpha-swx.jpg"}
    assert [d["filename"] for d in client.get("/api/search?q=swx", headers=_headers(owner)).json()] == ["alpha-swx.jpg"]


def test_a_company_the_caller_does_not_belong_to_is_refused_and_nothing_changes(holding):
    stranger = _new_company("someone@else.test", "Somebody Else Pte Ltd")["company"]["id"]
    before = _me(holding["owner"])["company"]["id"]
    assert _switch(holding["owner"], stranger).status_code == 403
    assert _me(holding["owner"])["company"]["id"] == before


def test_a_nonexistent_company_gets_the_same_refusal_as_someone_elses(holding):
    # The same 403 either way, so the endpoint cannot be used to probe which ids exist.
    real_but_not_theirs = _new_company("another@else.test", "Another Pte Ltd")["company"]["id"]
    a = _switch(holding["owner"], real_but_not_theirs)
    b = _switch(holding["owner"], 999999)
    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (403, {"detail": "Not a member of that company"})


@pytest.mark.parametrize("actor", ["user", "viewer"])
def test_a_single_company_user_cannot_switch_into_a_sibling_company(holding, actor):
    # Same group as alpha, but the group grants nothing: no membership row, no access.
    assert _switch(holding[actor], holding["ids"]["beta"]).status_code == 403
    assert _me(holding[actor])["company"]["id"] == holding["ids"]["alpha"]


def test_the_role_comes_from_the_membership_in_the_active_company(holding):
    owner = holding["owner"]
    with get_conn() as conn:
        uid = conn.execute("SELECT id FROM app_user WHERE email = 'owner@holding.test'").fetchone()["id"]
        conn.execute("UPDATE membership SET role = 'viewer' WHERE user_id = ? AND company_id = ?",
                     (uid, holding["ids"]["gamma"]))
    assert _me(owner)["role"] == "owner"
    switched = _switch(owner, holding["ids"]["gamma"]).json()
    assert switched["role"] == "viewer" and _me(owner)["role"] == "viewer"
    # ...and the permissions follow it: a viewer of gamma cannot upload there.
    denied = client.post("/api/documents", headers=_headers(owner),
                         files={"file": ("nope.jpg", _jpeg((1, 2, 3)), "image/jpeg")})
    assert denied.status_code == 403


def test_only_the_active_company_is_addressable_even_for_an_owner_of_another(holding):
    ids, owner = holding["ids"], holding["owner"]
    assert _switch(owner, ids["beta"]).status_code == 200
    assert client.get(f"/api/companies/{ids['alpha']}/members", headers=_headers(owner)).status_code == 403
    assert client.patch(f"/api/companies/{ids['alpha']}", json={"name": "Hijack"}, headers=_headers(owner)).status_code == 403
    assert client.get(f"/api/companies/{ids['beta']}/members", headers=_headers(owner)).status_code == 200


def test_two_sessions_of_one_user_are_scoped_independently(holding):
    second = _login("owner@holding.test")["token"]
    assert _switch(holding["owner"], holding["ids"]["gamma"]).status_code == 200
    assert _me(holding["owner"])["company"]["id"] == holding["ids"]["gamma"]
    assert _me(second)["company"]["id"] == holding["ids"]["alpha"]


def test_losing_the_membership_drops_the_session_back_instead_of_keeping_access(holding):
    ids, owner = holding["ids"], holding["owner"]
    assert _switch(owner, ids["beta"]).status_code == 200
    with get_conn() as conn:
        uid = conn.execute("SELECT id FROM app_user WHERE email = 'owner@holding.test'").fetchone()["id"]
        conn.execute("DELETE FROM membership WHERE user_id = ? AND company_id = ?", (uid, ids["beta"]))
    # The stored preference now points at a company they no longer belong to.
    assert _me(owner)["company"]["id"] == ids["alpha"]


def test_the_review_visibility_rule_follows_the_role_held_in_the_active_company(holding):
    # owner in alpha sees everything; after switching to a company where they
    # are only a `user`, the same person sees just their own uploads.
    ids, owner = holding["ids"], holding["owner"]
    with get_conn() as conn:
        uid = conn.execute("SELECT id FROM app_user WHERE email = 'owner@holding.test'").fetchone()["id"]
        conn.execute("UPDATE membership SET role = 'user' WHERE user_id = ? AND company_id = ?", (uid, ids["beta"]))
    assert _switch(owner, ids["beta"]).status_code == 200
    assert _me(owner)["role"] == "user"
    mine = client.post("/api/documents", headers=_headers(owner),
                       files={"file": ("mine.jpg", _jpeg((9, 9, 9)), "image/jpeg")}).json()["document_id"]
    queue = {i["document_id"] for i in client.get("/api/review", headers=_headers(owner)).json()}
    assert queue == {mine}


def test_signing_up_a_second_company_gives_a_session_scoped_to_that_new_company(holding):
    # dev-login's response names the company it just created; the session it
    # issues must run as that company, not silently as the user's first one.
    created = _new_company("owner@holding.test", "Holding Delta Pte Ltd")
    assert _me(created["token"])["company"]["id"] == created["company"]["id"]
    assert created["company"]["id"] not in (holding["ids"]["alpha"],)
    # ...while a plain login (no company_name) is unchanged: the first membership.
    assert _me(_login("owner@holding.test")["token"])["company"]["id"] == holding["ids"]["alpha"]
