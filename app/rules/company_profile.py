"""Turning an extracted ACRA business profile into company-settings values,
and who may do it (2026-09-24, round 12, DECISIONS #79).

Deterministic — no LLM. The model proposes values (app/models.py's
CompanyProfileFields); this decides which of them are USABLE (a month of 13
is not a financial year end) and who is allowed to be offered them. Nothing
here writes the company row: the values are returned to the owner's form, and
the write is the owner's own Save (app/main.py::edit_company).
"""

import json
from datetime import date
from typing import Any

from app.auth import ROLE_ORDER
from app.graph.classify import is_company_profile_doc_type


def may_prefill_company_from(role: str, doc_type: str | None, status: str) -> bool:
    """The one rule for "can this caller pre-fill company settings from this
    document" — used to enforce it on GET /api/documents/{id}/company-profile
    and to advertise it as `can_prefill_company` on list/search rows, the same
    discipline as auth.may_edit_document (so the UI never offers what the
    server would refuse).

    Owner only — the same gate as editing company settings (PATCH
    /api/companies/{id}). The document must be a business profile AND filed:
    `filed` means a human confirmed the extracted values in the review queue
    (with any corrections), so the values offered to the settings form are
    ones a person has already looked at once, not the model's unreviewed
    proposal."""
    return (
        ROLE_ORDER.get(role, -1) >= ROLE_ORDER["owner"]
        and status == "filed"
        and is_company_profile_doc_type(doc_type)
    )


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def _int_in(value: Any, low: int, high: int) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(str(value).strip())
    except ValueError:
        return None
    if not number.is_integer():
        return None
    number = int(number)
    return number if low <= number <= high else None


def _flag(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("true", "yes", "registered", "1"):
            return True
        if normalized in ("false", "no", "not registered", "0"):
            return False
    return None


def _year_end(month: int | None, day: int | None) -> tuple[int | None, int | None]:
    """Both or neither: a month without a day (or a day this month never
    has, like 31 April) is not a financial year end, and half of one would
    silently rewrite only one of the company's two FYE columns. Leap year 2000
    is the calendar used so 29 February stays valid."""
    if month is None or day is None:
        return None, None
    try:
        date(2000, month, day)
    except ValueError:
        return None, None
    return month, day


def extraction_values(rows: list[tuple[str, str | None]]) -> dict[str, Any]:
    """`(field, value_text)` rows of one document's extraction table, oldest
    first, folded to the latest value per field. extract.py stores the model's
    values first and human_review.py stores a human correction as a NEW row
    afterwards (never an overwrite), so "last wins" is exactly "a person's
    correction beats the model's guess"."""
    values: dict[str, Any] = {}
    for field, value_text in rows:
        try:
            values[field] = json.loads(value_text) if value_text is not None else None
        except json.JSONDecodeError:
            values[field] = value_text
    return values


def company_settings_from_profile(values: dict[str, Any]) -> dict[str, Any]:
    """The five settings an ACRA business profile can pre-fill, keyed the way
    the company-settings form and PATCH /api/companies/{id} name them. Any
    value that is absent or unusable is None — the form then leaves that field
    as it is rather than blanking it."""
    month, day = _year_end(_int_in(values.get("fye_month"), 1, 12), _int_in(values.get("fye_day"), 1, 31))
    uen = _text(values.get("uen"))
    return {
        "name": _text(values.get("company_name")),
        "uen": uen.upper() if uen else None,
        "fye_month": month,
        "fye_day": day,
        "gst_registered": _flag(values.get("gst_registered")),
        "registered_address": _text(values.get("registered_address")),
    }
