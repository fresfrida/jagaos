"""Seeds the local dev database (the one `uvicorn app.main:app` serves,
JAGA_DB_PATH in .env) with a test company, one account per role, and the
synthetic demo corpus — so the app has something to look at without
uploading files or creating a login by hand every time.

"Try Demo Pte Ltd" is a throwaway testing company, separate from
evals/demo_corpus/'s own isolated "Bright Harbour Pte Ltd" run (that one
stays a clean, reproducible eval fixture — this one is for poking around in
the UI). Swap in the team's real company profile (name/FYE only, still no
real documents — see WINNING.md's privacy note) once the pipeline is
stable.

Since 2026-09-24 (round 12, DECISIONS #77) it also seeds one demo GROUP:
"Try Demo Holdings", holding "Try Demo Pte Ltd" plus two sibling companies,
all owned by owner@try-demo.test — so the company switcher has something to
switch between. The other accounts stay members of "Try Demo Pte Ltd" only:
one membership means no switcher and no group anywhere in their UI.

Requires `uvicorn app.main:app --reload` already running. Run:
    python scripts/seed_dev_db.py
"""

import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

# The group label is written straight into the local database (below) — there
# is deliberately no API to create a group, and app.db is imported for its
# connection helper, so this needs the repo root on the path and .env loaded
# for JAGA_DB_PATH before app.db is imported.
sys.path.insert(0, str(Path(__file__).parent.parent))
load_dotenv()

API = os.environ.get("JAGA_API_BASE_URL", "http://127.0.0.1:8000")
FILES_DIR = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files"

OWNER_EMAIL = "owner@try-demo.test"
COMPANY_NAME = "Try Demo Pte Ltd"

# 2026-09-24 (round 12, DECISIONS #77): the demo group. (name, fye_month,
# fye_day) for the two companies created alongside COMPANY_NAME; the owner
# holds an owner membership on each, which is what the switcher lists.
GROUP_NAME = "Try Demo Holdings"
SIBLING_COMPANIES = [
    ("Try Demo Logistics Pte Ltd", 6, 30),
    ("Try Demo Trading Pte Ltd", 3, 31),
]

# One account per role (2026-09-23, role/permission work), so testing "what
# does a viewer see" doesn't need hand-creating a membership every time.
# (role, email, display name) — owner is handled separately above/below,
# it's the one dev-login can create a company with in a single call.
#
# user1/user2 (2026-09-24, round 11) are two peers of the same role: a `user`
# may only edit documents they uploaded themselves, and with a single `user`
# account that rule (user vs. someone else's file) could only ever be
# exercised against a higher role, never against a peer.
ROLE_ACCOUNTS = [
    ("admin", "admin@try-demo.test", "Demo Admin"),
    ("user", "user@try-demo.test", "Demo User"),
    ("user", "user1@try-demo.test", "Demo User 1"),
    ("user", "user2@try-demo.test", "Demo User 2"),
    ("viewer", "viewer@try-demo.test", "Demo Viewer"),
]


def seed_group(client: httpx.Client, owner_headers: dict) -> None:
    """Idempotent. Creates the sibling companies the normal way (dev-login
    with a company_name makes the caller its owner), then labels all three
    with one group. Nothing about the group grants access — each company's
    reachability is still only the owner's membership row on it."""
    held = {c["name"] for c in client.get("/api/auth/companies", headers=owner_headers).json()}
    for name, fye_month, fye_day in SIBLING_COMPANIES:
        if name in held:
            continue
        client.post(
            "/api/auth/dev-login",
            json={"email": OWNER_EMAIL, "company_name": name, "fye_month": fye_month, "fye_day": fye_day},
        ).raise_for_status()
        print(f"Created sibling company: {name} (owner {OWNER_EMAIL})")

    from app.db import DB_PATH, get_conn, init_db

    init_db(DB_PATH)  # the group table/columns exist even if the server has not restarted yet
    names = [COMPANY_NAME, *(n for n, _, _ in SIBLING_COMPANIES)]
    with get_conn(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO company_group (name) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM company_group WHERE name = ?)",
            (GROUP_NAME, GROUP_NAME),
        )
        group_id = conn.execute("SELECT id FROM company_group WHERE name = ?", (GROUP_NAME,)).fetchone()["id"]
        # By name AND owner membership, so a like-named company someone else owns is never swept in.
        conn.execute(
            f"UPDATE company SET group_id = ? WHERE name IN ({','.join('?' * len(names))}) AND id IN ("
            "  SELECT m.company_id FROM membership m JOIN app_user u ON u.id = m.user_id "
            "  WHERE u.email = ? AND m.role = 'owner')",
            (group_id, *names, OWNER_EMAIL),
        )
    print(f"Group '{GROUP_NAME}': {', '.join(names)} — switch between them as {OWNER_EMAIL}.")


def main() -> None:
    client = httpx.Client(base_url=API, timeout=60)

    try:
        client.get("/api/health").raise_for_status()
    except httpx.ConnectError:
        print("Backend not reachable at", API, "— start it first: uvicorn app.main:app --reload")
        sys.exit(1)

    # Idempotent via the auth system itself, not a name lookup: logging in
    # with no company_name joins an existing membership if there is one.
    rejoin = client.post("/api/auth/dev-login", json={"email": OWNER_EMAIL})
    already_seeded = rejoin.status_code == 200

    if already_seeded:
        auth = rejoin.json()
        print(f"'{COMPANY_NAME}' already seeded as company #{auth['company']['id']} — reusing it, not re-uploading.")
    else:
        auth = client.post(
            "/api/auth/dev-login",
            json={
                "email": OWNER_EMAIL, "name": "Demo Owner",
                "company_name": COMPANY_NAME, "fye_month": 12, "fye_day": 31,
            },
        ).json()
        print(f"Created company #{auth['company']['id']}: {COMPANY_NAME}, owner {OWNER_EMAIL}")

    company_id = auth["company"]["id"]
    headers = {"Authorization": f"Bearer {auth['token']}"}

    if not already_seeded:
        for path in sorted(FILES_DIR.glob("*.pdf")):
            with open(path, "rb") as f:
                resp = client.post(
                    "/api/documents",
                    params={"source_channel": "web"},
                    files={"file": (path.name, f, "application/pdf")},
                    headers=headers,
                )
            resp.raise_for_status()
            body = resp.json()
            print(f"  {path.name}: {body.get('status')}")

    # Idempotent the same way the owner path above is: POST .../members
    # 409s on an already-existing membership (app/main.py::add_member) —
    # expected and fine on a re-run, not an error to stop for.
    accounts = [("owner", OWNER_EMAIL, auth["token"])]
    for role, email, name in ROLE_ACCOUNTS:
        add = client.post(
            f"/api/companies/{company_id}/members",
            json={"email": email, "name": name, "role": role},
            headers=headers,
        )
        if add.status_code not in (200, 409):
            add.raise_for_status()
        login = client.post("/api/auth/dev-login", json={"email": email})
        login.raise_for_status()
        accounts.append((role, email, login.json()["token"]))

    seed_group(client, headers)

    # Email is the only "credential" this auth model has (dev-login is a
    # placeholder for real magic-link email, app/auth.py's docstring) —
    # there's no password to print alongside it.
    print(f"\nAccounts for '{COMPANY_NAME}' (company #{company_id}):")
    for role, email, token in accounts:
        print(f"  {role:6s}  {email:28s}  token={token}")

    print("\nLog in at http://localhost:5173/login as any email above to use it in the app.")


if __name__ == "__main__":
    main()
