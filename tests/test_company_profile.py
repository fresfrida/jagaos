"""An ACRA business profile pre-fills company settings (2026-09-24, round 12,
DECISIONS #79).

Two layers, both gateway-free: the deterministic rules on their own (which
extracted values are usable, who may be offered them), and the whole chain
through real uploads and real logins with only the two LLM calls replaced by
canned tool calls — recorded, so "the profile went through the company-
profile extractor, not the filing-notice one" is asserted rather than assumed.
The genuinely-live version (real gateway, real PDF) is
tests/test_gateway_live.py::test_acra_business_profile_extracts_through_the_real_gateway.
"""

import io
import json

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

import app.graph.classify as classify_module
import app.graph.extract as extract_module
from app.graph.classify import COMPANY_PROFILE_DOC_TYPE, is_company_profile_doc_type
from app.graph.extract import _extractor_for
from app.llm import LLMResult
from app.main import app
from app.models import CompanyProfileFields, InvoiceFields, StatutoryFields
from app.rules.company_profile import (
    company_settings_from_profile,
    extraction_values,
    may_prefill_company_from,
)

client = TestClient(app)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- deterministic rules ---------------------------------------------------------


@pytest.mark.parametrize("doc_type", [
    "ACRA Business Profile", "acra business profile", "Business Profile", "ACRA BizFile Business Profile",
    "BizFile+ profile", COMPANY_PROFILE_DOC_TYPE,
])
def test_the_business_profile_doc_type_is_recognised_however_the_model_words_it(doc_type):
    assert is_company_profile_doc_type(doc_type)


@pytest.mark.parametrize("doc_type", [
    None, "", "invoice", "ACRA Certificate of Incorporation", "Notice of Change of Registered Office",
    "Annual Return", "contract",
])
def test_other_documents_are_not_business_profiles(doc_type):
    assert not is_company_profile_doc_type(doc_type)


@pytest.mark.parametrize("role,doc_type,status,allowed", [
    ("owner", "ACRA Business Profile", "filed", True),
    ("admin", "ACRA Business Profile", "filed", False),
    ("user", "ACRA Business Profile", "filed", False),
    ("viewer", "ACRA Business Profile", "filed", False),
    ("owner", "ACRA Business Profile", "needs_review", False),  # not yet confirmed by a person
    ("owner", "ACRA Business Profile", "archived", False),
    ("owner", "invoice", "filed", False),
    ("owner", None, "filed", False),
])
def test_only_the_owner_may_prefill_and_only_from_a_confirmed_business_profile(role, doc_type, status, allowed):
    assert may_prefill_company_from(role, doc_type, status) is allowed


def test_a_complete_profile_maps_to_every_setting():
    settings = company_settings_from_profile({
        "company_name": "  Harbourlight Trading Pte. Ltd. ", "uen": "202412345k", "fye_month": 6, "fye_day": 30,
        "gst_registered": True, "registered_address": "18 Robinson Road #12-01 Singapore 048547",
    })
    assert settings == {
        "name": "Harbourlight Trading Pte. Ltd.", "uen": "202412345K", "fye_month": 6, "fye_day": 30,
        "gst_registered": True, "registered_address": "18 Robinson Road #12-01 Singapore 048547",
    }


def test_absent_values_stay_none_so_the_form_leaves_those_fields_alone():
    settings = company_settings_from_profile({"company_name": "Only Name Pte Ltd"})
    assert settings["name"] == "Only Name Pte Ltd"
    assert all(settings[k] is None for k in ("uen", "fye_month", "fye_day", "gst_registered", "registered_address"))


@pytest.mark.parametrize("month,day", [
    (13, 5), (0, 5), (6, 32), (6, 0),  # out of range
    (2, 30), (4, 31),                  # a day that month never has
    (6, None), (None, 30),             # half a year end is not a year end
    ("June", 30), (6.5, 30), (True, 30),
])
def test_an_unusable_year_end_is_dropped_whole_never_half_applied(month, day):
    settings = company_settings_from_profile({"company_name": "X", "fye_month": month, "fye_day": day})
    assert settings["fye_month"] is None and settings["fye_day"] is None


@pytest.mark.parametrize("month,day", [(2, 29), (12, 31), (1, 1), ("6", "30"), (6.0, 30.0)])
def test_a_usable_year_end_is_kept_including_29_february_and_numeric_strings(month, day):
    settings = company_settings_from_profile({"company_name": "X", "fye_month": month, "fye_day": day})
    assert (settings["fye_month"], settings["fye_day"]) == (int(month), int(day))


@pytest.mark.parametrize("raw,expected", [
    (True, True), (False, False), ("true", True), ("Yes", True), ("Registered", True),
    ("false", False), ("No", False), ("Not registered", False),
    (None, None), ("maybe", None), ("", None), (1, None),
])
def test_gst_status_is_coerced_only_from_unambiguous_values(raw, expected):
    assert company_settings_from_profile({"company_name": "X", "gst_registered": raw})["gst_registered"] is expected


def test_a_humans_later_correction_beats_the_models_earlier_value():
    rows = [("uen", json.dumps("202412345X")), ("company_name", json.dumps("Harbourlight")), ("uen", json.dumps("202412345K"))]
    assert extraction_values(rows)["uen"] == "202412345K"


def test_the_extraction_shape_follows_the_doc_type_within_the_statutory_lane():
    assert _extractor_for({"lane": "statutory", "doc_type": "ACRA Business Profile"})[0] is CompanyProfileFields
    assert _extractor_for({"lane": "statutory", "doc_type": "Notice of Change of Registered Office"})[0] is StatutoryFields
    assert _extractor_for({"lane": "invoice", "doc_type": "invoice"})[0] is InvoiceFields
    assert _extractor_for({"lane": "important", "doc_type": "contract"}) is None


# --- through real uploads --------------------------------------------------------


def _pdf(*lines: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(lines):
        c.drawString(72, 760 - i * 16, line)
    c.save()
    return buf.getvalue()


def _tool_response(name: str, args: dict, model: str) -> LLMResult:
    return LLMResult(
        content="", model=model, input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        tool_calls=[{"function": {"name": name, "arguments": json.dumps(args)}}],
    )


def _prov(value, confidence: float = 0.95):
    return {"value": value, "confidence": confidence, "page": 1}


FULL_PROFILE = {
    "company_name": _prov("HARBOURLIGHT TRADING PTE. LTD."), "uen": _prov("202412345X"),
    "fye_month": _prov(6), "fye_day": _prov(30), "gst_registered": _prov(True),
    "registered_address": _prov("18 ROBINSON ROAD #12-01 SINGAPORE 048547"),
}


@pytest.fixture
def extractors_used(monkeypatch) -> list[str]:
    """Canned business-profile classify + extract; returns the name of each
    extraction tool the pipeline asked for. `profile` is swappable per test
    through the returned list's `.profile` attribute."""
    used = type("Used", (list,), {"profile": FULL_PROFILE})()

    def fake_classify(model, system, user, **kwargs):
        return _tool_response("classify_document", {
            "lane": "statutory", "doc_type": COMPANY_PROFILE_DOC_TYPE, "confidence": 0.97,
            "injection_suspected": False, "bucket": "Statutory", "vendor_name": "ACRA",
            "description": "ACRA business profile for Harbourlight Trading",
            "description_en": "ACRA business profile for Harbourlight Trading",
        }, model)

    def fake_extract(model, system, user, **kwargs):
        used.append(kwargs["tools"][0]["function"]["name"])
        return _tool_response("extract_company_profile_fields", used.profile, model)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    monkeypatch.setattr(extract_module, "call", fake_extract)
    return used


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@profile.test", "company_name": "Old Name Pte Ltd", "fye_month": 12, "fye_day": 31},
    ).json()
    company_id = owner["company"]["id"]
    tokens = {"owner": owner["token"]}
    for name, role in [("admin", "admin"), ("user", "user"), ("viewer", "viewer")]:
        email = f"{name}@profile.test"
        assert client.post(
            f"/api/companies/{company_id}/members", json={"email": email, "role": role},
            headers=_headers(owner["token"]),
        ).status_code == 200
        tokens[name] = client.post("/api/auth/dev-login", json={"email": email}).json()["token"]
    return {"tokens": tokens, "company_id": company_id}


def _upload_profile(team: dict) -> int:
    resp = client.post(
        "/api/documents", headers=_headers(team["tokens"]["owner"]),
        files={"file": ("bizfile.pdf", _pdf("BUSINESS PROFILE", "Company Name: HARBOURLIGHT"), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["document_id"]


def _confirm(team: dict, document_id: int, corrected: dict | None = None) -> None:
    item = next(i for i in client.get("/api/review", headers=_headers(team["tokens"]["owner"])).json()
                if i["document_id"] == document_id)
    resp = client.post(
        f"/api/review/{item['id']}/resolve?thread_id={item['thread_id']}",
        json={"action": "confirm", "corrected_fields": corrected or {}},
        headers=_headers(team["tokens"]["owner"]),
    )
    assert resp.status_code == 200, resp.text


def _prefill(team: dict, actor: str, document_id: int):
    return client.get(f"/api/documents/{document_id}/company-profile", headers=_headers(team["tokens"][actor]))


def _can_prefill(team: dict, actor: str, document_id: int) -> bool:
    rows = client.get("/api/documents", headers=_headers(team["tokens"][actor])).json()
    return next(d for d in rows if d["id"] == document_id)["can_prefill_company"]


def test_a_business_profile_is_extracted_with_the_company_profile_shape_not_the_notice_shape(team, extractors_used):
    document_id = _upload_profile(team)

    assert extractors_used == ["extract_company_profile_fields"]
    item = next(i for i in client.get("/api/review", headers=_headers(team["tokens"]["owner"])).json()
                if i["document_id"] == document_id)
    proposed = json.loads(item["proposed_json"])
    assert proposed["company_name"]["value"] == "HARBOURLIGHT TRADING PTE. LTD."
    assert proposed["fye_month"]["value"] == 6 and proposed["gst_registered"]["value"] is True
    assert "reference_no" not in proposed and "subject" not in proposed


def test_nothing_is_offered_until_a_person_has_confirmed_the_document(team, extractors_used):
    document_id = _upload_profile(team)

    assert _can_prefill(team, "owner", document_id) is False
    refused = _prefill(team, "owner", document_id)
    assert refused.status_code == 409


def test_after_confirmation_the_owner_gets_the_values_with_the_humans_correction_applied(team, extractors_used):
    document_id = _upload_profile(team)
    _confirm(team, document_id, corrected={"uen": "202412345K"})  # the model read the last character wrong

    assert _can_prefill(team, "owner", document_id) is True
    resp = _prefill(team, "owner", document_id)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "document_id": document_id, "filename": "bizfile.pdf",
        "name": "HARBOURLIGHT TRADING PTE. LTD.", "uen": "202412345K", "fye_month": 6, "fye_day": 30,
        "gst_registered": True, "registered_address": "18 ROBINSON ROAD #12-01 SINGAPORE 048547",
    }


def test_reading_the_profile_writes_nothing_to_the_company(team, extractors_used):
    document_id = _upload_profile(team)
    _confirm(team, document_id)

    _prefill(team, "owner", document_id)

    company = client.get("/api/auth/me", headers=_headers(team["tokens"]["owner"])).json()["company"]
    assert company["name"] == "Old Name Pte Ltd" and company["uen"] is None
    assert (company["fye_month"], company["fye_day"]) == (12, 31) and company["gst_registered"] is False


@pytest.mark.parametrize("actor", ["admin", "user", "viewer"])
def test_nobody_below_owner_is_offered_or_served_the_prefill(team, extractors_used, actor):
    document_id = _upload_profile(team)
    _confirm(team, document_id)

    assert _can_prefill(team, actor, document_id) is False
    assert _prefill(team, actor, document_id).status_code == 403


def test_another_companys_owner_cannot_read_it(team, extractors_used):
    document_id = _upload_profile(team)
    _confirm(team, document_id)
    outsider = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@elsewhere.test", "company_name": "Elsewhere Pte Ltd", "fye_month": 1, "fye_day": 1},
    ).json()["token"]

    assert client.get(f"/api/documents/{document_id}/company-profile", headers=_headers(outsider)).status_code == 404


def test_an_archived_profile_reads_as_not_found(team, extractors_used):
    document_id = _upload_profile(team)
    _confirm(team, document_id)
    assert client.post(f"/api/documents/{document_id}/archive", headers=_headers(team["tokens"]["owner"])).status_code == 200

    assert _prefill(team, "owner", document_id).status_code == 404


def test_a_profile_that_omits_values_leaves_them_null(team, extractors_used):
    extractors_used.profile = {"company_name": _prov("SPARSE PTE. LTD."), "uen": _prov("202412345K"),
                               "fye_month": _prov(None, 0.1), "fye_day": _prov(None, 0.1),
                               "gst_registered": _prov(None, 0.1)}
    document_id = _upload_profile(team)
    _confirm(team, document_id)

    body = _prefill(team, "owner", document_id).json()

    assert body["name"] == "SPARSE PTE. LTD." and body["uen"] == "202412345K"
    assert body["fye_month"] is None and body["fye_day"] is None
    assert body["gst_registered"] is None and body["registered_address"] is None


def test_an_ordinary_document_is_not_a_business_profile(team, monkeypatch):
    def fake_classify(model, system, user, **kwargs):
        return _tool_response("classify_document", {
            "lane": "important", "doc_type": "contract", "confidence": 0.9, "injection_suspected": False,
            "bucket": "Contracts", "vendor_name": None, "description": "A lease", "description_en": "A lease",
        }, model)

    monkeypatch.setattr(classify_module, "call", fake_classify)
    document_id = _upload_profile(team)
    _confirm(team, document_id)

    assert _can_prefill(team, "owner", document_id) is False
    assert _prefill(team, "owner", document_id).status_code == 409


# --- the write itself stays the owner's Save -------------------------------------


def _patch(team: dict, actor: str, **body):
    return client.patch(f"/api/companies/{team['company_id']}", json=body, headers=_headers(team["tokens"][actor]))


def test_the_owner_saves_the_prefilled_values_and_they_come_back_on_me(team):
    resp = _patch(team, "owner", name="Harbourlight Trading Pte. Ltd.", uen="202412345k", fye_month=6, fye_day=30,
                  gst_registered=True, registered_address="18 Robinson Road #12-01")
    assert resp.status_code == 200, resp.text

    company = client.get("/api/auth/me", headers=_headers(team["tokens"]["owner"])).json()["company"]
    assert company["name"] == "Harbourlight Trading Pte. Ltd." and company["uen"] == "202412345K"
    assert (company["fye_month"], company["fye_day"]) == (6, 30)
    assert company["gst_registered"] is True and company["registered_address"] == "18 Robinson Road #12-01"


def test_a_blank_string_clears_uen_and_address(team):
    assert _patch(team, "owner", uen="202412345K", registered_address="Somewhere").status_code == 200
    assert _patch(team, "owner", uen="  ", registered_address="").status_code == 200

    company = client.get("/api/auth/me", headers=_headers(team["tokens"]["owner"])).json()["company"]
    assert company["uen"] is None and company["registered_address"] is None


@pytest.mark.parametrize("actor", ["admin", "user", "viewer"])
def test_nobody_below_owner_can_save_company_settings(team, actor):
    assert _patch(team, actor, uen="202412345K").status_code == 403


def test_an_empty_company_name_is_refused(team):
    assert _patch(team, "owner", name="").status_code == 422
