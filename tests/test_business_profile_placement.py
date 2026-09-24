"""A company's business profile lives in Company Settings, not in the paperwork
(2026-09-24, round 16, DECISIONS #90).

The smallest mechanism that hides it: the LIST endpoints (Company Files, Search,
and the Calendar, which reads the same list) skip a document whose doc_type is a
business profile. No third visibility value, no schema change; it is a filter on
what the lists return, not on access. These tests pin both halves: it is gone
from every list, AND the things that legitimately need it still reach it (the
review queue that confirms it, the file bytes the lightbox shows, the values the
form is pre-filled from, the new GET /api/business-profile the Settings section
reads).

Real uploads and confirms through the API; only the model is canned.
"""

import io
import json

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

import app.graph.classify as classify_module
import app.graph.derive_events as derive_events_module
import app.graph.extract as extract_module
from app.llm import LLMResult
from app.main import app

client = TestClient(app)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _tool(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(
        content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}],
    )


def _pdf(*lines: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(lines):
        c.drawString(72, 760 - i * 16, line)
    c.save()
    return buf.getvalue()


def _prov(value, confidence: float = 0.95):
    return {"value": value, "confidence": confidence, "page": 1}


PROFILE_FIELDS = {"company_name": _prov("PLACEMENT TRADING PTE. LTD."), "uen": _prov("202412345K"),
                  "fye_month": _prov(6), "fye_day": _prov(30)}


@pytest.fixture
def kind(monkeypatch) -> dict:
    """Canned classify + extract. `kind["doc_type"]` picks what the next upload is."""
    state = {"doc_type": "Business Profile"}

    def fake_classify(model, system, user, **kwargs):
        profile = state["doc_type"] == "Business Profile"
        return _tool("classify_document", {
            "lane": "statutory" if profile else "important", "doc_type": state["doc_type"], "confidence": 0.95,
            "injection_suspected": False, "bucket": "Statutory" if profile else "Contracts", "vendor_name": None,
            "description": f"{state['doc_type']} for Placement Trading", "description_en": f"{state['doc_type']} for Placement Trading",
        }, model)

    def fake_extract(model, system, user, **kwargs):
        return _tool("extract_company_profile_fields", PROFILE_FIELDS, model)

    def fake_derive(model, system, user, **kwargs):  # a profile proposes no company event
        return LLMResult(content="no_event", model=model, input_tokens=1, output_tokens=1,
                         cost_usd=0.0, latency_ms=1, tool_calls=[])

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    monkeypatch.setattr(derive_events_module, "call", fake_derive)
    return state


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@placement.test", "company_name": "Placement Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user", "user"), ("viewer", "viewer")]:
        email = f"{name}@placement.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members", json={"email": email, "role": role},
            headers=_headers(owner["token"]),
        ).status_code == 200
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return tokens


def _upload(token: str, name: str) -> int:
    resp = client.post("/api/documents", headers=_headers(token),
                       files={"file": (name, _pdf("PLACEMENT TRADING PTE. LTD.", name), "application/pdf")})
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm(token: str, document_id: int) -> None:
    item = next(i for i in client.get("/api/review", headers=_headers(token)).json() if i["document_id"] == document_id)
    resp = client.post(f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
                       json={"action": "confirm", "corrected_fields": {}}, headers=_headers(token))
    assert resp.status_code == 200, resp.text


def _listed(token: str) -> set[int]:
    return {d["id"] for d in client.get("/api/documents", headers=_headers(token)).json()}


def _searched(token: str, q: str = "Placement") -> set[int]:
    return {d["id"] for d in client.get("/api/search", params={"q": q}, headers=_headers(token)).json()}


@pytest.mark.parametrize("actor", ["owner", "admin", "user", "viewer"])
def test_a_confirmed_business_profile_is_in_no_list_or_search_for_anyone(team, kind, actor):
    profile = _upload(team["owner"], "profile.pdf")
    _confirm(team["owner"], profile)
    kind["doc_type"] = "contract"
    lease = _upload(team["owner"], "lease.pdf")
    _confirm(team["owner"], lease)

    assert profile not in _listed(team[actor])
    assert profile not in _searched(team[actor])
    assert lease in _listed(team[actor]) and lease in _searched(team[actor])  # the filter is not "everything"


def test_a_pending_business_profile_is_also_hidden_from_the_owner_and_admin_lists(team, kind):
    """Pending documents are normally visible to owner/admin (they review them);
    the profile must not appear in Company Files even then."""
    profile = _upload(team["owner"], "profile.pdf")

    assert profile not in _listed(team["owner"]) and profile not in _listed(team["admin"])
    assert profile not in _searched(team["owner"])


def test_the_hidden_profile_is_still_in_the_review_queue_where_it_is_confirmed(team, kind):
    profile = _upload(team["owner"], "profile.pdf")

    queue = {i["document_id"] for i in client.get("/api/review", headers=_headers(team["owner"])).json()}

    assert profile in queue


def test_the_hidden_profile_file_still_opens_for_the_lightbox(team, kind):
    profile = _upload(team["owner"], "profile.pdf")

    resp = client.get(f"/api/documents/{profile}/file", headers=_headers(team["owner"]))

    assert resp.status_code == 200 and resp.content.startswith(b"%PDF")


def test_the_section_endpoint_returns_the_current_profile_and_when_it_can_fill_the_form(team, kind):
    assert client.get("/api/business-profile", headers=_headers(team["owner"])).json() == {"document": None}

    profile = _upload(team["owner"], "profile.pdf")
    pending = client.get("/api/business-profile", headers=_headers(team["owner"])).json()["document"]
    assert pending["id"] == profile and pending["status"] == "needs_review" and pending["can_prefill"] is False
    assert pending["filename"] == "profile.pdf" and pending["media_type"] == "application/pdf"

    _confirm(team["owner"], profile)
    filed = client.get("/api/business-profile", headers=_headers(team["owner"])).json()["document"]
    assert filed["status"] == "filed" and filed["can_prefill"] is True


def test_the_newest_profile_is_the_current_one_and_a_deleted_one_is_not(team, kind):
    first = _upload(team["owner"], "old-profile.pdf")
    second = _upload(team["owner"], "new-profile.pdf")

    assert client.get("/api/business-profile", headers=_headers(team["owner"])).json()["document"]["id"] == second

    assert client.post(f"/api/documents/{second}/archive", headers=_headers(team["owner"])).status_code == 200
    assert client.get("/api/business-profile", headers=_headers(team["owner"])).json()["document"]["id"] == first


@pytest.mark.parametrize("actor", ["admin", "user", "viewer"])
def test_only_the_owner_is_served_the_section_endpoint(team, kind, actor):
    _upload(team["owner"], "profile.pdf")

    assert client.get("/api/business-profile", headers=_headers(team[actor])).status_code == 403


def test_the_section_endpoint_needs_a_session(team, kind):
    assert client.get("/api/business-profile").status_code == 401


def test_another_companys_owner_sees_nothing_of_it(team, kind):
    _upload(team["owner"], "profile.pdf")
    outsider = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@elsewhere.test", "company_name": "Elsewhere Co", "fye_month": 1, "fye_day": 1},
    ).json()["token"]

    assert client.get("/api/business-profile", headers=_headers(outsider)).json() == {"document": None}


def test_someone_elses_personal_business_profile_is_not_the_owners_to_see(team, kind):
    resp = client.post("/api/documents?visibility=only_me", headers=_headers(team["user"]),
                       files={"file": ("private-profile.pdf", _pdf("private"), "application/pdf")})
    assert resp.status_code == 200, resp.text

    assert client.get("/api/business-profile", headers=_headers(team["owner"])).json() == {"document": None}


def test_the_older_document_row_shape_no_longer_advertises_prefill(team, kind):
    """`can_prefill_company` had nothing left to describe once a profile is never listed."""
    kind["doc_type"] = "contract"
    _upload(team["owner"], "lease.pdf")

    row = client.get("/api/documents", headers=_headers(team["owner"])).json()[0]

    assert "can_prefill_company" not in row
