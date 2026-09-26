"""Server-side image preprocessing (round 6, DECISIONS #129): the working copy Tesseract reads is upright, at most 1500px on its
longest edge, never enlarged, a JPEG at about quality 80, and deleted afterwards; the uploaded file itself is never changed."""

import hashlib
import io
import os
from pathlib import Path

import pytest
from PIL import Image

from app.extract import image_prep
from app.extract.image_prep import JPEG_QUALITY, MAX_EDGE, normalize_image, prepare_working_copy, working_copy


def _jpeg_file(tmp_path: Path, size: tuple[int, int], name: str = "src.jpg", orientation: int | None = None) -> Path:
    image = Image.new("RGB", size, (200, 180, 160))
    for x in range(0, size[0], 40):  # some structure, so JPEG size is not trivially tiny
        for y in range(0, min(size[1], 60)):
            image.putpixel((x, y), (10, 10, 10))
    path = tmp_path / name
    if orientation is None:
        image.save(path, format="JPEG", quality=95)
    else:
        exif = Image.Exif()
        exif[0x0112] = orientation
        image.save(path, format="JPEG", quality=95, exif=exif)
    return path


def test_the_limits_are_the_briefs_numbers():
    assert MAX_EDGE == 1500 and JPEG_QUALITY == 80


def test_a_large_landscape_photo_is_cut_to_1500_on_its_longest_edge_keeping_its_proportions(tmp_path):
    src = _jpeg_file(tmp_path, (4000, 3000))
    out = tmp_path / "out.jpg"
    report = prepare_working_copy(str(src), str(out))
    with Image.open(out) as result:
        assert result.size == (1500, 1125)
        assert result.format == "JPEG"
    assert (report.width_before, report.height_before) == (4000, 3000) and (report.width_after, report.height_after) == (1500, 1125)
    assert report.resized and report.bytes_after < report.bytes_before


def test_a_small_image_is_never_enlarged(tmp_path):
    for size in [(800, 600), (1500, 900), (300, 1500)]:
        src = _jpeg_file(tmp_path, size, name=f"s{size[0]}.jpg")
        out = tmp_path / f"o{size[0]}.jpg"
        report = prepare_working_copy(str(src), str(out))
        with Image.open(out) as result:
            assert result.size == size, size
        assert not report.resized


def test_the_derivative_is_encoded_at_about_quality_80_not_the_clients_85(tmp_path):
    src = _jpeg_file(tmp_path, (2000, 1500))
    out = tmp_path / "out.jpg"
    prepare_working_copy(str(src), str(out))
    with Image.open(out) as result:
        # The first luminance quantization coefficient is a direct fingerprint of the quality setting:
        # 6 at quality 80 (standard table 16, scaled by 0.4), 5 at 85.
        assert result.quantization[0][0] == 6


def test_exif_orientation_is_applied_before_the_resize(tmp_path):
    # 3000x2000 pixels stored with orientation 6 (rotate 90): the upright picture is 2000x3000, so its LONGEST edge is the height.
    src = _jpeg_file(tmp_path, (3000, 2000), orientation=6)
    out = tmp_path / "out.jpg"
    report = prepare_working_copy(str(src), str(out))
    with Image.open(out) as result:
        assert result.size == (1000, 1500)  # upright, then cut to 1500 on the height: not 1500x1000
    assert (report.width_before, report.height_before) == (2000, 3000)


def test_a_transparent_png_is_flattened_onto_white_not_black(tmp_path):
    src = tmp_path / "t.png"
    Image.new("RGBA", (200, 100), (0, 0, 0, 0)).save(src)
    out = tmp_path / "out.jpg"
    prepare_working_copy(str(src), str(out))
    with Image.open(out) as result:
        assert result.getpixel((50, 50))[0] > 240


def test_normalize_image_of_a_palette_or_gray_image_comes_back_rgb(tmp_path):
    assert normalize_image(Image.new("L", (100, 100), 128)).mode == "RGB"
    assert normalize_image(Image.new("P", (100, 100))).mode == "RGB"


def test_the_working_copy_is_a_temp_file_that_is_removed_afterwards_and_the_upload_is_untouched(tmp_path):
    src = _jpeg_file(tmp_path, (4000, 3000))
    before = hashlib.sha256(src.read_bytes()).hexdigest()
    with working_copy(str(src)) as copy:
        assert copy != str(src) and os.path.exists(copy)
        assert Path(copy).name.startswith("jaga-ocr-")
        seen = copy
    assert not os.path.exists(seen)
    assert hashlib.sha256(src.read_bytes()).hexdigest() == before


def test_the_working_copy_is_removed_even_when_the_block_raises(tmp_path):
    src = _jpeg_file(tmp_path, (2000, 1500))
    seen = []
    with pytest.raises(RuntimeError):
        with working_copy(str(src)) as copy:
            seen.append(copy)
            raise RuntimeError("OCR blew up")
    assert not os.path.exists(seen[0])


def test_an_unreadable_file_raises_and_leaves_no_temp_file_behind(tmp_path, monkeypatch):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"not an image")
    created: list[str] = []
    real_mkstemp = image_prep.tempfile.mkstemp

    def spy(*a, **k):
        handle, path = real_mkstemp(*a, **k)
        created.append(path)
        return handle, path

    monkeypatch.setattr(image_prep.tempfile, "mkstemp", spy)
    with pytest.raises(Exception):
        with working_copy(str(bad)):
            pass
    assert created and not any(os.path.exists(p) for p in created)


def test_the_image_prep_log_line_holds_numbers_only(tmp_path, caplog):
    import logging
    src = _jpeg_file(tmp_path, (3000, 2000))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        with working_copy(str(src)):
            pass
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("IMAGE_PREP")]
    assert "size_before=3000x2000" in line and "size_after=1500x1000" in line and "resized=True" in line
    assert str(tmp_path) not in line  # not even a path
