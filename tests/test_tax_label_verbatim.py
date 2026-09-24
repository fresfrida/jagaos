"""The tax on an invoice is recorded as the document names it, never coerced to
"GST" (2026-09-24, round 16, item 11: a regression test, no code change).

`InvoiceFields.tax_label` is filled by the extraction prompt ("verbatim as
printed ... never assumed to be GST") and nothing after it rewrites it:
verify.py's only tax check is numeric, and is gated to a Singapore company AND a
SGD-like currency. That was confirmed by reading the code; these tests pin it
through the real upload endpoint so a later change that starts defaulting or
normalising the label (or that runs the 9% arithmetic on a foreign invoice) fails
here. The model is canned, so this covers the deterministic code around it; the
prompt's own behaviour on a PPN invoice is
tests/test_gateway_live.py::test_a_ppn_invoice_keeps_its_tax_label_through_the_real_gateway.
"""

import io
import json

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

import app.graph.classify as classify_module
import app.graph.extract as extract_module
from app.db import get_conn
from app.llm import LLMResult
from app.main import app

client = TestClient(app)


def _tool(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(
        content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}],
    )


def _prov(value, confidence: float = 0.95):
    return {"value": value, "confidence": confidence, "page": 1}


def _pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(lines):
        c.drawString(72, 760 - i * 16, line)
    c.save()
    return buf.getvalue()


# (label as printed, currency, subtotal, tax, total, lines of the page)
CASES = {
    "ppn": ("PPN 11%", "IDR", 1000000.0, 110000.0, 1110000.0,
            ["PT Sumber Makmur", "Faktur Pajak", "Invoice No: INV-ID-77", "Date: 3 July 2026",
             "Subtotal: IDR 1000000", "PPN 11%: IDR 110000", "Total: IDR 1110000"]),
    "vat": ("VAT 20%", "GBP", 100.0, 20.0, 120.0,
            ["Thames Office Supplies Ltd", "VAT Invoice", "Invoice No: INV-UK-9", "Date: 3 July 2026",
             "Net: GBP 100.00", "VAT 20%: GBP 20.00", "Total: GBP 120.00"]),
    "sst": ("SST 6%", "MYR", 200.0, 12.0, 212.0,
            ["Kedai Alat Tulis Sdn Bhd", "Invoice No: INV-MY-3", "Date: 3 July 2026",
             "Subtotal: MYR 200.00", "SST 6%: MYR 12.00", "Total: MYR 212.00"]),
}


def _upload(monkeypatch, label: str | None, currency: str, subtotal: float, tax: float, total: float, lines: list[str]):
    def fake_classify(model, system, user, **kwargs):
        return _tool("classify_document", {
            "lane": "invoice", "doc_type": "invoice", "confidence": 0.95, "injection_suspected": False,
            "bucket": "Expenses", "vendor_name": "Overseas Vendor",
            "description": "Invoice from Overseas Vendor", "description_en": "Invoice from Overseas Vendor",
        }, model)

    def fake_extract(model, system, user, **kwargs):
        args = {"vendor": _prov("Overseas Vendor"), "invoice_no": _prov("INV-1"), "issued_on": _prov("2026-07-03"),
                "subtotal": _prov(subtotal), "tax": _prov(tax), "currency": _prov(currency), "total": _prov(total)}
        if label is not None:
            args["tax_label"] = _prov(label)
        return _tool("extract_invoice_fields", args, model)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    # A Singapore company (the default), so verify's SG 9% branch is live and would
    # fire on a foreign invoice if its currency gate were wrong.
    owner = client.post("/api/auth/dev-login", json={
        "email": f"owner-{currency.lower()}@tax.test", "company_name": "Tax Co", "fye_month": 12, "fye_day": 31}).json()
    headers = {"Authorization": f"Bearer {owner['token']}"}
    resp = client.post("/api/documents", headers=headers,
                       files={"file": ("foreign-invoice.pdf", _pdf(lines), "application/pdf")})
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]
    item = next(i for i in client.get("/api/review", headers=headers).json() if i["document_id"] == document_id)
    return document_id, item, headers


@pytest.mark.parametrize("case", CASES)
def test_a_foreign_invoice_keeps_the_tax_label_it_prints(monkeypatch, case):
    label, currency, subtotal, tax, total, lines = CASES[case]

    _, item, _ = _upload(monkeypatch, label, currency, subtotal, tax, total, lines)

    proposed = json.loads(item["proposed_json"])
    assert proposed["tax_label"]["value"] == label
    assert proposed["currency"]["value"] == currency
    assert "GST" not in json.dumps(proposed["tax_label"])


@pytest.mark.parametrize("case", CASES)
def test_verify_does_not_run_the_singapore_rate_check_on_a_foreign_invoice(monkeypatch, case):
    label, currency, subtotal, tax, total, lines = CASES[case]

    _, item, _ = _upload(monkeypatch, label, currency, subtotal, tax, total, lines)

    assert item["reason"] == "clean", f"a correct {currency} invoice must not be flagged: {item['reason']}"


@pytest.mark.parametrize("case", CASES)
def test_the_label_survives_confirmation_into_the_stored_fields(monkeypatch, case):
    label, currency, subtotal, tax, total, lines = CASES[case]
    document_id, item, headers = _upload(monkeypatch, label, currency, subtotal, tax, total, lines)

    resp = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
                       json={"action": "confirm", "corrected_fields": {}}, headers=headers)
    assert resp.status_code == 200, resp.text

    with get_conn() as conn:
        rows = conn.execute("SELECT field, value_text FROM extraction WHERE document_id = ? AND field = 'tax_label'",
                            (document_id,)).fetchall()
    assert [json.loads(r["value_text"]) for r in rows] == [label]


def test_no_tax_label_on_the_page_stays_absent_and_is_not_defaulted_to_gst(monkeypatch):
    _, item, _ = _upload(monkeypatch, None, "USD", 50.0, 0.0, 50.0,
                         ["Harbor Freight Co", "Invoice No: INV-US-1", "Date: 3 July 2026", "Total: USD 50.00"])

    label = json.loads(item["proposed_json"]).get("tax_label")  # absent, null, or a null value
    assert label is None or label["value"] in (None, "")
