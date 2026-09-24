"""verify node. Deterministic — no LLM (ARCHITECTURE.md §3/§6 adversarial
table). This is the guardrail chokepoint: it is the only LLM-adjacent node
allowed to write document/obligation state, and it never trusts a model's
self-reported injection_suspected flag alone — the regex scan in
app/guards/injection.py ran independently in classify/extract."""

import json
from decimal import Decimal
from pathlib import Path

from app.db import DB_PATH, get_conn
from app.graph.classify import UNREADABLE_EXAMPLE_EN
from app.graph.state import PipelineState
from app.guards.injection import quarantine, scan
from app.models import VerifyResult

CONFIDENCE_FLOOR = 0.6
# 2026-09-24 (item 10): renamed from GST_RATE/GST_TOLERANCE — this rate
# check is specifically Singapore's 9% GST, now gated on the company's
# own locality (_is_singapore_company below) rather than applied to every
# invoice unconditionally, regardless of the company's or the invoice's
# own country. An Indonesian invoice's real PPN (11%) would otherwise be
# compared against 9% and flagged as a "mismatch" it doesn't actually have.
SG_GST_RATE = Decimal("0.09")
SG_GST_TOLERANCE = Decimal("0.02")  # 2% tolerance for rounding
IMPLAUSIBLE_ZERO_TOLERANCE = Decimal("0.005")  # treat as "exactly 0" for float noise

# 2026-09-23 (live regression report, items 1/2/6): the stable reasons[]
# code when the source file itself is missing — a code, not a sentence
# (2026-09-23, items 7/8/10b restructure), so the frontend can exact-match
# it the same way it already did for the old literal string (ReviewQueueCard
# .tsx's isRoutine/isFileMissing). A missing file overrides every other
# check's result rather than joining them (see verify() below) — nothing
# else in this function is meaningful to report if there's no file to
# check it against, and this is what makes "file missing" and "no issues
# found" structurally unable to coexist, not just unlikely to.
FILE_MISSING_CODE = "file_missing"


def _check_file_exists(document_id: int, db_path: str = DB_PATH) -> list[dict]:
    """A stored_path that doesn't exist on disk anymore (2026-09-23, live
    regression report items 1/2/6) — confirmed live that a review card
    could show "no issues found" for a document whose file was gone,
    because nothing in this pipeline had ever checked "does the file
    still exist" as its own condition. Returns FILE_MISSING_CODE alone
    (not appended to other reasons) so verify() can treat it as an
    override, not just one more item in a joined list."""
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT stored_path FROM document WHERE id = ?", (document_id,)
        ).fetchone()
    if row is not None and not Path(row["stored_path"]).exists():
        return [{"code": FILE_MISSING_CODE, "params": {}}]
    return []


def _is_singapore_company(company_id: int, db_path: str = DB_PATH) -> bool:
    """The locality signal for item 10's conditional GST-rate check
    (2026-09-24). Piggybacks on company.timezone (item 2, DECISIONS #69's
    company-local-dates work) rather than adding a second, redundant
    locality field — every company in this product today genuinely is a
    Singapore SME (this app's whole premise, ARCHITECTURE.md/MOAT.md), and
    timezone is now a real per-company column instead of an assumption, so
    "is this company in Asia/Singapore" is a reasonable, already-available
    proxy for "is this a Singapore company" rather than a new one. Not a
    perfect signal (a company could technically operate elsewhere while
    keeping an SG timezone), stated explicitly as a call, not hidden."""
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT timezone FROM company WHERE id = ?", (company_id,)
        ).fetchone()
    return bool(row) and row["timezone"] == "Asia/Singapore"


def _looks_like_sgd(fields: dict) -> bool:
    """The invoice's own extracted `currency` (item 9) — None/missing
    counts as "assume SGD" (most invoices this deterministic check runs
    against today are undated-currency SG ones; a missing currency isn't
    itself evidence of a foreign one), but an explicit non-SGD value is
    real evidence the 9% SG GST rate was never going to apply to this
    specific document, regardless of which company uploaded it."""
    currency = fields.get("currency")
    value = currency.get("value") if isinstance(currency, dict) else None
    if not value:
        return True
    normalized = str(value).strip().upper()
    return normalized in ("SGD", "S$", "SG$", "$")


def _check_invoice_arithmetic(fields: dict, is_singapore_company: bool) -> list[dict]:
    reasons: list[dict] = []
    try:
        subtotal = Decimal(str(fields["subtotal"]["value"]))
        tax = Decimal(str(fields["tax"]["value"]))
        total = Decimal(str(fields["total"]["value"]))
    except (KeyError, TypeError):
        return [{"code": "missing_arithmetic_fields", "params": {}}]

    # 2026-09-23 (live regression report, item 4): all-zero amounts pass
    # _check_required_invoice_fields (added last round) as "present" —
    # 0 is not None — but a genuine invoice with subtotal=tax=total=0
    # is implausible regardless of currency/locality; this is almost
    # certainly a read failure, not a real zero-total invoice. Checked
    # here, alongside the existing arithmetic check, since it needs the
    # same three parsed Decimal values.
    if subtotal <= IMPLAUSIBLE_ZERO_TOLERANCE and tax <= IMPLAUSIBLE_ZERO_TOLERANCE and total <= IMPLAUSIBLE_ZERO_TOLERANCE:
        reasons.append({"code": "zero_amounts", "params": {}})

    # 2026-09-24 (item 10): the 9%-rate check is specifically Singapore's
    # GST rate. Gating on company locality ALONE doesn't actually fix the
    # scenario item 10's own bug report describes — a Singapore company
    # (which, per this product's whole premise, is every company that
    # exists today) can still receive a genuinely foreign invoice (an
    # Indonesian vendor's PPN at 11%), and company-locality-only gating
    # would keep comparing that against 9% regardless. Real fix needs both
    # signals: the company's own locality (is_singapore_company — the
    # dimension named in the ask) AND the specific invoice's own extracted
    # currency (item 9's new field — not SGD is real evidence this
    # particular document was never a 9%-GST one, independent of who
    # uploaded it). subtotal + tax == total, below, stays unconditional:
    # that's plain arithmetic true for any country's tax scheme, not a
    # Singapore-specific rate assumption.
    if is_singapore_company and _looks_like_sgd(fields):
        expected_tax = (subtotal * SG_GST_RATE).quantize(Decimal("0.01"))
        if abs(tax - expected_tax) > (expected_tax * SG_GST_TOLERANCE + Decimal("0.05")):
            reasons.append({"code": "gst_mismatch", "params": {
                "gst": str(tax), "subtotal": str(subtotal), "expectedGst": str(expected_tax),
            }})
    if abs((subtotal + tax) - total) > Decimal("0.02"):
        reasons.append({"code": "total_mismatch", "params": {
            "subtotalPlusGst": str(subtotal + tax), "total": str(total),
        }})
    return reasons


def _amount_strings(value: float) -> set[str]:
    """A few reasonable ways a numeric value might appear as literal text
    in a document — "110.00" (money format), "110.0", and "110" (a
    whole-number print with no decimals). Not exhaustive (no thousands
    separators, no currency symbols) — this only needs to catch the common
    cases; see _check_amounts_in_text's docstring for why an exhaustive
    match isn't the point."""
    d = Decimal(str(value))
    forms = {f"{d:.2f}", str(d)}
    if d == d.to_integral_value():
        forms.add(str(int(d)))
    return forms


def _check_amounts_in_text(fields: dict, text: str) -> list[dict]:
    """Deterministic cross-check, independent of what the model claims:
    subtotal/gst/total's extracted VALUES, not just their confidence, need
    to actually appear somewhere in the source text. Confirmed live
    2026-09-22 (Lightsail document id 14, "Ittibaa Glazing Enterprise Pte
    Ltd"): the model extracted subtotal=440/gst=39.6/total=479.6 at 92-93%
    confidence, filed with "no issues found" — the real printed values were
    SUBTOTAL 110.00/GST 0.00/TOTAL 110.00. 440 x 1.09 = 479.6, so the
    fabricated numbers were internally self-consistent — exactly why
    _check_invoice_arithmetic and the confidence floor both missed it.
    Grayscale/autocontrast OCR preprocessing didn't reliably recover the
    real numbers on this image either (a rounded-box summary layout
    Tesseract struggles with) — this needs a check independent of both the
    model's confidence and its own arithmetic. Deliberately conservative:
    only flags when ALL THREE values are absent from the text, not just
    one — a single absent value is unremarkable (OCR noise, a differently
    -formatted number) and would false-positive constantly; three-for-three
    absent is a much rarer, stronger signal of fabrication. Scoped to
    subtotal/gst/total only, never dates or names — those have too many
    legitimate reformatting variations (OCR digit/letter confusion, date
    format differences) to text-match reliably the same way plain numbers
    can."""
    values = []
    for field_name in ("subtotal", "tax", "total"):  # 2026-09-24: gst renamed to tax (item 10)
        field = fields.get(field_name)
        if isinstance(field, dict) and field.get("value") is not None:
            values.append(field["value"])
    if len(values) < 3:
        return []  # missing field(s) — _check_invoice_arithmetic's own "missing" reason already covers this
    any_found = any(candidate in text for value in values for candidate in _amount_strings(value))
    if any_found:
        return []
    return [{"code": "amounts_not_in_text", "params": {}}]


# 2026-09-23 (live regression report): none of the checks above notice
# when a document was simply never read at all — a document that lands
# on lane='memory' (classify.py's own confidence-0.3 "no OCR text"
# fallback, or the real LLM call choosing memory as its catch-all for
# text it can't make sense of) never reaches extract_result, so none of
# the invoice-specific checks above ever run, and there was structurally
# nothing else in this function capable of flagging it — confirmed by
# reading verify() in full before adding these. Three new, independent
# checks, each producing a reasons entry the same way the existing ones
# do (no new plumbing).
_DESCRIPTION_PROBLEM_WORDS = (
    "unreadable", "corrupted", "unclear", "illegible", "cannot be read",
    "not legible", "hard to read", "poor quality", "unrecognizable",
    # 2026-09-24 (round 10): the wording classify.py's prompt now asks the
    # model to use for unreadable/textless input (imported, not retyped, so
    # they cannot drift), plus the near-variants a model tends to produce
    # instead when it paraphrases it.
    UNREADABLE_EXAMPLE_EN.lower(), "no readable text", "no legible text",
)


def _check_classify_confidence(classify: dict, floor: float = CONFIDENCE_FLOOR) -> list[dict]:
    """Catches classify.py's own deterministic no-OCR-text fallback
    (confidence=0.3, description='Untitled photo') — the exact mechanism
    a sideways/unreadable photo falls into. `classify_result['confidence']`
    was never checked anywhere in this file before the check that added
    this function.

    2026-09-23 (live regression report, items 7/8): this call site was
    removed from verify() below on the reasoning that needs_review is
    already unconditional (DECISIONS #40), so a document whose only issue
    was low classification confidence still gets reviewed either way.
    **Reconnected the same day (DECISIONS #68)**: that removal had a real
    side effect neither round caught at the time — an unreadable document
    now produced zero reasons, so it fell through to the generic "No
    issues found," which actively misleads a reviewer looking at a
    document nobody could actually read. Reconnected, but with a genuinely
    new, plain-language code/params — no percentage, no "confidence"
    wording anywhere the user sees (params intentionally empty; the old
    `{"confidence": f"{confidence:.0%}"}` param is gone, not just hidden
    by the frontend)."""
    confidence = classify.get("confidence")
    if confidence is not None and confidence < floor:
        return [{"code": "could_not_read_document", "params": {}}]
    return []


def _check_description_signals_problem(description: str | None) -> list[dict]:
    """Plain-text heuristic, not a re-run of the LLM: classify.py's own
    system prompt explicitly instructs the model never to comment on OCR
    quality in its description ("a description like 'invoice with
    incomplete or corrupted text' is wrong") — confirmed live that the
    model doesn't always follow this. Rather than trying to out-prompt-
    engineer a live model this repo can't test without a real gateway
    call, this catches the cases where it still happens, deterministically,
    after the fact — the same "never silently trust the model" posture
    the injection/arithmetic checks above already take. Kept as a live
    reasons/question contributor (2026-09-23, items 7/8/10b) — unlike the
    two confidence-scoring checks, this is a content check on the model's
    own words, not a numeric score, so it stays in scope for the same
    reason the GST-mismatch/zero-amount/file-missing reasons do."""
    if not description:
        return []
    lowered = description.lower()
    hit = next((w for w in _DESCRIPTION_PROBLEM_WORDS if w in lowered), None)
    if hit:
        return [{"code": "description_signals_problem", "params": {"word": hit}}]
    return []


def _check_required_invoice_fields(fields: dict) -> list[dict]:
    """Defensive: InvoiceFields' vendor/issued_on/total are non-optional
    Provenance fields today, so a genuinely absent value would already
    fail Pydantic validation and route through the existing
    extract.get("error") check above — this mainly guards against a
    future schema change or an unexpected `_provenance_value` shape, at
    near-zero cost to add now rather than after it's needed."""
    missing = [name for name in ("vendor", "issued_on", "total") if not fields.get(name) or fields[name].get("value") is None]
    if missing:
        return [{"code": "missing_required_fields", "params": {"fields": ", ".join(missing)}}]
    return []


def verify(state: PipelineState) -> PipelineState:
    document_id = state["document_id"]
    classify = state.get("classify_result", {})
    extract = state.get("extract_result", {})
    text = state.get("text", "")

    reasons: list[dict] = []
    injection_hits = scan(text)
    model_flagged = bool(classify.get("injection_suspected") or extract.get("injection_suspected"))

    if injection_hits:
        # Regex-corroborated — deterministic and independent of the model,
        # so this stays a hard, unconditional quarantine (unchanged):
        # needs_review=False, so _route_after_verify (pipeline.py) still
        # routes straight to END, never through human_review — no
        # interrupt() ever runs for this thread_id, so no LangGraph
        # checkpoint ever exists for it (2026-09-23, DECISIONS #68).
        detail = f"regex={injection_hits}, model_flag={model_flagged}"
        quarantine(document_id, detail, DB_PATH)
        quarantine_reasons = [{"code": "injection_suspected_blocked", "params": {}}]
        result = VerifyResult(ok=False, reasons=quarantine_reasons, needs_review=False)
        with get_conn(DB_PATH) as conn:
            # 2026-09-23 (DECISIONS #68): this branch used to return here
            # without ever creating a review_item — confirmed live, that's
            # exactly why a quarantined upload vanished with zero feedback
            # anywhere (found via last round's "Last upload result" box
            # removal). Reuses the same INSERT the bottom of this function
            # already does for the normal reviewable path, not new
            # plumbing — proposed_json is "{}" (not extract_result):
            # a document flagged for injected instructions shouldn't have
            # its extracted field VALUES presented as trustworthy proposed
            # data to accept, on top of there being no Accept action for
            # this reason code anyway (ReviewQueueCard.tsx). This document
            # never reaches human_review (see above) — resolving this
            # review_item is handled directly in app/main.py::resolve_review
            # (checks document.status == 'quarantined' and archives it
            # without ever touching the pipeline), not via the 410/expired-
            # checkpoint path: confirmed live that resuming a thread whose
            # only checkpoint is this early-returned, already-completed
            # verify() run does NOT reliably raise LangGraph's
            # InvalidUpdateError the way a genuinely restarted session
            # does — it can silently no-op instead (see resolve_review's
            # own comment for the full story).
            conn.execute(
                "INSERT INTO review_item (company_id, document_id, reason, question, proposed_json, status) "
                "VALUES (?, ?, ?, ?, '{}', 'open')",
                (
                    state["company_id"], document_id,
                    "injection_suspected_blocked",
                    json.dumps(quarantine_reasons),
                ),
            )
            conn.execute(
                "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
                "VALUES (?, ?, ?, 'verify', 'quarantined')",
                (state["run_id"], state["company_id"], document_id),
            )
        return {"verify_result": result.model_dump()}

    if model_flagged:
        # Model-only self-flag, no regex corroboration. Confirmed live
        # 2026-09-22: an ordinary invoice's warranty/exchange-policy
        # boilerplate ("must be unused", "will not apply if...") tripped
        # this and was hard-quarantined with no way back — contradicting
        # this file's own docstring above, which already claimed the model's
        # self-report alone is never trusted. Route to the same reviewable
        # path as the GST/low-confidence checks below instead of a dead end.
        reasons.append({"code": "injection_suspected", "params": {}})

    if extract.get("error"):
        # extract.py caught a schema-validation failure instead of crashing
        # — that's still an extraction we can't trust, so it must not fall
        # through to "filed" the way a clean skip (extract.get("skipped"))
        # legitimately does.
        reasons.append({"code": "extraction_error", "params": {"detail": str(extract.get("reason", ""))}})

    if classify.get("lane") == "invoice" and extract and not extract.get("skipped") and not extract.get("error"):
        reasons.extend(_check_invoice_arithmetic(extract, _is_singapore_company(state["company_id"])))
        reasons.extend(_check_amounts_in_text(extract, text))
        reasons.extend(_check_required_invoice_fields(extract))

    # 2026-09-23 (items 7/8, then reconnected same day — DECISIONS #68):
    # _check_classify_confidence's contribution was removed here on the
    # reasoning that needs_review is already unconditional (DECISIONS
    # #40), so a low-confidence document still gets reviewed either way.
    # Reconnected after finding the real side effect: with no reasons at
    # all, an unreadable document fell through to the generic "no issues
    # found" text, which is actively misleading, not just less specific.
    # The function's own code/params changed too (could_not_read_document,
    # no params) — no percentage, not the old confidence-bearing text.
    reasons.extend(_check_classify_confidence(classify))
    # 2026-09-24 (items 5/6): reads description_en specifically, not
    # description — description is now generated in the uploader's
    # selected UI language (app/graph/classify.py), so this check's
    # English problem-word list ("unreadable", "corrupted", ...) would
    # silently stop matching anything for a non-English upload otherwise.
    # description_en is always English regardless of the selected
    # language, so this keeps working the same way for every language.
    reasons.extend(_check_description_signals_problem(classify.get("description_en")))

    # 2026-09-23 (live regression report, items 1/2/6): checked last and
    # deliberately OVERRIDES `reasons` rather than extending it — a
    # missing file makes every other signal above moot (there's nothing
    # left to check arithmetic, amounts, or confidence against), and this
    # override is what makes "file missing" and "no issues found"
    # structurally unable to coexist, not just unlikely to given the
    # checks above happen not to fire.
    file_missing = _check_file_exists(document_id)
    if file_missing:
        reasons = file_missing

    # 2026-09-22 (DECISIONS #40): no document is ever filed without an
    # explicit human confirmation, even a clean one — the only fully-
    # automatic path left is the hard injection_hits quarantine above.
    # needs_review is therefore unconditional here; `ok` stays tied to
    # `reasons` alone (not to needs_review) so a clean document is still
    # distinguishable from a flagged one downstream — the review form is
    # pre-populated either way, so confirming a clean document is one tap,
    # not a re-entry burden.
    needs_review = True
    ok = not bool(reasons)

    result = VerifyResult(ok=ok, reasons=reasons, needs_review=needs_review)

    with get_conn(DB_PATH) as conn:
        conn.execute("UPDATE document SET status = 'needs_review' WHERE id = ?", (document_id,))
        conn.execute(
            "INSERT INTO review_item (company_id, document_id, reason, question, proposed_json, status) "
            "VALUES (?, ?, ?, ?, ?, 'open')",
            (
                state["company_id"], document_id,
                # reason (2026-09-23): a short, stable debug/trace string —
                # codes joined, not the old full English sentence — kept
                # for anyone grepping the DB/trace directly. No longer
                # load-bearing for the frontend (see question below).
                "; ".join(r["code"] for r in reasons) if reasons else "clean",
                # question (2026-09-23, items 7/8/10b): now the structured
                # reasons themselves, JSON-encoded — the frontend parses
                # this and owns the translated phrasing via
                # ops.review.reasons.* i18n keys, since this backend has no
                # notion of the caller's language. Empty list = "no issues
                # found"; a lone {"code": "file_missing"} = the distinct
                # red file-missing headline — both derived by the frontend
                # from this array's shape, not a separate stored sentence.
                json.dumps(reasons),
                json.dumps(extract),
            ),
        )
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
            "VALUES (?, ?, ?, 'verify', 'needs_review')",
            (state["run_id"], state["company_id"], document_id),
        )

    return {"verify_result": result.model_dump()}
