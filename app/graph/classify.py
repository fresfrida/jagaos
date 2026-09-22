"""classify node. haiku, propose-only for lane/doc_type — but description,
bucket, and vendor_name ARE written directly here (organizational
metadata, not a compliance decision, unlike document/obligation status
which stays behind app/rules/transitions.py). Runs for every document
regardless of lane, unlike app/graph/extract.py (invoice/statutory only,
see its TOOLS_BY_LANE) — so this is the only place an important/memory
document (a lease, a photo) ever gets a description at all
(ARCHITECTURE.md §3).

bucket here is provisional for lane=invoice: classify runs before
extraction, so it doesn't know the vendor yet, and telling Receivables
apart from Expenses needs comparing the extracted vendor against the
company's own name. app/graph/extract.py corrects it deterministically
once that's known (2026-09-22, DECISIONS #42's amendment)."""

import json

from pydantic import ValidationError

from app.db import DB_PATH, get_conn, reindex_document_search
from app.graph.state import PipelineState
from app.guards.injection import UNTRUSTED_TEMPLATE, scan
from app.llm import call
from app.models import ClassifyResult, to_tool

TOOL = to_tool(
    ClassifyResult,
    "classify_document",
    "Classify a document into a lane, doc_type, and bucket, with a short "
    "human-readable description and the counterparty name if identifiable.",
)

SYSTEM = """You classify Singapore SME documents into one of four lanes:
statutory (ACRA/IRAS letters, notices, filings), invoice (bills, receipts),
important (contracts, leases, insurance), or memory (photos, notes with no
formal filing purpose).

doc_type:
- For lane=statutory: a specific free-text type naming the actual filing
  (e.g. "ACRA Certificate of Incorporation", "Notice of Change of
  Registered Office").
- For lane=invoice, important, or memory: pick exactly one of invoice,
  receipt, PO, quotation, delivery_order, contract, photo, other.

bucket — pick exactly one of Receivables, Expenses, Statutory, Operations,
"Memory Lane", Miscellaneous:
- lane=statutory -> Statutory
- lane=memory -> "Memory Lane"
- lane=important -> Operations
- lane=invoice -> Expenses (this is provisional — always use Expenses
  here even if the invoice looks like this company issued it; a
  deterministic check downstream corrects it to Receivables if so)
- Anything genuinely unclear -> Miscellaneous

Also write:
- description: one plain sentence a person would recognize at a glance,
  e.g. "Invoice from Acme Engineering for consulting services, $396" or
  "Office lease agreement with Marina Facilities Management". Describe
  what the document IS. Never comment on OCR quality, data completeness,
  or your own confidence in the description, bucket, or doc_type fields —
  confidence has its own dedicated field; a description like "invoice
  with incomplete or corrupted text" is wrong even if the text really is
  incomplete. If the text is too broken to tell what the document is,
  just say so plainly ("Photo of a document, text unclear") without
  editorializing about data quality.
- vendor_name: the counterparty this document is from/about (vendor,
  landlord, issuer) if identifiable from the text, e.g. "Acme Engineering
  Technology Pte Ltd". Leave it null if you can't tell — don't guess.

Call classify_document with your answer."""


def classify(state: PipelineState) -> PipelineState:
    text = state.get("text", "")
    regex_hits = scan(text)

    if not text.strip():
        # No OCR/extractable text (app/graph/ingest.py) — still needs a
        # sensible description, not an empty string a search box would
        # never surface.
        result = {"lane": "memory", "doc_type": "photo", "confidence": 0.3,
                   "injection_suspected": False, "description": "Untitled photo",
                   "bucket": "Memory Lane", "vendor_name": None}
    else:
        user = UNTRUSTED_TEMPLATE.format(document_text=text[:12000])
        # "haiku" is rejected by the gateway for this team's key — confirmed
        # live 2026-09-21 (GAPS.md's new §11): "Only the approved model is
        # allowed". sonnet4.5 is the only callable model; no cheap-routing
        # cost split is available.
        llm_result = call("sonnet4.5", SYSTEM, user, tools=[TOOL],
                           tool_choice={"type": "function", "function": {"name": "classify_document"}})
        args = json.loads(llm_result.tool_calls[0]["function"]["arguments"])
        try:
            result = ClassifyResult(**args).model_dump()
        except ValidationError:
            # Same class of bug app/graph/extract.py already found and
            # fixed (2026-09-21, GAPS.md §11): the model's tool call can
            # return something that doesn't quite match our schema —
            # bucket is a closed 6-value enum now, a new way for that to
            # happen. Route to review instead of a raw 500 (ARCHITECTURE.md
            # §12's "ask when unsure" applies to schema mismatches too);
            # Miscellaneous is the explicit catch-all for exactly this.
            lane = args.get("lane")
            result = {
                "lane": lane if lane in ("statutory", "invoice", "important", "memory") else "memory",
                "doc_type": str(args.get("doc_type") or "other"),
                "confidence": 0.3,
                "injection_suspected": bool(args.get("injection_suspected")),
                "description": str(args.get("description") or "Document could not be fully classified"),
                "bucket": "Miscellaneous",
                "vendor_name": None,
            }

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
            "UPDATE document SET lane = ?, doc_type = ?, status = 'proposed', "
            "description = ?, bucket = ?, vendor_name = ? WHERE id = ?",
            (result["lane"], result["doc_type"], result.get("description") or "",
             result["bucket"], result.get("vendor_name"), state["document_id"]),
        )

    reindex_document_search(state["document_id"], DB_PATH)

    return {"classify_result": result}
