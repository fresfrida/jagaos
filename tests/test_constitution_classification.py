"""A company's own constitution is a statutory document (2026-09-25, round 18, DECISIONS #93).

Round 15 reworded the statutory lane from "ACRA/IRAS letters, notices, filings" to
"letters, notices and filings from a company registry, regulator or tax authority" (to
stop the prompt priming the model to write "ACRA"). A constitution is written by the
company and issued by no authority, so it fell out of the lane, became
important/contract, and could then never satisfy the "Company Constitution"
compliance-checklist row (which matches the doc_type slug "constitution"): under the
original prompt the demo corpus recorded 02_constitution.pdf as statutory/constitution.

The behaviour itself is asked of the real model in tests/test_gateway_live.py (the
constitution fixture, the lease that must stay important/contract, the rest of the
demo corpus, and the whole flow to a satisfied checklist row with a link). These are
the offline guards on the prompt text and on what it promises the checklist.
"""

import pytest

from app.graph.classify import COMPANY_CONSTITUTION_DOC_TYPE, render_system_prompt
from app.graph.derive_expectations import _matches_doc_type
from app.rules.expectations import LABEL_BY_DOC_TYPE


@pytest.fixture(scope="module")
def prompt() -> str:
    return render_system_prompt("English")


def test_the_statutory_lane_is_defined_to_include_a_companys_own_constitution(prompt):
    lane_definition = prompt.split("into one of four lanes:", 1)[1].split("invoice (bills", 1)[0]
    assert "constitution" in lane_definition.lower()
    assert "regulator or" in lane_definition, "the round-15 wording for notices and filings is kept"


def test_the_prompt_says_a_constitution_needs_no_issuing_authority_and_names_the_exact_doc_type(prompt):
    assert "A company's own\n  constitution" in prompt
    assert "memorandum and articles of association" in prompt
    assert "no authority issued it" in prompt
    assert f'doc_type exactly "{COMPANY_CONSTITUTION_DOC_TYPE}"' in prompt


def test_the_string_the_prompt_asks_for_is_the_checklist_rules_own_label_so_they_cannot_drift():
    assert COMPANY_CONSTITUTION_DOC_TYPE == LABEL_BY_DOC_TYPE["constitution"] == "Company Constitution"


def test_that_string_satisfies_the_constitution_row_by_the_checklists_own_matching_rule():
    assert _matches_doc_type("constitution", [COMPANY_CONSTITUTION_DOC_TYPE])
    assert not _matches_doc_type("constitution", ["contract"]), "what the round-15 prompt produced does not"


def test_the_prompt_still_sends_contracts_and_leases_to_the_important_lane(prompt):
    assert "important (contracts, leases," in prompt
    assert "Contracts if it is a contract, lease, or agreement" in prompt
    # and it does not swallow them into the constitution rule
    assert "lease" not in prompt.split("A company's own\n  constitution", 1)[1].split("For lane=invoice", 1)[0]


def test_the_earlier_statutory_guidance_is_untouched(prompt):
    assert 'doc_type exactly "Business Profile"' in prompt
    assert "Do not put an authority's name or acronym in it unless the text" in prompt
