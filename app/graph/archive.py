"""archive node. Commits the run's summary trace (ARCHITECTURE.md §3).
Per-field provenance was already written by extract.py; this node's only
job is the closing trace row so a document's run is replayable end-to-end
in the trace panel (ARCHITECTURE.md §6/§7)."""

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState


def archive(state: PipelineState) -> PipelineState:
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
            "VALUES (?, ?, ?, 'archive', ?)",
            (
                state["run_id"], state["company_id"], state["document_id"],
                f"events={len(state.get('events', []))} "
                f"expectations={state.get('expectations_created', 0)} "
                f"obligations={state.get('obligations_created', 0)}",
            ),
        )
    return {}
