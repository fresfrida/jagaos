"""Synthetic sample inputs for round 12's two document features (2026-09-24,
DECISIONS #78 and #79). Fictional company, fictional UEN and address — nothing
here describes a real entity (WINNING.md's privacy note; same stance as
evals/demo_corpus/generate.py). Run: python evals/samples/generate.py

  acra_business_profile.pdf      — every field a profile can carry
  acra_business_profile_sparse.pdf — no financial year end and no GST line, to
                                    exercise "a real profile can omit a value"
  business_profile_no_authority.pdf — a business profile that never names an
                                    authority (the round 15 hallucination case)
  multipage_invoice_p1..p3.jpg   — three phone-style photos of ONE invoice: the
                                    line items run over pages 1-2 and the
                                    subtotal / tax / total appear only on page 3,
                                    so a read that stops early gets no total.
"""

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "files"

PROFILE_LINES = [
    "ACCOUNTING AND CORPORATE REGULATORY AUTHORITY",
    "BUSINESS PROFILE",
    "Information as at 24 September 2026",
    "",
    "COMPANY DETAILS",
    "Company Name: HARBOURLIGHT TRADING PTE. LTD.",
    "UEN: 202412345K",
    "Company Type: Private Company Limited by Shares",
    "Status: Live Company",
    "Incorporation Date: 18 March 2024",
    "Registered Address: 18 ROBINSON ROAD #12-01 SINGAPORE 048547",
    "Principal Activity: Wholesale of general merchandise",
    "Financial Year End: 30 June",
    "GST Registration: Registered",
    "",
    "OFFICERS",
    "Director: TAN WEI MING (S1234567D)",
    "Secretary: LIM SIEW HUI",
]

# Same document with the lines a real profile may not carry removed.
SPARSE_PROFILE_LINES = [
    line for line in PROFILE_LINES if not line.startswith(("Financial Year End", "GST Registration"))
]


def write_pdf(name: str, lines: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT / name), pagesize=A4)
    _, height = A4
    y = height - 3 * cm
    c.setFont("Helvetica", 11)
    for line in lines:
        c.drawString(2 * cm, y, line)
        y -= 0.6 * cm
    c.save()
    print(f"wrote {OUT / name}")


# The exact shape of a real failure (round 15, DECISIONS #89): a company's
# business profile whose printed text is headed "BUSINESS PROFILE SUMMARY" and
# names no issuing authority anywhere. A model asked to describe it wrote
# "ACRA Business Profile for ...", supplying an authority from what such
# documents usually look like. Fictional company, fictional UEN.
PROFILE_NO_AUTHORITY_LINES = [
    "BUSINESS PROFILE SUMMARY",
    "",
    "Entity Name: SUNBIRD CATERING SERVICES PTE. LTD.",
    "Unique Entity Number: 202398765M",
    "Entity Type: Private Company Limited by Shares",
    "Status: Live",
    "Date of Incorporation: 4 September 2023",
    "Registered Office: 55 TIONG BAHRU ROAD #03-11 SINGAPORE 160055",
    "Principal Activity: Catering services",
    "",
    "Officers",
    "Director: LEE MEI LING",
    "Director: RAJAN KUMAR",
]

INVOICE_PAGES = [
    [
        "HARBOURLIGHT SUPPLY CO PTE LTD",
        "Tax Invoice INV-77120",
        "Date: 12 September 2026",
        "Bill to: Try Demo Pte Ltd",
        "",
        "Item                         Qty    Amount (SGD)",
        "A4 paper, 80gsm, carton       40         520.00",
        "Toner cartridge, black        12         948.00",
        "Stapler, heavy duty            6         132.00",
        "Whiteboard markers, box       30         210.00",
        "",
        "(continued on next page)",
    ],
    [
        "Tax Invoice INV-77120 - page 2",
        "",
        "Item                         Qty    Amount (SGD)",
        "Ergonomic chair                5        1250.00",
        "Filing cabinet, 4 drawer       3         690.00",
        "Desk lamp                     10         250.00",
        "",
        "(continued on next page)",
    ],
    [
        "Tax Invoice INV-77120 - page 3",
        "",
        "Subtotal:                    SGD 4000.00",
        "GST (9%):                    SGD  360.00",
        "TOTAL DUE:                   SGD 4360.00",
        "",
        "Payment terms: 30 days from invoice date.",
        "Thank you for your business.",
    ],
]


def write_photo(name: str, lines: list[str], seed: int) -> None:
    """A page as a phone might capture it: off-white paper, mild blur, JPEG."""
    rng = random.Random(seed)
    image = Image.new("RGB", (1500, 2000), (243, 241, 236))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=44)
    for i, line in enumerate(lines):
        draw.text((110, 150 + i * 92), line, fill=(28, 28, 30), font=font)
    for _ in range(4000):  # a little paper grain
        x, y = rng.randrange(1500), rng.randrange(2000)
        draw.point((x, y), fill=(225 + rng.randrange(15),) * 3)
    image = image.filter(ImageFilter.GaussianBlur(0.8))
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / name, quality=85)
    print(f"wrote {OUT / name}")


if __name__ == "__main__":
    write_pdf("acra_business_profile.pdf", PROFILE_LINES)
    write_pdf("acra_business_profile_sparse.pdf", SPARSE_PROFILE_LINES)
    write_pdf("business_profile_no_authority.pdf", PROFILE_NO_AUTHORITY_LINES)
    for number, page in enumerate(INVOICE_PAGES, start=1):
        write_photo(f"multipage_invoice_p{number}.jpg", page, seed=number)
