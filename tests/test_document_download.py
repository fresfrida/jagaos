"""A short-lived, single-use download link (round 4, item 3, DECISIONS #122).

Why it exists: on Android Chrome and Brave every in-memory download (a `blob:` anchor, `blob:` through window.open, a `data:` URL) is
INTERRUPTED, on HTTP and HTTPS alike (measured on real browsers in an Android emulator), while a network download with
`Content-Disposition: attachment` completes. The app cannot send its bearer token on a plain link, so the server hands out a link that
carries its own proof: POST /api/documents/{id}/download-link (authenticated, the same visibility rule as GET .../file) returns a URL with
a random token good for 60 seconds and ONE use; GET /api/documents/{id}/download?token= takes no header, consumes the token, RE-CHECKS
that the person may still see the document, and answers as an attachment under the file's real name.

Real logins and real uploads; noise JPEGs take classify's no-text branch, so nothing here calls the gateway.
"""

import io
import random
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.auth import hash_token
from app.db import get_conn
from app.downloads import DOWNLOAD_LINK_TTL_SECONDS, attachment_filename
from app.main import app

client = TestClient(app)
_seed = iter(range(1, 100_000))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _jpeg() -> bytes:
    rng = random.Random(next(_seed) + 700_000)
    buf = io.BytesIO()
    Image.frombytes("RGB", (32, 32), rng.randbytes(32 * 32 * 3)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def team() -> dict:
    owner = client.post("/api/auth/dev-login", json={"email": "owner@dl.test", "company_name": "Download Co", "fye_month": 12, "fye_day": 31}).json()
    tokens, ids = {"owner": owner["token"]}, {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@dl.test"
        assert client.post(f"/api/companies/{owner['company']['id']}/members", json={"email": email, "role": role}, headers=_headers(owner["token"])).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"]}


@pytest.fixture
def other_company() -> dict:
    owner = client.post("/api/auth/dev-login", json={"email": "owner@dl-other.test", "company_name": "Other Download Co", "fye_month": 6, "fye_day": 30}).json()
    return {"token": owner["token"], "company_id": owner["company"]["id"]}


def _upload(team: dict, actor: str, *, private: bool = False, tag: str = "f") -> int:
    suffix = "?visibility=only_me" if private else ""
    resp = client.post(f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]), files={"file": (f"{actor}-{tag}.jpg", _jpeg(), "image/jpeg")})
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _filed(team: dict, tag: str = "f") -> int:
    doc = _upload(team, "user1", tag=tag)
    owner = _headers(team["tokens"]["owner"])
    item = next(i for i in client.get("/api/review", headers=owner).json() if i["document_id"] == doc)
    assert client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}", json={"action": "confirm", "corrected_fields": {}}, headers=owner).status_code == 200
    return doc


def _link(team: dict, actor: str, doc: int):
    return client.post(f"/api/documents/{doc}/download-link", headers=_headers(team["tokens"][actor]))


def _redeem(url: str):
    return client.get(url)  # no Authorization header, on purpose: the link carries its own proof


def _stored_bytes(doc: int) -> bytes:
    with get_conn() as conn:
        path = conn.execute("SELECT stored_path FROM document WHERE id = ?", (doc,)).fetchone()["stored_path"]
    return open(path, "rb").read()


# --- the working path ------------------------------------------------------------------------------------------


def test_a_link_downloads_the_file_as_an_attachment_under_its_real_name_with_no_authorization_header(team):
    doc = _filed(team, tag="plain")
    made = _link(team, "user1", doc)

    assert made.status_code == 200
    body = made.json()
    assert body["url"].startswith(f"/api/documents/{doc}/download?token=") and body["expires_in"] == DOWNLOAD_LINK_TTL_SECONDS
    got = _redeem(body["url"])

    assert got.status_code == 200
    assert got.content == _stored_bytes(doc)
    assert got.headers["content-type"] == "image/jpeg"
    assert got.headers["content-disposition"].startswith("attachment;") and "user1-plain.jpg" in got.headers["content-disposition"]
    assert got.headers["cache-control"] == "no-store"
    assert got.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("actor", ["owner", "admin", "user1", "user2", "viewer"])
def test_anyone_who_may_see_a_filed_company_document_may_get_a_link_for_it(team, actor):
    doc = _filed(team, tag=f"seen-{actor}")
    made = _link(team, actor, doc)
    assert made.status_code == 200
    assert _redeem(made.json()["url"]).status_code == 200


def test_a_link_is_good_for_ONE_use(team):
    doc = _filed(team, tag="once")
    url = _link(team, "user1", doc).json()["url"]
    assert _redeem(url).status_code == 200
    assert _redeem(url).status_code == 404


def test_a_link_expires_after_its_ttl(team):
    doc = _filed(team, tag="late")
    url = _link(team, "user1", doc).json()["url"]
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    with get_conn() as conn:
        conn.execute("UPDATE download_link SET expires_at = ?", (past,))
    assert _redeem(url).status_code == 404


def test_the_ttl_is_short(team):
    assert DOWNLOAD_LINK_TTL_SECONDS <= 120  # long enough for one navigation, short enough that a leaked URL is worth nothing


def test_each_link_is_its_own_random_token_and_only_a_hash_is_stored(team):
    doc = _filed(team, tag="hash")
    first, second = (_link(team, "user1", doc).json()["url"].split("token=")[1] for _ in range(2))
    assert first != second and len(first) >= 40
    with get_conn() as conn:
        rows = [r["token_hash"] for r in conn.execute("SELECT token_hash FROM download_link")]
    assert hash_token(first) in rows and first not in rows and second not in rows


# --- what a link is bound to -------------------------------------------------------------------------------


def test_a_link_only_opens_the_document_it_was_made_for(team):
    a, b = _filed(team, tag="a"), _filed(team, tag="b")
    token = _link(team, "user1", a).json()["url"].split("token=")[1]
    assert _redeem(f"/api/documents/{b}/download?token={token}").status_code == 404
    assert _redeem(f"/api/documents/{a}/download?token={token}").status_code == 200   # a wrong-document try did not burn it? it must not open B, and A stays usable


def test_a_made_up_or_missing_token_is_a_404_not_a_401_or_a_hint(team):
    doc = _filed(team, tag="junk")
    assert _redeem(f"/api/documents/{doc}/download?token=not-a-real-token").status_code == 404
    assert _redeem(f"/api/documents/{doc}/download").status_code in (404, 422)
    assert _redeem(f"/api/documents/{doc}/download?token=").status_code == 404


# --- who may make one (the same rule as the file endpoint) ------------------------------------------------------


def test_making_a_link_needs_a_session(team):
    doc = _filed(team, tag="nosess")
    assert client.post(f"/api/documents/{doc}/download-link").status_code == 401


def test_another_companys_user_cannot_make_a_link_and_cannot_tell_the_document_exists(team, other_company):
    doc = _filed(team, tag="foreign")
    resp = client.post(f"/api/documents/{doc}/download-link", headers=_headers(other_company["token"]))
    assert resp.status_code == 404
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM download_link").fetchone()[0] == 0


def test_a_missing_document_is_a_404(team):
    assert client.post("/api/documents/987654/download-link", headers=_headers(team["tokens"]["owner"])).status_code == 404


def test_a_colleagues_pending_upload_is_hidden_from_a_user_who_may_not_see_it(team):
    doc = _upload(team, "user1", tag="pending")            # still waiting for review
    assert _link(team, "user2", doc).status_code == 404
    assert _link(team, "user1", doc).status_code == 200    # its own uploader
    assert _link(team, "owner", doc).status_code == 200    # and whoever may resolve it


def test_a_personal_file_is_its_uploaders_alone(team):
    doc = _upload(team, "user1", private=True, tag="mine")
    assert _link(team, "user1", doc).status_code == 200
    for actor in ("owner", "admin", "user2", "viewer"):
        assert _link(team, actor, doc).status_code == 404, actor


def test_a_deleted_document_gives_no_link_except_the_purge_request_the_owner_still_sees(team):
    gone, asked = _filed(team, tag="gone"), _filed(team, tag="asked")
    assert client.post(f"/api/documents/{gone}/archive", headers=_headers(team["tokens"]["admin"])).status_code == 200
    assert client.post(f"/api/documents/{asked}/request-purge", headers=_headers(team["tokens"]["owner"])).status_code == 200

    assert _link(team, "owner", gone).status_code == 404       # an ordinary Delete is invisible to everyone
    assert _link(team, "owner", asked).status_code == 200      # the owner's own purge request stays reachable (#102)
    assert _link(team, "admin", asked).status_code == 404


# --- the rule is applied AGAIN when the link is used -------------------------------------------------------------


def test_a_document_deleted_after_the_link_was_made_can_no_longer_be_downloaded_with_it(team):
    doc = _filed(team, tag="revoked-doc")
    url = _link(team, "user1", doc).json()["url"]
    assert client.post(f"/api/documents/{doc}/archive", headers=_headers(team["tokens"]["admin"])).status_code == 200
    assert _redeem(url).status_code == 404


def test_a_person_removed_from_the_company_after_the_link_was_made_can_no_longer_use_it(team):
    doc = _filed(team, tag="revoked-member")
    url = _link(team, "user1", doc).json()["url"]
    with get_conn() as conn:
        conn.execute("DELETE FROM membership WHERE user_id = ? AND company_id = ?", (team["ids"]["user1"], team["company_id"]))
    assert _redeem(url).status_code == 404


def test_a_personal_file_link_cannot_be_used_after_the_file_stops_being_theirs(team):
    doc = _upload(team, "user1", private=True, tag="handover")
    url = _link(team, "user1", doc).json()["url"]
    with get_conn() as conn:
        conn.execute("UPDATE document SET uploaded_by_user_id = ? WHERE id = ?", (team["ids"]["user2"], doc))
    assert _redeem(url).status_code == 404


# --- naming ------------------------------------------------------------------------------------------------------------


def test_a_pdf_a_person_named_without_an_extension_downloads_with_the_extension_a_phone_needs(team):
    doc = _filed(team, tag="lease")
    with get_conn() as conn:
        conn.execute("UPDATE document SET filename = 'Lease', media_type = 'application/pdf' WHERE id = ?", (doc,))
    got = _redeem(_link(team, "user1", doc).json()["url"])
    assert got.status_code == 200 and 'filename="Lease.pdf"' in got.headers["content-disposition"]


@pytest.mark.parametrize(
    "filename,media_type,expected",
    [
        ("01_certificate_of_incorporation.pdf", "application/pdf", "01_certificate_of_incorporation.pdf"),
        ("LEASE.PDF", "application/pdf", "LEASE.PDF"),
        ("Lease", "application/pdf", "Lease.pdf"),
        ("Scan of the agreement.v2", "application/pdf", "Scan of the agreement.v2.pdf"),
        ("Passport", "image/jpeg", "Passport"),
    ],
)
def test_attachment_filename_rule(filename, media_type, expected):
    assert attachment_filename(filename, media_type) == expected


def test_a_non_ascii_name_is_sent_in_the_encoded_form_browsers_understand(team):
    doc = _filed(team, tag="cjk")
    with get_conn() as conn:
        conn.execute("UPDATE document SET filename = ? WHERE id = ?", ("公司章程 2026.jpg", doc))
    got = _redeem(_link(team, "user1", doc).json()["url"])
    assert got.status_code == 200 and "filename*=utf-8''" in got.headers["content-disposition"].lower()


# --- housekeeping -------------------------------------------------------------------------------------------------------


def test_expired_links_are_cleaned_up_when_the_next_one_is_made(team):
    doc = _filed(team, tag="tidy")
    _link(team, "user1", doc)
    with get_conn() as conn:
        conn.execute("UPDATE download_link SET expires_at = '2000-01-01T00:00:00+00:00'")
    _link(team, "user1", doc)
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM download_link").fetchone()[0] == 1


def test_the_existing_file_endpoint_is_unchanged_it_still_needs_the_bearer_header_and_still_streams_inline(team):
    doc = _filed(team, tag="legacy")
    assert client.get(f"/api/documents/{doc}/file").status_code == 401
    got = client.get(f"/api/documents/{doc}/file", headers=_headers(team["tokens"]["user1"]))
    assert got.status_code == 200 and got.headers["content-disposition"].startswith("inline;")
