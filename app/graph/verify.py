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

    if injection_hits or classify.get("injection_suspected") or extract.get("injection_suspected"):
        detail = f"regex={injection_hits}, model_flag={classify.get('injection_suspected') or extract.get('injection_suspected')}"
        quarantine(document_id, detail, DB_PATH)
        result = VerifyResult(ok=False, reasons=[f"injection suspected: {detail}"], needs_review=False)
        with get_conn(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
                "VALUES (?, ?, ?, 'verify', 'quarantined')",
                (state["run_id"], state["company_id"], document_id),
            )
        return {"verify_result": result.model_dump()}

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

    needs_review = bool(reasons)
    question = None
    if needs_review:
        question = "Please confirm: " + "; ".join(reasons)

    result = VerifyResult(ok=not needs_review, reasons=reasons, needs_review=needs_review,
                           review_question=question)

    with get_conn(DB_PATH) as conn:
        new_status = "needs_review" if needs_review else "filed"
        conn.execute("UPDATE document SET status = ? WHERE id = ?", (new_status, document_id))
        if needs_review:
            conn.execute(
                "INSERT INTO review_item (company_id, document_id, reason, question, proposed_json, status) "
                "VALUES (?, ?, ?, ?, ?, 'open')",
                (state["company_id"], document_id, "; ".join(reasons), question,
                 json.dumps(extract)),
            )
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
            "VALUES (?, ?, ?, 'verify', ?)",
            (state["run_id"], state["company_id"], document_id,
             "needs_review" if needs_review else "ok"),
        )

    return {"verify_result": result.model_dump()}
