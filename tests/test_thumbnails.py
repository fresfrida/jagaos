"""First-page thumbnails of PDFs (2026-09-25, round 20, item 5, DECISIONS #97).

app/thumbnails.py renders and caches; GET /api/documents/{id}/thumbnail serves under the SAME rule as
the file itself. Real PDFs from the repo's own corpus, real logins; documents are inserted straight into
the database (the upload pipeline would call the gateway to classify a PDF with text, and this is not
about classification). Every test gets its own cache directory.
"""

import hashlib
import io
import itertools
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import thumbnails
from app.db import get_conn
from app.main import app

client = TestClient(app)
ROOT = Path(__file__).resolve().parent.parent
CORPUS_PDF = ROOT / "evals" / "demo_corpus" / "files" / "05_invoice_clean.pdf"
_counter = itertools.count(1)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _unique_pdf(tmp_path: Path) -> tuple[Path, str]:
    """A real, renderable PDF that no other test holds: the corpus invoice plus a trailing comment."""
    data = CORPUS_PDF.read_bytes() + f"\n% test {next(_counter)} {tmp_path.name}\n".encode()
    sha = hashlib.sha256(data).hexdigest()
    path = tmp_path / f"{sha}.pdf"
    path.write_bytes(data)
    return path, sha


@pytest.fixture(autouse=True)
def cache(tmp_path, monkeypatch) -> Path:
    directory = tmp_path / "thumbs"
    monkeypatch.setattr(thumbnails, "THUMBS_PATH", directory)
    return directory


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@thumb.test", "company_name": "Thumb Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens = {"owner": owner["token"]}
    ids = {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@thumb.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"]}


def _insert(team: dict, path: Path, sha: str, *, uploader: str = "user1", media_type: str = "application/pdf",
            visibility: str = "company", status: str = "filed") -> int:
    with get_conn() as conn:
        return conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, "
            "uploaded_by_user_id, status, visibility) VALUES (?, ?, ?, ?, ?, ?, 'web', ?, ?, ?)",
            (team["company_id"], sha, path.name, media_type, path.stat().st_size, str(path), team["ids"][uploader], status, visibility),
        ).lastrowid


def _get(team: dict, actor: str, doc: int):
    return client.get(f"/api/documents/{doc}/thumbnail", headers=_headers(team["tokens"][actor]))


# --- the module ---------------------------------------------------------------------------------------


def test_it_renders_the_first_page_as_a_small_jpeg_named_by_the_content_hash(tmp_path, cache):
    pdf, sha = _unique_pdf(tmp_path)

    result = thumbnails.get_pdf_thumbnail(sha, str(pdf))

    assert result == cache / f"{sha}.jpg"
    image = Image.open(result)
    assert image.format == "JPEG"
    assert 0 < max(image.size) <= thumbnails.THUMB_MAX_SIDE
    assert result.stat().st_size < 60_000  # a thumbnail, not a page
    assert list(cache.glob("*.tmp")) == []


def test_a_thumbnail_is_written_to_a_temp_file_and_renamed_into_place(tmp_path, cache, monkeypatch):
    """So a reader never sees half a JPEG and two racing renders cannot corrupt each other."""
    pdf, sha = _unique_pdf(tmp_path)
    renamed = []
    real_replace = thumbnails.os.replace

    def spy(source, destination):
        assert not Path(destination).exists(), "the finished name must not exist before the rename"
        renamed.append((Path(source).name, Path(destination).name))
        real_replace(source, destination)

    monkeypatch.setattr(thumbnails.os, "replace", spy)

    thumbnails.get_pdf_thumbnail(sha, str(pdf))

    assert len(renamed) == 1
    temp_name, final_name = renamed[0]
    assert final_name == f"{sha}.jpg" and temp_name.endswith(".tmp") and temp_name != final_name


def test_a_second_request_reuses_the_cached_file_and_does_not_render_again(tmp_path, monkeypatch):
    pdf, sha = _unique_pdf(tmp_path)
    first = thumbnails.get_pdf_thumbnail(sha, str(pdf))
    monkeypatch.setattr(thumbnails, "_render", lambda *a, **k: pytest.fail("rendered again"))

    assert thumbnails.get_pdf_thumbnail(sha, str(pdf)) == first


def test_an_unreadable_pdf_gives_none_leaves_nothing_behind_and_is_retried_next_time(tmp_path, cache):
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4\nthis is not a pdf at all")
    sha = hashlib.sha256(b"broken").hexdigest()

    assert thumbnails.get_pdf_thumbnail(sha, str(broken)) is None
    assert not (cache / f"{sha}.jpg").exists()
    assert list(cache.glob("*")) == []

    good, _ = _unique_pdf(tmp_path)
    broken.write_bytes(good.read_bytes())  # the same content key now renders: a failure was not remembered
    assert thumbnails.get_pdf_thumbnail(sha, str(broken)) is not None


def test_a_pdf_with_no_pages_gives_none(tmp_path, monkeypatch):
    monkeypatch.setattr(thumbnails, "_render", lambda *a, **k: False)
    assert thumbnails.get_pdf_thumbnail("ab" * 32, str(tmp_path / "x.pdf")) is None


def test_the_cache_path_only_ever_comes_from_a_hex_digest():
    for bad in ("", "../../etc/passwd", "abc/def", "xyz", "abc.jpg", "ab" * 32 + "/../x"):
        with pytest.raises(ValueError):
            thumbnails.thumbnail_path(bad)
    assert thumbnails.thumbnail_path("AB12").name == "ab12.jpg"


def test_remove_thumbnail_deletes_it_once_and_never_raises(tmp_path):
    pdf, sha = _unique_pdf(tmp_path)
    thumbnails.get_pdf_thumbnail(sha, str(pdf))

    assert thumbnails.remove_thumbnail(sha) is True
    assert thumbnails.remove_thumbnail(sha) is False
    assert thumbnails.remove_thumbnail("../../etc/passwd") is False


def test_many_requests_for_one_missing_thumbnail_all_get_a_complete_file(tmp_path, cache):
    pdf, sha = _unique_pdf(tmp_path)
    results, errors = [], []

    def ask():
        try:
            results.append(thumbnails.get_pdf_thumbnail(sha, str(pdf)))
        except Exception as e:  # pragma: no cover - the point of the test is that this never happens
            errors.append(e)

    threads = [threading.Thread(target=ask) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert len(results) == 8 and all(r == cache / f"{sha}.jpg" for r in results)
    Image.open(results[0]).load()  # a whole, decodable JPEG, never a half-written one
    assert list(cache.glob("*.tmp")) == []


class _FakePdf:
    """Stands in for pdfplumber.open: one page whose render sleeps and records how many renders overlap."""

    running = 0
    peak = 0
    guard = threading.Lock()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def pages(self):
        return [self]

    def to_image(self, resolution=72):
        cls = _FakePdf
        with cls.guard:
            cls.running += 1
            cls.peak = max(cls.peak, cls.running)
        threading.Event().wait(0.03)
        with cls.guard:
            cls.running -= 1
        return type("Rendered", (), {"original": Image.new("RGB", (120, 160), (255, 255, 255))})()


def test_renders_never_overlap_with_each_other_or_with_the_ocr_step(tmp_path, monkeypatch):
    """PDFium is not thread-safe: two page renders at once abort the whole process (app/extract/pdfium_lock.py).
    Thumbnails and the OCR of a scanned upload both render, and both can be in flight in a thread pool."""
    from app.extract import ocr

    _FakePdf.running = _FakePdf.peak = 0
    monkeypatch.setattr(thumbnails.pdfplumber, "open", lambda *_a, **_k: _FakePdf())
    monkeypatch.setattr(ocr.pytesseract, "image_to_string", lambda *_a, **_k: "text")
    shas = [hashlib.sha256(str(i).encode()).hexdigest() for i in range(6)]
    workers = [threading.Thread(target=thumbnails.get_pdf_thumbnail, args=(sha, "x.pdf")) for sha in shas]
    workers += [threading.Thread(target=ocr.extract_pdf_text, args=("x.pdf",)) for _ in range(3)]

    for w in workers:
        w.start()
    for w in workers:
        w.join()

    assert _FakePdf.peak == 1, f"{_FakePdf.peak} renders overlapped"


def test_real_pdfs_rendered_from_many_threads_do_not_abort_the_process(tmp_path):
    """The hazard itself, in a child process so a native abort fails this test instead of ending the run:
    eight threads, eight different real PDFs, through the public entry point."""
    import subprocess
    import sys
    import textwrap

    script = textwrap.dedent(f"""
        import hashlib, sys, threading
        from pathlib import Path
        from app import thumbnails
        thumbnails.THUMBS_PATH = Path({str(tmp_path / "stress")!r})
        source = Path({str(CORPUS_PDF)!r}).read_bytes()
        paths = []
        for i in range(8):
            data = source + f"\\n% stress {{i}}\\n".encode()
            sha = hashlib.sha256(data).hexdigest()
            path = Path({str(tmp_path)!r}) / f"{{sha}}.pdf"
            path.write_bytes(data)
            paths.append((sha, str(path)))
        results = []
        threads = [threading.Thread(target=lambda s=s, p=p: results.append(thumbnails.get_pdf_thumbnail(s, p))) for s, p in paths * 2]
        for t in threads: t.start()
        for t in threads: t.join()
        assert len(results) == 16 and all(r is not None for r in results), results
        print("OK")
    """)
    done = subprocess.run([sys.executable, "-c", script], cwd=ROOT, capture_output=True, text=True, timeout=120)

    assert done.returncode == 0, f"exit {done.returncode}: {done.stderr[-400:]}"
    assert "OK" in done.stdout


# --- the endpoint ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("actor", ["owner", "admin", "user1", "user2", "viewer"])
def test_everyone_in_the_company_can_get_a_filed_company_documents_thumbnail(team, tmp_path, actor):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha)

    response = _get(team, actor, doc)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert Image.open(io.BytesIO(response.content)).format == "JPEG"


def test_the_thumbnail_is_made_on_the_first_request_and_kept(team, tmp_path, cache):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha)
    assert not (cache / f"{sha}.jpg").exists()

    _get(team, "user1", doc)

    assert (cache / f"{sha}.jpg").is_file()


@pytest.mark.parametrize("actor", ["owner", "admin", "user2", "viewer"])
def test_a_personal_files_thumbnail_is_its_uploaders_alone_and_a_404_for_everyone_else(team, tmp_path, cache, actor):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha, uploader="user1", visibility="only_me")

    assert _get(team, actor, doc).status_code == 404
    assert not (cache / f"{sha}.jpg").exists()  # nothing was even rendered for someone who may not see it
    assert _get(team, "user1", doc).status_code == 200


@pytest.mark.parametrize("actor,expected", [("owner", 200), ("admin", 200), ("user1", 200), ("user2", 404), ("viewer", 404)])
def test_a_pending_documents_thumbnail_follows_the_review_visibility_rule(team, tmp_path, actor, expected):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha, uploader="user1", status="needs_review")
    assert _get(team, actor, doc).status_code == expected


def test_an_archived_documents_thumbnail_is_a_404_like_its_file(team, tmp_path):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha, status="archived")
    assert _get(team, "owner", doc).status_code == 404


def test_another_companys_member_gets_a_404(team, tmp_path):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha)
    stranger = client.post(
        "/api/auth/dev-login",
        json={"email": "stranger@thumb.test", "company_name": "Other Thumb Co", "fye_month": 12, "fye_day": 31},
    ).json()
    assert client.get(f"/api/documents/{doc}/thumbnail", headers=_headers(stranger["token"])).status_code == 404


def test_it_needs_a_session(team, tmp_path):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha)
    assert client.get(f"/api/documents/{doc}/thumbnail").status_code == 401


def test_a_photo_has_one_too_since_s1e_and_never_through_the_pdf_renderer_but_another_type_is_a_404(team, tmp_path, monkeypatch):
    """Was `only a PDF has one`; since round 7 S1e stage 1 (DECISIONS #138) a photo has a thumbnail too (tests/test_image_thumbnails.py). It is made by the
    image path, never PDFium; a type that is neither is still a 404."""
    monkeypatch.setattr("app.main.get_pdf_thumbnail", lambda *a, **k: pytest.fail("tried to render a photo with the PDF renderer"))
    photo = tmp_path / "photo.jpg"
    Image.new("RGB", (40, 40), (10, 200, 10)).save(photo)
    doc = _insert(team, photo, hashlib.sha256(photo.read_bytes() + b"x").hexdigest(), media_type="image/jpeg")
    assert _get(team, "owner", doc).status_code == 200
    text = tmp_path / "note.txt"
    text.write_text("words")
    other = _insert(team, text, hashlib.sha256(text.read_bytes() + b"y").hexdigest(), media_type="text/plain")
    assert _get(team, "owner", other).status_code == 404


def test_a_missing_stored_file_and_an_unreadable_pdf_are_404s_and_cache_nothing(team, tmp_path, cache):
    pdf, sha = _unique_pdf(tmp_path)
    doc = _insert(team, pdf, sha)
    pdf.unlink()
    assert _get(team, "owner", doc).status_code == 404

    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4 garbage")
    broken_sha = hashlib.sha256(b"garbage").hexdigest()
    doc2 = _insert(team, broken, broken_sha)
    assert _get(team, "owner", doc2).status_code == 404
    assert list(cache.glob("*.jpg")) == []


def test_an_unknown_document_is_a_404(team):
    assert _get(team, "owner", 99999999).status_code == 404
