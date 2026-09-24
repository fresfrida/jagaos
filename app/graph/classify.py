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
once that's known (2026-09-22, DECISIONS #42's amendment).

2026-09-23 (DECISIONS #52): when state["is_picture"] is set (the
upload-time "is this a picture?" toggle, app/main.py), this node skips
the LLM call entirely and sets lane/doc_type/bucket by fixed rule instead
— the gateway this hackathon provides cannot see images at all
(MDs/GAPS.md §8), so there was never a question for it to answer here for
that case; the human's toggle already is the answer."""

import json

from pydantic import ValidationError

from app.db import DB_PATH, get_conn, reindex_document_search
from app.graph.state import PipelineState
from app.guards.injection import UNTRUSTED_TEMPLATE, scan
from app.llm import MODEL_NAME, call
from app.models import ClassifyResult, to_tool

TOOL = to_tool(
    ClassifyResult,
    "classify_document",
    "Classify a document into a lane, doc_type, and bucket, with a short "
    "human-readable description (in the requesting language, and in "
    "English) and the counterparty name if identifiable.",
)

# 2026-09-24 (item 5): the uploader's selected UI language
# (web/src/i18n.ts's SUPPORTED_LANGUAGES, sent as a new upload param —
# app/main.py) reaches this prompt so classify.py's generated prose
# (description) comes out directly in that language, instead of always
# generating English and needing a separate translation step afterward.
# Full names, not just codes — "zh" alone is ambiguous about which
# Chinese; explicit names leave no room for the model to guess wrong.
LANGUAGE_NAMES = {
    "en": "English",
    "zh": "Simplified Chinese",
    "ms": "Malay",
    "ta": "Tamil",
}

# 2026-09-24 (item 6): the empty-text/no-OCR-text deterministic fallback
# below never calls the LLM at all, but its placeholder description
# should still honor the same "generated in the uploader's language"
# contract items 5/6 establish for the real LLM path.
UNTITLED_PHOTO_BY_LANGUAGE = {
    "en": "Untitled photo",
    "zh": "无标题照片",
    "ms": "Foto tanpa tajuk",
    "ta": "தலைப்பிடப்படாத புகைப்படம்",
}

# 2026-09-24 (round 10): what the model is told to write in description_en
# when OCR text is empty/garbled/too short to identify anything. Defined
# once and imported by app/graph/verify.py's problem-word detector, so the
# phrase the prompt asks for is by construction one the "needs a human's
# plain-language check" heuristic recognizes — reword it here and both move
# together. Deliberately does not say "document": the same OCR-noise input
# comes from a photo of a room or a piece of furniture, and this gateway is
# text-only (MDs/GAPS.md §8) — nothing here can know which it was. The old
# example ("Photo of a document, text unclear") presupposed a document, and
# the model echoed it for scenes that were plainly not paperwork.
UNREADABLE_EXAMPLE_EN = "Image with no clear readable text"

SYSTEM_TEMPLATE = """You classify Singapore SME documents into one of four lanes:
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
  incomplete. Write this in {language_name}.
  You only ever see OCR text, never the image itself. If that text is
  empty, garbled, or too short to tell what this is, do NOT assume it came
  from a document — it may be a photograph of a room, an object or a
  person that simply contains no text — and never guess what a picture
  shows. In that case description_en must be exactly
  "{unreadable_example}" (write `description` as the same sentence in
  {language_name}), lane memory, doc_type other, and confidence 0.3 or
  lower.
- description_en: the exact same description, in English, regardless of
  what language you wrote `description` in above. If {language_name} is
  already English, write the identical sentence in both fields.
- vendor_name: the counterparty this document is from/about (vendor,
  landlord, issuer) if identifiable from the text, e.g. "Acme Engineering
  Technology Pte Ltd". Leave it null if you can't tell — don't guess.
  This is a proper name copied exactly as printed — never translate or
  transliterate it, regardless of what language `description` is in.

Call classify_document with your answer."""


def classify(state: PipelineState) -> PipelineState:
    text = state.get("text", "")
    regex_hits = scan(text)
    # 2026-09-24 (item 5): defaults to English, same convention every
    # other language-aware default in this codebase uses (app/db.py's
    # description helpers, DocumentEditRequest.language).
    language = state.get("language") or "en"
    language_name = LANGUAGE_NAMES.get(language, "English")

    if state.get("is_picture"):
        # 2026-09-23: the human already answered, at upload time, the only
        # question this node exists to answer for this document ("what
        # kind of thing is this") — no LLM call needed, and the gateway
        # this hackathon provides is confirmed structurally unable to see
        # images anyway (MDs/GAPS.md §8: four formats tested, all silently
        # dropped). description stays None (not "", not a guessed
        # sentence) until a human supplies a caption or a future local
        # vision model does — the frontend renders that as an explicit "no
        # caption yet" state rather than silently looking blank. No trace
        # row is inserted here, matching app/graph/extract.py's own
        # no-op-skip convention (its `{"skipped": True, ...}` branch below
        # doesn't insert one either) — this is how a test confirms no
        # gateway call happened for this path: zero classify trace rows.
        result = {"lane": "memory", "doc_type": "photo", "confidence": 1.0,
                   "injection_suspected": False, "description": None, "description_en": None,
                   "bucket": "Memory Lane", "vendor_name": None}
    elif not text.strip():
        # No OCR/extractable text (app/graph/ingest.py) — still needs a
        # sensible description, not an empty string a search box would
        # never surface.
        result = {"lane": "memory", "doc_type": "photo", "confidence": 0.3,
                   "injection_suspected": False,
                   "description": UNTITLED_PHOTO_BY_LANGUAGE.get(language, "Untitled photo"),
                   "description_en": "Untitled photo",
                   "bucket": "Memory Lane", "vendor_name": None}
    else:
        user = UNTRUSTED_TEMPLATE.format(document_text=text[:12000])
        system = SYSTEM_TEMPLATE.format(
            language_name=language_name, unreadable_example=UNREADABLE_EXAMPLE_EN,
        )
        # "haiku" is rejected by the gateway for this team's key — confirmed
        # live 2026-09-21 (GAPS.md's new §11): "Only the approved model is
        # allowed". sonnet4.5 is the only callable model; no cheap-routing
        # cost split is available.
        llm_result = call(MODEL_NAME, system, user, tools=[TOOL],
                           tool_choice={"type": "function", "function": {"name": "classify_document"}})
        # 2026-09-24: same guard as app/graph/extract.py's identical call
        # site (see its comment) — confirmed live the model can return zero
        # tool calls despite tool_choice forcing one, which raised a raw
        # TypeError (500) here before ever reaching the ValidationError
        # handling one line below. args = {} reaches that same handling,
        # not a new code path.
        args = json.loads(llm_result.tool_calls[0]["function"]["arguments"]) if llm_result.tool_calls else {}
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
            fallback_description = str(args.get("description") or "Document could not be fully classified")
            result = {
                "lane": lane if lane in ("statutory", "invoice", "important", "memory") else "memory",
                "doc_type": str(args.get("doc_type") or "other"),
                "confidence": 0.3,
                "injection_suspected": bool(args.get("injection_suspected")),
                "description": fallback_description,
                # 2026-09-24: args itself may not have this (that's plausibly
                # *why* validation failed) — falls back to the same text
                # description already has rather than leaving English blank.
                "description_en": str(args.get("description_en") or fallback_description),
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

    # 2026-09-24 (items 5/6): document.description is now JSON-encoded
    # {"en": "...", "<language>": "..."} (app/db.py's parse_description/
    # description_for) — description stays None only for the is_picture
    # bypass above (an explicit "pending caption" state, unchanged); every
    # other branch produces both description/description_en, deduped into
    # a single "en" key when the selected language already is English
    # rather than storing the same sentence under two keys.
    description_json = None
    if result.get("description") is not None:
        by_language = {"en": result.get("description_en") or result["description"]}
        if language != "en":
            by_language[language] = result["description"]
        description_json = json.dumps(by_language)

    with get_conn(DB_PATH) as conn:
        conn.execute(
            "UPDATE document SET lane = ?, doc_type = ?, status = 'proposed', "
            "description = ?, bucket = ?, vendor_name = ? WHERE id = ?",
            (result["lane"], result["doc_type"], description_json,
             result["bucket"], result.get("vendor_name"), state["document_id"]),
        )

    reindex_document_search(state["document_id"], DB_PATH)

    return {"classify_result": result}
