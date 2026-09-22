"""Born-digital PDF text extraction. GAPS.md §8: better than vision for
text documents — no character hallucination, free, deterministic."""

import pdfplumber


def extract_text(path: str) -> str:
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            parts.append(text)
    return "\n\n".join(parts).strip()


def has_extractable_text(path: str, min_chars: int = 20) -> bool:
    """A scanned PDF (image-only) yields ~nothing from pdfplumber; route
    those to OCR instead."""
    return len(extract_text(path)) >= min_chars
