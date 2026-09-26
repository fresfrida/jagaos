"""Generates the synthetic FIXTURE files and manifest that scripts/seed_demo_fixtures.py applies (round 7, item S1, DECISIONS #133).

Run on the DEV machine (needs reportlab and Pillow); the files it writes under evals/seed_files/ are COMMITTED, so applying them
needs no PDF writer (the Lightsail venv has none). Deterministic: a fixed RNG seed, reportlab's `invariant=1` (fixed dates and ids
inside the PDF) and fixed JPEG bytes, so a re-run rewrites byte-identical files and the sha256 of each is stable.

    python scripts/generate_seed_files.py            # rewrites evals/seed_files/ (files + manifest.json)

EVERYTHING here is fictional: company names, people, vendors, invoice numbers, amounts. Every PDF carries the line
"SYNTHETIC SEED FIXTURE - NOT A REAL DOCUMENT". No UEN, no NRIC, no real brand. Singapore GST rates are the real ones by date
(7% to 31 Dec 2022, 8% in 2023, 9% from 1 Jan 2024); a few vendors are deliberately not GST-registered and charge none.

Public-holiday dates (Chinese New Year day 1, Hari Raya Puasa, Deepavali): written from MEMORY of the MOM published lists, NOT re-checked
against mom.gov.sg while writing this. Chinese New Year dates are the ones the brief gave. Any year marked (?) below is the one to
verify first. See HOLIDAYS.

Nothing is dated after TODAY: a document that would fall in the future (the 2026 year-end and Deepavali windows, filings still to come
in Q4 2026) is not generated, and the counts printed at the end say so.
"""

import io
import json
import random
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "evals" / "seed_files"
TODAY = date(2026, 9, 27)
FIXTURE_LINE = "SYNTHETIC SEED FIXTURE - NOT A REAL DOCUMENT"
SG_OFFSET_HOURS = 8  # Asia/Singapore is UTC+8 with no daylight saving

# ---------------------------------------------------------------- the invented names (the user may veto these)

GROUP_NAME = "Tembusu Holdings"
COMPANIES = [
    {"key": "c0", "name": "Tembusu Row Engineering Pte Ltd", "fye": [12, 31], "incorporated_on": "2016-03-14",
     "gst_registered": True, "gst_since": "2017-01-01", "gst_cycle": "quarters end Mar, Jun, Sep, Dec",
     "gst_quarter_end_months": [3, 6, 9, 12]},
    {"key": "c1", "name": "Pasir Kelana Logistics Pte Ltd", "fye": [6, 30], "incorporated_on": "2018-08-20",
     "gst_registered": True, "gst_since": "2022-01-01", "gst_cycle": "quarters end Jan, Apr, Jul, Oct",
     "gst_quarter_end_months": [1, 4, 7, 10]},
    {"key": "c2", "name": "Cendana Wharf Trading Pte Ltd", "fye": [3, 31], "incorporated_on": "2020-01-06",
     "gst_registered": False, "gst_since": None, "gst_cycle": None, "gst_quarter_end_months": []},
]

# key -> (email, display name, app role, business title). The six picker emails are hard-coded in web/src/config/demo.ts and all
# belong to the FIRST company. The picker owner owns all three companies. Business titles are recorded in docs/DEMO-PEOPLE.md only.
PEOPLE = {
    "c0": [
        ("owner", "owner@try-demo.test", "Priya Ramanathan", "owner", "Managing Director"),
        ("admin", "admin@try-demo.test", "Jonathan Ong", "admin", "HR & Finance Manager"),
        ("user", "user@try-demo.test", "Rachel Tan Hui Min", "user", "Company Secretary (Corp Sec)"),
        ("user1", "user1@try-demo.test", "Nur Aisyah Rahman", "user", "Operations Executive"),
        ("user2", "user2@try-demo.test", "Kavitha Subramaniam", "user", "Sales & Admin Coordinator"),
        ("viewer", "viewer@try-demo.test", "Marcus Lee Kok Wai", "viewer", "External Auditor"),
    ],
    "c1": [
        ("owner", "owner@try-demo.test", "Priya Ramanathan", "owner", "Group Managing Director"),
        ("admin", "hafiz.ismail@pasirkelana.test", "Hafiz Ismail", "admin", "HR & Finance Manager"),
        ("user", "grace.lim@pasirkelana.test", "Grace Lim Siew Ling", "user", "Company Secretary (Corp Sec)"),
        ("user1", "ravi.chandran@pasirkelana.test", "Ravi Chandran", "user", "Dispatch Coordinator"),
    ],
    "c2": [
        ("owner", "owner@try-demo.test", "Priya Ramanathan", "owner", "Group Managing Director"),
        ("admin", "beehong.ng@cendanawharf.test", "Ng Bee Hong", "admin", "Finance & HR Manager"),
        ("user", "farah.yusof@cendanawharf.test", "Farah Yusof", "user", "Company Secretary (Corp Sec)"),
        ("user1", "daniel.chia@cendanawharf.test", "Daniel Chia", "user", "Purchasing Executive"),
    ],
}

# ---------------------------------------------------------------- public holidays (SEE THE NOTE IN THE DOCSTRING)

HOLIDAYS = {
    "cny": {2017: "2017-01-28", 2018: "2018-02-16", 2019: "2019-02-05", 2020: "2020-01-25", 2021: "2021-02-12",
            2022: "2022-02-01", 2023: "2023-01-22", 2024: "2024-02-10", 2025: "2025-01-29", 2026: "2026-02-17"},
    # Hari Raya Puasa (Aidilfitri). (?) = written from memory, verify first: 2020, 2026.
    "raya": {2017: "2017-06-25", 2018: "2018-06-15", 2019: "2019-06-05", 2020: "2020-05-24", 2021: "2021-05-13",
             2022: "2022-05-03", 2023: "2023-04-22", 2024: "2024-04-10", 2025: "2025-03-31", 2026: "2026-03-21"},
    # Deepavali. (?) = written from memory, verify first: 2020, 2026 (2026 is in the future, no document is generated for it).
    "deepavali": {2017: "2017-10-18", 2018: "2018-11-06", 2019: "2019-10-27", 2020: "2020-11-14", 2021: "2021-11-04",
                  2022: "2022-10-24", 2023: "2023-11-12", 2024: "2024-10-31", 2025: "2025-10-20", 2026: "2026-11-08"},
}

# ---------------------------------------------------------------- vendors (all invented; gst=False means not GST-registered)

V = {
    "caterer": ("Golden Ladle Catering Pte Ltd", True), "hampers": ("Ah Huat Hampers & Gifts", True),
    "venue": ("Marina Ridge Banquet Hall", True), "fruit": ("Lucky Orchard Fruit Trading", True),
    "bakkwa": ("Kwong Seng Bak Kwa Trading", False), "lion": ("Dragon Peak Lion Dance Troupe", False),
    "decor": ("Red Lantern Decor Supplies", True), "print": ("Ang Mo Print & Pack", False),
    "clean": ("Clean Sweep Facilities Pte Ltd", True), "xmas": ("Sunbeam Catering Services", True),
    "nyd": ("Harbour Pearl Restaurant", True), "raya_h": ("Pandan Leaf Hampers", True),
    "raya_c": ("Warung Sedap Catering", False), "dv_h": ("Marigold Gifts & Florist", True),
    "dv_c": ("Diya Sweets & Savouries", True),
    "office": ("Harbourview Serviced Offices Pte Ltd", True), "broadband": ("SwiftLink Broadband Pte Ltd", True),
    "energy": ("BrightGrid Energy Retail Pte Ltd", True), "stationery": ("PrimeLink Stationery Supplies", True),
    "electrical": ("Bright Circuit Electrical Works", True), "insurance": ("Anchor Insurance Brokers Pte Ltd", True),
    "it": ("Trident IT Services Pte Ltd", True), "courier": ("Greenline Couriers Pte Ltd", True),
    "travel": ("Merlion Wing Travel Agency", True), "audit": ("Chen & Rahim LLP (Public Accountants)", True),
    "pantry": ("Sunday Market Pantry Supplies", False), "forklift": ("Kestrel Equipment Rentals Pte Ltd", True),
    "signage": ("Neon Junction Signage", True), "training": ("Upskill Junction Training Pte Ltd", True),
}
CUSTOMERS = ["Northgate Precision Pte Ltd", "Lakeside Fabricators Pte Ltd", "Orchid Bay Interiors Pte Ltd", "Redhill Marine Services Pte Ltd",
             "Jurong Ridge Components Pte Ltd", "Siglap Green Grocers Pte Ltd", "Kallang Basin Print Pte Ltd", "Tampines Loop Automation Pte Ltd"]

CNY_ITEMS = [  # (vendor key, item, base amount SGD in 2017)
    ("caterer", "Lo hei / yusheng catering set (20 pax)", 380), ("venue", "CNY reunion dinner venue deposit", 1500),
    ("fruit", "Mandarin orange bulk order (10 cartons)", 260), ("hampers", "CNY hampers (25 sets)", 1250),
    ("bakkwa", "Bak kwa bulk order (15 kg)", 640), ("lion", "Lion dance performance booking", 520),
    ("decor", "Festive decorations", 310), ("print", "Ang bao packet printing (2,000 pcs)", 180),
    ("clean", "Office spring cleaning", 450),
]
YEAREND_ITEMS = [("xmas", "Christmas party catering (40 pax)", 1450), ("nyd", "New Year dinner, set menu (30 pax)", 1900)]
RAYA_ITEMS = [("raya_h", "Hari Raya hampers (20 sets)", 900), ("raya_c", "Hari Raya open-house catering (30 pax)", 750)]
DV_ITEMS = [("dv_h", "Deepavali gift hampers (20 sets)", 880), ("dv_c", "Deepavali sweets and savouries (bulk)", 620)]


def gst_rate(d: date) -> float:
    """Singapore GST: 7% to 31 Dec 2022, 8% in 2023, 9% from 1 Jan 2024."""
    return 0.07 if d < date(2023, 1, 1) else 0.08 if d < date(2024, 1, 1) else 0.09


def money(x: float) -> str:
    return f"{x:,.2f}"


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", text.title())[:24]


def seasonal_days() -> set[date]:
    """Every day inside one of the first company's seasonal windows (CNY, Hari Raya, Deepavali: five weeks up to the day; each GST
    quarter's filing month; the AGM and annual-return season; the auditor letter and year-end). The scattered ordinary documents
    steer clear of these days where they can, so a range search in a season shows the season, not a random invoice as well."""
    days: set[date] = set()

    def span(lo: date, hi: date) -> None:
        d = lo
        while d <= hi:
            days.add(d)
            d += timedelta(days=1)

    for k in HOLIDAYS.values():
        for s_ in k.values():
            h = date.fromisoformat(s_)
            span(h - timedelta(days=35), h)
    for y in range(2016, 2027):
        for m in (3, 6, 9, 12):
            end = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
            span(end + timedelta(days=1), end + timedelta(days=34))
        fye = date(y, 12, 31)
        span(fye + timedelta(days=120), fye + timedelta(days=225))
        span(fye - timedelta(days=60), fye)
    return days


class Gen:
    def __init__(self):
        self.rng = random.Random(20260927)
        self.docs: list[dict] = []
        self.seq: dict[tuple, int] = {}
        self.dedupe: set[str] = set()
        self.busy = seasonal_days()

    def free_date(self, year: int, max_month: int = 12) -> date:
        """A random day of `year` outside the seasonal windows when one can be found in a dozen tries, else the last try."""
        for _ in range(12):
            d = date(year, self.rng.randint(1, max_month), self.rng.randint(1, 27))
            if d not in self.busy:
                return d
        return d

    # ---- primitives
    def biz_time(self) -> str:
        return f"{self.rng.randint(9, 17):02d}:{self.rng.choice([0, 7, 14, 21, 28, 35, 42, 49, 56]):02d}"

    def invno(self, vendor_key: str, d: date) -> str:
        k = (vendor_key, d.year)
        self.seq[k] = self.seq.get(k, 0) + 1
        prefix = "".join(w[0] for w in re.split(r"\W+", V.get(vendor_key, (vendor_key,))[0]) if w)[:3].upper() or "INV"
        return f"{prefix}-{d.year}-{self.seq[k] + self.rng.randint(10, 60):04d}"

    def amount(self, base: float, year: int) -> float:
        return round(base * (1.03 ** (year - 2017)) * self.rng.uniform(0.85, 1.22), 2)

    def add(self, *, company: str, cluster: str, uploader: str, occurred: date, delta_days: int = 0, pages: list[list[str]], filename: str,
            media: str = "pdf", **meta) -> dict | None:
        """Register one document. Returns None (and adds nothing) when it would be dated in the future or before incorporation."""
        received = occurred + timedelta(days=delta_days)
        comp = next(c for c in COMPANIES if c["key"] == company)
        if received > TODAY or occurred < date.fromisoformat(comp["incorporated_on"]):
            return None
        rel = f"{company}/{occurred.isoformat()}_{filename}"
        if rel in self.dedupe:
            rel = f"{company}/{occurred.isoformat()}_{self.rng.randint(100, 999)}_{filename}"
        self.dedupe.add(rel)
        doc = {"file": rel, "company": company, "cluster": cluster, "uploader": uploader, "media": media,
               "occurred_on": occurred.isoformat(), "received_local": f"{received.isoformat()} {self.biz_time()}",
               "display_name": Path(rel).name.split("_", 1)[1], "pages": pages, **meta}
        self.docs.append(doc)
        return doc

    # ---- document kinds
    def invoice(self, company: str, cluster: str, uploader: str, vendor_key: str, item: str, base: float, occurred: date, *,
                delta: int | None = None, kind: str = "invoice", bucket: str = "Expenses") -> dict | None:
        vendor, registered = V[vendor_key]
        comp = next(c for c in COMPANIES if c["key"] == company)
        sub = self.amount(base, occurred.year)
        rate = gst_rate(occurred) if registered else 0.0
        tax = round(sub * rate + 1e-9, 2)
        total = round(sub + tax, 2)
        no = self.invno(vendor_key, occurred)
        title = "TAX INVOICE" if registered and kind == "invoice" else ("RECEIPT" if kind == "receipt" else "INVOICE")
        gst_line = f"GST Reg No: M9-{sum(map(ord, vendor)) * 7919 % 10**7:07d}-X" if registered else "Not GST-registered"
        lines = [title, FIXTURE_LINE, "", vendor, gst_line,
                 "", f"Invoice No: {no}", f"Date: {occurred.strftime('%d %b %Y')}", f"Bill to: {comp['name']}", "",
                 f"1  {item}    SGD {money(sub)}", "", f"Subtotal: SGD {money(sub)}",
                 f"GST {int(round(rate * 100))}%: SGD {money(tax)}" if registered else "GST: nil (vendor not GST-registered)",
                 f"Total: SGD {money(total)}"]
        return self.add(
            company=company, cluster=cluster, uploader=uploader, occurred=occurred, delta_days=self.rng.randint(0, 3) if delta is None else delta,
            pages=[lines], filename=f"{slug(vendor)}_{no}.pdf", lane="invoice", doc_type="receipt" if kind == "receipt" else "invoice",
            bucket=bucket, vendor=vendor,
            description=f"{'Receipt' if kind == 'receipt' else 'Invoice'} from {vendor} for {item.lower()}, SGD {money(total)}",
            invoice={"no": no, "subtotal": sub, "tax": tax, "total": total, "rate": rate, "gst_registered": registered, "currency": "SGD",
                     "item": item, "date_text": occurred.strftime("%d %b %Y")},
        )

    def receivable(self, company: str, uploader: str, occurred: date, base: float) -> dict | None:
        comp = next(c for c in COMPANIES if c["key"] == company)
        customer = self.rng.choice(CUSTOMERS)
        sub = self.amount(base, occurred.year)
        registered = bool(comp["gst_registered"] and occurred >= date.fromisoformat(comp["gst_since"] or "2999-01-01"))
        rate = gst_rate(occurred) if registered else 0.0
        tax = round(sub * rate + 1e-9, 2)
        total = round(sub + tax, 2)
        no = f"{company.upper()}-{occurred.year}-{self.rng.randint(100, 899):04d}"
        item = self.rng.choice(["Fabrication and installation works", "Monthly maintenance contract", "Consulting hours (engineering)",
                                "Materials and delivery", "Site survey and report"])
        lines = ["TAX INVOICE" if registered else "INVOICE", FIXTURE_LINE, "", comp["name"],
                 "GST registered" if registered else "Not GST-registered", "", f"Invoice No: {no}", f"Date: {occurred.strftime('%d %b %Y')}",
                 f"Bill to: {customer}", "", f"1  {item}    SGD {money(sub)}", "", f"Subtotal: SGD {money(sub)}",
                 f"GST {int(round(rate * 100))}%: SGD {money(tax)}" if registered else "GST: nil", f"Total: SGD {money(total)}"]
        return self.add(
            company=company, cluster="base", uploader=uploader, occurred=occurred, delta_days=self.rng.randint(0, 2), pages=[lines],
            filename=f"Invoice_{no}.pdf", lane="invoice", doc_type="invoice", bucket="Receivables", vendor=comp["name"],
            description=f"Invoice to {customer} for {item.lower()}, SGD {money(total)}",
            invoice={"no": no, "subtotal": sub, "tax": tax, "total": total, "rate": rate, "gst_registered": registered, "currency": "SGD",
                     "item": item, "date_text": occurred.strftime("%d %b %Y")},
        )

    def simple(self, company: str, cluster: str, uploader: str, occurred: date, *, title: str, vendor: str, lane: str, doc_type: str,
               bucket: str, description: str, body: list[str], extra_pages: list[list[str]] | None = None, delta: int | None = None,
               filename: str | None = None, **meta) -> dict | None:
        comp = next(c for c in COMPANIES if c["key"] == company)
        page1 = [title, FIXTURE_LINE, "", vendor, f"Date: {occurred.strftime('%d %b %Y')}", f"Company: {comp['name']}", ""] + body
        return self.add(company=company, cluster=cluster, uploader=uploader, occurred=occurred,
                        delta_days=self.rng.randint(0, 3) if delta is None else delta, pages=[page1] + (extra_pages or []),
                        filename=filename or f"{slug(title)}.pdf", lane=lane, doc_type=doc_type, bucket=bucket, vendor=vendor,
                        description=description, **meta)

    def photo(self, company: str, uploader: str, occurred: date, caption: str, seed: int) -> dict | None:
        return self.add(company=company, cluster="base", uploader=uploader, occurred=occurred, delta_days=1, pages=[], media="jpg",
                        filename=f"{slug(caption)}.jpg", lane="memory", doc_type="photo", bucket="Memory Lane", vendor=None,
                        description=None, photo_seed=seed, caption=caption)


# Company events the checklist is built from (the seeder writes them, then runs the REAL expectation rule and reconcile). The mix
# of satisfied and missing rows per company comes from which documents exist: see docs/DEMO-PEOPLE.md and DECISIONS #133.
EVENTS = [
    {"company": "c0", "kind": "incorporation", "occurred_on": "2016-03-14", "title": "Incorporation of Tembusu Row Engineering Pte Ltd", "source_doc_type": "Certificate of Incorporation"},
    {"company": "c0", "kind": "corpsec_change", "occurred_on": "2023-06-01", "title": "Company secretary handover", "source_doc_type": None},
    {"company": "c1", "kind": "incorporation", "occurred_on": "2018-08-20", "title": "Incorporation of Pasir Kelana Logistics Pte Ltd", "source_doc_type": "Certificate of Incorporation"},
    {"company": "c2", "kind": "incorporation", "occurred_on": "2020-01-06", "title": "Incorporation of Cendana Wharf Trading Pte Ltd", "source_doc_type": "Certificate of Incorporation"},
    {"company": "c2", "kind": "corpsec_change", "occurred_on": "2024-09-02", "title": "Change of company secretary", "source_doc_type": None},
]

# ---------------------------------------------------------------- content

def build(g: Gen) -> None:
    c0, c1, c2 = COMPANIES
    inc = {c["key"]: date.fromisoformat(c["incorporated_on"]) for c in COMPANIES}

    # ---------- base statutory documents (the checklist's evidence)
    g.simple("c0", "base", "user", date(2016, 3, 14), title="CERTIFICATE OF INCORPORATION", vendor="Registrar of Companies (fixture)", lane="statutory",
             doc_type="Certificate of Incorporation", bucket="Statutory", delta=300,
             description="Certificate of incorporation of Tembusu Row Engineering Pte Ltd", body=["This is to certify that the company named above is incorporated."],
             filename="Certificate_of_Incorporation.pdf")
    g.simple("c0", "base", "user", date(2016, 3, 14), title="COMPANY CONSTITUTION", vendor="Tembusu Row Engineering Pte Ltd", lane="statutory",
             doc_type="Company Constitution", bucket="Statutory", delta=301, description="Constitution of Tembusu Row Engineering Pte Ltd",
             body=["1. Name of the company.", "2. Registered office.", "3. Objects and powers.", "4. Shares and members."], filename="Company_Constitution.pdf")
    g.simple("c1", "base", "user", date(2018, 8, 20), title="CERTIFICATE OF INCORPORATION", vendor="Registrar of Companies (fixture)", lane="statutory",
             doc_type="Certificate of Incorporation", bucket="Statutory", delta=20, description="Certificate of incorporation of Pasir Kelana Logistics Pte Ltd",
             body=["This is to certify that the company named above is incorporated."], filename="Certificate_of_Incorporation.pdf")
    g.simple("c1", "base", "user", date(2018, 8, 20), title="REGISTER OF MEMBERS", vendor="Pasir Kelana Logistics Pte Ltd", lane="statutory",
             doc_type="Share Register", bucket="Statutory", delta=21, description="Register of members (share register) of Pasir Kelana Logistics Pte Ltd",
             body=["Member 1: Priya Ramanathan, 60,000 ordinary shares.", "Member 2: Hafiz Ismail, 40,000 ordinary shares."], filename="Register_of_Members.pdf")
    g.simple("c2", "base", "user", date(2020, 1, 6), title="CERTIFICATE OF INCORPORATION", vendor="Registrar of Companies (fixture)", lane="statutory",
             doc_type="Certificate of Incorporation", bucket="Statutory", delta=9, description="Certificate of incorporation of Cendana Wharf Trading Pte Ltd",
             body=["This is to certify that the company named above is incorporated."], filename="Certificate_of_Incorporation.pdf")

    # ---------- F2: AGM / annual return season, each company's OWN financial year end
    def agm_season(key: str, first_fy_end_year: int, with_letter: bool):
        comp = next(c for c in COMPANIES if c["key"] == key)
        fm, fd = comp["fye"]
        for fy in range(first_fy_end_year, 2027):
            fye = date(fy, fm, fd)
            # AGM within 6 months after year end; annual return within 7 months (the repo's own rule, FYE + 7 months).
            agm_d = fye + timedelta(days=int(30.4 * 5) + g.rng.randint(-10, 12))
            ar_d = fye + timedelta(days=int(30.4 * 6) + g.rng.randint(8, 21))
            if with_letter:  # the auditor engagement letter sits around the year end it covers
                g.simple(key, "agm", "admin" if key != "c0" else "user", fye - timedelta(days=g.rng.randint(14, 40)), title="AUDITOR ENGAGEMENT LETTER",
                         vendor=V["audit"][0], lane="important", doc_type="Auditor Engagement Letter", bucket="Statutory",
                         description=f"Auditor engagement letter for the financial year ending {fye.strftime('%d %b %Y')}",
                         body=[f"We confirm our appointment as auditors for the year ending {fye.strftime('%d %B %Y')}.", "Scope: statutory audit of the financial statements."],
                         filename=f"Auditor_Engagement_FY{fy}.pdf")
            g.simple(key, "agm", "user", agm_d, title="MINUTES OF ANNUAL GENERAL MEETING", vendor=comp["name"], lane="statutory", doc_type="AGM Minutes",
                     bucket="Statutory", description=f"Minutes of the annual general meeting for the financial year ended {fye.strftime('%d %b %Y')}",
                     body=[f"Financial year ended {fye.strftime('%d %B %Y')}.", "1. Financial statements laid before the members.", "2. Auditors re-appointed.",
                           "3. Directors' fees approved."], filename=f"AGM_Minutes_FY{fy}.pdf")
            g.simple(key, "agm", "user", ar_d, title="ANNUAL RETURN FILING RECEIPT", vendor="ACRA (fixture)", lane="statutory", doc_type="Annual Return Filing Receipt",
                     bucket="Statutory", description=f"Annual return filing receipt for the financial year ended {fye.strftime('%d %b %Y')}",
                     body=[f"Annual return for the financial year ended {fye.strftime('%d %B %Y')} lodged.", f"Receipt no: AR-{fy}-{g.rng.randint(10000, 99999)}"],
                     filename=f"Annual_Return_FY{fy}.pdf")

    agm_season("c0", 2016, True)   # FY2016's AGM is in 2017; FY2026's is in 2027 (future, dropped by add())
    agm_season("c1", 2019, False)
    agm_season("c2", 2021, False)

    # ---------- F3: quarterly GST filings, one two-page PDF per quarter (return acknowledgement + payment receipt)
    def gst_quarters(key: str, uploader: str):
        comp = next(c for c in COMPANIES if c["key"] == key)
        start = date.fromisoformat(comp["gst_since"])
        for year in range(start.year, 2027):
            for m in comp["gst_quarter_end_months"]:
                end = date(year + (m == 12), m % 12 + 1, 1) - timedelta(days=1)  # the last day of month m
                if end < start + timedelta(days=60):
                    continue
                filed = end + timedelta(days=g.rng.randint(6, 27))
                out_tax = g.amount(9000, year)
                in_tax = round(out_tax * g.rng.uniform(0.35, 0.6), 2)
                net = round(out_tax - in_tax, 2)
                ref = f"GST-{end.strftime('%Y%m')}-{g.rng.randint(1000, 9999)}"
                ack = ["GST F5 RETURN ACKNOWLEDGEMENT", FIXTURE_LINE, "", comp["name"], f"Period end: {end.strftime('%d %b %Y')}",
                       f"Filed: {filed.strftime('%d %b %Y')}", f"Output tax: SGD {money(out_tax)}", f"Input tax: SGD {money(in_tax)}",
                       f"Net GST payable: SGD {money(net)}", f"Ref: {ref}"]
                rec = ["GST PAYMENT RECEIPT", FIXTURE_LINE, "", comp["name"], f"Payment date: {filed.strftime('%d %b %Y')}",
                       f"Amount paid: SGD {money(net)}", f"Payment reference: PAY-{ref}", "Method: GIRO"]
                g.add(company=key, cluster="gst", uploader=uploader, occurred=filed, delta_days=g.rng.randint(0, 1), pages=[ack, rec],
                      filename=f"GST_F5_{end.strftime('%Y_%m')}.pdf", lane="statutory", doc_type="GST F5 Return", bucket="Statutory",
                      vendor="IRAS (fixture)", description=f"GST F5 return acknowledgement and payment receipt for the quarter ended {end.strftime('%d %b %Y')}, net GST payable SGD {money(net)}",
                      gst_quarter_end=end.isoformat())

    gst_quarters("c0", "admin")
    gst_quarters("c1", "admin")

    # ---------- F1 CNY, F4 year-end, F5 Raya and Deepavali
    def festive(key: str, cluster: str, items: list, when: date, lo_days: int, hi_days: int, picks: list[int], upl: list[str], kind="invoice"):
        for n, i in enumerate(picks):
            vk, item, base = items[i]
            g.invoice(key, cluster, upl[n % len(upl)], vk, item, base, when - timedelta(days=g.rng.randint(lo_days, hi_days)), kind=kind)

    for year in range(2018, 2027):  # first company: EVERY year, no gaps; hampers and the caterer recur
        cny = date.fromisoformat(HOLIDAYS["cny"][year])
        rot = [(year * 2) % 9, (year * 2 + 3) % 9]
        rot = [r for r in rot if r not in (1, 3)] or [5]
        festive("c0", "cny", CNY_ITEMS, cny, 8, 27, [0, 3, *rot[:2]], ["user2", "admin", "user1"])
    for year in range(2019, 2027):
        cny = date.fromisoformat(HOLIDAYS["cny"][year])
        festive("c1", "cny", CNY_ITEMS, cny, 8, 27, [3], ["user1", "admin"])
    for year in range(2020, 2027):
        cny = date.fromisoformat(HOLIDAYS["cny"][year])
        festive("c2", "cny", CNY_ITEMS, cny, 8, 27, [(year * 5) % 9], ["user1"])

    for year in range(2017, 2027):
        # F4 year-end: late November to December (2026 is in the future and drops out)
        for key, upl, count in (("c0", ["user2", "admin"], 2), ("c1", ["user1"], 1), ("c2", ["user1"], 1)):
            if key != "c0" and year < inc[key].year + 1:
                continue
            for n, (vk, item, base) in enumerate(YEAREND_ITEMS[:count] if (key != "c0" or year % 2 == 0) else YEAREND_ITEMS[:1]):
                g.invoice(key, "yearend", upl[n % len(upl)], vk, item, base, date(year, 12, g.rng.randint(1, 18)) if n == 0 else date(year, 12, g.rng.randint(8, 24)))
        # staff bonus payout memo: aggregate figures only, no names
        for key, upl in (("c0", "admin"),):  # the smaller companies carry no bonus memos
            d = date(year, 12, g.rng.randint(12, 20))
            pool = round(g.amount(18000, year), 2)
            g.simple(key, "yearend", upl, d, title="STAFF BONUS PAYOUT MEMO", vendor=next(c for c in COMPANIES if c["key"] == key)["name"], lane="important",
                     doc_type="Staff Bonus Payout Memo", bucket="Operations", description=f"Year-end staff bonus payout memo, aggregate SGD {money(pool)}",
                     body=["Year-end bonus payout, aggregate figures only.", f"Total pool: SGD {money(pool)}", "Payment date: with December salary.", "Approved by: Managing Director."],
                     filename=f"Bonus_Memo_{year}.pdf")
        # F5 festivals (Hari Raya Puasa and Deepavali windows, 1 to 4 weeks before)
        raya = date.fromisoformat(HOLIDAYS["raya"][year])
        festive("c0", "festival", RAYA_ITEMS, raya, 8, 27, [0, 1], ["user2", "user1"])
        if year >= 2019:
            festive("c1", "festival", RAYA_ITEMS, raya, 8, 27, [0], ["user1"])
        if year >= 2021:
            festive("c2", "festival", RAYA_ITEMS, raya, 8, 27, [0], ["user1"])
        dv = date.fromisoformat(HOLIDAYS["deepavali"][year])
        festive("c0", "festival", DV_ITEMS, dv, 8, 27, [year % 2], ["user2", "user1"])

    # ---------- base: ordinary scattered documents (never before incorporation), denser in 2026
    pool = [("office", "Monthly serviced office fee", 1800), ("broadband", "Fibre broadband, monthly", 140), ("energy", "Electricity charges", 430),
            ("stationery", "Stationery and toner", 210), ("electrical", "Electrical maintenance callout", 320), ("insurance", "Business insurance premium", 1250),
            ("it", "IT support retainer", 680), ("courier", "Courier and freight charges", 175), ("travel", "Business travel booking", 960),
            ("pantry", "Pantry supplies", 95), ("forklift", "Forklift rental, 3 days", 540), ("signage", "Office signage", 780),
            ("training", "Staff training course", 890)]
    per_year = {2017: 1, 2018: 2, 2019: 2, 2020: 2, 2021: 2, 2022: 2, 2023: 2, 2024: 3, 2025: 3, 2026: 8}  # denser in 2026
    for year, n in per_year.items():
        for i in range(n):
            vk, item, base = g.rng.choice(pool)
            d = g.free_date(year, 12 if year < 2026 else 9)
            kind = g.rng.choice(["invoice", "invoice", "receipt"])
            g.invoice("c0", "base", g.rng.choice(["admin", "user1", "user2", "user"]), vk, item, base, d, kind=kind)
        if year >= 2018 and year in (2018, 2020, 2022, 2024, 2025, 2026):
            g.receivable("c0", "admin", g.free_date(year, 9 if year == 2026 else 12), 6200)
        if year >= 2018 and year % 2 == 0:
            g.simple("c0", "base", "user1", g.free_date(year, 9 if year == 2026 else 12), title="DELIVERY ORDER",
                     vendor=g.rng.choice(CUSTOMERS), lane="important", doc_type="delivery order", bucket="Operations",
                     description="Delivery order for fabricated components", body=["Items: 12 fabricated brackets, 4 base plates.", "Received in good order."],
                     filename=f"Delivery_Order_{year}.pdf")
    for year in range(2019, 2027):
        for i in range(1 if year < 2025 else 2):
            vk, item, base = g.rng.choice(pool)
            g.invoice("c1", "base", "user1", vk, item, base, date(year, g.rng.randint(1, 9 if year == 2026 else 12), g.rng.randint(1, 27)))
    for year in range(2020, 2027):
        vk, item, base = g.rng.choice(pool)
        g.invoice("c2", "base", "user1", vk, item, base, date(year, g.rng.randint(1, 9 if year == 2026 else 12), g.rng.randint(1, 27)))
    g.receivable("c1", "admin", date(2024, 5, 14), 5400)
    g.receivable("c2", "admin", date(2025, 4, 22), 3100)

    # ---------- multi-page PDFs (the GST filings are two-page already), 2 to 3 more
    g.simple("c0", "base", "user", date(2021, 4, 12), title="SERVICE AGREEMENT", vendor=V["office"][0], lane="important", doc_type="service agreement",
             bucket="Contracts", description="Serviced office service agreement, 24 months", filename="Service_Agreement_Office.pdf",
             body=["Parties: the company and Harbourview Serviced Offices Pte Ltd.", "Term: 24 months from 1 May 2021.", "Monthly fee: SGD 1,800 (excluding GST)."],
             extra_pages=[["SERVICE AGREEMENT - page 2", FIXTURE_LINE, "", "5. Fees and payment.", "6. Notice and termination.", "7. Deposit: two months' fee."],
                          ["SERVICE AGREEMENT - page 3", FIXTURE_LINE, "", "8. Governing law: Singapore.", "Signed for the company: P. Ramanathan.", "Signed for the provider."]])
    g.simple("c0", "base", "admin", date(2023, 9, 4), title="MASTER SUPPLY AGREEMENT", vendor=CUSTOMERS[0], lane="important", doc_type="supply agreement",
             bucket="Contracts", description="Master supply agreement with Northgate Precision, 12 months", filename="Master_Supply_Agreement.pdf",
             body=["Parties: the company and Northgate Precision Pte Ltd.", "Term: 12 months, renewable."],
             extra_pages=[["MASTER SUPPLY AGREEMENT - page 2", FIXTURE_LINE, "", "3. Pricing and volume tiers."], ["MASTER SUPPLY AGREEMENT - page 3", FIXTURE_LINE, "", "4. Delivery and acceptance."],
                          ["MASTER SUPPLY AGREEMENT - page 4", FIXTURE_LINE, "", "5. Warranty and liability.", "Signed by both parties."]])
    g.simple("c1", "base", "admin", date(2022, 2, 8), title="QUOTATION", vendor=V["forklift"][0], lane="important", doc_type="quotation", bucket="Miscellaneous",
             description="Equipment rental quotation, two pages", filename="Quotation_Equipment.pdf", body=["Item 1: forklift, monthly rental.", "Valid for 30 days."],
             extra_pages=[["QUOTATION - page 2", FIXTURE_LINE, "", "Terms and conditions.", "Prices exclude GST."]])

    # ---------- photos (Memory Lane; the date is in the file's own EXIF)
    g.photo("c0", "user2", date(2019, 8, 8), "Warehouse visit with the team", 11)
    g.photo("c0", "user1", date(2023, 12, 15), "Year-end team lunch", 12)
    g.photo("c0", "user2", date(2024, 2, 5), "Office Chinese New Year decorations", 13)

    # ---------- Only me (personal; named by their owner; no pipeline, filed at once)
    g.add(company="c0", cluster="personal", uploader="owner", occurred=date(2025, 11, 3), delta_days=0, filename="Flat_Renewal_Quote.pdf", visibility="only_me",
          pages=[["QUOTATION", FIXTURE_LINE, "", "Home renovation quotation (personal).", "Total: SGD 4,800.00"]], lane=None, doc_type=None, bucket=None,
          vendor=None, description=None, personal_name="Flat renovation quote", caption="Quote to compare before Chinese New Year")
    g.add(company="c0", cluster="personal", uploader="user1", occurred=date(2026, 2, 20), delta_days=0, filename="Course_Receipt.pdf", visibility="only_me",
          pages=[["RECEIPT", FIXTURE_LINE, "", "Evening course fee (personal).", "Total: SGD 620.00"]], lane=None, doc_type=None, bucket=None,
          vendor=None, description=None, personal_name="Evening course receipt", caption="Claim later, not a company expense")


# ---------------------------------------------------------------- rendering

def render_pdf(path: Path, pages: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, invariant=1)  # invariant: fixed creation date and id, so the bytes are stable
    c.setAuthor("seed fixture")
    c.setTitle(path.stem)
    for lines in pages:
        y = 800
        for line in lines:
            c.setFont("Helvetica-Bold" if y == 800 else "Helvetica", 15 if y == 800 else 10.5)
            c.drawString(56, y, line)
            y -= 22 if y == 800 else 15
        c.showPage()
    c.save()
    path.write_bytes(buf.getvalue())


def render_jpeg(path: Path, occurred: date, seed: int) -> None:
    """A plain synthetic picture with no text (so OCR finds none) and the date in EXIF DateTimeOriginal."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    img = Image.new("RGB", (640, 480))
    px = img.load()
    base = [rng.randint(60, 200) for _ in range(3)]
    for x in range(640):
        for y in range(480):
            px[x, y] = (base[0] + x // 8 % 40, base[1] + y // 8 % 40, base[2] + (x + y) // 16 % 40)
    exif = Image.Exif()
    exif_ifd = exif.get_ifd(0x8769)
    exif_ifd[0x9003] = occurred.strftime("%Y:%m:%d 10:15:00")  # DateTimeOriginal
    exif[0x0132] = occurred.strftime("%Y:%m:%d 10:15:00")      # DateTime
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70, exif=exif)
    path.write_bytes(buf.getvalue())


def write_people_doc() -> None:
    """docs/DEMO-PEOPLE.md: who each fictional person is. The user ruled that role labels are NAMES ONLY: no column, no migration, no
    title inside a display name. The four app roles stay (app/auth.py); a business title (Corp Sec, HR and Finance) is recorded HERE.
    A later item (S3) will show the business title in History and will read this table, so keep it exact."""
    lines = [
        "# Demo people (fictional)", "",
        "Every person, company, vendor and document in the demo data is FICTIONAL, made by `scripts/generate_seed_files.py` and applied by "
        "`scripts/seed_demo_fixtures.py` (DECISIONS #133). Names were chosen to be plausible and are not real people. Emails end in `.test`. "
        "There are no NRIC numbers or other real personal data anywhere.", "",
        "**Business titles are not app roles.** The app has four roles (`owner`, `admin`, `user`, `viewer`; `app/auth.py`), and the user ruled "
        "that role labels are names only: no new column, no migration, no title inside a display name. A person's business title lives in "
        "this file only. A later item (S3, not built) will show it next to the name in History, reading this table.", "",
        f"The group is **{GROUP_NAME}**. The picker owner (`owner@try-demo.test`, Priya Ramanathan) owns all three companies; the six emails "
        "in the demo login picker (`web/src/config/demo.ts`) are all members of the FIRST company. People with other emails are members of "
        "one company each and are not in the picker.", "",
        "**Why the Company Secretary is app role `user`, not `admin`:** the Corp Sec uploads and corrects her own statutory filings, which is "
        "what a `user` may do (edit only what you uploaded). Resolving reviews, adding members and seeing which checklist items are missing "
        "are admin and owner work, and those belong to the HR and Finance Manager and the Managing Director here.", ""]
    for c in COMPANIES:
        lines += [f"## {c['name']}", "", f"Financial year end {c['fye'][1]}/{c['fye'][0]}; incorporated {c['incorporated_on']}; "
                  + (f"GST-registered, {c['gst_cycle']}." if c["gst_registered"] else "not GST-registered."), "",
                  "| Person | Email | Company | App role | Business title | In the login picker |", "|---|---|---|---|---|---|"]
        for key, email, name, role, title in PEOPLE[c["key"]]:
            picker = "yes" if c["key"] == "c0" else ("yes (owner)" if key == "owner" else "no")
            lines.append(f"| {name} | `{email}` | {c['name']} | {role} | {title} | {picker} |")
        lines.append("")
    (OUT.parent.parent / "docs" / "DEMO-PEOPLE.md").write_text("\n".join(lines))


def main() -> None:
    g = Gen()
    build(g)
    import hashlib
    import shutil
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for d in sorted(g.docs, key=lambda x: (x["company"], x["received_local"], x["file"])):
        path = OUT / d["file"]
        if d["media"] == "jpg":
            render_jpeg(path, date.fromisoformat(d["occurred_on"]), d["photo_seed"])
        else:
            render_pdf(path, d["pages"])
        d["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    docs = sorted(g.docs, key=lambda x: (x["company"], x["received_local"], x["file"]))
    for d in docs:
        d.pop("pages", None)  # the text is in the file; the manifest keeps only what the seeder must know
    manifest = {"note": FIXTURE_LINE + ". Generated by scripts/generate_seed_files.py.", "group": GROUP_NAME, "companies": COMPANIES,
                "people": {k: [dict(zip(("key", "email", "name", "role", "title"), p)) for p in v] for k, v in PEOPLE.items()},
                "today": TODAY.isoformat(), "holidays": HOLIDAYS, "events": EVENTS, "documents": docs}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    write_people_doc()
    shas = [d["sha256"] for d in docs]
    assert len(shas) == len(set(shas)), "duplicate file bytes: sha256 is UNIQUE in the database"
    total = sum((OUT / d["file"]).stat().st_size for d in docs)
    by = {}
    for d in docs:
        by.setdefault((d["company"], d["cluster"]), 0)
        by[(d["company"], d["cluster"])] += 1
    print(f"{len(docs)} documents, {total / 1024:.0f} KiB of files, written to {OUT}")
    for company in ("c0", "c1", "c2"):
        print(f"  {company}: {sum(v for (c, _), v in by.items() if c == company)}  " +
              ", ".join(f"{cl}={n}" for (c, cl), n in sorted(by.items()) if c == company))


if __name__ == "__main__":
    sys.exit(main())
