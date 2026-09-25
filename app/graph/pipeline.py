"""The agent graph. ARCHITECTURE.md §3:

    ingest -> classify -> extract -> verify -+-> derive_events -> archive
                                              |         |
                                        (needs_review)  v
                                              |   derive_expectations
                                              v         |
                                       human_review     v
                                              |   [derive_obligations]   <- NOT in the graph (see below)
                                              +---------+
                                                    |
                                                    v
                                                 archive

`derive_obligations` (company FYE -> the statutory clock -> dated duties) is switched OFF (DECISIONS #108): nothing is computed
from a company's financial year end for now, because the intended source of obligations is a future ACRA API integration. It is
switched off at the WIRING, not deleted: the node (app/graph/derive_obligations.py) and the rules under it
(app/rules/statutory.py) are unchanged and still tested on their own, and turning it back on is one constant
(DERIVE_OBLIGATIONS_ENABLED below). With it off, derive_expectations goes straight to archive and no new `obligation` row is
ever created; rows already in a database are left alone and still served by GET /api/obligations.

`ingest` runs before the graph (app/main.py) because it creates the
document row the rest of state is keyed on. Everything from `classify`
onward is one compiled StateGraph so a single trace run_id covers the whole
document.

Checkpointer is in-memory for the sprint (MemorySaver) — a review pending
across a server restart is lost. Swap for a SQLite checkpointer before
relying on this past a demo session (see LIGHTSAIL.md's single-box constraint
for why SQLite, not Redis).
"""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from app.graph.archive import archive
from app.graph.classify import classify
from app.graph.derive_events import derive_events
from app.graph.derive_expectations import derive_expectations
from app.graph.derive_obligations import derive_obligations
from app.graph.extract import extract
from app.graph.human_review import human_review
from app.graph.state import PipelineState
from app.graph.verify import verify


def _route_after_verify(state: PipelineState) -> str:
    if state.get("verify_result", {}).get("needs_review"):
        return "human_review"
    if not state.get("verify_result", {}).get("ok", True):
        # quarantined — stop, don't derive events from a hostile document
        return END
    return "derive_events"


def _route_after_human_review(state: PipelineState) -> str:
    resolution = state.get("review_resolution") or {}
    if resolution.get("action") == "reject":
        # A rejected document shouldn't inform the company's events or
        # obligations — stop here, same as a quarantined one.
        return END
    return "derive_events"


# DECISIONS #108. Flip to True to put the obligations node back between derive_expectations and archive.
DERIVE_OBLIGATIONS_ENABLED = False


def build_graph(derive_obligations_enabled: bool = DERIVE_OBLIGATIONS_ENABLED):
    graph = StateGraph(PipelineState)
    graph.add_node("classify", classify)
    graph.add_node("extract", extract)
    graph.add_node("verify", verify)
    graph.add_node("human_review", human_review)
    graph.add_node("derive_events", derive_events)
    graph.add_node("derive_expectations", derive_expectations)
    graph.add_node("archive", archive)

    graph.set_entry_point("classify")
    graph.add_edge("classify", "extract")
    graph.add_edge("extract", "verify")
    graph.add_conditional_edges("verify", _route_after_verify,
                                 {"human_review": "human_review", "derive_events": "derive_events", END: END})
    graph.add_conditional_edges("human_review", _route_after_human_review,
                                 {"derive_events": "derive_events", END: END})
    graph.add_edge("derive_events", "derive_expectations")
    if derive_obligations_enabled:
        graph.add_node("derive_obligations", derive_obligations)
        graph.add_edge("derive_expectations", "derive_obligations")
        graph.add_edge("derive_obligations", "archive")
    else:
        graph.add_edge("derive_expectations", "archive")
    graph.add_edge("archive", END)

    return graph.compile(checkpointer=MemorySaver())


PIPELINE = build_graph()
