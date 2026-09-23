# Permissions

Real, shipped behavior as of 2026-09-23 (role/permission work, DECISIONS
#64) — not the original feature-request text verbatim. Where this task's
own prompt was ambiguous or self-contradictory, the resolution actually
implemented is called out below; the full reasoning for each is in
`docs/DECISIONS.md` #64.

Roles rank `viewer < user < admin < owner` (`app/auth.py::ROLE_ORDER`).
Every gate below is rank-based (`require_role(min_role)`), not a per-action
flag table — a role can do everything the ranks below it can, plus its own
row.

## Matrix

| Action | viewer | user | admin | owner |
|---|---|---|---|---|
| View documents, search, calendar, obligations, gap analysis | ✅ | ✅ | ✅ | ✅ |
| Upload a document | ❌ | ✅ | ✅ | ✅ |
| Edit a document's description/bucket/vendor/doc_type/filename | ❌ | ✅ own uploads only | ✅ any | ✅ any |
| Resolve (accept/reject) a flagged review item | ❌ | ❌ | ✅ | ✅ |
| Archive ("Delete") a document | ❌ | ❌ | ✅ | ✅ |
| Add a team member | ❌ | ❌ | ✅ | ✅ |
| See the Company Settings page | ❌ | ❌ | ✅ read-only | ✅ editable |
| Edit company settings (name, FYE) | ❌ | ❌ | ❌ | ✅ |

Server-side enforcement (the real check — the frontend only mirrors it for
UI affordances):
- `POST /api/documents` — `require_role("user")`
- `PATCH /api/documents/{id}` — `require_role("user")` **plus an ownership
  check added this round**: if the caller's role is exactly `user` (not
  admin/owner) and the document has a recorded `uploaded_by_user_id` that
  isn't the caller's own `user_id`, 403. A document with no recorded
  uploader (`uploaded_by_user_id IS NULL` — pre-existing seed data, or any
  future non-web ingestion path) is left editable by any `user`+ account;
  there's no real uploader to protect it from.
- `POST /api/review/{id}/resolve` — `require_role("admin")`, **deliberately
  not extended** to let a `user` resolve their own upload's review item —
  see "Flagged decision 1" below.
- `POST /api/documents/{id}/archive` — `require_role("admin")`, unchanged.
- `POST /api/companies/{id}/members` — `require_role("admin")`, unchanged;
  a second `owner` is a 409 regardless of caller role.
- `PATCH /api/companies/{id}` — **new this round**, `require_role("owner")`.

## Flagged decisions (resolved, not silently picked)

**1. Does "user can caption/edit only their own uploads" extend to
resolving that upload's review item?** The original request implies yes by
analogy ("the same category of action as editing it"); the code review
that preceded implementation flagged this as a real product decision
hiding in the request, not a bug to route around. **Resolved: no — kept
`resolve_review` admin+, not extended to the uploader.** Reasoning: the
review queue is this product's human-in-the-loop safety check
(`docs/DECISIONS.md` #40 — every upload needs review, no auto-file, even a
clean one), and two of its own checks exist *because* trusting the
uploader's or the model's own self-report alone was already proven unsafe
on this exact codebase (#33's false-positive quarantine, #48's
hallucination guard on fabricated invoice totals). Letting the uploader
also be the one who clears their own flagged upload would remove the
second pair of eyes that's the actual point of the feature. Editing
description/bucket/vendor/doc_type is routine organizational metadata
work; resolving a review is closer to `add_member` — a real oversight
action, not a self-service one.

**2. Nav-visibility contradiction.** One reading implied admin can reach
Company Settings ("admin sees it read-only" — unreachable UI otherwise);
another implied the nav entry itself is owner-only. Both can't be
literally true. **Resolved: the nav entry (desktop header + the mobile
account-menu dropdown) is visible to owner + admin; the fields are
owner-only editable, admin sees them disabled.** This is the only reading
under which "admin sees it read-only" is a real, reachable UI state.

**3. Which company fields count as "settings"?** The `company` table has
eight columns (`uen`, `name`, `incorporated_on`, `fye_month`, `fye_day`,
`gst_registered`, `gst_period`, `dormant`); the request's own floor was
"at minimum the fields the signup form already collects." **Resolved: shipped exactly
that floor — `name`, `fye_month`, `fye_day`** (`CompanyEditRequest`,
`app/models.py`). Not gone further: the other five fields have no
existing UI to collect or validate them (`uen` format, `gst_period`'s
shape, what "dormant" should even mean operationally), and inventing that
UI wasn't part of this task. `CompanyOut` (`dev_login`/`/api/auth/me`) was
extended to actually return `fye_month`/`fye_day` for the first time —
previously write-once at signup and never read back, so there was nothing
to show a form the current values with.

## Found, not fixed

**`GET /api/companies` and `POST /api/companies` have no session/role
check at all** — confirmed live and by grep: no `Depends(...)` on either
handler, and neither is called from anywhere in the frontend, a script, or
a test. Pre-existing (not introduced this round), genuinely unauthenticated
company creation/listing sitting in the API surface. Not touched this
round — out of this task's stated scope (adding new enforcement, not
auditing every pre-existing endpoint) and removing/gating a live endpoint
without knowing why it's unauthenticated risked a bigger, riskier change
than asked for. Flagged in `docs/KANBAN.md` Backlog for an explicit call.

## Seeding test accounts

`python scripts/seed_dev_db.py` (idempotent, safe to re-run) now creates
one account per role — `owner@try-demo.test`, `admin@try-demo.test`,
`user@try-demo.test`, `viewer@try-demo.test` — printing each one's dev-login
token. Email is the only "credential" this auth model has (`dev-login` is
a placeholder for real magic-link email, `app/auth.py`'s docstring) — there
is no password.
