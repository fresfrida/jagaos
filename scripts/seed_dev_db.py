"""Seeds the local dev database (the one `uvicorn app.main:app` serves,
JAGA_DB_PATH in .env) with a test company, an owner account, and the
synthetic demo corpus — so the app has something to look at without
uploading files or creating a login by hand every time.

"Try Demo Pte Ltd" is a throwaway testing company, separate from
evals/demo_corpus/'s own isolated "Bright Harbour Pte Ltd" run (that one
stays a clean, reproducible eval fixture — this one is for poking around in
the UI). Swap in the team's real company profile (name/FYE only, still no
real documents — see WINNING.md's privacy note) once the pipeline is
stable.

Requires `uvicorn app.main:app --reload` already running. Run:
    python scripts/seed_dev_db.py
"""

import os
import sys
from pathlib import Path

import httpx

API = os.environ.get("JAGA_API_BASE_URL", "http://127.0.0.1:8000")
FILES_DIR = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files"

OWNER_EMAIL = "owner@try-demo.test"
COMPANY_NAME = "Try Demo Pte Ltd"


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

    headers = {"Authorization": f"Bearer {auth['token']}"}
    print(f"Dev login token (for curl/testing): {auth['token']}")

    if already_seeded:
        print(f"\nLog in at http://localhost:5173/login as {OWNER_EMAIL} to use it in the app.")
        return

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

    print(f"\nSeeded. Log in at http://localhost:5173/login as {OWNER_EMAIL} (owner role) to use it in the app.")


if __name__ == "__main__":
    main()
