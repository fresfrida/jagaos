# Permissions

Real, shipped behavior as of 2026-09-23 (role/permission work, DECISIONS
#64; rounds 12 and 13, 2026-09-24, DECISIONS #77/#79/#80/#83/#85, are in the working tree and not yet committed or deployed) — not the original feature-request text verbatim. Where this task's
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
| See the review queue (open review items) — round 12 | ❌ none | ✅ only items on their own uploads | ✅ all | ✅ all |
| See a document that is still pending review (Company Files, search, file, trace) — round 13 | ❌ | ✅ only their own upload | ✅ all | ✅ all |
| See a document once it is filed | ✅ | ✅ | ✅ | ✅ |
| See a **personal file** (`Only me`) — round 13 | ❌ | ✅ only their own | ✅ only their own — **not** others' | ✅ only their own — **not** others' |
| Resolve the review item of a **personal file** — round 13 | ❌ | ✅ only their own | ✅ only their own (they cannot see others') | ✅ only their own |
| Resolve (accept/reject) a flagged review item | ❌ | ❌ | ✅ | ✅ |
| Archive ("Delete") a document | ❌ | ❌ | ✅ | ✅ |
| Add a team member | ❌ | ❌ | ✅ | ✅ |
| See the Company Settings page | ❌ | ❌ | ✅ read-only | ✅ editable |
| Edit company settings (name, FYE, UEN, GST status, registered address) | ❌ | ❌ | ❌ | ✅ |
| Pre-fill company settings from a confirmed ACRA business profile — round 12 | ❌ | ❌ | ❌ | ✅ |
| Switch between companies — round 12 (only if they hold 2+ memberships; nearly everyone holds one) | own memberships only | own memberships only | own memberships only | own memberships only |

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
- **Document visibility (round 13, DECISIONS #83/#85) — one rule, `auth.may_see_document`, applied at `GET /api/documents`, `GET /api/search`, `GET /api/documents/{id}/file`, `GET /api/trace/{id}`, `PATCH /api/documents/{id}`, `POST /api/documents/{id}/archive`, `POST /api/review/{id}/resolve`, `GET /api/documents/{id}/company-profile`, the review queue and the duplicate-upload answer.** In order: (1) a personal file (`visibility` other than `company`) is visible to its uploader **and no one else — not admin, not owner** (a personal file with no recorded uploader is visible to nobody); (2) a document with status `needs_review` follows the review-queue rule below; (3) everything else is visible to the whole company. A document the caller may not see is **invisible, not forbidden**: left out of lists and a **404** on any direct fetch or action, before any ownership/role 403 — the same as an archived document (#53). A hidden document's id is also never returned in a duplicate-upload answer.
- `GET /api/review` — any authenticated member, **filtered per caller** by `auth.may_see_review_item` (round 12, DECISIONS #80): admin/owner see every open item in the company; a `user` only items on documents they uploaded themselves (`uploaded_by_user_id` equals their id — a document with no recorded uploader is admin/owner-only, deliberately failing closed unlike the edit rule); a `viewer` none.
- `GET /api/auth/companies`, `POST /api/auth/switch-company` — any authenticated member (round 12, DECISIONS #77). The list is the caller's own memberships only, with a group's name only on an owner membership; the switch is 403 for a company the caller has no membership in (the same 403 whether or not it exists). The role afterwards is the one held in the newly active company.
- `GET /api/documents/{id}/company-profile` — `require_role("owner")` **plus** `rules.company_profile.may_prefill_company_from` (round 12, DECISIONS #79): a business-profile document in the caller's own company that a person has already confirmed (`filed`); 404 for another company's or an archived document, 409 for one not yet confirmed. Read-only — it changes nothing; the write is the owner's Save on `PATCH /api/companies/{id}`.
- `POST /api/review/{id}/resolve` — admin+ **plus, since round 13, the uploader of their own personal file** (`auth.may_resolve_review_item`; without it a `user`'s private upload could never leave review — see "Flagged decision 5"); a `thread_id` that is not the item's own is a 400. Otherwise **deliberately
  not extended** to let a `user` resolve their own upload's review item —
  see "Flagged decision 1" below.
- `POST /api/documents/{id}/archive` — `require_role("admin")`, unchanged.
- `POST /api/companies/{id}/members` — `require_role("admin")`, unchanged;
  a second `owner` is a 409 regardless of caller role.
- `PATCH /api/companies/{id}` — **new this round**, `require_role("owner")`; since round 12 it also accepts `uen`, `gst_registered` and `registered_address` (and rejects an empty `name`). It applies to the ACTIVE company only — after a switch, the owner's other companies are 403 until they switch back.

### Read access and every other endpoint — verified live 2026-09-24

Re-checked by mapping every route in `app/main.py` and calling each with a
viewer token against the running server, not from the docs above:

| Endpoint | Floor actually enforced |
|---|---|
| `GET /api/documents`, `/api/search`, `/api/expectations`, `/api/obligations`, `/api/trace/{id}`, `/api/documents/{id}/file`, `/api/auth/me` | any authenticated member — **viewer included** (all 200 for a viewer). **Since round 13 the documents these return are filtered by `auth.may_see_document`** (a pending document for the users the queue hides it from; a personal file for everyone but its uploader) — a hidden document is absent from the lists and a 404 on `/file` and `/trace`, never a 403 |
| `GET /api/review` | any authenticated member, but **since round 12 the result is filtered** (viewer: empty; user: own uploads; admin/owner: all) — the one read endpoint that is no longer uniform |
| `GET /api/companies/{id}/members` | any authenticated member of that company — so a viewer can list teammates' emails and roles |
| `POST /api/documents` | `user` |
| `PATCH /api/documents/{id}` | `user`, plus `auth.may_edit_document` (below) |
| `POST /api/review/{id}/resolve`, `POST /api/documents/{id}/archive`, `POST /api/companies/{id}/members` | `admin` |
| `PATCH /api/companies/{id}` | `owner` |
| `GET /api/companies`, `POST /api/companies` | **removed 2026-09-24** (they had no auth at all) — see "Fixed" below; **confirmed gone on the deployed box too** (a `curl` on 2026-09-24 returned HTTP 404) |

Read access is uniform; only writes are gated. Cross-company access is
refused everywhere by scoping every query to `membership.company_id`, never a
client-supplied id.

**The document-edit rule is now one function** (2026-09-24, round 11):
`auth.may_edit_document(membership, uploaded_by_user_id)` — viewer never;
admin/owner any; `user` only what they uploaded themselves (a document with no
recorded uploader stays editable by a `user`). `PATCH` enforces it, and
`GET /api/documents` / `GET /api/search` return a per-caller `can_edit` from the
same function, so the frontend hides Edit exactly where the server would refuse
(a refused save that still happens shows a translated message). Covered by
`tests/test_document_permissions.py` — 26 tests with real uploads and logins,
including the case that had never been exercised: two accounts of the same role
(`user1`, `user2`) against each other's files. Delete (`archive`) is `admin` with
no per-uploader carve-out, so a `user` cannot delete even their own upload.

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

**4. Review-queue visibility vs the viewer's broad read access (round 12, DECISIONS #80) — DECIDED in round 13 (DECISIONS #83): a pending document is hidden everywhere from the same audience.** What follows is the original analysis, kept for the record. The request was to hide review items from other users and from viewers, and to say whether that conflicts with the viewer's existing broad read. **It does.** The filter hides the queue *card*, but the underlying document is still listed in Company Files and search for every role, and its file bytes (`GET /api/documents/{id}/file`) and trace are still fetchable — so a viewer or another user can still see that a colleague's pending upload exists, read its filename and description, and open it. This is pinned by `tests/test_review_visibility.py::test_the_document_itself_is_still_listed_for_every_role` so that changing it is deliberate. **Not decided here:** hiding a `needs_review` document everywhere for the same audience would change what viewers can read across the app, against the uniform-read-access design above. Needs the user's call.

**5. Who resolves a personal file's review item (round 13, DECISIONS #85) — a permission I added, which the user can veto.** Resolving is admin+ so that a second person checks what a document says (#40). A personal file is visible to its uploader alone, so an admin cannot check it and a plain `user` cannot resolve it — the file would sit in review forever. **Resolved: the uploader may resolve the review item of their own personal file, and nothing else about resolving changes** (a `user` still cannot resolve their own company upload). Rationale: that second pair of eyes protects company records; a personal file is not one, and nobody else can be given the job. Consequence to accept: a personal file is confirmed by the same person who uploaded it.

**6. Personal files and deletion (round 13, DECISIONS #85) — OPEN, parked.** Archiving is admin+ and an admin cannot see someone else's personal file, so a `user`'s *filed* personal file can be deleted by no one (a *pending* one can be rejected by its uploader, which archives it). And if the uploader leaves the company, their personal files are permanently unreachable by anyone, admin and owner included. Both are recorded in `docs/KANBAN.md` as product questions for later, not solved.

## Fixed 2026-09-24 (in the repo; not yet on the deployed box)

**`GET /api/companies` and `POST /api/companies` have no session/role
check at all** — *(fixed and confirmed gone on the live box, 2026-09-24; kept for the record)* **re-verified live 2026-09-24: an anonymous request (no
Authorization header) returned HTTP 200 with all 23 companies in the dev
database — id, name, `uen`, FYE, GST flag. On the internet-reachable Lightsail
box that is every tenant's company list, to anyone.** Confirmed by grep: no `Depends(...)` on either
handler, and neither is called from anywhere in the frontend, a script, or
a test. Pre-existing (not introduced this round), genuinely unauthenticated
company creation/listing sitting in the API surface. Not touched this
round — out of this task's stated scope (adding new enforcement, not
auditing every pre-existing endpoint) and removing/gating a live endpoint
without knowing why it's unauthenticated risked a bigger, riskier change
than asked for. Flagged in `docs/KANBAN.md` Backlog for an explicit call.

**Resolved (DECISIONS #76):** both handlers were **deleted outright** rather
than gated — nothing calls them (re-confirmed by grep across app, web, scripts,
tests, evals and deploy), so there is no legitimate caller to keep access for and
no role check left to stay correct. With no header the same request now returns
404, and `tests/test_route_auth.py` walks every route the app registers and
requires HTTP 401 with no credentials unless the route is on a two-item
allowlist (`/api/health`, `/api/auth/dev-login`), so a handler added without an
auth dependency fails the suite. **Fixed in the repo and confirmed on the deployed box:** a read-only
`curl` on 2026-09-24 got HTTP 404 from the live Lightsail backend's
`/api/companies` (the peer session reported redeploying it itself).

## Seeding test accounts

`python scripts/seed_dev_db.py` (idempotent, safe to re-run) now creates
one account per role — `owner@try-demo.test`, `admin@try-demo.test`,
`user@try-demo.test`, `viewer@try-demo.test` — plus, since 2026-09-24,
`user1@try-demo.test` and `user2@try-demo.test` (two peers of the same role, so
"a user cannot edit another user's file" can be tried against a real peer) —
printing each one's dev-login token. Email is the only "credential" this auth model has (`dev-login` is
a placeholder for real magic-link email, `app/auth.py`'s docstring) — there
is no password.
