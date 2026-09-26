"""GET /api/trace/{id} is the ENGINEERING view of one document (round 5, DECISIONS #125): the pipeline's trace rows plus the document's
own extracted fields, folded to the latest value per field. Round 6 (DECISIONS #129) took the trace out of the Company Files card
(the card's panel is a human History now), so nothing in the UI reads this endpoint; it stays for observability and is tested here.
The round-5 `trace_summary` on the list responses was replaced by `activity_summary` (tests/test_document_activity.py).

Pure DB + HTTP, no gateway key: documents and their trace/extraction rows are inserted directly (test_auth.py's own pattern).
"""

from fastapi.testclient import TestClient

from app.db import get_conn
from app.main import app

client = TestClient(app)


def _signup(email: str, company_name: str) -> dict:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": company_name, "fye_month": 12, "fye_day": 31},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _insert_document(conn, company_id: int, sha: str, filename: str, status: str = "filed") -> int:
    cur = conn.execute(
        "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, status) "
        "VALUES (?, ?, ?, 'application/pdf', 1, '/tmp/x', 'web', ?)",
        (company_id, sha, filename, status),
    )
    return cur.lastrowid


def test_trace_now_carries_the_documents_extraction_result_folded_to_last_wins():
    owner = _signup("traceextr-a@example.com", "Trace Extraction Co A")
    with get_conn() as conn:
        doc_id = _insert_document(conn, owner["company"]["id"], "traceextr-a-sha", "invoice.pdf")
        conn.execute(
            "INSERT INTO extraction (document_id, field, value_text, confidence, extractor_version, source) "
            "VALUES (?, 'vendor', 'Acme Pte Ltd', 0.92, 'v1', 'llm')",
            (doc_id,),
        )
        # A later, human-corrected row for the SAME field: extraction is append-only (app/db.py), so this must win,
        # not the model's original guess, and its source must say so.
        conn.execute(
            "INSERT INTO extraction (document_id, field, value_text, confidence, extractor_version, source) "
            "VALUES (?, 'vendor', 'Acme Private Limited', 1.0, 'v1', 'human')",
            (doc_id,),
        )
        conn.execute(
            "INSERT INTO extraction (document_id, field, value_num, confidence, extractor_version, source) "
            "VALUES (?, 'total', 436.0, 0.88, 'v1', 'llm')",
            (doc_id,),
        )

    resp = client.get(f"/api/trace/{doc_id}", headers=_auth_headers(owner["token"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_field = {e["field"]: e for e in body["extraction"]}
    assert by_field["vendor"]["value_text"] == "Acme Private Limited"
    assert by_field["vendor"]["source"] == "human"
    assert by_field["total"]["value_num"] == 436.0
    assert by_field["total"]["source"] == "llm"


def test_trace_extraction_is_an_empty_list_for_a_document_with_no_extracted_fields():
    owner = _signup("traceextr-b@example.com", "Trace Extraction Co B")
    with get_conn() as conn:
        doc_id = _insert_document(conn, owner["company"]["id"], "traceextr-b-sha", "photo.jpg")

    resp = client.get(f"/api/trace/{doc_id}", headers=_auth_headers(owner["token"]))
    assert resp.status_code == 200, resp.text
    assert resp.json()["extraction"] == []
