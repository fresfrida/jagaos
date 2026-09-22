"""Seeds the local dev database (the one `uvicorn app.main:app` serves,
JAGA_DB_PATH in .env) with a test company and the synthetic demo corpus —
so the /ops console has something to look at without uploading files by
hand every time.

"Try Demo Pte Ltd" is a throwaway testing company, separate from
evals/demo_corpus/'s own isolated "Bright Harbour Pte Ltd" run (that one
stays a clean, reproducible eval fixture — this one is for poking around in
the UI). Swap in the team's real company profile (name/FYE only, still no
real documents — see WINNING.md's privacy note) once the pipeline is
stable.

Requires `uvicorn app.main:app --reload` already running. Run:
    python scripts/seed_dev_db.py
"""

import sys
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000"
FILES_DIR = Path(__file__).parent.parent / "evals" / "demo_corpus" / "files"

COMPANY = {"name": "Try Demo Pte Ltd", "fye_month": 12, "fye_day": 31}


def main() -> None:
    client = httpx.Client(base_url=API, timeout=60)

    try:
        client.get("/api/health").raise_for_status()
    except httpx.ConnectError:
        print("Backend not reachable at", API, "— start it first: uvicorn app.main:app --reload")
        sys.exit(1)

    existing = client.get("/api/companies").json()
    match = next((c for c in existing if c["name"] == COMPANY["name"]), None)
    if match:
        print(f"'{COMPANY['name']}' already exists as company #{match['id']} — reusing it, not re-uploading.")
        print(f"Open /ops and, if it doesn't auto-load, use company id {match['id']}.")
        return

    company = client.post("/api/companies", params=COMPANY).json()
    company_id = company["id"]
    print(f"Created company #{company_id}: {COMPANY['name']}")

    for path in sorted(FILES_DIR.glob("*.pdf")):
        with open(path, "rb") as f:
            resp = client.post(
                "/api/documents",
                params={"company_id": company_id, "source_channel": "web"},
                files={"file": (path.name, f, "application/pdf")},
            )
        resp.raise_for_status()
        body = resp.json()
        print(f"  {path.name}: {body.get('status')}")

    print(f"\nSeeded. Company id = {company_id}")
    print("Open http://localhost:5173/ops — it should auto-load this company "
          "if your browser already has it in localStorage from a prior session; "
          "otherwise pick it from the 'existing companies' list on that page.")


if __name__ == "__main__":
    main()
