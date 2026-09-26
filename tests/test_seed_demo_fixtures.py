"""The no-gateway demo seeder (round 7, item S1, DECISIONS #133): scripts/generate_seed_files.py, scripts/seed_demo_fixtures.py and
scripts/verify_seed_fixtures.py.

The seeder and the verifier run in SUBPROCESSES against a temporary database: app.db, ingest and the thumbnail cache read their paths once,
at import, and this test session already fixed them to tests/_test.db. Nothing here can reach the gateway: the seeder refuses unless calls
are switched off, and every subprocess also runs with the switch on and no API key."""

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).parent.parent
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO))

import seed_demo_fixtures  # noqa: E402  (module level imports only the standard library, no app code)

FILES = REPO / "evals" / "seed_files"
MANIFEST = json.loads((FILES / "manifest.json").read_text())


def _env(**extra) -> dict:
    env = {**os.environ, "LLM_GATEWAY_API_KEY": "", "PYTHONWARNINGS": "ignore"}
    env.pop("LLM_CALLS_DISABLED", None)
    env.update(extra)
    return env


def _run(script: str, *args: str, env: dict | None = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(REPO / "scripts" / script), *args], capture_output=True, text=True, env=env or _env(), timeout=timeout, cwd=REPO)


def _counts(db: Path) -> dict:
    con = sqlite3.connect(db)
    try:
        return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in seed_demo_fixtures.COUNT_TABLES}
    finally:
        con.close()


@pytest.fixture(scope="module")
def seeded(tmp_path_factory):
    root = tmp_path_factory.mktemp("seed")
    db, docs = root / "jaga.db", root / "docs"
    first = _run("seed_demo_fixtures.py", "--db", str(db), "--docs-dir", str(docs), env=_env(LLM_CALLS_DISABLED="1"))
    assert first.returncode == 0, first.stdout[-2000:] + first.stderr[-2000:]
    after_first = _counts(db)
    second = _run("seed_demo_fixtures.py", "--db", str(db), "--docs-dir", str(docs), env=_env(LLM_CALLS_DISABLED="1"))
    assert second.returncode == 0, second.stdout[-2000:] + second.stderr[-2000:]
    con = sqlite3.connect(db)
    sessions_left = con.execute("SELECT COUNT(*) FROM session").fetchone()[0]  # counted BEFORE the verifier signs in (it makes its own)
    con.close()
    after_second = _counts(db)
    verify = _run("verify_seed_fixtures.py", "--db", str(db), "--docs-dir", str(docs), "--json", env=_env())
    line = next(l for l in verify.stdout.splitlines() if l.startswith("{"))
    return {"db": db, "docs": docs, "first": first, "second": second, "after_first": after_first, "after_second": after_second,
            "sessions_left": sessions_left, "report": json.loads(line)}


# ---------------------------------------------------------------- refusals


def _args(*argv: str):
    return seed_demo_fixtures.build_parser().parse_args(list(argv))


def test_it_refuses_unless_gateway_calls_are_switched_off():
    reasons = seed_demo_fixtures.refusals(_args("--db", "/tmp/x.db", "--docs-dir", "/tmp/d"), calls_disabled=False)
    assert len(reasons) == 1 and "LLM_CALLS_DISABLED=1" in reasons[0]


def test_it_refuses_a_live_target_and_says_how_to_override_it():
    reasons = seed_demo_fixtures.refusals(_args("--db", "/opt/jaga/backend/data/jaga.db", "--docs-dir", "/tmp/d"), calls_disabled=True)
    assert len(reasons) == 1 and "LIVE" in reasons[0] and "--allow-live-target" in reasons[0]


def test_a_live_target_is_allowed_only_when_asked_for_by_name():
    args = _args("--db", "/opt/jaga/backend/data/jaga.db", "--docs-dir", "/tmp/d", "--allow-live-target")
    assert seed_demo_fixtures.refusals(args, calls_disabled=True) == []


def test_it_refuses_when_the_manifest_is_missing(tmp_path):
    reasons = seed_demo_fixtures.refusals(_args("--db", "/tmp/x.db", "--docs-dir", "/tmp/d", "--files-dir", str(tmp_path)), calls_disabled=True)
    assert len(reasons) == 1 and "generate_seed_files.py" in reasons[0]


def test_the_database_and_the_documents_folder_are_required_with_no_default():
    result = _run("seed_demo_fixtures.py", env=_env(LLM_CALLS_DISABLED="1"))
    assert result.returncode == 2 and "--db" in result.stderr and "--docs-dir" in result.stderr


def test_a_run_without_the_switch_exits_2_and_creates_nothing(tmp_path):
    db = tmp_path / "jaga.db"
    result = _run("seed_demo_fixtures.py", "--db", str(db), "--docs-dir", str(tmp_path / "docs"), env=_env(LLM_CALLS_DISABLED="0"))
    assert result.returncode == 2 and "LLM_CALLS_DISABLED=1" in result.stderr
    assert not db.exists() and not (tmp_path / "docs").exists()


def test_a_run_against_a_live_path_exits_2_even_with_the_switch_on(tmp_path):
    result = _run("seed_demo_fixtures.py", "--db", "/opt/jaga/backend/data/jaga.db", "--docs-dir", str(tmp_path / "docs"), env=_env(LLM_CALLS_DISABLED="1"))
    assert result.returncode == 2 and "LIVE" in result.stderr and not (tmp_path / "docs").exists()


def test_the_seeder_never_calls_the_model_by_construction():
    import ast

    source = (REPO / "scripts" / "seed_demo_fixtures.py").read_text()
    tree = ast.parse(source)
    imported = [(n.module, a.name) for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and (n.module or "").startswith("app.llm") for a in n.names]
    assert imported == [("app.llm", "calls_disabled")]  # the one function that only reads the environment
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "call"]
    assert calls == []  # nothing calls anything named .call( at all
    assert "llm._client = _no_client" in source  # a stray call could not even construct a client


# ---------------------------------------------------------------- the committed fixtures


def test_every_committed_fixture_exists_and_its_hash_is_the_manifests_and_no_two_share_bytes():
    shas = []
    for d in MANIFEST["documents"]:
        data = (FILES / d["file"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == d["sha256"], d["file"]
        shas.append(d["sha256"])
    assert len(shas) == len(set(shas))


def test_the_sizing_stays_inside_the_briefs_limits():
    by_company = {}
    for d in MANIFEST["documents"]:
        by_company[d["company"]] = by_company.get(d["company"], 0) + 1
    assert len(MANIFEST["documents"]) <= 320 and by_company["c0"] <= 205, by_company
    assert sum((FILES / d["file"]).stat().st_size for d in MANIFEST["documents"]) < 3 * 1024 * 1024


def test_every_document_carries_the_fixture_line_or_is_a_picture():
    for d in MANIFEST["documents"]:
        if d["media"] == "pdf":
            assert b"SYNTHETIC SEED FIXTURE" in _pdf_text(FILES / d["file"]), d["file"]


def _pdf_text(path: Path) -> bytes:
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages).encode()


# ---------------------------------------------------------------- what the seeder built


def test_it_ran_clean_printed_the_row_counts_and_made_no_model_call(seeded):
    out = seeded["first"].stdout
    assert "before" in out and "after" in out and "document" in out
    assert "LLM_USAGE" not in out + seeded["first"].stderr
    assert seeded["report"]["ok"] is True, seeded["report"]["failures"]


def test_a_second_run_changes_nothing(seeded):
    assert seeded["after_second"] == seeded["after_first"]
    assert "'ingested': 0" in seeded["second"].stdout


def test_row_counts_match_the_manifest(seeded):
    c = seeded["after_first"]
    assert c["document"] == len(MANIFEST["documents"]) and c["company"] == 3 and c["company_group"] == 1
    assert c["review_item"] == 0 and c["event"] == len(MANIFEST["events"])


def test_the_three_companies_and_the_group_have_their_new_names_and_no_old_ones(seeded):
    con = sqlite3.connect(seeded["db"])
    names = {r[0] for r in con.execute("SELECT name FROM company")}
    assert names == {c["name"] for c in MANIFEST["companies"]}
    assert [r[0] for r in con.execute("SELECT name FROM company_group")] == [MANIFEST["group"]]
    assert not any("Try Demo" in n for n in names)
    assert all(r[0] is None for r in con.execute("SELECT uen FROM company"))  # an invented UEN could collide with a real one
    inc = dict(con.execute("SELECT name, incorporated_on FROM company").fetchall())
    assert inc == {c["name"]: c["incorporated_on"] for c in MANIFEST["companies"]}
    gst = dict(con.execute("SELECT name, gst_registered FROM company").fetchall())
    assert gst == {c["name"]: int(c["gst_registered"]) for c in MANIFEST["companies"]}


def test_the_six_picker_logins_are_named_people_of_the_first_company(seeded):
    personas = seeded["report"]["personas"]
    assert {k: (v["name"], v["role"]) for k, v in personas.items()} == {
        p["key"]: (p["name"], p["role"]) for p in MANIFEST["people"]["c0"]}
    assert all(v["company"] == MANIFEST["companies"][0]["name"] for v in personas.values())
    assert not any("Demo" in v["name"] for v in personas.values())


def test_the_corp_sec_is_strictly_view_only_everywhere_and_the_auditor_is_a_non_picker_viewer(seeded):
    """S1c (the user's ruling): every Corp Sec holds app role viewer, no viewer acts anywhere in the data, the picker's viewer login is the
    Company Secretary, the other five picker logins keep their roles and none is a Corp Sec, and the External Auditor is a non-picker viewer."""
    inv = seeded["report"]["invariants"]
    for name in ("every_corp_sec_has_role_viewer_in_all_three_companies", "no_history_row_has_a_viewer_as_its_actor", "no_document_is_uploaded_by_a_viewer",
                 "the_pickers_last_login_is_the_corp_sec_and_no_other_picker_login_is", "the_four_picker_logins_hold_owner_admin_admin_viewer_in_the_first_company",
                 "the_external_auditor_is_a_non_picker_viewer_who_acts_nowhere"):
        assert inv[name]["ok"], (name, inv[name]["detail"])
    con = sqlite3.connect(seeded["db"])
    assert con.execute("SELECT COUNT(*) FROM membership WHERE title = 'Corp Sec'").fetchone()[0] == 3
    roles = {p["email"]: p["role"] for k in MANIFEST["people"] for p in MANIFEST["people"][k]}
    assert all(roles[p["email"]] == "viewer" for k in MANIFEST["people"] for p in MANIFEST["people"][k] if p["title"] == "Corp Sec")
    assert not any(d["uploader"] in ("viewer", "auditor", "corpsec") for d in MANIFEST["documents"])          # in the manifest itself, in all three companies


def test_demo_people_says_the_ruling_and_no_longer_justifies_a_corp_sec_user():
    text = (REPO / "docs" / "DEMO-PEOPLE.md").read_text()
    assert "STRICTLY VIEW-ONLY" in text and "Why the Company Secretary is app role `user`" not in text
    for p in (q for k in MANIFEST["people"] for q in MANIFEST["people"][k]):
        assert p["name"] in text and p["email"] in text
    assert text.count("non-picker") >= 4


def test_the_owners_switcher_lists_all_three_under_the_new_names_and_the_group(seeded):
    assert {tuple(x) for x in seeded["report"]["switcher"]} == {(c["name"], MANIFEST["group"]) for c in MANIFEST["companies"]}


def test_the_recurring_vendor_is_found_by_search_in_at_least_five_different_years(seeded):
    assert len(seeded["report"]["search"]["years"]) >= 5 and seeded["report"]["search"]["hits"] >= 8


def test_the_word_cloud_returns_words_and_the_checklist_is_a_mix_for_every_company(seeded):
    assert seeded["report"]["wordcloud"]["terms"] >= 20
    for key, row in seeded["report"]["checklist"].items():
        assert row["satisfied"] >= 1 and row["missing"] >= 1, (key, row)


def test_history_has_varied_actors_and_a_pending_purge_request(seeded):
    h = seeded["report"]["history"]
    assert len(h["distinct_actors"]) >= 3 and h["edited_documents"] >= 3 and h["purge_requested_visible_to_owner"] == 1
    con = sqlite3.connect(seeded["db"])
    kinds = dict(con.execute("SELECT action, COUNT(*) FROM document_activity GROUP BY action").fetchall())
    assert kinds["uploaded"] == len(MANIFEST["documents"]) and kinds["edited"] >= 5 and kinds["purge_requested"] == 2 and kinds["purge_cancelled"] == 1
    others = con.execute(
        "SELECT COUNT(*) FROM document_activity e JOIN document_activity u ON u.lifecycle_id = e.lifecycle_id AND u.action = 'uploaded' "
        "WHERE e.action = 'edited' AND e.actor_user_id != u.actor_user_id").fetchone()[0]
    assert others >= 3  # at least three documents edited by someone other than the uploader
    cancelled = con.execute("SELECT d.status FROM document d JOIN document_activity a ON a.lifecycle_id = d.lifecycle_id WHERE a.action = 'purge_cancelled'").fetchone()[0]
    assert cancelled == "filed"  # restored


def test_no_history_event_is_dated_before_its_documents_upload_and_a_cancel_never_precedes_its_request(seeded):
    inv = seeded["report"]["invariants"]
    assert inv["no_history_event_precedes_its_documents_upload"]["ok"], inv["no_history_event_precedes_its_documents_upload"]["detail"]
    assert inv["a_purge_is_never_cancelled_before_it_was_requested"]["ok"]


def test_a_viewer_cannot_see_only_me_files(seeded):
    assert seeded["report"]["invariants"]["viewer_cannot_see_only_me"]["ok"]


def test_every_seasonal_window_of_the_first_company_holds_its_cluster_under_both_date_bases(seeded):
    """Thresholds: CNY >= 3 (each year 2018 to 2026, five weeks up to the day); AGM + annual return >= 2 and auditor letter >= 1 (around each
    December year end); GST >= 1 per quarter (a two-page return acknowledgement plus payment receipt); year-end >= 2; Hari Raya >= 2;
    Deepavali >= 1. Every window is counted by the upload day in the company's timezone AND by the document date."""
    rows = seeded["report"]["seasonal"]
    assert len(rows) >= 90
    assert [r["window"] for r in rows if not r["ok"]] == []
    assert {r["window"].split()[0] for r in rows} >= {"CNY", "AGM", "Auditor", "GST", "Year-end", "Hari", "Deepavali"}
    assert sum(1 for r in rows if r["window"].startswith("CNY")) == 9


def test_the_scattered_ordinary_documents_do_not_drown_the_seasons(seeded):
    s = seeded["report"]["seasonal_summary"]
    assert s["max_scattered_docs_in_any_window"] <= 2 and s["median_scattered_docs_per_window"] <= 1
    assert len(s["windows_where_scattered_docs_drown_the_cluster"]) <= 10 and s["median_cluster_share"] >= 0.4


def test_the_list_the_company_files_page_loads_is_small_and_fast(seeded):
    listing = seeded["report"]["list"]
    assert listing["documents"] >= 190 and listing["bytes"] < 400_000 and listing["ms_median"] < 500


def test_no_login_session_is_left_behind(seeded):
    assert seeded["sessions_left"] == 0


def test_thumbnails_were_pre_generated_for_the_seeded_pdfs(seeded):
    thumbs = Path(seeded["docs"]).parent / "thumbnails"
    assert len(list(thumbs.glob("*"))) >= 250


def test_every_person_holds_the_manifests_business_title_in_that_company_and_history_shows_it(seeded):
    """S3 (DECISIONS #136): the title comes from the same data docs/DEMO-PEOPLE.md is generated from, per company (membership.title)."""
    con = sqlite3.connect(seeded["db"])
    got = {(r[0], r[1]): r[2] for r in con.execute(
        "SELECT c.name, u.email, m.title FROM membership m JOIN company c ON c.id = m.company_id JOIN app_user u ON u.id = m.user_id")}
    for company in MANIFEST["companies"]:
        for person in MANIFEST["people"][company["key"]]:
            assert got[(company["name"], person["email"])] == person["title"], (company["name"], person["email"])
    assert got[("Tembusu Row Engineering Pte Ltd", "corpsec_rachel@try-demo.test")] == "Corp Sec"      # the picker's viewer login is the Company Secretary
    assert got[("Pasir Kelana Logistics Pte Ltd", "owner_priya@try-demo.test")] == "Group Managing Director"   # the same person, another title, another company
    titles = seeded["report"]["history"]["titles_shown"]
    assert titles and set(titles) <= {p["title"] for p in MANIFEST["people"]["c0"]}
    docs = (REPO / "docs" / "DEMO-PEOPLE.md").read_text()
    assert all(p["title"] in docs and p["email"] in docs for k in MANIFEST["people"] for p in MANIFEST["people"][k])


# ---------------------------------------------------------------- S1d: no `user` role in the demo story, four self-explanatory logins (DECISIONS #137)


def test_the_login_picker_is_exactly_the_four_manifest_logins_and_no_demo_membership_has_role_user(seeded):
    inv = seeded["report"]["invariants"]
    for name in ("the_login_picker_config_lists_exactly_the_four_manifest_logins_in_order", "the_four_picker_logins_hold_owner_admin_admin_viewer_in_the_first_company",
                 "no_membership_with_app_role_user_in_the_three_demo_companies", "kavitha_is_dropped_entirely_no_person_no_membership_no_history_row",
                 "alvin_is_dropped_entirely_no_person_no_membership_no_history_row"):
        assert inv[name]["ok"], (name, inv[name]["detail"])
    assert [(x["email"], x["role"]) for x in MANIFEST["picker"]] == [
        ("owner_priya@try-demo.test", "owner"), ("admin_jonathan@try-demo.test", "admin"), ("admin_aisyah@try-demo.test", "admin"), ("corpsec_rachel@try-demo.test", "viewer")]
    con = sqlite3.connect(seeded["db"])
    assert con.execute("SELECT COUNT(*) FROM membership WHERE role = 'user'").fetchone()[0] == 0
    assert con.execute("SELECT COUNT(*) FROM app_user WHERE name IN ('Kavitha Subramaniam', 'Alvin Sim Jun Hao')").fetchone()[0] == 0
    assert all(p["role"] != "user" for k in MANIFEST["people"] for p in MANIFEST["people"][k])


def test_every_company_has_an_owner_two_admins_and_a_corp_sec_who_is_a_viewer():
    for key, people in MANIFEST["people"].items():
        roles = [p["role"] for p in people if p["title"] != "External Auditor"]
        assert sorted(roles) == ["admin", "admin", "owner", "viewer"], (key, roles)
        assert [p["title"] for p in people if p["role"] == "viewer" and p["title"] == "Corp Sec"] == ["Corp Sec"]


def test_only_the_owner_and_the_admins_upload_and_no_one_carries_an_absurd_share():
    roles = {k: {p["key"]: p["role"] for p in v} for k, v in MANIFEST["people"].items()}
    assert {roles[d["company"]][d["uploader"]] for d in MANIFEST["documents"]} <= {"owner", "admin"}
    for company in ("c0", "c1", "c2"):
        mine = [d["uploader"] for d in MANIFEST["documents"] if d["company"] == company]
        assert max(mine.count(u) for u in set(mine)) / len(mine) <= 0.6, company


def test_the_login_emails_in_the_frontend_config_are_the_ones_the_seeder_creates():
    import re
    emails = re.findall(r"'([a-z_]+@try-demo\.test)'", (REPO / "web" / "src" / "config" / "demo.ts").read_text())
    assert emails == [x["email"] for x in MANIFEST["picker"]]


def _legacy_shaped_copy(seeded, tmp_path_factory):
    """A database seeded BEFORE S1d, built by turning a fresh seed back into the old shape: the old picker emails, Aisyah/Ravi/Daniel as `user`,
    Kavitha and Alvin as members with documents, edits and a purge event attributed to them, a session for the owner, a stray member of a demo
    company, and an unrelated company that must not be touched."""
    import shutil
    root = tmp_path_factory.mktemp("legacy")
    db, docs = root / "jaga.db", root / "docs"
    shutil.copy(seeded["db"], db)
    shutil.copytree(seeded["docs"], docs)
    con = sqlite3.connect(db)
    one = lambda q, *a: con.execute(q, a).fetchone()[0]  # noqa: E731
    ids = {p["email"]: one("SELECT id FROM app_user WHERE email = ?", p["email"]) for k in MANIFEST["people"] for p in MANIFEST["people"][k]}
    for old, new in MANIFEST["legacy_emails"].items():
        con.execute("UPDATE app_user SET email = ? WHERE email = ?", (old, new))
    con.execute("UPDATE membership SET role = 'user' WHERE user_id IN (?, ?, ?)", (ids["admin_aisyah@try-demo.test"], ids["ravi.chandran@pasirkelana.test"], ids["daniel.chia@cendanawharf.test"]))
    c1 = one("SELECT id FROM company WHERE name = ?", MANIFEST["companies"][0]["name"])
    c2 = one("SELECT id FROM company WHERE name = ?", MANIFEST["companies"][1]["name"])
    kav = con.execute("INSERT INTO app_user (email, name) VALUES ('user1@try-demo.test', 'Kavitha Subramaniam')").lastrowid
    alv = con.execute("INSERT INTO app_user (email, name) VALUES ('user2@try-demo.test', 'Alvin Sim Jun Hao')").lastrowid
    stray = con.execute("INSERT INTO app_user (email, name) VALUES ('stray@else.test', 'Stray Person')").lastrowid
    for uid_, cid_, role in ((kav, c1, "user"), (alv, c1, "user"), (stray, c2, "admin")):
        con.execute("INSERT INTO membership (company_id, user_id, role) VALUES (?, ?, ?)", (cid_, uid_, role))
    other = con.execute("INSERT INTO company (name, fye_month, fye_day) VALUES ('Other Co', 12, 31)").lastrowid          # a company the seeder must never touch
    con.execute("INSERT INTO membership (company_id, user_id, role) VALUES (?, ?, 'viewer')", (other, stray))
    con.execute("INSERT INTO membership (company_id, user_id, role) VALUES (?, ?, 'user')", (other, kav))
    fixture = [r[0] for r in con.execute("SELECT id FROM document WHERE source_identity = 'seed-fixture' AND company_id = ? ORDER BY id LIMIT 6", (c1,))]
    for doc in fixture[:5]:
        con.execute("UPDATE document SET uploaded_by_user_id = ? WHERE id = ?", (kav, doc))
        con.execute("UPDATE document_activity SET actor_user_id = ?, actor_name = 'Kavitha Subramaniam' WHERE action = 'uploaded' AND lifecycle_id = (SELECT lifecycle_id FROM document WHERE id = ?)", (kav, doc))
    con.execute("UPDATE document_activity SET actor_user_id = ?, actor_name = 'Alvin Sim Jun Hao' WHERE id = (SELECT MIN(id) FROM document_activity WHERE action = 'edited')", (alv,))
    con.execute("UPDATE document_activity SET actor_user_id = ?, actor_name = 'Kavitha Subramaniam' WHERE id = (SELECT MIN(id) FROM document_activity WHERE action = 'purge_requested')", (kav,))
    con.execute("INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, uploaded_by_user_id) VALUES (?, ?, 'pre-existing.pdf', 'application/pdf', 1, '/x', 'web', ?)", (c1, "f" * 64, alv))  # a NON-fixture document Alvin uploaded
    con.execute("UPDATE document SET purge_requested_by = 'owner@try-demo.test' WHERE purge_requested_at IS NOT NULL")
    con.execute("INSERT INTO session (user_id, token_hash, expires_at) VALUES (?, 'legacy-token-hash', '2099-01-01 00:00:00')", (ids["owner_priya@try-demo.test"],))
    con.commit()
    con.close()
    return {"db": db, "docs": docs, "ids": ids, "kav": kav, "alv": alv, "stray": stray, "other": other, "c1": c1, "c2": c2}


@pytest.fixture(scope="module")
def migrated(seeded, tmp_path_factory):
    legacy = _legacy_shaped_copy(seeded, tmp_path_factory)
    run = _run("seed_demo_fixtures.py", "--db", str(legacy["db"]), "--docs-dir", str(legacy["docs"]), env=_env(LLM_CALLS_DISABLED="1"))
    assert run.returncode == 0, run.stdout[-2500:] + run.stderr[-2500:]
    after_first = _counts(legacy["db"])
    again = _run("seed_demo_fixtures.py", "--db", str(legacy["db"]), "--docs-dir", str(legacy["docs"]), env=_env(LLM_CALLS_DISABLED="1"))
    assert again.returncode == 0, again.stdout[-2500:] + again.stderr[-2500:]
    verify = _run("verify_seed_fixtures.py", "--db", str(legacy["db"]), "--docs-dir", str(legacy["docs"]), "--json", env=_env())
    line = next(l for l in verify.stdout.splitlines() if l.startswith("{"))
    return {**legacy, "run": run, "after_first": after_first, "after_second": _counts(legacy["db"]), "report": json.loads(line)}


def test_a_production_shaped_database_has_its_accounts_renamed_in_place_with_ids_and_sessions_kept(migrated):
    con = sqlite3.connect(migrated["db"])
    for old, new in MANIFEST["legacy_emails"].items():
        assert con.execute("SELECT COUNT(*) FROM app_user WHERE email = ?", (old,)).fetchone()[0] == 0, old
        assert con.execute("SELECT id FROM app_user WHERE email = ?", (new,)).fetchone()[0] == migrated["ids"][new], new     # the SAME user id
    assert con.execute("SELECT COUNT(*) FROM session WHERE token_hash = 'legacy-token-hash'").fetchone()[0] == 1              # the owner's session survived the rename
    assert "renamed owner@try-demo.test -> owner_priya@try-demo.test" in migrated["run"].stdout


def test_on_that_database_no_demo_membership_holds_the_user_role_and_the_admins_were_re_roled(migrated):
    con = sqlite3.connect(migrated["db"])
    demo = [r[0] for r in con.execute("SELECT id FROM company WHERE name IN (?, ?, ?)", tuple(c["name"] for c in MANIFEST["companies"]))]
    assert con.execute(f"SELECT COUNT(*) FROM membership WHERE role = 'user' AND company_id IN ({','.join('?' * len(demo))})", demo).fetchone()[0] == 0
    for email in ("admin_aisyah@try-demo.test", "ravi.chandran@pasirkelana.test", "daniel.chia@cendanawharf.test"):
        assert con.execute("SELECT m.role FROM membership m JOIN app_user u ON u.id = m.user_id WHERE u.email = ?", (email,)).fetchone()[0] == "admin", email
    assert migrated["report"]["invariants"]["no_membership_with_app_role_user_in_the_three_demo_companies"]["ok"]


def test_kavitha_alvin_and_a_stray_member_lose_their_demo_membership_and_nothing_else_is_touched(migrated):
    con = sqlite3.connect(migrated["db"])
    member = lambda uid, cid: con.execute("SELECT role FROM membership WHERE user_id = ? AND company_id = ?", (uid, cid)).fetchone()  # noqa: E731
    assert member(migrated["kav"], migrated["c1"]) is None and member(migrated["alv"], migrated["c1"]) is None and member(migrated["stray"], migrated["c2"]) is None
    assert member(migrated["stray"], migrated["other"]) == ("viewer",) and member(migrated["kav"], migrated["other"]) == ("user",)     # the unrelated company is untouched
    assert con.execute("SELECT COUNT(*) FROM membership WHERE company_id = ?", (migrated["other"],)).fetchone()[0] == 2
    # Kavitha is still a member of the unrelated company, so her account stays; Alvin has a document nobody re-attributed, so his stays too
    assert con.execute("SELECT COUNT(*) FROM app_user WHERE id IN (?, ?)", (migrated["kav"], migrated["alv"])).fetchone()[0] == 2
    assert "kept the account of user2@try-demo.test" in migrated["run"].stdout


def test_fixture_documents_and_history_are_re_attributed_to_the_current_cast(migrated):
    con = sqlite3.connect(migrated["db"])
    # Fixture documents only: a pre-existing NON-fixture document Alvin uploaded (built into this database) is out of scope and keeps its own history row.
    left = con.execute("SELECT a.id, a.action, a.actor_name FROM document_activity a JOIN document d ON d.lifecycle_id = a.lifecycle_id "
                       "WHERE d.source_identity = 'seed-fixture' AND a.actor_name IN ('Kavitha Subramaniam', 'Alvin Sim Jun Hao')").fetchall()
    assert left == [], left
    assert con.execute("SELECT COUNT(*) FROM document WHERE filename = 'pre-existing.pdf'").fetchone()[0] == 1          # and that document itself is not deleted
    assert con.execute("SELECT COUNT(*) FROM document WHERE uploaded_by_user_id IN (?, ?) AND source_identity = 'seed-fixture'", (migrated["kav"], migrated["alv"])).fetchone()[0] == 0
    mine = {d["sha256"]: d for d in MANIFEST["documents"]}
    people = {(k, p["key"]): p["email"] for k, v in MANIFEST["people"].items() for p in v}
    for sha, uploader in con.execute("SELECT d.sha256, u.email FROM document d JOIN app_user u ON u.id = d.uploaded_by_user_id WHERE d.source_identity = 'seed-fixture'"):
        d = mine[sha]
        assert uploader == people[(d["company"], d["uploader"])], d["file"]
    assert con.execute("SELECT COUNT(*) FROM document WHERE purge_requested_by = 'owner@try-demo.test'").fetchone()[0] == 0        # the text copy of the email followed the rename


def test_on_that_database_the_view_only_and_picker_invariants_hold_and_a_second_run_changes_nothing(migrated):
    inv = migrated["report"]["invariants"]
    for name in ("every_corp_sec_has_role_viewer_in_all_three_companies", "no_history_row_has_a_viewer_as_its_actor", "no_document_is_uploaded_by_a_viewer",
                 "the_pickers_last_login_is_the_corp_sec_and_no_other_picker_login_is", "the_four_picker_logins_hold_owner_admin_admin_viewer_in_the_first_company",
                 "the_login_picker_config_lists_exactly_the_four_manifest_logins_in_order", "the_external_auditor_is_a_non_picker_viewer_who_acts_nowhere"):
        assert inv[name]["ok"], (name, inv[name]["detail"])
    assert migrated["after_second"] == migrated["after_first"]
