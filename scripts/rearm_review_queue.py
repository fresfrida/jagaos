"""Re-arms the demo review queue after a backend restart (round 7, item S2, DECISIONS #134).

    python scripts/rearm_review_queue.py [--dry-run] [--base-url http://127.0.0.1:8000] [--owner-email owner_priya@try-demo.test]

WHY: the review checkpoint is held in memory (MemorySaver, app/graph/pipeline.py; a durable one is a post-demo item). After ANY backend
restart or deploy every pending review item is dead: it stays in the database as open, its Confirm returns 410, and re-uploading the same
file answers "duplicate". So the demo review documents have to be removed and uploaded again, which builds a live checkpoint for each.

WHAT IT DOES, against a RUNNING server, as the demo owner (the existing dev-login):
  1. Asks GET /api/health and REFUSES (exit 2) unless the server says it is in replay mode (`"replay": true`, a bare boolean, no path or
     secret in the answer). Without replay the re-upload would spend the gateway.
  2. Removes the eight demo PDFs (evals/demo_corpus/files/, found by their sha256, in the owner's company only) through app/purge.py with the
     operator "system: rearm review queue", so History reads Uploaded, then Deleted by that operator. It touches nothing else.
  3. Uploads only the FOUR SAFE demo PDFs again (05 clean invoice, 06 bad GST, 07 injection attempt, 08 lease) through POST /api/documents. With
     replay on they are answered from evals/replay/, so it costs nothing. The statutory 01 to 04 are NEVER uploaded by this script: confirming one
     creates events dated 2023 inside a seeded company incorporated in 2016 (S1f, DECISIONS #134). `--only 05,06` narrows the set further.
SAFETY (DECISIONS #140, after the 2026-09-27 sitting hard-deleted the archived originals ids 1 to 8 and the events and checklist rows derived from them):
  * `--dry-run` prints what it WOULD remove and upload and changes nothing (no sign-in, no purge, no upload).
  * It REFUSES (exit 2, nothing changed) when any demo copy it would remove is ARCHIVED or has an event derived from it: those are seeded evidence, not a
    stale review copy. Only pending-review and other event-free copies are removed.
  * Pre/post count assertions: after the removal the company holds exactly (before - removed) documents and the event and expectation counts are
    unchanged; after the uploads the event and expectation counts are still unchanged. A violation prints what differed and exits 3.
Idempotent: run it twice and the second run ends in the same state as the first.

RUN IT ON THE SERVER'S OWN MACHINE, from the app directory, with the same .env as the server: step 2 opens the SAME database file the
server uses (JAGA_DB_PATH), which is printed first. It never runs against a database the server does not serve."""

import argparse
import hashlib
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
FILES = REPO / "evals" / "demo_corpus" / "files"
OPERATOR = "system: rearm review queue"


# THE FOUR SAFE FILES (S1f, the user's ruling D1, DECISIONS #134): the only demo PDFs this script ever UPLOADS. Confirming a statutory demo file (01 to 04)
# runs derive_events on the replayed answer and creates events dated 2023 (the incorporation of BRIGHT HARBOUR PTE. LTD., 2023-01-15) inside a seeded
# company incorporated in 2016, which contradicts the seeded checklist. The invoices and the lease have no such side effect. Removal still covers
# all eight, so a company that already holds an older full set is cleaned.
SAFE_UPLOADS = (
    "05_invoice_clean.pdf",
    "06_invoice_bad_gst.pdf",
    "07_invoice_injection_attempt.pdf",
    "08_lease_important.pdf",
)


def demo_pdfs() -> list[Path]:
    """All eight tracked demo PDFs: what the REMOVAL step looks for."""
    return sorted(FILES.glob("*.pdf"))


def select_uploads(only: str | list[str] | None, out=print) -> list[Path]:
    """The PDFs to upload: the four safe files by default, or the subset `only` names (comma separated, each the two-digit prefix such as 05, or the
    file name). Anything that is not one of the four safe files, the statutory 01 to 04 included, is REFUSED with exit 2 before anything is touched."""
    if only is None or (isinstance(only, str) and not only.strip()):
        names = list(SAFE_UPLOADS)
    else:
        tokens = [t.strip() for t in (only.split(",") if isinstance(only, str) else only) if t.strip()]
        names = []
        for token in tokens:
            match = next((n for n in SAFE_UPLOADS if n == token or n.split("_", 1)[0] == token), None)
            if match is None:
                known = next((p.name for p in demo_pdfs() if p.name == token or p.name.split("_", 1)[0] == token), None)
                why = (f"{known} is a statutory demo file: confirming it would create an event dated 2023 inside a seeded company incorporated in 2016, "
                       "which contradicts the seeded checklist" if known and known not in SAFE_UPLOADS else f"'{token}' is not a demo file")
                out(f"REFUSED (exit 2): --only accepts only {', '.join(n.split('_', 1)[0] for n in SAFE_UPLOADS)} (or their file names); {why}. Nothing was changed.")
                raise SystemExit(2)
            if match not in names:
                names.append(match)
    return [FILES / n for n in names]


def _counts(conn, company_id: int) -> dict:
    """The rows this script must never change except by the documents it removes and uploads (asserted before and after)."""
    one = lambda sql: conn.execute(sql, (company_id,)).fetchone()[0]  # noqa: E731
    return {
        "documents": one("SELECT COUNT(*) FROM document WHERE company_id = ?"),
        "events": one("SELECT COUNT(*) FROM event WHERE company_id = ?"),
        "expectations": one("SELECT COUNT(*) FROM expectation WHERE company_id = ?"),
    }


def _blockers(conn, rows) -> list[str]:
    """Why a found demo copy must NOT be removed: it is archived, an event was derived from it, or (2026-09-28, DECISIONS #148)
    it came through the Vercel deployment — a real, hand-entered document there, never a demo file this script itself put down,
    whatever its bytes happen to match. This script never removes a 'vercel' row, full stop, no override."""
    why = []
    for row in rows:
        if row["deployment"] == "vercel":
            why.append(f"document {row['id']} is a Vercel-deployment row (deployment='vercel'), never touched by this script")
        if row["status"] == "archived":
            why.append(f"document {row['id']} is archived")
        n = conn.execute("SELECT COUNT(*) FROM event WHERE source_document_id = ?", (row["id"],)).fetchone()[0]
        if n:
            why.append(f"document {row['id']} has {n} event(s) derived from it")
    return why


def _company_of_owner(conn, email: str) -> int | None:
    row = conn.execute("SELECT m.company_id FROM membership m JOIN app_user u ON u.id = m.user_id WHERE u.email = ? ORDER BY m.id LIMIT 1", (email,)).fetchone()
    return row["company_id"] if row else None


def rearm(client, *, owner_email: str = "owner_priya@try-demo.test", only: str | list[str] | None = None, dry_run: bool = False, out=print) -> dict:
    """Do the three steps against `client` (an httpx client on the server, or a TestClient). Returns a summary; raises SystemExit(2) when `only`
    names anything but the four safe files, the server is not in replay mode or the owner cannot be signed in (in each case nothing is changed)."""
    uploads = select_uploads(only, out)
    from app import activity
    from app.db import DB_PATH, get_conn
    from app.purge import purge_now

    health = client.get("/api/health").json()
    if dry_run:
        with get_conn(DB_PATH) as conn:
            company_id = _company_of_owner(conn, owner_email)
            if company_id is None:
                out(f"DRY RUN: {owner_email} is not a member of any company; nothing to plan.")
                return {"dry_run": True, "would_remove": [], "would_upload": [p.name for p in uploads], "blockers": []}
            by_sha = {hashlib.sha256(p.read_bytes()).hexdigest(): p for p in demo_pdfs()}
            found = [r for r in conn.execute(f"SELECT id, sha256, company_id, status, deployment FROM document WHERE company_id = ? AND sha256 IN ({','.join('?' * len(by_sha))})", [company_id, *by_sha]).fetchall()]
            blockers = _blockers(conn, found)
            before = _counts(conn, company_id)
        out(f"DRY RUN (nothing is changed); replay mode: {health.get('replay') is True}; company #{company_id}; database {Path(DB_PATH).resolve()}")
        out(f"would remove {len(found)}: {[(by_sha[r['sha256']].name, r['status'], r['id']) for r in found]}")
        out(f"would upload {len(uploads)}: {[p.name for p in uploads]}")
        out(f"counts now: {before}")
        out(f"a real run would REFUSE: {'; '.join(blockers)}" if blockers else "a real run would not be refused")
        return {"dry_run": True, "would_remove": [by_sha[r["sha256"]].name for r in found], "would_upload": [p.name for p in uploads], "blockers": blockers}
    if health.get("replay") is not True:
        out("REFUSED (exit 2): the server is not in replay mode (LLM_REPLAY_DIR), so re-uploading the demo PDFs would spend the gateway budget.")
        raise SystemExit(2)
    login = client.post("/api/auth/dev-login", json={"email": owner_email})
    if login.status_code != 200:
        out(f"REFUSED (exit 2): could not sign in as {owner_email} (HTTP {login.status_code}).")
        raise SystemExit(2)
    headers = {"Authorization": "Bearer " + login.json()["token"]}
    company_id = login.json()["company"]["id"]
    out(f"server is in replay mode; signed in as {owner_email}, company #{company_id}; database {Path(DB_PATH).resolve()}")

    by_sha = {hashlib.sha256(p.read_bytes()).hexdigest(): p for p in demo_pdfs()}
    with get_conn(DB_PATH) as conn:
        found = conn.execute(f"SELECT id, sha256, company_id, status, deployment FROM document WHERE sha256 IN ({','.join('?' * len(by_sha))})", list(by_sha)).fetchall()
    with get_conn(DB_PATH) as conn:
        blockers = _blockers(conn, [r for r in found if r["company_id"] == company_id])
        before = _counts(conn, company_id)
    if blockers:
        out(f"REFUSED (exit 2): {'; '.join(blockers)}. Those are seeded evidence, not a stale review copy; removing them would also remove what was derived from them. Nothing was changed.")
        raise SystemExit(2)
    elsewhere = [r["id"] for r in found if r["company_id"] != company_id]
    if elsewhere:
        out(f"NOTE: document(s) {elsewhere} with the same bytes belong to another company and are left alone (an upload of that file will read as a duplicate).")
    removed = []
    for row in found:
        if row["company_id"] != company_id:
            continue
        not_removed = purge_now(row["id"], actor=activity.operator(OPERATOR))
        removed.append((by_sha[row["sha256"]].name, row["status"]))
        if not_removed:
            out(f"  file left on disk for {by_sha[row['sha256']].name}: {not_removed}")
    out(f"removed {len(removed)} demo document(s): {[n for n, _ in removed]}")
    with get_conn(DB_PATH) as conn:
        mid = _counts(conn, company_id)
    expected = {**before, "documents": before["documents"] - len(removed)}
    if mid != expected:
        out(f"COUNT ASSERTION FAILED (exit 3) after the removal: expected {expected}, found {mid}.")
        raise SystemExit(3)

    outcomes = {}
    for pdf in uploads:
        resp = client.post("/api/documents", files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")}, headers=headers)
        outcomes[pdf.name] = resp.json().get("status") if resp.status_code == 200 else f"HTTP {resp.status_code}"
    with get_conn(DB_PATH) as conn:
        after = _counts(conn, company_id)
    if after["events"] != before["events"] or after["expectations"] != before["expectations"]:
        out(f"COUNT ASSERTION FAILED (exit 3) after the uploads: events/expectations were {before['events']}/{before['expectations']}, now {after['events']}/{after['expectations']}.")
        raise SystemExit(3)
    queue = client.get("/api/review", headers=headers).json()
    out(f"uploaded {len(outcomes)} of the four safe demo PDF(s); open review items now: {len(queue)}")
    for name, status in outcomes.items():
        out(f"  {name:<40} {status}")
    return {"removed": removed, "outcomes": outcomes, "open_review_items": len(queue)}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Remove the demo PDFs and re-upload the four safe ones so the review queue has live checkpoints again.")
    p.add_argument("--only", help="upload only these of the four safe files: comma separated, by two-digit prefix (05,06) or file name; 01 to 04 are refused")
    p.add_argument("--dry-run", action="store_true", help="print what would be removed and uploaded, and whether a real run would refuse; change nothing")
    p.add_argument("--base-url", default=os.environ.get("JAGA_API_BASE_URL", "http://127.0.0.1:8000"))
    p.add_argument("--owner-email", default="owner_priya@try-demo.test")
    args = p.parse_args(argv)
    select_uploads(args.only)              # refuse a bad --only (exit 2) before any server is contacted
    from dotenv import load_dotenv

    load_dotenv()
    import httpx

    try:
        with httpx.Client(base_url=args.base_url, timeout=120) as client:
            summary = rearm(client, owner_email=args.owner_email, only=args.only, dry_run=args.dry_run)
    except httpx.ConnectError:
        print(f"REFUSED (exit 2): no server answers at {args.base_url}; start it first.", file=sys.stderr)
        return 2
    if summary.get("dry_run"):
        return 0
    return 0 if all(not str(s).startswith("HTTP") for s in summary["outcomes"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
