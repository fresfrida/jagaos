"""Proves what scripts/seed_demo_fixtures.py built, by READING it back the way the app does (round 7, item S1, DECISIONS #133).

    python scripts/verify_seed_fixtures.py --db PATH --docs-dir PATH [--json]

Read-only against the database. Signs in as the named people through the real dev-login and calls the real read endpoints in-process
(TestClient); no server, no gateway. Prints a report, or with --json a single JSON object (the tests use that), and exits 1 if any
invariant fails. Run it on the seeded database only."""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import statistics
import sys
import time
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
FILES = REPO / "evals" / "seed_files"


def gst_rate(d: date) -> float:
    return 0.07 if d < date(2023, 1, 1) else 0.08 if d < date(2024, 1, 1) else 0.09


def photo_date_problems(rows: list[dict], by_sha: dict, listed: list[dict], files_dir: Path = FILES) -> list[str]:
    """S1e (DECISIONS #138): every seeded Memory Lane photo must show a REAL Picture date, never the upload-day fallback. So its FILE carries an EXIF
    DateTimeOriginal, the row's occurred_on equals it, and the list the card is drawn from (`listed`, GET /api/documents) carries the same occurred_on."""
    from datetime import datetime

    from PIL import Image

    listed_by_id = {d["id"]: d for d in listed}
    problems: list[str] = []
    for r in rows:
        if r["lane"] != "memory" or r["doc_type"] != "photo":
            continue
        name = by_sha[r["sha256"]]["file"] if r["sha256"] in by_sha else str(r["id"])
        try:
            raw = Image.open(files_dir / by_sha[r["sha256"]]["file"]).getexif().get_ifd(0x8769).get(0x9003)
            taken = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S").date().isoformat()
        except Exception:  # noqa: BLE001 - a missing, unreadable or malformed EXIF date is the failure being reported
            problems.append(f"{name}: no EXIF DateTimeOriginal in the file")
            continue
        if r["occurred_on"] != taken:
            problems.append(f"{name}: occurred_on {r['occurred_on']} != EXIF {taken}")
        if (listed_by_id.get(r["id"]) or {}).get("occurred_on") != taken:
            problems.append(f"{name}: the card data (list) has no occurred_on equal to {taken}")
    return problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--docs-dir", required=True)
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)
    os.environ["JAGA_DB_PATH"] = str(Path(args.db).resolve())
    os.environ["JAGA_DOCS_PATH"] = str(Path(args.docs_dir).resolve())
    os.environ["LLM_CALLS_DISABLED"] = "1"  # belt and braces: nothing here may ever reach the gateway
    from fastapi.testclient import TestClient
    from app.main import app

    manifest = json.loads((FILES / "manifest.json").read_text())
    today = date.fromisoformat(manifest["today"])
    people = {c: {p["key"]: p for p in v} for c, v in manifest["people"].items()}
    db = sqlite3.connect(f"file:{Path(args.db).resolve()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    out: dict = {}
    fails: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.setdefault("invariants", {})[name] = {"ok": bool(ok), "detail": detail}
        if not ok:
            fails.append(f"{name}: {detail}")

    by_sha = {d["sha256"]: d for d in manifest["documents"]}
    rows = [dict(r) for r in db.execute("SELECT * FROM document WHERE source_identity = 'seed-fixture'")]
    seeded = {r["sha256"]: r for r in rows}
    cid = {r["name"]: r["id"] for r in db.execute("SELECT id, name FROM company")}
    ckey_of = {cid[c["name"]]: c["key"] for c in manifest["companies"]}

    with TestClient(app) as client:
        def session(email: str, company_id: int | None = None) -> dict:
            h = {"Authorization": "Bearer " + client.post("/api/auth/dev-login", json={"email": email}).json()["token"]}
            if company_id and client.get("/api/auth/me", headers=h).json()["company"]["id"] != company_id:
                client.post("/api/auth/switch-company", json={"company_id": company_id}, headers=h)
            return h

        # ---- who can sign in as whom, and what each sees (first company)
        c0 = cid[manifest["companies"][0]["name"]]
        out["personas"] = {}
        for key, person in people["c0"].items():
            h = session(person["email"])
            me = client.get("/api/auth/me", headers=h).json()
            docs = client.get("/api/documents", headers=h).json()
            out["personas"][key] = {"name": me["user"]["name"], "role": me["role"], "company": me["company"]["name"], "documents": len(docs)}
        owner = session(people["c0"]["owner"]["email"])
        companies = client.get("/api/auth/companies", headers=owner).json()
        out["switcher"] = [(c["name"], c.get("group_name")) for c in companies if c["name"] in {x["name"] for x in manifest["companies"]}]

        # ---- the list the Company Files page loads: how long and how big
        timings, size = [], 0
        for _ in range(5):
            t = time.perf_counter()
            r = client.get("/api/documents", headers=owner)
            timings.append((time.perf_counter() - t) * 1000)
            size = len(r.content)
        listed = r.json()
        out["list"] = {"documents": len(listed), "bytes": size, "ms_median": round(statistics.median(timings), 1), "ms_max": round(max(timings), 1)}

        # ---- search by a recurring vendor, the word cloud, the checklist, History
        hits = client.get("/api/search", params={"q": "Golden Ladle"}, headers=owner).json()
        years = sorted({h["received_at"][:4] for h in hits})
        out["search"] = {"query": "Golden Ladle", "hits": len(hits), "years": years}
        cloud = client.get("/api/search/terms", headers=owner).json()
        out["wordcloud"] = {"terms": len(cloud), "top": [(t["term"], t["count"]) for t in cloud[:6]]}
        out["checklist"] = {}
        for c in manifest["companies"]:
            h = session(people[c["key"]]["owner"]["email"], cid[c["name"]])
            exp = client.get("/api/expectations", headers=h).json()
            items = exp if isinstance(exp, list) else exp.get("items", exp.get("expectations", []))
            statuses = [i["status"] for i in items]
            out["checklist"][c["key"]] = {"satisfied": statuses.count("satisfied"), "missing": statuses.count("missing"), "rows": len(statuses)}
        edited = db.execute("SELECT DISTINCT d.id FROM document d JOIN document_activity a ON a.lifecycle_id = d.lifecycle_id WHERE a.action = 'edited' "
                            "AND d.company_id = ?", (c0,)).fetchall()
        actors, samples, titles = set(), [], set()
        for e in edited:
            entries = client.get(f"/api/documents/{e['id']}/history", headers=owner).json()["entries"]
            actors.update(x["actor_name"] for x in entries)
            samples.append([f"{x['action']} by {x['actor_name']}" + (f" ({x['actor_title']})" if x.get("actor_title") else "") for x in entries])
            titles.update(x.get("actor_title") for x in entries)
        out["history"] = {"distinct_actors": sorted(a for a in actors if a), "edited_documents": len(edited), "sample": samples[:3],
                          "titles_shown": sorted(t for t in titles if t)}
        summary = client.get("/api/documents", headers=owner).json()
        out["history"]["purge_requested_visible_to_owner"] = sum(1 for d in summary if d.get("status") == "purge_requested")

        # ---- a viewer cannot see Only me files (in the list or by id)
        viewer = session(people["c0"]["viewer"]["email"])
        vdocs = client.get("/api/documents", headers=viewer).json()
        personal = [r for r in rows if r["visibility"] == "only_me"]
        check("viewer_cannot_see_only_me", not any(d["id"] in {p_["id"] for p_ in personal} for d in vdocs) and
              all(client.get(f"/api/documents/{p_['id']}/history", headers=viewer).status_code == 404 for p_ in personal), "list and history by id")
        odocs = client.get("/api/documents", headers=owner).json()
        seeded_photos = [r for r in rows if r["lane"] == "memory" and r["doc_type"] == "photo" and r["visibility"] == "company"]
        problems = photo_date_problems(seeded_photos, by_sha, odocs)
        check("every_seeded_photo_has_an_exif_picture_date", bool(seeded_photos) and not problems,
              "; ".join(problems) or f"{len(seeded_photos)} photos: EXIF in the file = occurred_on = the list's occurred_on")
        check("owner_sees_own_only_me_not_in_company_files", True, f"{len([d for d in odocs if d['id'] in {p_['id'] for p_ in personal}])} shown in the company list")

    # ---- seasonal windows, first company, both date bases (mirrors web/src/features/ops/documentDates.ts: upload day in the company's
    #      timezone, Asia/Singapore = UTC+8; and occurred_on)
    live = [r for r in rows if r["company_id"] == c0 and r["visibility"] == "company" and r["status"] == "filed"]
    cluster_of = lambda r: by_sha[r["sha256"]]["cluster"]  # noqa: E731
    up_day = lambda r: (date.fromisoformat(r["received_at"][:10]) + timedelta(days=1)) if r["received_at"][11:13] >= "16" else date.fromisoformat(r["received_at"][:10])  # noqa: E731
    doc_day = lambda r: date.fromisoformat(r["occurred_on"]) if r["occurred_on"] else None  # noqa: E731

    def window(name: str, lo: date, hi: date, cluster: str, need: int, **kw) -> dict | None:
        if lo > today:
            return None
        both = {}
        for basis, dayf in (("upload", up_day), ("document", doc_day)):
            inside = [r for r in live if dayf(r) and lo <= dayf(r) <= hi]
            mine = [r for r in inside if cluster_of(r) == cluster and (not kw.get("themed") or kw["themed"](r))]
            both[basis] = (len(mine), len(inside), len([r for r in inside if cluster_of(r) == "base"]))
        return {"window": name, "from": lo.isoformat(), "to": hi.isoformat(), "need": need, "cluster": cluster,
                "upload": both["upload"][:2], "document": both["document"][:2],
                "ok": all(v[0] >= need for v in both.values()), "share": min(both[b][0] / both[b][1] for b in both if both[b][1]),
                # scattered ordinary documents (cluster "base") in the window under the worse basis: do they drown the cluster?
                "base": max(both[b][2] for b in both), "drowned": any(both[b][2] >= both[b][0] for b in both)}

    table: list[dict] = []
    for y, s in manifest_holidays(manifest).get("cny", {}).items():
        if 2018 <= y <= 2026:
            table.append(window(f"CNY {y}", date.fromisoformat(s) - timedelta(days=35), date.fromisoformat(s), "cny", 3))
    for fy in range(2016, 2026):
        fye = date(fy, 12, 31)
        table.append(window(f"AGM + annual return FY{fy}", fye + timedelta(days=120), fye + timedelta(days=225), "agm", 2))
        table.append(window(f"Auditor letter FY{fy}", fye - timedelta(days=60), fye, "agm", 1))
    for y in range(2017, 2027):
        for m in (3, 6, 9, 12):
            end = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
            table.append(window(f"GST quarter ended {end.isoformat()}", end + timedelta(days=1), end + timedelta(days=34), "gst", 1))
    for y in range(2017, 2026):
        table.append(window(f"Year-end {y}", date(y, 11, 25), date(y, 12, 31), "yearend", 2))
    for y, s in manifest_holidays(manifest).get("raya", {}).items():
        table.append(window(f"Hari Raya {y}", date.fromisoformat(s) - timedelta(days=35), date.fromisoformat(s), "festival", 2))
    for y, s in manifest_holidays(manifest).get("deepavali", {}).items():
        table.append(window(f"Deepavali {y}", date.fromisoformat(s) - timedelta(days=35), date.fromisoformat(s), "festival", 1))
    table = [t for t in table if t]
    out["seasonal"] = table
    out["seasonal_summary"] = {"windows": len(table), "failing": [t["window"] for t in table if not t["ok"]],
                               "min_cluster_share": round(min(t["share"] for t in table), 2), "median_cluster_share": round(statistics.median(t["share"] for t in table), 2),
                               "windows_where_scattered_docs_drown_the_cluster": [t["window"] for t in table if t["drowned"]],
                               "max_scattered_docs_in_any_window": max(t["base"] for t in table),
                               "median_scattered_docs_per_window": statistics.median(t["base"] for t in table)}

    # ---- invariants over every seeded document
    # A seeded PDF may have been re-rendered in place by scripts/beautify_invoices.py, which leaves the sha256 and bytes columns alone on purpose
    # (DECISIONS #142). Its bytes then differ from the recorded hash; it is accepted only when its words are the stored text's words (the same
    # word-for-word check the script applies), so a corrupted or swapped file still fails.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from beautify_invoices import verify_render

    def file_state(r) -> str:
        f = Path(args.docs_dir) / Path(r["stored_path"]).name
        if not f.exists():
            return "missing"
        if hashlib.sha256(f.read_bytes()).hexdigest() == r["sha256"]:
            return "same"
        return "rerendered" if f.suffix.lower() == ".pdf" and verify_render(str(f), r["extracted_text"] or "") is None else "different"

    states = [file_state(r) for r in rows]
    files_ok = all(st in ("same", "rerendered") for st in states)
    check("every_seeded_file_exists_and_its_hash_matches", files_ok,
          f"{len(rows)} documents" + (f", {states.count('rerendered')} re-rendered by beautify_invoices with the same words" if "rerendered" in states else ""))
    check("every_manifest_document_was_seeded", set(seeded) == set(by_sha), f"{len(seeded)} of {len(by_sha)}")
    check("no_shared_sha256", len({r['sha256'] for r in rows}) == len(rows))
    incomplete = [r["filename"] for r in rows if r["visibility"] == "company" and r["lane"] != "memory" and not (r["description"] and r["bucket"] and r["vendor_name"])]
    check("no_company_document_lacks_description_bucket_vendor", not incomplete, str(incomplete[:3]))
    check("no_seeded_review_item", db.execute("SELECT COUNT(*) FROM review_item r JOIN document d ON d.id = r.document_id WHERE d.source_identity = 'seed-fixture'").fetchone()[0] == 0)
    check("every_seeded_row_identifies_as_a_fixture", all(r["source_identity"] == "seed-fixture" for r in rows) and
          db.execute("SELECT COUNT(*) FROM extraction e JOIN document d ON d.id = e.document_id WHERE d.source_identity = 'seed-fixture' AND e.extractor_version != 'seed-fixture-v1'").fetchone()[0] == 0)
    inc = {ckey_of[r["id"]]: date.fromisoformat(r["incorporated_on"]) for r in db.execute("SELECT id, incorporated_on FROM company") if r["id"] in ckey_of}
    early = [r["filename"] for r in rows if date.fromisoformat(r["received_at"][:10]) < inc[ckey_of[r["company_id"]]] or
             (r["occurred_on"] and date.fromisoformat(r["occurred_on"]) < inc[ckey_of[r["company_id"]]])]
    check("no_document_dated_before_incorporation", not early, str(early[:3]))
    future = [r["filename"] for r in rows if date.fromisoformat(r["received_at"][:10]) > today]
    check("no_document_dated_after_today", not future, str(future[:3]))
    bad_gst, bad_text = [], []
    for sha, d in by_sha.items():
        inv = d.get("invoice")
        if not inv:
            continue
        exp_tax = round(inv["subtotal"] * gst_rate(date.fromisoformat(d["occurred_on"])) + 1e-9, 2) if inv["gst_registered"] else 0.0
        if inv["tax"] != exp_tax or round(inv["subtotal"] + inv["tax"], 2) != inv["total"]:
            bad_gst.append(d["file"])
        text = seeded[sha]["extracted_text"] or ""
        if inv["no"] not in text or f"{inv['total']:,.2f}" not in text:
            bad_text.append(d["file"])
        stored = {r["field"]: json.loads(r["value_text"]) for r in db.execute("SELECT field, value_text FROM extraction WHERE document_id = ?", (seeded[sha]["id"],))}
        if stored.get("total") != inv["total"] or stored.get("tax") != inv["tax"]:
            bad_text.append(d["file"] + " (extraction)")
    check("gst_arithmetic_correct_for_the_date", not bad_gst, str(bad_gst[:3]))
    check("extracted_text_says_what_the_file_says", not bad_text, str(bad_text[:3]))
    check("every_seeded_upload_has_an_uploaded_event_by_its_uploader", db.execute(
        "SELECT COUNT(*) FROM document d WHERE d.source_identity = 'seed-fixture' AND NOT EXISTS (SELECT 1 FROM document_activity a WHERE a.lifecycle_id = d.lifecycle_id "
        "AND a.action = 'uploaded' AND a.actor_user_id = d.uploaded_by_user_id)").fetchone()[0] == 0)
    early_events = db.execute(
        "SELECT COUNT(*) FROM document_activity e JOIN document_activity u ON u.lifecycle_id = e.lifecycle_id AND u.action = 'uploaded' "
        "WHERE e.action != 'uploaded' AND e.at < u.at").fetchone()[0]
    check("no_history_event_precedes_its_documents_upload", early_events == 0, f"{early_events} event(s) dated before the upload")
    order = db.execute(
        "SELECT COUNT(*) FROM document_activity c JOIN document_activity r ON r.lifecycle_id = c.lifecycle_id AND r.action = 'purge_requested' "
        "WHERE c.action = 'purge_cancelled' AND c.at < r.at").fetchone()[0]
    check("a_purge_is_never_cancelled_before_it_was_requested", order == 0)
    # ---- the Corp Sec is STRICTLY VIEW-ONLY (S1c): a viewer performs no action, so the data must not show one acting
    corp = db.execute("SELECT c.name, u.email, m.role FROM membership m JOIN company c ON c.id = m.company_id JOIN app_user u ON u.id = m.user_id WHERE m.title = 'Corp Sec'").fetchall()
    check("every_corp_sec_has_role_viewer_in_all_three_companies", len(corp) == 3 and all(r["role"] == "viewer" for r in corp),
          str([(r["name"], r["email"], r["role"]) for r in corp]))
    acting_viewers = db.execute(
        "SELECT COUNT(*) FROM document_activity a JOIN membership m ON m.user_id = a.actor_user_id AND m.company_id = a.company_id WHERE m.role = 'viewer'").fetchone()[0]
    check("no_history_row_has_a_viewer_as_its_actor", acting_viewers == 0, f"{acting_viewers} row(s)")
    uploaded_by_viewer = db.execute(
        "SELECT COUNT(*) FROM document d JOIN membership m ON m.user_id = d.uploaded_by_user_id AND m.company_id = d.company_id WHERE m.role = 'viewer'").fetchone()[0]
    check("no_document_is_uploaded_by_a_viewer", uploaded_by_viewer == 0, f"{uploaded_by_viewer} document(s)")
    picker_cfg = manifest["picker"]                                     # [{email, role}] in the order the picker shows them
    picker_emails = [x["email"] for x in picker_cfg]
    held = {r["email"]: (r["role"], r["title"]) for r in db.execute(
        "SELECT u.email, m.role, m.title FROM membership m JOIN app_user u ON u.id = m.user_id WHERE m.company_id = ?", (c0,))}
    ts_emails = re.findall(r"'([a-z_]+@try-demo\.test)'", (REPO / "web" / "src" / "config" / "demo.ts").read_text())
    check("the_login_picker_config_lists_exactly_the_four_manifest_logins_in_order", ts_emails == picker_emails and len(ts_emails) == 4, str(ts_emails))
    check("the_four_picker_logins_hold_owner_admin_admin_viewer_in_the_first_company",
          [held.get(e, (None,))[0] for e in picker_emails] == ["owner", "admin", "admin", "viewer"] and [x["role"] for x in picker_cfg] == ["owner", "admin", "admin", "viewer"],
          str([(e, held.get(e)) for e in picker_emails]))
    check("the_pickers_last_login_is_the_corp_sec_and_no_other_picker_login_is",
          held.get(picker_emails[-1]) == ("viewer", "Corp Sec") and not any(held.get(e, (None, None))[1] == "Corp Sec" for e in picker_emails[:-1]), str([(e, held.get(e)) for e in picker_emails]))
    demo_ids = tuple(cid_ for cid_ in (cid[c["name"]] for c in manifest["companies"]))
    role_user = db.execute(f"SELECT COUNT(*) FROM membership WHERE role = 'user' AND company_id IN ({','.join('?' * len(demo_ids))})", demo_ids).fetchone()[0]
    check("no_membership_with_app_role_user_in_the_three_demo_companies", role_user == 0, f"{role_user} membership(s)")
    for gone in manifest["dropped"]:
        left = (db.execute("SELECT COUNT(*) FROM app_user WHERE email = ? OR name = ?", (gone["email"], gone["name"])).fetchone()[0]
                + db.execute("SELECT COUNT(*) FROM document_activity WHERE actor_name = ?", (gone["name"],)).fetchone()[0]
                + db.execute("SELECT COUNT(*) FROM membership m JOIN app_user u ON u.id = m.user_id WHERE u.name = ?", (gone["name"],)).fetchone()[0])
        check(f"{gone['name'].split()[0].lower()}_is_dropped_entirely_no_person_no_membership_no_history_row", left == 0, f"{left} trace(s)")
    aud = db.execute("SELECT m.role, m.title, u.email FROM membership m JOIN app_user u ON u.id = m.user_id WHERE u.name = 'Marcus Lee Kok Wai' AND m.company_id = ?", (c0,)).fetchone()
    check("the_external_auditor_is_a_non_picker_viewer_who_acts_nowhere", bool(aud) and aud["role"] == "viewer" and aud["title"] == "External Auditor" and not aud["email"].endswith("@try-demo.test")
          and db.execute("SELECT COUNT(*) FROM document_activity WHERE actor_name = 'Marcus Lee Kok Wai'").fetchone()[0] == 0, str(dict(aud) if aud else None))
    check("no_trace_row_pretends_to_be_a_model_call", db.execute("SELECT COUNT(*) FROM trace t JOIN document d ON d.id = t.document_id WHERE d.source_identity = 'seed-fixture' AND t.model IS NOT NULL").fetchone()[0] == 0)

    out["ok"] = not fails
    out["failures"] = fails
    if args.json:
        print(json.dumps(out, default=str))
    else:
        print(json.dumps({k: v for k, v in out.items() if k not in ("seasonal", "invariants")}, indent=1, default=str))
        print("\nseasonal windows (first company, both bases: [cluster docs, all live company docs in the window]):")
        for t in out["seasonal"]:
            print(f"  {'ok ' if t['ok'] else 'FAIL'} {t['window']:<38} need>={t['need']}  upload {t['upload']}  document {t['document']}")
        print("\ninvariants:")
        for n, v in out["invariants"].items():
            print(f"  {'ok  ' if v['ok'] else 'FAIL'} {n} {v['detail']}")
    return 0 if out["ok"] else 1


def manifest_holidays(manifest: dict) -> dict:
    """The holiday dates the generator used, as the manifest carries them (JSON keys are strings)."""
    return {k: {int(y): s for y, s in v.items()} for k, v in manifest["holidays"].items()}


if __name__ == "__main__":
    sys.exit(main())
