"""Grounding: what a model writes about a document may only name things the
document names (2026-09-24, round 15, DECISIONS #89). Pure functions, no gateway,
no database.

Two halves, deliberately balanced. The FIRST half is the bug: a business profile
whose page never says "ACRA" must not be described as an "ACRA Business Profile".
The SECOND half matters more: the check runs on every future document, so a
correct summary of a correct document must never be rejected. Its fixtures are
real: the source text is the repository's own demo corpus, and the descriptions
are what the real gateway model actually wrote for those documents (recorded when
this check was built), plus the prompt's own examples.
"""

from pathlib import Path

import pytest

from app.rules.grounding import (
    Source,
    drop_ungrounded_acronyms,
    ground_classification,
    grounded_fallback_description,
    name_is_grounded,
    ungrounded_acronyms,
    ungrounded_names,
)

CORPUS = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files"

PROFILE_NO_AUTHORITY = """BUSINESS PROFILE SUMMARY

Entity Name: SUNBIRD CATERING SERVICES PTE. LTD.
Unique Entity Number: 202398765M
Entity Type: Private Company Limited by Shares
Registered Office: 55 TIONG BAHRU ROAD #03-11 SINGAPORE 160055
Director: LEE MEI LING
"""

HALLUCINATED = "ACRA Business Profile for Sunbird Catering Services Pte. Ltd., UEN 202398765M"


def _classify(**over) -> dict:
    base = {
        "lane": "statutory", "doc_type": "ACRA Business Profile", "confidence": 0.9, "injection_suspected": False,
        "description": HALLUCINATED, "description_en": HALLUCINATED, "bucket": "Statutory",
        "vendor_name": "SUNBIRD CATERING SERVICES PTE. LTD.",
    }
    base.update(over)
    return base


# --- the bug -----------------------------------------------------------------------


def test_an_authority_the_page_never_names_is_caught():
    assert ungrounded_names(HALLUCINATED, Source.of(PROFILE_NO_AUTHORITY)) == ["ACRA"]


def test_the_failing_document_is_repaired_end_to_end():
    out, notes = ground_classification(_classify(), PROFILE_NO_AUTHORITY, company_name=None, subject_only=True)

    assert out["description_en"] == "Business Profile for Sunbird Catering Services Pte. Ltd., UEN 202398765M"
    assert out["description"] == out["description_en"]
    assert out["vendor_name"] is None, "the company a profile is ABOUT is not its vendor"
    assert out["doc_type"] == "Business Profile"
    assert "ACRA" not in " ".join(str(v) for v in out.values() if v)
    assert len(notes) == 3


@pytest.mark.parametrize("invented", [
    "Ministry of Manpower", "Inland Revenue Authority of Singapore", "Zenith Holdings", "Tan Wei Ming", "Acme Corp",
])
def test_the_check_generalises_to_any_invented_name_not_just_ACRA(invented):
    first = invented.split()[0]
    text = f"Registration document for Sunbird Catering Services, issued by {invented}"
    ungrounded = ungrounded_names(text, Source.of(PROFILE_NO_AUTHORITY))
    assert first in ungrounded, ungrounded


def test_an_invented_name_in_the_middle_of_a_sentence_replaces_it_with_the_plain_fallback():
    # Cutting a name out of the middle would leave a dangling "from"; the plain label reads better.
    bad = "Invoice from Zenith Supplies for stationery"
    out, _ = ground_classification(
        _classify(lane="invoice", doc_type="invoice", description=bad, description_en=bad, vendor_name="Zenith Supplies"),
        "TAX INVOICE\nStraits Print Supplies Pte Ltd\nStationery 348.80", company_name=None, subject_only=False,
    )
    assert out["description_en"] == "Invoice", out
    assert out["vendor_name"] is None


def test_only_a_translation_that_invented_something_is_dropped():
    out, notes = ground_classification(
        _classify(description="ACRA 商业档案", description_en="Business Profile for Sunbird Catering Services Pte. Ltd."),
        PROFILE_NO_AUTHORITY, company_name=None, subject_only=True,
    )
    assert out["description_en"].startswith("Business Profile for Sunbird")
    assert out["description"] == out["description_en"]
    assert any("translation dropped" in n for n in notes)


# --- vendor: the subject of a document is not its vendor ------------------------------------


def test_a_business_profile_has_no_vendor_even_when_the_name_is_on_the_page():
    out, _ = ground_classification(_classify(description="Business Profile", description_en="Business Profile"),
                                    PROFILE_NO_AUTHORITY, company_name=None, subject_only=True)
    assert out["vendor_name"] is None


def test_a_non_invoice_document_never_has_its_own_company_as_the_vendor():
    out, notes = ground_classification(
        _classify(lane="important", doc_type="contract", vendor_name="Bright Harbour Pte. Ltd.",
                  description="Constitution of Bright Harbour Pte. Ltd.", description_en="Constitution of Bright Harbour Pte. Ltd."),
        "CONSTITUTION OF BRIGHT HARBOUR PTE. LTD.", company_name="Bright Harbour Private Limited", subject_only=False,
    )
    assert out["vendor_name"] is None and "this company itself" in notes[0]


def test_an_invoice_the_company_issued_keeps_its_own_name_as_the_vendor():
    # Receivables: the issuer of an invoice IS this company, and that is a fact on the page.
    out, notes = ground_classification(
        _classify(lane="invoice", doc_type="invoice", vendor_name="Test Pte Ltd",
                  description="Invoice from Test Pte Ltd for consulting", description_en="Invoice from Test Pte Ltd for consulting"),
        "Test Pte Ltd\nInvoice No: 1\nConsulting", company_name="Test Pte Ltd", subject_only=False,
    )
    assert out["vendor_name"] == "Test Pte Ltd" and notes == []


def test_a_vendor_none_of_whose_words_are_on_the_page_is_blank():
    assert not name_is_grounded("Zenith Global Trading Ltd", Source.of("TAX INVOICE\nStraits Print Supplies Pte Ltd"))


def test_a_vendor_that_is_only_partly_printed_survives():
    page = Source.of("ACME ENGINEERING\nInvoice 12")
    assert name_is_grounded("Acme Engineering Technology Pte Ltd", page)


# --- doc_type: only acronyms, only when the page does not spell them out ------------------------


def test_an_authority_acronym_in_a_doc_type_is_dropped_when_the_page_never_says_it():
    assert drop_ungrounded_acronyms("ACRA Business Profile", Source.of(PROFILE_NO_AUTHORITY)) == "Business Profile"
    assert drop_ungrounded_acronyms("IRAS Notice of Assessment", Source.of("NOTICE OF ASSESSMENT")) == "Notice of Assessment"


def test_ordinary_filing_words_in_a_doc_type_are_never_touched():
    label = "Notice of Dormancy Exemption for Annual General Meeting"
    assert drop_ungrounded_acronyms(label, Source.of("an unrelated page")) == label
    assert ungrounded_acronyms(label, Source.of("an unrelated page")) == []


# --- what is NOT a problem (the false-positive side) ----------------------------------------------------


def test_an_acronym_the_page_spells_out_is_grounded():
    # The repository's own certificate prints the authority's full name, never "ACRA".
    page = Source.of("ACCOUNTING AND CORPORATE REGULATORY AUTHORITY\nCERTIFICATE OF INCORPORATION\nBRIGHT HARBOUR PTE. LTD.")
    assert ungrounded_names("ACRA Certificate of Incorporation for Bright Harbour", page) == []
    assert ungrounded_acronyms("ACRA Certificate of Incorporation", page) == []


def test_an_acronym_the_page_spells_out_with_small_words_between_is_grounded():
    assert ungrounded_acronyms("IRAS letter", Source.of("Inland Revenue Authority of Singapore")) == []


def test_a_name_the_model_corrected_from_an_ocr_typo_is_grounded():
    page = Source.of("Straits Prlnt Supplles Pte Ltd\nInvoice")  # OCR read i as l
    assert ungrounded_names("Invoice from Straits Print Supplies Pte Ltd", page) == []


def test_case_and_dots_do_not_matter():
    page = Source.of("HARBOURLIGHT TRADING P.T.E. L.T.D.")
    assert ungrounded_names("Profile for Harbourlight Trading", page) == []


@pytest.mark.parametrize("text", [
    "Invoice from Acme Engineering for consulting services, $396",                    # the prompt's own example
    "Office lease agreement with Marina Facilities Management",                       # the prompt's own example
    "Scanned receipt for office supplies",                                           # nothing name-like at all
    "Image with no clear readable text",                                             # the unreadable-photo sentence
    "Invoice dated 15 March 2026 for SGD 545.00, GST 45.00",                          # months, currency, tax, digits
    "Quarterly maintenance invoice, due in April",                                    # a month
    "Business profile for a Singapore company",                                        # Singapore is the product's own region
    "Notice of change of registered office, effective 1 March 2026",                   # ordinary filing vocabulary
])
def test_ordinary_summaries_are_never_flagged(text):
    page = Source.of("Acme Engineering\nMarina Facilities Management\nInvoice INV-1\nMarch 2026")
    assert ungrounded_names(text, page) == [], text


def test_a_sentence_that_starts_with_an_ordinary_capitalised_word_is_not_checked():
    assert ungrounded_names("Statement of account for the quarter", Source.of("nothing relevant")) == []


def test_a_sentence_that_starts_with_a_name_is_checked():
    assert ungrounded_names("Zenith Logistics quotation for freight", Source.of("nothing relevant")) == ["Zenith", "Logistics"]


def test_a_sentence_made_mostly_of_names_is_not_mistaken_for_title_case():
    text = "Business Profile for Sunbird Catering Services Pte. Ltd. and Zenith Holdings Pte. Ltd."
    assert ungrounded_names(text, Source.of("SUNBIRD CATERING SERVICES PTE. LTD.")) == ["Zenith"]


def test_title_case_is_checked_for_acronyms_only():
    # A small word capitalised mid-text ("For", "From") marks Title Case, where every word is
    # capitalised and a capital says nothing: do not flag the page's own words.
    assert ungrounded_names("Invoice From Acme For Consulting Services Rendered", Source.of("Acme\nConsulting")) == []
    assert ungrounded_names("ACRA Business Profile For Acme Consulting Services", Source.of("Acme\nConsulting")) == ["ACRA"]


@pytest.mark.parametrize("text", [
    "Invois daripada Acme Engineering untuk perkhidmatan perundingan",                 # Malay
    "Acme Engineering 咨询服务发票，金额 396 新元",                                      # Chinese with a Latin name inside
    "Acme Engineering நிறுவனத்தின் ஆலோசனை விலைப்பட்டியல்",                              # Tamil with a Latin name inside
])
def test_other_languages_are_checked_for_their_latin_names_only(text):
    assert ungrounded_names(text, Source.of("Acme Engineering\nInvoice")) == []


def test_a_name_next_to_chinese_characters_is_not_fused_with_them():
    assert ungrounded_names("ACRA商业档案", Source.of("BUSINESS PROFILE")) == ["ACRA"]
    assert ungrounded_names("BUSINESS商业档案", Source.of("BUSINESS PROFILE")) == []


def test_an_empty_description_or_source_does_not_crash():
    assert ungrounded_names("", Source.of("anything")) == []
    assert ungrounded_names("Sunbird Catering", Source.of("")) == ["Sunbird", "Catering"]


# --- the repository's own fixtures: real text, what the real model wrote --------------------------------------------------

# (file, doc_type, description, vendor_name) exactly as the real gateway model answered for the fixed
# prompt when this check was built. Every one must come through unchanged.
REAL_ANSWERS = [
    ("01_certificate_of_incorporation.pdf", "statutory", "Certificate of Incorporation for BRIGHT HARBOUR PTE. LTD., incorporated on 15 January 2023", None),
    ("02_constitution.pdf", "important", "Constitution of Bright Harbour Pte. Ltd.", None),
    ("03_notice_office_change.pdf", "statutory", "Notice of change of registered office for Bright Harbour Pte. Ltd. to 10 Anson Road, #22-01, Singapore 079903", None),
    ("04_notice_corpsec_change.pdf", "statutory", "Notice of appointment of Harbour Corp Services Pte Ltd as company secretary for Bright Harbour Pte. Ltd., effective 1 June 2026", "Harbour Corp Services Pte Ltd"),
    ("05_invoice_clean.pdf", "invoice", "Invoice from Straits Print Supplies Pte Ltd for company stationery and letterhead printing, SGD 348.80", "Straits Print Supplies Pte Ltd"),
    ("06_invoice_bad_gst.pdf", "invoice", "Invoice from Marina Facilities Management Pte Ltd for quarterly office facilities maintenance, SGD 1,284.00", "Marina Facilities Management Pte Ltd"),
    ("07_invoice_injection_attempt.pdf", "invoice", "Invoice from QuickFix IT Services for laptop repair service, SGD 163.50", "QuickFix IT Services"),
    ("08_lease_important.pdf", "important", "Office lease agreement with Marina Bay Properties Pte Ltd for premises at 10 Anson Road, SGD 4,500 monthly rent", "Marina Bay Properties Pte Ltd"),
]

# What the OLD prompt made the same model write for the same documents: an authority the page prints only
# spelled out (grounded, must NOT be flagged), and the company itself as vendor (must be).
OLD_PROMPT_ANSWERS = [
    ("01_certificate_of_incorporation.pdf", "statutory", "ACRA Certificate of Incorporation", "ACRA Certificate of Incorporation for Bright Harbour Pte. Ltd., incorporated 15 January 2023", "ACRA", True),
    ("03_notice_office_change.pdf", "statutory", "ACRA Notice of Change of Registered Office", "ACRA notice of change of registered office for Bright Harbour Pte. Ltd. to 10 Anson Road, #22-01, effective 1 March 2026", "ACRA", True),
]


def _corpus_text(name: str) -> str:
    pdfplumber = pytest.importorskip("pdfplumber")
    with pdfplumber.open(CORPUS / name) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


@pytest.mark.parametrize("name,lane,description,vendor", REAL_ANSWERS)
def test_what_the_real_model_wrote_for_the_demo_corpus_passes_untouched(name, lane, description, vendor):
    text = _corpus_text(name)
    doc_type = {"statutory": "Notice of Change", "important": "contract", "invoice": "invoice"}[lane]
    result = _classify(lane=lane, doc_type=doc_type, description=description, description_en=description, vendor_name=vendor)
    out, notes = ground_classification(result, text, company_name="Bright Harbour Pte Ltd", subject_only=False)

    assert notes == [], notes
    assert out["description_en"] == description and out["vendor_name"] == vendor


@pytest.mark.parametrize("name,lane,doc_type,description,vendor,page_names_it", OLD_PROMPT_ANSWERS)
def test_an_authority_the_demo_corpus_prints_only_spelled_out_is_not_flagged(name, lane, doc_type, description, vendor, page_names_it):
    text = _corpus_text(name)
    assert "ACRA" in text or "ACCOUNTING AND CORPORATE REGULATORY AUTHORITY" in text
    out, notes = ground_classification(
        _classify(lane=lane, doc_type=doc_type, description=description, description_en=description, vendor_name=vendor),
        text, company_name="Bright Harbour Pte Ltd", subject_only=False,
    )
    assert out["description_en"] == description and out["doc_type"] == doc_type and out["vendor_name"] == "ACRA", notes


# --- the fallback ----------------------------------------------------------------------------------


@pytest.mark.parametrize("doc_type,vendor,expected", [
    ("invoice", "Acme Pte Ltd", "Invoice from Acme Pte Ltd"),
    ("PO", None, "Purchase order"),
    ("delivery_order", None, "Delivery order"),
    ("other", None, "Document"),
    ("Business Profile", None, "Business Profile"),
    (None, None, "Document"),
    ("", "X Ltd", "Document from X Ltd"),
])
def test_the_fallback_is_built_only_from_safe_parts(doc_type, vendor, expected):
    assert grounded_fallback_description(doc_type, vendor) == expected
