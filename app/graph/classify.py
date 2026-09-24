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
from typing import get_args

from pydantic import ValidationError

from app.db import DB_PATH, get_conn, reindex_document_search
from app.graph.derive_expectations import _slug
from app.graph.state import PipelineState
from app.guards.injection import scan, untrusted_prompt
from app.llm import MODEL_NAME, call
from app.models import BucketName, ClassifyResult, to_tool
from app.rules.expectations import LABEL_BY_DOC_TYPE, hint_label
from app.rules.grounding import ground_classification

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
statutory (letters, notices and filings from a company registry, regulator or
tax authority, and a company's own constitution), invoice (bills, receipts),
important (contracts, leases, insurance), or memory (photos, notes with no
formal filing purpose).

Ground everything in the text. Every organisation, person, place and product
name in description, description_en, doc_type and vendor_name must appear in
the document text below. Never say who issued a document unless the text says
so, and never name a registry, ministry or agency because documents of that
kind usually come from one: if the text does not name it, leave it out. A short
plain description is better than a fuller one that names something the page
does not.

doc_type:
- For lane=statutory: a specific free-text type naming the actual filing
  (e.g. "Certificate of Incorporation", "Notice of Change of Registered
  Office"). Do not put an authority's name or acronym in it unless the text
  prints it. A company's own business profile or BizFile, a printout stating
  its registered name, UEN, registered address and officers, is statutory
  with doc_type exactly "{company_profile_doc_type}". A company's own
  constitution (its memorandum and articles of association, or a document
  titled Constitution) is statutory too, even though the company wrote it and
  no authority issued it, with doc_type exactly "{company_constitution_doc_type}".
- For lane=invoice, important, or memory: pick exactly one of invoice,
  receipt, PO, quotation, delivery_order, contract, photo, other.

bucket — pick exactly one of {bucket_names}:
- lane=statutory -> Statutory
- lane=memory -> "Memory Lane"
- lane=important -> Contracts if it is a contract, lease, or agreement
  (doc_type contract); otherwise Operations (e.g. an insurance policy)
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
- vendor_name: the party that ISSUED or SOLD this document (vendor,
  landlord, sender), if the text names it, e.g. "Acme Engineering
  Technology Pte Ltd". The company a document is merely ABOUT is its
  subject, not its vendor: for a business profile, a registry printout, a
  certificate or a notice about a company, leave vendor_name null unless the
  text names a different issuer. Never fill it with the only company name in
  the text. Leave it null if the text does not say. This is a proper name
  copied exactly as printed, never translated or transliterated, regardless
  of what language `description` is in.

Call classify_document with your answer."""


# 2026-09-24 (round 12, DECISIONS #79): the statutory doc_type for a company's
# OWN identity document (a business profile / BizFile). doc_type is free
# text in the statutory lane (DECISIONS #45), so this is a convention the
# prompt asks for and is_company_profile_doc_type() matches leniently — the
# model may write "ACRA BizFile business profile" and still route correctly.
#
# Round 15 (DECISIONS #89): this was "ACRA Business Profile". The constant is
# put in front of the model verbatim, so a profile whose page never says "ACRA"
# still got an ACRA-labelled doc_type and an ACRA-flavoured description — the
# label was ours, not the page's. It names the document, not an issuer. Rows
# already stored as "ACRA Business Profile" still match (the test is a slug
# containing "business_profile").
# Defined once here and imported by app/graph/extract.py (which picks the
# extraction shape by it) and app/rules/company_profile.py (which decides who
# may pre-fill company settings from it), so the phrase cannot drift.
COMPANY_PROFILE_DOC_TYPE = "Business Profile"

# Round 18 (DECISIONS #93): the doc_type a company's own constitution must carry
# to satisfy the "Company Constitution" compliance-checklist row. It is the
# checklist rule's own label, read from rules/expectations.py rather than typed
# again here, so the prompt cannot drift from what derive_expectations matches
# (a plain substring test on the slug "constitution"; there is no exact-match gate
# like the business profile's, so this is a prompt string and not a helper).
COMPANY_CONSTITUTION_DOC_TYPE = LABEL_BY_DOC_TYPE["constitution"]
_COMPANY_PROFILE_SLUGS = ("business_profile", "bizfile")


def is_company_profile_doc_type(doc_type: str | None) -> bool:
    slug = _slug(doc_type or "")
    return any(marker in slug for marker in _COMPANY_PROFILE_SLUGS)


# Quoted when a name has a space, matching how the prompt has always written
# "Memory Lane". Built from the BucketName type so the prompt cannot list a
# bucket the model's answer would then fail validation against.
BUCKET_NAMES_FOR_PROMPT = ", ".join(
    f'"{name}"' if " " in name else name for name in get_args(BucketName)
)


# Round 16 (DECISIONS #90): appended when an upload was started from a compliance
# checklist item. The label comes from rules/expectations.py (never from the
# client), and the note says plainly that it is an expectation, not evidence, so
# a wrong hint cannot make the model call a lease a Certificate of Incorporation.
EXPECTED_DOCUMENT_NOTE = """

The uploader started this upload from a checklist item that asks for: "{label}".
That is what they EXPECT to be uploading, not evidence of what this is. Classify
from the text exactly as you otherwise would. Only if the text really is that
kind of document, use that wording (or its closest plain form) as doc_type when
the lane is statutory. If the text is something else, ignore this note entirely."""


def render_system_prompt(language_name: str, expected_document: str | None = None) -> str:
    prompt = SYSTEM_TEMPLATE.format(
        language_name=language_name,
        unreadable_example=UNREADABLE_EXAMPLE_EN,
        bucket_names=BUCKET_NAMES_FOR_PROMPT,
        company_profile_doc_type=COMPANY_PROFILE_DOC_TYPE,
        company_constitution_doc_type=COMPANY_CONSTITUTION_DOC_TYPE,
    )
    return prompt + EXPECTED_DOCUMENT_NOTE.format(label=expected_document) if expected_document else prompt


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
        user = untrusted_prompt(text)
        system = render_system_prompt(language_name, hint_label(state.get("doc_type_hint")))
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

        # Round 15 (DECISIONS #89): what the model WROTE about this document may only
        # name things the document itself names. Done here, before anything is
        # persisted, so an invented name is never stored or full-text indexed (a
        # check in verify.py would run after the description was already written).
        # Deterministic; app/rules/grounding.py has the rules and why they are
        # narrow. The raw doc_type decides "this kind of document has no vendor",
        # so it is read before the check trims it.
        with get_conn(DB_PATH) as conn:
            company = conn.execute("SELECT name FROM company WHERE id = ?", (state["company_id"],)).fetchone()
        result, grounding_notes = ground_classification(
            result, text, company_name=company["name"] if company else None,
            subject_only=is_company_profile_doc_type(result.get("doc_type")),
        )

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
            if grounding_notes:
                # Visible in the trace panel, so "why does this description read so
                # plainly" has an answer without reading the code.
                conn.execute(
                    "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
                    "VALUES (?, ?, ?, 'classify_grounding', ?)",
                    (state["run_id"], state["company_id"], state["document_id"], "; ".join(grounding_notes)[:1000]),
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
        english = result.get("description_en") or result["description"]
        by_language = {"en": english}
        # Only a translation that IS different is stored: grounding may replace
        # both languages with one English sentence (round 15), and a second key
        # holding the same English text would claim a translation that is not one.
        if language != "en" and result["description"] != english:
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
