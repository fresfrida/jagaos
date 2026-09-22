"""classify node. haiku, propose-only — writes nothing (ARCHITECTURE.md §3)."""

import json

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.guards.injection import UNTRUSTED_TEMPLATE, scan
from app.llm import call
from app.models import ClassifyResult, to_tool

TOOL = to_tool(
    ClassifyResult,
    "classify_document",
    "Classify a document into a lane and a specific doc_type.",
)

SYSTEM = """You classify Singapore SME documents into one of four lanes:
statutory (ACRA/IRAS letters, notices, filings), invoice (bills, receipts),
important (contracts, leases, insurance), or memory (photos, notes with no
formal filing purpose). Call classify_document with your answer."""


def classify(state: PipelineState) -> PipelineState:
    text = state.get("text", "")
    regex_hits = scan(text)

    if not text.strip():
        result = {"lane": "memory", "doc_type": "unlabelled_photo", "confidence": 0.3,
                   "injection_suspected": False}
    else:
        user = UNTRUSTED_TEMPLATE.format(document_text=text[:12000])
        # "haiku" is rejected by the gateway for this team's key — confirmed
        # live 2026-09-21 (GAPS.md's new §11): "Only the approved model is
        # allowed". sonnet4.5 is the only callable model; no cheap-routing
        # cost split is available.
        llm_result = call("sonnet4.5", SYSTEM, user, tools=[TOOL],
                           tool_choice={"type": "function", "function": {"name": "classify_document"}})
        args = json.loads(llm_result.tool_calls[0]["function"]["arguments"])
        result = ClassifyResult(**args).model_dump()

        with get_conn(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO trace (run_id, company_id, document_id, node, model, "
                " input_tokens, output_tokens, cost_usd, latency_ms, decision, confidence) "
                "VALUES (?, ?, ?, 'classify', ?, ?, ?, ?, ?, ?, ?)",
                (state["run_id"], state["company_id"], state["document_id"],
                 llm_result.model, llm_result.input_tokens, llm_result.output_tokens,
                 llm_result.cost_usd, llm_result.latency_ms,
                 f"{result['lane']}/{result['doc_type']}", result["confidence"]),
            )

    if regex_hits or result.get("injection_suspected"):
        result["injection_suspected"] = True

    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE document SET lane = ?, doc_type = ?, status = 'proposed' WHERE id = ?",
            (result["lane"], result["doc_type"], state["document_id"]),
        )

    return {"classify_result": result}
