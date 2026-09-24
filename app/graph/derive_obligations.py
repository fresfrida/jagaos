"""derive_obligations node. Deterministic — no LLM (ARCHITECTURE.md §3).
Company FYE -> the statutory clock -> dated duties. The other half of the
thesis alongside derive_expectations."""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.db import DB_PATH, get_conn
from app.graph.state import PipelineState
from app.rules.statutory import derive_obligations as rule_derive


def derive_obligations(state: PipelineState) -> PipelineState:
    with get_conn(DB_PATH) as conn:
        company = conn.execute(
            "SELECT fye_month, fye_day, timezone FROM company WHERE id = ?",
            (state["company_id"],),
        ).fetchone()
        if company is None:
            return {"obligations_created": 0}

        # 2026-09-24 (company-local dates): date.today() reads the server's
        # raw system clock (UTC on Lightsail) — not company-aware at all.
        # A company whose FYE lands near midnight UTC could get "this
        # year's" obligation cycle computed against the wrong calendar
        # year depending purely on server time-of-day. now(tz).date() is
        # the company's own calendar day, independent of both the server's
        # clock and the browser's. Falls back to Singapore on a bad/legacy
        # value rather than crashing obligation derivation entirely.
        try:
            tz = ZoneInfo(company["timezone"] or "Asia/Singapore")
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("Asia/Singapore")
        today = datetime.now(tz).date()
        fye_this_year = date(today.year, company["fye_month"], company["fye_day"])
        # Use last FYE that has already passed, so obligations are for the
        # cycle currently in flight, not one that starts next year.
        fye = fye_this_year if fye_this_year <= today else date(
            today.year - 1, company["fye_month"], company["fye_day"]
        )

        event_id = None
        if state.get("events"):
            event_id = state["events"][0]["id"]

        created = 0
        for row in rule_derive(state["company_id"], fye, event_id):
            existing = conn.execute(
                "SELECT id FROM obligation WHERE company_id = ? AND rule_id = ? AND due_on = ?",
                (row["company_id"], row["rule_id"], row["due_on"]),
            ).fetchone()
            if existing:
                continue
            conn.execute(
                "INSERT INTO obligation (company_id, event_id, kind, label, due_on, "
                " lead_days, rule_id, status, citation, risk) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row["company_id"], row["event_id"], row["kind"], row["label"],
                 row["due_on"], row["lead_days"], row["rule_id"], row["status"],
                 row["citation"], row["risk"]),
            )
            created += 1

    return {"obligations_created": created}
