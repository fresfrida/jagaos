#!/usr/bin/env python3
"""Re-render SEEDED (and two named demo) invoice PDFs as clean one-page documents, in one of five layouts, from each document's own stored text.

No LLM. For each selected document it reads the STORED extracted_text (the text the app already extracted and its extractions point into), parses
it, lays the SAME words out on a letterhead page with reportlab, and CHECKS the new PDF: its text must contain every word of the stored text (as a
multiset) and add nothing but the table headers. The line item must equal the document's stored caption ("... for <item>, SGD <total>", optionally
followed by a note) and the total must equal the caption's amount. A document that fails any check is SKIPPED and listed, never guessed. Nothing
is invented: no payment terms, bank line or extra line items, only the stored words in a different arrangement.

LAYOUT AND COLOUR: two independent dimensions, both fixed by the ISSUING COMPANY, not by the document: h = the first 8 bytes of sha256 of the issuer's
name as stored, as a number; layout = h % 5, palette = (h // 5) % 8. Every document from one company therefore renders in the same template and colours, in any run,
for ever (sha256, never Python's per-process hash()); different companies may share a layout. Layout: 0 slate band, 1 rule and tag with striped rows, 2 centred letterhead with a
ledger, 3 side strip with a grid table, 4 minimal with leader lines. Two stored layouts are understood: the seeded one (issuer, GST status, number,
date, bill to, numbered line items, subtotal, GST, total, fixture note) and the demo-corpus one (05 and 07: no bill to, a Description line, and
whatever else the document says after the total, kept verbatim, e.g. 07's injected lines). Palette: slate, forest green, deep maroon,
warm charcoal-brown, deep teal, plum, ochre, classic navy (muted letterhead colours). One accent per page, used sparingly: the issuer and labels, the
rules, a faint tint behind the table header row, the footer rule and the existing band, strip or total bar; no other large fills.

SCOPE (required, nothing is re-rendered by default): --top-per-bucket N takes the N newest documents of each company's bucket as Company Files lists
them (newest received first, archived and personal files left out) and keeps those that are eligible (seeded invoice or receipt, not quarantined);
--ids adds named documents (a demo file 05_ or 07_ is accepted only when named here); --all takes every eligible seeded document.

What it never touches: the `sha256`, `bytes` and every other column (it does not write to the database at all), documents outside the scope, ACRA
fixtures and every other non-invoice type. The stored file is replaced in place under its existing name.

Default is a DRY RUN: previews go to --preview-dir and a table is printed. --apply needs --backup-dir (each original file is copied there first),
replaces each stored file atomically and removes that document's cached thumbnail (`<sha256>.jpg`, which shows the old look; rebuilt on the next view).

    python3 beautify_invoices.py --db DB --manifest manifest.json --top-per-bucket 10 --ids 375,377,373 --preview-dir /tmp/beautify/previews
    python3 beautify_invoices.py --db DB --manifest manifest.json --top-per-bucket 10 --ids 375,377,373 --apply --backup-dir /home/ubuntu/backups/docs.pre-beautify-<stamp>
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from collections import Counter
from pathlib import Path

PALETTES = (
    ("slate", (0.23, 0.31, 0.42)),
    ("forest green", (0.16, 0.32, 0.23)),
    ("deep maroon", (0.42, 0.14, 0.18)),
    ("charcoal brown", (0.29, 0.23, 0.19)),
    ("deep teal", (0.09, 0.33, 0.35)),
    ("plum", (0.32, 0.17, 0.34)),
    ("ochre", (0.55, 0.38, 0.09)),
    ("classic navy", (0.08, 0.16, 0.36)),
)
SLATE = PALETTES[0][1]  # the ACCENT colour of the page being drawn (the name is historical); render_pdf sets it, and its tints, per document
ALLOWED_EXTRA_WORDS = {"ITEM", "DESCRIPTION", "AMOUNT"}  # table headers the layout adds; nothing else may appear
ITEM_RE = re.compile(r"^(\d+) (.+) (SGD [\d,]+\.\d{2})$")
KV_RE = re.compile(r"^([A-Za-z][A-Za-z ]*?): (.+)$")
MONEY_RE = re.compile(r"^SGD [\d,]+\.\d{2}$")


DEMO_KV_RE = re.compile(r"^([A-Za-z][A-Za-z ]*?): (.+)$")
DEMO_GST_RE = re.compile(r"^GST( \(\d+%\))?: SGD [\d,]+\.\d{2}$")


def _money_lines(tail, gst_re):
    if len(tail) < 3:
        return None, "expected subtotal, GST and total lines"
    sub, gst, tot = tail[:3]
    if not (sub.startswith("Subtotal: ") and MONEY_RE.match(sub[len("Subtotal: "):])):
        return None, "bad subtotal line"
    if not gst_re.match(gst):
        return None, "bad GST line"
    if not (tot.startswith("Total: ") and MONEY_RE.match(tot[len("Total: "):])):
        return None, "bad total line"
    return (sub, gst, tot), None


def parse_text(text: str):
    """The stored text -> (parts, None), or (None, reason). Two layouts: the seeded one (fmt A) and the demo-corpus one (fmt B)."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if len(lines) < 8:
        return None, "stored text too short to parse"
    if lines[1].startswith("SYNTHETIC SEED FIXTURE"):
        return _parse_seeded(lines)
    return _parse_demo(lines)


def _parse_seeded(lines):
    p = {"fmt": "A", "title": lines[0], "note": lines[1], "issuer": lines[2], "gst_status": lines[3], "meta": [], "items": [], "extra": []}
    i = 4
    while i < len(lines) and not ITEM_RE.match(lines[i]):
        m = KV_RE.match(lines[i])
        if not m:
            return None, f"unparsed header line: {lines[i][:40]!r}"
        p["meta"].append((m.group(1), m.group(2)))
        i += 1
    while i < len(lines) and ITEM_RE.match(lines[i]):
        p["items"].append(ITEM_RE.match(lines[i]).groups())
        i += 1
    if not p["items"]:
        return None, "no line item"
    tail = lines[i:]
    if len(tail) != 3:
        return None, f"expected subtotal, GST and total lines, got {len(tail)}"
    got, why = _money_lines(tail, re.compile(r"^GST( \d+%)?: (SGD [\d,]+\.\d{2}|nil( \(.+\))?)$"))
    if why:
        return None, why
    p["subtotal"], p["gst"], p["total"] = got
    if not any(k.lower().endswith("no") for k, _ in p["meta"]) or not any(k == "Bill to" for k, _ in p["meta"]):
        return None, "missing number or Bill to"
    return p, None


def _parse_demo(lines):
    """The demo corpus (05 to 08): title, issuer, key: value lines, a Description line, subtotal, GST, total, then anything else the document says."""
    p = {"fmt": "B", "title": lines[0], "note": None, "issuer": lines[1], "gst_status": None, "meta": [], "items": [], "extra": []}
    i = 2
    while i < len(lines) and not lines[i].startswith("Description: "):
        m = DEMO_KV_RE.match(lines[i])
        if not m:
            return None, f"unparsed header line: {lines[i][:40]!r}"
        p["meta"].append((m.group(1), m.group(2)))
        i += 1
    if i >= len(lines):
        return None, "no Description line"
    p["items"] = [("Description:", lines[i][len("Description: "):], None)]
    got, why = _money_lines(lines[i + 1:], DEMO_GST_RE)
    if why:
        return None, why
    p["subtotal"], p["gst"], p["total"] = got
    p["extra"] = lines[i + 4:]
    if not any(k.lower().endswith("no") for k, _ in p["meta"]):
        return None, "missing number"
    return p, None


def caption_of(raw) -> str:
    try:
        obj = json.loads(raw)
        return obj.get("en") or next(iter(obj.values()), "") if isinstance(obj, dict) else str(raw)
    except (TypeError, ValueError):
        return raw or ""


def caption_matches(p, caption: str):
    """The line item and the total must match the stored caption ('... for <item>, SGD <total>', optionally followed by a note)."""
    m = re.search(r"\bfor (.+?), (SGD [\d,]+\.\d{2})(?:\s.*)?$", caption or "", re.I | re.S)
    if not m:
        return "caption has no 'for <item>, SGD <total>' tail"
    if len(p["items"]) != 1:
        return "more than one line item; the caption names one"
    if m.group(1).strip().lower() != p["items"][0][1].strip().lower():
        return f"line item {p['items'][0][1]!r} != caption item {m.group(1)!r}"
    if m.group(2) != p["total"][len("Total: "):]:
        return f"total {p['total'][7:]} != caption amount {m.group(2)}"
    return None


# ---------------------------------------------------------------------------------------------------------------------------------------------
# layouts. Every one draws the same stored strings; only the arrangement, rules, fills and type sizes differ.
# ---------------------------------------------------------------------------------------------------------------------------------------------
GREY = (0.4, 0.4, 0.4)
LIGHT = (0.94, 0.95, 0.97)  # a light tint of the accent, set with it
PALE = (0.82, 0.84, 0.87)   # a paler tint, for the large title of the minimal layout
RULE = (0.8, 0.8, 0.8)      # the accent softened, for rules, borders and leader lines
HEAD = (0.9, 0.9, 0.92)     # a faint accent tint behind the table header row


def _extra_box(c, p, x, y, width, mm):
    """Anything the document says after the total (07's injected lines), verbatim, in a quiet box. Returns the y below it."""
    if not p["extra"]:
        return y
    hgt = (len(p["extra"]) * 5.5 + 5) * mm
    c.setFillColorRGB(0.97, 0.97, 0.97)
    c.setStrokeColorRGB(*RULE)
    c.rect(x, y - hgt, width, hgt, stroke=1, fill=1)
    c.setFillColorRGB(0.15, 0.15, 0.15)
    c.setFont("Helvetica", 10)
    ty = y - 6 * mm
    for ln in p["extra"]:
        c.drawString(x + 4 * mm, ty, ln)
        ty -= 5.5 * mm
    return y - hgt - 4 * mm


def _footer(c, p, w, mm):
    if p["note"]:
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(*GREY)
        c.drawCentredString(w / 2, 15 * mm, p["note"])


def _rows(c, p, y, L, R, mm, *, head=True, zebra=False, grid=False, leader=False):
    """The line items. Seeded: number, description, amount under an ITEM/DESCRIPTION/AMOUNT head. Demo: one 'Description:' row, no amount."""
    seeded = p["fmt"] == "A"
    if seeded and head:
        c.setFillColorRGB(*HEAD)
        c.rect(L, y - 3 * mm, R - L, 8 * mm, stroke=0, fill=1)  # a faint tint behind the header row
        c.setFillColorRGB(*SLATE)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(L + (2 * mm if grid else 0), y, "ITEM")
        c.drawString(L + 14 * mm, y, "DESCRIPTION")
        c.drawRightString(R - (2 * mm if grid else 0), y, "AMOUNT")
        y -= 3 * mm
        c.setStrokeColorRGB(*RULE)
        c.line(L, y, R, y)
        y -= 6.5 * mm
    for no, desc, amount in p["items"]:
        if zebra:
            c.setFillColorRGB(*LIGHT)
            c.rect(L, y - 2.5 * mm, R - L, 8 * mm, stroke=0, fill=1)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold" if not seeded else "Helvetica", 10)
        c.drawString(L + (2 * mm if grid else 0), y, no)
        c.setFont("Helvetica", 10)
        dx = L + (14 * mm if seeded else 31 * mm)
        c.drawString(dx, y, desc)
        if amount:
            if leader:
                c.setDash(1, 2)
                c.setStrokeColorRGB(*RULE)
                c.line(dx + c.stringWidth(desc, "Helvetica", 10) + 2 * mm, y + 0.8 * mm, R - c.stringWidth(amount, "Helvetica", 10) - 2 * mm, y + 0.8 * mm)
                c.setDash()
            c.drawRightString(R - (2 * mm if grid else 0), y, amount)
        y -= 8 * mm
    return y


def _meta(c, p, y, L, R, mm, *, value_x=27, right=False, label_rgb=None):
    for label, value in p["meta"]:
        c.setFillColorRGB(*(label_rgb or SLATE))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(L, y, f"{label}:")
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica", 10)
        if right:
            c.drawRightString(R, y, value)
        else:
            c.drawString(L + value_x * mm, y, value)
        y -= 6.5 * mm
    return y


def _totals(c, p, y, R, mm, *, fill=True, slate=False, rule=False):
    c.setFont("Helvetica", 10)
    c.setFillColorRGB(0, 0, 0)
    c.drawRightString(R, y, p["subtotal"])
    c.drawRightString(R, y - 6.5 * mm, p["gst"])
    ty = y - 17 * mm
    if slate:
        c.setFillColorRGB(*SLATE)
        c.rect(R - 72 * mm, ty - 3 * mm, 72 * mm, 9 * mm, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1)
    elif fill:
        c.setFillColorRGB(*LIGHT)
        c.rect(R - 70 * mm, ty - 3 * mm, 70 * mm, 8.5 * mm, stroke=0, fill=1)
        c.setFillColorRGB(0, 0, 0)
    if not slate:
        c.setFillColorRGB(*SLATE)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(R - 2 * mm, ty, p["total"])
    if rule:
        c.setStrokeColorRGB(*SLATE)
        c.setLineWidth(0.8)
        c.line(R - 72 * mm, ty - 4 * mm, R, ty - 4 * mm)
        c.line(R - 72 * mm, ty - 5.2 * mm, R, ty - 5.2 * mm)
        c.setLineWidth(1)
    return ty - 12 * mm


def _v0(c, p, w, h, mm):  # slate band
    L, R = 20 * mm, w - 20 * mm
    c.setFillColorRGB(*SLATE)
    c.rect(0, h - 34 * mm, w, 34 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(L, h - 19 * mm, p["issuer"])
    if p["gst_status"]:
        c.setFont("Helvetica", 9)
        c.drawString(L, h - 26 * mm, p["gst_status"])
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(R, h - 19 * mm, p["title"])
    y = _meta(c, p, h - 50 * mm, L, R, mm)
    y = _rows(c, p, y - 8 * mm, L, R, mm)
    c.setStrokeColorRGB(*RULE)
    c.line(L, y + 3.5 * mm, R, y + 3.5 * mm)
    y = _totals(c, p, y - 6 * mm, R, mm)
    _extra_box(c, p, L, y, R - L, mm)


def _v1(c, p, w, h, mm):  # white head, slate rule and title tag, striped rows
    L, R = 20 * mm, w - 20 * mm
    c.setFillColorRGB(*SLATE)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(L, h - 24 * mm, p["issuer"])
    if p["gst_status"]:
        c.setFillColorRGB(*GREY)
        c.setFont("Helvetica", 9)
        c.drawString(L, h - 30 * mm, p["gst_status"])
    c.setFont("Helvetica-Bold", 11)
    tw = c.stringWidth(p["title"], "Helvetica-Bold", 11) + 10 * mm
    c.setFillColorRGB(*SLATE)
    c.roundRect(R - tw, h - 27 * mm, tw, 9 * mm, 2 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(R - tw / 2, h - 24.4 * mm, p["title"])
    c.setStrokeColorRGB(*SLATE)
    c.setLineWidth(1.6)
    c.line(L, h - 35 * mm, R, h - 35 * mm)
    c.setLineWidth(1)
    y = _meta(c, p, h - 50 * mm, L, R, mm, value_x=30, label_rgb=SLATE)
    y = _rows(c, p, y - 8 * mm, L, R, mm, zebra=True)
    y = _totals(c, p, y - 2 * mm, R, mm, fill=False, rule=True)
    _extra_box(c, p, L, y, R - L, mm)


def _v2(c, p, w, h, mm):  # centred letterhead, ledger
    L, R = 20 * mm, w - 20 * mm
    c.setStrokeColorRGB(*SLATE)
    c.line(L, h - 16 * mm, R, h - 16 * mm)
    c.setFillColorRGB(*SLATE)
    c.setFont("Helvetica-Bold", 19)
    c.drawCentredString(w / 2, h - 27 * mm, p["issuer"])
    if p["gst_status"]:
        c.setFillColorRGB(*GREY)
        c.setFont("Helvetica", 9)
        c.drawCentredString(w / 2, h - 33 * mm, p["gst_status"])
    c.setFillColorRGB(*SLATE)
    c.setFont("Helvetica-Bold", 11)
    tw = c.stringWidth(p["title"], "Helvetica-Bold", 11) + 2 * len(p["title"])  # letter-spaced title, centred
    t = c.beginText(w / 2 - tw / 2, h - 42 * mm)
    t.setFont("Helvetica-Bold", 11)
    t.setCharSpace(2)
    t.textOut(p["title"])
    t.setCharSpace(0)  # the spacing is a graphics-state setting: reset it or every later string is spaced out
    c.drawText(t)
    c.line(L, h - 47 * mm, R, h - 47 * mm)
    y = _meta(c, p, h - 60 * mm, L, R, mm, right=True)
    y = _rows(c, p, y - 6 * mm, L, R, mm)
    c.setStrokeColorRGB(*SLATE)
    c.line(L, y + 3.5 * mm, R, y + 3.5 * mm)
    y = _totals(c, p, y - 6 * mm, R, mm, fill=False, rule=True)
    _extra_box(c, p, L, y, R - L, mm)


def _v3(c, p, w, h, mm):  # side strip, boxed meta, grid table, slate total
    L, R = 30 * mm, w - 18 * mm
    c.setFillColorRGB(*SLATE)
    c.rect(0, 0, 10 * mm, h, stroke=0, fill=1)
    c.setFillColorRGB(*SLATE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(L, h - 24 * mm, p["issuer"])
    if p["gst_status"]:
        c.setFillColorRGB(*GREY)
        c.setFont("Helvetica", 9)
        c.drawString(L, h - 30 * mm, p["gst_status"])
    c.setFont("Helvetica-Bold", 11)
    tw = c.stringWidth(p["title"], "Helvetica-Bold", 11) + 8 * mm
    c.setStrokeColorRGB(*SLATE)
    c.setLineWidth(1.2)
    c.rect(R - tw, h - 27 * mm, tw, 9 * mm, stroke=1, fill=0)
    c.setLineWidth(1)
    c.setFillColorRGB(*SLATE)
    c.drawCentredString(R - tw / 2, h - 24.4 * mm, p["title"])
    bh = (len(p["meta"]) * 6.5 + 4) * mm
    c.setStrokeColorRGB(*RULE)
    c.rect(L, h - 42 * mm - bh, R - L, bh, stroke=1, fill=0)
    y = _meta(c, p, h - 42 * mm - 6.5 * mm, L + 4 * mm, R, mm, value_x=25)
    top = h - 42 * mm - bh - 10 * mm
    y = _rows(c, p, top, L, R, mm, grid=True)
    c.setStrokeColorRGB(*RULE)
    c.rect(L, y + 5.5 * mm, R - L, top - y + 3 * mm - 3.5 * mm + 4.5 * mm, stroke=1, fill=0)
    y = _totals(c, p, y - 2 * mm, R, mm, slate=True)
    _extra_box(c, p, L, y, R - L, mm)


def _v4(c, p, w, h, mm):  # minimal, big pale title, leader lines
    L, R = 20 * mm, w - 20 * mm
    c.setFillColorRGB(*PALE)
    c.setFont("Helvetica-Bold", 26)
    c.drawRightString(R, h - 26 * mm, p["title"])
    c.setFillColorRGB(*SLATE)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(L, h - 20 * mm, p["issuer"])
    if p["gst_status"]:
        c.setFillColorRGB(*GREY)
        c.setFont("Helvetica", 9)
        c.drawString(L, h - 26 * mm, p["gst_status"])
    y = _meta(c, p, h - 48 * mm, L, R, mm, value_x=24, label_rgb=_tint(SLATE, 0.75))
    y = _rows(c, p, y - 6 * mm, L, R, mm, head=False, leader=True)
    y = _totals(c, p, y - 6 * mm, R, mm, fill=False)
    _extra_box(c, p, L, y, R - L, mm)


VARIANTS = (_v0, _v1, _v2, _v3, _v4)
VARIANT_LEFT_MM = (20, 20, 20, 30, 20)  # each layout's left margin, so the footer rule lines up with its content
VARIANT_NAMES = ("slate band", "rule and tag, striped", "centred ledger", "side strip, grid", "minimal, leaders")


def _issuer_key(issuer: str) -> int:
    """A number that depends only on the issuer's name as stored (sha256, so it is the same in every process, on every machine, in every run)."""
    return int.from_bytes(hashlib.sha256(issuer.strip().encode("utf-8")).digest()[:8], "big")


def variant_of(issuer: str) -> int:
    return _issuer_key(issuer) % len(VARIANTS)


def palette_of(issuer: str) -> int:
    return (_issuer_key(issuer) // len(VARIANTS)) % len(PALETTES)


def _tint(rgb, keep: float):
    """The accent mixed toward white: `keep` is how much of the accent stays."""
    return tuple(1 - (1 - v) * keep for v in rgb)


def render_pdf(dest: str, p: dict) -> None:
    global SLATE, LIGHT, PALE, RULE, HEAD
    SLATE = PALETTES[palette_of(p["issuer"])][1]
    LIGHT, RULE, HEAD = _tint(SLATE, 0.09), _tint(SLATE, 0.45), _tint(SLATE, 0.13)
    PALE = tuple((t + 0.83) / 2 for t in _tint(SLATE, 0.28))  # a greyed tint: the big title must read as ink on paper, never pastel
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    w, h = A4
    c = canvas.Canvas(dest, pagesize=A4)
    v = variant_of(p["issuer"])
    VARIANTS[v](c, p, w, h, mm)
    left = VARIANT_LEFT_MM[v] * mm
    c.setStrokeColorRGB(*RULE)
    c.setLineWidth(0.6)
    c.line(left, 21 * mm, w - 20 * mm, 21 * mm)  # the footer rule
    c.setLineWidth(1)
    _footer(c, p, w, mm)
    c.showPage()
    c.save()


def words_of(text: str) -> Counter:
    return Counter((text or "").split())


def verify_render(path: str, stored_text: str):
    """The new PDF's words must include every stored word (as a multiset) and add only table headers."""
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) != 1:
            return f"rendered {len(pdf.pages)} pages"
        new = words_of(pdf.pages[0].extract_text())
    old = words_of(stored_text)
    missing, extra = old - new, new - old
    if missing:
        return f"words missing from the new PDF: {dict(missing)}"
    if any(w not in ALLOWED_EXTRA_WORDS for w in extra):
        return f"words added to the new PDF: {dict(extra)}"
    return None


def resolve(stored_path: str, db_root: Path) -> Path:
    """Where a stored file really is: an absolute path as stored, or (uploaded files keep a path relative to the app's directory) under the
    directory above the database's data folder, or by name in data/docs."""
    p = Path(stored_path)
    candidates = [p] if p.is_absolute() else [db_root.parent / p, p]
    candidates.append(db_root / "docs" / p.name)
    for cand in candidates:
        try:
            if cand.exists():
                return cand
        except PermissionError:
            continue
    return candidates[0]


DEMO_PREFIXES = ("05_", "07_")  # the two demo files the video opens; accepted only when named with --ids


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/jaga.db")
    ap.add_argument("--manifest", default=str(Path(__file__).resolve().parent.parent / "evals" / "seed_files" / "manifest.json"))
    ap.add_argument("--preview-dir", default=str(Path(__file__).resolve().parent / "beautify_preview"))
    ap.add_argument("--top-per-bucket", type=int, help="scope: the N newest documents of each company's bucket, as Company Files lists them")
    ap.add_argument("--ids", help="scope: comma-separated document ids to add (a demo file 05_ or 07_ is accepted only here)")
    ap.add_argument("--all", action="store_true", help="scope: every eligible seeded document")
    ap.add_argument("--apply", action="store_true", help="replace the stored files (default: dry run)")
    ap.add_argument("--backup-dir", help="required with --apply: each original file is copied here first")
    args = ap.parse_args()
    if not (args.top_per_bucket or args.ids or args.all):
        sys.exit("give a scope: --top-per-bucket N, --ids A,B or --all (nothing is re-rendered by default)")
    if args.apply and not args.backup_dir:
        sys.exit("--apply needs --backup-dir")
    if not os.path.exists(args.db):
        sys.exit(f"db not found: {args.db}")
    seeded = {d["sha256"] for d in json.load(open(args.manifest))["documents"]}
    db_root = Path(args.db).resolve().parent
    thumbs = Path(os.environ.get("JAGA_THUMBS_PATH", db_root / "thumbnails"))

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)  # this script never writes to the database
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT d.id, d.company_id, co.name AS company, d.sha256, d.filename, d.stored_path, d.status, d.doc_type, d.bucket, d.visibility, d.received_at, "
        "d.description, d.extracted_text FROM document d JOIN company co ON co.id = d.company_id ORDER BY d.id"
    ).fetchall()
    con.close()
    by_id = {r["id"]: r for r in rows}

    def eligible(r) -> bool:
        return r["sha256"] in seeded and (r["doc_type"] or "").lower() in ("invoice", "receipt") and "quarant" not in (r["status"] or "").lower()

    chosen: dict[int, str] = {}
    if args.all:
        for r in rows:
            if eligible(r):
                chosen[r["id"]] = "all"
    if args.top_per_bucket:
        seen: dict[tuple, int] = {}
        listing = sorted((r for r in rows if r["visibility"] == "company" and r["status"] != "archived"), key=lambda r: (r["received_at"], r["id"]), reverse=True)
        for r in listing:
            key = (r["company_id"], r["bucket"])
            seen[key] = seen.get(key, 0) + 1
            if seen[key] <= args.top_per_bucket and eligible(r):
                chosen[r["id"]] = f"top {args.top_per_bucket}"
    for tok in [t for t in (args.ids or "").split(",") if t.strip()]:
        r = by_id.get(int(tok))
        if r is None:
            sys.exit(f"--ids: no document {tok}")
        demo = r["filename"].startswith(DEMO_PREFIXES) and r["sha256"] not in seeded
        if not (eligible(r) or demo):
            sys.exit(f"--ids: document {r['id']} ({r['filename']}) is not eligible: only a seeded invoice or receipt, or a demo file starting {DEMO_PREFIXES}")
        chosen[r["id"]] = "named"

    plans, skipped = [], []
    for doc_id in sorted(chosen):
        r = by_id[doc_id]
        p, why = parse_text(r["extracted_text"])
        why = why or (caption_matches(p, caption_of(r["description"])) if p else None)
        if why:
            skipped.append((doc_id, why))
        else:
            plans.append((r, p))

    preview_dir = Path(args.preview_dir)
    if not args.apply:
        preview_dir.mkdir(parents=True, exist_ok=True)
    print(f"documents: {len(rows)}; in scope: {len(chosen)}; will re-render: {len(plans)}; skipped by a check: {len(skipped)}")
    for doc_id, why in skipped:
        print(f"    skipped #{doc_id}: {why}")

    done = failed = 0
    for r, p in plans:
        target = resolve(r["stored_path"], db_root)
        v = variant_of(p["issuer"])
        label = f"[{r['id']:>3}] v{v} {PALETTES[palette_of(p['issuer'])][0]:<14} {r['company'][:8]:<8} {r['bucket']:<11} {r['status']:<12} {p['issuer'][:28]:<28} {dict(p['meta']).get('Invoice No', '-'):<14} {p['total'][7:]}"
        if not target.exists():
            print(f"  ! {label}: stored file not found at {target}")
            failed += 1
            continue
        fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=(str(target.parent) if args.apply else str(preview_dir)))
        os.close(fd)
        try:
            render_pdf(tmp, p)
            bad = verify_render(tmp, r["extracted_text"])
            if bad:
                print(f"  ! {label}: {bad} (left alone)")
                failed += 1
                continue
            if args.apply:
                backup = Path(args.backup_dir)
                backup.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup / target.name)
                os.replace(tmp, target)
                (thumbs / f"{r['sha256'].lower()}.jpg").unlink(missing_ok=True)
            else:
                os.replace(tmp, preview_dir / f"preview_{r['id']}.pdf")
            print("  " + label)
            done += 1
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    print(f"{'replaced' if args.apply else 'previewed'}: {done}; failed the text check: {failed}")
    if not args.apply:
        print(f"DRY RUN: nothing was changed; previews in {preview_dir}")


if __name__ == "__main__":
    main()
