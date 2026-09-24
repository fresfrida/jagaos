"""derive_events node. sonnet4.5 proposes; rules.transitions/db confirm the
write (ARCHITECTURE.md §3, §12 row 3: "read prose for future commitments" —
the hardest and most valuable use of the model in this pipeline).

Only runs on the statutory lane for now. Invoice/important/memory lanes
don't carry life-event information worth a model call — cutting this per
WINNING.md Part 3 ("build only what demonstrates the criteria")."""

import json

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.guards.injection import UNTRUSTED_TEMPLATE
from app.llm import MODEL_NAME, call
from app.models import ProposedEvent, to_tool

TOOL = to_tool(
    ProposedEvent,
    "propose_event",
    "Propose a company life event this document is evidence of, if any.",
)

SYSTEM = """You read a Singapore SME's statutory document and decide whether
it is evidence of a company life event: incorporation, office_move,
corpsec_change, director_change, gst_registration, first_employee, fy_end,
or dormancy. If the document is evidence of such an event, call
propose_event with the event kind, the date it occurred, and a short title.
If it is not evidence of any life event (e.g. a routine reminder), do not
call the tool — respond with "no_event" instead."""


def derive_events(state: PipelineState) -> PipelineState:
    if state.get("classify_result", {}).get("lane") != "statutory":
        return {"events": []}
    if state.get("verify_result", {}).get("needs_review") or not state.get("verify_result", {}).get("ok", True):
        return {"events": []}

    user = UNTRUSTED_TEMPLATE.format(document_text=state.get("text", "")[:12000])
    llm_result = call(MODEL_NAME, SYSTEM, user, tools=[TOOL], tool_choice="auto")

    with get_conn(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, model, "
            " input_tokens, output_tokens, cost_usd, latency_ms, decision) "
            "VALUES (?, ?, ?, 'derive_events', ?, ?, ?, ?, ?, ?)",
            (state["run_id"], state["company_id"], state["document_id"],
             llm_result.model, llm_result.input_tokens, llm_result.output_tokens,
             llm_result.cost_usd, llm_result.latency_ms,
             "proposed" if llm_result.tool_calls else "no_event"),
        )

    if not llm_result.tool_calls:
        return {"events": []}

    args = json.loads(llm_result.tool_calls[0]["function"]["arguments"])
    proposed = ProposedEvent(**args)

    with get_conn(DB_PATH) as conn:
        cur = conn.execute(
            "INSERT INTO event (company_id, kind, occurred_on, title, confidence, "
            " status, source_document_id) VALUES (?, ?, ?, ?, ?, 'confirmed', ?)",
            (state["company_id"], proposed.kind, proposed.occurred_on.isoformat(),
             proposed.title, proposed.confidence, state["document_id"]),
        )
        event_id = cur.lastrowid

    return {"events": [{"id": event_id, **proposed.model_dump(mode="json")}]}
