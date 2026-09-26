"""Record the landing page's demo video from the LIVE app (2026-09-25, DECISIONS #113).

    python scripts/record_hero_video.py --web http://localhost:5174

Writes three files into web/src/assets/, which web/src/sections/HeroVideo.tsx plays in the phone frame:
    landing-demo.mp4          H.264, the one every current browser plays
    landing-demo.webm         VP9, the fallback for a browser built without H.264
    landing-demo-poster.webp  the first frame: shown before the video loads, and instead of it under reduced motion

WHAT IT RECORDS. Local Chromium at a phone size (375x812, device scale 2), signed in as the demo owner against the real backend,
on the Calendar: it scrolls down and back, then switches the language <select> through Chinese, Malay and Tamil while the page
updates, and ends on the English frame it began on, so the loop restarts without a jump. It drives the real page; nothing is
drawn or mocked. Re-run it whenever the Calendar or the header changes visibly, so the hero never shows an old app.

WHY EACH FRAME IS A SCREENSHOT. Playwright's recorder and Chromium's screencast both stop at 1x here (a 375x812 picture, soft on a
retina screen), so each video frame is a screenshot of the running page at 2x and ffmpeg stitches them. About 110 frames, a minute.

WHAT IT NEEDS. A backend (`uvicorn app.main:app`) and a web server, BOTH LOCAL, with the demo accounts seeded (scripts/seed_dev_db.py):
    CORS_ALLOWED_ORIGINS=http://localhost:5174 uvicorn app.main:app --port 8000
    cd web && VITE_API_BASE_URL=http://127.0.0.1:8000 npx vite --port 5174 --strictPort
The variable is needed: web/.env.local points a plain `npm run dev` at PRODUCTION (docs/HANDOFF.md, Commands). The script refuses a
non-local API, and stops if the page is not signed in or talks to any host but the API it was given. Also needs `playwright` (with
Chromium) for Python, Pillow, and `ffmpeg` on PATH; these are developer tools and are not in requirements.txt. The backend's calendar
is what gets filmed: use a database whose documents you are happy to show as counts on the month grid (day numbers and dots only).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "web" / "src" / "assets"
DEMO_OWNER = "owner_priya@try-demo.test"  # config/demo.ts: the public demo account
LOCAL_HOSTS = {"localhost", "127.0.0.1"}

FPS = 30
VIEWPORT = {"width": 375, "height": 812}  # the app on a phone: the layout the recording is of
SCALE = 2
OUT_SIZE = (600, 1300)  # what the file is: the phone frame reserves this aspect ratio (sections/HeroVideo.tsx, HERO_VIDEO_SIZE)
SCROLL_PX = 110  # the whole month grid and the "tap a day" hint; the site footer stays below the bottom bar

# The timeline, in VIDEO seconds. (name, seconds) for holds; scrolls are (target px, seconds).
LANGUAGES = [("zh", 1.9), ("ms", 1.9), ("ta", 2.0), ("en", 1.5)]  # English last: the loop ends on the frame it began on


def _ease(t: float) -> float:
    return 2 * t * t if t < 0.5 else 1 - pow(-2 * t + 2, 2) / 2


def _require_local(url: str, what: str) -> None:
    host = urlparse(url).hostname
    if host not in LOCAL_HOSTS:
        sys.exit(f"Refusing to run: {what} is {url!r}, not a local address. This script signs in as the demo owner; "
                 "point it at a LOCAL backend only (see the docstring).")


def _capture_frames(api: str, web: str, frames_dir: Path) -> list[tuple[Path, float]]:
    from playwright.sync_api import sync_playwright

    frames: list[tuple[Path, float]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=SCALE, is_mobile=True, has_touch=True)
        login = ctx.request.post(f"{api}/api/auth/dev-login", data={"email": DEMO_OWNER})
        if not login.ok:
            sys.exit(f"dev-login as {DEMO_OWNER} failed ({login.status}): is the database seeded (scripts/seed_dev_db.py)?")
        ctx.add_init_script(
            f"localStorage.setItem('jaga-language','en');localStorage.setItem('jagaos_session_token','{login.json()['token']}');"
        )
        page = ctx.new_page()
        api_hosts: set[str] = set()
        page.on("request", lambda r: api_hosts.add(urlparse(r.url).netloc) if "/api/" in r.url else None)
        page.goto(f"{web}/calendar")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)

        expected_api = urlparse(api).netloc
        if api_hosts - {expected_api}:
            sys.exit(f"The page called {sorted(api_hosts - {expected_api})}, not {expected_api}: the web server is configured for another API "
                     "(web/.env.local?). Start it with VITE_API_BASE_URL set, as in the docstring.")
        if not page.locator("header select").count() or urlparse(page.url).path != "/calendar":
            sys.exit(f"The page is not the signed-in Calendar (at {page.url}): the session was not accepted.")
        select = page.locator("header select").first

        def snap() -> Path:
            path = frames_dir / f"f{len(frames):04d}.png"
            page.screenshot(path=str(path))
            return path

        def hold(seconds: float) -> None:
            frames.append((snap(), seconds))

        def scroll(to: float, seconds: float) -> None:
            start = page.evaluate("window.scrollY")
            n = round(seconds * FPS)
            for i in range(1, n + 1):
                page.evaluate(f"window.scrollTo({{top: {start + (to - start) * _ease(i / n)}, behavior: 'instant'}})")
                frames.append((snap(), 1 / FPS))

        def language(code: str, seconds: float) -> None:
            select.select_option(code)
            page.wait_for_timeout(450)  # the re-render: the title, the month and weekday names in the new language
            hold(seconds)

        hold(1.4)
        scroll(SCROLL_PX, 2.0)
        hold(0.8)
        scroll(0, 1.4)
        hold(0.6)
        for code, seconds in LANGUAGES:
            language(code, seconds)
        ctx.close()
        browser.close()
    return frames


def _encode(frames: list[tuple[Path, float]], frames_dir: Path) -> float:
    # ffmpeg's concat list: each frame with how long it stays on screen (the demuxer needs the last file repeated).
    lines: list[str] = []
    for path, seconds in frames:
        lines += [f"file '{path}'", f"duration {seconds:.5f}"]
    lines.append(f"file '{frames[-1][0]}'")
    listing = frames_dir / "list.txt"
    listing.write_text("\n".join(lines) + "\n")
    total = sum(seconds for _, seconds in frames)
    scale = f"scale={OUT_SIZE[0]}:{OUT_SIZE[1]}:flags=lanczos,fps={FPS},format=yuv420p"
    base = ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-vf", scale, "-t", f"{total:.3f}", "-an"]
    subprocess.run(base + ["-c:v", "libx264", "-preset", "slow", "-crf", "26", "-profile:v", "high", "-level", "4.0",
                           "-movflags", "+faststart", str(ASSETS / "landing-demo.mp4")], check=True)
    subprocess.run(base + ["-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", str(ASSETS / "landing-demo.webm")], check=True)
    return total


def _poster(first_frame: Path) -> None:
    from PIL import Image

    Image.open(first_frame).convert("RGB").resize(OUT_SIZE, Image.LANCZOS).save(
        ASSETS / "landing-demo-poster.webp", "WEBP", quality=82, method=6)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Record the landing page's demo video from the live app (local backend and web server only).")
    parser.add_argument("--web", default="http://localhost:5174", help="the local web server, started with VITE_API_BASE_URL pointing at --api")
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="the local backend")
    args = parser.parse_args(argv)
    _require_local(args.api, "--api")
    _require_local(args.web, "--web")
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is not on PATH.")

    ASSETS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="jaga-hero-") as tmp:
        frames_dir = Path(tmp)
        frames = _capture_frames(args.api.rstrip("/"), args.web.rstrip("/"), frames_dir)
        total = _encode(frames, frames_dir)
        _poster(frames[0][0])
    for name in ("landing-demo.mp4", "landing-demo.webm", "landing-demo-poster.webp"):
        print(f"{name:<26} {(ASSETS / name).stat().st_size / 1024:7.0f} KB")
    print(f"{len(frames)} frames, {total:.1f}s. Look at the result before committing it: open the landing page, or extract frames with ffmpeg.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
