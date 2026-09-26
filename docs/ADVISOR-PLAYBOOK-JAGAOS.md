# JagaOS-specific addendum to the advisor playbook

Read the general playbook first. This adds project-specific guardrails and two real examples
of exactly the kind of mistake point 1 (investigate first) is meant to prevent.

## Project-specific rules

- **Docs convention**: `docs/HANDOFF.md` (current state, read this first), `docs/KANBAN.md`
  (Backlog/Doing/Done), `docs/DECISIONS.md` (numbered decision log, e.g. "DECISIONS #131").
  Every real change gets recorded in these three files. Cite the decision number when a new ask
  reverses or extends an earlier one.
- **Deploy order, always backend first**: if a change touches `app/`, it must be deployed to
  the Lightsail box and verified live BEFORE the frontend is pushed (a pushed frontend calling
  an endpoint the live backend doesn't have yet fails ugly). This is the advisor session's job,
  not Codex's or the coding agent's — Codex should just flag in its report whether a change
  needs a backend redeploy, not attempt one.
- **No gateway spend without explicit go-ahead, full stop** (standing rule as of DECISIONS
  #130, live incident-driven): no `scripts/seed_dev_db.py`, no
  `scripts/reset_demo_data.py --apply`, no `evals/demo_corpus/run.py`, no
  `RUN_LIVE_GATEWAY_TESTS=1`, no "let me just upload something to check." Plain `pytest tests/`
  is free ONLY since DECISIONS #135 (2026-09-27): before that fix it ran four live tests and spent real tokens on every run
  (the old "18 skipped" figure hid them). Now 22 live-gateway tests skip by default and a tripwire fails any test that tries a
  non-local network request; check that the summary line says 22 skipped. If a prompt would cause the coding agent
  to do any of the above, it needs the user's explicit sign-off named IN the prompt, not implied.
- **Two databases, not one**: `data/jaga.db` is local dev. The Lightsail box has its own
  separate, real production database, reachable only by SSH. A question about local code
  behavior can usually be answered against the local DB. A question about what actually happened
  in production (a live incident, a real cost anomaly, real user data) needs the PRODUCTION
  database specifically — say which one a given investigation actually needs, don't default to
  local out of convenience when the question is really about prod.
- **Migrations here are additive** (`CREATE TABLE IF NOT EXISTS`-style, checked in `app/db.py`)
  — but confirm this holds for whatever specific migration is in question rather than assuming
  either "definitely safe" or "definitely risky." A backfill step (populating new columns from
  existing rows) is a different risk profile than a bare `CREATE TABLE IF NOT EXISTS` even in
  the same file — read the actual migration code before characterizing its risk.

## Two real examples from Codex's own prompts, annotated

**Example 1 — the mistake playbook point 1 exists to prevent, caught red-handed:**

> "Confirmed: the statutory documents list is `ComplianceChecklist.tsx`. Each row uses
> `min-h-56 ... sm:min-h-40`, which forces a 224px minimum height on phones... Build: remove
> the fixed mobile minimum..."

This reads like solid grounding — a specific file, a specific class, a specific fix. But it was
drafted from the last COMMIT (`HEAD`), not the actual dirty working tree. Checked directly: the
working tree had ALREADY removed `min-h-56` from that exact file (uncommitted, from other
work in flight) by the time this prompt would have gone out. The prompt describes a bug that no
longer exists in the tree it would actually be applied to — the coding agent would have been
sent to fix something already fixed, either wasting a turn confirming there's nothing to do, or
worse, silently redoing/conflicting with whatever the other in-flight change was doing.

**The fix for next time**: when a prompt states "file X currently does Y," run
`git status`/`git diff` on THAT EXACT FILE first, not just a general "check the dirty worktree"
instruction elsewhere in the prompt. "I checked the repo" is not the same claim as "I checked
this specific file's current, uncommitted state" — and only the second one is what "current"
actually means when there's a dirty tree.

**Example 2 — good instincts, one unstated assumption worth surfacing:**

> "JagaOS SQLite audit, report only... Inspect `data/jaga.db` directly..."

Genuinely good practice here: real read-only connection (`mode=ro&immutable=1`), a specific and
well-reasoned safety catch (don't start the app, since it might run the uncommitted migration),
sanitized output (no token hashes, no full extracted text), and cross-referencing the DB's
actual state against the in-progress migration code rather than assuming either matches.

The one gap: this targets the LOCAL dev database. If the underlying question is "why did
photos cost real tokens sometimes and not others" as a pure code-behavior question, local is
fine — the same code processed the local documents. But if any part of the goal is
understanding what actually happened on PRODUCTION (the live token-budget incident this
session investigated), the local DB can't answer that — it's a different database with
different history. A prompt like this should say explicitly which question it's answering and
why that database is the right one to ask, rather than defaulting to local because it's the one
sitting right there in the working directory.

## The one-line version of both lessons

"I read the code" and "I checked the database" are incomplete claims. Say which code
(committed or the actual dirty tree?) and which database (local or the one the real question is
actually about?) — the answer changes what you're allowed to conclude.
