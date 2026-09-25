"""Upload limits (2026-09-25, round 20, item 6, DECISIONS #99): how big one file may be, how many private
files one person may keep, and the machinery that enforces the first while the body is still arriving.

What is limited, and what the peer decided:
- ONE FILE: MAX_FILE_BYTES (25 MB). Enforced in two layers. A body-size middleware (BodySizeLimit) refuses
  a request whose Content-Length is over the endpoint's bound before reading any of it, and, for a client
  that sends no Content-Length or lies, counts the bytes as they arrive and stops at the bound, so the
  server never spools a 2 GB body just to say no. The handler then checks each file's own size, because
  a body bound includes multipart framing and, for several pages, several files.
- PRIVATE FILES: MAX_PERSONAL_FILES (15) per person per company, counted in the database (personal_file_count):
  every row of theirs whose visibility is not 'company', archived ones included (a soft-deleted private file
  no longer exists as far as the person can tell, so deleting a private file is a purge, see app/purge.py, and
  a rejected one is purged too; an old archived row still counts until someone purges it). The check and the
  insert are two steps (the row is written later, in ingest), so simultaneous uploads can overshoot by the
  number in flight: a known limitation, not fixed.

The same numbers are sent to the page by GET /api/limits, so the words on the page cannot drift from the rule.
"""

import json
import re
import sqlite3

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_PERSONAL_FILES = 15
# What a person types when they put a file into Only me (round 21, A3, DECISIONS #101): a name (required) and a caption (optional).
# The server is the authority; the web form mirrors these numbers as input limits.
MAX_NAME_CHARS = 120
MAX_CAPTION_CHARS = 500

# The whole request body an upload endpoint will read: the files' own bound plus multipart framing.
_FRAMING = 1024 * 1024
BODY_LIMITS: dict[tuple[str, str], int] = {
    ("POST", "/api/documents"): MAX_FILE_BYTES + _FRAMING,
    # several photos of one document: two files' worth, far more than ten downscaled photos ever are
    ("POST", "/api/documents/pages"): 2 * MAX_FILE_BYTES + _FRAMING,
}


def personal_file_count(conn: sqlite3.Connection, company_id: int, user_id: int) -> int:
    """How many private files this person holds in this company, whatever their status."""
    return conn.execute(
        "SELECT COUNT(*) FROM document WHERE company_id = ? AND uploaded_by_user_id = ? AND visibility != 'company'",
        (company_id, user_id),
    ).fetchone()[0]


def megabytes(limit_bytes: int) -> int:
    return limit_bytes // (1024 * 1024)


def file_too_large_detail() -> dict:
    return {
        "code": "file_too_large",
        "limit_bytes": MAX_FILE_BYTES,
        "message": f"That file is larger than the {megabytes(MAX_FILE_BYTES)} MB limit.",
    }


def personal_file_limit_detail() -> dict:
    return {
        "code": "personal_file_limit",
        "limit": MAX_PERSONAL_FILES,
        "message": f"You already have {MAX_PERSONAL_FILES} private files. Delete one to add another.",
    }


class BodySizeLimit:
    """Pure ASGI middleware: 413 for a request body over its endpoint's bound (BODY_LIMITS), decided from
    Content-Length before any body is read, or, when there is none, while the body streams in. Every other
    request passes through untouched."""

    def __init__(self, app, limits: dict[tuple[str, str], int] | None = None):
        self.app = app
        self.limits = BODY_LIMITS if limits is None else limits

    async def __call__(self, scope, receive, send):
        limit = self.limits.get((scope.get("method", ""), scope.get("path", ""))) if scope["type"] == "http" else None
        if limit is None:
            await self.app(scope, receive, send)
            return

        declared = dict(scope.get("headers", [])).get(b"content-length")
        if declared is not None and re.fullmatch(rb"\d+", declared) and int(declared) > limit:
            await self._refuse(send)
            return

        received = 0
        refused = False

        async def counted_receive():
            nonlocal received, refused
            if refused:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    refused = True
                    await self._refuse(send)
                    return {"type": "http.disconnect"}  # the app stops reading and unwinds
            return message

        async def guarded_send(message):
            if not refused:  # after our 413 the app's own answer (to the disconnect) must not follow it
                await send(message)

        await self.app(scope, counted_receive, guarded_send)

    async def _refuse(self, send) -> None:
        body = json.dumps({"detail": file_too_large_detail()}).encode()
        await send({
            "type": "http.response.start", "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"connection", b"close")],
        })
        await send({"type": "http.response.body", "body": body})
