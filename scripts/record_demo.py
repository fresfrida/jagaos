"""Records the JagaOS demo as 8 separate clips (one browser context per beat), 1440x900, 1.5 s after every action, smooth scrolls.

    python record_demo.py --base http://localhost:5199 --out ./clips --beats 1,2,5,6,7
    python record_demo.py --base https://jagaos.13-251-52-222.nip.io --out ~/Desktop/jagaos-video-clips --beats 1,2

Beats that write data (3 upload, 4 confirm document 05, 8 purge request) only run when named in --beats. Nothing is ever deleted or restarted.
A fake cursor is drawn into the page, because Playwright's video does not show the real one.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1440, "height": 900}
PAUSE = 1500
CURSOR_JS = """
(() => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const d = document.createElement('div'); d.id = '__cur';
    d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:18px;height:18px;border-radius:50%;background:rgba(20,20,20,.35);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.5);transform:translate(-50%,-50%);left:-50px;top:-50px;transition:left .08s linear, top .08s linear';
    (document.body || document.documentElement).appendChild(d);
    addEventListener('mousemove', e => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { d.style.background = 'rgba(200,40,40,.6)'; }, true);
    addEventListener('mouseup', () => { d.style.background = 'rgba(20,20,20,.35)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
"""


class Rec:
    def __init__(self, pw, base, out):
        self.pw, self.base, self.out = pw, base.rstrip("/"), Path(out).expanduser()
        self.out.mkdir(parents=True, exist_ok=True)
        # channel='chromium' is the full Chromium in new-headless mode: it has the built-in PDF viewer the app's document viewer needs
        # (the default headless shell has none, and the viewer then shows 'This browser can't show a PDF').
        self.browser = pw.chromium.launch(channel="chromium")
        self.tmp = Path(tempfile.mkdtemp(prefix="jaga-rec-"))

    # ----- plumbing
    def state_for(self, who: str):
        """Sign in once, unrecorded, and keep the browser storage so a beat can start already signed in."""
        ctx = self.browser.new_context(viewport=VIEWPORT)
        p = ctx.new_page()
        self.pick(p, who)
        st = ctx.storage_state()
        ctx.close()
        return st

    def pick(self, p, who: str):
        p.goto(self.base)
        p.wait_for_timeout(1200)
        p.get_by_role("button", name=re.compile("Get Started|Pick a demo role")).first.click()
        p.wait_for_timeout(600)
        p.get_by_role("button", name=re.compile("^" + who)).first.click()
        p.wait_for_timeout(2500)

    def beat(self, n, state=None):
        vd = self.tmp / f"b{n}"
        ctx = self.browser.new_context(viewport=VIEWPORT, record_video_dir=str(vd), record_video_size=VIEWPORT, storage_state=state)
        ctx.add_init_script(CURSOR_JS)
        return ctx, ctx.new_page(), vd

    def finish(self, n, ctx, page, vd):
        page.wait_for_timeout(PAUSE)
        video = page.video
        ctx.close()
        dest = self.out / f"beat-{n}.webm"
        shutil.move(video.path(), dest)
        print(f"beat {n}: {dest}")

    def close(self):
        self.browser.close()

    # ----- gestures
    def pause(self, p, ms=PAUSE):
        p.wait_for_timeout(ms)

    def move_click(self, p, loc, hold=PAUSE):
        loc.scroll_into_view_if_needed()
        box = loc.bounding_box()
        p.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=25)
        p.wait_for_timeout(300)
        loc.click()
        p.wait_for_timeout(hold)

    def smooth_scroll(self, p, to_y, step=260, wait=700):
        cur = p.evaluate("window.scrollY")
        direction = 1 if to_y > cur else -1
        while (to_y - cur) * direction > 0:
            cur = cur + direction * step
            if (to_y - cur) * direction < 0:
                cur = to_y
            p.evaluate(f"window.scrollTo({{top:{cur},behavior:'smooth'}})")
            p.wait_for_timeout(wait)

    def scroll_to_el(self, p, loc, offset=120):
        loc.wait_for(state="attached", timeout=15000)
        y = p.evaluate("(el) => el.getBoundingClientRect().top + window.scrollY", loc.element_handle())
        self.smooth_scroll(p, max(0, y - offset))

    def type_slow(self, p, loc, text, delay=110):
        loc.click()
        p.wait_for_timeout(400)
        loc.press_sequentially(text, delay=delay)
        p.wait_for_timeout(PAUSE)

    def go(self, p, path):
        p.goto(self.base + path)
        p.wait_for_timeout(2500)

    def review_card(self, p, filename):
        """The review card that holds this document's filename field (the nearest ancestor with exactly one action button set)."""
        # the nearest ancestor of the filename field that also holds a review button (Accept as-is, or Reject for a quarantined file)
        return p.locator(f"xpath=(//input[@value='{filename}']/ancestor::*[.//button[contains(., 'Accept as-is') or contains(., 'Reject')]])[last()]").first

    def doc_card(self, p, text):
        """A Company Files card, found by a piece of its own text: the innermost ancestor of that text that holds the card's View/Delete buttons."""
        return p.locator(f"xpath=(//*[contains(text(), '{text}')]/ancestor::*[.//button[contains(., 'Delete') or contains(., 'DELETE')]])[last()]").first

    # ----- the eight beats
    def b1(self):
        ctx, p, vd = self.beat(1)
        p.goto(self.base)
        p.wait_for_selector("text=JagaOS remembers", timeout=15000)
        self.pause(p, 4000)  # the framing line and the hero, held
        height = p.evaluate("document.documentElement.scrollHeight")
        self.smooth_scroll(p, height - 900, step=70, wait=550)  # slow: about 70 px every half second
        self.pause(p, 3500)
        self.smooth_scroll(p, 0, step=140, wait=450)
        self.pause(p, 2500)
        self.finish(1, ctx, p, vd)

    def b2(self):
        ctx, p, vd = self.beat(2)
        p.goto(self.base)
        self.pause(p, 2000)
        self.move_click(p, p.get_by_role("button", name=re.compile("Pick a demo role")).first)
        for who in ("Jonathan", "Nur Aisyah", "Rachel"):
            box = p.get_by_role("button", name=re.compile("^" + who)).first.bounding_box()
            p.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=15)
            p.wait_for_timeout(500)
        self.move_click(p, p.get_by_role("button", name=re.compile("^Priya")).first, hold=3000)
        self.finish(2, ctx, p, vd)

    def switch_to(self, p, who):
        self.move_click(p, p.get_by_role("button", name=re.compile("Account menu", re.I)).first)
        self.move_click(p, p.get_by_text("Log Out", exact=True).first)
        p.wait_for_timeout(1500)
        self.move_click(p, p.get_by_role("button", name=re.compile("Get Started|Pick a demo role")).first)
        self.move_click(p, p.get_by_role("button", name=re.compile("^" + who)).first, hold=2500)

    def b3(self, receipt):
        ctx, p, vd = self.beat(3, self.state_for("Priya"))
        p.goto(self.base + "/")
        self.pause(p, 2000)
        self.switch_to(p, "Jonathan")
        self.move_click(p, p.get_by_role("link", name="Upload").first)
        self.pause(p)
        p.locator("[data-testid=document-input]").set_input_files(str(receipt))
        p.get_by_text(re.compile("Uploading")).first.wait_for(timeout=15000)
        p.wait_for_timeout(PAUSE)
        p.get_by_text(re.compile("Upload received|Confirm below|see below", re.I)).first.wait_for(timeout=60000)
        self.pause(p, 2500)
        card = self.review_card(p, receipt.name)
        self.scroll_to_el(p, card, offset=140)
        self.pause(p, 3500)  # the receipt image and the proposed description, bucket and type
        self.scroll_to_el(p, card.get_by_text(re.compile(r"^Extracted fields$", re.I)).first, offset=160)
        self.pause(p, 5000)  # the extracted fields: vendor, GST number, invoice number, date, tax, total
        self.finish(3, ctx, p, vd)

    def b3b(self, receipt):
        """Companion to beat 3 (no data change): the receipt's review card, scrolled to its extracted fields."""
        ctx, p, vd = self.beat("3b", self.state_for("Jonathan"))
        p.goto(self.base + "/upload")
        self.pause(p, 2500)
        card = self.review_card(p, receipt.name)
        self.scroll_to_el(p, card, offset=140)
        self.pause(p, 2500)
        self.scroll_to_el(p, card.get_by_text(re.compile(r"^Extracted fields$", re.I)).first, offset=160)
        self.pause(p, 6000)
        self.finish("3b", ctx, p, vd)

    def b4(self):
        ctx, p, vd = self.beat(4, self.state_for("Jonathan"))
        p.goto(self.base + "/upload")
        self.pause(p, 2500)
        card = self.review_card(p, "05_invoice_clean.pdf")
        self.scroll_to_el(p, card, offset=140)
        self.pause(p, 3000)
        accept = card.get_by_role("button", name="Accept as-is")
        assert accept.count() == 1, "expected exactly one Accept button on document 05's card"
        self.move_click(p, accept, hold=3000)
        self.go(p, "/company-files")
        row = self.doc_card(p, 'Straits Print Supplies Pte Ltd for company stationery')
        self.scroll_to_el(p, row, offset=180)
        self.pause(p, 4000)
        self.finish(4, ctx, p, vd)

    def b5(self):
        ctx, p, vd = self.beat(5, self.state_for("Jonathan"))
        p.goto(self.base + "/upload")
        self.pause(p, 2500)
        card = self.review_card(p, "07_invoice_injection_attempt.pdf")
        self.scroll_to_el(p, card, offset=140)
        self.pause(p, 5000)
        self.go(p, "/company-files")
        row = self.doc_card(p, 'QuickFix IT Services for laptop repair')
        self.scroll_to_el(p, row, offset=180)
        self.pause(p, 4500)
        self.finish(5, ctx, p, vd)

    def b6(self):
        ctx, p, vd = self.beat(6, self.state_for("Priya"))
        self.go(p, "/search")
        self.pause(p, 3000)  # the word cloud
        box = p.get_by_placeholder(re.compile("Search documents"))
        self.type_slow(p, box, "monthly maintenance")
        box.press("Enter")
        p.get_by_text(re.compile("monthly maintenance contract")).first.wait_for(timeout=15000)
        self.pause(p, 3000)
        view = p.get_by_role("button", name=re.compile("^View", re.I)).first
        self.move_click(p, view, hold=4500)
        self.finish(6, ctx, p, vd)

    def b7(self):
        ctx, p, vd = self.beat(7, self.state_for("Priya"))
        self.go(p, "/company-settings")
        head = p.get_by_role("heading", name=re.compile("Compliance checklist"))
        self.scroll_to_el(p, head, offset=140)
        self.pause(p, 5000)
        self.finish(7, ctx, p, vd)

    def b8b(self):
        """Second half of beat 8 only (NO writes): the Purge requested tab, the Purge requests card, the footer tagline."""
        ctx, p, vd = self.beat("8b", self.state_for("Priya"))
        self.go(p, "/company-files")
        self.move_click(p, p.get_by_role("button", name=re.compile(r"Purge requested \(\d+\)")).first, hold=4500)
        self.go(p, "/company-settings")
        head = p.get_by_text(re.compile(r"^Purge requests")).first
        self.scroll_to_el(p, head, offset=300)
        self.pause(p, 2000)
        self.move_click(p, head, hold=4500)
        self.smooth_scroll(p, p.evaluate("document.documentElement.scrollHeight"), step=300, wait=800)
        self.pause(p, 3500)
        self.finish("8b", ctx, p, vd)

    def b8(self):
        """OWNER variant: only the owner can request a purge (auth.may_request_purge); an admin's Delete archives and is not a purge."""
        ctx, p, vd = self.beat(8, self.state_for("Priya"))
        self.go(p, "/company-files")
        row = self.doc_card(p, 'BrightGrid Energy Retail Pte Ltd for electricity charges, SGD 673.96')
        self.scroll_to_el(p, row, offset=180)
        self.pause(p, 2500)
        self.move_click(p, row.get_by_role("button", name=re.compile("^Delete", re.I)).first)
        self.move_click(p, p.get_by_label(re.compile("permanently", re.I)).first, hold=1500)
        self.move_click(p, p.get_by_role("button", name="Purge").last, hold=3000)
        self.go(p, "/company-files")
        self.move_click(p, p.get_by_role("button", name=re.compile(r"Purge requested \(\d+\)")).first, hold=4000)
        self.go(p, "/company-settings")
        head = p.get_by_text(re.compile(r"^Purge requests")).first  # a collapsible card: scroll to it, then open it
        self.scroll_to_el(p, head, offset=300)
        self.pause(p, 2000)
        self.move_click(p, head, hold=4000)
        self.smooth_scroll(p, p.evaluate("document.documentElement.scrollHeight"), step=300, wait=800)
        self.pause(p, 3500)
        self.finish(8, ctx, p, vd)


def duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--beats", required=True, help="comma-separated, e.g. 1,2,5,6,7")
    ap.add_argument("--receipt", help="the receipt photo, for beat 3")
    a = ap.parse_args()
    beats = [int(x) if x.isdigit() else x for x in a.beats.split(",")]
    with sync_playwright() as pw:
        r = Rec(pw, a.base, a.out)
        try:
            for n in beats:
                if n in (3, "3b"):
                    if not a.receipt:
                        sys.exit("beat 3 needs --receipt")
                    (r.b3 if n == 3 else r.b3b)(Path(a.receipt))
                else:
                    getattr(r, f"b{n}")()
        finally:
            r.close()
    for n in beats:
        f = Path(a.out).expanduser() / f"beat-{n}.webm"
        print(f"  beat-{n}.webm  {duration(f):.1f}s  {f.stat().st_size // 1024} KB" if f.exists() else f"  beat-{n}.webm MISSING")


if __name__ == "__main__":
    main()
