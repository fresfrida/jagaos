"""Auth/role/tenant-isolation tests. Pure DB + HTTP — no LLM gateway call,
so these always run (unlike tests/test_gateway_live.py). Uses TestClient
directly against app.main.app, the real HTTP surface, not bare function
calls — this is exactly the layer the 2026-09-22 auth work added.
"""

import io

from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from app.main import app

client = TestClient(app)


def _fake_pdf_bytes(text: str) -> bytes:
    # pdfplumber genuinely parses uploads (app/extract/pdf.py) - a handful
    # of raw bytes with a .pdf name isn't a valid PDF and pdfplumber raises
    # rather than failing gracefully (a real, pre-existing gap, tracked in
    # docs/KANBAN.md — not fixed here, out of scope for the auth work this
    # file is testing). Generate an actually-valid minimal PDF instead.
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, text)
    c.save()
    return buf.getvalue()


def _signup(email: str, company_name: str, fye_month: int = 12, fye_day: int = 31) -> dict:
    resp = client.post(
        "/api/auth/dev-login",
        json={"email": email, "company_name": company_name, "fye_month": fye_month, "fye_day": fye_day},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_dev_login_creates_owner_and_session():
    body = _signup("owner@example.com", "Test Co")
    assert body["role"] == "owner"
    assert body["user"]["email"] == "owner@example.com"
    assert body["company"]["name"] == "Test Co"
    assert body["token"]


def test_me_reflects_the_session():
    body = _signup("owner2@example.com", "Test Co 2")
    resp = client.get("/api/auth/me", headers=_auth_headers(body["token"]))
    assert resp.status_code == 200, resp.text
    me = resp.json()
    assert me["role"] == "owner"
    assert me["company"]["name"] == "Test Co 2"


def test_missing_token_is_401():
    resp = client.get("/api/documents")
    assert resp.status_code == 401


def test_garbage_token_is_401():
    resp = client.get("/api/documents", headers=_auth_headers("not-a-real-token"))
    assert resp.status_code == 401


def test_second_login_without_company_name_joins_existing_membership():
    first = _signup("repeat@example.com", "Repeat Co")
    resp = client.post("/api/auth/dev-login", json={"email": "repeat@example.com"})
    assert resp.status_code == 200, resp.text
    second = resp.json()
    assert second["company"]["id"] == first["company"]["id"]
    assert second["role"] == "owner"


def test_role_gate_blocks_viewer_from_uploading():
    owner = _signup("owner3@example.com", "Role Co")
    add = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "viewer3@example.com", "role": "viewer"},
        headers=_auth_headers(owner["token"]),
    )
    assert add.status_code == 200, add.text

    viewer_login = client.post("/api/auth/dev-login", json={"email": "viewer3@example.com"})
    viewer_token = viewer_login.json()["token"]

    resp = client.post(
        "/api/documents",
        headers=_auth_headers(viewer_token),
        files={"file": ("x.pdf", _fake_pdf_bytes("irrelevant"), "application/pdf")},
    )
    assert resp.status_code == 403, resp.text


def test_role_gate_blocks_user_from_resolving_review():
    owner = _signup("owner4@example.com", "Role Co 4")
    client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "user4@example.com", "role": "user"},
        headers=_auth_headers(owner["token"]),
    )
    user_token = client.post("/api/auth/dev-login", json={"email": "user4@example.com"}).json()["token"]

    resp = client.post(
        "/api/review/999999/resolve?thread_id=doesnotmatter",
        headers=_auth_headers(user_token),
        json={"action": "confirm", "corrected_fields": {}},
    )
    # 403 (role too low) must win over 404 (item doesn't exist) - the caller
    # should never learn whether an id exists before we know they're allowed
    # to act on it at all.
    assert resp.status_code == 403, resp.text


def test_tenant_isolation_company_a_cannot_see_company_b_documents():
    # Inserted directly rather than via POST /api/documents: that endpoint
    # runs the real classify/extract pipeline (a live gateway call) - this
    # file's whole point is auth/tenant tests that never need one.
    from app.db import get_conn

    a = _signup("a@example.com", "Company A")
    b = _signup("b@example.com", "Company B")

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'bsha', 'b-doc.pdf', "
            "'application/pdf', 1, '/tmp/b-doc.pdf', 'web', 'filed')",
            (b["company"]["id"],),
        )
        b_doc_id = cur.lastrowid

    # Company A's session listing documents must never show B's.
    a_docs = client.get("/api/documents", headers=_auth_headers(a["token"])).json()
    assert a_docs == []

    # And A can't read B's trace directly by id, either.
    trace = client.get(f"/api/trace/{b_doc_id}", headers=_auth_headers(a["token"]))
    assert trace.status_code == 403, trace.text


def test_document_file_endpoint_serves_own_company_and_404s_for_other_company(tmp_path):
    # A real file on disk — FileResponse (unlike get_trace, which never
    # touches file bytes) needs an actual path to stream.
    from app.db import get_conn

    a = _signup("filea@example.com", "File Co A")
    b = _signup("fileb@example.com", "File Co B")

    real_file = tmp_path / "a-doc.pdf"
    real_file.write_bytes(_fake_pdf_bytes("hello"))

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'filesha-a', 'a-doc.pdf', "
            "'application/pdf', 1, ?, 'web', 'filed')",
            (a["company"]["id"], str(real_file)),
        )
        a_doc_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'filesha-b', 'b-doc.pdf', "
            "'application/pdf', 1, '/tmp/does-not-matter.pdf', 'web', 'filed')",
            (b["company"]["id"],),
        )
        b_doc_id = cur.lastrowid

    own = client.get(f"/api/documents/{a_doc_id}/file", headers=_auth_headers(a["token"]))
    assert own.status_code == 200, own.text
    assert own.headers["content-type"].startswith("application/pdf")

    # 404, not 403 — existence must not leak across tenants for this
    # endpoint (deliberate divergence from get_trace's 403 above, called
    # out in app/main.py's get_document_file docstring and DECISIONS.md).
    other = client.get(f"/api/documents/{b_doc_id}/file", headers=_auth_headers(a["token"]))
    assert other.status_code == 404, other.text


def test_archived_documents_404_from_file_and_trace_endpoints_even_in_own_company(tmp_path):
    # 2026-09-23 (DECISIONS #53's remaining piece): both endpoints fetch by
    # a known document id directly, with no archived-status check — found
    # while fixing the same gap in list_documents/search_documents, fixed
    # here. An archived document must be invisible through the app for
    # every role, including the caller's own company and their own role
    # (this was true even for the admin/owner who did the archiving) — not
    # 403 "exists but denied" (which would still confirm something's
    # there), the same flavor of 404 a nonexistent id already gets.
    from app.db import get_conn

    owner = _signup("archtrace-owner@example.com", "Archive Trace Co")

    real_file = tmp_path / "archived-doc.pdf"
    real_file.write_bytes(_fake_pdf_bytes("archived"))

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'archtracesha-archived', "
            "'archived-doc.pdf', 'application/pdf', 1, ?, 'web', 'archived')",
            (owner["company"]["id"], str(real_file)),
        )
        archived_doc_id = cur.lastrowid
        conn.execute(
            "INSERT INTO trace (run_id, company_id, document_id, node, decision) "
            "VALUES ('archtracerun', ?, ?, 'verify', 'needs_review')",
            (owner["company"]["id"], archived_doc_id),
        )

        # Positive control — a live document in the same company, same
        # requests, proving the exclusion is specific to status='archived'
        # and not an accidental blanket break of either endpoint.
        live_file = tmp_path / "live-doc.pdf"
        live_file.write_bytes(_fake_pdf_bytes("live"))
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'archtracesha-live', "
            "'live-doc.pdf', 'application/pdf', 1, ?, 'web', 'filed')",
            (owner["company"]["id"], str(live_file)),
        )
        live_doc_id = cur.lastrowid

    archived_file_resp = client.get(f"/api/documents/{archived_doc_id}/file", headers=_auth_headers(owner["token"]))
    assert archived_file_resp.status_code == 404, archived_file_resp.text

    archived_trace_resp = client.get(f"/api/trace/{archived_doc_id}", headers=_auth_headers(owner["token"]))
    assert archived_trace_resp.status_code == 404, archived_trace_resp.text

    live_file_resp = client.get(f"/api/documents/{live_doc_id}/file", headers=_auth_headers(owner["token"]))
    assert live_file_resp.status_code == 200, live_file_resp.text

    # get_trace 200s with an empty nodes list for a document that simply
    # has no trace rows yet — that's not a 404 case, so this document
    # deliberately has none seeded; the point here is just that the
    # document itself is still visible (not a 404), unlike the archived one.
    live_trace_resp = client.get(f"/api/trace/{live_doc_id}", headers=_auth_headers(owner["token"]))
    assert live_trace_resp.status_code == 200, live_trace_resp.text
    assert live_trace_resp.json()["nodes"] == []


def test_archive_endpoint_archives_own_company_document_and_404s_for_other_company():
    from app.db import get_conn

    a = _signup("archivea@example.com", "Archive Co A")
    b = _signup("archiveb@example.com", "Archive Co B")

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'archivesha-a', 'a-doc.pdf', "
            "'application/pdf', 1, '/tmp/a-doc.pdf', 'web', 'needs_review')",
            (a["company"]["id"],),
        )
        a_doc_id = cur.lastrowid
        # An open review_item on it — archiving must dismiss this too
        # (otherwise it's still a dead end in the Needs-Review count).
        cur = conn.execute(
            "INSERT INTO review_item (company_id, document_id, reason, question, "
            "proposed_json, status) VALUES (?, ?, 'test', 'q?', '{}', 'open')",
            (a["company"]["id"], a_doc_id),
        )
        review_item_id = cur.lastrowid

        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'archivesha-b', 'b-doc.pdf', "
            "'application/pdf', 1, '/tmp/b-doc.pdf', 'web', 'filed')",
            (b["company"]["id"],),
        )
        b_doc_id = cur.lastrowid

    own = client.post(f"/api/documents/{a_doc_id}/archive", headers=_auth_headers(a["token"]))
    assert own.status_code == 200, own.text
    assert own.json()["status"] == "archived"

    with get_conn() as conn:
        doc_status = conn.execute(
            "SELECT status FROM document WHERE id = ?", (a_doc_id,)
        ).fetchone()["status"]
        review_status = conn.execute(
            "SELECT status FROM review_item WHERE id = ?", (review_item_id,)
        ).fetchone()["status"]
    assert doc_status == "archived"
    assert review_status == "dismissed", "an open review_item on an archived document must not stay open"

    # 404, not 403 — same no-leak pattern as the file endpoint above.
    other = client.post(f"/api/documents/{b_doc_id}/archive", headers=_auth_headers(a["token"]))
    assert other.status_code == 404, other.text


def test_resolve_review_archives_a_quarantined_document_without_touching_the_pipeline():
    # 2026-09-23 (DECISIONS #68): a real, live-reproduced bug — resuming a
    # quarantined document's thread_id does NOT reliably raise LangGraph's
    # InvalidUpdateError the way an actually-expired/restarted session
    # does (confirmed against the real running dev server: verify()'s
    # early-return branch still leaves a checkpoint behind, just one
    # reflecting an already-completed run with nothing pending — resuming
    # THAT can silently no-op, 200, nothing changed, instead of erroring).
    # resolve_review now checks document.status == 'quarantined' up front
    # and archives directly, never calling PIPELINE.invoke for this case —
    # so this test doesn't need a real pipeline run or gateway call either,
    # a directly-seeded quarantined document is enough to prove the branch.
    from app.db import get_conn

    owner = _signup("quarantineresolve@example.com", "Quarantine Resolve Co")

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES (?, 'quarantineresolvesha', 'q-doc.pdf', "
            "'application/pdf', 1, '/tmp/q-doc.pdf', 'web', 'quarantined')",
            (owner["company"]["id"],),
        )
        doc_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO review_item (company_id, document_id, reason, question, "
            "proposed_json, status) VALUES (?, ?, 'injection_suspected_blocked', "
            "'[{\"code\": \"injection_suspected_blocked\", \"params\": {}}]', '{}', 'open')",
            (owner["company"]["id"], doc_id),
        )
        review_item_id = cur.lastrowid

    # thread_id deliberately garbage — must never reach the pipeline for a
    # quarantined document, so an unresolvable thread_id doesn't matter.
    resp = client.post(
        f"/api/review/{review_item_id}/resolve?thread_id=no-such-thread-ever",
        headers=_auth_headers(owner["token"]),
        json={"action": "reject", "corrected_fields": {}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "archived"

    with get_conn() as conn:
        doc_status = conn.execute("SELECT status FROM document WHERE id = ?", (doc_id,)).fetchone()["status"]
        review_status = conn.execute(
            "SELECT status FROM review_item WHERE id = ?", (review_item_id,)
        ).fetchone()["status"]
    assert doc_status == "archived"
    assert review_status == "dismissed"


def test_add_member_requires_admin_or_owner():
    owner = _signup("owner5@example.com", "Role Co 5")
    client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "viewer5@example.com", "role": "viewer"},
        headers=_auth_headers(owner["token"]),
    )
    viewer_token = client.post("/api/auth/dev-login", json={"email": "viewer5@example.com"}).json()["token"]

    resp = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "someone-else@example.com", "role": "viewer"},
        headers=_auth_headers(viewer_token),
    )
    assert resp.status_code == 403, resp.text


def test_only_one_owner_per_company():
    # DECISIONS.md #29, resolved 2026-09-22: one owner per company, many
    # admins. Policy is only real if it's enforced, not just documented.
    owner = _signup("owner6@example.com", "Role Co 6")

    resp = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "second-owner@example.com", "role": "owner"},
        headers=_auth_headers(owner["token"]),
    )
    assert resp.status_code == 409, resp.text

    # Adding a second admin, in contrast, is fine - no cardinality limit there.
    admin_resp = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "an-admin@example.com", "role": "admin"},
        headers=_auth_headers(owner["token"]),
    )
    assert admin_resp.status_code == 200, admin_resp.text


def test_search_and_edit_are_tenant_isolated_and_edit_updates_bucket_vendor_filename():
    # Search/bucket/vendor_name (2026-09-22, DECISIONS #42 - supersedes the
    # tag table this test used to exercise) - inserted directly rather than
    # via a real upload for the same reason test_tenant_isolation_... above
    # does: no live gateway call needed to test tenant scoping.
    from app.db import get_conn, reindex_document_search

    a = _signup("searcha@example.com", "Search Co A")
    b = _signup("searchb@example.com", "Search Co B")

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status, doc_type, description, bucket) VALUES "
            "(?, 'searchsha-a', 'a-invoice.pdf', 'application/pdf', 1, '/tmp/a', "
            "'web', 'filed', 'invoice', 'Invoice from Zylotech Pte Ltd', 'Expenses')",
            (a["company"]["id"],),
        )
        a_doc_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status, doc_type, description, bucket) VALUES "
            "(?, 'searchsha-b', 'b-invoice.pdf', 'application/pdf', 1, '/tmp/b', "
            "'web', 'filed', 'invoice', 'Invoice from Zylotech Pte Ltd', 'Expenses')",
            (b["company"]["id"],),
        )
        b_doc_id = cur.lastrowid
    reindex_document_search(a_doc_id)
    reindex_document_search(b_doc_id)

    # Same search term matches both companies' own documents, but never
    # leaks the other company's document across the session boundary.
    a_results = client.get("/api/search?q=Zylotech", headers=_auth_headers(a["token"])).json()
    assert [d["id"] for d in a_results] == [a_doc_id], a_results
    b_results = client.get("/api/search?q=Zylotech", headers=_auth_headers(b["token"])).json()
    assert [d["id"] for d in b_results] == [b_doc_id], b_results

    # Empty query must not return the whole company's documents.
    empty = client.get("/api/search?q=", headers=_auth_headers(a["token"])).json()
    assert empty == []

    # Editing description/bucket/vendor_name/filename (user+ role) actually
    # persists and re-indexes - search by a brand new vendor_name word must
    # then find it.
    edit = client.patch(
        f"/api/documents/{a_doc_id}",
        json={
            "description": "Renamed invoice",
            "bucket": "Operations",
            "vendor_name": "Urgent Consulting Partners",
            "filename": "renamed-invoice.pdf",
        },
        headers=_auth_headers(a["token"]),
    )
    assert edit.status_code == 200, edit.text

    by_new_vendor = client.get("/api/search?q=Consulting", headers=_auth_headers(a["token"])).json()
    assert [d["id"] for d in by_new_vendor] == [a_doc_id]
    assert by_new_vendor[0]["description"] == "Renamed invoice"
    assert by_new_vendor[0]["bucket"] == "Operations"
    assert by_new_vendor[0]["vendor_name"] == "Urgent Consulting Partners"
    assert by_new_vendor[0]["filename"] == "renamed-invoice.pdf"

    # Company B must never be able to edit (or even discover, via a leaked
    # 200/403 vs 404) company A's document - same no-leak pattern as the
    # archive endpoint's tenant-isolation test above.
    cross_tenant_edit = client.patch(
        f"/api/documents/{a_doc_id}",
        json={"description": "hijacked"},
        headers=_auth_headers(b["token"]),
    )
    assert cross_tenant_edit.status_code == 404, cross_tenant_edit.text
    with get_conn() as conn:
        still_a_description = conn.execute(
            "SELECT description FROM document WHERE id = ?", (a_doc_id,)
        ).fetchone()["description"]
    assert still_a_description == "Renamed invoice"


def test_archived_documents_never_appear_in_list_or_search_for_any_role():
    # 2026-09-23 (DECISIONS #53): GET /api/documents had no role floor at
    # all (get_current_membership, not require_role) and never excluded
    # status='archived' — any authenticated member, including viewer,
    # could already see an archived document; the Documents tab's "Show
    # archived" checkbox (OpsConsole.tsx) was a client-side-only filter
    # over data the server already sent, not an access control. GET
    # /api/search had the same gap via its join back to `document`.
    # Decision: no app role, not even owner, should ever see an archived
    # document through the app — archived data is recoverable only via
    # direct DB access on the box that operates the infrastructure. This
    # checks own-company data for two roles (owner, viewer), not just
    # tenant isolation (already covered by the archive endpoint's own test
    # above) — the bug here was never about crossing companies.
    from app.db import get_conn, reindex_document_search

    owner = _signup("archivelist-owner@example.com", "Archive List Co")
    add = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "archivelist-viewer@example.com", "role": "viewer"},
        headers=_auth_headers(owner["token"]),
    )
    assert add.status_code == 200, add.text
    viewer_token = client.post(
        "/api/auth/dev-login", json={"email": "archivelist-viewer@example.com"}
    ).json()["token"]

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status, description) VALUES "
            "(?, 'archivelistsha-archived', 'archived-doc.pdf', 'application/pdf', 1, "
            "'/tmp/archived-doc.pdf', 'web', 'archived', 'A findable secret nobody should see now')",
            (owner["company"]["id"],),
        )
        archived_doc_id = cur.lastrowid
        # Positive control — a live document in the same company, so the
        # exclusion is proven to be specific to status='archived', not an
        # accidental "nothing comes back at all" bug.
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status, description) VALUES "
            "(?, 'archivelistsha-live', 'live-doc.pdf', 'application/pdf', 1, "
            "'/tmp/live-doc.pdf', 'web', 'filed', 'A findable live document')",
            (owner["company"]["id"],),
        )
        live_doc_id = cur.lastrowid
    reindex_document_search(archived_doc_id)
    reindex_document_search(live_doc_id)

    for token in (owner["token"], viewer_token):
        doc_ids = [d["id"] for d in client.get("/api/documents", headers=_auth_headers(token)).json()]
        assert archived_doc_id not in doc_ids, doc_ids
        assert live_doc_id in doc_ids, doc_ids

        search_ids = [d["id"] for d in client.get("/api/search?q=findable", headers=_auth_headers(token)).json()]
        assert archived_doc_id not in search_ids, search_ids
        assert live_doc_id in search_ids, search_ids


def test_user_can_only_edit_own_uploads_admin_can_edit_any():
    # 2026-09-23 (role/permission work): edit_document previously checked
    # tenant scoping only, no ownership — any `user`-role account could
    # edit any document in the company, even though `uploaded_by_user_id`
    # already existed in the schema. Confirmed live before this fix.
    from app.db import get_conn

    owner = _signup("ownership-owner@example.com", "Ownership Co")
    add_a = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "ownership-usera@example.com", "role": "user"},
        headers=_auth_headers(owner["token"]),
    )
    add_b = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "ownership-userb@example.com", "role": "user"},
        headers=_auth_headers(owner["token"]),
    )
    assert add_a.status_code == 200 and add_b.status_code == 200
    user_a_id = add_a.json()["user_id"]
    user_a_token = client.post("/api/auth/dev-login", json={"email": "ownership-usera@example.com"}).json()["token"]
    user_b_token = client.post("/api/auth/dev-login", json={"email": "ownership-userb@example.com"}).json()["token"]

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status, uploaded_by_user_id) VALUES "
            "(?, 'ownershipsha-a', 'a-doc.pdf', 'application/pdf', 1, '/tmp/a-doc.pdf', "
            "'web', 'filed', ?)",
            (owner["company"]["id"], user_a_id),
        )
        a_doc_id = cur.lastrowid
        # No uploaded_by_user_id at all (direct-SQL fixture, same shape as
        # every other pre-existing test in this file) — must NOT become
        # uneditable-by-everyone; there's no real uploader to protect it from.
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES "
            "(?, 'ownershipsha-none', 'no-uploader-doc.pdf', 'application/pdf', 1, "
            "'/tmp/no-uploader-doc.pdf', 'web', 'filed')",
            (owner["company"]["id"],),
        )
        no_uploader_doc_id = cur.lastrowid

    # The uploader themselves can edit their own document.
    own_edit = client.patch(
        f"/api/documents/{a_doc_id}", json={"description": "edited by owner-of-upload"},
        headers=_auth_headers(user_a_token),
    )
    assert own_edit.status_code == 200, own_edit.text

    # A different user-role account cannot edit someone else's upload.
    cross_user_edit = client.patch(
        f"/api/documents/{a_doc_id}", json={"description": "hijacked"},
        headers=_auth_headers(user_b_token),
    )
    assert cross_user_edit.status_code == 403, cross_user_edit.text

    # admin/owner are unaffected by the ownership check.
    admin_edit = client.patch(
        f"/api/documents/{a_doc_id}", json={"description": "edited by owner role"},
        headers=_auth_headers(owner["token"]),
    )
    assert admin_edit.status_code == 200, admin_edit.text

    # A document with no recorded uploader stays editable by any user+ role.
    no_uploader_edit = client.patch(
        f"/api/documents/{no_uploader_doc_id}", json={"description": "editable, no owner recorded"},
        headers=_auth_headers(user_b_token),
    )
    assert no_uploader_edit.status_code == 200, no_uploader_edit.text


def test_company_settings_patch_requires_owner_and_persists():
    # 2026-09-23 (role/permission work): the company row was previously
    # write-once at signup — PATCH /api/companies/{id} is new.
    owner = _signup("settings-owner@example.com", "Settings Co")
    add_admin = client.post(
        f"/api/companies/{owner['company']['id']}/members",
        json={"email": "settings-admin@example.com", "role": "admin"},
        headers=_auth_headers(owner["token"]),
    )
    assert add_admin.status_code == 200
    admin_token = client.post("/api/auth/dev-login", json={"email": "settings-admin@example.com"}).json()["token"]

    # admin (not owner) is rejected...
    admin_patch = client.patch(
        f"/api/companies/{owner['company']['id']}", json={"name": "Renamed by admin"},
        headers=_auth_headers(admin_token),
    )
    assert admin_patch.status_code == 403, admin_patch.text

    # ...the exact paired contrast the feature request asked to see: the
    # same admin session can already delete (archive) a document (existing,
    # unchanged behavior) but cannot edit company settings.
    from app.db import get_conn

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, "
            "stored_path, source_channel, status) VALUES "
            "(?, 'settingssha-a', 'a-doc.pdf', 'application/pdf', 1, '/tmp/a-doc.pdf', "
            "'web', 'needs_review')",
            (owner["company"]["id"],),
        )
        doc_id = cur.lastrowid
    admin_archive = client.post(f"/api/documents/{doc_id}/archive", headers=_auth_headers(admin_token))
    assert admin_archive.status_code == 200, admin_archive.text

    # owner succeeds and it actually persists.
    owner_patch = client.patch(
        f"/api/companies/{owner['company']['id']}",
        json={"name": "Renamed by owner", "fye_month": 6, "fye_day": 30},
        headers=_auth_headers(owner["token"]),
    )
    assert owner_patch.status_code == 200, owner_patch.text
    me = client.get("/api/auth/me", headers=_auth_headers(owner["token"])).json()
    assert me["company"]["name"] == "Renamed by owner"
