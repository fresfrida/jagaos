"""Short-lived, single-use download links (round 4, item 3, DECISIONS #122).

THE PROBLEM. The app fetches a document with `Authorization: Bearer ...` and turns the bytes into a `blob:` URL. On Android Chrome and Brave
every in-memory download (a `blob:` anchor with `download`, `blob:` through window.open, a `data:` URL) is INTERRUPTED, on HTTP and HTTPS
(measured on real browsers, in an Android emulator, with a genuine touch), while a network download with `Content-Disposition: attachment`
completes. A plain link cannot carry a header, and the bearer token must never go in a URL: it lives for seven days.

THE FIX. The token that goes in a URL is a different, much weaker thing: 32 random bytes, good for DOWNLOAD_LINK_TTL_SECONDS and for ONE use,
bound to one document, one person and one company, stored only as a SHA-256. It is made by an authenticated request
(main.create_download_link, which applies the SAME visibility rule as GET .../file) and redeemed by a plain GET that needs no header
(main.download_document). Redeeming does not trust the link's own say-so about access: it looks the person's membership up again
(auth.membership_in_company) and the endpoint re-applies the file rule, so a document deleted, a person removed or a personal file handed
over between the two steps is a 404, exactly as it would have been a moment earlier.

What is deliberately NOT here: no company id from the client (the ids come from the stored row), no reuse, no listing, no long lifetime.
The one trace a leaked URL leaves is in a server access log (the query string), where it is already spent or expired within a minute.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.auth import CurrentMembership, membership_in_company
from app.db import DB_PATH, get_conn

# Long enough for one navigation to reach the server, short enough that a URL copied out of a log is worth nothing.
DOWNLOAD_LINK_TTL_SECONDS = 60

# The extension a download must carry for the phone to know what it is: a person may have named a PDF "Lease". Mirrors what the client
# used to do for its blob download (removed in DECISIONS #122). Only a type this app hands over as a file is mapped.
_EXTENSION_FOR_MEDIA_TYPE = {"application/pdf": ".pdf"}


def attachment_filename(filename: str, media_type: str) -> str:
    """The name a downloaded copy carries: the document's own, plus the extension its type needs when it has none."""
    extension = _EXTENSION_FOR_MEDIA_TYPE.get(media_type)
    if extension is None or filename.lower().endswith(extension):
        return filename
    return f"{filename}{extension}"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_download_link(membership: CurrentMembership, document_id: int, db_path: str = DB_PATH) -> str:
    """Makes a link for ONE document for THIS person in THIS company and returns the raw token (never stored). The caller has already
    checked that the person may see the document. Expired and spent links of everyone are dropped here, the one write that already
    happens per link, so no scheduler is needed (the same trick as issue_session)."""
    token = secrets.token_urlsafe(32)
    expires_at = (_now() + timedelta(seconds=DOWNLOAD_LINK_TTL_SECONDS)).isoformat()
    with get_conn(db_path) as conn:
        conn.execute("DELETE FROM download_link WHERE used_at IS NOT NULL OR expires_at < ?", (_now().isoformat(),))
        conn.execute(
            "INSERT INTO download_link (token_hash, document_id, user_id, company_id, expires_at) VALUES (?, ?, ?, ?, ?)",
            (_hash(token), document_id, membership.user_id, membership.company_id, expires_at),
        )
    return token


def redeem_download_link(token: str, document_id: int, db_path: str = DB_PATH) -> CurrentMembership | None:
    """Spends the link and returns who it was made for, as they are NOW, or None for anything wrong with it (unknown, spent, expired, made
    for another document, or its person no longer a member): the caller answers all of those with the same 404. The spend is one atomic
    UPDATE, so two requests racing for one link cannot both win. A link tried against the wrong document is not spent."""
    if not token:
        return None
    with get_conn(db_path) as conn:
        spent = conn.execute(
            "UPDATE download_link SET used_at = ? WHERE token_hash = ? AND document_id = ? AND used_at IS NULL AND expires_at >= ?",
            (_now().isoformat(), _hash(token), document_id, _now().isoformat()),
        ).rowcount
        if spent != 1:
            return None
        row = conn.execute("SELECT user_id, company_id FROM download_link WHERE token_hash = ?", (_hash(token),)).fetchone()
    return membership_in_company(row["user_id"], row["company_id"], db_path)
