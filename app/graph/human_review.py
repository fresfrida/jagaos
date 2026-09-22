"""human_review node. LangGraph interrupt() — the escalation checkpoint
(ARCHITECTURE.md §3, §12 table).

Everything after the interrupt() call runs on RESUME, not on the first
(pausing) invocation — this is the part that was originally missing
(confirmed live 2026-09-22): the graph correctly paused and resumed, but
nothing ever applied the human's actual answer. Fixed here: a "confirm"
files the document and, if corrected_fields were sent, records each as a
new extraction row with source='human' (the original LLM guess stays on
record too — a correction is provenance, not an overwrite). A "reject"
stops the document there; app/graph/pipeline.py's conditional edge skips
derive_events/expectations/obligations for a rejected document.
"""

import json

from langgraph.types import interrupt

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.rules.transitions import transition_document


def human_review(state: PipelineState) -> PipelineState:
    resolution = interrupt(
        {
            "document_id": state["document_id"],
            "question": state["verify_result"].get("review_question"),
            "reasons": state["verify_result"].get("reasons"),
            "proposed": state.get("extract_result"),
        }
    )

    document_id = state["document_id"]
    action = resolution.get("action", "confirm")
    corrected_fields = resolution.get("corrected_fields") or {}

    extract_result = dict(state.get("extract_result") or {})
    with get_conn(DB_PATH) as conn:
        for field_name, new_value in corrected_fields.items():
            prior = extract_result.get(field_name)
            prior = prior if isinstance(prior, dict) else {}
            extract_result[field_name] = {**prior, "value": new_value, "confidence": 1.0}
            conn.execute(
                "INSERT INTO extraction (document_id, field, value_text, confidence, "
                " page, char_start, char_end, extractor_version, source) "
                "VALUES (?, ?, ?, 1.0, ?, ?, ?, 'human_review', 'human')",
                (document_id, field_name, json.dumps(new_value),
                 prior.get("page"), prior.get("char_start"), prior.get("char_end")),
            )

        review_item = conn.execute(
            "SELECT id FROM review_item WHERE document_id = ? AND status = 'open' "
            "ORDER BY id DESC LIMIT 1",
            (document_id,),
        ).fetchone()
        if review_item:
            conn.execute(
                "UPDATE review_item SET status = 'resolved', resolved_by = 'human', "
                "resolved_at = datetime('now'), action = ?, resolved_json = ? WHERE id = ?",
                (action, json.dumps(corrected_fields), review_item["id"]),
            )

    transition_document(document_id, "filed" if action == "confirm" else "rejected",
                         actor="human", db_path=DB_PATH)

    return {"review_resolution": resolution, "extract_result": extract_result}
