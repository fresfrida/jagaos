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
