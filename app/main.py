"""FastAPI app. ARCHITECTURE.md §8/§9.

Single-tenant for this pass — PLATFORM.md's user/membership/session layer
is deferred (see docs/KANBAN.md) until this core loop is proven end to end
on a real document, per WINNING.md's cut list.
"""

import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langgraph.errors import InvalidUpdateError
from langgraph.types import Command

load_dotenv()

from app.db import DB_PATH, get_conn, init_db  # noqa: E402
from app.graph.ingest import ingest  # noqa: E402
from app.graph.pipeline import PIPELINE  # noqa: E402
from app.models import ReviewResolution  # noqa: E402

app = FastAPI(title="JagaOS API")

# Local-dev only: the Vite dev server runs on a different origin (5173 vs
# this app's 8000), so the browser blocks fetch() without this. Tighten to
# the real deployed frontend origin before Lightsail (ARCHITECTURE.md §8
# serves both behind the same Caddy host, so this won't be needed there).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db(DB_PATH)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


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
    company_id: int, file: UploadFile, source_channel: str = "web",
) -> dict:
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    ingest_state = ingest(
        company_id=company_id, source_path=tmp_path, filename=file.filename,
        source_channel=source_channel,
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
def resolve_review(review_item_id: int, thread_id: str, body: ReviewResolution) -> dict:
    # All the actual state changes (review_item, extraction rows, document
    # status) happen inside app/graph/human_review.py on resume, not here —
    # that keeps "what does resolving mean" in one place instead of split
    # between this endpoint and the graph node.
    with get_conn(DB_PATH) as conn:
        item = conn.execute(
            "SELECT id FROM review_item WHERE id = ? AND status = 'open'", (review_item_id,)
        ).fetchone()
        if item is None:
            raise HTTPException(404, "review item not found or already resolved")

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
def list_review_items(company_id: int) -> list[dict]:
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT r.*, d.filename AS document_filename, "
            # thread_id == run_id, generated in app/graph/ingest.py as
            # sha256[:12] — not its own column, derived the same way here
            # rather than adding one for a value that never changes.
            " substr(d.sha256, 1, 12) AS thread_id "
            "FROM review_item r JOIN document d ON d.id = r.document_id "
            "WHERE r.company_id = ? AND r.status = 'open' ORDER BY r.id DESC",
            (company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/expectations")
def list_expectations(company_id: int) -> list[dict]:
    """The gap analysis. INDEXING.md §0 — dashed lines on the timeline."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM expectation WHERE company_id = ? ORDER BY status, due_on",
            (company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/obligations")
def list_obligations(company_id: int) -> list[dict]:
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM obligation WHERE company_id = ? ORDER BY due_on",
            (company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/documents")
def list_documents(company_id: int) -> list[dict]:
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, lane, doc_type, status, received_at "
            "FROM document WHERE company_id = ? ORDER BY received_at DESC",
            (company_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/trace/{document_id}")
def get_trace(document_id: int) -> dict:
    """Agent trace panel. ARCHITECTURE.md §6/§7 — cost per document."""
    with get_conn(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT * FROM trace WHERE document_id = ? ORDER BY at", (document_id,)
        ).fetchall()
        out = [dict(r) for r in rows]
        total_cost = sum(r["cost_usd"] or 0 for r in out)
        return {"nodes": out, "total_cost_usd": round(total_cost, 6)}
