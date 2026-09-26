"""Explicit LangGraph state. ARCHITECTURE.md §0/§3: state lives here and in
SQLite, never in a conversation."""

from typing import Any, TypedDict


class PipelineState(TypedDict, total=False):
    run_id: str
    company_id: int
    document_id: int
    text: str
    text_source: str  # pdfplumber | ocr | exif | none
    # Round 6 (DECISIONS #129): how many characters of `text` one paid call may carry (guards/injection.py). Set by ingest, read by
    # classify/extract/derive_events. Declared here for the same LangGraph reason as `language`: an undeclared key is dropped.
    text_char_limit: int
    # 2026-09-23: set from the upload-time "is this a picture?" toggle
    # (app/main.py) — when true, classify.py skips its LLM call entirely
    # and sets lane/doc_type/bucket deterministically (see its docstring).
    is_picture: bool
    # 2026-09-24 (item 5): the uploader's selected UI language
    # (app/main.py, web/src/i18n.ts) — read by classify.py to generate its
    # description directly in this language. A real bug found live while
    # verifying this exact feature: this key must be declared here, not
    # just set on the dict in app/main.py — LangGraph's StateGraph derives
    # its accepted state schema from this TypedDict's own annotations, and
    # silently dropped an undeclared key before the first node ever saw
    # it (confirmed by comparing against is_picture above, which already
    # worked precisely because it's declared here).
    language: str
    # 2026-09-24 (round 13, DECISIONS #85): "company" | "only_me". Must be
    # declared here for the same reason `language` is — LangGraph drops any
    # state key that is not on this TypedDict. Read by derive_events, which
    # never proposes a company event from a personal file.
    visibility: str
    # 2026-09-24 (round 16, DECISIONS #90): the doc_type slug of the compliance
    # checklist item this upload was started from ("Upload" beside a missing row),
    # already validated against rules/expectations.LABEL_BY_DOC_TYPE by
    # app/main.py. A hint for classify.py's prompt, never a classification.
    # Declared here for the same LangGraph reason as `language`.
    doc_type_hint: str

    # suffixed _result to avoid colliding with the node names "classify" /
    # "extract" / "verify" — LangGraph forbids a node name equal to a state key
    classify_result: dict[str, Any]
    extract_result: dict[str, Any]
    verify_result: dict[str, Any]
    review_resolution: dict[str, Any]

    events: list[dict[str, Any]]
    expectations_created: int
    obligations_created: int
