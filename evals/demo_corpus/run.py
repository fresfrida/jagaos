"""Runs the synthetic Bright Harbour Pte Ltd corpus through the real
FastAPI app (app.main.app, via TestClient — the actual HTTP surface, not
the node functions directly) and writes evals/demo_corpus/RESULTS.md.

This is a labelled demo corpus (WINNING.md), not the team's real documents
(privacy) — every number below is real (the system actually ran), but the
input documents are fictional. Needs LLM_GATEWAY_API_KEY in .env.

Run: python evals/demo_corpus/run.py
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))

from dotenv import load_dotenv

load_dotenv()

import app.db as db_module  # noqa: E402

DB_PATH = str(Path(__file__).parent / "demo.db")
db_module.DB_PATH = DB_PATH

from fastapi.testclient import TestClient  # noqa: E402

from app.graph import ingest as ingest_module  # noqa: E402
from app.main import app  # noqa: E402

ingest_module.DOCS_PATH = Path(__file__).parent / "store"

FILES_DIR = Path(__file__).parent / "files"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the synthetic corpus through the real pipeline. Spends the gateway budget.")
    parser.add_argument("--allow-gateway-spend", action="store_true", help="required: every run pays for real gateway calls (DECISIONS #130)")
    args = parser.parse_args()
    import _live_guard  # noqa: PLC0415
    _live_guard.refuse_unless_allowed("evals/demo_corpus/run.py", args.allow_gateway_spend)
    db_module.init_db(DB_PATH)
    client = TestClient(app)

    # 2026-09-22: every data endpoint now requires a session
    # (app/auth.py) — sign in via dev-login (real magic-link email isn't
    # set up; see its docstring) rather than the old open POST /api/companies.
    auth = client.post(
        "/api/auth/dev-login",
        json={
            "email": "demo-corpus@jagaos.test",
            "company_name": "Bright Harbour Pte Ltd",
            "fye_month": 12,
            "fye_day": 31,
        },
    ).json()
    headers = {"Authorization": f"Bearer {auth['token']}"}

    lines = [
        "# Demo corpus run — Bright Harbour Pte Ltd (synthetic)",
        "",
        f"Run at {datetime.now(timezone.utc).isoformat()}, company #{auth['company']['id']}, "
        f"logged in as {auth['user']['email']} ({auth['role']})",
        "",
        "**This is a fictional company and a synthetic document set** "
        "(WINNING.md's \"clearly-labelled active-SME corpus\"), used in "
        "place of the team's real documents for privacy. The numbers below "
        "are real system output against real gateway calls — only the "
        "input documents are made up.",
        "",
        "## Documents processed",
        "",
        "| File | Status | Lane / doc_type | Notes |",
        "|---|---|---|---|",
    ]

    for path in sorted(FILES_DIR.glob("*.pdf")):
        with open(path, "rb") as f:
            resp = client.post(
                "/api/documents",
                params={"source_channel": "web"},
                files={"file": (path.name, f, "application/pdf")},
                headers=headers,
            )
        body = resp.json()
        status = body.get("status")
        classify = body.get("classify") or {}
        lane_type = f"{classify.get('lane', '?')} / {classify.get('doc_type', '?')}"
        note = ""
        if status == "needs_review":
            note = f"review: {body.get('review', {}).get('question', '')}"
        elif status == "processed":
            verify = body.get("verify") or {}
            if not verify.get("ok", True):
                note = "quarantined (injection guardrail)"
            else:
                note = f"obligations_created={body.get('obligations_created')}"
        lines.append(f"| {path.name} | {status} | {lane_type} | {note} |")

    expectations = client.get("/api/expectations", headers=headers).json()
    obligations = client.get("/api/obligations", headers=headers).json()
    documents = client.get("/api/documents", headers=headers).json()

    satisfied = [e for e in expectations if e["status"] == "satisfied"]
    missing = [e for e in expectations if e["status"] == "missing"]

    lines += [
        "",
        f"## Gap analysis: {len(satisfied)} of {len(expectations)} expected documents held",
        "",
        "| Expected document | Status |",
        "|---|---|",
    ]
    for e in expectations:
        lines.append(f"| {e['label']} | {e['status']} |")

    lines += [
        "",
        "## Obligations derived (statutory clock)",
        "",
        "| Obligation | Due | Status | Citation |",
        "|---|---|---|---|",
    ]
    for o in obligations:
        lines.append(f"| {o['label']} | {o['due_on']} | {o['status']} | {o['citation']} |")

    total_cost = 0.0
    trace_rows = 0
    for d in documents:
        trace = client.get(f"/api/trace/{d['id']}", headers=headers).json()
        total_cost += trace.get("total_cost_usd", 0) or 0
        trace_rows += len(trace.get("nodes", []))

    quarantined = [d for d in documents if d["status"] == "quarantined"]
    needs_review = [d for d in documents if d["status"] == "needs_review"]

    lines += [
        "",
        "## Summary",
        "",
        f"- Documents processed: {len(documents)}",
        f"- Quarantined (injection guardrail fired): {len(quarantined)}",
        f"- Sent to human review queue: {len(needs_review)}",
        f"- Expected documents held vs expected: {len(satisfied)} of {len(expectations)}",
        f"- Missing: {len(missing)}",
        f"- Obligations derived: {len(obligations)}",
        f"- Total LLM cost across the run: ${total_cost:.4f} USD "
        "(app/llm.py placeholder pricing, not the gateway's confirmed billed rate)",
        f"- Trace rows written: {trace_rows}",
    ]

    report = "\n".join(lines) + "\n"
    (Path(__file__).parent / "RESULTS.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
