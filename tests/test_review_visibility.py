"""Who sees which review item (2026-09-24, round 12). GET /api/review used to
filter only by company, so every role saw every open item — including one
user's flagged upload appearing in a different user's queue.

Rule (auth.may_see_review_item): admin/owner see everything, a `user` sees
only items on documents they uploaded themselves, a `viewer` sees none. Real
logins and real uploads through POST /api/documents; a blank JPEG has no OCR
text, so classify takes its deterministic no-text branch and nothing here
calls the gateway. Each upload is a different colour so no two hash alike.
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
    """One company, five logged-in accounts, one upload (and so one open
    review item) from each account that may upload."""
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@review.test", "company_name": "Review Co", "fye_month": 12, "fye_day": 31},
    ).json()
    company_id = owner["company"]["id"]
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@review.test"
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
            files={"file": (f"{name}-rvw.jpg", _jpeg(COLORS[name]), "image/jpeg")},
        )
        assert resp.status_code == 200, resp.text
        documents[name] = resp.json()["document_id"]
    return {"tokens": tokens, "documents": documents, "company_id": company_id}


def _queue(company: dict, actor: str) -> set[int]:
    resp = client.get("/api/review", headers=_headers(company["tokens"][actor]))
    assert resp.status_code == 200, resp.text
    return {item["document_id"] for item in resp.json()}


def test_user1s_review_item_reaches_user1_admin_and_owner(company):
    mine = company["documents"]["user1"]
    for actor in ("user1", "admin", "owner"):
        assert mine in _queue(company, actor), actor


@pytest.mark.parametrize("actor", ["user2", "viewer"])
def test_user1s_review_item_is_hidden_from_another_user_and_from_a_viewer(company, actor):
    assert company["documents"]["user1"] not in _queue(company, actor)


@pytest.mark.parametrize("actor", ["user1", "user2"])
def test_a_user_sees_exactly_their_own_uploads_and_nothing_else(company, actor):
    assert _queue(company, actor) == {company["documents"][actor]}


@pytest.mark.parametrize("actor", ["admin", "owner"])
def test_admin_and_owner_see_every_open_item_in_the_company(company, actor):
    assert _queue(company, actor) == set(company["documents"].values())


def test_a_viewer_sees_no_review_items_at_all(company):
    assert _queue(company, "viewer") == set()


def test_the_uploaders_id_is_not_sent_to_the_client(company):
    for actor in ("owner", "user1"):
        rows = client.get("/api/review", headers=_headers(company["tokens"][actor])).json()
        assert rows and all("uploaded_by_user_id" not in r for r in rows)


def test_an_item_on_a_document_with_no_recorded_uploader_is_admin_and_owner_only(company):
    # Fails closed, unlike may_edit_document's NULL handling: visibility is
    # privacy, and nobody can show they uploaded a document nobody uploaded.
    orphan = company["documents"]["owner"]
    with get_conn() as conn:
        conn.execute("UPDATE document SET uploaded_by_user_id = NULL WHERE id = ?", (orphan,))
    for actor in ("admin", "owner"):
        assert orphan in _queue(company, actor)
    for actor in ("user1", "user2", "viewer"):
        assert orphan not in _queue(company, actor)


def test_the_filter_never_widens_across_companies(company):
    other = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@elsewhere.test", "company_name": "Elsewhere Co", "fye_month": 6, "fye_day": 30},
    ).json()
    assert _queue({"tokens": {"owner": other["token"]}}, "owner") == set()


# The last test in this file used to PIN that a pending document stayed listed and
# fetchable by every role even though its review card was hidden. That was an open
# decision; it was decided the other way in round 13 (DECISIONS #83) — the document
# is hidden from the same audience everywhere — and the tests for it, across list,
# search, file and trace, are in tests/test_document_visibility.py.
