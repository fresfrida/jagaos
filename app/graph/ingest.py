"""ingest node. ARCHITECTURE.md §3: no LLM — hash, dedupe, local text
extraction, EXIF."""

import hashlib
import mimetypes
import os
import shutil
from pathlib import Path

from app import activity
from app.db import DB_PATH, get_conn, reindex_document_search
from app.extract import exif, image_prep, ocr, pdf
from app.graph.state import PipelineState
from app.guards.injection import IMAGE_TEXT_CHAR_LIMIT, LLM_TEXT_CHAR_LIMIT

# 2026-09-24 (item 7, lifecycle audit): .env.example has declared
# JAGA_DOCS_PATH="./data/docs" since this project's very first commit, but
# nothing ever actually read it — confirmed by grepping the whole backend
# for the name. Changing it in a real .env silently did nothing; every
# document was always written to the hardcoded "./data/docs" regardless,
# the exact silent-hardcoded-path gap the project's own standing
# architecture rule exists to prevent. Same os.environ.get(..., default)
# pattern app/db.py's DB_PATH/app/llm.py's BASE_URL/API_KEY already use.
DOCS_PATH = Path(os.environ.get("JAGA_DOCS_PATH", "./data/docs"))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _local_text(path: Path, media_type: str, ocr_max_edge: int | None = None) -> tuple[str, str]:
    """The ONE place a document's pixels are read, and read once (round 6, DECISIONS #129): the text is returned here, stored in
    `document.extracted_text` by ingest(), and every later step (classify, extract, derive_events) works from that stored string.
    Nothing downstream re-opens the image, and nothing ever sends one to the gateway (it is text-only, MDs/GAPS.md §8)."""
    if media_type == "application/pdf":
        if pdf.has_extractable_text(str(path)):
            return pdf.extract_text(str(path)), "pdfplumber"
        return ocr.extract_pdf_text(str(path), max_edge=ocr_max_edge), "ocr"
    if media_type.startswith("image/"):
        # A normalized WORKING COPY, deleted right after: the uploaded file, its hash and its stored copy are untouched.
        with image_prep.working_copy(str(path)) as prepared:
            text = ocr.extract_text(prepared)
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
    visibility: str = "company",
    read_content: bool = True,
    ocr_max_edge: int | None = None,
) -> PipelineState:
    """Not a LangGraph node itself (it runs before we have a document_id to
    key state on) — called from app/main.py to create the document row,
    then the graph starts at `classify`.

    `read_content=False` (round 21, A3, DECISIONS #101) stores the file and records the row but reads nothing out of it: no
    text extraction, no OCR, no EXIF. A personal file is named by its owner and goes nowhere near the pipeline, so there is
    no reason to spend an OCR pass (or hold the PDF renderer's lock) on it, or to keep text a person never asked to have read."""
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

        # 2026-09-24: text is extracted from the incoming file BEFORE it is
        # copied into permanent storage. This used to copy first, so any
        # extraction failure (an image-only PDF crashed here) left a stored
        # file with no document row — confirmed live, 67 to 68 files in
        # data/docs. Nothing below needs the stored copy to exist yet.
        if read_content:
            text, text_source = _local_text(src, media_type, ocr_max_edge)
            exif_data = exif.read_exif(str(src)) if media_type.startswith("image/") else {}
        else:
            text, text_source, exif_data = "", "none", {}

        DOCS_PATH.mkdir(parents=True, exist_ok=True)
        stored_path = DOCS_PATH / f"{sha}{src.suffix}"
        # Only a copy THIS call created may be removed if the insert fails:
        # a concurrent identical upload can already have stored (and be about
        # to reference) the same sha-named file.
        created_copy = str(stored_path) != str(src) and not stored_path.exists()
        if str(stored_path) != str(src):
            shutil.copyfile(src, stored_path)

        try:
            cur = conn.execute(
                "INSERT INTO document "
                "(company_id, sha256, filename, media_type, bytes, stored_path, "
                " source_channel, source_identity, uploaded_by_user_id, occurred_on, status, "
                " extracted_text, text_source, visibility) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)",
                (
                    company_id, sha, filename, media_type, src.stat().st_size,
                    str(stored_path), source_channel, source_identity, uploaded_by_user_id,
                    exif_data.get("occurred_on"), text, text_source, visibility,
                ),
            )
            document_id = cur.lastrowid
            # Round 6 (DECISIONS #129): the row exists, so "Uploaded" is true now, written in this same transaction (both commit or
            # neither does). By the uploader's name as it is today, else their email; a non-web source names itself, else no name.
            activity.record_for_document(
                conn, document_id, activity.UPLOADED,
                activity.actor_for_user(conn, uploaded_by_user_id, fallback=source_identity),
            )
        except Exception:
            if created_copy:
                stored_path.unlink(missing_ok=True)
            raise

    # First time extracted_text exists for this document — index it so
    # search works even before classify.py adds description/bucket/
    # vendor_name (which re-index again themselves). doc_type/description/
    # bucket/vendor_name are all still blank at this point; that's fine,
    # the row just gets more complete as the pipeline proceeds.
    reindex_document_search(document_id, db_path)

    return {
        "run_id": sha[:12],
        "company_id": company_id,
        "document_id": document_id,
        "text": text,
        "text_source": text_source,
        # A single photo's text is capped far below a document's (guards/injection.py); the file was normalized above, this bounds
        # what the model is sent from it.
        "text_char_limit": IMAGE_TEXT_CHAR_LIMIT if media_type.startswith("image/") else LLM_TEXT_CHAR_LIMIT,
    }
