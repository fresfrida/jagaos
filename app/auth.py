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


def issue_session(user_id: int, db_path: str = DB_PATH, current_company_id: int | None = None) -> str:
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
            "INSERT INTO session (user_id, token_hash, expires_at, current_company_id) VALUES (?, ?, ?, ?)",
            (user_id, hash_token(token), expires_at, current_company_id),
        )
    return token


@dataclass
class CurrentMembership:
    user_id: int
    email: str
    name: str | None
    company_id: int
    role: Role


def _resolve_membership(conn, user_id: int, preferred_company_id: int | None):
    """Which of this user's memberships a request runs as.

    `preferred_company_id` is the session's own choice (session.current_company_id,
    set by switch_company below). It is honored only if that exact
    (user, company) membership row exists RIGHT NOW — so a removed membership
    stops working on the very next request instead of lingering in the
    session — and otherwise falls back to the first membership by id, which is
    what every session did before switching existed. A preference can select
    among a user's own memberships; it can never add one.

    Role comes from the chosen membership row, never from the session, so an
    owner of one company and a viewer of another are each exactly that."""
    if preferred_company_id is not None:
        chosen = conn.execute(
            "SELECT company_id, role FROM membership WHERE user_id = ? AND company_id = ?",
            (user_id, preferred_company_id),
        ).fetchone()
        if chosen is not None:
            return chosen
    return conn.execute(
        "SELECT company_id, role FROM membership WHERE user_id = ? ORDER BY id LIMIT 1",
        (user_id,),
    ).fetchone()


def _membership_from_token(token: str, db_path: str = DB_PATH) -> CurrentMembership:
    with get_conn(db_path) as conn:
        session_row = conn.execute(
            "SELECT user_id, expires_at, revoked_at, current_company_id FROM session WHERE token_hash = ?",
            (hash_token(token),),
        ).fetchone()
        if session_row is None:
            raise HTTPException(401, "Invalid session")
        if session_row["revoked_at"] is not None:
            raise HTTPException(401, "Session revoked. Log in again.")
        if datetime.fromisoformat(session_row["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(401, "Session expired. Log in again.")

        user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE id = ?", (session_row["user_id"],)
        ).fetchone()
        membership = _resolve_membership(conn, user["id"], session_row["current_company_id"])
        if membership is None:
            # A session can outlive its only membership (e.g. removed from
            # the company) — fail closed rather than let a stale token
            # through with no company to scope data to.
            raise HTTPException(403, "No active company membership")

        return CurrentMembership(
            user_id=user["id"], email=user["email"], name=user["name"],
            company_id=membership["company_id"], role=membership["role"],
        )


def list_memberships(user_id: int, db_path: str = DB_PATH) -> list[dict]:
    """Every company this user belongs to, for the company switcher — only
    ever the caller's OWN membership rows, so it can reveal nothing about a
    company they are not in.

    The group a company sits under is returned only on an `owner`
    membership: the group lens is an owner-level view, and a user or viewer
    scoped to one company should get no hint that a group exists at all
    (DECISIONS #77). The frontend additionally shows nothing unless there
    are two or more rows."""
    with get_conn(db_path) as conn:
        rows = conn.execute(
            "SELECT c.id AS id, c.name AS name, m.role AS role, "
            "       c.group_id AS group_id, g.name AS group_name "
            "FROM membership m JOIN company c ON c.id = m.company_id "
            "LEFT JOIN company_group g ON g.id = c.group_id "
            "WHERE m.user_id = ? ORDER BY m.id",
            (user_id,),
        ).fetchall()
    out = []
    for r in rows:
        is_owner = r["role"] == "owner"
        out.append({
            "id": r["id"], "name": r["name"], "role": r["role"],
            "group_id": r["group_id"] if is_owner else None,
            "group_name": r["group_name"] if is_owner else None,
        })
    return out


def switch_company(token: str, user_id: int, company_id: int, db_path: str = DB_PATH) -> Role:
    """Point this session at one of the caller's own memberships. 403 for any
    company the user has no membership row in — the same answer whether that
    company exists or not, so this cannot be used to probe which ids do.

    This is the one place a company id arrives from the client, and it is a
    selection validated against the membership table, not a scope the client
    supplies: every data endpoint still derives its company from the session
    (get_current_membership), never from a parameter. Returns the role held
    in that company."""
    with get_conn(db_path) as conn:
        membership = conn.execute(
            "SELECT role FROM membership WHERE user_id = ? AND company_id = ?", (user_id, company_id),
        ).fetchone()
        if membership is None:
            raise HTTPException(403, "Not a member of that company")
        conn.execute(
            "UPDATE session SET current_company_id = ? WHERE token_hash = ? AND user_id = ?",
            (company_id, hash_token(token), user_id),
        )
        return membership["role"]


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


def may_edit_document(membership: CurrentMembership, uploaded_by_user_id: int | None) -> bool:
    """The one rule for "can this caller edit this document" (2026-09-24,
    round 11) — used by PATCH /api/documents/{id} to enforce it and by the
    list/search endpoints to tell the frontend, so what the UI offers can
    never disagree with what the server allows.

    viewer: never. admin/owner: any document in their company. user: only a
    document they uploaded themselves. A document with no recorded uploader
    (uploaded_by_user_id IS NULL — direct-SQL fixtures, or a future
    non-web ingestion path such as Telegram) is deliberately editable by a
    `user`: there is no real uploader to protect it from (see
    edit_document's docstring for the original reasoning)."""
    if ROLE_ORDER[membership.role] < ROLE_ORDER["user"]:
        return False
    if membership.role == "user" and uploaded_by_user_id is not None:
        return uploaded_by_user_id == membership.user_id
    return True


def may_see_review_item(membership: CurrentMembership, uploaded_by_user_id: int | None) -> bool:
    """The one rule for "does this review item appear in this caller's
    queue" (2026-09-24, round 12) — same shape and same column as
    may_edit_document, used by GET /api/review.

    admin/owner: every item in their company (unchanged). user: only items
    on documents they uploaded themselves. viewer: none.

    Deliberately NOT may_edit_document's NULL handling: a document with no
    recorded uploader (direct-SQL fixtures, a future Telegram/email ingest
    path) is visible to admin/owner only, never to a `user`. Editing is
    protecting "someone else's file" and had nobody to protect it from;
    visibility is privacy, and privacy fails closed — nobody can show they
    uploaded it.

    This filters the review queue only. The document itself (Company
    Files, search, file bytes, trace) stays readable by every role — see
    docs/PERMISSIONS.md's flagged decision on that gap."""
    if ROLE_ORDER[membership.role] >= ROLE_ORDER["admin"]:
        return True
    if membership.role == "user":
        return uploaded_by_user_id is not None and uploaded_by_user_id == membership.user_id
    return False


# 2026-09-24 (round 13, DECISIONS #85): document.visibility values. Kept beside
# the rule that reads them; app/models.py's Visibility Literal is the typed
# boundary for the upload parameter.
VISIBILITY_COMPANY = "company"
VISIBILITY_ONLY_ME = "only_me"

# The one document status that is hidden from part of the company while it
# lasts (DECISIONS #83). Named so widening it (a quarantined document also has
# an open review item) is a one-line change here, not a hunt through endpoints.
PENDING_REVIEW_STATUS = "needs_review"


def may_see_document(
    membership: CurrentMembership, *, status: str, uploaded_by_user_id: int | None, visibility: str,
) -> bool:
    """The one rule for "can this caller see this document at all" — used by
    the document list, search, file, trace, edit, archive, review-resolve and
    company-profile endpoints and by the review queue (2026-09-24, round 13,
    DECISIONS #83/#85). A document this returns False for is INVISIBLE, not
    forbidden: it is left out of lists and answers 404 on a direct fetch, the
    same as an archived one (DECISIONS #53) — a 403 would confirm it exists.

    Two rules, in this order:
    1. A personal file (`visibility` other than 'company'): its uploader and
       no one else. Not an admin, not the owner, no exception — so this is
       checked before any role is looked at. A document with no recorded
       uploader is visible to nobody (nobody can show they uploaded it).
    2. A document pending review (status 'needs_review'): may_see_review_item's
       rule — admin/owner always, a user only their own upload, a viewer never.
       Once the review is resolved the status changes and this no longer
       applies; the document is then visible per the normal role rules.

    Everything else is visible to the whole company, as before."""
    if visibility != VISIBILITY_COMPANY:
        return uploaded_by_user_id is not None and uploaded_by_user_id == membership.user_id
    if status == PENDING_REVIEW_STATUS:
        return may_see_review_item(membership, uploaded_by_user_id)
    return True


def _admin_or_uploader_of_own_personal_file(
    membership: CurrentMembership, *, uploaded_by_user_id: int | None, visibility: str,
) -> bool:
    """The one predicate behind "may act on this document": admin and owner for
    any document they can see, and a `user` only for a PERSONAL file they
    uploaded themselves (a viewer never; a company document, never). Two actions
    share it, so they cannot drift: resolving a review item (round 13, DECISIONS
    #85) and archiving a document (round 19, DECISIONS #95). Whether the caller
    may SEE the document is a separate question (may_see_document) and is checked
    first, so this only answers "may they act on it"."""
    if ROLE_ORDER[membership.role] >= ROLE_ORDER["admin"]:
        return True
    return (
        ROLE_ORDER[membership.role] >= ROLE_ORDER["user"]
        and visibility != VISIBILITY_COMPANY
        and uploaded_by_user_id is not None
        and uploaded_by_user_id == membership.user_id
    )


def may_resolve_review_item(
    membership: CurrentMembership, *, uploaded_by_user_id: int | None, visibility: str,
) -> bool:
    """Who may accept/reject a review item: admin and owner, as before — and,
    new in round 13, the uploader of their own PERSONAL file. Nobody else can
    see a personal file, so without this a `user`'s private upload would sit in
    review forever: they cannot resolve it (admin+ only) and no admin can reach
    it. The second-pair-of-eyes reasoning of DECISIONS #40 protects company
    records; a personal file is not one. Visibility itself is checked
    separately (may_see_document) — this is only "may they act on it"."""
    return _admin_or_uploader_of_own_personal_file(
        membership, uploaded_by_user_id=uploaded_by_user_id, visibility=visibility,
    )


def may_archive_document(
    membership: CurrentMembership, *, uploaded_by_user_id: int | None, visibility: str,
) -> bool:
    """Who may archive ("Delete") a document: admin and owner, as always
    (DECISIONS #37/#53), and, new in round 19 (DECISIONS #95), the uploader of
    their own PERSONAL file. A personal file is invisible to admin and owner, so
    without this its own author could never remove it: nobody else can reach it.
    Scoped to personal files on purpose: a `user` still cannot delete a company
    document, not even one they uploaded (a company record is the company's,
    DECISIONS #37). Visibility itself is checked first (may_see_document)."""
    return _admin_or_uploader_of_own_personal_file(
        membership, uploaded_by_user_id=uploaded_by_user_id, visibility=visibility,
    )


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
