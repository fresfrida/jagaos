"""The owner asks for a company document to be purged (2026-09-25, round 21, A5, DECISIONS #101 and #102).

The smallest honest version of an owner "Purge": nothing is deleted. POST /api/documents/{id}/request-purge archives the document
exactly as Delete does (hidden from every other role, file and row kept) and flags it (`purge_requested_at`, `purge_requested_by`).
The OWNER, and only the owner, keeps seeing it, marked "purge_requested" and read-only, until the team removes the row (#102), so the
request is an accountability trail and not a disappearance; the owner-only GET /api/purge-requests lists what is pending too.
An admin keeps Delete and has no Purge; a personal file is never purge-requested; an ordinary Delete stays invisible to everyone.

Taking a pending request back (round 3, item 9b, DECISIONS #121): POST /api/documents/{id}/cancel-purge-request, owner only. It
undoes exactly what the request did (the archive and the flag), so the document returns to the status it had, which the audit row
of the archive records; it is NOT a general un-archive (an ordinary Delete still has no way back).

Real logins and real uploads; noise JPEGs take classify's no-text branch, so nothing here calls the gateway.
"""

import io
import logging
import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.auth import CurrentMembership, may_cancel_purge_request, may_request_purge, may_see_purge_requested
from app.db import get_conn
from app.main import app
from app.purge import purge_now
from app.rules.transitions import InvalidTransition, restore_document_after_purge_request, transition_document

client = TestClient(app)
_seed = iter(range(1, 100_000))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed) + 900_000)
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@preq.test", "company_name": "Purge Request Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens, ids = {"owner": owner["token"]}, {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@preq.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"]}


@pytest.fixture
def other_company() -> dict:
    """A second, unrelated company with its own owner: the tenant-isolation witness."""
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@preq-other.test", "company_name": "Other Purge Co", "fye_month": 6, "fye_day": 30},
    ).json()
    return {"token": owner["token"], "company_id": owner["company"]["id"]}


def _upload(team: dict, actor: str, *, private: bool = False, tag: str = "f") -> int:
    suffix = "?visibility=only_me" if private else ""
    resp = client.post(
        f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]),
        files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm_review(team: dict, doc: int) -> None:
    owner = _headers(team["tokens"]["owner"])
    item = next(i for i in client.get("/api/review", headers=owner).json() if i["document_id"] == doc)
    resp = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": {}}, headers=owner,
    )
    assert resp.status_code == 200, resp.text


def _filed_company_doc(team: dict, tag: str = "f") -> int:
    doc = _upload(team, "user1", tag=tag)
    _confirm_review(team, doc)
    return doc


def _row(doc: int):
    with get_conn() as conn:
        return conn.execute(
            "SELECT id, filename, status, stored_path, purge_requested_at, purge_requested_by FROM document WHERE id = ?", (doc,),
        ).fetchone()


def _ask(team: dict, actor: str, doc: int):
    return client.post(f"/api/documents/{doc}/request-purge", headers=_headers(team["tokens"][actor]))


def _requests(token: str):
    return client.get("/api/purge-requests", headers=_headers(token))


# --- the owner asks; nothing is deleted -------------------------------------------------------------------


def _ids(token: str, path: str = "/api/documents") -> set[int]:
    return {d["id"] for d in client.get(path, headers=_headers(token)).json()}


def test_the_owner_can_ask_for_a_filed_company_document_to_be_purged_and_nothing_is_deleted(team):
    doc = _filed_company_doc(team)
    stored = Path(_row(doc)["stored_path"])

    resp = _ask(team, "owner", doc)

    assert resp.status_code == 200 and resp.json() == {"status": "purge_requested"}
    row = _row(doc)
    assert row["status"] == "archived"                      # archived exactly as Delete archives it
    assert row["purge_requested_at"] is not None
    assert row["purge_requested_by"] == "owner@preq.test"
    assert stored.exists()                                  # nothing is deleted: the file is still on disk


def test_the_owner_still_sees_it_marked_purge_requested_and_can_still_open_the_file(team):
    doc = _filed_company_doc(team)
    _ask(team, "owner", doc)

    listed = next(d for d in client.get("/api/documents", headers=_headers(team["tokens"]["owner"])).json() if d["id"] == doc)

    assert listed["status"] == "purge_requested"            # what the pill reads
    # `can_edit` (round 5, item 2, DECISIONS #126) is the plain ownership answer, same as any other document — an
    # owner can always edit in their own company, purge-requested or not. It is NOT what makes this read-only: the
    # test right after this one is what actually enforces that, server-side.
    assert listed["can_edit"] is True
    assert "purge_requested_at" not in listed                # the row has the same shape as every other
    assert client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"]["owner"])).status_code == 200


def test_a_purge_requested_document_really_is_read_only_a_direct_edit_is_refused_even_for_the_owner(team):
    # Round 5, item 2 (DECISIONS #126): found live, after deploying, that Edit had simply vanished from the card
    # instead of rendering disabled — traced to `can_edit` being force-set False for this row, which the frontend's
    # round-5 change had started reading as "hide the button" again. Fixing that (the test just above) removes the
    # ONLY thing that ever stopped an actual PATCH here: neither `may_see_document` nor `may_edit_document` has ever
    # known about archived or purge-requested status at all. This is the real fix: the endpoint itself now refuses,
    # matching `get_document_file`/`get_trace`'s own `status != 'archived'` rule, so a curl PATCH is refused exactly
    # like the UI now implies, not just a button that happens not to be there.
    doc = _filed_company_doc(team, tag="editrefused")
    _ask(team, "owner", doc)

    resp = client.patch(f"/api/documents/{doc}", json={"description": "trying to edit a purge-requested document"}, headers=_headers(team["tokens"]["owner"]))

    assert resp.status_code == 404
    with get_conn() as conn:
        row = conn.execute("SELECT description FROM document WHERE id = ?", (doc,)).fetchone()
    assert row["description"] is None or "trying to edit" not in row["description"]


@pytest.mark.parametrize("actor", ["admin", "user1", "user2", "viewer"])
def test_every_other_role_sees_it_as_gone_exactly_as_a_delete(team, actor):
    doc = _filed_company_doc(team, tag="gone")
    assert doc in _ids(team["tokens"][actor])
    _ask(team, "owner", doc)

    assert doc not in _ids(team["tokens"][actor])
    assert client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"][actor])).status_code == 404
    assert doc not in _ids(team["tokens"][actor], "/api/search?q=user1-gone")


def test_the_owner_finds_it_in_search_too_and_nobody_else_does(team):
    doc = _filed_company_doc(team, tag="findable")
    _ask(team, "owner", doc)

    found = client.get("/api/search?q=findable", headers=_headers(team["tokens"]["owner"])).json()
    assert [d["id"] for d in found] == [doc] and found[0]["status"] == "purge_requested"
    for actor in ("admin", "user1", "viewer"):
        assert client.get("/api/search?q=findable", headers=_headers(team["tokens"][actor])).json() == [], actor


def test_the_owners_thumbnail_of_a_purge_requested_pdf_still_works_and_others_get_404(team):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 760, f"Thumbnail check {next(_seed)}")
    c.save()
    doc = client.post("/api/documents", headers=_headers(team["tokens"]["user1"]),
                      files={"file": ("pq-thumb.pdf", buf.getvalue(), "application/pdf")}).json()["document_id"]
    _confirm_review(team, doc)
    assert client.get(f"/api/documents/{doc}/thumbnail", headers=_headers(team["tokens"]["owner"])).status_code == 200
    _ask(team, "owner", doc)

    assert client.get(f"/api/documents/{doc}/thumbnail", headers=_headers(team["tokens"]["owner"])).status_code == 200
    assert client.get(f"/api/documents/{doc}/thumbnail", headers=_headers(team["tokens"]["admin"])).status_code == 404


def test_an_ordinary_delete_is_still_invisible_to_the_owner_only_a_purge_request_earns_the_exception(team):
    deleted = _filed_company_doc(team, tag="plaindelete")
    requested = _filed_company_doc(team, tag="reqpurge")
    assert client.post(f"/api/documents/{deleted}/archive", headers=_headers(team["tokens"]["admin"])).status_code == 200
    _ask(team, "owner", requested)

    owner_sees = _ids(team["tokens"]["owner"])
    assert deleted not in owner_sees and requested in owner_sees
    assert client.get(f"/api/documents/{deleted}/file", headers=_headers(team["tokens"]["owner"])).status_code == 404
    assert deleted not in _ids(team["tokens"]["owner"], "/api/search?q=plaindelete")


def test_another_companys_owner_never_sees_it(team, other_company):
    doc = _filed_company_doc(team, tag="crosstenant")
    _ask(team, "owner", doc)
    assert doc not in _ids(other_company["token"])
    assert client.get(f"/api/documents/{doc}/file", headers=_headers(other_company["token"])).status_code == 404


def test_a_purge_requested_document_cannot_be_deleted_or_asked_for_again_and_the_pill_clears_only_when_the_row_is_gone(team):
    doc = _filed_company_doc(team, tag="untilremoved")
    _ask(team, "owner", doc)

    assert client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"]["owner"])).status_code == 409
    assert _ask(team, "owner", doc).status_code == 409
    assert doc in _ids(team["tokens"]["owner"])                # still there, still marked

    purge_now(doc)                                             # the team removes the row

    assert doc not in _ids(team["tokens"]["owner"])
    assert client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"]["owner"])).status_code == 404


def test_the_row_survives_with_its_history_so_the_team_can_purge_it_later(team):
    doc = _filed_company_doc(team)
    _ask(team, "owner", doc)
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document WHERE id = ?", (doc,)).fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM trace WHERE document_id = ?", (doc,)).fetchone()[0] > 0


def test_a_pending_document_can_be_asked_for_and_its_review_item_is_dismissed(team):
    doc = _upload(team, "user1", tag="pending")            # still waiting for review; the owner sees it
    assert any(i["document_id"] == doc for i in client.get("/api/review", headers=_headers(team["tokens"]["owner"])).json())

    assert _ask(team, "owner", doc).status_code == 200

    assert not any(i["document_id"] == doc for i in client.get("/api/review", headers=_headers(team["tokens"]["owner"])).json())
    assert _row(doc)["purge_requested_at"] is not None


@pytest.mark.parametrize("actor", ["admin", "user1", "user2", "viewer"])
def test_nobody_below_the_owner_can_ask_an_admin_keeps_delete_only(team, actor):
    doc = _filed_company_doc(team)

    resp = _ask(team, actor, doc)

    assert resp.status_code == 403
    assert _row(doc)["status"] == "filed" and _row(doc)["purge_requested_at"] is None


def test_an_admin_can_still_delete_the_ordinary_way_and_that_is_not_a_purge_request(team):
    doc = _filed_company_doc(team)
    assert client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"]["admin"])).status_code == 200
    assert _row(doc)["status"] == "archived" and _row(doc)["purge_requested_at"] is None
    assert _requests(team["tokens"]["owner"]).json() == []


def test_a_personal_file_is_never_purge_requested_even_by_its_own_owner_uploader(team):
    mine = _upload(team, "owner", private=True, tag="mine")
    theirs = _upload(team, "user1", private=True, tag="theirs")

    assert _ask(team, "owner", mine).status_code == 403      # visible to them, but the rule refuses: it is theirs to delete for good
    assert _ask(team, "owner", theirs).status_code == 404    # not visible to the owner: not even confirmed to exist
    assert _ask(team, "admin", theirs).status_code == 404
    assert _row(mine)["purge_requested_at"] is None and _row(theirs)["purge_requested_at"] is None


def test_another_companys_owner_gets_a_404_and_changes_nothing(team, other_company):
    doc = _filed_company_doc(team)

    resp = client.post(f"/api/documents/{doc}/request-purge", headers=_headers(other_company["token"]))

    assert resp.status_code == 404
    assert _row(doc)["status"] == "filed" and _row(doc)["purge_requested_at"] is None


def test_a_request_needs_a_session(team):
    doc = _filed_company_doc(team)
    assert client.post(f"/api/documents/{doc}/request-purge").status_code == 401


def test_asking_twice_or_for_an_already_deleted_document_is_a_409_and_a_missing_one_a_404(team):
    doc = _filed_company_doc(team)
    assert _ask(team, "owner", doc).status_code == 200
    first_at = _row(doc)["purge_requested_at"]

    assert _ask(team, "owner", doc).status_code == 409
    assert _row(doc)["purge_requested_at"] == first_at        # the first request's time is not overwritten

    deleted = _filed_company_doc(team, tag="deleted")
    client.post(f"/api/documents/{deleted}/archive", headers=_headers(team["tokens"]["admin"]))
    assert _ask(team, "owner", deleted).status_code == 409

    assert _ask(team, "owner", 987_654).status_code == 404


def test_a_request_leaves_an_audit_line_naming_who_and_what_but_no_content(team, caplog):
    doc = _filed_company_doc(team, tag="audited")
    name = _row(doc)["filename"]
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        _ask(team, "owner", doc)
    lines = [r.getMessage() for r in caplog.records if "AUDIT purge-request" in r.getMessage()]
    assert len(lines) == 1
    assert "owner@preq.test" in lines[0] and str(doc) in lines[0] and name in lines[0]


# --- the list of requests ---------------------------------------------------------------------------------


def test_the_owner_sees_their_companys_pending_requests_newest_first(team):
    first, second = _filed_company_doc(team, tag="a"), _filed_company_doc(team, tag="b")
    _ask(team, "owner", first)
    _ask(team, "owner", second)

    listed = _requests(team["tokens"]["owner"])

    assert listed.status_code == 200
    body = listed.json()
    assert [r["id"] for r in body] == [second, first]
    # The label fields (DECISIONS #109) are the short summary and metadata the document cards already show. Still no content and no extracted text.
    assert set(body[0]) == {"id", "filename", "description", "doc_type", "vendor_name", "requested_at", "requested_by"}
    assert not {"extracted_text", "stored_path", "sha256"} & set(body[0])
    assert body[0]["requested_by"] == "owner@preq.test" and body[0]["filename"] == _row(second)["filename"]


@pytest.mark.parametrize("actor", ["admin", "user1", "viewer"])
def test_only_the_owner_can_read_the_list(team, actor):
    assert client.get("/api/purge-requests", headers=_headers(team["tokens"][actor])).status_code == 403


def test_the_list_needs_a_session(team):
    assert client.get("/api/purge-requests").status_code == 401


def test_each_listed_request_carries_what_names_the_document_as_a_person_would_not_only_its_file_name(team):
    # DECISIONS #109: the Company Settings section shows a real label first and the file name under it, which needs these columns.
    doc = _filed_company_doc(team)
    with get_conn() as conn:
        conn.execute("UPDATE document SET description = ?, doc_type = ?, vendor_name = ? WHERE id = ?",
                     ('{"en": "Office lease"}', "lease", "Acme Pte Ltd", doc))
    _ask(team, "owner", doc)

    (row,) = _requests(team["tokens"]["owner"]).json()

    assert row["id"] == doc
    assert row["filename"]
    assert (row["description"], row["doc_type"], row["vendor_name"]) == ('{"en": "Office lease"}', "lease", "Acme Pte Ltd")


def test_a_request_for_a_document_with_no_description_still_lists_with_nulls_for_the_label_fields(team):
    doc = _filed_company_doc(team)
    with get_conn() as conn:
        conn.execute("UPDATE document SET description = NULL, doc_type = NULL, vendor_name = NULL WHERE id = ?", (doc,))
    _ask(team, "owner", doc)

    (row,) = _requests(team["tokens"]["owner"]).json()

    assert row["filename"]
    assert (row["description"], row["doc_type"], row["vendor_name"]) == (None, None, None)


def test_one_company_never_sees_anothers_requests(team, other_company):
    doc = _filed_company_doc(team)
    _ask(team, "owner", doc)

    assert [r["id"] for r in _requests(team["tokens"]["owner"]).json()] == [doc]
    assert _requests(other_company["token"]).json() == []          # the other company's owner sees none of it


def test_a_request_stops_being_listed_once_the_team_has_purged_the_document(team):
    doc = _filed_company_doc(team)
    _ask(team, "owner", doc)
    assert [r["id"] for r in _requests(team["tokens"]["owner"]).json()] == [doc]

    purge_now(doc)                                               # what scripts/purge_document.py does

    assert _requests(team["tokens"]["owner"]).json() == []


# --- the rule and the schema ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "role,visibility,allowed",
    [
        ("owner", "company", True),
        ("owner", "only_me", False),
        ("admin", "company", False),
        ("user", "company", False),
        ("viewer", "company", False),
        ("owner", "anything-else", False),
    ],
)
def test_may_request_purge_matrix(role, visibility, allowed):
    membership = CurrentMembership(user_id=1, email="x@y.z", name=None, company_id=1, role=role)
    assert may_request_purge(membership, visibility=visibility) is allowed


@pytest.mark.parametrize("role,allowed", [("owner", True), ("admin", False), ("user", False), ("viewer", False)])
def test_may_see_purge_requested_matrix(role, allowed):
    membership = CurrentMembership(user_id=1, email="x@y.z", name=None, company_id=1, role=role)
    assert may_see_purge_requested(membership) is allowed


def test_the_two_columns_exist_and_default_to_null():
    with get_conn() as conn:
        columns = {r["name"]: r for r in conn.execute("PRAGMA table_info(document)")}
    for name in ("purge_requested_at", "purge_requested_by"):
        assert name in columns and columns[name]["notnull"] == 0 and columns[name]["dflt_value"] is None


# --- taking a pending request back (round 3, item 9b, DECISIONS #121) -----------------------------------------


def _cancel(team: dict, actor: str, doc: int):
    return client.post(f"/api/documents/{doc}/cancel-purge-request", headers=_headers(team["tokens"][actor]))


def _set_status(doc: int, status: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE document SET status = ? WHERE id = ?", (status, doc))


def _open_review_ids(team: dict, actor: str = "owner") -> set[int]:
    return {i["document_id"] for i in client.get("/api/review", headers=_headers(team["tokens"][actor])).json()}


def test_the_owner_can_cancel_a_pending_request_and_the_document_comes_back_exactly_as_it_was(team):
    doc = _filed_company_doc(team, tag="undo")
    stored = Path(_row(doc)["stored_path"])
    _ask(team, "owner", doc)
    assert doc not in _ids(team["tokens"]["admin"])

    resp = _cancel(team, "owner", doc)

    assert resp.status_code == 200 and resp.json() == {"status": "filed"}
    row = _row(doc)
    assert (row["status"], row["purge_requested_at"], row["purge_requested_by"]) == ("filed", None, None)
    assert stored.exists()
    for actor in ("owner", "admin", "user1", "viewer"):                    # back for everyone, everywhere
        assert doc in _ids(team["tokens"][actor]), actor
        assert client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"][actor])).status_code == 200
    assert doc in _ids(team["tokens"]["admin"], "/api/search?q=user1-undo")
    listed = next(d for d in client.get("/api/documents", headers=_headers(team["tokens"]["owner"])).json() if d["id"] == doc)
    assert listed["status"] == "filed" and listed["can_edit"] is True      # no longer marked, no longer read-only
    assert _requests(team["tokens"]["owner"]).json() == []                 # and it is gone from the pending list


def test_a_document_asked_for_while_waiting_for_review_goes_back_to_waiting_and_can_still_be_confirmed(team):
    doc = _upload(team, "user1", tag="waiting")
    assert doc in _open_review_ids(team)
    _ask(team, "owner", doc)
    assert doc not in _open_review_ids(team)                                # the request dismissed its review item

    resp = _cancel(team, "owner", doc)

    assert resp.status_code == 200 and resp.json() == {"status": "needs_review"}
    assert doc in _open_review_ids(team)                                    # the item is open again, not lost
    assert doc in _ids(team["tokens"]["user1"]) and doc not in _ids(team["tokens"]["user2"])   # the pending-review visibility rule is back
    _confirm_review(team, doc)                                              # and the review can still be finished
    assert _row(doc)["status"] == "filed"


@pytest.mark.parametrize("prior", ["received", "proposed", "filed", "rejected", "quarantined"])
def test_whatever_status_it_had_is_the_status_it_gets_back(team, prior):
    doc = _filed_company_doc(team, tag=f"was-{prior}")
    _set_status(doc, prior)
    _ask(team, "owner", doc)

    resp = _cancel(team, "owner", doc)

    assert resp.status_code == 200 and resp.json() == {"status": prior}
    assert _row(doc)["status"] == prior and _row(doc)["purge_requested_at"] is None


def test_a_quarantined_documents_review_item_is_reopened_too(team):
    doc = _upload(team, "user1", tag="held")
    _set_status(doc, "quarantined")                                         # what the injection guard does, with its item still open
    _ask(team, "owner", doc)
    assert doc not in _open_review_ids(team)

    assert _cancel(team, "owner", doc).json() == {"status": "quarantined"}

    assert doc in _open_review_ids(team)


def test_a_request_can_be_made_again_after_a_cancel_and_the_latest_archive_is_the_one_undone(team):
    doc = _filed_company_doc(team, tag="twice")
    _ask(team, "owner", doc)
    assert _cancel(team, "owner", doc).json() == {"status": "filed"}
    _set_status(doc, "rejected")                                            # a different status the second time round
    assert _ask(team, "owner", doc).status_code == 200

    assert _cancel(team, "owner", doc).json() == {"status": "rejected"}     # not the first request's "filed"


@pytest.mark.parametrize("actor", ["admin", "user1", "viewer"])
def test_nobody_below_the_owner_can_take_a_request_back_and_to_them_the_document_does_not_exist(team, actor):
    doc = _filed_company_doc(team, tag="notyours")
    _ask(team, "owner", doc)

    assert _cancel(team, actor, doc).status_code == 404                     # the same answer as for a document that was never there
    assert _row(doc)["status"] == "archived" and _row(doc)["purge_requested_at"] is not None


def test_another_companys_owner_gets_a_404_and_changes_nothing_when_cancelling(team, other_company):
    doc = _filed_company_doc(team, tag="foreign")
    _ask(team, "owner", doc)

    resp = client.post(f"/api/documents/{doc}/cancel-purge-request", headers=_headers(other_company["token"]))

    assert resp.status_code == 404
    assert _row(doc)["status"] == "archived" and _row(doc)["purge_requested_at"] is not None


def test_cancelling_needs_a_session(team):
    doc = _filed_company_doc(team, tag="nosession")
    _ask(team, "owner", doc)
    assert client.post(f"/api/documents/{doc}/cancel-purge-request").status_code == 401


def test_cancelling_when_there_is_nothing_to_cancel_is_a_409_and_a_missing_document_a_404(team):
    live = _filed_company_doc(team, tag="never-asked")
    assert _cancel(team, "owner", live).status_code == 409                 # visible, filed, no request
    assert _row(live)["status"] == "filed"

    doc = _filed_company_doc(team, tag="cancelled-once")
    _ask(team, "owner", doc)
    assert _cancel(team, "owner", doc).status_code == 200
    assert _cancel(team, "owner", doc).status_code == 409                  # a second cancel: the request is already gone

    assert _cancel(team, "owner", 987_654).status_code == 404


def test_an_ordinary_delete_cannot_be_undone_this_way_and_stays_invisible_even_to_the_owner(team):
    doc = _filed_company_doc(team, tag="plain-delete")
    assert client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"]["admin"])).status_code == 200

    assert _cancel(team, "owner", doc).status_code == 404                  # not a purge request, so not the owner's to see
    assert _row(doc)["status"] == "archived"
    with pytest.raises(InvalidTransition):                                 # and the function itself refuses too
        restore_document_after_purge_request(doc, "owner@preq.test")
    with pytest.raises(InvalidTransition):                                 # archived still has no way out of the state machine
        transition_document(doc, "filed", actor="owner@preq.test")


def test_a_live_document_is_refused_by_the_restore_function(team):
    doc = _filed_company_doc(team, tag="live")
    with pytest.raises(InvalidTransition):
        restore_document_after_purge_request(doc, "owner@preq.test")
    assert _row(doc)["status"] == "filed"


def test_a_request_whose_earlier_status_cannot_be_found_is_refused_and_stays_pending(team):
    doc = _filed_company_doc(team, tag="lost-history")
    _ask(team, "owner", doc)
    with get_conn() as conn:                                                # a request made before this feature, with its audit row gone
        conn.execute(
            "DELETE FROM trace WHERE document_id = ? AND node = 'rules.transition_document' AND decision LIKE '%->archived by %'", (doc,),
        )

    resp = _cancel(team, "owner", doc)

    assert resp.status_code == 409                                          # never guess a status
    assert _row(doc)["status"] == "archived" and _row(doc)["purge_requested_at"] is not None
    assert doc in [r["id"] for r in _requests(team["tokens"]["owner"]).json()]


def test_a_cancel_leaves_an_audit_row_and_a_log_line(team, caplog):
    doc = _filed_company_doc(team, tag="audited-cancel")
    name = _row(doc)["filename"]
    _ask(team, "owner", doc)
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        _cancel(team, "owner", doc)
    lines = [r.getMessage() for r in caplog.records if "AUDIT purge-request-cancel" in r.getMessage()]
    assert len(lines) == 1 and "owner@preq.test" in lines[0] and str(doc) in lines[0] and name in lines[0]
    with get_conn() as conn:
        decision = conn.execute(
            "SELECT decision FROM trace WHERE document_id = ? AND node = 'rules.restore_after_purge_request'", (doc,),
        ).fetchone()["decision"]
    assert decision == "archived->filed by owner@preq.test (purge request cancelled)"


@pytest.mark.parametrize(
    "role,visibility,allowed",
    [
        ("owner", "company", True),
        ("owner", "only_me", False),
        ("admin", "company", False),
        ("user", "company", False),
        ("viewer", "company", False),
    ],
)
def test_may_cancel_purge_request_matrix_is_the_same_as_may_request_purge(role, visibility, allowed):
    membership = CurrentMembership(user_id=1, email="x@y.z", name=None, company_id=1, role=role)
    assert may_cancel_purge_request(membership, visibility=visibility) is allowed
    assert may_cancel_purge_request(membership, visibility=visibility) == may_request_purge(membership, visibility=visibility)
