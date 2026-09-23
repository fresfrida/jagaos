"""verify node. Deterministic — no LLM (ARCHITECTURE.md §3/§6 adversarial
table). This is the guardrail chokepoint: it is the only LLM-adjacent node
allowed to write document/obligation state, and it never trusts a model's
self-reported injection_suspected flag alone — the regex scan in
app/guards/injection.py ran independently in classify/extract."""

import json
from decimal import Decimal
from pathlib import Path

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.guards.injection import quarantine, scan
from app.models import VerifyResult

CONFIDENCE_FLOOR = 0.6
GST_RATE = Decimal("0.09")
GST_TOLERANCE = Decimal("0.02")  # 2% tolerance for rounding
IMPLAUSIBLE_ZERO_TOLERANCE = Decimal("0.005")  # treat as "exactly 0" for float noise

# 2026-09-23 (live regression report, items 1/2/6): the exact literal
# reasons[] string when the source file itself is missing — kept short
# and stable (not the full user-facing sentence) so the frontend can
# exact-match on it the same way it already does for "clean extraction"
# (ReviewQueueCard.tsx's isRoutine). A missing file overrides every other
# check's result rather than joining them (see verify() below) — nothing
# else in this function is meaningful to report if there's no file to
# check it against, and this is what makes "file missing" and "no issues
# found" structurally unable to coexist, not just unlikely to.
FILE_MISSING_REASON = "the source file is missing from storage"


def _check_file_exists(document_id: int, db_path: str = DB_PATH) -> list[str]:
    """A stored_path that doesn't exist on disk anymore (2026-09-23, live
    regression report items 1/2/6) — confirmed live that a review card
    could show "no issues found" for a document whose file was gone,
    because nothing in this pipeline had ever checked "does the file
    still exist" as its own condition. Returns FILE_MISSING_REASON alone
    (not appended to other reasons) so verify() can treat it as an
    override, not just one more item in a joined list."""
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT stored_path FROM document WHERE id = ?", (document_id,)
        ).fetchone()
    if row is not None and not Path(row["stored_path"]).exists():
        return [FILE_MISSING_REASON]
    return []


def _check_invoice_arithmetic(fields: dict) -> list[str]:
    reasons = []
    try:
        subtotal = Decimal(str(fields["subtotal"]["value"]))
        gst = Decimal(str(fields["gst"]["value"]))
        total = Decimal(str(fields["total"]["value"]))
    except (KeyError, TypeError):
        return ["missing subtotal/gst/total — cannot verify arithmetic"]

    # 2026-09-23 (live regression report, item 4): all-zero amounts pass
    # _check_required_invoice_fields (added last round) as "present" —
    # 0 is not None — but a genuine SGD invoice with subtotal=GST=total=0
    # is implausible; this is almost certainly a read failure, not a real
    # zero-total invoice. Checked here, alongside the existing arithmetic
    # check, since it needs the same three parsed Decimal values.
    if subtotal <= IMPLAUSIBLE_ZERO_TOLERANCE and gst <= IMPLAUSIBLE_ZERO_TOLERANCE and total <= IMPLAUSIBLE_ZERO_TOLERANCE:
        reasons.append("subtotal/GST/total are all zero — this looks like a failed read, not a real zero-value invoice")

    expected_gst = (subtotal * GST_RATE).quantize(Decimal("0.01"))
    if abs(gst - expected_gst) > (expected_gst * GST_TOLERANCE + Decimal("0.05")):
        reasons.append(f"GST {gst} is not ~9% of subtotal {subtotal} (expected ~{expected_gst})")
    if abs((subtotal + gst) - total) > Decimal("0.02"):
        reasons.append(f"subtotal + GST ({subtotal + gst}) != total ({total})")
    return reasons


def _low_confidence_fields(fields: dict, floor: float = CONFIDENCE_FLOOR) -> list[str]:
    low = []
    for name, value in fields.items():
        if isinstance(value, dict) and "confidence" in value:
            if value["confidence"] < floor:
                low.append(name)
    return low


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


def _check_amounts_in_text(fields: dict, text: str) -> list[str]:
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
    for field_name in ("subtotal", "gst", "total"):
        field = fields.get(field_name)
        if isinstance(field, dict) and field.get("value") is not None:
            values.append(field["value"])
    if len(values) < 3:
        return []  # missing field(s) — _check_invoice_arithmetic's own "missing" reason already covers this
    any_found = any(candidate in text for value in values for candidate in _amount_strings(value))
    if any_found:
        return []
    return [
        "extracted amounts weren't found anywhere in the document's text "
        "— please double-check these against the image before confirming"
    ]


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
)


def _check_classify_confidence(classify: dict, floor: float = CONFIDENCE_FLOOR) -> list[str]:
    """Catches classify.py's own deterministic no-OCR-text fallback
    (confidence=0.3, description='Untitled photo') — the exact mechanism
    a sideways/unreadable photo falls into. `classify_result['confidence']`
    was never checked anywhere in this file before this; only extract's
    per-field confidences were (_low_confidence_fields below)."""
    confidence = classify.get("confidence")
    if confidence is not None and confidence < floor:
        return [f"low-confidence classification ({confidence:.0%}) — the document type/description may not be reliable, please check"]
    return []


def _check_description_signals_problem(description: str | None) -> list[str]:
    """Plain-text heuristic, not a re-run of the LLM: classify.py's own
    system prompt explicitly instructs the model never to comment on OCR
    quality in its description ("a description like 'invoice with
    incomplete or corrupted text' is wrong") — confirmed live that the
    model doesn't always follow this. Rather than trying to out-prompt-
    engineer a live model this repo can't test without a real gateway
    call, this catches the cases where it still happens, deterministically,
    after the fact — the same "never silently trust the model" posture
    the injection/arithmetic checks above already take."""
    if not description:
        return []
    lowered = description.lower()
    hit = next((w for w in _DESCRIPTION_PROBLEM_WORDS if w in lowered), None)
    if hit:
        return [f"description signals a possible extraction problem (\"{hit}\") — please check this document was read correctly"]
    return []


def _check_required_invoice_fields(fields: dict) -> list[str]:
    """Defensive: InvoiceFields' vendor/issued_on/total are non-optional
    Provenance fields today, so a genuinely absent value would already
    fail Pydantic validation and route through the existing
    extract.get("error") check above — this mainly guards against a
    future schema change or an unexpected `_provenance_value` shape, at
    near-zero cost to add now rather than after it's needed."""
    missing = [name for name in ("vendor", "issued_on", "total") if not fields.get(name) or fields[name].get("value") is None]
    if missing:
        return [f"missing required field(s): {', '.join(missing)}"]
    return []


def verify(state: PipelineState) -> PipelineState:
    document_id = state["document_id"]
    classify = state.get("classify_result", {})
    extract = state.get("extract_result", {})
    text = state.get("text", "")

    reasons: list[str] = []
    injection_hits = scan(text)
    model_flagged = bool(classify.get("injection_suspected") or extract.get("injection_suspected"))

    if injection_hits:
        # Regex-corroborated — deterministic and independent of the model,
        # so this stays a hard, unconditional quarantine (unchanged).
        detail = f"regex={injection_hits}, model_flag={model_flagged}"
        quarantine(document_id, detail, DB_PATH)
        result = VerifyResult(ok=False, reasons=[f"injection suspected: {detail}"], needs_review=False)
        with get_conn(DB_PATH) as conn:
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
        reasons.append(
            "the model flagged this document as possibly containing "
            "injected instructions — please confirm it's safe before it proceeds"
        )

    if extract.get("error"):
        # extract.py caught a schema-validation failure instead of crashing
        # — that's still an extraction we can't trust, so it must not fall
        # through to "filed" the way a clean skip (extract.get("skipped"))
        # legitimately does.
        reasons.append(f"extraction error: {extract['reason']}")

    if classify.get("lane") == "invoice" and extract and not extract.get("skipped") and not extract.get("error"):
        reasons.extend(_check_invoice_arithmetic(extract))
        reasons.extend(_check_amounts_in_text(extract, text))
        reasons.extend(_check_required_invoice_fields(extract))

    low_conf = _low_confidence_fields(extract) if extract else []
    if low_conf:
        reasons.append(f"low-confidence fields: {', '.join(low_conf)}")

    # Unconditional, unlike the block above — these two catch a document
    # that never reached extract_result at all (lane='memory'), which is
    # exactly the "renders like a generic picture, nothing extracted"
    # regression this was added for (2026-09-23).
    reasons.extend(_check_classify_confidence(classify))
    reasons.extend(_check_description_signals_problem(classify.get("description")))

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
    if file_missing:
        # Distinct headline (2026-09-23), not folded into the generic
        # "Please confirm: " phrasing — ReviewQueueCard.tsx exact-matches
        # review_item.reason against FILE_MISSING_REASON (mirrors the
        # existing isRoutine === 'clean extraction' pattern) to give this
        # its own, more severe visual treatment instead of the routine
        # amber "please confirm" styling.
        question = "File missing — delete or re-upload this document."
    elif reasons:
        question = "Please confirm: " + "; ".join(reasons)
    else:
        question = "No issues found. Please confirm the extracted fields below are correct before filing."

    result = VerifyResult(ok=ok, reasons=reasons, needs_review=needs_review,
                           review_question=question)

    with get_conn(DB_PATH) as conn:
        conn.execute("UPDATE document SET status = 'needs_review' WHERE id = ?", (document_id,))
        conn.execute(
            "INSERT INTO review_item (company_id, document_id, reason, question, proposed_json, status) "
            "VALUES (?, ?, ?, ?, ?, 'open')",
            (state["company_id"], document_id, "; ".join(reasons) if reasons else "clean extraction",
             question, json.dumps(extract)),
        )
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
            "VALUES (?, ?, ?, 'verify', 'needs_review')",
            (state["run_id"], state["company_id"], document_id),
        )

    return {"verify_result": result.model_dump()}
