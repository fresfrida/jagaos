"""verify node. Deterministic — no LLM (ARCHITECTURE.md §3/§6 adversarial
table). This is the guardrail chokepoint: it is the only LLM-adjacent node
allowed to write document/obligation state, and it never trusts a model's
self-reported injection_suspected flag alone — the regex scan in
app/guards/injection.py ran independently in classify/extract."""

import json
from decimal import Decimal

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.guards.injection import quarantine, scan
from app.models import VerifyResult

CONFIDENCE_FLOOR = 0.6
GST_RATE = Decimal("0.09")
GST_TOLERANCE = Decimal("0.02")  # 2% tolerance for rounding


def _check_invoice_arithmetic(fields: dict) -> list[str]:
    reasons = []
    try:
        subtotal = Decimal(str(fields["subtotal"]["value"]))
        gst = Decimal(str(fields["gst"]["value"]))
        total = Decimal(str(fields["total"]["value"]))
    except (KeyError, TypeError):
        return ["missing subtotal/gst/total — cannot verify arithmetic"]

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

    low_conf = _low_confidence_fields(extract) if extract else []
    if low_conf:
        reasons.append(f"low-confidence fields: {', '.join(low_conf)}")

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
    if reasons:
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
