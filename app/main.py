"""FastAPI app. ARCHITECTURE.md §8/§9.

Multi-user as of 2026-09-22 (DECISIONS.md): every data endpoint requires a
session (app/auth.py) and derives company_id from the caller's membership —
never from a client-supplied parameter. app_user/membership/session are the
smallest slice of PLATFORM.md's model that makes that true, with a simpler
4-role set (owner/admin/user/viewer) than PLATFORM.md's original six.
"""

import hashlib
import json
import logging
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from langgraph.errors import InvalidUpdateError
from langgraph.types import Command

load_dotenv()

from app.auth import (  # noqa: E402
    CurrentMembership,
    get_current_membership,
    hash_token,
    issue_session,
    list_memberships,
    may_archive_document,
    may_cancel_purge_request,
    may_edit_document,
    may_purge_document,
    may_request_purge,
    may_resolve_review_item,
    may_see_purge_requested,
    may_see_document,
    may_see_review_item,
    ROLE_ORDER,
    require_role,
    switch_company,
)
from app.db import (  # noqa: E402
    DB_PATH,
    build_fts5_query,
    get_conn,
    init_db,
    parse_description,
    reindex_document_search,
)
from app.extract.merge import PageImageError, merge_images_to_pdf  # noqa: E402
from app.extract.ocr import MAX_PDF_OCR_PAGES  # noqa: E402
from app.graph.classify import is_company_profile_doc_type  # noqa: E402
from app.graph.derive_expectations import backfill_expectation_evidence  # noqa: E402
from app.graph.ingest import ingest  # noqa: E402
from app.graph.pipeline import PIPELINE  # noqa: E402
from app.rules.company_profile import (  # noqa: E402
    company_settings_from_profile,
    extraction_values,
    may_prefill_company_from,
)
from app.rules.expectations import LABEL_BY_DOC_TYPE  # noqa: E402
from app.rules.transitions import (  # noqa: E402
    InvalidTransition, file_personal_document, restore_document_after_purge_request, transition_document,
)
from app.limits import (  # noqa: E402
    BodySizeLimit,
    MAX_CAPTION_CHARS,
    MAX_FILE_BYTES,
    MAX_NAME_CHARS,
    MAX_PERSONAL_FILES,
    file_too_large_detail,
    personal_file_count,
    personal_file_limit_detail,
)
from app.downloads import DOWNLOAD_LINK_TTL_SECONDS, attachment_filename, issue_download_link, redeem_download_link  # noqa: E402
from app.purge import PurgeRefused, purge_now  # noqa: E402
from app.thumbnails import get_pdf_thumbnail  # noqa: E402
from app.wordcloud import MAX_DOCUMENTS_SCANNED, top_terms  # noqa: E402
from app.models import (  # noqa: E402
    PurgeRequest,
    AddMemberRequest,
    AuthResponse,
    BusinessProfileOut,
    CompanyEditRequest,
    CompanyOut,
    CompanyProfilePrefill,
    DevLoginRequest,
    DocumentEditRequest,
    MemberOut,
    MyCompanyOut,
    ReviewResolution,
    SwitchCompanyRequest,
    UserOut,
    Visibility,
)

app = FastAPI(title="JagaOS API")

# The Vite dev server runs on a different origin than this app (5173 vs
# 8000), so the browser blocks fetch() without this. https://jagaos.vercel.app
# is listed too so /ops keeps working once it can reach a public backend —
# it can't yet (docs/HANDOFF.md: Vercel hosts the static frontend only, not
# this Python process; VITE_API_BASE_URL is still localhost-only). Tighten to
# just the real deployed frontend origin once Lightsail replaces both
# (ARCHITECTURE.md §8 serves them behind the same Caddy host, so this whole
# CORS block goes away there — same-origin needs none of it).
#
# 2026-09-24 (item 3, portability audit): this list was a hardcoded literal
# — a different deploy target (a different frontend domain, a staging
# environment) had no way to add its own origin without editing this file.
# CORS_ALLOWED_ORIGINS overrides it entirely when set (comma-separated);
# these three stay as the default so local dev and the current Vercel UAT
# keep working unchanged with nothing configured.
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://jagaos.vercel.app",
]
_cors_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS")
CORS_ALLOWED_ORIGINS = (
    [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
    if _cors_origins_env
    else _DEFAULT_CORS_ORIGINS
)
# Round 20 (item 6, DECISIONS #99): a request body over the upload endpoints' bound is a 413 before it is read.
# Added BEFORE CORS so CORS is the outer layer: the 413 then carries CORS headers, and a browser page can read it.
app.add_middleware(BodySizeLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db(DB_PATH)
    # Round 16 (DECISIONS #90): an expectation satisfied before evidence_document_id
    # existed gets the document that satisfies it. Idempotent; a no-op once done.
    backfill_expectation_evidence(DB_PATH)


def _can_see(membership: CurrentMembership, row: sqlite3.Row | dict) -> bool:
    """auth.may_see_document over a fetched document row — the row must carry
    status, uploaded_by_user_id and visibility. One wrapper so every endpoint
    asks the question the same way (round 13, DECISIONS #83/#85)."""
    return may_see_document(
        membership, status=row["status"], uploaded_by_user_id=row["uploaded_by_user_id"],
        visibility=row["visibility"],
    )


def _hidden_or_missing(membership: CurrentMembership, row: sqlite3.Row | None) -> bool:
    """True when `row` is absent, in another company, or not visible to the
    caller — every one of which is answered with the same 404, so a document
    the caller may not see cannot be told apart from one that does not exist."""
    return row is None or row["company_id"] != membership.company_id or not _can_see(membership, row)


def _in_company_files(row: sqlite3.Row | dict) -> bool:
    """Whether a document belongs in the Company Files / Search / Calendar lists,
    the company's own view of its paperwork. Two kinds do not:

    - A company's business profile: a settings artifact, kept in Company Settings
      (round 16, DECISIONS #90). Decided by doc_type, the same test that already
      routes it to its own extraction shape (classify.is_company_profile_doc_type).
    - A personal file (visibility other than 'company'; round 19, DECISIONS #94):
      it lives in the uploader's "Only me" section (GET /api/personal-files) and
      nowhere else, not even for the person who uploaded it. Until the per-file lock
      toggle was removed a private file was listed inline for its uploader with a
      badge; now that a file is private only by being uploaded to Only me, mixing it
      into the company's views would blur exactly what the section makes structural.
      An unrecognised visibility value fails closed as personal (auth.may_see_document).

    It is a filter on what the LIST endpoints return, not on access: the file, the
    trace, the review queue and the by-id endpoints still reach a document under the
    normal rules (auth.may_see_document is unchanged)."""
    return not is_company_profile_doc_type(row["doc_type"]) and row["visibility"] == "company"


# One column list and one row->CompanyOut mapping for every endpoint that
# returns "the caller's company" (dev-login, /me, switch-company). It was
# written out twice by hand, and this round added three more columns to it.
_COMPANY_COLUMNS = "id, name, fye_month, fye_day, timezone, uen, gst_registered, registered_address"


def _company_out(row: sqlite3.Row) -> CompanyOut:
    return CompanyOut(
        id=row["id"], name=row["name"], fye_month=row["fye_month"], fye_day=row["fye_day"],
        timezone=row["timezone"], uen=row["uen"], gst_registered=bool(row["gst_registered"]),
        registered_address=row["registered_address"],
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/auth/dev-login")
def dev_login(body: DevLoginRequest) -> AuthResponse:
    if "@" not in body.email:
        raise HTTPException(400, "Not a valid email")

    with get_conn(DB_PATH) as conn:
        user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE email = ?", (body.email,)
        ).fetchone()
        if user is None:
            cur = conn.execute(
                "INSERT INTO app_user (email, name) VALUES (?, ?)", (body.email, body.name)
            )
            user_id = cur.lastrowid
        else:
            user_id = user["id"]

        if body.company_name:
            if body.fye_month is None or body.fye_day is None:
                raise HTTPException(400, "fye_month and fye_day are required to create a company")
            cur = conn.execute(
                "INSERT INTO company (name, fye_month, fye_day) VALUES (?, ?, ?)",
                (body.company_name, body.fye_month, body.fye_day),
            )
            company_id = cur.lastrowid
            conn.execute(
                "INSERT INTO membership (company_id, user_id, role) VALUES (?, ?, 'owner')",
                (company_id, user_id),
            )
            role = "owner"
        else:
            membership = conn.execute(
                "SELECT company_id, role FROM membership WHERE user_id = ? ORDER BY id LIMIT 1",
                (user_id,),
            ).fetchone()
            if membership is None:
                raise HTTPException(
                    400, "No company membership yet. Provide company_name to create one."
                )
            company_id, role = membership["company_id"], membership["role"]

        company = conn.execute(
            f"SELECT {_COMPANY_COLUMNS} FROM company WHERE id = ?", (company_id,)
        ).fetchone()
        final_user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE id = ?", (user_id,)
        ).fetchone()

    # The session starts scoped to the company this response describes. That
    # was always the first membership until round 12, so it only matters when a
    # user who already belongs to a company signs up a NEW one: the response
    # named the new company while every later request ran as the first one.
    token = issue_session(user_id, current_company_id=company_id)
    return AuthResponse(
        token=token,
        user=UserOut(id=final_user["id"], email=final_user["email"], name=final_user["name"]),
        company=_company_out(company),
        role=role,
    )


def _me_payload(membership: CurrentMembership) -> dict:
    """Who the caller is and which company (and role) this session is scoped
    to right now — shared by /me and switch-company, so a switch answers with
    exactly what the next /me would say."""
    with get_conn(DB_PATH) as conn:
        company = conn.execute(
            f"SELECT {_COMPANY_COLUMNS} FROM company WHERE id = ?", (membership.company_id,)
        ).fetchone()
    return {
        "user": {"id": membership.user_id, "email": membership.email, "name": membership.name},
        "company": _company_out(company).model_dump(),
        "role": membership.role,
    }


@app.get("/api/auth/me")
def auth_me(membership: Annotated[CurrentMembership, Depends(get_current_membership)]) -> dict:
    return _me_payload(membership)


@app.get("/api/auth/companies")
def auth_companies(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[MyCompanyOut]:
    """The companies the caller can switch between — their own memberships
    and nothing else (DECISIONS #77). One row for nearly everyone, in which
    case the frontend shows no switcher at all."""
    return [MyCompanyOut(**row) for row in list_memberships(membership.user_id)]


@app.post("/api/auth/switch-company")
def auth_switch_company(
    body: SwitchCompanyRequest,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
    authorization: Annotated[str, Header()],
) -> dict:
    """Scope this session to another company the caller belongs to. 403 for
    a company they are not a member of (auth.switch_company); the response is
    the same shape as /me, for the newly active company and the role held
    there. Server-side, per session — not a header the client re-sends — so
    every data endpoint keeps deriving its company from the session alone."""
    token = authorization.removeprefix("Bearer ").strip()
    role = switch_company(token, membership.user_id, body.company_id)
    return _me_payload(
        CurrentMembership(
            user_id=membership.user_id, email=membership.email, name=membership.name,
            company_id=body.company_id, role=role,
        )
    )


@app.post("/api/auth/logout")
def logout(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
    authorization: Annotated[str, Header()],
) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE session SET revoked_at = datetime('now') WHERE user_id = ? "
            "AND token_hash = ?",
            (membership.user_id, hash_token(token)),
        )
    return {"status": "logged_out"}


@app.get("/api/companies/{company_id}/members")
def list_members(
    company_id: int, membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[MemberOut]:
    if company_id != membership.company_id:
        raise HTTPException(403, "Not a member of this company")
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT u.id AS user_id, u.email, u.name, m.role FROM membership m "
            "JOIN app_user u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY m.id",
            (company_id,),
        ).fetchall()
        return [MemberOut(**dict(r)) for r in rows]


@app.post("/api/companies/{company_id}/members")
def add_member(
    company_id: int, body: AddMemberRequest,
    membership: Annotated[CurrentMembership, Depends(require_role("admin"))],
) -> MemberOut:
    if company_id != membership.company_id:
        raise HTTPException(403, "Not a member of this company")
    with get_conn(DB_PATH) as conn:
        if body.role == "owner":
            # One owner per company, many admins (DECISIONS.md #29,
            # resolved 2026-09-22) — a policy statement is not the same as
            # an enforced one; check it here rather than trust every caller
            # to know the rule.
            existing_owner = conn.execute(
                "SELECT id FROM membership WHERE company_id = ? AND role = 'owner'",
                (company_id,),
            ).fetchone()
            if existing_owner:
                raise HTTPException(409, "This company already has an owner")

        user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE email = ?", (body.email,)
        ).fetchone()
        if user is None:
            cur = conn.execute(
                "INSERT INTO app_user (email, name) VALUES (?, ?)", (body.email, body.name)
            )
            user_id, email, name = cur.lastrowid, body.email, body.name
        else:
            user_id, email, name = user["id"], user["email"], user["name"]

        existing = conn.execute(
            "SELECT id FROM membership WHERE company_id = ? AND user_id = ?",
            (company_id, user_id),
        ).fetchone()
        if existing:
            raise HTTPException(409, "Already a member of this company")
        conn.execute(
            "INSERT INTO membership (company_id, user_id, role) VALUES (?, ?, ?)",
            (company_id, user_id, body.role),
        )
    return MemberOut(user_id=user_id, email=email, name=name, role=body.role)


@app.patch("/api/companies/{company_id}")
def edit_company(
    company_id: int, body: CompanyEditRequest,
    membership: Annotated[CurrentMembership, Depends(require_role("owner"))],
) -> dict:
    """Company settings (2026-09-23, role/permission work) — the company
    row was previously write-once, set at signup (`dev_login` above) and
    never editable again. owner-only: the permission model's own framing
    is "owner also manages the company" (`docs/HANDOFF.md`'s Auth
    section), a rank above admin's "resolves reviews and adds members".
    Scoped to `CompanyEditRequest`'s three fields (see its own docstring
    for why not the company table's full column set)."""
    if company_id != membership.company_id:
        raise HTTPException(403, "Not a member of this company")

    updates: dict[str, object] = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.fye_month is not None:
        updates["fye_month"] = body.fye_month
    if body.fye_day is not None:
        updates["fye_day"] = body.fye_day
    if body.timezone is not None:
        # 2026-09-24: validated against zoneinfo's own IANA database here,
        # not just accepted as an arbitrary string — a bad value would
        # otherwise only surface later, as a ZoneInfoNotFoundError deep
        # inside derive_obligations.py's FYE math.
        try:
            ZoneInfo(body.timezone)
        except ZoneInfoNotFoundError:
            raise HTTPException(400, f"Unknown timezone: {body.timezone}") from None
        updates["timezone"] = body.timezone

    # 2026-09-24 (round 12, DECISIONS #79): identity fields an ACRA business
    # profile can pre-fill. A blank string clears the value (NULL), so the
    # form can un-set a UEN or address it no longer wants.
    if body.uen is not None:
        updates["uen"] = body.uen.strip().upper() or None
    if body.gst_registered is not None:
        updates["gst_registered"] = int(body.gst_registered)
    if body.registered_address is not None:
        updates["registered_address"] = body.registered_address.strip() or None

    if updates:
        set_clause = ", ".join(f"{col} = ?" for col in updates)
        with get_conn(DB_PATH) as conn:
            conn.execute(
                f"UPDATE company SET {set_clause} WHERE id = ?",
                (*updates.values(), company_id),
            )
    return {"status": "updated"}


# 2026-09-23 (DECISIONS #55): jaga-vision is a separate, isolated systemd
# service (deploy/jaga-vision.service, vision/app.py) — heavy ML deps
# (torch/transformers) stay fully out of this backend's own venv/process,
# per the box's 4GB RAM budget already measured (Salesforce/blip-image-
# captioning-base peaks ~2GB RSS while loaded). Never hardcoded: config
# rule (CLAUDE.md's "Standing architecture rule") requires every endpoint
# come from env, even a same-box, localhost-only one.
CAPTION_SERVICE_URL = os.environ.get("JAGA_VISION_URL", "http://127.0.0.1:8100/caption")
# ~20s model load + up to ~2s inference, measured — generous headroom
# above that, not a tight budget racing the real number.
CAPTION_TIMEOUT_SECONDS = 40.0


def _caption_document_background(document_id: int, stored_path: str) -> None:
    """Runs strictly after the upload response is already sent (FastAPI
    BackgroundTasks, scheduled from upload_document below) — the ~20s
    model-load budget must never block the upload request itself. Fire-
    and-forget: on any failure (service down, timeout, corrupt image),
    document.description simply stays in its existing NULL "pending
    caption" state (DECISIONS #52) — the voice-caption UI already covers
    that gracefully, so no new error surface is needed here. Only fills
    description if it's STILL NULL by the time this finishes (`AND
    description IS NULL`), so a human who already typed or spoke a
    caption in the meantime is never overwritten by a slower, now-stale
    background result — a caption from this local model is a proposal,
    same as everything else an automated node in this pipeline ever
    writes, not a locked-in value."""
    try:
        resp = httpx.post(CAPTION_SERVICE_URL, json={"path": stored_path}, timeout=CAPTION_TIMEOUT_SECONDS)
        resp.raise_for_status()
        caption = resp.json()["caption"]
    except Exception as e:  # noqa: BLE001 - fire-and-forget by design, see docstring
        print(f"jaga-vision captioning failed for document {document_id}: {e}")
        return

    # 2026-09-24 (items 5/6): document.description is JSON-encoded now —
    # jaga-vision's BLIP model is English-only (no language selection to
    # honor here the way classify.py's real LLM call does), so this is
    # always just {"en": caption}, same "en" as the guaranteed-fallback
    # key every other write path uses.
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE document SET description = ? WHERE id = ? AND description IS NULL",
            (json.dumps({"en": caption}), document_id),
        )
    reindex_document_search(document_id, DB_PATH)


def _process_upload(
    membership: CurrentMembership, background_tasks: BackgroundTasks, tmp_path: str, filename: str,
    source_channel: str, is_picture: bool, language: str, visibility: str,
    doc_type_hint: str | None = None, name: str = "", caption: str | None = None,
) -> dict:
    """Run one already-written temp file through ingest and the pipeline and
    build the upload response. A PERSONAL file (visibility other than 'company') does not take the pipeline at all: it is
    stored, named by its owner (`name`, `caption`) and filed on the spot (round 21, A3, DECISIONS #101). Shared by the single-file upload and the
    multi-page upload below (2026-09-24, round 12, DECISIONS #78), so a merged
    scan takes exactly the path any other document takes. Does not delete
    tmp_path — the caller owns its lifetime (see the try/finally in each)."""
    ingest_state = ingest(
        company_id=membership.company_id, source_path=tmp_path, filename=filename,
        source_channel=source_channel, uploaded_by_user_id=membership.user_id,
        visibility=visibility, read_content=visibility == "company",
    )
    if ingest_state.get("text_source") == "duplicate":
        # The duplicate check is on the file's hash across the whole database,
        # so the match can be a document this caller may not see (a colleague's
        # pending upload, someone's personal file, another company's). Say
        # "already uploaded" — the person has the identical bytes — but never
        # hand back the id of a document they cannot see (round 13).
        with get_conn(DB_PATH) as conn:
            existing = conn.execute(
                "SELECT company_id, status, uploaded_by_user_id, visibility FROM document WHERE id = ?",
                (ingest_state["document_id"],),
            ).fetchone()
        seen = not _hidden_or_missing(membership, existing)
        return {"document_id": ingest_state["document_id"] if seen else None, "status": "duplicate"}

    if visibility != "company":
        return _file_personal_upload(membership, ingest_state["document_id"], filename, name, caption)

    # 2026-09-23 (DECISIONS #52): the upload-time "is this a picture?"
    # toggle (web/src/features/ops/OpsConsole.tsx) — set on the state dict
    # here rather than threading a new param through ingest() itself,
    # since ingest.py's EXIF/text extraction is unaffected by lane and
    # already runs before this regardless (app/graph/ingest.py). Read by
    # app/graph/classify.py to skip its LLM call entirely.
    ingest_state["is_picture"] = is_picture
    ingest_state["language"] = language
    ingest_state["visibility"] = visibility
    # Round 16 (DECISIONS #90): only a real checklist slug is carried; anything
    # else is dropped here, so the pipeline never holds client-chosen text.
    if doc_type_hint in LABEL_BY_DOC_TYPE:
        ingest_state["doc_type_hint"] = doc_type_hint

    thread_id = ingest_state["run_id"]
    result = PIPELINE.invoke(ingest_state, config={"configurable": {"thread_id": thread_id}})
    document_id = ingest_state["document_id"]

    # Confirmed live 2026-09-21: langgraph 0.2.60's invoke() does NOT return
    # a "__interrupt__" key the way earlier code here assumed — it just
    # stops early with a partial state dict (no downstream keys like
    # "events"). The pause itself is real (derive_events/obligations never
    # ran), but detecting it from here needs a signal that doesn't depend on
    # LangGraph's exact return shape. document.status, written unconditionally
    # inside verify.py, is that signal.
    with get_conn(DB_PATH) as conn:
        doc_status = conn.execute(
            "SELECT status FROM document WHERE id = ?", (document_id,)
        ).fetchone()["status"]

    if doc_status == "quarantined":
        return {"document_id": document_id, "status": "quarantined",
                "verify": result.get("verify_result")}

    # 2026-09-23 (DECISIONS #55): kick off local-model captioning for a
    # picture-lane upload — scheduled, not awaited, so this request
    # returns before the caption call is even guaranteed to have started,
    # let alone the ~20s+ it can take. Only for is_picture uploads: that's
    # the only path that leaves description NULL (DECISIONS #52); a
    # quarantined document (returned above already) never reaches here.
    if is_picture:
        with get_conn(DB_PATH) as conn:
            stored_path = conn.execute(
                "SELECT stored_path FROM document WHERE id = ?", (document_id,)
            ).fetchone()["stored_path"]
        # Caught live while verifying locally, not assumed: app/graph/
        # ingest.py's DOCS_PATH is a relative path ("./data/docs"), stored
        # in the DB as-is — meaningless to jaga-vision, a separate process
        # with its own working directory. Resolved to absolute here, in
        # the one process that actually knows its own correct base
        # directory, rather than relying on jaga-vision's systemd unit
        # happening to share jaga-api's WorkingDirectory.
        absolute_path = str(Path(stored_path).resolve())
        background_tasks.add_task(_caption_document_background, document_id, absolute_path)

    # 2026-09-22 (DECISIONS #40): no document is ever filed without an
    # explicit human confirmation — verify.py now always sets needs_review,
    # so doc_status here is only ever "quarantined" (above) or
    # "needs_review". There is no third, auto-filed "processed" case left
    # to return; a branch for one would be dead code.
    with get_conn(DB_PATH) as conn:
        review_item = conn.execute(
            "SELECT id, reason, question FROM review_item WHERE document_id = ? "
            "AND status = 'open' ORDER BY id DESC LIMIT 1",
            (document_id,),
        ).fetchone()
    return {
        "document_id": document_id,
        "status": "needs_review",
        "thread_id": thread_id,
        "review_item_id": review_item["id"] if review_item else None,
        # reason (added 2026-09-22, DECISIONS #47) lets the upload banner
        # apply the same routine-vs-flagged distinction ReviewQueueCard
        # already makes ('clean extraction' — verify.py — vs a real
        # reason) instead of showing an amber NEEDS_REVIEW pill for every
        # upload, clean ones included.
        "review": {"reason": review_item["reason"], "question": review_item["question"]} if review_item else None,
    }


def _clean_personal_details(name: str | None, caption: str | None) -> tuple[str, str | None]:
    """What a person typed for a file going into Only me (round 21, A3, DECISIONS #101): the name with its whitespace collapsed
    (blank if none was given, the caller then keeps the file's own name) and the caption trimmed (None if empty). Over the
    limits it is a 422 naming which one, before anything is stored, and never silently cut short."""
    clean_name = " ".join((name or "").split())
    clean_caption = (caption or "").strip()
    if len(clean_name) > MAX_NAME_CHARS:
        raise HTTPException(422, detail={
            "code": "name_too_long", "limit": MAX_NAME_CHARS,
            "message": f"A file's name can be at most {MAX_NAME_CHARS} characters.",
        })
    if len(clean_caption) > MAX_CAPTION_CHARS:
        raise HTTPException(422, detail={
            "code": "caption_too_long", "limit": MAX_CAPTION_CHARS,
            "message": f"A caption can be at most {MAX_CAPTION_CHARS} characters.",
        })
    return clean_name, clean_caption or None


def _file_personal_upload(
    membership: CurrentMembership, document_id: int, original_name: str, name: str, caption: str | None,
) -> dict:
    """The whole "pipeline" of a personal file (round 21, A3, DECISIONS #101). It is already stored (ingest, no content read).
    Give it the name and caption its owner typed (their own words replace anything a model would have written: a personal
    photo gets no AI caption, by decision), then file it through the one rule that allows that without review
    (rules.transitions.file_personal_document, personal files only). No classify, no extract, no verify, no review item, no
    model call, no captioning. Company documents never reach this function: _process_upload sends only non-company ones."""
    description = json.dumps({"en": caption}) if caption else None
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE document SET filename = ?, description = ? WHERE id = ?", (name or original_name, description, document_id),
        )
    file_personal_document(document_id, actor=membership.email, db_path=DB_PATH)
    reindex_document_search(document_id, DB_PATH)
    return {"document_id": document_id, "status": "filed"}


def _refuse_a_full_personal_space(membership: CurrentMembership, visibility: str, sha256: str | None) -> None:
    """The per-person cap on private files (app/limits.py): a 409 when this person already holds
    MAX_PERSONAL_FILES in this company. Company uploads are never limited by it. A file the database already
    holds (its hash is unique) is left to ingest to report as a duplicate rather than refused here, since it
    would not become a new file."""
    if visibility == "company":
        return
    with get_conn(DB_PATH) as conn:
        if sha256 is not None and conn.execute("SELECT 1 FROM document WHERE sha256 = ?", (sha256,)).fetchone():
            return
        used = personal_file_count(conn, membership.company_id, membership.user_id)
    if used >= MAX_PERSONAL_FILES:
        raise HTTPException(409, detail=personal_file_limit_detail())


def _read_within_the_file_limit(data: bytes) -> bytes:
    """One uploaded file's bytes, or a 413 if it is over MAX_FILE_BYTES (the body middleware bounds the whole
    request; this is the exact per-file answer, and the only one that catches a file that fits the body bound)."""
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, detail=file_too_large_detail())
    return data


@app.post("/api/documents")
async def upload_document(
    membership: Annotated[CurrentMembership, Depends(require_role("user"))],
    background_tasks: BackgroundTasks,
    file: UploadFile, source_channel: str = "web", is_picture: bool = False,
    # 2026-09-24 (item 5): the uploader's currently-selected UI language
    # (web/src/i18n.ts) — same shape as is_picture above, a plain query
    # param read by app/graph/classify.py to write its generated
    # description directly in this language instead of always English.
    language: str = "en",
    # 2026-09-24 (round 13, DECISIONS #85): "company" (default — every existing
    # caller) or "only_me", a personal file only the uploader can ever see.
    # A Literal, so anything else is a 422, not a silently company-visible file.
    # Round 19 (DECISIONS #94/#95): the web UI's Only me section sends "only_me"
    # for every upload; that is the ONLY way a file becomes personal now, since
    # the lock toggle and PATCH visibility that could convert an existing file
    # are gone.
    visibility: Visibility = "company",
    # Round 16 (DECISIONS #90): the doc_type slug of the compliance checklist
    # item this upload was started from. Ignored unless it is a real slug
    # (rules/expectations.LABEL_BY_DOC_TYPE); it only adds a hint to classify's
    # prompt and never decides the classification.
    doc_type_hint: str | None = None,
    # Round 21 (A3, DECISIONS #101): what the person typed when putting a file into Only me. Used ONLY for a personal file
    # (visibility=only_me), whose name and caption they are; ignored for a company document, which is named in review.
    name: str | None = None,
    caption: str | None = None,
) -> dict:
    personal_name, personal_caption = _clean_personal_details(name, caption) if visibility != "company" else ("", None)
    data = _read_within_the_file_limit(await file.read())
    _refuse_a_full_personal_space(membership, visibility, hashlib.sha256(data).hexdigest())
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    # 2026-09-23 (live regression report, item 11): tmp_path was never
    # removed after this — confirmed live on the Lightsail box, 32 orphaned
    # temp files against 31 documents, a near-exact 1:1 leak on every
    # upload, not a selective one. Safe to delete unconditionally once
    # ingest() returns: app/graph/ingest.py's own shutil.copyfile already
    # wrote the permanent copy into DOCS_PATH before returning, and every
    # downstream node (classify/extract/verify, the captioning background
    # task) reads either the already-extracted `text` or the document's own
    # `stored_path` from the DB — never tmp_path again. try/finally, not just
    # a line after the pipeline call, so this also cleans up on an exception
    # (a bad file, a pipeline error) instead of only on the success path.
    try:
        return _process_upload(
            membership, background_tasks, tmp_path, file.filename, source_channel, is_picture, language,
            visibility, doc_type_hint, personal_name, personal_caption,
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/api/documents/pages")
async def upload_document_pages(
    membership: Annotated[CurrentMembership, Depends(require_role("user"))],
    background_tasks: BackgroundTasks,
    files: list[UploadFile], language: str = "en", visibility: Visibility = "company",
    doc_type_hint: str | None = None, name: str | None = None, caption: str | None = None,
) -> dict:
    """Several photos of one document, in page order -> ONE document
    (2026-09-24, round 12, DECISIONS #78). The pages are merged into a single
    image-only PDF (app/extract/merge.py) and handed to the same ingest and
    pipeline as any other upload: one document row, one review item, and the
    scanned-PDF OCR path reading every page — there is no second extraction
    route for multi-page.

    The order of `files` IS the page order. At least 2 pages (one file is the
    ordinary upload) and at most ocr.MAX_PDF_OCR_PAGES, the cap the OCR step
    already applies: past it the extra pages would be silently dropped, so a
    longer set is refused instead. A page that is not a readable image is a
    400 naming the page, not a 500. Each page is bounded by MAX_FILE_BYTES and the
    whole request by app/limits.py's body bound (round 20); the web client also
    downscales each photo before sending."""
    if len(files) < 2:
        raise HTTPException(400, "Send at least 2 pages. A single file is an ordinary upload.")
    if len(files) > MAX_PDF_OCR_PAGES:
        raise HTTPException(400, f"At most {MAX_PDF_OCR_PAGES} pages per document, got {len(files)}")
    personal_name, personal_caption = _clean_personal_details(name, caption) if visibility != "company" else ("", None)
    # One document, however many pages: it counts as one private file. The merged file's hash is not
    # known yet, so a duplicate set of pages at the cap is told "full" rather than "duplicate".
    _refuse_a_full_personal_space(membership, visibility, None)

    temp_paths: list[str] = []
    try:
        for upload in files:
            with tempfile.NamedTemporaryFile(delete=False, suffix=Path(upload.filename or "").suffix) as tmp:
                tmp.write(_read_within_the_file_limit(await upload.read()))
                temp_paths.append(tmp.name)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as merged:
            temp_paths.append(merged.name)
        try:
            merge_images_to_pdf(temp_paths[:-1], merged.name)
        except PageImageError as e:
            raise HTTPException(400, f"Page {e.page} is not a readable image") from None
        stem = Path(files[0].filename or "scan").stem
        return _process_upload(
            membership, background_tasks, merged.name, f"{stem}-{len(files)}-pages.pdf", "web", False, language,
            visibility, doc_type_hint, personal_name, personal_caption,
        )
    finally:
        for path in temp_paths:
            Path(path).unlink(missing_ok=True)



@app.post("/api/review/{review_item_id}/resolve")
def resolve_review(
    review_item_id: int, thread_id: str, body: ReviewResolution,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    # All the actual state changes (review_item, extraction rows, document
    # status) happen inside app/graph/human_review.py on resume, not here —
    # that keeps "what does resolving mean" in one place instead of split
    # between this endpoint and the graph node.
    #
    # Admin+ (2026-09-23, role/permission work), with ONE narrow exception
    # added in round 13 (DECISIONS #85): the uploader of a PERSONAL file
    # (visibility 'only_me') may resolve its review item — nobody else can
    # even see it, so without this a `user`'s private upload could never leave
    # review. Otherwise NOT extended to let a `user` resolve review items on
    # their own uploads,
    # even though "edit your own upload" now is (see edit_document above).
    # Considered and rejected: resolving is the human-in-the-loop safety
    # check this whole review queue exists for (DECISIONS #40 — every
    # upload needs review, no auto-file, even a clean one), specifically
    # including the GST-arithmetic and hallucination-guard flags
    # (DECISIONS #33, #48) that were added *because* trusting the model's
    # or the uploader's own self-report alone was already proven unsafe on
    # this exact codebase. Letting the uploader also be the one who clears
    # their own flagged upload would remove the second pair of eyes that's
    # the actual point — so this stays a real oversight action (the same
    # tier as add_member), not a routine self-service one.
    is_admin = ROLE_ORDER[membership.role] >= ROLE_ORDER["admin"]
    with get_conn(DB_PATH) as conn:
        item = conn.execute(
            "SELECT r.id, r.company_id, r.document_id, d.status AS status, "
            "       d.uploaded_by_user_id AS uploaded_by_user_id, d.visibility AS visibility, "
            "       substr(d.sha256, 1, 12) AS thread_id "
            "FROM review_item r JOIN document d ON d.id = r.document_id "
            "WHERE r.id = ? AND r.status = 'open'",
            (review_item_id,),
        ).fetchone()
    may_act = (
        item is not None
        and item["company_id"] == membership.company_id
        and may_resolve_review_item(
            membership, uploaded_by_user_id=item["uploaded_by_user_id"], visibility=item["visibility"],
        )
    )
    if not may_act and not is_admin:
        # Below admin and not the uploader of their own personal file: the
        # role gate, with the same answer it always gave (this used to be a
        # require_role("admin") dependency that ran before any lookup).
        raise HTTPException(403, f"Requires role 'admin' or higher, caller is '{membership.role}'")
    if item is None:
        raise HTTPException(404, "review item not found or already resolved")
    if item["company_id"] != membership.company_id:
        raise HTTPException(403, "Not a member of this company")
    if not _can_see(membership, item):
        # A pending document, or a personal file, this caller may not see: the
        # same 404 as a review item that does not exist.
        raise HTTPException(404, "review item not found or already resolved")

    if item["status"] == "quarantined":
        # 2026-09-23 (DECISIONS #68): a quarantined document's pipeline run
        # never reaches human_review's interrupt() — verify() returns
        # early, before ever pausing (see verify.py's injection_hits
        # branch). Confirmed LIVE this is NOT the same as a genuinely
        # missing checkpoint (the InvalidUpdateError/410 case below,
        # itself confirmed live against a real restarted server —
        # DECISIONS #67): LangGraph still checkpoints after verify() runs,
        # it's just a checkpoint reflecting an already-completed run with
        # nothing pending — resuming it succeeds as a silent no-op (200,
        # no error, document status and review_item both left untouched)
        # rather than raising, so the 410 fallback this endpoint otherwise
        # relies on never actually fires for this case — confirmed by
        # reproducing it against the live server, not assumed from the
        # first read. Handled directly here instead: the same effect as
        # POST /api/documents/{id}/archive (transition to archived,
        # dismiss the open review_item), reached from this endpoint
        # because that's what the UI already calls for this card
        # (ReviewQueueCard.tsx hides Accept, offers only Reject/Delete).
        try:
            transition_document(item["document_id"], "archived", actor=membership.email, db_path=DB_PATH)
        except InvalidTransition:
            pass  # already archived by a concurrent/earlier request — resolving again is a no-op success
        with get_conn(DB_PATH) as conn:
            conn.execute(
                "UPDATE review_item SET status = 'dismissed' WHERE id = ?",
                (review_item_id,),
            )
        if item["visibility"] != "company":
            _purge_a_rejected_private_file(item["document_id"], membership.email)
        return {"status": "archived", "events": None, "obligations_created": None}

    # thread_id is client-supplied and is what actually gets resumed, so it must
    # be THIS item's thread — otherwise anyone allowed to resolve one item
    # could resume another document's paused run by naming its thread. Newly
    # necessary in round 13, when the set of people who may resolve widened
    # (an uploader, for their own personal file). The hash prefix is not a
    # secret an outsider can guess (48 bits) but it is derivable from a file
    # they hold, and the check costs one comparison.
    if thread_id != item["thread_id"]:
        raise HTTPException(400, "thread_id does not belong to this review item")
    try:
        result = PIPELINE.invoke(
            Command(resume=body.model_dump()),
            config={"configurable": {"thread_id": thread_id}},
        )
    except InvalidUpdateError:
        # The checkpointer is in-memory (MemorySaver, docs/HANDOFF.md's known
        # limitation) — confirmed live 2026-09-22: after any server restart,
        # a review item created before it has no pending checkpoint left to
        # resume, and LangGraph raises this rather than silently doing
        # nothing. Fail clearly instead of a raw 500; the fix on the user's
        # side is the same either way — re-upload the document.
        raise HTTPException(
            410,
            "This review session has expired (the backend restarted since this "
            "document was uploaded, so the in-memory checkpoint is gone). "
            "Re-upload the document to get a fresh, resolvable review item.",
        ) from None
    with get_conn(DB_PATH) as conn:
        doc_status = conn.execute(
            "SELECT status FROM document WHERE id = (SELECT document_id FROM review_item WHERE id = ?)",
            (review_item_id,),
        ).fetchone()

    final_status = doc_status["status"] if doc_status else "resumed"
    if final_status == "archived" and item["visibility"] != "company":
        # A reject chains through to archived (human_review.py). For a private file that would leave a soft-deleted
        # row nobody can see and that still counts toward the 15-file cap, so it is deleted for good instead.
        _purge_a_rejected_private_file(item["document_id"], membership.email)

    return {
        "status": final_status,
        "events": result.get("events"),
        # 0, not None: the pipeline creates no obligations while derive_obligations is switched off (DECISIONS #108).
        "obligations_created": result.get("obligations_created", 0),
    }


@app.get("/api/review")
def list_review_items(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT r.*, d.filename AS document_filename, d.media_type AS document_media_type, "
            "d.description AS document_description, d.bucket AS document_bucket, "
            "d.doc_type AS document_doc_type, d.vendor_name AS document_vendor_name, "
            "d.lane AS document_lane, d.uploaded_by_user_id AS uploaded_by_user_id, "
            "d.status AS document_status, d.visibility AS document_visibility, "
            # thread_id == run_id, generated in app/graph/ingest.py as
            # sha256[:12] — not its own column, derived the same way here
            # rather than adding one for a value that never changes.
            " substr(d.sha256, 1, 12) AS thread_id "
            "FROM review_item r JOIN document d ON d.id = r.document_id "
            "WHERE r.company_id = ? AND r.status = 'open' ORDER BY r.id DESC",
            (membership.company_id,),
        ).fetchall()
        # 2026-09-22: so the review card can show (and edit) the same
        # description/bucket/vendor_name a human can edit from the
        # Documents tab, without a second round trip per card. lane is
        # read-only here (not part of DocumentEditRequest) - it's what
        # decides whether doc_type renders as the fixed dropdown or the
        # statutory lane's free-text input, not itself editable.
        #
        # 2026-09-24 (round 12): who sees which item is auth.may_see_review_item's
        # call (admin/owner all, a user only their own uploads, a viewer none),
        # applied here in one place; the uploader's id is the input to that
        # rule, not something the client needs, so it is dropped from the row.
        #
        # Round 13 (DECISIONS #85): a personal file's item is the uploader's
        # alone — even an admin or the owner does not see it — so the queue
        # asks may_see_document as well as the review-item rule. `can_resolve`
        # is this caller's own answer (auth.may_resolve_review_item), so the
        # card offers Accept/Reject exactly where the server would allow them.
        visible = []
        for r in rows:
            item = dict(r)
            uploader = item.pop("uploaded_by_user_id")
            document_status = item.pop("document_status")
            if not may_see_review_item(membership, uploader):
                continue
            if not may_see_document(
                membership, status=document_status, uploaded_by_user_id=uploader,
                visibility=item["document_visibility"],
            ):
                continue
            item["can_resolve"] = may_resolve_review_item(
                membership, uploaded_by_user_id=uploader, visibility=item["document_visibility"],
            )
            visible.append(item)
        return visible


@app.get("/api/expectations")
def list_expectations(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    """The gap analysis (the web app's "compliance checklist"). INDEXING.md §0 —
    dashed lines on the timeline.

    Round 16 (DECISIONS #90): each row carries `evidence_document_id`, the document
    that satisfied it. It is sent only when this caller may see that document (the
    same rule as every list, auth.may_see_document) and it is not archived —
    otherwise null, so the checklist never reveals a pending colleague's upload or
    links to a deleted file. The status itself is unchanged."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT e.*, d.status AS ev_status, d.uploaded_by_user_id AS ev_uploader, "
            "d.visibility AS ev_visibility FROM expectation e "
            "LEFT JOIN document d ON d.id = e.evidence_document_id "
            "WHERE e.company_id = ? ORDER BY e.status, e.due_on",
            (membership.company_id,),
        ).fetchall()
    out = []
    for row in rows:
        expectation = {key: row[key] for key in row.keys() if not key.startswith("ev_")}
        visible = row["ev_status"] is not None and row["ev_status"] != "archived" and may_see_document(
            membership, status=row["ev_status"], uploaded_by_user_id=row["ev_uploader"],
            visibility=row["ev_visibility"],
        )
        if not visible:
            expectation["evidence_document_id"] = None
        out.append(expectation)
    return out


@app.get("/api/obligations")
def list_obligations(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM obligation WHERE company_id = ? ORDER BY due_on",
            (membership.company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def _document_row_for(membership: CurrentMembership, row: sqlite3.Row) -> dict:
    """A document as list/search return it: the row minus the uploader's
    user id (the client never needs it), plus `can_edit` — the caller's own
    answer from auth.may_edit_document, so the UI does not offer an Edit
    that the server would refuse. (It used to carry `can_prefill_company` too;
    a business profile is no longer listed at all, round 16, DECISIONS #90, so
    the flag had nothing left to describe. The rule itself still gates
    GET /api/business-profile and the company-profile endpoint.)"""
    doc = dict(row)
    uploader = doc.pop("uploaded_by_user_id")
    doc["can_edit"] = may_edit_document(membership, uploader)
    requested = doc.pop("purge_requested_at", None)  # internal: the row keeps the same shape for everyone
    if doc.get("status") == "archived" and requested:
        # Only the owner is ever sent an archived row (_LIVE_OR_PURGE_REQUESTED): it is one they asked to have purged,
        # shown as such and read-only until the team removes it (round 21, DECISIONS #102).
        doc["status"] = "purge_requested"
        doc["can_edit"] = False
    return doc


# The one exception to "an archived document is invisible" (round 21, DECISIONS #102): a WHERE fragment that lets a row
# through when it is live, or when it is archived with a purge request AND the caller is the owner (auth.
# may_see_purge_requested). Its single `?` is 1 or 0; pass `_owner_flag(membership)`. Used by the four places the owner
# reads a document by list, search, file and thumbnail; every other `status != 'archived'` filter is unchanged.
_LIVE_OR_PURGE_REQUESTED = "(status != 'archived' OR (? = 1 AND purge_requested_at IS NOT NULL))"


def _owner_flag(membership: CurrentMembership) -> int:
    return 1 if may_see_purge_requested(membership) else 0


@app.get("/api/documents")
def list_documents(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    """No role floor beyond an authenticated member — deliberately open to
    viewer too, so the `!= 'archived'` exclusion below is the only thing
    keeping archived documents out of the app entirely (2026-09-23,
    DECISIONS #53). Unconditional, no parameter, no role exception: an
    archived document is recoverable only via direct DB access on the
    Lightsail box, never through this API, for any role including owner.

    Since round 13 a second kind of invisibility sits beside it
    (auth.may_see_document): a document pending review is hidden from the
    users the review queue hides it from, and a personal file from everyone
    but its uploader."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, media_type, lane, doc_type, status, received_at, "
            "description, bucket, vendor_name, occurred_on, uploaded_by_user_id, visibility, purge_requested_at "
            f"FROM document WHERE company_id = ? AND {_LIVE_OR_PURGE_REQUESTED} "
            "ORDER BY received_at DESC",
            (membership.company_id, _owner_flag(membership)),
        ).fetchall()
        # Round 13 (DECISIONS #83/#85): a document this caller may not see —
        # pending review and not theirs to see, or someone else's personal
        # file — is left out exactly the way an archived one is, so it is
        # absent from Company Files, from Search and from the Calendar (which
        # reads this same list), not merely hidden by the UI.
        return [_document_row_for(membership, r) for r in rows if _can_see(membership, r) and _in_company_files(r)]


@app.get("/api/personal-files")
def list_personal_files(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    """The caller's OWN personal files, for the "Only me" section (round 19,
    DECISIONS #94). Same row shape as GET /api/documents, so the frontend renders
    both with one component.

    Any authenticated member may call it, because it can only ever return what
    that caller uploaded to their own private space: the rule is
    auth.may_see_document (a personal file is its uploader's alone, no role and no
    exception), applied to every row, and a personal file is never in the company
    lists. Archived rows are left out like everywhere else. A caller with no
    personal files gets an empty list, and no other role or member can see these."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, media_type, lane, doc_type, status, received_at, "
            "description, bucket, vendor_name, occurred_on, uploaded_by_user_id, visibility "
            "FROM document WHERE company_id = ? AND uploaded_by_user_id = ? AND visibility != 'company' "
            "AND status != 'archived' ORDER BY received_at DESC, id DESC",
            (membership.company_id, membership.user_id),
        ).fetchall()
        return [_document_row_for(membership, r) for r in rows if _can_see(membership, r)]


@app.get("/api/limits")
def get_limits(membership: Annotated[CurrentMembership, Depends(get_current_membership)]) -> dict:
    """The upload limits and how much of the private-file one this caller has used (round 20, item 6,
    DECISIONS #99), so the page says what the rule says. `personal_files_used` is a number about the caller's
    own private files in their current company: it names no file."""
    with get_conn(DB_PATH) as conn:
        used = personal_file_count(conn, membership.company_id, membership.user_id)
    return {"max_file_bytes": MAX_FILE_BYTES, "max_personal_files": MAX_PERSONAL_FILES, "personal_files_used": used}


@app.get("/api/search/terms")
def search_terms(membership: Annotated[CurrentMembership, Depends(get_current_membership)]) -> list[dict]:
    """The most telling words across the caller's company's documents, for the word cloud on Search (round 21, A8,
    DECISIONS #101): about 40 `{term, count}`, count being how many documents contain the word (app/wordcloud.py says how
    words are chosen and what is left out). Read-only: nothing is written, no schema, no index.

    Who sees which text is the rule everything else already uses, not a new one: THIS company only (`company_id` comes from
    the session), company documents only (a personal file's text never enters, whoever asks), only documents this caller
    may see (auth.may_see_document: a colleague's upload still waiting for review stays out), never a business profile,
    and never an archived, quarantined or rejected document. So no company sees another's words, and no caller sees a word
    that only a document they cannot open contains. The newest MAX_DOCUMENTS_SCANNED documents are read."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT status, uploaded_by_user_id, visibility, doc_type, extracted_text FROM document "
            "WHERE company_id = ? AND visibility = 'company' AND status NOT IN ('archived', 'quarantined', 'rejected') "
            "AND extracted_text IS NOT NULL AND extracted_text != '' ORDER BY id DESC LIMIT ?",
            (membership.company_id, MAX_DOCUMENTS_SCANNED),
        ).fetchall()
    return top_terms(row["extracted_text"] for row in rows if _can_see(membership, row) and _in_company_files(row))


@app.get("/api/search")
def search_documents(
    q: str,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    """Real full-text search (ARCHITECTURE.md's original "SQLite FTS5"
    plan, first implementation 2026-09-22) over document_search
    (app/db.py) — filename, doc_type, description, extracted_text, bucket,
    and vendor_name (so a search for a vendor's name or a bucket's name
    works as free text too). Structured bucket/doc_type filtering itself
    is client-side over the already-fetched list (see OpsConsole.tsx) —
    this endpoint's job is free text. Tenant-scoped via document_search's
    own UNINDEXED company_id column, filtered in the same MATCH query — a
    company's session can never see another company's match. Empty/missing
    q returns an empty list, never the whole company's documents."""
    query = build_fts5_query(q)
    if not query:
        return []
    with get_conn(DB_PATH) as conn:
        matches = conn.execute(
            "SELECT rowid FROM document_search WHERE document_search MATCH ? "
            "AND company_id = ? ORDER BY rank",
            (query, membership.company_id),
        ).fetchall()
        ordered_ids = [r["rowid"] for r in matches]
        if not ordered_ids:
            return []
        placeholders = ",".join("?" * len(ordered_ids))
        # Same shape as list_documents's rows so the frontend can render
        # both with one type/component, no special-casing search results.
        # `status != 'archived'` (2026-09-23, DECISIONS #53): document_search
        # has no status column of its own, so an archived document's FTS5
        # row still matches on text — this join-back is where it actually
        # gets excluded from what the caller ever sees, same as
        # list_documents's exclusion just below it in this file.
        docs = conn.execute(
            f"SELECT id, filename, media_type, lane, doc_type, status, received_at, "
            f"description, bucket, vendor_name, occurred_on, uploaded_by_user_id, visibility, purge_requested_at FROM document "
            f"WHERE id IN ({placeholders}) AND {_LIVE_OR_PURGE_REQUESTED}",
            [*ordered_ids, _owner_flag(membership)],
        ).fetchall()
        # Same visibility rule as list_documents (round 13): the FTS5 row has
        # no status or visibility of its own, so a hidden document still
        # MATCHES on its text — this join-back is where it stops being
        # returned, which is the same place archived documents are dropped.
        docs_by_id = {
            d["id"]: _document_row_for(membership, d) for d in docs if _can_see(membership, d) and _in_company_files(d)
        }
    # FTS5's rank order (relevance), not the IN-clause's arbitrary order.
    return [docs_by_id[doc_id] for doc_id in ordered_ids if doc_id in docs_by_id]


@app.patch("/api/documents/{document_id}")
def edit_document(
    document_id: int, body: DocumentEditRequest,
    membership: Annotated[CurrentMembership, Depends(require_role("user"))],
) -> dict:
    """Edit description/bucket/vendor_name/doc_type/filename — only the
    fields sent are changed. user+ (same bar as uploading — this is routine
    organizational work, not an admin-level action like archiving or
    resolving a review). `filename` (added 2026-09-22) is display-only:
    `stored_path`/`sha256`, the actual file on disk, are never touched —
    a phone upload named `17900624351088935047221818361392.jpg` can be
    renamed to something a human recognizes without re-uploading.

    `is_picture=True` (added 2026-09-23, DECISIONS #52) is the same
    "picture, not a document" call as the upload-time toggle, made
    available after the fact — sets lane/doc_type/bucket the same
    deterministic way app/graph/classify.py's bypass does, overriding any
    doc_type/bucket also sent in the same request (this call wins because
    correcting *to* a picture is the one direction this field supports;
    see its docstring on DocumentEditRequest for why the reverse isn't
    handled). Only True does anything — False/omitted is a no-op; there is
    no reclassification path back out of the memory lane here.

    **Ownership check added 2026-09-23** (role/permission work):
    `uploaded_by_user_id` already existed in the schema but was never read
    here, so any `user`-role account could edit any document in the
    company — confirmed live before this change. A `user` (not admin+) may
    now only edit a document they themselves uploaded; admin/owner are
    unaffected (unchanged from the "same bar as uploading" rule above,
    just scoped to admin+ for cross-uploader edits). A document with no
    recorded uploader (`uploaded_by_user_id IS NULL` — direct-SQL test
    fixtures, or any future non-web ingestion path) is deliberately *not*
    treated as unownable-by-everyone: there is no real uploader to protect
    it from, so a `user` account may edit it same as before this change."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, status, uploaded_by_user_id, visibility FROM document WHERE id = ?",
            (document_id,),
        ).fetchone()
    # 404 before the ownership 403 below: a document the caller may not see
    # (round 13) must not be confirmed to exist by a "you can't edit this".
    if _hidden_or_missing(membership, doc):
        raise HTTPException(404, "document not found")
    if not may_edit_document(membership, doc["uploaded_by_user_id"]):
        raise HTTPException(403, "You can only edit documents you uploaded yourself")

    updates: dict[str, object] = {}
    personal = doc["visibility"] != "company"
    if personal and body.description is not None:
        # A personal file's caption is the owner's own words, not a translatable description (round 21, A3, DECISIONS
        # #101): it REPLACES whatever was there, in every language, instead of being merged in under the viewing language.
        _, caption = _clean_personal_details(None, body.description)
        updates["description"] = json.dumps({"en": caption}) if caption else None
    elif body.description is not None:
        # 2026-09-24 (items 5/6): document.description is JSON-encoded
        # {"en": "...", "<language>": "..."} — a human correcting it edits
        # in whatever language they're currently viewing the app in
        # (body.language, defaults to English), so this merges into just
        # that one key rather than overwriting every language's text with
        # a single-language correction. json.loads(existing) first (via
        # parse_description, which also handles a pre-2026-09-24 legacy
        # plain-text row) so other languages' descriptions survive.
        with get_conn(DB_PATH) as conn:
            existing_description = conn.execute(
                "SELECT description FROM document WHERE id = ?", (document_id,)
            ).fetchone()["description"]
        by_language = parse_description(existing_description)
        by_language[body.language or "en"] = body.description
        # A document with no description yet at all (e.g. a picture-lane
        # upload's first caption, DECISIONS #52) written in a non-English
        # language would otherwise end up with no "en" key whatsoever,
        # breaking description_for()'s guaranteed-fallback contract —
        # there's no real translation available here (that would need
        # another gateway call, out of scope for a plain field edit), so
        # this bootstraps "en" to the same text rather than leaving it
        # missing; a real English version can still be added later same
        # as any other language, by editing while viewing in English.
        by_language.setdefault("en", body.description)
        updates["description"] = json.dumps(by_language)
    # A personal file has a name and a caption and nothing else (round 21, A3, DECISIONS #101): bucket, vendor and doc type are
    # company-paperwork fields, so an edit that sends them for a personal file has them ignored, not stored.
    if body.bucket is not None and not personal:
        updates["bucket"] = body.bucket
    if body.vendor_name is not None and not personal:
        updates["vendor_name"] = body.vendor_name
    if body.doc_type is not None and not personal:
        updates["doc_type"] = body.doc_type
    if body.filename is not None:
        if personal:
            new_name, _ = _clean_personal_details(body.filename, None)
            if not new_name:
                raise HTTPException(422, detail={"code": "name_required", "message": "A file needs a name."})
            updates["filename"] = new_name
        else:
            updates["filename"] = body.filename
    if body.is_picture and not personal:
        updates["lane"] = "memory"
        updates["doc_type"] = "photo"
        updates["bucket"] = "Memory Lane"

    if updates:
        # Column names come from a fixed set of hardcoded keys above,
        # never from request data — safe to interpolate into the SET
        # clause; only the bound values (?) come from the request body.
        set_clause = ", ".join(f"{col} = ?" for col in updates)
        with get_conn(DB_PATH) as conn:
            conn.execute(
                f"UPDATE document SET {set_clause} WHERE id = ?",
                (*updates.values(), document_id),
            )
        reindex_document_search(document_id, DB_PATH)
    return {"status": "updated"}


@app.get("/api/documents/{document_id}/file")
def get_document_file(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> FileResponse:
    """Streams the original uploaded bytes back. Added 2026-09-22: the
    review queue previously showed a reviewer the extracted fields with no
    way to see the source photo/PDF next to them — a confirm/reject on
    fields you can't check against the source isn't a safety check.

    content_disposition_type="inline" (verified against the installed
    Starlette source — the default is "attachment", which would force a
    download instead of letting <img>/<embed> render it) so the frontend's
    blob-URL preview actually displays.

    404 on cross-tenant access, not 403 (unlike get_trace below, which does
    leak cross-tenant existence via 403 "Not a member") — deliberate for
    this endpoint specifically, per explicit instruction: don't confirm a
    document id is real to a caller who can't read it.

    `status != 'archived'` (2026-09-23, DECISIONS #53's remaining piece):
    an archived document must produce the same 404 as a nonexistent one,
    for a caller in its own company too — invisibility, not "exists but
    you can't have it."
    """
    # Round 13 (DECISIONS #83/#85): a document the caller may not see — pending
    # review and not theirs, or someone else's personal file — is the same 404
    # as an archived or nonexistent one, so the bytes are not "hidden but
    # reachable" by anyone who knows or guesses an id. (The rule is `_readable_file_row`,
    # shared with the download link, round 4.)
    doc = _readable_file_row(membership, document_id)
    if doc is None:
        raise HTTPException(404, "document not found")
    return FileResponse(
        doc["stored_path"], media_type=doc["media_type"],
        filename=doc["filename"], content_disposition_type="inline",
    )


def _readable_file_row(membership: CurrentMembership, document_id: int) -> sqlite3.Row | None:
    """The document's file row if THIS caller may open it, else None (answered as a 404: absent, another company's, archived, pending review
    and not theirs, someone's personal file). ONE place for the file endpoints' rule, so the file, the download link and its redemption
    cannot disagree about who may have the bytes."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, stored_path, media_type, filename, status, uploaded_by_user_id, visibility "
            f"FROM document WHERE id = ? AND {_LIVE_OR_PURGE_REQUESTED}",
            (document_id, _owner_flag(membership)),
        ).fetchone()
    return None if _hidden_or_missing(membership, doc) else doc


@app.post("/api/documents/{document_id}/download-link")
def create_download_link(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """A link a plain browser navigation can use to DOWNLOAD this document (round 4, item 3, DECISIONS #122; app/downloads.py explains why
    the in-app blob download cannot). Authenticated like every data endpoint, and only for a document this caller may open by the file
    endpoint's own rule (a 404 otherwise, never a hint that it exists). The answer is a relative URL good for DOWNLOAD_LINK_TTL_SECONDS
    and ONE use; the client puts its API base in front."""
    if _readable_file_row(membership, document_id) is None:
        raise HTTPException(404, "document not found")
    token = issue_download_link(membership, document_id, DB_PATH)
    return {"url": f"/api/documents/{document_id}/download?token={token}", "expires_in": DOWNLOAD_LINK_TTL_SECONDS}


@app.get("/api/documents/{document_id}/download")
def download_document(document_id: int, token: str = "") -> FileResponse:
    """Serves the file as an ATTACHMENT under its real name to whoever holds a valid, unspent link (app/downloads.py). No Authorization
    header: the link is the proof. It is spent by this request, the person's membership is looked up again, and the file endpoint's rule is
    re-applied, so anything that stopped being true since the link was made is a 404. Every failure is the same 404 (unknown, spent,
    expired, wrong document, no longer a member, no longer visible), so this reveals nothing about which."""
    membership = redeem_download_link(token, document_id, DB_PATH)
    doc = _readable_file_row(membership, document_id) if membership is not None else None
    if doc is None or not Path(doc["stored_path"]).is_file():
        raise HTTPException(404, "download link not valid")
    return FileResponse(
        doc["stored_path"], media_type=doc["media_type"], filename=attachment_filename(doc["filename"], doc["media_type"]),
        content_disposition_type="attachment", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/documents/{document_id}/thumbnail")
def get_document_thumbnail(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> FileResponse:
    """A small JPEG of a PDF's first page, for the document card (round 20, item 5, DECISIONS #97).
    Generated on the first request and cached on disk by the document's content hash
    (app/thumbnails.py explains when, where and how), so it is derived from, and guarded exactly
    like, the file itself: the same query, the same `status != 'archived'`, and the same
    `_hidden_or_missing` rule, so a personal file's thumbnail is its uploader's alone and a
    document the caller may not see is a 404 (never a 403, never a hint that it exists).

    Only a PDF has one (a photo's own bytes are small enough to show directly): any other type is
    a 404, and so is a PDF that cannot be rendered or whose stored file is missing, and the
    page then keeps its generic icon. `Cache-Control: private` lets the browser reuse it for an
    hour without ever letting a shared cache keep it."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, stored_path, media_type, sha256, status, uploaded_by_user_id, visibility "
            f"FROM document WHERE id = ? AND {_LIVE_OR_PURGE_REQUESTED}",
            (document_id, _owner_flag(membership)),
        ).fetchone()
    if _hidden_or_missing(membership, doc):
        raise HTTPException(404, "document not found")
    if doc["media_type"] != "application/pdf":
        raise HTTPException(404, "no thumbnail for this file type")
    if not Path(doc["stored_path"]).is_file():
        raise HTTPException(404, "document file is missing")
    thumbnail = get_pdf_thumbnail(doc["sha256"], doc["stored_path"])
    if thumbnail is None:
        raise HTTPException(404, "no thumbnail could be made for this file")
    return FileResponse(thumbnail, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/business-profile")
def get_business_profile(
    membership: Annotated[CurrentMembership, Depends(require_role("owner"))],
) -> BusinessProfileOut:
    """The company's current business-profile document, for the Company Settings
    section (round 16, DECISIONS #90) — the only place such a document is shown,
    because it is filtered out of the Company Files, Search and Calendar lists.

    Owner only, like editing company settings. The newest one that is not
    archived and that this caller may see (a pending profile is visible to the
    owner, who is the reviewer; someone else's personal file is not); older ones
    stay stored and hidden. `can_prefill` is the same rule that gates the
    company-profile endpoint below, so the page offers "fill in the form" only
    once a person has confirmed the extracted values in the review queue."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, media_type, doc_type, status, received_at, uploaded_by_user_id, visibility "
            "FROM document WHERE company_id = ? AND status != 'archived' ORDER BY received_at DESC, id DESC",
            (membership.company_id,),
        ).fetchall()
    for row in rows:
        if is_company_profile_doc_type(row["doc_type"]) and _can_see(membership, row):
            return BusinessProfileOut(document={
                "id": row["id"], "filename": row["filename"], "media_type": row["media_type"],
                "status": row["status"], "received_at": row["received_at"],
                "can_prefill": may_prefill_company_from(membership.role, row["doc_type"], row["status"]),
            })
    return BusinessProfileOut(document=None)


@app.get("/api/documents/{document_id}/company-profile")
def get_company_profile_prefill(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(require_role("owner"))],
) -> CompanyProfilePrefill:
    """The values an ACRA business-profile document holds, shaped for the
    company-settings form (2026-09-24, round 12, DECISIONS #79). READ-ONLY:
    nothing here touches the company row — the owner reviews the pre-filled
    form and saves it themselves through PATCH /api/companies/{id}, so the
    human still approves the write.

    Owner only, and only for a document that is a business profile in the
    caller's own company and has been confirmed in the review queue
    (rules.company_profile.may_prefill_company_from). An archived document is
    a 404, like every other endpoint that fetches one by id."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, filename, doc_type, status, uploaded_by_user_id, visibility FROM document "
            "WHERE id = ? AND status != 'archived'",
            (document_id,),
        ).fetchone()
        if _hidden_or_missing(membership, doc):
            raise HTTPException(404, "document not found")
        if not may_prefill_company_from(membership.role, doc["doc_type"], doc["status"]):
            raise HTTPException(409, "Only a confirmed ACRA business profile can pre-fill company settings")
        rows = conn.execute(
            "SELECT field, value_text FROM extraction WHERE document_id = ? ORDER BY id", (document_id,),
        ).fetchall()
    settings = company_settings_from_profile(extraction_values([(r["field"], r["value_text"]) for r in rows]))
    return CompanyProfilePrefill(document_id=document_id, filename=doc["filename"], **settings)


@app.post("/api/documents/{document_id}/archive")
def archive_document(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """Soft-delete, added 2026-09-22 (DECISIONS #37). Archive, not hard
    delete: the row, file, and full audit trail (extractions, trace,
    security_events) all stay intact — this product's own pitch is "don't
    lose evidence," so a casual click permanently erasing a document would
    contradict that. Archiving only hides it from the default Documents-tab
    list. Routed through transition_document() (never raw SQL, unlike
    app/guards/injection.py::quarantine() — a separate, already-flagged
    pre-existing issue, not copied here).

    Who: admin and owner, for a COMPANY document (archiving is a real action on shared
    company data, the same bar as resolving a review). A personal file is never archived:
    its uploader deletes it for good with POST .../purge (round 20, DECISIONS #99, which
    replaced the round 19 rule that let the uploader archive it). A `user` still cannot
    delete a company document, not even one they uploaded (403).
    """
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, status, uploaded_by_user_id, visibility FROM document WHERE id = ?",
            (document_id,),
        ).fetchone()
    # A caller cannot delete what they cannot see (round 13): a personal file
    # that is not theirs, or a colleague's pending upload, answers 404, not
    # "deleted" and not "forbidden" (a 403 would confirm it exists).
    if _hidden_or_missing(membership, doc):
        raise HTTPException(404, "document not found")
    if doc["visibility"] != "company":
        raise HTTPException(403, "A private file is deleted for good, not archived: use its Delete in Only me")
    if not may_archive_document(membership, visibility=doc["visibility"]):
        raise HTTPException(403, f"Requires role 'admin' or higher, caller is '{membership.role}'")

    try:
        transition_document(document_id, "archived", actor=membership.email, db_path=DB_PATH)
    except InvalidTransition:
        # Every other status can reach "archived" now (rules/transitions.py)
        # — the only way this fires is the document being archived already.
        raise HTTPException(409, "document is already archived") from None

    with get_conn(DB_PATH) as conn:
        # Drops it out of the Needs-Review count too — an open review_item
        # pointing at an archived document is a dead end otherwise.
        # 'dismissed' is an existing review_item.status value (app/db.py).
        conn.execute(
            "UPDATE review_item SET status = 'dismissed' WHERE document_id = ? AND status = 'open'",
            (document_id,),
        )
    return {"status": "archived"}


# Uvicorn configures this logger at INFO, so an audit line here reaches the service's journal.
_audit = logging.getLogger("uvicorn.error")


def _purge_a_rejected_private_file(document_id: int, actor: str) -> None:
    """A private file whose uploader REJECTED it is deleted for good, not left archived (round 20, DECISIONS #99):
    a soft-deleted private row is invisible to its owner yet counts toward the private-file cap, and only an operator
    could ever clear it. Company documents are unaffected (a reject still archives them). The answer to the reject
    is unchanged (`archived`); a purge that could not run is logged, and the row stays archived."""
    try:
        failed_files = purge_now(document_id)
    except PurgeRefused as e:
        _audit.error("AUDIT purge: rejected private document %s could not be deleted for good: %s", document_id, e)
        return
    _audit.info("AUDIT purge: %s rejected private document %s, deleted for good", actor, document_id)
    if failed_files:
        _audit.error("AUDIT purge: rows of document %s deleted but the stored file was not removed: %s", document_id, failed_files)


@app.post("/api/documents/{document_id}/request-purge")
def request_document_purge(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """The OWNER asks for a company document to be removed permanently (round 21, A5, DECISIONS #101 and #102). Nothing is
    deleted here: the document is archived exactly as Delete archives it (hidden from every other role, file and row kept,
    open review items dismissed) and flagged (`purge_requested_at`, `purge_requested_by`), so the team can find it and
    remove it with scripts/purge_document.py. The OWNER keeps seeing it, marked "purge_requested" and read-only, in the
    list, in search and by file, until that row is gone (`_LIVE_OR_PURGE_REQUESTED`, auth.may_see_purge_requested).
    The real in-app purge stays a separate, dedicated round (KANBAN).

    Who: the owner only, for a COMPANY document (auth.may_request_purge); an admin keeps Delete and has no Purge.
    Order: a document the caller may not see is a 404, then 403 if the rule refuses, then the archive (409 when it is
    already archived, which also covers a second request)."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, filename, status, uploaded_by_user_id, visibility FROM document WHERE id = ?",
            (document_id,),
        ).fetchone()
    if _hidden_or_missing(membership, doc):
        raise HTTPException(404, "document not found")
    if not may_request_purge(membership, visibility=doc["visibility"]):
        raise HTTPException(403, "Only the owner can request that a company document be purged")
    try:
        transition_document(document_id, "archived", actor=membership.email, db_path=DB_PATH)
    except InvalidTransition:
        raise HTTPException(409, "document is already archived") from None
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE document SET purge_requested_at = datetime('now'), purge_requested_by = ? WHERE id = ?",
            (membership.email, document_id),
        )
        conn.execute(
            "UPDATE review_item SET status = 'dismissed' WHERE document_id = ? AND status = 'open'", (document_id,),
        )
    _audit.info("AUDIT purge-request: %s asked for document %s (%r) to be removed permanently", membership.email, document_id, doc["filename"])
    return {"status": "purge_requested"}


@app.post("/api/documents/{document_id}/cancel-purge-request")
def cancel_document_purge_request(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """The OWNER takes a PENDING purge request back (round 3, item 9b, DECISIONS #121). It undoes exactly what
    request_document_purge did, no more: the document was archived and flagged and nothing was deleted, so it goes back to the
    status it had (rules.transitions.restore_document_after_purge_request reads that from the audit row of the archive; it is
    not assumed to be `filed`) and the flag is cleared. It is NOT a general un-archive: an ordinary Delete has no way back, and
    once the team has run scripts/purge_document.py the row is gone and there is nothing left to cancel.

    Who: the owner only (auth.may_cancel_purge_request, the same rule as requesting). A document the caller cannot see is a 404,
    and to anyone but the owner a purge-requested document is archived and so does not exist (`_LIVE_OR_PURGE_REQUESTED`),
    which is why a lower role gets the same 404 and not a 403. Then 403 if the rule refuses, 409 when there is no pending
    request, or when the status before it cannot be determined (the request stays pending, never guessed)."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, filename, status, uploaded_by_user_id, visibility, purge_requested_at "
            f"FROM document WHERE id = ? AND {_LIVE_OR_PURGE_REQUESTED}",
            (document_id, _owner_flag(membership)),
        ).fetchone()
    if _hidden_or_missing(membership, doc):
        raise HTTPException(404, "document not found")
    if not may_cancel_purge_request(membership, visibility=doc["visibility"]):
        raise HTTPException(403, "Only the owner can cancel a purge request")
    if doc["purge_requested_at"] is None:
        raise HTTPException(409, "this document has no pending purge request")
    try:
        restored = restore_document_after_purge_request(document_id, actor=membership.email, db_path=DB_PATH)
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from None
    _audit.info(
        "AUDIT purge-request-cancel: %s took back the request for document %s (%r); it is %s again",
        membership.email, document_id, doc["filename"], restored,
    )
    return {"status": restored}


@app.get("/api/purge-requests")
def list_purge_requests(membership: Annotated[CurrentMembership, Depends(require_role("owner"))]) -> list[dict]:
    """The company's pending purge requests, newest first (round 21, A5, DECISIONS #101): what the owner asked to have
    removed and the team has not yet purged. Owner only, this company only (`company_id` comes from the session). A
    request stays here until scripts/purge_document.py deletes the row, which is when it stops existing.

    Each row carries what the page needs to name the document as a person would (`description`, `doc_type`, `vendor_name`, the
    same columns the document cards use) and not only its file name (DECISIONS #109); all three may be null."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, description, doc_type, vendor_name, "
            "       purge_requested_at AS requested_at, purge_requested_by AS requested_by "
            "FROM document WHERE company_id = ? AND purge_requested_at IS NOT NULL "
            "ORDER BY purge_requested_at DESC, id DESC",
            (membership.company_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/documents/{document_id}/purge")
def purge_document_endpoint(
    document_id: int, body: PurgeRequest,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """Delete a PRIVATE file for good (round 20, item 6, DECISIONS #99). Irreversible: the stored file, the row and
    its search row, everything read from it, and a PDF's thumbnail are removed (app/purge.py), so the person's slot
    under the 15-file cap is really freed. This is what the Only me Delete does; a soft archive of a private file
    no longer exists.

    Who: only the uploader of their OWN personal file (auth.may_purge_document). Order: a document the caller may not
    see is a 404 (so nobody learns a private file exists), then 403 for anyone who can see it but may not purge it
    (a company document, for every role: purging those from the app is a separate, dedicated round), then the
    confirmation: `confirm` must equal the file's exact name, so a stray call or a wrong id deletes nothing (400).
    An archived private file left over from before this change can still be purged by its owner by id.

    The audit line records who deleted what, because the purge removes the document's own trace and security
    rows. If the rows are gone but the file could not be removed the answer says so (`file_removed: false`) and an
    error is logged for the operator."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, filename, status, uploaded_by_user_id, visibility FROM document WHERE id = ?",
            (document_id,),
        ).fetchone()
    if _hidden_or_missing(membership, doc):
        raise HTTPException(404, "document not found")
    if not may_purge_document(membership, uploaded_by_user_id=doc["uploaded_by_user_id"], visibility=doc["visibility"]):
        raise HTTPException(403, "Only the person who uploaded a private file can delete it for good")
    if body.confirm != doc["filename"]:
        raise HTTPException(400, detail={
            "code": "confirmation_mismatch",
            "message": "The name you typed does not match the file's name. Nothing was deleted.",
        })
    try:
        failed_files = purge_now(document_id)
    except PurgeRefused as e:
        raise HTTPException(409, str(e)) from None
    _audit.info(
        "AUDIT purge: %s deleted private document %s (%r) for good", membership.email, document_id, doc["filename"],
    )
    if failed_files:
        _audit.error("AUDIT purge: rows of document %s deleted but the stored file was not removed: %s", document_id, failed_files)
    return {"status": "purged", "file_removed": not failed_files}


@app.get("/api/trace/{document_id}")
def get_trace(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """Agent trace panel. ARCHITECTURE.md §6/§7 — cost per document.

    `status != 'archived'` (2026-09-23, DECISIONS #53's remaining piece):
    an archived document must 404 like a nonexistent one, even for a
    caller in its own company — not the 403 "exists but you're not a
    member" this endpoint deliberately uses for a real cross-tenant
    document (see get_document_file's docstring above for why that leak
    is an accepted, unrelated tradeoff). Folding the exclusion into this
    same query means an archived document in *another* company also now
    reads as 404 rather than 403 — strictly more invisible, not less, so
    this doesn't reopen anything; it just means that specific pre-existing
    cross-tenant leak no longer applies to archived documents specifically.
    """
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, status, uploaded_by_user_id, visibility FROM document "
            "WHERE id = ? AND status != 'archived'",
            (document_id,),
        ).fetchone()
        if doc is None:
            raise HTTPException(404, "document not found")
        if doc["company_id"] != membership.company_id:
            raise HTTPException(403, "Not a member of this company")
        # Round 13 (DECISIONS #83/#85): a document in the caller's OWN company
        # that they may not see — pending review and not theirs, or someone
        # else's personal file — is a 404 like an archived one. The trace of a
        # personal file would otherwise leak its lane, doc_type and cost.
        if not _can_see(membership, doc):
            raise HTTPException(404, "document not found")
        rows = conn.execute(
            "SELECT * FROM trace WHERE document_id = ? ORDER BY at", (document_id,)
        ).fetchall()
        out = [dict(r) for r in rows]
        total_cost = sum(r["cost_usd"] or 0 for r in out)
        return {"nodes": out, "total_cost_usd": round(total_cost, 6)}
