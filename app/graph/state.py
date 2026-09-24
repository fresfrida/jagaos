"""Explicit LangGraph state. ARCHITECTURE.md §0/§3: state lives here and in
SQLite, never in a conversation."""

from typing import Any, TypedDict


class PipelineState(TypedDict, total=False):
    run_id: str
    company_id: int
    document_id: int
    text: str
    text_source: str  # pdfplumber | ocr | exif | none
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

    # suffixed _result to avoid colliding with the node names "classify" /
    # "extract" / "verify" — LangGraph forbids a node name equal to a state key
    classify_result: dict[str, Any]
    extract_result: dict[str, Any]
    verify_result: dict[str, Any]
    review_resolution: dict[str, Any]

    events: list[dict[str, Any]]
    expectations_created: int
    obligations_created: int
