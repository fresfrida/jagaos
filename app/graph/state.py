"""Explicit LangGraph state. ARCHITECTURE.md §0/§3: state lives here and in
SQLite, never in a conversation."""

from typing import Any, TypedDict


class PipelineState(TypedDict, total=False):
    run_id: str
    company_id: int
    document_id: int
    text: str
    text_source: str  # pdfplumber | ocr | exif | none

    # suffixed _result to avoid colliding with the node names "classify" /
    # "extract" / "verify" — LangGraph forbids a node name equal to a state key
    classify_result: dict[str, Any]
    extract_result: dict[str, Any]
    verify_result: dict[str, Any]
    review_resolution: dict[str, Any]

    events: list[dict[str, Any]]
    expectations_created: int
    obligations_created: int
