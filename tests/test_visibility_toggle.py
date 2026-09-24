"""Changing who can see a file after upload (2026-09-24, round 14, DECISIONS #86).

The web UI no longer picks visibility at upload time; each file has a lock
toggle instead, which PATCHes `visibility`. The rule under test: ONLY THE
UPLOADER may change it, in both directions, whatever their role. That is
narrower than "may edit" on purpose: admin/owner may edit any company document,
but making someone else's company file private would lock the admin out of it
the moment they did (a personal file is invisible even to them) and would pull
a company record away from the whole team on one person's say-so.

Real logins and real uploads; a blank-ish JPEG takes classify's no-text branch,
so nothing here calls the gateway.
"""

import io
import random
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn, init_db
from app.main import app

client = TestClient(app)
_seed = iter(range(1, 10_000))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed) + 50_000)
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@toggle.test", "company_name": "Toggle Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@toggle.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return {"tokens": tokens}


def _upload_filed(team: dict, actor: str, tag: str) -> int:
    """An upload by `actor`, confirmed so it is a plain filed company document."""
    resp = client.post(
        "/api/documents", headers=_headers(team["tokens"][actor]),
        files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()["document_id"]
    # The owner sees every pending item, so the owner resolves them all.
    item = next(i for i in client.get("/api/review", headers=_headers(team["tokens"]["owner"])).json()
                if i["document_id"] == doc)
    confirmed = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=_headers(team["tokens"]["owner"]),
    )
    assert confirmed.status_code == 200, confirmed.text
    return doc


def _set(team: dict, actor: str, doc: int, **body):
    return client.patch(f"/api/documents/{doc}", json=body, headers=_headers(team["tokens"][actor]))


def _sees(team: dict, actor: str, doc: int) -> bool:
    h = _headers(team["tokens"][actor])
    in_list = doc in {d["id"] for d in client.get("/api/documents", headers=h).json()}
    file_ok = client.get(f"/api/documents/{doc}/file", headers=h).status_code == 200
    assert in_list == file_ok, "list and file must agree"
    return in_list


def _visibility(doc: int) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT visibility FROM document WHERE id = ?", (doc,)).fetchone()["visibility"]


def test_the_uploader_can_make_their_file_personal_and_the_team_loses_sight_of_it(team):
    doc = _upload_filed(team, "user1", "tga")
    assert all(_sees(team, who, doc) for who in ("owner", "admin", "user1", "user2", "viewer"))

    assert _set(team, "user1", doc, visibility="only_me").status_code == 200

    assert _visibility(doc) == "only_me"
    assert _sees(team, "user1", doc)
    assert not any(_sees(team, who, doc) for who in ("owner", "admin", "user2", "viewer"))


def test_and_can_make_it_visible_to_the_company_again(team):
    doc = _upload_filed(team, "user1", "tgb")
    assert _set(team, "user1", doc, visibility="only_me").status_code == 200
    assert _set(team, "user1", doc, visibility="company").status_code == 200

    assert _visibility(doc) == "company"
    assert all(_sees(team, who, doc) for who in ("owner", "admin", "user1", "user2", "viewer"))


@pytest.mark.parametrize("actor", ["admin", "owner"])
def test_admin_and_owner_cannot_change_visibility_even_though_they_can_edit_the_file(team, actor):
    doc = _upload_filed(team, "user1", "tgc")

    assert _set(team, actor, doc, vendor_name="Edited by " + actor).status_code == 200  # may edit...
    refused = _set(team, actor, doc, visibility="only_me")  # ...but not decide who sees it
    assert refused.status_code == 403
    assert "uploaded" in refused.json()["detail"]
    assert _visibility(doc) == "company"
    assert _sees(team, actor, doc), "a refused change must not lock the admin out of anything"


def test_another_user_cannot_change_a_peers_file_either(team):
    doc = _upload_filed(team, "user1", "tgd")
    assert _set(team, "user2", doc, visibility="only_me").status_code == 403
    assert _visibility(doc) == "company"


def test_a_viewer_cannot_change_visibility(team):
    doc = _upload_filed(team, "user1", "tge")
    assert _set(team, "viewer", doc, visibility="only_me").status_code == 403


@pytest.mark.parametrize("actor", ["admin", "owner"])
def test_nobody_else_can_reach_a_personal_file_to_change_it_back(team, actor):
    doc = _upload_filed(team, "user1", "tgf")
    assert _set(team, "user1", doc, visibility="only_me").status_code == 200

    assert _set(team, actor, doc, visibility="company").status_code == 404
    assert _visibility(doc) == "only_me"


def test_a_refused_change_applies_nothing_at_all(team):
    doc = _upload_filed(team, "user1", "tgg")
    refused = _set(team, "admin", doc, vendor_name="Should not stick", visibility="only_me")

    assert refused.status_code == 403
    with get_conn() as conn:
        row = conn.execute("SELECT vendor_name, visibility FROM document WHERE id = ?", (doc,)).fetchone()
    assert row["vendor_name"] is None and row["visibility"] == "company"


def test_the_uploader_can_change_visibility_together_with_other_fields(team):
    doc = _upload_filed(team, "user1", "tgh")
    assert _set(team, "user1", doc, vendor_name="Mine now", visibility="only_me").status_code == 200
    with get_conn() as conn:
        row = conn.execute("SELECT vendor_name, visibility FROM document WHERE id = ?", (doc,)).fetchone()
    assert (row["vendor_name"], row["visibility"]) == ("Mine now", "only_me")


def test_an_admin_can_make_their_own_file_personal_and_the_owner_then_cannot_see_it(team):
    doc = _upload_filed(team, "admin", "tgi")
    assert _set(team, "admin", doc, visibility="only_me").status_code == 200
    assert _sees(team, "admin", doc) and not _sees(team, "owner", doc)


def test_a_document_with_no_recorded_uploader_cannot_have_its_visibility_changed_by_anyone(team):
    doc = _upload_filed(team, "user1", "tgj")
    with get_conn() as conn:
        conn.execute("UPDATE document SET uploaded_by_user_id = NULL WHERE id = ?", (doc,))
    for actor in ("owner", "admin", "user1", "user2"):
        assert _set(team, actor, doc, visibility="only_me").status_code == 403, actor


def test_an_unknown_visibility_value_is_refused(team):
    doc = _upload_filed(team, "user1", "tgk")
    assert _set(team, "user1", doc, visibility="everyone").status_code == 422
    assert _visibility(doc) == "company"


def test_a_pending_document_can_be_made_personal_and_the_uploader_then_resolves_it_themselves(team):
    resp = client.post("/api/documents", headers=_headers(team["tokens"]["user1"]),
                       files={"file": ("pending.jpg", _jpeg(), "image/jpeg")})
    doc = resp.json()["document_id"]
    assert doc in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["admin"])).json()}

    assert _set(team, "user1", doc, visibility="only_me").status_code == 200

    assert doc not in {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"]["admin"])).json()}
    mine = next(i for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json() if i["document_id"] == doc)
    assert mine["document_visibility"] == "only_me" and mine["can_resolve"] is True
    done = client.post(f"/api/review/{mine['id']}/resolve?thread_id={mine['thread_id']}",
                       json={"action": "confirm", "corrected_fields": {}}, headers=_headers(team["tokens"]["user1"]))
    assert done.status_code == 200, done.text


def test_the_rows_say_who_may_use_the_toggle(team):
    doc = _upload_filed(team, "user1", "tgl")

    def flag(actor: str, path: str) -> bool | None:
        rows = client.get(path, headers=_headers(team["tokens"][actor])).json()
        return next((d["can_change_visibility"] for d in rows if d["id"] == doc), None)

    for path in ("/api/documents", "/api/search?q=tgl"):
        assert flag("user1", path) is True, path
        for actor in ("admin", "owner", "user2", "viewer"):
            assert flag(actor, path) is False, (actor, path)


def test_the_review_queue_says_who_may_use_the_toggle(team):
    resp = client.post("/api/documents", headers=_headers(team["tokens"]["user1"]),
                       files={"file": ("q.jpg", _jpeg(), "image/jpeg")})
    doc = resp.json()["document_id"]
    def flag(actor):
        return next(i["can_change_visibility"] for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json()
                    if i["document_id"] == doc)
    assert flag("user1") is True and flag("admin") is False and flag("owner") is False


def test_uploads_still_default_to_company_and_still_accept_an_explicit_value(team):
    plain = client.post("/api/documents", headers=_headers(team["tokens"]["user1"]),
                        files={"file": ("plain.jpg", _jpeg(), "image/jpeg")}).json()["document_id"]
    explicit = client.post("/api/documents?visibility=only_me", headers=_headers(team["tokens"]["user1"]),
                           files={"file": ("explicit.jpg", _jpeg(), "image/jpeg")}).json()["document_id"]
    assert (_visibility(plain), _visibility(explicit)) == ("company", "only_me")


# --- stored statutory citations are brought in line with the no-em-dash rule (round 14) ---


def test_stored_citations_written_with_an_em_dash_are_reworded_and_nothing_else_is_touched():
    path = Path(tempfile.mkdtemp()) / "cit.db"
    init_db(str(path))
    dash = "—"
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO company (id, name, fye_month, fye_day) VALUES (1, 'X', 12, 31)")
        for label, citation in [
            ("a", f"Companies Act s197 {dash} Annual Return due within 7 months of FYE."),
            ("b", f"Income Tax Act {dash} Form C-S/C due unless IRAS has granted a filing waiver."),
            ("c", f"A note someone typed {dash} that must be left exactly as it is"),
        ]:
            conn.execute(
                "INSERT INTO obligation (company_id, kind, label, due_on, rule_id, citation) VALUES (1, 'k', ?, '2026-01-01', 'r', ?)",
                (label, citation),
            )
    init_db(str(path))
    init_db(str(path))  # idempotent

    with sqlite3.connect(path) as conn:
        got = dict(conn.execute("SELECT label, citation FROM obligation").fetchall())
    assert got["a"] == "Companies Act s197: Annual Return due within 7 months of FYE."
    assert got["b"] == "Income Tax Act: Form C-S/C due unless IRAS has granted a filing waiver."
    assert got["c"] == f"A note someone typed {dash} that must be left exactly as it is"
