"""SG statutory calendar. ARCHITECTURE.md §12: "dates are law, not
judgment" — no LLM in this file, deterministic only.

**Verification status**: the three rules below reflect the facts already
checked into MOAT.md (Annual Return survives dormancy, s155/s155A
disqualification, IRAS Form C-S/C still required absent a waiver). The exact
day-of-month figures are working approximations for the prototype, not
sourced from a lawyer or ACRA/IRAS e-Service directly — confirm before the
write-up cites a specific date in the Impact & Outcomes section
(docs/WRITEUP.md §3). Do not add a rule here without a citation.
"""

from dataclasses import dataclass
from datetime import date

from dateutil.relativedelta import relativedelta


@dataclass
class ObligationRule:
    rule_id: str
    kind: str
    label: str
    citation: str
    lead_days: int
    risk: str

    def due_on(self, fye: date) -> date:
        raise NotImplementedError


@dataclass
class AnnualReturnRule(ObligationRule):
    def due_on(self, fye: date) -> date:
        return fye + relativedelta(months=7)


@dataclass
class FormCSRule(ObligationRule):
    def due_on(self, fye: date) -> date:
        # YA follows the calendar year after FYE; e-filing deadline is
        # conventionally 30 Nov / 15 Dec of the following year. Using 30 Nov
        # as the conservative (earlier) date.
        ya_year = fye.year + 1
        return date(ya_year, 11, 30)


RULES: list[ObligationRule] = [
    AnnualReturnRule(
        rule_id="acra_s197_annual_return",
        kind="annual_return",
        label="File Annual Return",
        citation=(
            "Companies Act s197: Annual Return due within 7 months of FYE. "
            "Dormancy does not exempt this; AGM/FS exemption is separate "
            "(s175A dispensation, s201A audit exemption)."
        ),
        lead_days=60,
        risk="high",  # s155/s155A disqualification exposure — MOAT.md
    ),
    FormCSRule(
        rule_id="ira_form_c_s_c",
        kind="corporate_tax_filing",
        label="File Form C-S/C",
        citation=(
            "Income Tax Act: Form C-S/C due unless IRAS has granted a "
            "filing waiver for the dormant company."
        ),
        lead_days=60,
        risk="high",
    ),
]


def derive_obligations(company_id: int, fye: date, event_id: int | None) -> list[dict]:
    """Pure function: company FYE -> this year's dated obligations. Called
    from app/graph/derive_obligations.py, never from an LLM node."""
    out = []
    for rule in RULES:
        due = rule.due_on(fye)
        out.append(
            {
                "company_id": company_id,
                "event_id": event_id,
                "kind": rule.kind,
                "label": rule.label,
                "due_on": due.isoformat(),
                "lead_days": rule.lead_days,
                "rule_id": rule.rule_id,
                "status": "open",
                "citation": rule.citation,
                "risk": rule.risk,
            }
        )
    return out
