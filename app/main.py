"""FastAPI app. ARCHITECTURE.md §8/§9.

Multi-user as of 2026-09-22 (DECISIONS.md): every data endpoint requires a
session (app/auth.py) and derives company_id from the caller's membership —
never from a client-supplied parameter. app_user/membership/session are the
smallest slice of PLATFORM.md's model that makes that true, with a simpler
4-role set (owner/admin/user/viewer) than PLATFORM.md's original six.
"""

import tempfile
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langgraph.errors import InvalidUpdateError
from langgraph.types import Command

load_dotenv()

from app.auth import CurrentMembership, get_current_membership, hash_token, issue_session, require_role  # noqa: E402
from app.db import DB_PATH, get_conn, init_db  # noqa: E402
from app.graph.ingest import ingest  # noqa: E402
from app.graph.pipeline import PIPELINE  # noqa: E402
from app.models import (  # noqa: E402
    AddMemberRequest,
    AuthResponse,
    CompanyOut,
    DevLoginRequest,
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
            "SELECT id, name FROM company WHERE id = ?", (company_id,)
        ).fetchone()
        final_user = conn.execute(
            "SELECT id, email, name FROM app_user WHERE id = ?", (user_id,)
        ).fetchone()

    token = issue_session(user_id)
    return AuthResponse(
        token=token,
        user=UserOut(id=final_user["id"], email=final_user["email"], name=final_user["name"]),
        company=CompanyOut(id=company["id"], name=company["name"]),
        role=role,
    )


@app.get("/api/auth/me")
def auth_me(membership: Annotated[CurrentMembership, Depends(get_current_membership)]) -> dict:
    with get_conn(DB_PATH) as conn:
        company = conn.execute(
            "SELECT id, name FROM company WHERE id = ?", (membership.company_id,)
        ).fetchone()
    return {
        "user": {"id": membership.user_id, "email": membership.email, "name": membership.name},
        "company": {"id": company["id"], "name": company["name"]},
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


@app.post("/api/documents")
async def upload_document(
    membership: Annotated[CurrentMembership, Depends(require_role("user"))],
    file: UploadFile, source_channel: str = "web",
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

    if doc_status == "needs_review":
        with get_conn(DB_PATH) as conn:
            review_item = conn.execute(
                "SELECT id, question FROM review_item WHERE document_id = ? "
                "AND status = 'open' ORDER BY id DESC LIMIT 1",
                (document_id,),
            ).fetchone()
        return {
            "document_id": document_id,
            "status": "needs_review",
            "thread_id": thread_id,
            "review_item_id": review_item["id"] if review_item else None,
            "review": {"question": review_item["question"]} if review_item else None,
        }

    if doc_status == "quarantined":
        return {"document_id": document_id, "status": "quarantined",
                "verify": result.get("verify_result")}

    return {
        "document_id": document_id,
        "status": "processed",
        "classify": result.get("classify_result"),
        "extract": result.get("extract_result"),
        "verify": result.get("verify_result"),
        "events": result.get("events"),
        "obligations_created": result.get("obligations_created"),
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
            "SELECT r.*, d.filename AS document_filename, "
            # thread_id == run_id, generated in app/graph/ingest.py as
            # sha256[:12] — not its own column, derived the same way here
            # rather than adding one for a value that never changes.
            " substr(d.sha256, 1, 12) AS thread_id "
            "FROM review_item r JOIN document d ON d.id = r.document_id "
            "WHERE r.company_id = ? AND r.status = 'open' ORDER BY r.id DESC",
            (membership.company_id,),
        ).fetchall()
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
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, lane, doc_type, status, received_at "
            "FROM document WHERE company_id = ? ORDER BY received_at DESC",
            (membership.company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/trace/{document_id}")
def get_trace(
    document_id: int,
    membership: Annotated[CurrentMembership, Depends(get_current_membership)],
) -> dict:
    """Agent trace panel. ARCHITECTURE.md §6/§7 — cost per document."""
    with get_conn(DB_PATH) as conn:
        doc = conn.execute(
            "SELECT company_id FROM document WHERE id = ?", (document_id,)
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
