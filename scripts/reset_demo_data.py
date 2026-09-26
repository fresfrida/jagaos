"""RESET the demo data to the exact clean seed (2026-09-24, DECISIONS #91). DESTRUCTIVE.

    python scripts/reset_demo_data.py                 # DRY RUN: prints exactly what would be wiped
    python scripts/reset_demo_data.py --apply         # wipes it, then re-seeds
    python scripts/reset_demo_data.py --apply --include-unrecognised

The clean seed is what scripts/seed_dev_db.py builds: the "Try Demo Holdings" group
holding "Try Demo Pte Ltd", "Try Demo Logistics Pte Ltd" and "Try Demo Trading Pte
Ltd", the owner plus five role accounts on the first company (admin, user, user1,
user2, viewer), and the eight demo-corpus PDFs uploaded to it (they land in the
review queue, as every upload does). seed_dev_db.py alone cannot restore that: it
skips whatever exists, so a deleted document or a changed role is never repaired.
So a reset is a WIPE of the demo scope followed by that same seed, not a second
seeding path.

THE SCOPE (nothing outside it is touched):
  - every company the demo owner (owner@try-demo.test) OWNS, with all their
    documents (rows, search rows, files on disk), events, obligations, checklist
    rows, review items, traces and memberships;
  - the group(s) those companies belonged to, once no company uses them;
  - the six demo accounts' rows are KEPT (names reset to the seed's, old sessions
    left alone); memberships they hold in companies OUTSIDE the scope are reported
    and left as they are.
A company the demo owner owns that does not carry a seeded name (renamed by a
business-profile pre-fill, or created later) is in the scope too, but the script
refuses to wipe it unless you add --include-unrecognised, after reading the plan.

HOW IT TOUCHES THE SERVER (why it must run where the server runs): the wipe is
direct SQL against the database this process resolves (JAGA_DB_PATH from .env,
relative to the current directory), and the re-seed goes through the RUNNING
server's HTTP API (JAGA_API_BASE_URL, default http://127.0.0.1:8000), because the
uploads run the real pipeline and their review state lives in the server's memory.
Those two must be the same database. The script proves it before deleting anything:
it asks the server which companies the demo owner owns and compares that with its
own database; a mismatch stops it with nothing changed. The re-seed calls the model
gateway (8 documents), so the server needs its LLM key, and the wording of the
descriptions can differ slightly from a previous seed.

On the Lightsail box that means: cd /opt/jaga/backend, as the `jaga` user, with the
venv (the exact commands are in docs/HANDOFF.md, "Maintenance scripts on the box"). Running it on a
laptop only ever resets the laptop's own database.

Exit code 0 done (or a clean dry run), 1 refused or failed (the message says what
state the database is in).
"""

import argparse
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))  # seed_dev_db and purge_document sit beside this file

import _live_guard  # noqa: E402
import purge_document  # noqa: E402  (loads .env before app.db is imported)
import seed_dev_db  # noqa: E402
from app import activity  # noqa: E402
from app.db import DB_PATH, get_conn  # noqa: E402
from app.thumbnails import remove_thumbnail  # noqa: E402

OWNER_EMAIL = seed_dev_db.OWNER_EMAIL
SEEDED_NAMES = {seed_dev_db.COMPANY_NAME, *(name for name, _, _ in seed_dev_db.SIBLING_COMPANIES)}
DEMO_ACCOUNTS = {seed_dev_db.OWNER_EMAIL: "Demo Owner", **{email: name for _, email, name in seed_dev_db.ROLE_ACCOUNTS}}
EXPECTED_ROLES = {seed_dev_db.OWNER_EMAIL: "owner", **{email: role for role, email, _ in seed_dev_db.ROLE_ACCOUNTS}}


class ResetRefused(Exception):
    """Nothing (more) was changed, and why."""


@dataclass
class WipePlan:
    companies: list[dict] = field(default_factory=list)
    recognised: list[dict] = field(default_factory=list)
    unrecognised: list[dict] = field(default_factory=list)
    document_ids: list[int] = field(default_factory=list)
    files: list[Path] = field(default_factory=list)
    other_members: list[str] = field(default_factory=list)
    outside_memberships: list[str] = field(default_factory=list)
    group_ids: list[int] = field(default_factory=list)


def _marks(ids: list[int]) -> str:
    return ",".join("?" * len(ids))


def plan_wipe(conn: sqlite3.Connection) -> WipePlan:
    """What the wipe would remove. Reads only."""
    plan = WipePlan()
    rows = conn.execute(
        "SELECT c.id, c.name, c.group_id FROM company c JOIN membership m ON m.company_id = c.id "
        "JOIN app_user u ON u.id = m.user_id WHERE u.email = ? AND m.role = 'owner' ORDER BY c.id",
        (OWNER_EMAIL,),
    ).fetchall()
    for row in rows:
        docs = conn.execute("SELECT id, stored_path FROM document WHERE company_id = ?", (row["id"],)).fetchall()
        company = {
            "id": row["id"], "name": row["name"], "group_id": row["group_id"], "documents": len(docs),
            "events": conn.execute("SELECT COUNT(*) FROM event WHERE company_id = ?", (row["id"],)).fetchone()[0],
            "obligations": conn.execute("SELECT COUNT(*) FROM obligation WHERE company_id = ?", (row["id"],)).fetchone()[0],
            "members": conn.execute("SELECT COUNT(*) FROM membership WHERE company_id = ?", (row["id"],)).fetchone()[0],
        }
        plan.companies.append(company)
        (plan.recognised if row["name"] in SEEDED_NAMES else plan.unrecognised).append(company)
        plan.document_ids += [d["id"] for d in docs]
        plan.files += [Path(d["stored_path"]) for d in docs]
        if row["group_id"] is not None and row["group_id"] not in plan.group_ids:
            plan.group_ids.append(row["group_id"])
    ids = [c["id"] for c in plan.companies]
    if ids:
        plan.other_members = [
            r["email"] for r in conn.execute(
                f"SELECT DISTINCT u.email FROM membership m JOIN app_user u ON u.id = m.user_id "
                f"WHERE m.company_id IN ({_marks(ids)}) ORDER BY u.email", ids)
            if r["email"] not in DEMO_ACCOUNTS
        ]
    emails = list(DEMO_ACCOUNTS)
    outside = conn.execute(
        f"SELECT u.email, m.role, c.id AS company_id, c.name FROM membership m JOIN app_user u ON u.id = m.user_id "
        f"JOIN company c ON c.id = m.company_id WHERE u.email IN ({_marks(emails)}) "
        + (f"AND c.id NOT IN ({_marks(ids)}) " if ids else "") + "ORDER BY u.email, c.id",
        emails + ids,
    ).fetchall()
    plan.outside_memberships = [f"{r['email']} is {r['role']} of company {r['company_id']} ({r['name']})" for r in outside]
    return plan


def describe(plan: WipePlan, seed_files: int) -> list[str]:
    lines = []
    if not plan.companies:
        lines.append("Nothing to wipe: the demo owner owns no company here (a fresh database).")
    for c in plan.companies:
        tag = "" if c["name"] in SEEDED_NAMES else "   <-- NOT a seeded name (renamed or created later)"
        lines.append(
            f"  wipe company {c['id']} '{c['name']}': {c['documents']} document(s), {c['events']} event(s), "
            f"{c['obligations']} obligation(s), {c['members']} membership(s){tag}"
        )
    if plan.group_ids:
        lines.append(f"  wipe group(s) {plan.group_ids} (only if no company outside the scope still uses them)")
    if plan.other_members:
        lines.append(f"  memberships of NON-demo accounts in these companies go with them: {', '.join(plan.other_members)}")
    for text in plan.outside_memberships:
        lines.append(f"  LEFT ALONE (outside the scope): {text}")
    lines.append(f"  then re-seed through the server: 3 companies in 'Try Demo Holdings', 6 accounts, {seed_files} corpus document(s)")
    return lines


def wipe(conn: sqlite3.Connection, plan: WipePlan) -> None:
    """Deletes the scope inside the caller's transaction. Every document goes through
    purge_document's own deletion (so the references it knows are cleared the same way,
    and a reference it does not know refuses the whole wipe); what is left at company
    level is then removed in dependency order. The caller commits; a foreign-key check at
    the end rolls the whole thing back rather than leave a dangling row."""
    conn.execute("PRAGMA secure_delete = ON")
    for document_id in plan.document_ids:
        purge_document.execute_purge(
            conn, purge_document.plan_purge(conn, document_id), activity.operator("system: reset_demo_data"),
        )
    ids = [c["id"] for c in plan.companies]
    if ids:
        m = _marks(ids)
        conn.execute(f"DELETE FROM trace WHERE company_id IN ({m})", ids)
        conn.execute(f"DELETE FROM notification WHERE obligation_id IN (SELECT id FROM obligation WHERE company_id IN ({m}))", ids)
        conn.execute(f"DELETE FROM review_item WHERE company_id IN ({m})", ids)
        conn.execute(f"DELETE FROM obligation WHERE company_id IN ({m})", ids)
        conn.execute(f"DELETE FROM expectation WHERE company_id IN ({m})", ids)
        conn.execute(f"DELETE FROM event WHERE company_id IN ({m})", ids)
        conn.execute(f"DELETE FROM membership WHERE company_id IN ({m})", ids)
        conn.execute(f"UPDATE session SET current_company_id = NULL WHERE current_company_id IN ({m})", ids)
        conn.execute(f"DELETE FROM company WHERE id IN ({m})", ids)
    for group_id in plan.group_ids:
        conn.execute(
            "DELETE FROM company_group WHERE id = ? AND NOT EXISTS (SELECT 1 FROM company WHERE group_id = ?)",
            (group_id, group_id),
        )
    for email, name in DEMO_ACCOUNTS.items():
        conn.execute("UPDATE app_user SET name = ? WHERE email = ?", (name, email))
    dangling = conn.execute("PRAGMA foreign_key_check").fetchall()
    if dangling:
        raise ResetRefused(f"the wipe would leave {len(dangling)} dangling reference(s); rolled back")


def owned_by_demo_owner_in_db(conn: sqlite3.Connection) -> set[tuple[int, str]]:
    return {
        (r["id"], r["name"]) for r in conn.execute(
            "SELECT c.id, c.name FROM company c JOIN membership m ON m.company_id = c.id "
            "JOIN app_user u ON u.id = m.user_id WHERE u.email = ? AND m.role = 'owner'", (OWNER_EMAIL,))
    }


def owned_by_demo_owner_via_server(client: httpx.Client) -> set[tuple[int, str]]:
    """The same question, asked of the running server."""
    login = client.post("/api/auth/dev-login", json={"email": OWNER_EMAIL})
    if login.status_code != 200:
        return set()  # no user, or a user with no company: nothing owned
    listing = client.get("/api/auth/companies", headers={"Authorization": f"Bearer {login.json()['token']}"})
    listing.raise_for_status()
    return {(c["id"], c["name"]) for c in listing.json() if c["role"] == "owner"}


def check_same_database(client: httpx.Client, conn: sqlite3.Connection) -> None:
    """The wipe is SQL on this process's database and the re-seed is HTTP on the server's.
    If they are not the same database the wipe would hit the wrong one and the seed would
    pile onto the right one. Prove they are the same before deleting anything."""
    via_server = owned_by_demo_owner_via_server(client)
    via_db = owned_by_demo_owner_in_db(conn)
    if via_server != via_db:
        raise ResetRefused(
            "this script and the server are not using the same database. The server says the demo owner owns "
            f"{sorted(via_server) or 'nothing'}; the database at {Path(DB_PATH).resolve()} says {sorted(via_db) or 'nothing'}. "
            "Nothing was changed. Run it from the server's own directory with its .env (on the box: cd /opt/jaga/backend)."
        )


def schema_problem(conn: sqlite3.Connection) -> str | None:
    """None when this database can be wiped by this script, else what is wrong. The wipe
    reuses purge_document, which reads expectation.evidence_document_id (round 16) and
    refuses foreign keys it does not know: better to say so in the dry run than to fail
    inside the wipe (which would roll back cleanly, but only after the operator said go)."""
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(expectation)")}
    if "evidence_document_id" not in columns:
        return ("the database predates round 16 (expectation.evidence_document_id is missing): "
                "deploy that backend and let the service restart once (it migrates on startup) before running this")
    try:
        purge_document.check_references(conn)
    except purge_document.PurgeRefused as e:
        return str(e)
    return None


def fingerprint(conn: sqlite3.Connection) -> dict:
    """The demo state with ids left out, so two runs can be compared: companies with their group,
    memberships, documents (company, filename, status)."""
    ids = [c[0] for c in owned_by_demo_owner_in_db(conn)]
    if not ids:
        return {"companies": [], "memberships": [], "documents": []}
    m = _marks(ids)
    return {
        "companies": sorted(
            (r["name"], r["group_name"], r["fye_month"], r["fye_day"]) for r in conn.execute(
                f"SELECT c.name, g.name AS group_name, c.fye_month, c.fye_day FROM company c "
                f"LEFT JOIN company_group g ON g.id = c.group_id WHERE c.id IN ({m})", ids)),
        "memberships": sorted(
            (r["name"], r["email"], r["role"]) for r in conn.execute(
                f"SELECT c.name, u.email, m.role FROM membership m JOIN company c ON c.id = m.company_id "
                f"JOIN app_user u ON u.id = m.user_id WHERE c.id IN ({m})", ids)),
        "documents": sorted(
            (r["name"], r["filename"], r["status"]) for r in conn.execute(
                f"SELECT c.name, d.filename, d.status FROM document d JOIN company c ON c.id = d.company_id "
                f"WHERE c.id IN ({m})", ids)),
    }


def verify_clean_seed(conn: sqlite3.Connection, files_dir: Path) -> dict:
    """Asserts the database now holds exactly the seed, or raises with what differs."""
    state = fingerprint(conn)
    problems: list[str] = []
    names = sorted(name for name, *_ in state["companies"])
    if names != sorted(SEEDED_NAMES):
        problems.append(f"companies are {names}, expected {sorted(SEEDED_NAMES)}")
    if any(group != seed_dev_db.GROUP_NAME for _, group, *_ in state["companies"]):
        problems.append(f"not every company is in '{seed_dev_db.GROUP_NAME}': {state['companies']}")
    members = {(company, email): role for company, email, role in state["memberships"]}
    expected_members = {(seed_dev_db.COMPANY_NAME, email): role for email, role in EXPECTED_ROLES.items()}
    expected_members |= {(name, OWNER_EMAIL): "owner" for name in SEEDED_NAMES if name != seed_dev_db.COMPANY_NAME}
    if members != expected_members:
        problems.append(f"memberships differ: extra {sorted(set(members.items()) - set(expected_members.items()))}, "
                        f"missing {sorted(set(expected_members.items()) - set(members.items()))}")
    wanted = sorted(p.name for p in files_dir.glob("*.pdf"))
    held = sorted(f for company, f, _ in state["documents"] if company == seed_dev_db.COMPANY_NAME)
    if held != wanted:
        problems.append(f"documents are {held}, expected {wanted}")
    if any(company != seed_dev_db.COMPANY_NAME for company, *_ in state["documents"]):
        problems.append("a sibling company holds documents")
    if problems:
        raise ResetRefused("the database is NOT the clean seed: " + "; ".join(problems))
    return state


def reset(client: httpx.Client, *, apply: bool, include_unrecognised: bool = False, files_dir: Path = seed_dev_db.FILES_DIR, out=print) -> int:
    out(f"Database: {Path(DB_PATH).resolve()}")
    out(f"Server:   {seed_dev_db.API}")
    corpus = sorted(files_dir.glob("*.pdf"))
    with get_conn(DB_PATH) as conn:
        plan = plan_wipe(conn)
        server_check = "not reachable"
        try:
            client.get("/api/health").raise_for_status()
            check_same_database(client, conn)
            server_check = "ok (the server and this script see the same demo companies)"
        except ResetRefused as e:
            server_check = f"MISMATCH: {e}"
        except httpx.HTTPError as e:
            server_check = f"not reachable ({e})"
    out("Plan:")
    for line in describe(plan, len(corpus)):
        out(line)
    out(f"Server check: {server_check}")
    with get_conn(DB_PATH) as conn:
        schema = schema_problem(conn)
    out(f"Schema check: {schema or 'ok'}")

    problems = []
    if schema:
        problems.append("the schema check above did not pass")
    if not corpus:
        problems.append(f"no demo corpus PDFs at {files_dir}: copy evals/demo_corpus/files there first")
    if not server_check.startswith("ok"):
        problems.append("the server check above did not pass")
    if plan.unrecognised and not include_unrecognised:
        problems.append(
            "the scope includes companies that are not seeded names (listed above); read them, and add --include-unrecognised if they really should go"
        )
    if not apply:
        out("\nDRY RUN: nothing was changed." + (" It would REFUSE to apply: " + "; ".join(problems) if problems else " Re-run with --apply."))
        return 0
    if problems:
        out("REFUSED, nothing was changed: " + "; ".join(problems))
        return 1

    try:
        with get_conn(DB_PATH) as conn:
            wipe(conn, plan)  # one transaction: an exception here rolls all of it back
    except (ResetRefused, purge_document.PurgeRefused) as e:
        out(f"REFUSED, nothing was changed: {e}")
        return 1
    removed, failed = 0, []
    with get_conn(DB_PATH) as conn:
        for path in dict.fromkeys(plan.files):
            if conn.execute("SELECT COUNT(*) FROM document WHERE stored_path = ?", (str(path),)).fetchone()[0]:
                continue  # another document row (outside the scope) still uses this file
            try:
                remove_thumbnail(path.stem)  # a PDF's cached thumbnail (round 20, DECISIONS #97) goes with its file
                if path.exists():
                    path.unlink()
                    removed += 1
            except OSError as e:
                failed.append(f"{path} ({e})")
    out(f"Wiped {len(plan.companies)} company(ies), {len(plan.document_ids)} document(s), {removed} file(s) removed.")
    if failed:
        out("FILE(S) NOT REMOVED, delete by hand: " + "; ".join(failed))

    try:
        result = seed_dev_db.seed(client, reuse_existing=False, files_dir=files_dir)
        duplicates = [name for name, status in result["uploads"] if status == "duplicate"]
        if duplicates:
            raise ResetRefused(
                f"the server refused {duplicates} as duplicates: an identical file is held by another company "
                "(document hashes are unique across the whole database). The demo documents are incomplete."
            )
        with get_conn(DB_PATH) as conn:
            verify_clean_seed(conn, files_dir)
    except (ResetRefused, seed_dev_db.SeedError, httpx.HTTPError) as e:
        out(f"RESET FAILED AFTER THE WIPE: {e}")
        out("The demo data is wiped and only partly re-seeded. Fix the cause and run this again.")
        return 1

    out("\nClean seed restored:")
    for role, email, _token in result["accounts"]:
        out(f"  {role:6s}  {email}")
    for name, status in result["uploads"]:
        out(f"  {name}: {status}")
    return 0 if not failed else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Wipe the demo scope and re-seed it. Dry run unless --apply.")
    parser.add_argument("--apply", action="store_true", help="actually wipe and re-seed (default: dry run)")
    parser.add_argument("--include-unrecognised", action="store_true", help="also wipe demo-owner companies that do not carry a seeded name")
    parser.add_argument("--allow-gateway-spend", action="store_true", help="required: the re-seed uploads eight PDFs through the real pipeline (DECISIONS #130)")
    args = parser.parse_args(argv)
    _live_guard.refuse_unless_allowed("scripts/reset_demo_data.py", args.allow_gateway_spend)
    with httpx.Client(base_url=seed_dev_db.API, timeout=120) as client:
        return reset(client, apply=args.apply, include_unrecognised=args.include_unrecognised)


if __name__ == "__main__":
    sys.exit(main())
