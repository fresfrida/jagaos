"""Builds evals/replay/*.json: the recorded model answers replay mode plays back (round 7, item S2, DECISIONS #134).

    python scripts/build_replay_fixtures.py            # rewrites evals/replay/

READ-ONLY: it opens the dev database (data/jaga.db) and the older evals/demo_corpus/demo.db with SQLite's immutable=1 and writes only
files under evals/replay/. No gateway, no import of app/. Deterministic (fixed built-on date), so a re-run writes identical files.

One file per (run_id, purpose): `<run_id>.<purpose>.json`, run_id being the first 12 hex characters of the PDF's sha256 (what
app/graph/ingest.py uses), purpose being classify, extract or derive_events, for the 8 tracked demo PDFs under evals/demo_corpus/files/.

WHAT IS RECORDED AND WHAT IS NOT (every fixture says so, field by field, in its "provenance"):
  * RECORDED: the extract answers (every field, its confidence, page and character offsets, from the `extraction` rows) and the
    derive_events answers (from the `event` rows those documents produced); classify's lane, doc_type and confidence (the `document` row
    and the `trace` row of the real call). The invoice tax field was called `gst` when it was recorded and `tax` since DECISIONS item 10;
    the value is the recorded one under the current name.
  * RECONSTRUCTED: classify's injection_suspected. For 07 the security event records model_flag=True (which node set it is not recorded);
    it is set on classify only.
  * AUTHORED (written here, NEVER recorded; classify answers were not stored raw and document.bucket was NULL for all of them, recorded
    before DECISIONS #42): classify's description, description_en, bucket and vendor_name. Each authored description names only what the
    document's own text names (the grounding rule, app/rules/grounding.py).
  * ABSENT and left absent rather than invented: tax_label and currency on the invoices (fields that did not exist when they were recorded).
Where a document is in both databases the dev database wins; 06 (the review-queue invoice) exists only in demo.db."""

import hashlib
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PDFS = REPO / "evals" / "demo_corpus" / "files"
OUT = REPO / "evals" / "replay"
DBS = [("data/jaga.db", REPO / "data" / "jaga.db"), ("evals/demo_corpus/demo.db", REPO / "evals" / "demo_corpus" / "demo.db")]
BUILT_ON = "2026-09-27"
DERIVE_TOOL = "propose_event"  # app/graph/derive_events.py TOOL; a test checks this stays true

# Authored classify fields, per PDF. Names appear in the document text (see the docstring).
AUTHORED = {
    "01_certificate_of_incorporation.pdf": {
        "description": "Certificate of incorporation of Bright Harbour Pte. Ltd., incorporated on 15 January 2023",
        "bucket": "Statutory", "vendor_name": "Accounting and Corporate Regulatory Authority"},
    "02_constitution.pdf": {
        "description": "Constitution of Bright Harbour Pte. Ltd., adopted on 15 January 2023", "bucket": "Statutory", "vendor_name": None},
    "03_notice_office_change.pdf": {
        "description": "ACRA notice that the registered office of Bright Harbour Pte. Ltd. moves to 10 Anson Road, #22-01 from 1 March 2026",
        "bucket": "Statutory", "vendor_name": "ACRA"},
    "04_notice_corpsec_change.pdf": {
        "description": "Notice appointing Harbour Corp Services Pte Ltd as company secretary from 1 June 2026", "bucket": "Statutory",
        "vendor_name": "Harbour Corp Services Pte Ltd"},
    "05_invoice_clean.pdf": {
        "description": "Invoice from Straits Print Supplies Pte Ltd for company stationery and letterhead printing, SGD 348.80",
        "bucket": "Expenses", "vendor_name": "Straits Print Supplies Pte Ltd"},
    "06_invoice_bad_gst.pdf": {
        "description": "Invoice from Marina Facilities Management Pte Ltd for quarterly office facilities maintenance, SGD 1,284.00",
        "bucket": "Expenses", "vendor_name": "Marina Facilities Management Pte Ltd"},
    "07_invoice_injection_attempt.pdf": {
        "description": "Invoice from QuickFix IT Services for laptop repair service, SGD 163.50", "bucket": "Expenses",
        "vendor_name": "QuickFix IT Services"},
    "08_lease_important.pdf": {
        "description": "Key terms of the office lease at 10 Anson Road, #22-01, between Marina Bay Properties Pte Ltd and Bright Harbour Pte. Ltd.",
        "bucket": "Contracts", "vendor_name": "Marina Bay Properties Pte Ltd"},
}


def _open(path: Path) -> sqlite3.Connection | None:
    if not path.exists():
        return None
    con = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
    con.row_factory = sqlite3.Row
    return con


def _find(dbs: list, run_id: str):
    """(label, connection, document row) of the first database that holds this file."""
    for label, con in dbs:
        row = con.execute("SELECT * FROM document WHERE substr(sha256, 1, 12) = ? ORDER BY id LIMIT 1", (run_id,)).fetchone()
        if row:
            return label, con, row
    raise SystemExit(f"no recorded document for run_id {run_id} in any source database")


def _write(run_id: str, purpose: str, body: dict) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{run_id}.{purpose}.json"
    path.write_text(json.dumps(body, indent=1, ensure_ascii=False) + "\n")
    return path


def build() -> list[Path]:
    dbs = [(label, con) for label, path in DBS if (con := _open(path)) is not None]
    written: list[Path] = []
    for pdf in sorted(PDFS.glob("*.pdf")):
        run_id = hashlib.sha256(pdf.read_bytes()).hexdigest()[:12]
        label, con, doc = _find(dbs, run_id)
        authored = AUTHORED[pdf.name]
        trace = {r["node"]: r for r in con.execute("SELECT node, decision, confidence, at FROM trace WHERE document_id = ? AND model IS NOT NULL", (doc["id"],))}
        security = con.execute("SELECT detail FROM security_event WHERE document_id = ? AND kind = 'injection_suspected'", (doc["id"],)).fetchone()
        flagged = bool(security and "model_flag=True" in security["detail"])
        source = {"db": label, "document_id": doc["id"], "filename": pdf.name, "recorded_at": trace["classify"]["at"]}

        classify = {
            "lane": doc["lane"], "doc_type": doc["doc_type"], "confidence": trace["classify"]["confidence"], "injection_suspected": flagged,
            "description": authored["description"], "description_en": authored["description"],
            "bucket": authored["bucket"], "vendor_name": authored["vendor_name"],
        }
        fields = {"lane": "recorded", "doc_type": "recorded", "confidence": "recorded (trace of the real call)",
                  "injection_suspected": "reconstructed (the security event records model_flag=True; which node set it is not recorded)" if flagged else "recorded (no security event)",
                  "description": "authored", "description_en": "authored", "bucket": "authored", "vendor_name": "authored"}
        written.append(_write(run_id, "classify", {
            "run_id": run_id, "purpose": "classify", "tool_name": "classify_document", "arguments": classify,
            "provenance": {"built_by": "scripts/build_replay_fixtures.py", "built_on": BUILT_ON, "source": source, "fields": fields,
                           "authored": ["description", "description_en", "bucket", "vendor_name"]}}))

        if "extract" in trace:
            rows = con.execute("SELECT field, value_text, confidence, page, char_start, char_end FROM extraction WHERE document_id = ? ORDER BY id", (doc["id"],)).fetchall()
            args, fields = {}, {}
            for r in rows:
                name = "tax" if r["field"] == "gst" else r["field"]
                prov = {"value": json.loads(r["value_text"]), "confidence": r["confidence"]}
                for key in ("page", "char_start", "char_end"):
                    if r[key] is not None:
                        prov[key] = r[key]
                args[name] = prov
                fields[name] = "recorded" + (" (recorded as `gst`, named `tax` since DECISIONS item 10)" if r["field"] == "gst" else "")
            written.append(_write(run_id, "extract", {
                "run_id": run_id, "purpose": "extract", "tool_name": trace["extract"]["decision"], "arguments": args,
                "provenance": {"built_by": "scripts/build_replay_fixtures.py", "built_on": BUILT_ON,
                               "source": {**source, "recorded_at": trace["extract"]["at"]}, "fields": fields, "authored": [],
                               "absent": ["tax_label", "currency"] if "invoice" in trace["extract"]["decision"] else []}}))

        if "derive_events" in trace:
            ev = con.execute("SELECT kind, occurred_on, title, confidence FROM event WHERE source_document_id = ? ORDER BY id LIMIT 1", (doc["id"],)).fetchone()
            written.append(_write(run_id, "derive_events", {
                "run_id": run_id, "purpose": "derive_events", "tool_name": DERIVE_TOOL,
                "arguments": {"kind": ev["kind"], "occurred_on": ev["occurred_on"], "title": ev["title"], "confidence": ev["confidence"]},
                "provenance": {"built_by": "scripts/build_replay_fixtures.py", "built_on": BUILT_ON,
                               "source": {**source, "recorded_at": trace["derive_events"]["at"]},
                               "fields": {k: "recorded (from the event row this document produced)" for k in ("kind", "occurred_on", "title", "confidence")}, "authored": []}}))
    return written


if __name__ == "__main__":
    files = build()
    print(f"wrote {len(files)} fixtures to {OUT}")
    for f in files:
        print("  ", f.name)
    sys.exit(0)
