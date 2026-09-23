"""FastAPI app. ARCHITECTURE.md §8/§9.

Multi-user as of 2026-09-22 (DECISIONS.md): every data endpoint requires a
session (app/auth.py) and derives company_id from the caller's membership —
never from a client-supplied parameter. app_user/membership/session are the
smallest slice of PLATFORM.md's model that makes that true, with a simpler
4-role set (owner/admin/user/viewer) than PLATFORM.md's original six.
"""

import os
import tempfile
from pathlib import Path
from typing import Annotated

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from langgraph.errors import InvalidUpdateError
from langgraph.types import Command

load_dotenv()

from app.auth import CurrentMembership, get_current_membership, hash_token, issue_session, require_role  # noqa: E402
from app.db import (  # noqa: E402
    DB_PATH,
    build_fts5_query,
    get_conn,
    init_db,
    reindex_document_search,
)
from app.graph.ingest import ingest  # noqa: E402
from app.graph.pipeline import PIPELINE  # noqa: E402
from app.rules.transitions import InvalidTransition, transition_document  # noqa: E402
from app.models import (  # noqa: E402
    AddMemberRequest,
    AuthResponse,
    CompanyEditRequest,
    CompanyOut,
    DevLoginRequest,
    DocumentEditRequest,
    MemberOut,
    ReviewResolution,
    UserOut,
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://jagaos.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db(DB_PATH)


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
                    400, "No company membership yet — provide company_name to create one"
                )
            company_id, role = membership["company_id"], membership["role"]

        company = conn.execute(
            "SELECT id, name, fye_month, fye_day FROM company WHERE id = ?", (company_id,)
        ).fetchone()
        final_user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE id = ?", (user_id,)
        ).fetchone()

    token = issue_session(user_id)
    return AuthResponse(
        token=token,
        user=UserOut(id=final_user["id"], email=final_user["email"], name=final_user["name"]),
        company=CompanyOut(id=company["id"], name=company["name"], fye_month=company["fye_month"], fye_day=company["fye_day"]),
        role=role,
    )


@app.get("/api/auth/me")
def auth_me(membership: Annotated[CurrentMembership, Depends(get_current_membership)]) -> dict:
    with get_conn(DB_PATH) as conn:
        company = conn.execute(
            "SELECT id, name, fye_month, fye_day FROM company WHERE id = ?", (membership.company_id,)
        ).fetchone()
    return {
        "user": {"id": membership.user_id, "email": membership.email, "name": membership.name},
        "company": {"id": company["id"], "name": company["name"], "fye_month": company["fye_month"], "fye_day": company["fye_day"]},
        "role": membership.role,
    }


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


@app.get("/api/companies")
def list_companies() -> list[dict]:
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, name, uen, fye_month, fye_day, dormant, gst_registered FROM company ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/companies")
def create_company(
    name: str, fye_month: int, fye_day: int, uen: str | None = None,
    dormant: bool = False, gst_registered: bool = False,
) -> dict:
    with get_conn(DB_PATH) as conn:
        cur = conn.execute(
            "INSERT INTO company (uen, name, fye_month, fye_day, dormant, gst_registered) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (uen, name, fye_month, fye_day, int(dormant), int(gst_registered)),
        )
        return {"id": cur.lastrowid, "name": name}


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

    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE document SET description = ? WHERE id = ? AND description IS NULL",
            (caption, document_id),
        )
    reindex_document_search(document_id, DB_PATH)


@app.post("/api/documents")
async def upload_document(
    membership: Annotated[CurrentMembership, Depends(require_role("user"))],
    background_tasks: BackgroundTasks,
    file: UploadFile, source_channel: str = "web", is_picture: bool = False,
) -> dict:
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    ingest_state = ingest(
        company_id=membership.company_id, source_path=tmp_path, filename=file.filename,
        source_channel=source_channel, uploaded_by_user_id=membership.user_id,
    )
    if ingest_state.get("text_source") == "duplicate":
        return {"document_id": ingest_state["document_id"], "status": "duplicate"}

    # 2026-09-23 (DECISIONS #52): the upload-time "is this a picture?"
    # toggle (web/src/features/ops/OpsConsole.tsx) — set on the state dict
    # here rather than threading a new param through ingest() itself,
    # since ingest.py's EXIF/text extraction is unaffected by lane and
    # already runs before this regardless (app/graph/ingest.py). Read by
    # app/graph/classify.py to skip its LLM call entirely.
    ingest_state["is_picture"] = is_picture

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


@app.post("/api/review/{review_item_id}/resolve")
def resolve_review(
    review_item_id: int, thread_id: str, body: ReviewResolution,
    membership: Annotated[CurrentMembership, Depends(require_role("admin"))],
) -> dict:
    # All the actual state changes (review_item, extraction rows, document
    # status) happen inside app/graph/human_review.py on resume, not here —
    # that keeps "what does resolving mean" in one place instead of split
    # between this endpoint and the graph node.
    #
    # Deliberately kept admin+ (2026-09-23, role/permission work) — NOT
    # extended to let a `user` resolve review items on their own uploads,
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
    with get_conn(DB_PATH) as conn:
        item = conn.execute(
            "SELECT id, company_id FROM review_item WHERE id = ? AND status = 'open'",
            (review_item_id,),
        ).fetchone()
        if item is None:
            raise HTTPException(404, "review item not found or already resolved")
        if item["company_id"] != membership.company_id:
            raise HTTPException(403, "Not a member of this company")

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
            "document was uploaded — the in-memory checkpoint is gone). "
            "Re-upload the document to get a fresh, resolvable review item.",
        ) from None
    with get_conn(DB_PATH) as conn:
        doc_status = conn.execute(
            "SELECT status FROM document WHERE id = (SELECT document_id FROM review_item WHERE id = ?)",
            (review_item_id,),
        ).fetchone()

    return {
        "status": doc_status["status"] if doc_status else "resumed",
        "events": result.get("events"),
        "obligations_created": result.get("obligations_created"),
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
            "d.lane AS document_lane, "
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
        return [dict(r) for r in rows]


@app.get("/api/expectations")
def list_expectations(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    """The gap analysis. INDEXING.md §0 — dashed lines on the timeline."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM expectation WHERE company_id = ? ORDER BY status, due_on",
            (membership.company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


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


@app.get("/api/documents")
def list_documents(
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> list[dict]:
    """No role floor beyond an authenticated member — deliberately open to
    viewer too, so the `!= 'archived'` exclusion below is the only thing
    keeping archived documents out of the app entirely (2026-09-23,
    DECISIONS #53). Unconditional, no parameter, no role exception: an
    archived document is recoverable only via direct DB access on the
    Lightsail box, never through this API, for any role including owner."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, media_type, lane, doc_type, status, received_at, "
            "description, bucket, vendor_name, occurred_on "
            "FROM document WHERE company_id = ? AND status != 'archived' "
            "ORDER BY received_at DESC",
            (membership.company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


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
            f"description, bucket, vendor_name, occurred_on FROM document "
            f"WHERE id IN ({placeholders}) AND status != 'archived'",
            ordered_ids,
        ).fetchall()
        docs_by_id = {d["id"]: dict(d) for d in docs}
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
            "SELECT company_id, uploaded_by_user_id FROM document WHERE id = ?", (document_id,)
        ).fetchone()
    if doc is None or doc["company_id"] != membership.company_id:
        raise HTTPException(404, "document not found")
    if (
        membership.role == "user"
        and doc["uploaded_by_user_id"] is not None
        and doc["uploaded_by_user_id"] != membership.user_id
    ):
        raise HTTPException(403, "You can only edit documents you uploaded yourself")

    updates: dict[str, object] = {}
    if body.description is not None:
        updates["description"] = body.description
    if body.bucket is not None:
        updates["bucket"] = body.bucket
    if body.vendor_name is not None:
        updates["vendor_name"] = body.vendor_name
    if body.doc_type is not None:
        updates["doc_type"] = body.doc_type
    if body.filename is not None:
        updates["filename"] = body.filename
    if body.is_picture:
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
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id, stored_path, media_type, filename FROM document "
            "WHERE id = ? AND status != 'archived'",
            (document_id,),
        ).fetchone()
    if doc is None or doc["company_id"] != membership.company_id:
        raise HTTPException(404, "document not found")
    return FileResponse(
        doc["stored_path"], media_type=doc["media_type"],
        filename=doc["filename"], content_disposition_type="inline",
    )


@app.post("/api/documents/{document_id}/archive")
def archive_document(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(require_role("admin"))],
) -> dict:
    """Soft-delete, added 2026-09-22 (DECISIONS #37). Archive, not hard
    delete: the row, file, and full audit trail (extractions, trace,
    security_events) all stay intact — this product's own pitch is "don't
    lose evidence," so a casual click permanently erasing a document would
    contradict that. Archiving only hides it from the default Documents-tab
    list. Routed through transition_document() (never raw SQL, unlike
    app/guards/injection.py::quarantine() — a separate, already-flagged
    pre-existing issue, not copied here). admin+ gated: archiving is a real
    action on shared company data, the same bar as resolving a review.
    """
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id FROM document WHERE id = ?", (document_id,)
        ).fetchone()
    if doc is None or doc["company_id"] != membership.company_id:
        raise HTTPException(404, "document not found")

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
            "SELECT company_id FROM document WHERE id = ? AND status != 'archived'",
            (document_id,),
        ).fetchone()
        if doc is None:
            raise HTTPException(404, "document not found")
        if doc["company_id"] != membership.company_id:
            raise HTTPException(403, "Not a member of this company")
        rows = conn.execute(
            "SELECT * FROM trace WHERE document_id = ? ORDER BY at", (document_id,)
        ).fetchall()
        out = [dict(r) for r in rows]
        total_cost = sum(r["cost_usd"] or 0 for r in out)
        return {"nodes": out, "total_cost_usd": round(total_cost, 6)}
