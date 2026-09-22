"""ingest node. ARCHITECTURE.md §3: no LLM — hash, dedupe, local text
extraction, EXIF."""

import hashlib
import mimetypes
import shutil
from pathlib import Path

from app.db import DB_PATH, get_conn
from app.extract import exif, ocr, pdf
from app.graph.state import PipelineState

DOCS_PATH = Path("./data/docs")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _local_text(path: Path, media_type: str) -> tuple[str, str]:
    if media_type == "application/pdf":
        if pdf.has_extractable_text(str(path)):
            return pdf.extract_text(str(path)), "pdfplumber"
        return ocr.extract_text(str(path)), "ocr"
    if media_type.startswith("image/"):
        text = ocr.extract_text(str(path))
        if len(text.strip()) >= 10:
            return text, "ocr"
        return "", "exif"
    return "", "none"


def ingest(
    company_id: int,
    source_path: str,
    filename: str,
    source_channel: str,
    source_identity: str | None = None,
    uploaded_by_user_id: int | None = None,
    db_path: str = DB_PATH,
) -> PipelineState:
    """Not a LangGraph node itself (it runs before we have a document_id to
    key state on) — called from app/main.py to create the document row,
    then the graph starts at `classify`."""
    src = Path(source_path)
    sha = _sha256(src)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    with get_conn(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM document WHERE sha256 = ?", (sha,)
        ).fetchone()
        if existing:
            conn.execute(
                "INSERT INTO security_event (document_id, kind, detail, action) "
                "VALUES (?, 'duplicate', ?, 'skipped')",
                (existing["id"], f"resubmitted as {filename}"),
            )
            return {"document_id": existing["id"], "text": "", "text_source": "duplicate"}

        DOCS_PATH.mkdir(parents=True, exist_ok=True)
        stored_path = DOCS_PATH / f"{sha}{src.suffix}"
        if str(stored_path) != str(src):
            shutil.copyfile(src, stored_path)

        text, text_source = _local_text(src, media_type)
        exif_data = exif.read_exif(str(src)) if media_type.startswith("image/") else {}

        cur = conn.execute(
            "INSERT INTO document "
            "(company_id, sha256, filename, media_type, bytes, stored_path, "
            " source_channel, source_identity, uploaded_by_user_id, occurred_on, status, "
            " extracted_text, text_source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)",
            (
                company_id, sha, filename, media_type, src.stat().st_size,
                str(stored_path), source_channel, source_identity, uploaded_by_user_id,
                exif_data.get("occurred_on"), text, text_source,
            ),
        )
        document_id = cur.lastrowid

    return {
        "run_id": sha[:12],
        "company_id": company_id,
        "document_id": document_id,
        "text": text,
        "text_source": text_source,
    }
