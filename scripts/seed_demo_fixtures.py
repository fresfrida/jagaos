"""Fills a database with a believable, FICTIONAL demo, through the app's own code, and with NO gateway call (round 7, item S1, DECISIONS #133).

    LLM_CALLS_DISABLED=1 python scripts/seed_demo_fixtures.py --db PATH --docs-dir PATH [--thumbs-dir PATH]

WHY THIS AND NOT seed_dev_db.py: that script uploads documents through the real pipeline and so spends the gateway budget
(DECISIONS #130). This one never calls the model. It refuses to run unless calls are switched off (app.llm.calls_disabled(), the env
flag LLM_CALLS_DISABLED), refuses a LIVE target (a database under /opt/jaga) unless told --allow-live-target, and replaces the client
constructor with one that fails, so a stray call could not even be built.

WHAT IT DOES, in order, through real code wherever a real function exists:
  1. init_db on the target (the local data/jaga.db predates document_activity).
  2. Finds the picker owner's three owner-companies (by membership, then by financial year end; NEVER by the old "Try Demo" names),
     renames them and their group through PATCH /api/companies/{id}, sets incorporated_on and gst_period (the PATCH model has no field
     for those two, so they are written directly), and adds the named people through POST /api/companies/{id}/members.
  3. Each fixture file goes through the real ingest(): real text extraction (pdfplumber, so extracted_text is what the file says), the real
     sha256, the stored copy, EXIF, the Uploaded history event. Then the fields only the pipeline would set (lane, doc_type, bucket,
     vendor_name, description, received_at, occurred_on) and the extraction rows are written directly, labelled as fixtures
     (source_identity = 'seed-fixture', extractor_version = 'seed-fixture-v1'); status moves through rules/transitions.py
     (received, proposed, filed) by the actor 'seed-fixture'; a personal file goes through file_personal_document. No review_item is
     written (a directly written one has no in-memory checkpoint, so Confirm would answer 410).
  4. Events, then the real rule app/rules/expectations.py via the real derive_expectations node, then reconcile_expectations, so
     satisfied and missing and the evidence document come from the real matching code.
  5. Edits, one pending purge request and one request-then-cancel go through the REAL endpoints as the named people; only the
     resulting document_activity.at (and purge_requested_at) are then set with an UPDATE, so History shows plausible dates.
  6. First-page thumbnails for the PDFs, with the app's own thumbnail code.
It is idempotent: a file whose sha256 the database already holds is skipped, and every later step checks before it writes."""

import argparse
import json
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(Path(__file__).parent))

DEFAULT_FILES = REPO / "evals" / "seed_files"
OWNER_EMAIL = "owner@try-demo.test"
SEED_ACTOR = "seed-fixture"
SOURCE_IDENTITY = "seed-fixture"
EXTRACTOR_VERSION = "seed-fixture-v1"
SG_OFFSET = timedelta(hours=8)
COUNT_TABLES = ["company_group", "company", "app_user", "membership", "document", "document_activity", "extraction", "event",
                "expectation", "review_item", "trace"]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Seed a database with fictional demo data. No gateway call is made.")
    p.add_argument("--db", required=True, help="the SQLite database to fill (required, no default)")
    p.add_argument("--docs-dir", required=True, help="where the stored document files go (required, no default)")
    p.add_argument("--thumbs-dir", help="where PDF thumbnails go (default: a 'thumbnails' folder beside --docs-dir)")
    p.add_argument("--files-dir", default=str(DEFAULT_FILES), help="the committed fixture files (default: evals/seed_files)")
    p.add_argument("--allow-live-target", action="store_true", help="permit a database under /opt/jaga (the live server)")
    return p


def refusals(args: argparse.Namespace, calls_disabled: bool) -> list[str]:
    """Why this run must not go ahead. Kept free of any app import so it can be tested on its own."""
    import _live_guard

    reasons: list[str] = []
    if not calls_disabled:
        reasons.append("gateway calls are not switched off: run it as  LLM_CALLS_DISABLED=1 python scripts/seed_demo_fixtures.py ...  "
                       "(this script never calls the model; the switch is the proof, and a second lock)")
    live = _live_guard.live_target_reasons(args.db, "http://127.0.0.1")
    if live and not args.allow_live_target:
        reasons.append("the target looks LIVE (" + "; ".join(live) + "). Pass --allow-live-target only when seeding the live database is the point")
    if not Path(args.files_dir, "manifest.json").exists():
        reasons.append(f"no manifest.json under {args.files_dir}; run scripts/generate_seed_files.py first")
    return reasons


def _utc(local: str) -> str:
    """'2019-02-06 10:42' in Asia/Singapore -> the stored UTC form 'YYYY-MM-DD HH:MM:SS' (Singapore has no daylight saving)."""
    return (datetime.strptime(local, "%Y-%m-%d %H:%M") - SG_OFFSET).strftime("%Y-%m-%d %H:%M:%S")


class Seeder:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.files = Path(args.files_dir)
        self.manifest = json.loads((self.files / "manifest.json").read_text())
        self.company_id: dict[str, int] = {}
        self.user_ids: dict[str, int] = {}     # email -> id
        self.doc_ids: dict[str, int] = {}      # manifest file -> document id
        self.session_floor = 0
        self.stats: dict[str, int] = {"ingested": 0, "skipped_existing": 0, "extraction_rows": 0, "thumbnails": 0}
        self._headers: dict[tuple, dict] = {}

    # ------------------------------------------------------------ plumbing
    def conn(self):
        return self.get_conn(self.db_path)

    def counts(self) -> dict[str, int]:
        with self.get_conn(self.db_path) as conn:
            return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in COUNT_TABLES}

    def login(self, email: str) -> dict:
        r = self.client.post("/api/auth/dev-login", json={"email": email})
        r.raise_for_status()
        return {"Authorization": "Bearer " + r.json()["token"]}

    def headers(self, company_key: str, persona: str) -> dict:
        """A session for this named person, scoped to this company (the owner belongs to all three)."""
        key = (company_key, persona)
        if key in self._headers:
            return self._headers[key]
        person = next(p for p in self.manifest["people"][company_key] if p["key"] == persona)
        h = self.login(person["email"])
        cid = self.company_id[company_key]
        me = self.client.get("/api/auth/me", headers=h).json()
        if me["company"]["id"] != cid:
            self.client.post("/api/auth/switch-company", json={"company_id": cid}, headers=h).raise_for_status()
        self._headers[key] = h
        return h

    # ------------------------------------------------------------ 2. companies, group, people
    def ensure_companies(self) -> None:
        with self.get_conn(self.db_path) as conn:
            owned = [dict(r) for r in conn.execute(
                "SELECT c.id, c.name, c.fye_month, c.fye_day FROM company c JOIN membership m ON m.company_id = c.id "
                "JOIN app_user u ON u.id = m.user_id WHERE u.email = ? AND m.role = 'owner' ORDER BY c.id", (OWNER_EMAIL,))]
        taken: set[int] = set()
        owner_name = next(p["name"] for p in self.manifest["people"]["c0"] if p["key"] == "owner")
        for spec in self.manifest["companies"]:
            match = next((c for c in owned if c["name"] == spec["name"] and c["id"] not in taken), None)
            if match is None:  # not renamed yet: the owner's companies are found by membership and financial year end, not by name
                match = next((c for c in owned if [c["fye_month"], c["fye_day"]] == spec["fye"] and c["id"] not in taken), None)
            if match is None:
                r = self.client.post("/api/auth/dev-login", json={
                    "email": OWNER_EMAIL, "name": owner_name, "company_name": spec["name"], "fye_month": spec["fye"][0], "fye_day": spec["fye"][1]})
                r.raise_for_status()
                cid = r.json()["company"]["id"]
                print(f"  created {spec['key']}: {spec['name']} (company #{cid})")
            else:
                cid = match["id"]
            taken.add(cid)
            self.company_id[spec["key"]] = cid
        # Owner names first (the picker owner exists by now), then rename through the real endpoint as the owner.
        with self.get_conn(self.db_path) as conn:
            conn.execute("UPDATE app_user SET name = ? WHERE email = ?", (owner_name, OWNER_EMAIL))
        for spec in self.manifest["companies"]:
            h = self.headers(spec["key"], "owner")
            body = {"name": spec["name"], "gst_registered": bool(spec["gst_registered"])}
            self.client.patch(f"/api/companies/{self.company_id[spec['key']]}", json=body, headers=h).raise_for_status()
            with self.get_conn(self.db_path) as conn:  # the PATCH model has no field for these two (a departure from the brief)
                conn.execute("UPDATE company SET incorporated_on = ?, gst_period = ? WHERE id = ?",
                             (spec["incorporated_on"], spec["gst_cycle"], self.company_id[spec["key"]]))
        # The group: rename the one the first company already belongs to, else create it; then label all three.
        with self.get_conn(self.db_path) as conn:
            gid = conn.execute("SELECT group_id FROM company WHERE id = ?", (self.company_id["c0"],)).fetchone()["group_id"]
            if gid is None:
                gid = conn.execute("SELECT id FROM company_group WHERE name = ?", (self.manifest["group"],)).fetchone()
                gid = gid["id"] if gid else conn.execute("INSERT INTO company_group (name) VALUES (?)", (self.manifest["group"],)).lastrowid
            conn.execute("UPDATE company_group SET name = ? WHERE id = ?", (self.manifest["group"], gid))
            for cid in self.company_id.values():
                conn.execute("UPDATE company SET group_id = ? WHERE id = ?", (gid, cid))

    def ensure_people(self) -> None:
        for ckey, people in self.manifest["people"].items():
            cid = self.company_id[ckey]
            for p in people:
                if p["key"] == "owner":
                    continue
                with self.get_conn(self.db_path) as conn:
                    member = conn.execute("SELECT m.role FROM membership m JOIN app_user u ON u.id = m.user_id WHERE m.company_id = ? AND u.email = ?",
                                          (cid, p["email"])).fetchone()
                if member is None:
                    self.client.post(f"/api/companies/{cid}/members", json={"email": p["email"], "name": p["name"], "role": p["role"]},
                                     headers=self.headers(ckey, "owner")).raise_for_status()
                elif member["role"] != p["role"]:
                    print(f"  WARNING: {p['email']} already has role {member['role']} in {ckey}, not {p['role']}; left as it is")
                with self.get_conn(self.db_path) as conn:
                    conn.execute("UPDATE app_user SET name = ? WHERE email = ?", (p["name"], p["email"]))
        with self.get_conn(self.db_path) as conn:
            self.user_ids = {r["email"]: r["id"] for r in conn.execute("SELECT id, email FROM app_user")}

    def uid(self, ckey: str, persona: str) -> int:
        return self.user_ids[next(p["email"] for p in self.manifest["people"][ckey] if p["key"] == persona)]

    # ------------------------------------------------------------ 3. documents
    def apply_documents(self) -> None:
        from app.db import reindex_document_search
        from app.graph.ingest import ingest
        from app.rules.transitions import file_personal_document, transition_document

        for d in sorted(self.manifest["documents"], key=lambda x: (x["received_local"], x["file"])):
            ckey, personal = d["company"], d.get("visibility") == "only_me"
            state = ingest(
                company_id=self.company_id[ckey], source_path=str(self.files / d["file"]), filename=d["display_name"], source_channel="web",
                source_identity=SOURCE_IDENTITY, uploaded_by_user_id=self.uid(ckey, d["uploader"]), db_path=self.db_path,
                visibility="only_me" if personal else "company", read_content=not personal,
            )
            doc_id = state["document_id"]
            self.doc_ids[d["file"]] = doc_id
            if state["text_source"] == "duplicate":
                self.stats["skipped_existing"] += 1
                continue
            self.stats["ingested"] += 1
            received = _utc(d["received_local"])
            with self.get_conn(self.db_path) as conn:
                if personal:
                    conn.execute("UPDATE document SET filename = ?, description = ?, received_at = ?, occurred_on = ? WHERE id = ?",
                                 (d["personal_name"], json.dumps({"en": d["caption"]}), received, d["occurred_on"], doc_id))
                else:
                    conn.execute(
                        "UPDATE document SET received_at = ?, occurred_on = COALESCE(occurred_on, ?), lane = ?, doc_type = ?, bucket = ?, vendor_name = ?, "
                        "description = ? WHERE id = ?",
                        (received, d["occurred_on"], d["lane"], d["doc_type"], d["bucket"], d["vendor"],
                         json.dumps({"en": d["description"]}) if d.get("description") else None, doc_id))
                    if d["media"] == "jpg":  # a picture keeps the date its own EXIF carries; it must agree with the manifest
                        got = conn.execute("SELECT occurred_on FROM document WHERE id = ?", (doc_id,)).fetchone()["occurred_on"]
                        assert got == d["occurred_on"], f"{d['file']}: EXIF date {got} != manifest {d['occurred_on']}"
                lifecycle = conn.execute("SELECT lifecycle_id FROM document WHERE id = ?", (doc_id,)).fetchone()["lifecycle_id"]
                conn.execute("UPDATE document_activity SET at = ? WHERE lifecycle_id = ? AND action = 'uploaded'", (received, lifecycle))
            if personal:
                file_personal_document(doc_id, actor=SEED_ACTOR, db_path=self.db_path)
            else:
                transition_document(doc_id, "proposed", actor=SEED_ACTOR, db_path=self.db_path)
                transition_document(doc_id, "filed", actor=SEED_ACTOR, db_path=self.db_path)
                self.write_extraction(doc_id, d)
            reindex_document_search(doc_id, self.db_path)

    def write_extraction(self, doc_id: int, d: dict) -> None:
        """Fixture extraction rows, labelled: extractor_version 'seed-fixture-v1'. Page and character offsets are found in the real
        extracted text (a value that is not in the text gets no offsets)."""
        with self.get_conn(self.db_path) as conn:
            text = conn.execute("SELECT extracted_text FROM document WHERE id = ?", (doc_id,)).fetchone()["extracted_text"] or ""
            rows: list[tuple] = []
            if d.get("invoice"):
                inv = d["invoice"]
                rows = [("vendor", d["vendor"], d["vendor"]), ("invoice_no", inv["no"], inv["no"]), ("issued_on", d["occurred_on"], inv["date_text"]),
                        ("subtotal", inv["subtotal"], f"{inv['subtotal']:,.2f}"), ("tax", inv["tax"], f"{inv['tax']:,.2f}"),
                        ("currency", inv["currency"], inv["currency"]), ("total", inv["total"], f"{inv['total']:,.2f}")]
            elif d["lane"] == "statutory":
                rows = [("doc_type", d["doc_type"], None), ("issued_on", d["occurred_on"], None)]
            for i, (field, value, needle) in enumerate(rows):
                at = text.find(needle) if needle else -1
                conn.execute(
                    "INSERT INTO extraction (document_id, field, value_text, confidence, page, char_start, char_end, extractor_version) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (doc_id, field, json.dumps(value), round(0.9 + ((doc_id * 7 + i * 3) % 10) / 100, 2), 1 if at >= 0 else None,
                     at if at >= 0 else None, at + len(needle) if at >= 0 else None, EXTRACTOR_VERSION))
                self.stats["extraction_rows"] += 1

    # ------------------------------------------------------------ 4. events and the checklist (the real rule and reconcile)
    def apply_events(self) -> None:
        from app.graph.derive_expectations import derive_expectations, reconcile_expectations

        for ev in self.manifest["events"]:
            cid = self.company_id[ev["company"]]
            with self.get_conn(self.db_path) as conn:
                existing = conn.execute("SELECT id FROM event WHERE company_id = ? AND kind = ?", (cid, ev["kind"])).fetchone()
                if existing:
                    continue
                source = None
                if ev["source_doc_type"]:
                    row = conn.execute("SELECT id FROM document WHERE company_id = ? AND doc_type = ? ORDER BY id LIMIT 1", (cid, ev["source_doc_type"])).fetchone()
                    source = row["id"] if row else None
                eid = conn.execute("INSERT INTO event (company_id, kind, occurred_on, title, confidence, status, source_document_id) "
                                   "VALUES (?, ?, ?, ?, 1.0, 'confirmed', ?)", (cid, ev["kind"], ev["occurred_on"], ev["title"], source)).lastrowid
            derive_expectations({"company_id": cid, "events": [{"id": eid, "kind": ev["kind"], "occurred_on": ev["occurred_on"]}]})
        for cid in self.company_id.values():
            reconcile_expectations(cid, self.db_path)

    # ------------------------------------------------------------ 5. History through the real endpoints
    def _newest_activity(self, doc_id: int, action: str) -> int | None:
        with self.get_conn(self.db_path) as conn:
            row = conn.execute("SELECT MAX(a.id) AS id FROM document_activity a JOIN document d ON d.lifecycle_id = a.lifecycle_id "
                               "WHERE d.id = ? AND a.action = ?", (doc_id, action)).fetchone()
        return row["id"]

    def _backdate(self, doc_id: int, action: str, local: str) -> None:
        with self.get_conn(self.db_path) as conn:
            conn.execute("UPDATE document_activity SET at = ? WHERE id = ?", (_utc(local), self._newest_activity(doc_id, action)))

    def _has(self, doc_id: int, action: str) -> bool:
        return self._newest_activity(doc_id, action) is not None

    def apply_history(self) -> dict:
        docs = [d for d in self.manifest["documents"] if d["company"] == "c0" and d.get("visibility") != "only_me" and d["file"] in self.doc_ids]
        today = date.fromisoformat(self.manifest["today"])
        report = {"edited": [], "purge_pending": None, "purge_cancelled": None}

        def later(d: dict, low: int, high: int, hour: int = 15) -> str:
            base = date.fromisoformat(d["received_local"][:10])
            stamp = min(base + timedelta(days=low + (self.doc_ids[d["file"]] % (high - low + 1))), today - timedelta(days=1))
            return f"{stamp.isoformat()} {hour:02d}:{(self.doc_ids[d['file']] * 7) % 50 + 5:02d}"

        # Edited by someone other than the uploader (Jonathan Ong, the HR and finance admin), a few by the owner, one by the uploader.
        by_others = [d for d in docs if d["uploader"] in ("user1", "user2") and d["cluster"] in ("base", "cny", "festival", "yearend")]
        for n, d in enumerate(by_others[3::7][:7]):
            editor = "admin" if n % 3 else "owner"
            if self._has(self.doc_ids[d["file"]], "edited"):
                continue
            note = " Checked against the purchase order." if editor == "admin" else " Approved for payment."
            body = {"description": d["description"] + note}
            self.client.patch(f"/api/documents/{self.doc_ids[d['file']]}", json=body, headers=self.headers("c0", editor)).raise_for_status()
            self._backdate(self.doc_ids[d["file"]], "edited", later(d, 2, 11))
            report["edited"].append((d["file"], editor))
        own = next((d for d in docs if d["uploader"] == "user2" and d["cluster"] == "cny"), None)
        if own and not self._has(self.doc_ids[own["file"]], "edited"):
            self.client.patch(f"/api/documents/{self.doc_ids[own['file']]}", json={"vendor_name": own["vendor"]}, headers=self.headers("c0", "user2"))
            # an edit that changes nothing writes no history row; make it a real one
            self.client.patch(f"/api/documents/{self.doc_ids[own['file']]}", json={"description": own["description"] + " Reunion booking confirmed."},
                              headers=self.headers("c0", "user2")).raise_for_status()
            self._backdate(self.doc_ids[own["file"]], "edited", later(own, 1, 3, 11))
            report["edited"].append((own["file"], "user2"))

        owner = self.headers("c0", "owner")
        recent = [d for d in docs if d["received_local"] >= "2026-06-01" and d["cluster"] == "base" and d["media"] == "pdf"]
        # One purge REQUEST left pending (by the owner), one requested then CANCELLED (restored).
        if len(recent) >= 2:
            pend, canc = recent[-1], recent[-2]
            pid, cid_ = self.doc_ids[pend["file"]], self.doc_ids[canc["file"]]
            if not self._has(pid, "purge_requested"):
                self.client.post(f"/api/documents/{pid}/request-purge", headers=owner).raise_for_status()
                when = "2026-09-14 11:20"
                self._backdate(pid, "purge_requested", when)
                with self.get_conn(self.db_path) as conn:
                    conn.execute("UPDATE document SET purge_requested_at = ? WHERE id = ?", (_utc(when), pid))
                report["purge_pending"] = pend["file"]
            if not self._has(cid_, "purge_requested"):
                self.client.post(f"/api/documents/{cid_}/request-purge", headers=owner).raise_for_status()
                self._backdate(cid_, "purge_requested", "2026-08-03 16:05")
                self.client.post(f"/api/documents/{cid_}/cancel-purge-request", headers=owner).raise_for_status()
                self._backdate(cid_, "purge_cancelled", "2026-08-04 09:40")
                report["purge_cancelled"] = canc["file"]
        return report

    # ------------------------------------------------------------ 6. thumbnails
    def apply_thumbnails(self) -> None:
        from app.thumbnails import get_pdf_thumbnail

        with self.get_conn(self.db_path) as conn:
            # Only the documents this seeder made: a database it did not build may hold rows the thumbnail code refuses.
            rows = conn.execute("SELECT sha256, stored_path FROM document WHERE source_identity = ? AND media_type = 'application/pdf' "
                                "AND visibility = 'company'", (SOURCE_IDENTITY,)).fetchall()
        for r in rows:
            try:
                if get_pdf_thumbnail(r["sha256"], r["stored_path"]) is not None:
                    self.stats["thumbnails"] += 1
            except ValueError:
                pass

    # ------------------------------------------------------------ run
    def run(self) -> int:
        from fastapi.testclient import TestClient
        from app.db import DB_PATH, get_conn, init_db
        from app.main import app

        self.get_conn, self.db_path = get_conn, DB_PATH
        init_db(DB_PATH)
        before = self.counts()
        with self.get_conn(self.db_path) as conn:
            self.session_floor = conn.execute("SELECT COALESCE(MAX(id), 0) FROM session").fetchone()[0]
        with TestClient(app) as self.client:
            print("companies and people ...")
            self.ensure_companies()
            self.ensure_people()
            print("documents ...")
            self.apply_documents()
            print("checklist ...")
            self.apply_events()
            print("history ...")
            report = self.apply_history()
        with self.get_conn(self.db_path) as conn:  # leave no login sessions behind: the seeder made them only to act as the named people
            conn.execute("DELETE FROM session WHERE id > ?", (self.session_floor,))
        print("thumbnails ...")
        self.apply_thumbnails()
        after = self.counts()
        print(f"\nrows          {'before':>8} {'after':>8}")
        for t in COUNT_TABLES:
            print(f"  {t:<16}{before[t]:>6} {after[t]:>8}")
        print(f"\n{self.stats}\nhistory: {report}")
        return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Paths FIRST: app.db, ingest and thumbnails read them once, when they are imported.
    os.environ["JAGA_DB_PATH"] = str(Path(args.db).resolve())
    os.environ["JAGA_DOCS_PATH"] = str(Path(args.docs_dir).resolve())
    os.environ["JAGA_THUMBS_PATH"] = str(Path(args.thumbs_dir).resolve() if args.thumbs_dir else Path(args.docs_dir).resolve().parent / "thumbnails")
    from dotenv import load_dotenv

    load_dotenv()  # never overrides the paths above; lets LLM_CALLS_DISABLED come from .env as well as the environment
    from app.llm import calls_disabled  # only this function: nothing that makes a call

    reasons = refusals(args, calls_disabled())
    if reasons:
        print("REFUSED (exit 2):\n  - " + "\n  - ".join(reasons), file=sys.stderr)
        return 2
    for folder in (os.environ["JAGA_DOCS_PATH"], os.environ["JAGA_THUMBS_PATH"], str(Path(os.environ["JAGA_DB_PATH"]).parent)):
        Path(folder).mkdir(parents=True, exist_ok=True)
    import app.llm as llm

    def _no_client() -> None:
        raise AssertionError("seed_demo_fixtures must never build a gateway client")

    llm._client = _no_client  # a stray call could not even construct one
    return Seeder(args).run()


if __name__ == "__main__":
    sys.exit(main())
