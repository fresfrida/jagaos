"""Who can see a document at all (2026-09-24, round 13, DECISIONS #83 and #85).

Two rules, one function (auth.may_see_document), applied at every place a
document is listed or fetched:

1. PENDING REVIEW — a document with status `needs_review` is visible to admin
   and owner, to the `user` who uploaded it, and to no one else; once it is
   resolved (filed) it is visible per the normal role rules again.
2. PERSONAL FILE — `visibility='only_me'`: the uploader and nobody else. Not an
   admin, not the owner, whatever the review status.

"Hidden" means invisible, not forbidden: left out of lists, 404 on a direct
fetch — the same as an archived document (DECISIONS #53). These tests use real
logins and real uploads; a blank JPEG has no OCR text, so classify takes its
deterministic no-text branch and nothing here calls the gateway.
"""

import io
import random
import sqlite3
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.auth import (
    CurrentMembership,
    VISIBILITY_COMPANY,
    VISIBILITY_ONLY_ME,
    may_archive_document,
    may_resolve_review_item,
    may_see_document,
)
from app.db import get_conn, init_db
from app.main import app

client = TestClient(app)

ROLES = ["owner", "admin", "user1", "user2", "viewer"]
_colour_counter = iter(range(1, 10_000))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    """A different image every call, so no two uploads hash alike. Seeded noise,
    not a flat colour: JPEG maps neighbouring flat colours to identical bytes,
    which the duplicate check then (correctly) reports as one file."""
    rng = random.Random(next(_colour_counter))
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@vis.test", "company_name": "Vis Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@vis.test"
        added = client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        )
        assert added.status_code == 200, added.text
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return {"tokens": tokens}


def _upload(team: dict, actor: str, tag: str, visibility: str | None = None) -> int:
    """One upload by `actor`; `tag` becomes a searchable filename token."""
    suffix = f"?visibility={visibility}" if visibility else ""
    resp = client.post(
        f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]),
        files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _resolve(team: dict, actor: str, document_id: int, action: str = "confirm"):
    """Resolve the review item of `document_id` as `actor` (which must be able to
    see it); returns the raw response."""
    item = next(
        i for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json()
        if i["document_id"] == document_id
    )
    return client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": action, "corrected_fields": {}}, headers=_headers(team["tokens"][actor]),
    )


def _reach(team: dict, actor: str, document_id: int, tag: str) -> dict[str, bool]:
    """Every read path through which a document can surface, for one caller."""
    h = _headers(team["tokens"][actor])
    return {
        "list": document_id in {d["id"] for d in client.get("/api/documents", headers=h).json()},
        "search": document_id in {d["id"] for d in client.get(f"/api/search?q={tag}", headers=h).json()},
        "file": client.get(f"/api/documents/{document_id}/file", headers=h).status_code == 200,
        "trace": client.get(f"/api/trace/{document_id}", headers=h).status_code == 200,
        "queue": document_id in {i["document_id"] for i in client.get("/api/review", headers=h).json()},
        # round 19 (DECISIONS #94): the Only me section's own list
        "personal": document_id in {d["id"] for d in client.get("/api/personal-files", headers=h).json()},
    }


ALL_READS = {"list", "search", "file", "trace"}
# A personal file is NOT in the company lists or search for anyone, its uploader included (round 19,
# DECISIONS #94); the uploader reaches it by id and through their own Only me list.
PERSONAL_READS = {"file", "trace", "personal"}


def _assert_reach(team, document_id, tag, expected: dict[str, set[str] | None]):
    """expected maps role -> the set of reads that should succeed ({} = none)."""
    for actor in ROLES:
        reach = _reach(team, actor, document_id, tag)
        allowed = expected.get(actor, set())
        for path in ALL_READS | {"personal"}:
            assert reach[path] == (path in allowed), f"{actor} via {path}: expected {path in allowed}, got {reach[path]}"


# --- rule 1: a document pending review ---------------------------------------------


def test_a_pending_document_reaches_its_uploader_admin_and_owner_on_all_four_paths(team):
    doc = _upload(team, "user1", "pndx")
    _assert_reach(team, doc, "pndx", {"user1": ALL_READS, "admin": ALL_READS, "owner": ALL_READS})


@pytest.mark.parametrize("actor", ["user2", "viewer"])
def test_a_pending_document_is_invisible_to_another_user_and_to_a_viewer_on_all_four_paths(team, actor):
    doc = _upload(team, "user1", "pndy")
    reach = _reach(team, actor, doc, "pndy")
    assert not any(reach[p] for p in ALL_READS), reach


def test_a_hidden_pending_document_answers_404_not_403_so_it_is_not_confirmed_to_exist(team):
    doc = _upload(team, "user1", "pndz")
    for actor in ("user2", "viewer"):
        h = _headers(team["tokens"][actor])
        assert client.get(f"/api/documents/{doc}/file", headers=h).status_code == 404
        assert client.get(f"/api/trace/{doc}", headers=h).status_code == 404
    # ...and the same 404 as a document that does not exist at all.
    h = _headers(team["tokens"]["user2"])
    assert client.get("/api/documents/999999/file", headers=h).status_code == 404
    assert client.patch(f"/api/documents/{doc}", json={"vendor_name": "x"}, headers=h).status_code == 404


def test_once_resolved_the_same_document_is_visible_to_everyone_again(team):
    doc = _upload(team, "user1", "fldx")
    assert _resolve(team, "admin", doc).status_code == 200

    _assert_reach(team, doc, "fldx", {role: ALL_READS for role in ROLES})


def test_a_rejected_document_stays_gone_for_everyone(team):
    doc = _upload(team, "user1", "rjtx")
    assert _resolve(team, "admin", doc, action="reject").status_code == 200

    for actor in ROLES:
        assert not any(_reach(team, actor, doc, "rjtx")[p] for p in ALL_READS), actor


def test_a_user_sees_their_own_pending_upload_but_not_a_peers_in_the_list(team):
    mine, peers = _upload(team, "user1", "lsta"), _upload(team, "user2", "lstb")
    listed = {d["id"] for d in client.get("/api/documents", headers=_headers(team["tokens"]["user1"])).json()}
    assert mine in listed and peers not in listed


def test_the_calendar_reads_the_same_list_so_a_hidden_document_is_not_on_it(team):
    # The frontend's Calendar (DatesView) is fed by GET /api/documents and nothing else,
    # so filtering that one response is what keeps a hidden document off the calendar.
    doc = _upload(team, "user1", "cala")
    viewer_rows = client.get("/api/documents", headers=_headers(team["tokens"]["viewer"])).json()
    assert doc not in {d["id"] for d in viewer_rows}
    assert all("occurred_on" in d and "received_at" in d for d in viewer_rows)


# --- rule 2: a personal file ---------------------------------------------------------


def test_a_personal_file_reaches_only_its_uploader_on_every_path_while_pending(team):
    doc = _upload(team, "user1", "prva", visibility="only_me")
    _assert_reach(team, doc, "prva", {"user1": PERSONAL_READS})
    assert _reach(team, "user1", doc, "prva")["queue"] is True
    for actor in ("owner", "admin", "user2", "viewer"):
        assert _reach(team, actor, doc, "prva")["queue"] is False, actor


def test_a_personal_file_stays_invisible_to_admin_and_owner_after_it_is_filed(team):
    doc = _upload(team, "user1", "prvb", visibility="only_me")
    assert _resolve(team, "user1", doc).status_code == 200  # the uploader resolves their own

    _assert_reach(team, doc, "prvb", {"user1": PERSONAL_READS})


@pytest.mark.parametrize("actor", ["owner", "admin"])
def test_neither_admin_nor_owner_can_edit_delete_or_resolve_a_personal_file(team, actor):
    doc = _upload(team, "user1", "prvc", visibility="only_me")
    h = _headers(team["tokens"][actor])

    assert client.patch(f"/api/documents/{doc}", json={"vendor_name": "x"}, headers=h).status_code == 404
    assert client.post(f"/api/documents/{doc}/archive", headers=h).status_code == 404
    item_id = _item_id(doc)
    assert client.post(f"/api/review/{item_id}/resolve?thread_id={_thread(doc)}",
                       json={"action": "confirm", "corrected_fields": {}}, headers=h).status_code == 404
    with get_conn() as conn:
        row = conn.execute("SELECT status, vendor_name FROM document WHERE id = ?", (doc,)).fetchone()
    assert row["status"] == "needs_review" and row["vendor_name"] is None, "a refused action must change nothing"


def _item_id(document_id: int) -> int:
    with get_conn() as conn:
        return conn.execute("SELECT id FROM review_item WHERE document_id = ?", (document_id,)).fetchone()["id"]


def _thread(document_id: int) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT substr(sha256, 1, 12) t FROM document WHERE id = ?", (document_id,)).fetchone()["t"]


def test_the_owners_own_personal_file_is_hidden_from_the_admin(team):
    doc = _upload(team, "owner", "prvd", visibility="only_me")
    _assert_reach(team, doc, "prvd", {"owner": PERSONAL_READS})


def test_an_admins_own_personal_file_is_hidden_from_the_owner(team):
    doc = _upload(team, "admin", "prve", visibility="only_me")
    _assert_reach(team, doc, "prve", {"admin": PERSONAL_READS})


def test_a_company_document_is_unaffected_by_a_colleagues_personal_file(team):
    company_doc = _upload(team, "user1", "cmpa")
    assert _resolve(team, "admin", company_doc).status_code == 200
    _upload(team, "user2", "prvf", visibility="only_me")

    assert _reach(team, "viewer", company_doc, "cmpa")["list"] is True


def test_the_personal_files_list_says_which_documents_are_personal_and_the_company_list_has_none(team):
    doc = _upload(team, "user1", "vsbx", visibility="only_me")
    h = _headers(team["tokens"]["user1"])
    personal = client.get("/api/personal-files", headers=h).json()
    assert next(d for d in personal if d["id"] == doc)["visibility"] == "only_me"
    assert doc not in {d["id"] for d in client.get("/api/documents", headers=h).json()}


def test_a_bad_visibility_value_is_refused_not_stored_as_company(team):
    resp = client.post(
        "/api/documents?visibility=everyone", headers=_headers(team["tokens"]["user1"]),
        files={"file": ("x.jpg", _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 422


def test_leaving_visibility_out_means_company_the_behavior_before_this_existed(team):
    doc = _upload(team, "user1", "dflt")
    with get_conn() as conn:
        assert conn.execute("SELECT visibility FROM document WHERE id = ?", (doc,)).fetchone()["visibility"] == "company"


def test_several_photos_merged_into_one_document_can_be_personal_too(team):
    resp = client.post(
        "/api/documents/pages?visibility=only_me", headers=_headers(team["tokens"]["user1"]),
        files=[("files", (f"p{i}.jpg", _jpeg(), "image/jpeg")) for i in range(2)],
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()["document_id"]
    assert not _reach(team, "admin", doc, "pages")["personal"] and _reach(team, "user1", doc, "pages")["personal"]
    assert not _reach(team, "user1", doc, "pages")["list"], "personal files are not in the company list, even for their uploader"


# --- who may resolve, and the thread binding ---------------------------------------------


def test_a_user_may_resolve_their_own_personal_file_but_not_their_own_company_upload(team):
    private, shared = _upload(team, "user1", "rsva", visibility="only_me"), _upload(team, "user1", "rsvb")
    assert _resolve(team, "user1", private).status_code == 200
    assert _resolve(team, "user1", shared).status_code == 403  # admin+ only, exactly as before


def test_another_user_cannot_resolve_someone_elses_personal_file(team):
    doc = _upload(team, "user1", "rsvc", visibility="only_me")
    resp = client.post(
        f"/api/review/{_item_id(doc)}/resolve?thread_id={_thread(doc)}",
        json={"action": "confirm", "corrected_fields": {}}, headers=_headers(team["tokens"]["user2"]),
    )
    assert resp.status_code == 403


def test_the_review_queue_tells_each_caller_whether_they_can_resolve_an_item(team):
    private, shared = _upload(team, "user1", "qeua", visibility="only_me"), _upload(team, "user1", "qeub")
    rows = {i["document_id"]: i for i in client.get("/api/review", headers=_headers(team["tokens"]["user1"])).json()}
    assert rows[private]["can_resolve"] is True and rows[shared]["can_resolve"] is False
    admin_rows = {i["document_id"]: i for i in client.get("/api/review", headers=_headers(team["tokens"]["admin"])).json()}
    assert shared in admin_rows and admin_rows[shared]["can_resolve"] is True and private not in admin_rows


def test_a_thread_id_that_is_not_this_items_is_refused_so_one_item_cannot_resume_another_run(team):
    mine, victim = _upload(team, "user1", "thra", visibility="only_me"), _upload(team, "user2", "thrb")
    resp = client.post(
        f"/api/review/{_item_id(mine)}/resolve?thread_id={_thread(victim)}",
        json={"action": "confirm", "corrected_fields": {}}, headers=_headers(team["tokens"]["user1"]),
    )
    assert resp.status_code == 400
    with get_conn() as conn:
        assert conn.execute("SELECT status FROM document WHERE id = ?", (victim,)).fetchone()["status"] == "needs_review"


# --- a duplicate upload must not name a document the caller cannot see ------------------


def test_uploading_the_bytes_of_a_colleagues_personal_file_says_duplicate_without_naming_it(team):
    data = _jpeg()
    first = client.post("/api/documents?visibility=only_me", headers=_headers(team["tokens"]["user1"]),
                        files={"file": ("mine.jpg", data, "image/jpeg")})
    second = client.post("/api/documents", headers=_headers(team["tokens"]["user2"]),
                         files={"file": ("copy.jpg", data, "image/jpeg")})
    assert second.json() == {"document_id": None, "status": "duplicate"}
    again = client.post("/api/documents?visibility=only_me", headers=_headers(team["tokens"]["user1"]),
                        files={"file": ("mine2.jpg", data, "image/jpeg")})
    assert again.json() == {"document_id": first.json()["document_id"], "status": "duplicate"}


# --- the rule functions on their own ------------------------------------------------------


def _member(role: str, user_id: int = 7) -> CurrentMembership:
    return CurrentMembership(user_id=user_id, email="x@y.z", name=None, company_id=1, role=role)


@pytest.mark.parametrize("role", ["owner", "admin", "user", "viewer"])
@pytest.mark.parametrize("status", ["needs_review", "filed", "quarantined"])
@pytest.mark.parametrize("uploader", [7, 8, None])
def test_the_rule_matrix_for_company_documents(role, status, uploader):
    seen = may_see_document(_member(role), status=status, uploaded_by_user_id=uploader, visibility=VISIBILITY_COMPANY)
    if status != "needs_review":
        assert seen is True
    elif role in ("owner", "admin"):
        assert seen is True
    elif role == "user":
        assert seen is (uploader == 7)
    else:
        assert seen is False


@pytest.mark.parametrize("role", ["owner", "admin", "user", "viewer"])
@pytest.mark.parametrize("status", ["needs_review", "filed"])
def test_a_personal_file_is_the_uploaders_alone_whatever_the_role_or_status(role, status):
    for uploader, expected in ((7, True), (8, False), (None, False)):
        assert may_see_document(
            _member(role), status=status, uploaded_by_user_id=uploader, visibility=VISIBILITY_ONLY_ME,
        ) is expected


def test_an_unrecognised_visibility_value_fails_closed_as_personal():
    assert may_see_document(_member("owner"), status="filed", uploaded_by_user_id=8, visibility="something") is False
    assert may_see_document(_member("user"), status="filed", uploaded_by_user_id=7, visibility="something") is True


@pytest.mark.parametrize("role,visibility,uploader,expected", [
    ("owner", "company", 8, True), ("admin", "company", 8, True),
    ("user", "company", 7, False), ("user", "company", 8, False),
    ("user", "only_me", 7, True), ("user", "only_me", 8, False), ("user", "only_me", None, False),
    ("viewer", "only_me", 7, False),
])
def test_who_may_resolve(role, visibility, uploader, expected):
    assert may_resolve_review_item(_member(role), uploaded_by_user_id=uploader, visibility=visibility) is expected


# --- who can change a file's visibility: nobody (round 19, DECISIONS #95) ---------------------------


def _visibility_of(doc: int) -> str:
    with get_conn() as conn:
        return conn.execute("SELECT visibility FROM document WHERE id = ?", (doc,)).fetchone()["visibility"]


def test_uploads_default_to_company_and_take_an_explicit_value(team):
    plain, explicit = _upload(team, "user1", "dfla"), _upload(team, "user1", "dflb", visibility="only_me")
    assert (_visibility_of(plain), _visibility_of(explicit)) == ("company", "only_me")


@pytest.mark.parametrize("actor", ["owner", "admin", "user1"])
@pytest.mark.parametrize("value", ["only_me", "company"])
def test_a_patch_carrying_visibility_changes_nothing_for_anyone(team, actor, value):
    """The lock toggle and PATCH visibility were removed. The field is not part of the edit body any more, so it is
    ignored like any unknown field, and (the point) it can neither hide a company file nor expose a private one."""
    company_doc = _upload(team, "user1", "ptca")
    private_doc = _upload(team, "user1", "ptcb", visibility="only_me")
    for doc in (company_doc, private_doc):
        client.patch(f"/api/documents/{doc}", json={"visibility": value}, headers=_headers(team["tokens"][actor]))
    assert (_visibility_of(company_doc), _visibility_of(private_doc)) == ("company", "only_me")


def test_the_rows_no_longer_carry_a_toggle_flag(team):
    doc = _upload(team, "user1", "flga")
    private = _upload(team, "user1", "flgb", visibility="only_me")
    h = _headers(team["tokens"]["user1"])
    company_rows = client.get("/api/documents", headers=h).json()
    personal_rows = client.get("/api/personal-files", headers=h).json()
    assert doc in {r["id"] for r in company_rows} and private in {r["id"] for r in personal_rows}  # both lists really are checked
    assert not any("can_change_visibility" in r for r in company_rows + personal_rows)
    queue = client.get("/api/review", headers=h).json()
    assert {i["document_id"] for i in queue} >= {doc, private}
    assert not any("can_change_visibility" in i for i in queue)

@pytest.mark.parametrize("role,visibility,uploader,expected", [
    ("owner", "company", 8, True), ("admin", "company", 8, True), ("admin", "only_me", 7, True),
    ("user", "company", 7, False), ("user", "company", 8, False),  # a company document is never a user's to delete
    ("user", "only_me", 7, True), ("user", "only_me", 8, False), ("user", "only_me", None, False),
    ("user", "something", 7, True),  # an unrecognised value is personal (fails closed), so its uploader may
    ("viewer", "only_me", 7, False), ("viewer", "company", 7, False),
])
def test_who_may_archive(role, visibility, uploader, expected):
    assert may_archive_document(_member(role), uploaded_by_user_id=uploader, visibility=visibility) is expected


@pytest.mark.parametrize("role", ["owner", "admin", "user", "viewer"])
@pytest.mark.parametrize("visibility", ["company", "only_me", "something"])
@pytest.mark.parametrize("uploader", [7, 8, None])
def test_archive_and_resolve_are_the_same_rule(role, visibility, uploader):
    """One shared predicate (auth._admin_or_uploader_of_own_personal_file) behind both, so they cannot drift."""
    args = dict(uploaded_by_user_id=uploader, visibility=visibility)
    assert may_archive_document(_member(role), **args) is may_resolve_review_item(_member(role), **args)


# --- the migration --------------------------------------------------------------------------


def test_the_column_is_added_to_an_existing_database_with_every_old_row_company_visible():
    path = Path(tempfile.mkdtemp()) / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE document (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, "
        "filename TEXT NOT NULL, media_type TEXT NOT NULL, bytes INTEGER NOT NULL, stored_path TEXT NOT NULL, "
        "source_channel TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'received');"
        "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel) "
        "VALUES (1, 'aa', 'old.pdf', 'application/pdf', 1, '/x', 'web');"
    )
    conn.commit()
    conn.close()

    init_db(str(path))
    init_db(str(path))  # idempotent

    with sqlite3.connect(path) as check:
        assert check.execute("SELECT visibility FROM document WHERE filename = 'old.pdf'").fetchone()[0] == "company"
