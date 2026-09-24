"""derive_events node. sonnet4.5 proposes; rules.transitions/db confirm the
write (ARCHITECTURE.md §3, §12 row 3: "read prose for future commitments" —
the hardest and most valuable use of the model in this pipeline).

Only runs on the statutory lane for now. Invoice/important/memory lanes
don't carry life-event information worth a model call — cutting this per
WINNING.md Part 3 ("build only what demonstrates the criteria").

2026-09-24 (round 13, DECISIONS #84): this node used to return early when
`verify_result.needs_review` was true. That flag is a snapshot from BEFORE the
human's review, and since DECISIONS #40 made it unconditionally true for every
document, the check was permanently true — the node silently did nothing for
every document from 2026-09-22 on, including ones a person had confirmed. It
was also redundant: app/graph/pipeline.py's routing (`_route_after_verify`,
`_route_after_human_review`) already decides whether a document reaches this
node at all — a quarantined one ends the run, a rejected one ends the run — so
arriving here already means "confirmed, not rejected, not quarantined". The
check is gone; the lane check stays."""

import json

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.guards.injection import untrusted_prompt
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


def _trace_skip(state: PipelineState, reason: str) -> None:
    """A statutory document that reaches this node and is NOT read must leave a
    row saying why. The silent version of that is exactly how the node stayed
    dead for two days unnoticed (DECISIONS #84); with a trace row the trace panel
    shows the skip, and a test can assert it. Non-statutory lanes are skipped by
    design and deliberately get no row (one per invoice would be noise)."""
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
            "VALUES (?, ?, ?, 'derive_events', ?)",
            (state["run_id"], state["company_id"], state["document_id"], f"skipped_{reason}"),
        )


def derive_events(state: PipelineState) -> PipelineState:
    if state.get("classify_result", {}).get("lane") != "statutory":
        return {"events": []}
    # A personal file (visibility 'only_me', DECISIONS #85) does not feed company
    # state: an event proposed from it would be a company record derived from a
    # document nobody else can see. Loud, not silent — see _trace_skip.
    if state.get("visibility", "company") != "company":
        _trace_skip(state, "personal_file")
        return {"events": []}

    user = untrusted_prompt(state.get("text", ""))
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
