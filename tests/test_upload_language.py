"""POST /api/documents?language=<code> end to end, gateway-free
(2026-09-24, round 10). classify.py's LLM call is replaced by a canned
tool call, so this checks the wiring that a real upload depends on — the
query param, its hop through the pipeline's state, the prompt the model is
sent, and what lands in document.description — without spending anything.

The pipeline-level counterpart (tests/test_pipeline_review_diagnostic.py's
language-passthrough test) goes through PIPELINE.invoke() but skips
app/main.py's own upload handler, which is where `language` is first read.
"""

import json

from fastapi.testclient import TestClient

import app.graph.classify as classify_module
import app.graph.ingest as ingest_module
from app.db import parse_description
from app.llm import LLMResult
from app.main import app

client = TestClient(app)

EN = "Office lease agreement with Marina Facilities Management"
MS = "Perjanjian pajakan pejabat dengan Marina Facilities Management"
DOCUMENT_TEXT = "LEASE AGREEMENT between Marina Facilities Management Pte Ltd and the Tenant."


def _signup(email: str, company_name: str) -> dict:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": company_name, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _upload(token: str, language: str | None, monkeypatch, sent_prompts: list[str]) -> dict:
    """Uploads one document and returns its row from GET /api/documents."""
    args = {
        "lane": "important", "doc_type": "contract", "confidence": 0.95,
        "injection_suspected": False, "bucket": "Operations",
        "vendor_name": "Marina Facilities Management Pte Ltd",
        "description_en": EN,
        "description": MS if language == "ms" else EN,
    }

    def fake_call(model, system, user, **kwargs):
        sent_prompts.append(system)
        return LLMResult(
            content="", model=model, input_tokens=10, output_tokens=5, cost_usd=0.0, latency_ms=1,
            tool_calls=[{"function": {"name": "classify_document", "arguments": json.dumps(args)}}],
        )

    monkeypatch.setattr(classify_module, "call", fake_call)
    monkeypatch.setattr(ingest_module, "_local_text", lambda path, media_type, ocr_max_edge=None: (DOCUMENT_TEXT, "pdfplumber"))

    suffix = f"?language={language}" if language else ""
    resp = client.post(
        f"/api/documents{suffix}",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("lease.pdf", b"%PDF-1.4 lease " + (language or "default").encode(), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["document_id"]
    rows = client.get("/api/documents", headers={"Authorization": f"Bearer {token}"}).json()
    return next(row for row in rows if row["id"] == document_id)


def test_upload_in_another_language_stores_english_and_that_language(monkeypatch):
    owner = _signup("uploadlang-ms@example.com", "Upload Lang MS Co")
    prompts: list[str] = []

    row = _upload(owner["token"], "ms", monkeypatch, prompts)

    assert parse_description(row["description"]) == {"en": EN, "ms": MS}
    # The model was actually asked for Malay, and told never to translate
    # extracted values — the stored text above only proves the mock's
    # answer was kept, this proves the language reached the prompt.
    assert len(prompts) == 1
    assert "Malay" in prompts[0]
    assert "never translate" in prompts[0]


def test_upload_without_a_language_param_stores_english_only(monkeypatch):
    owner = _signup("uploadlang-default@example.com", "Upload Lang Default Co")
    prompts: list[str] = []

    row = _upload(owner["token"], None, monkeypatch, prompts)

    assert parse_description(row["description"]) == {"en": EN}
    assert "English" in prompts[0]


def test_upload_in_english_does_not_store_the_same_sentence_twice(monkeypatch):
    owner = _signup("uploadlang-en@example.com", "Upload Lang EN Co")
    prompts: list[str] = []

    row = _upload(owner["token"], "en", monkeypatch, prompts)

    assert parse_description(row["description"]) == {"en": EN}
