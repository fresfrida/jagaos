"""Who may edit or delete a document, enforced server-side (2026-09-24,
round 11). Real logins for each role and real uploads through
POST /api/documents — a blank JPEG has no OCR text, so classify takes its
deterministic no-text branch and nothing here calls the gateway.

The case that had never been exercised: two accounts of the SAME role
(`user`). Until user1/user2 existed there was only ever one `user`, so "a
user cannot edit someone else's file" had only been tried against a higher
role, never against a peer.
"""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn
from app.main import app

client = TestClient(app)

COLORS = {"owner": (200, 10, 10), "admin": (10, 200, 10), "user1": (10, 10, 200), "user2": (200, 200, 10)}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color=color).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def company() -> dict:
    """One company with an owner, an admin, two users and a viewer — every
    account logged in — plus one uploaded document per uploader role."""
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@perm.test", "company_name": "Perm Co", "fye_month": 12, "fye_day": 31},
    ).json()
    company_id = owner["company"]["id"]
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@perm.test"
        added = client.post(
            f"/api/companies/{company_id}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        )
        assert added.status_code == 200, added.text
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]

    documents = {}
    for name in ("owner", "admin", "user1", "user2"):
        resp = client.post(
            "/api/documents",
            headers=_headers(tokens[name]),
            files={"file": (f"{name}-pmx.jpg", _jpeg(COLORS[name]), "image/jpeg")},
        )
        assert resp.status_code == 200, resp.text
        documents[name] = resp.json()["document_id"]
    return {"tokens": tokens, "documents": documents}


def _edit(company: dict, actor: str, target: str, **body) -> int:
    resp = client.patch(
        f"/api/documents/{company['documents'][target]}",
        json=body or {"vendor_name": f"edited by {actor}"},
        headers=_headers(company["tokens"][actor]),
    )
    return resp.status_code


def _vendor(company: dict, doc_owner: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT vendor_name FROM document WHERE id = ?", (company["documents"][doc_owner],)
        ).fetchone()
    return row["vendor_name"]


@pytest.mark.parametrize("actor,target", [("user1", "user2"), ("user2", "user1")])
def test_a_user_cannot_edit_a_peer_users_document(company, actor, target):
    assert _edit(company, actor, target) == 403
    assert _vendor(company, target) is None, "a refused edit must not have changed anything"


@pytest.mark.parametrize("actor", ["user1", "user2"])
def test_a_user_can_edit_their_own_document(company, actor):
    assert _edit(company, actor, actor) == 200
    assert _vendor(company, actor) == f"edited by {actor}"


@pytest.mark.parametrize("target", ["admin", "owner"])
def test_a_user_cannot_edit_an_admins_or_owners_document(company, target):
    assert _edit(company, "user1", target) == 403
    assert _vendor(company, target) is None


@pytest.mark.parametrize("actor", ["admin", "owner"])
@pytest.mark.parametrize("target", ["owner", "admin", "user1", "user2"])
def test_admin_and_owner_can_edit_anyones_document(company, actor, target):
    assert _edit(company, actor, target) == 200
    assert _vendor(company, target) == f"edited by {actor}"


@pytest.mark.parametrize("target", ["owner", "admin", "user1", "user2"])
def test_a_viewer_can_edit_nothing(company, target):
    assert _edit(company, "viewer", target) == 403
    assert _vendor(company, target) is None


def _archive(company: dict, actor: str, target: str) -> int:
    return client.post(
        f"/api/documents/{company['documents'][target]}/archive",
        headers=_headers(company["tokens"][actor]),
    ).status_code


@pytest.mark.parametrize("actor", ["user1", "user2", "viewer"])
def test_below_admin_cannot_delete_anything_not_even_their_own_upload(company, actor):
    # No per-uploader carve-out on delete: the admin+ floor is the whole rule.
    assert _archive(company, actor, "user1") == 403
    assert _archive(company, actor, "user2") == 403
    with get_conn() as conn:
        statuses = {r["status"] for r in conn.execute("SELECT status FROM document").fetchall()}
    assert "archived" not in statuses


@pytest.mark.parametrize("actor", ["admin", "owner"])
def test_admin_and_owner_can_delete_anyones_document(company, actor):
    assert _archive(company, actor, "user1") == 200
    assert _archive(company, actor, "user2") == 200
    remaining = client.get("/api/documents", headers=_headers(company["tokens"][actor])).json()
    assert {d["id"] for d in remaining}.isdisjoint({company["documents"]["user1"], company["documents"]["user2"]})


def test_list_and_search_tell_each_caller_what_they_may_edit(company):
    own, peer = company["documents"]["user1"], company["documents"]["user2"]

    def can_edit_by_id(actor: str, rows: list[dict]) -> dict[int, bool]:
        return {d["id"]: d["can_edit"] for d in rows}

    for path in ("/api/documents", "/api/search?q=pmx"):
        rows_for = lambda actor: client.get(path, headers=_headers(company["tokens"][actor])).json()  # noqa: E731

        user1 = can_edit_by_id("user1", rows_for("user1"))
        assert user1[own] is True and user1[peer] is False, path
        admin = can_edit_by_id("admin", rows_for("admin"))
        assert all(admin.values()) and len(admin) == 4, path
        viewer = can_edit_by_id("viewer", rows_for("viewer"))
        assert not any(viewer.values()) and len(viewer) == 4, path
        assert "uploaded_by_user_id" not in rows_for("user1")[0], "the uploader's id is not for the client"


def test_a_document_with_no_recorded_uploader_stays_editable_by_a_user(company):
    # Deliberate, documented (auth.may_edit_document): nobody to protect it
    # from. Pinned here so a change to that decision is a visible one.
    with get_conn() as conn:
        conn.execute("UPDATE document SET uploaded_by_user_id = NULL WHERE id = ?", (company["documents"]["owner"],))
    assert _edit(company, "user2", "owner") == 200


def test_contracts_is_a_bucket_a_document_can_be_moved_into(company):
    assert _edit(company, "user1", "user1", bucket="Contracts") == 200
    rows = client.get("/api/documents", headers=_headers(company["tokens"]["user1"])).json()
    mine = next(d for d in rows if d["id"] == company["documents"]["user1"])
    assert mine["bucket"] == "Contracts"
