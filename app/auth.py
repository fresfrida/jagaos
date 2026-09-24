"""Session + role model. The one place "who can do what" lives — endpoints
and the frontend both defer to this, never re-deriving the rule locally.

Login is a placeholder for real delivery, not for the session/role model
itself: `dev-login` issues a session directly (email in, token out) because
no email-sending is set up yet. Swapping in a real magic-link flow later
only changes how a user proves an email address — everything downstream
(session, membership, role checks) stays as-is. See docs/DECISIONS.md.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException

from app.db import DB_PATH, get_conn

# owner > admin > user > viewer. A numeric order, not a set of flags — every
# permission check is "does this role rank high enough", not a per-action
# lookup table scattered across endpoints.
ROLE_ORDER = {"viewer": 0, "user": 1, "admin": 2, "owner": 3}
Role = str  # Literal["viewer", "user", "admin", "owner"] — kept loose here to avoid a circular import with app/models.py's own Literal; that's the typed boundary.

SESSION_TTL_DAYS = 7


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_session(user_id: int, db_path: str = DB_PATH) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    with get_conn(db_path) as conn:
        # 2026-09-24 (item 7, lifecycle audit): confirmed live — nothing
        # anywhere deleted an old session row; _membership_from_token only
        # ever checked expires_at/revoked_at at auth time, never purged
        # one. session grows by exactly one row per login, forever (149
        # rows already accumulated in this project's own dev DB from
        # normal testing). No scheduler exists yet to run this
        # periodically (deprioritized, DECISIONS #28) — piggybacked on the
        # one write that already happens on every login instead of adding
        # one. Deliberately unscoped (every user's stale rows, not just
        # this one) — the whole point is keeping the table itself small.
        # String comparison, not a parsed datetime, unlike
        # _membership_from_token's real auth check below — expires_at is
        # stored as Python's isoformat() ("...T...+00:00"), datetime('now')
        # as SQLite's own format ("... " no suffix); confirmed live these
        # still compare correctly since both start with the same zero-
        # padded YYYY-MM-DD prefix, which is what lexicographic ordering
        # actually depends on. Worst case on any edge (a session purged an
        # hour early/late) is harmless either way — this is cleanup, not
        # the authentication check itself.
        conn.execute(
            "DELETE FROM session WHERE revoked_at IS NOT NULL OR expires_at < datetime('now')"
        )
        conn.execute(
            "INSERT INTO session (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
            (user_id, hash_token(token), expires_at),
        )
    return token


@dataclass
class CurrentMembership:
    user_id: int
    email: str
    name: str | None
    company_id: int
    role: Role


def _membership_from_token(token: str, db_path: str = DB_PATH) -> CurrentMembership:
    with get_conn(db_path) as conn:
        session_row = conn.execute(
            "SELECT user_id, expires_at, revoked_at FROM session WHERE token_hash = ?",
            (hash_token(token),),
        ).fetchone()
        if session_row is None:
            raise HTTPException(401, "Invalid session")
        if session_row["revoked_at"] is not None:
            raise HTTPException(401, "Session revoked — log in again")
        if datetime.fromisoformat(session_row["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(401, "Session expired — log in again")

        user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE id = ?", (session_row["user_id"],)
        ).fetchone()
        membership = conn.execute(
            "SELECT company_id, role FROM membership WHERE user_id = ? ORDER BY id LIMIT 1",
            (user["id"],),
        ).fetchone()
        if membership is None:
            # A session can outlive its only membership (e.g. removed from
            # the company) — fail closed rather than let a stale token
            # through with no company to scope data to.
            raise HTTPException(403, "No active company membership")

        return CurrentMembership(
            user_id=user["id"], email=user["email"], name=user["name"],
            company_id=membership["company_id"], role=membership["role"],
        )


def get_current_membership(authorization: str | None = Header(default=None)) -> CurrentMembership:
    """FastAPI dependency: `Authorization: Bearer <token>` -> the caller's
    identity and company, or 401. Every data endpoint takes this instead of
    a client-supplied company_id — the tenant boundary lives here, not in
    each handler (PLATFORM.md §3's "structurally impossible to forget",
    applied to a 4-role model instead of PLATFORM.md's original 6).

    authorization is optional at the FastAPI-parameter level (not Header(...))
    so a fully-missing header reaches this code as None and gets the same
    401 as a malformed one, instead of FastAPI's generic 422 for a missing
    required header — one consistent "you're not authenticated" response."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header")
    return _membership_from_token(authorization.removeprefix("Bearer ").strip())


def require_role(min_role: Role):
    """Dependency factory: `Depends(require_role("admin"))`. Raises 403 if
    the caller's role ranks below min_role. Reuses get_current_membership
    rather than re-checking the token, so there is one code path for
    "who is this", and this only adds "are they allowed"."""

    def dependency(authorization: str | None = Header(default=None)) -> CurrentMembership:
        membership = get_current_membership(authorization)
        if ROLE_ORDER[membership.role] < ROLE_ORDER[min_role]:
            raise HTTPException(403, f"Requires role '{min_role}' or higher, caller is '{membership.role}'")
        return membership

    return dependency
