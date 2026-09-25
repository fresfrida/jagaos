"""Upload limits (2026-09-25, round 20, item 6, DECISIONS #99): a 25 MB cap per file, enforced while the body
is still arriving and again per file, and a cap of 15 private files per person per company.

Real logins and real uploads; noise JPEGs take classify's no-text branch, so nothing here calls the gateway.
"""

import asyncio
import io
import json
import random

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.db import get_conn
from app.limits import (
    BODY_LIMITS,
    MAX_FILE_BYTES,
    MAX_PERSONAL_FILES,
    BodySizeLimit,
    personal_file_count,
)
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


def _padded_jpeg(size: int) -> bytes:
    """A real JPEG followed by zero bytes up to exactly `size`: decodes, and is exactly that big."""
    data = _jpeg()
    return data + b"\0" * (size - len(data))


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@limits.test", "company_name": "Limits Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens, ids = {"owner": owner["token"]}, {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@limits.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"]}


def _upload(team: dict, actor: str, *, private: bool, data: bytes | None = None, name: str = "f.jpg"):
    suffix = "?visibility=only_me" if private else ""
    return client.post(
        f"/api/documents{suffix}", headers=_headers(team["tokens"][actor]),
        files={"file": (name, data if data is not None else _jpeg(), "image/jpeg")},
    )


def _fill_personal_space(team: dict, actor: str, n: int) -> None:
    for _ in range(n):
        assert _upload(team, actor, private=True).status_code == 200


def _limits(team: dict, actor: str) -> dict:
    return client.get("/api/limits", headers=_headers(team["tokens"][actor])).json()


# --- the numbers ----------------------------------------------------------------------------------------


def test_the_limits_are_the_ones_that_were_decided():
    assert MAX_FILE_BYTES == 25 * 1024 * 1024
    assert MAX_PERSONAL_FILES == 15
    assert BODY_LIMITS[("POST", "/api/documents")] > MAX_FILE_BYTES  # room for multipart framing
    assert BODY_LIMITS[("POST", "/api/documents/pages")] > BODY_LIMITS[("POST", "/api/documents")]


# --- the body-size middleware, on its own -------------------------------------------------------------


async def _run(limit: int, headers: list[tuple[bytes, bytes]], chunks: list[bytes], method="POST", path="/x", scope_type="http"):
    """Drive BodySizeLimit with a stub app that reads the whole body and answers 200. Returns
    (status sent, whether the app was called, bytes the app read)."""
    seen = {"called": False, "read": 0}
    sent: list[dict] = []

    async def stub(scope, receive, send):
        seen["called"] = True
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                # what a real app does when the client "goes away" mid-body: it answers anyway (FastAPI: a 400 for the
                # unparseable body). The middleware must keep that answer from following its own 413.
                await send({"type": "http.response.start", "status": 400, "headers": []})
                await send({"type": "http.response.body", "body": b"bad body"})
                return
            seen["read"] += len(message.get("body", b""))
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    queue = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1} for i, c in enumerate(chunks)]

    async def receive():
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {"type": scope_type, "method": method, "path": path, "headers": headers}
    await BodySizeLimit(stub, limits={("POST", "/x"): limit})(scope, receive, send)
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
    return status, seen["called"], seen["read"], [m for m in sent if m["type"] == "http.response.start"]


def test_a_declared_length_over_the_bound_is_refused_before_anything_is_read():
    status, called, read, _ = asyncio.run(_run(100, [(b"content-length", b"101")], [b"x" * 101]))
    assert (status, called, read) == (413, False, 0)


def test_a_body_at_the_bound_passes():
    status, called, read, _ = asyncio.run(_run(100, [(b"content-length", b"100")], [b"x" * 100]))
    assert (status, called, read) == (200, True, 100)


def test_with_no_content_length_the_bytes_are_counted_as_they_arrive_and_stopped_at_the_bound():
    chunks = [b"x" * 40] * 5  # 200 bytes in five chunks, no Content-Length
    status, called, read, started = asyncio.run(_run(100, [], chunks))
    assert status == 413 and called is True
    assert read <= 100, "the app was still handed bytes past the bound"
    assert len(started) == 1, "exactly one response: the app's own answer to the disconnect must not follow the 413"


def test_a_lying_content_length_does_not_get_past_the_streaming_count():
    status, _, read, _ = asyncio.run(_run(100, [(b"content-length", b"5")], [b"x" * 60, b"x" * 60]))
    assert status == 413 and read <= 100


def test_a_garbage_content_length_falls_through_to_the_streaming_count():
    ok_status, *_ = asyncio.run(_run(100, [(b"content-length", b"abc")], [b"x" * 50]))
    bad_status, *_ = asyncio.run(_run(100, [(b"content-length", b"abc")], [b"x" * 150]))
    assert (ok_status, bad_status) == (200, 413)


def test_other_paths_methods_and_scope_types_are_untouched():
    assert asyncio.run(_run(100, [(b"content-length", b"9999")], [b"x" * 200], path="/other"))[0] == 200
    assert asyncio.run(_run(100, [(b"content-length", b"9999")], [b"x" * 200], method="GET"))[0] == 200
    called = asyncio.run(_run(100, [], [], scope_type="lifespan"))[1]
    assert called is True


def test_the_413_body_names_the_limit_and_says_what_it_is():
    async def go():
        sent: list[dict] = []

        async def send(m):
            sent.append(m)

        async def receive():
            return {"type": "http.disconnect"}

        await BodySizeLimit(lambda *a: None, limits={("POST", "/x"): 10})(
            {"type": "http", "method": "POST", "path": "/x", "headers": [(b"content-length", b"11")]}, receive, send,
        )
        return json.loads(next(m["body"] for m in sent if m["type"] == "http.response.body"))

    detail = asyncio.run(go())["detail"]
    assert detail["code"] == "file_too_large" and detail["limit_bytes"] == MAX_FILE_BYTES and "25 MB" in detail["message"]


# --- the per-file limit through the real endpoints -----------------------------------------------------


def test_a_file_over_the_limit_is_a_413_with_a_code_and_nothing_is_stored(team):
    with get_conn() as conn:
        before = conn.execute("SELECT COUNT(*) FROM document").fetchone()[0]

    # just over the file limit but inside the body bound: the handler's per-file check
    response = _upload(team, "user1", private=False, data=_padded_jpeg(MAX_FILE_BYTES + 1))

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "file_too_large"
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM document").fetchone()[0] == before


def test_a_much_larger_file_is_refused_by_its_declared_length_before_the_handler_runs(team):
    response = _upload(team, "user1", private=False, data=b"\0" * (MAX_FILE_BYTES + 3 * 1024 * 1024))
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "file_too_large"


def test_a_file_exactly_at_the_limit_is_accepted(team):
    response = _upload(team, "user1", private=False, data=_padded_jpeg(MAX_FILE_BYTES))
    assert response.status_code == 200, response.text


def test_the_limit_applies_to_private_uploads_too(team):
    assert _upload(team, "user1", private=True, data=_padded_jpeg(MAX_FILE_BYTES + 1)).status_code == 413


def test_each_page_of_a_multi_page_upload_is_bounded(team):
    small = ("p1.jpg", _jpeg(), "image/jpeg")
    big = ("p2.jpg", _padded_jpeg(MAX_FILE_BYTES + 1), "image/jpeg")
    response = client.post("/api/documents/pages", headers=_headers(team["tokens"]["user1"]), files=[("files", small), ("files", big)])
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "file_too_large"


def test_a_413_carries_cors_headers_so_the_page_can_read_it(team):
    response = client.post(
        "/api/documents", headers={**_headers(team["tokens"]["user1"]), "Origin": "http://localhost:5173"},
        files={"file": ("big.jpg", b"\0" * (MAX_FILE_BYTES + 3 * 1024 * 1024), "image/jpeg")},
    )
    assert response.status_code == 413
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


# --- the cap on private files ---------------------------------------------------------------------------


def test_limits_endpoint_says_the_rule_and_how_much_this_person_has_used(team):
    assert _limits(team, "user1") == {"max_file_bytes": MAX_FILE_BYTES, "max_personal_files": 15, "personal_files_used": 0}
    _fill_personal_space(team, "user1", 2)
    assert _limits(team, "user1")["personal_files_used"] == 2
    assert _limits(team, "user2")["personal_files_used"] == 0  # per person


def test_limits_endpoint_needs_a_session_and_serves_a_viewer(team):
    assert client.get("/api/limits").status_code == 401
    assert _limits(team, "viewer")["personal_files_used"] == 0


def test_the_sixteenth_private_file_is_a_409_with_a_code_and_a_way_out(team):
    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES)

    response = _upload(team, "user1", private=True)

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "personal_file_limit" and detail["limit"] == 15
    assert "Delete one" in detail["message"]
    assert _limits(team, "user1")["personal_files_used"] == 15  # nothing new was stored


def test_the_cap_is_per_person_company_uploads_are_never_limited_by_it(team):
    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES)

    assert _upload(team, "user1", private=False).status_code == 200  # a company upload by the same person
    assert _upload(team, "user2", private=True).status_code == 200  # another person's private space
    assert _upload(team, "owner", private=True).status_code == 200


def test_the_cap_is_per_company_not_across_companies(team):
    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES)
    other = client.post(
        "/api/auth/dev-login",
        json={"email": "user1@limits.test", "company_name": "Second Limits Co", "fye_month": 12, "fye_day": 31},
    ).json()  # the same person, now the owner of a second company, and that session is scoped to it
    assert other["company"]["name"] == "Second Limits Co"

    response = client.post(
        "/api/documents?visibility=only_me", headers=_headers(other["token"]),
        files={"file": ("f.jpg", _jpeg(), "image/jpeg")},
    )

    assert response.status_code == 200, response.text


def test_archived_private_files_still_count_until_purged(team):
    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES - 1)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, "
            "uploaded_by_user_id, status, visibility) VALUES (?, ?, 'old.jpg', 'image/jpeg', 1, '/nowhere', 'web', ?, 'archived', 'only_me')",
            (team["company_id"], "ab" * 32, team["ids"]["user1"]),
        )
        assert personal_file_count(conn, team["company_id"], team["ids"]["user1"]) == MAX_PERSONAL_FILES
    assert _upload(team, "user1", private=True).status_code == 409


def test_a_duplicate_is_not_refused_by_the_cap_it_is_reported_as_a_duplicate(team):
    data = _jpeg()
    assert _upload(team, "user2", private=True, data=data).status_code == 200
    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES)

    response = _upload(team, "user1", private=True, data=data)  # bytes the database already holds

    assert response.status_code == 200
    assert response.json()["status"] == "duplicate"


def test_the_cap_applies_to_a_multi_page_private_upload_and_a_set_counts_as_one_file(team):
    pages = [("files", (f"p{i}.jpg", _jpeg(), "image/jpeg")) for i in range(2)]
    ok = client.post("/api/documents/pages?visibility=only_me", headers=_headers(team["tokens"]["user1"]), files=pages)
    assert ok.status_code == 200, ok.text
    assert _limits(team, "user1")["personal_files_used"] == 1  # two pages, one file

    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES - 1)
    pages = [("files", (f"q{i}.jpg", _jpeg(), "image/jpeg")) for i in range(2)]
    full = client.post("/api/documents/pages?visibility=only_me", headers=_headers(team["tokens"]["user1"]), files=pages)
    assert full.status_code == 409
    assert full.json()["detail"]["code"] == "personal_file_limit"


def test_a_409_carries_cors_headers_too(team):
    _fill_personal_space(team, "user1", MAX_PERSONAL_FILES)
    response = client.post(
        "/api/documents?visibility=only_me",
        headers={**_headers(team["tokens"]["user1"]), "Origin": "http://localhost:5173"},
        files={"file": ("f.jpg", _jpeg(), "image/jpeg")},
    )
    assert response.status_code == 409
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
