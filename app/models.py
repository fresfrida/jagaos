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


# The backend's copy of the fixed bucket taxonomy (DECISIONS #42). Validates
# ClassifyResult and DocumentEditRequest, and app/graph/classify.py builds
# its prompt's bucket list from this — so a bucket added here is
# automatically offered to the model. The one other hand-kept copy is the
# frontend's BUCKETS (web/src/features/ops/opsApi.ts); tests/test_buckets.py
# fails if the two drift. "Contracts" added 2026-09-24 (round 11).
BucketName = Literal[
    "Receivables", "Expenses", "Statutory", "Operations", "Contracts", "Memory Lane", "Miscellaneous",
]


# 2026-09-24 (round 13, DECISIONS #85): who an uploaded document is for. The
# values match document.visibility (app/db.py) and app/auth.py's constants.
Visibility = Literal["company", "only_me"]


class ClassifyResult(BaseModel):
    lane: Literal["statutory", "invoice", "important", "memory"]
    doc_type: str
    confidence: float = Field(ge=0, le=1)
    injection_suspected: bool = False
    # 2026-09-22: runs for every document regardless of lane (unlike
    # extract.py's InvoiceFields/StatutoryFields, which only run for
    # invoice/statutory — app/graph/extract.py's TOOLS_BY_LANE), so
    # description/bucket/vendor_name come from here, or an important/
    # memory document (a lease, a photo) would never get one.
    #
    # 2026-09-24 (items 5/6): `description` is now written in the
    # uploader's own selected UI language (state["language"],
    # app/graph/classify.py's SYSTEM prompt) instead of always English.
    # `description_en` is the same description in English regardless —
    # the guaranteed fallback language item 6's bilingual storage needs
    # (a document generated before a given language existed, or one
    # nobody's viewed in that language yet, always has this to fall back
    # to). When the selected language already is English these are
    # naturally identical — the model just writes the same sentence into
    # both, not a second real translation effort.
    description: str
    description_en: str
    # 2026-09-22 (DECISIONS #42): supersedes suggested_tags/the tag table
    # — a fixed taxonomy needs no join tables. For lane=invoice this is
    # only a provisional guess (classify runs before extraction, so it
    # doesn't know the vendor yet); app/graph/extract.py deterministically
    # corrects Receivables vs Expenses once the real vendor is known.
    bucket: BucketName
    vendor_name: str | None = None


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
    # 2026-09-24 (item 10): renamed from `gst` — this document isn't
    # necessarily Singaporean, so the tax line on it isn't necessarily
    # GST (an Indonesian invoice's is PPN, at 11%, not 9%). `tax` holds
    # whatever the tax amount actually is; `tax_label` records what the
    # document itself calls it, verbatim ("GST", "PPN 11%", "VAT") — never
    # assumed or defaulted. app/graph/verify.py's 9%-rate arithmetic check
    # is now conditional on the company's own locality (see its own
    # comment) rather than applied to every invoice unconditionally.
    tax: Provenance[float]
    tax_label: Provenance[str | None] | None = None
    # 2026-09-24 (item 9): no currency field existed at all before this —
    # confirmed by reading this model in full. Never assumed/defaulted to
    # SGD; the SYSTEM prompt (extract.py) instructs recording whatever
    # currency code/symbol is actually on the document.
    currency: Provenance[str | None] | None = None
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


class CompanyProfileFields(BaseModel):
    """Statutory-lane extraction for a company's OWN identity document — an
    ACRA business profile / BizFile (2026-09-24, round 12, DECISIONS #79).

    A different shape from StatutoryFields, which models a filing NOTICE
    (reference_no, issued_on, due_on, subject) and has nowhere to put "who
    this company is". These are the values the owner can pre-fill Company
    Settings from; every write into the company row is still the owner's own
    click on Save (app/main.py::edit_company), never this node's.

    company_name is the one required value — a business profile without a
    name is not one. Everything else follows the existing
    Provenance[X | None] | None = None pattern (InvoiceFields.gst_reg_no,
    StatutoryFields.reference_no), for the same reason: a real profile can
    omit a value, and the model then returns a Provenance whose value is
    null rather than dropping the field.

    The financial year end is two integers, not one string as printed
    ("31 December"): the company table stores fye_month/fye_day, and the
    range check that decides whether they are usable is deterministic code
    (app/main.py's prefill endpoint), not the model's say-so. gst_registered
    is optional because GST registration is IRAS's record, not ACRA's, and a
    profile often does not state it."""

    company_name: Provenance[str]
    uen: Provenance[str | None] | None = None
    fye_month: Provenance[int | None] | None = None
    fye_day: Provenance[int | None] | None = None
    gst_registered: Provenance[bool | None] | None = None
    registered_address: Provenance[str | None] | None = None
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


class ReviewReason(BaseModel):
    """One structured reason a document needs review: a stable `code`
    naming an `ops.review.reasons.<code>` i18n key on the frontend, plus
    the interpolation values it needs (coerced to str — i18n interpolation
    deals in strings, not Decimals/dates). Supersedes a pre-joined English
    sentence built here server-side (2026-09-23, live regression report
    items 7/8/10b): this file has no notion of the caller's language, so a
    ready-made sentence could never actually be translated — the frontend
    now owns the phrasing instead, this just carries what it needs to."""

    code: str
    params: dict[str, str] = Field(default_factory=dict)


class VerifyResult(BaseModel):
    """Deterministic — no LLM. app/graph/verify.py."""

    ok: bool
    reasons: list[ReviewReason] = Field(default_factory=list)
    needs_review: bool = False


class DocumentEditRequest(BaseModel):
    """PATCH /api/documents/{id} body. 2026-09-22: `tags` replaced by
    `bucket`/`vendor_name`/`doc_type` (DECISIONS #42, tag table
    superseded); `filename` added the same day — display name only,
    `stored_path`/`sha256` (the actual file on disk) are never touched by
    this. Every field is optional — only the ones sent are changed.
    doc_type is plain str here, not BucketName's kind of closed vocabulary
    — the statutory lane's doc_type is free text naming the actual filing
    (app/graph/derive_expectations.py::_matches_doc_type matches it against
    fixed slugs by substring, not by an enum), so a human correcting it
    must be able to type anything, same as the model can.

    is_picture (2026-09-23, DECISIONS #52): the same "picture, not a
    document" call as the upload-time toggle, correctable after the fact.
    Deliberately one-directional — True overrides lane/doc_type/bucket to
    memory/photo/"Memory Lane" (app/main.py::edit_document); False or
    omitted does nothing. There's no defined "reclassify back out of
    memory" behavior here (it would need real classification, not a
    deterministic rule), so this only ever corrects a document *into*
    being marked a picture, never back out."""

    description: str | None = None
    bucket: BucketName | None = None
    vendor_name: str | None = None
    doc_type: str | None = None
    filename: str | None = None
    is_picture: bool | None = None
    # 2026-09-24 (items 5/6): which language `description` (above) is
    # written in — a human editing/correcting the description edits it in
    # whatever language they're currently viewing the app in, so this
    # merges into just that one key of the stored {"en": ..., "ms": ...}
    # blob (app/db.py's description helpers), not overwrite every
    # language's text with a single-language correction. Defaults to
    # English when omitted, matching every other language default in this
    # codebase (app/graph/classify.py, app/db.py).
    language: str | None = None
    # 2026-09-24 (round 14, DECISIONS #86): flip the document between
    # "company" and "only_me" after upload — the lock toggle on a file. Only the
    # uploader may (app/auth.py::may_change_visibility), NOT everyone who may
    # edit the other fields; a request that carries it from anyone else is
    # refused whole (403), so a refused change never half-applies.
    visibility: Visibility | None = None


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
    # 2026-09-23 (role/permission work): fye_month/fye_day were always in
    # the `company` table but never returned to the frontend by either
    # dev_login or /api/auth/me — no endpoint existed to edit them, so
    # there was nothing to show them for. Now the new company-settings
    # page needs the current values to edit, not just blindly overwrite.
    fye_month: int
    fye_day: int
    # 2026-09-24 (company-local dates): IANA name, e.g. "Asia/Singapore" —
    # the frontend needs this to compute the company's "today" (Calendar's
    # day-bucketing/highlight) independent of the viewing device's own
    # local time (an admin traveling should still see the company's today).
    timezone: str
    # 2026-09-24 (round 12, DECISIONS #79): the rest of the identity fields
    # Company Settings now edits (and an ACRA profile can pre-fill). Defaults,
    # not required, so a payload built without them still validates.
    uen: str | None = None
    gst_registered: bool = False
    registered_address: str | None = None


class CompanyProfilePrefill(BaseModel):
    """GET /api/documents/{id}/company-profile — company-settings values read
    from a confirmed ACRA business profile. None = the document did not state
    it or the value was unusable; the form leaves that field unchanged."""

    document_id: int
    filename: str
    name: str | None = None
    uen: str | None = None
    fye_month: int | None = None
    fye_day: int | None = None
    gst_registered: bool | None = None
    registered_address: str | None = None


class MyCompanyOut(BaseModel):
    """One row of GET /api/auth/companies — a company the caller holds a
    membership in, with the role they hold THERE. group_* are populated only
    for an owner membership (app/auth.py::list_memberships)."""

    id: int
    name: str
    role: RoleName
    group_id: int | None = None
    group_name: str | None = None


class SwitchCompanyRequest(BaseModel):
    company_id: int


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


class CompanyEditRequest(BaseModel):
    """PATCH /api/companies/{id} body (2026-09-23, role/permission work).
    Owner-only (app/main.py::edit_company). Started as exactly the fields
    `dev_login`'s signup form already collects (`name`/`fye_month`/
    `fye_day`); `timezone` (2026-09-24) and `uen`/`gst_registered`/
    `registered_address` (round 12) were added since — still not the company
    table's full column set (`incorporated_on`/`gst_period`/`dormant` have
    no UI to collect or validate them yet). Every field optional — only the
    ones sent are changed, same convention as `DocumentEditRequest`."""

    # min_length: an empty name would save fine and then render as a blank
    # company everywhere (2026-09-24 — found while wiring the ACRA pre-fill,
    # which can hand the form an empty value).
    name: str | None = Field(default=None, min_length=1)
    fye_month: int | None = Field(default=None, ge=1, le=12)
    fye_day: int | None = Field(default=None, ge=1, le=31)
    # 2026-09-24 (company-local dates): IANA name — validated against
    # zoneinfo's own database on save (app/main.py::edit_company), not just
    # accepted as an arbitrary string.
    timezone: str | None = None
    # 2026-09-24 (round 12, DECISIONS #79): the ACRA business-profile fields.
    # uen/registered_address are free text — no UEN format rule is enforced
    # because none is cited anywhere in this repo (CLAUDE.md: no statutory
    # rule without a citation); a blank string clears the value.
    uen: str | None = Field(default=None, max_length=32)
    gst_registered: bool | None = None
    registered_address: str | None = Field(default=None, max_length=500)
