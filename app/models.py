"""Typed tool contracts. ARCHITECTURE.md §4.

Every LLM node returns one of these, never free text and never a generic
`run_sql`. Every extracted value carries a confidence and a pointer back to
the characters it came from, so a citation in the UI is real, not decorative.
"""

from datetime import date
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


def to_tool(model: type[BaseModel], name: str, description: str) -> dict:
    """Pydantic model -> OpenAI-schema tool def. ARCHITECTURE.md §4: typed,
    side-effect-free, one job each — never a generic run_sql."""
    schema = model.model_json_schema()
    schema.pop("title", None)
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": schema,
        },
    }


class Provenance(BaseModel, Generic[T]):
    value: T
    confidence: float = Field(ge=0, le=1)
    page: int | None = None
    char_start: int | None = None
    char_end: int | None = None


class ClassifyResult(BaseModel):
    lane: Literal["statutory", "invoice", "important", "memory"]
    doc_type: str
    confidence: float = Field(ge=0, le=1)
    injection_suspected: bool = False
    # 2026-09-22: runs for every document regardless of lane (unlike
    # extract.py's InvoiceFields/StatutoryFields, which only run for
    # invoice/statutory — app/graph/extract.py's TOOLS_BY_LANE), so
    # description/tags come from here, not extract.py, or an
    # important/memory document (a lease, a photo) would never get one.
    description: str
    suggested_tags: list[str] = Field(default_factory=list)


class InvoiceFields(BaseModel):
    vendor: Provenance[str]
    # Provenance[str | None], not Provenance[str] | None: confirmed live
    # 2026-09-22 that when a field is genuinely absent (a non-SG invoice
    # with no GST registration number), the model returns a Provenance
    # object with confidence/page filled in and value=null, not an omitted
    # field. The stricter type crashed extraction with an unhandled
    # pydantic ValidationError (a 500, surfaced to the browser as "failed
    # to fetch") instead of a normal low-confidence/missing result.
    gst_reg_no: Provenance[str | None] | None = None
    invoice_no: Provenance[str]
    issued_on: Provenance[date]
    # float, not Decimal: pydantic renders Decimal as anyOf[number, string]
    # in JSON schema, and the gateway's tool-schema translation silently
    # drops any field using that shape — confirmed live 2026-09-21, see
    # GAPS.md new §11. Money values lose a little precision either way at
    # LLM-extraction confidence levels; verify.py re-parses via Decimal(str(..))
    # for the arithmetic check, so exact-cents comparisons still happen in code.
    subtotal: Provenance[float]
    gst: Provenance[float]
    total: Provenance[float]
    injection_suspected: bool = False


class StatutoryFields(BaseModel):
    """Statutory-lane extraction: ACRA/IRAS letters, notices, filings."""

    doc_type: Provenance[str]
    # Provenance[X | None], not Provenance[X] | None — same fix as
    # InvoiceFields.gst_reg_no above, same reason.
    reference_no: Provenance[str | None] | None = None
    issued_on: Provenance[date | None] | None = None
    due_on: Provenance[date | None] | None = None
    subject: Provenance[str]
    injection_suspected: bool = False


class ProposedEvent(BaseModel):
    kind: Literal[
        "incorporation",
        "office_move",
        "corpsec_change",
        "director_change",
        "gst_registration",
        "first_employee",
        "fy_end",
        "dormancy",
    ]
    occurred_on: date
    title: str
    confidence: float = Field(ge=0, le=1)


class VerifyResult(BaseModel):
    """Deterministic — no LLM. app/graph/verify.py."""

    ok: bool
    reasons: list[str] = Field(default_factory=list)
    needs_review: bool = False
    review_question: str | None = None


class DocumentEditRequest(BaseModel):
    """PATCH /api/documents/{id} body (2026-09-22). Both fields optional —
    only the ones sent are changed. `tags`, when sent, REPLACES the
    document's whole tag set (not additive) — the frontend sends the
    complete edited set, matching how a tag-chip editor naturally works."""

    description: str | None = None
    tags: list[str] | None = None


class ReviewResolution(BaseModel):
    """POST /api/review/{id}/resolve body. A human action, never reachable
    from an LLM node (app/graph/human_review.py, ARCHITECTURE.md §5.2)."""

    action: Literal["confirm", "reject"]
    corrected_fields: dict[str, Any] = Field(default_factory=dict)


RoleName = Literal["owner", "admin", "user", "viewer"]


class DevLoginRequest(BaseModel):
    """POST /api/auth/dev-login body. Placeholder for real magic-link email
    (app/auth.py's docstring) — email in, session out, no delivery step.
    Give company_name to create a new company (caller becomes its owner);
    omit it to log into an existing membership."""

    email: str
    name: str | None = None
    company_name: str | None = None
    fye_month: int | None = None
    fye_day: int | None = None


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None


class CompanyOut(BaseModel):
    id: int
    name: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut
    company: CompanyOut
    role: RoleName


class MeResponse(BaseModel):
    user: UserOut
    company: CompanyOut
    role: RoleName


class MemberOut(BaseModel):
    user_id: int
    email: str
    name: str | None
    role: RoleName


class AddMemberRequest(BaseModel):
    email: str
    name: str | None = None
    role: RoleName
