"""Eval runner. ARCHITECTURE.md §6: golden-path + adversarial, printed
scorecard, evals/report.md committed to the repo.

Adversarial cases below run against the real deterministic guardrail code
(app.guards.injection, app.graph.verify's arithmetic check) — no LLM call,
no gateway key needed, so this always runs. Golden-path cases need real
labelled documents and the gateway key; run.py reports them as skipped
rather than faking a score (see evals/cases/golden/README.md).
"""

import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.graph.verify import _check_invoice_arithmetic  # noqa: E402
from app.guards.injection import scan  # noqa: E402

CASES_DIR = Path(__file__).parent / "cases"


def run_injection_cases() -> list[dict]:
    path = CASES_DIR / "adversarial" / "injection.yaml"
    cases = yaml.safe_load(path.read_text())
    results = []
    for case in cases:
        hits = scan(case["text"])
        got_hit = bool(hits)
        passed = got_hit == case["expect_hit"]
        results.append({"id": case["id"], "passed": passed, "detail": hits})
    return results


def run_gst_cases() -> list[dict]:
    path = CASES_DIR / "adversarial" / "gst_arithmetic.yaml"
    cases = yaml.safe_load(path.read_text())
    results = []
    for case in cases:
        fields = {
            "subtotal": {"value": Decimal(case["subtotal"])},
            "gst": {"value": Decimal(case["gst"])},
            "total": {"value": Decimal(case["total"])},
        }
        reasons = _check_invoice_arithmetic(fields)
        got_flag = bool(reasons)
        passed = got_flag == case["expect_flag"]
        results.append({"id": case["id"], "passed": passed, "detail": reasons})
    return results


def main() -> None:
    injection_results = run_injection_cases()
    gst_results = run_gst_cases()
    all_results = injection_results + gst_results
    total = len(all_results)
    passed = sum(1 for r in all_results if r["passed"])

    lines = [
        "# Eval report",
        "",
        f"Run at {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Adversarial — injection guardrail (app.guards.injection.scan)",
        "",
        "| Case | Result | Detail |",
        "|---|---|---|",
    ]
    for r in injection_results:
        mark = "PASS" if r["passed"] else "FAIL"
        lines.append(f"| {r['id']} | {mark} | {r['detail']} |")

    lines += [
        "",
        "## Adversarial — GST arithmetic (app.graph.verify._check_invoice_arithmetic)",
        "",
        "| Case | Result | Detail |",
        "|---|---|---|",
    ]
    for r in gst_results:
        mark = "PASS" if r["passed"] else "FAIL"
        lines.append(f"| {r['id']} | {mark} | {r['detail']} |")

    lines += [
        "",
        "## Golden path",
        "",
        "**Skipped** — needs ~15 labelled real documents and "
        "`LLM_GATEWAY_API_KEY` set. See `evals/cases/golden/README.md`. "
        "Not faked as a pass or a score.",
        "",
        f"## Scorecard: {passed}/{total} adversarial checks passed",
    ]

    report = "\n".join(lines) + "\n"
    (Path(__file__).parent / "report.md").write_text(report)
    print(report)
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
