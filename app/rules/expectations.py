"""Expected-document-set rules — the gap-analysis half of the thesis
(ARCHITECTURE.md §2: `expectation` table, INDEXING.md §0).

**Known gap:** this starter set is intentionally small. The team's real
"19 documents requested, 14 held" checklist (GAPS.md, the origin story) is
external data that lives with the team, not fabricated here — load it into
EXPECTED_ON_INCORPORATION (or a company-specific override) before running
the real backlog, per docs/WRITEUP.md §3. Shipping a plausible-looking but
invented checklist would be worse than shipping a short honest one.
"""

from dataclasses import dataclass


@dataclass
class ExpectationRule:
    rule_id: str
    doc_type: str
    label: str
    event_kind: str
    due_offset_days: int | None = None  # None = no deadline, just "should exist"


EXPECTED_ON_INCORPORATION: list[ExpectationRule] = [
    ExpectationRule(
        rule_id="incorp_certificate",
        doc_type="certificate_of_incorporation",
        label="Certificate of Incorporation",
        event_kind="incorporation",
    ),
    ExpectationRule(
        rule_id="incorp_constitution",
        doc_type="constitution",
        label="Company Constitution",
        event_kind="incorporation",
    ),
    ExpectationRule(
        rule_id="incorp_share_register",
        doc_type="share_register",
        label="Register of Members / Share Register",
        event_kind="incorporation",
    ),
    ExpectationRule(
        rule_id="incorp_first_annual_return",
        doc_type="annual_return",
        label="First Annual Return",
        event_kind="incorporation",
        due_offset_days=7 * 30,
    ),
]

EXPECTED_ON_CORPSEC_CHANGE: list[ExpectationRule] = [
    ExpectationRule(
        rule_id="handover_statutory_register",
        doc_type="statutory_register",
        label="Statutory Registers (members, directors, charges)",
        event_kind="corpsec_change",
    ),
    ExpectationRule(
        rule_id="handover_agm_minutes",
        doc_type="agm_minutes",
        label="Last 3 years of AGM/Board Minutes",
        event_kind="corpsec_change",
    ),
]

BY_EVENT_KIND: dict[str, list[ExpectationRule]] = {
    "incorporation": EXPECTED_ON_INCORPORATION,
    "corpsec_change": EXPECTED_ON_CORPSEC_CHANGE,
}

# Every checklist item there is, keyed by its doc_type slug. The upload's
# `doc_type_hint` (round 16, DECISIONS #90) may only be one of these: the slug
# is looked up here and the LABEL is what reaches the classify prompt, so no
# client-supplied text is ever put in front of the model.
LABEL_BY_DOC_TYPE: dict[str, str] = {
    rule.doc_type: rule.label for rules in BY_EVENT_KIND.values() for rule in rules
}


def hint_label(doc_type_hint: str | None) -> str | None:
    """The checklist label a doc_type_hint names, or None for no hint or one
    that is not a real checklist slug (ignored rather than rejected: a hint is a
    suggestion, never a reason to refuse an upload)."""
    return LABEL_BY_DOC_TYPE.get(doc_type_hint) if doc_type_hint else None


def derive_expectations(company_id: int, event_id: int, event_kind: str, occurred_on: str) -> list[dict]:
    """Pure function: an event -> the document set it should have produced.
    Called from app/graph/derive_expectations.py, never from an LLM node."""
    rules = BY_EVENT_KIND.get(event_kind, [])
    out = []
    for rule in rules:
        out.append(
            {
                "company_id": company_id,
                "event_id": event_id,
                "doc_type": rule.doc_type,
                "label": rule.label,
                "due_on": None,
                "rule_id": rule.rule_id,
                "status": "missing",
            }
        )
    return out
