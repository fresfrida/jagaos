"""Round 5, item 6 (DECISIONS #125): a card's collapsed "AI trace · N steps · $X" summary needs no per-card fetch,
so GET /api/documents (and /api/personal-files, /api/search) now carries a `trace_summary` per document — one
grouped query for the whole page, confirmed here to actually be one query, not N. And item 3c-i: GET /api/trace/{id}
now also returns the document's folded, "last wins" extraction fields, so a person can check the AI's actual result
against the source, not just see that a step ran.

Pure DB + HTTP, no gateway key: documents and their trace/extraction rows are inserted directly (test_auth.py's own
pattern), not produced by a real pipeline run.
"""

from unittest.mock import patch

from fastapi.testclient import TestClient

import app.main as main_module
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


def test_a_document_with_two_trace_rows_shows_two_steps_and_their_summed_cost(tmp_path):
    owner = _signup("tracesum-a@example.com", "Trace Summary Co A")
    with get_conn() as conn:
        doc_id = _insert_document(conn, owner["company"]["id"], "tracesum-a-sha", "invoice.pdf")
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, cost_usd) VALUES ('r1', ?, ?, 'classify', 0.002)",
            (owner["company"]["id"], doc_id),
        )
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, cost_usd) VALUES ('r1', ?, ?, 'extract', 0.003)",
            (owner["company"]["id"], doc_id),
        )

    resp = client.get("/api/documents", headers=_auth_headers(owner["token"]))
    assert resp.status_code == 200, resp.text
    row = next(d for d in resp.json() if d["id"] == doc_id)
    assert row["trace_summary"] == {"steps": 2, "cost_usd": 0.005}


def test_a_document_with_no_trace_rows_at_all_has_no_summary():
    owner = _signup("tracesum-b@example.com", "Trace Summary Co B")
    with get_conn() as conn:
        doc_id = _insert_document(conn, owner["company"]["id"], "tracesum-b-sha", "untouched.pdf")

    resp = client.get("/api/documents", headers=_auth_headers(owner["token"]))
    assert resp.status_code == 200, resp.text
    row = next(d for d in resp.json() if d["id"] == doc_id)
    assert row["trace_summary"] is None


def test_a_rule_based_step_with_no_cost_still_counts_as_a_step():
    # rules.transition_document and archive write no cost_usd at all (no AI call) — the step still counts.
    owner = _signup("tracesum-c@example.com", "Trace Summary Co C")
    with get_conn() as conn:
        doc_id = _insert_document(conn, owner["company"]["id"], "tracesum-c-sha", "statutory.pdf")
        conn.execute(
            "INSERT INTO trace (run_id, document_id, node, decision) VALUES ('r1', ?, 'rules.transition_document', 'needs_review->filed by x')",
            (doc_id,),
        )

    resp = client.get("/api/documents", headers=_auth_headers(owner["token"]))
    row = next(d for d in resp.json() if d["id"] == doc_id)
    assert row["trace_summary"] == {"steps": 1, "cost_usd": 0}


def test_listing_many_documents_summaries_is_one_query_not_n():
    owner = _signup("tracesum-n@example.com", "Trace Summary Co N")
    with get_conn() as conn:
        for i in range(6):
            doc_id = _insert_document(conn, owner["company"]["id"], f"tracesum-n-sha-{i}", f"doc{i}.pdf")
            conn.execute(
                "INSERT INTO trace (run_id, company_id, document_id, node, cost_usd) VALUES ('r1', ?, ?, 'classify', 0.001)",
                (owner["company"]["id"], doc_id),
            )

    with patch.object(main_module, "_trace_summaries", wraps=main_module._trace_summaries) as spy:
        resp = client.get("/api/documents", headers=_auth_headers(owner["token"]))
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) >= 6
    assert spy.call_count == 1, "expected exactly one grouped query for the whole page, not one per document"


def test_search_and_personal_files_also_carry_the_trace_summary():
    owner = _signup("tracesum-d@example.com", "Trace Summary Co D")
    with get_conn() as conn:
        doc_id = _insert_document(conn, owner["company"]["id"], "tracesum-d-sha", "unique-search-term-xyz.pdf")
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, cost_usd) VALUES ('r1', ?, ?, 'classify', 0.001)",
            (owner["company"]["id"], doc_id),
        )
        conn.execute(
            "INSERT INTO document_search (rowid, company_id, filename) VALUES (?, ?, 'unique-search-term-xyz.pdf')",
            (doc_id, owner["company"]["id"]),
        )
        personal_id = _insert_document(conn, owner["company"]["id"], "tracesum-d-personal-sha", "mine.jpg")
        conn.execute("UPDATE document SET visibility = 'only_me', uploaded_by_user_id = ? WHERE id = ?", (owner["user"]["id"], personal_id))
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, cost_usd) VALUES ('r1', ?, ?, 'caption', 0)",
            (owner["company"]["id"], personal_id),
        )

    search_resp = client.get("/api/search?q=unique-search-term-xyz", headers=_auth_headers(owner["token"]))
    assert search_resp.status_code == 200, search_resp.text
    assert search_resp.json()[0]["trace_summary"] == {"steps": 1, "cost_usd": 0.001}

    personal_resp = client.get("/api/personal-files", headers=_auth_headers(owner["token"]))
    assert personal_resp.status_code == 200, personal_resp.text
    row = next(d for d in personal_resp.json() if d["id"] == personal_id)
    assert row["trace_summary"] == {"steps": 1, "cost_usd": 0}


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
