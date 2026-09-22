# Kanban

Updated 2026-09-21.

## Backlog
- [ ] **Root planning docs moved to `MDs/`** (user's own reorganization, 2026-09-22 — not a session mistake, confirmed). Every doc/code comment across this repo that references e.g. "`GAPS.md`", "`ARCHITECTURE.md`" by its old root-relative name is now technically pointing at a moved file (they're still readable, just at `MDs/GAPS.md` etc. instead). Not rewritten yet — a lot of references, low urgency since they're still findable, but worth a pass before the write-up/submission cites specific paths.
- [ ] Semantic (not substring) doc_type matching in `app/graph/derive_expectations.py::_matches_doc_type` — the current fix is real but will miss a differently-worded doc_type (e.g. "Reg. of Members" vs `share_register`)
- [ ] Build the review-queue UI in `/ops` (backend resolve path is now verified live — `tests/test_pipeline_review_diagnostic.py` — but there's no frontend for it yet, still Swagger/curl-only)
- [ ] Expand `evals/demo_corpus/` (currently 8 documents) if a bigger synthetic set would strengthen the write-up's Impact & Outcomes numbers — team decision, not a technical blocker
- [ ] Decide whether to load the team's real "19 documents, 14 held" **checklist** (the list of expected doc types, not the actual files) into `app/rules/expectations.py` — currently a small placeholder starter set. The checklist itself isn't personal data the way the documents are, so this may not have the same privacy concern the team raised about uploading real documents.
- [ ] Scheduler (`APScheduler`) + Telegram bot — "the clock" per `MOAT.md`'s one-liner; nothing plays the escalation-ladder demo beat without it
- [ ] Multi-user layer from `PLATFORM.md` (`user`, `membership`, `session`, magic links, hash-chained `audit_log`) — deferred until the core loop above is proven on a real document
- [ ] Golden-path eval cases (`evals/cases/golden/`) — needs ~15 labelled real documents once the gateway is confirmed working
- [ ] Swap `MemorySaver` for a durable LangGraph checkpointer before relying on human-review pause/resume past a demo session
- [ ] Fill in `docs/WRITEUP.md` (write-up PDF draft) as real KPIs/timestamps land; keep its claim↔evidence table in sync with `SUBMISSION.md` §3
- [ ] Confirm on Slack whether the separate "Proposal form" (QR code) duplicates the write-up PDF or asks something distinct
- [ ] Decide if the fade-in should become a cross-fade (needs a layout approach that avoids the height gap)
- [ ] Validate the Caddy catch-all serves `/calendar` etc. on the Lightsail box (`caddy validate`, then curl a deep path)
- [ ] Decide whether `/how-it-works` and `/stack` need header/landing links or should be dropped
- [ ] **Migrate UAT to AWS Lightsail (production)**, steps in `docs/UAT-DEPLOYMENT.md`: provision box, deploy `web/dist` behind Caddy, access control, run the Lightsail checklist, submit the URL as evidence, then retire the Vercel UAT
- [ ] Commit the route-based build (waiting for an explicit request)
- [ ] Decide whether the landing should also link How it works / Stack
- [ ] Add lint + a test runner (vitest) and cover `parseHash` and `memoryMatching`
- [ ] Real Log In page (currently a placeholder anchor)
- [ ] If wanted: separate routes/pages for Calendar and Tags instead of one frame with two tabs
- [ ] Replace `mockSearchService` with a fetch to a real endpoint once `app/` has one (recall graph, ARCHITECTURE.md §3, not built yet)
- [ ] Real sign-in page (magic link) behind "Sign In"
- [ ] Pricing / Security / Use Cases sections or pages; repoint nav links
- [ ] Footer link targets
- [ ] Self-host fonts (drop Google Fonts request)
- [ ] Add `.env` handling on the backend (gateway key stays server-side)
- [ ] Lint + unit tests for `memoryMatching.ts`
- [ ] Decide PWA scope (service worker / offline) or remove manifest

## Doing
- (none)

## Done
- [x] 2026-09-22 GitHub repo created and everything pushed: `github.com/fresfrida/jagaos` (private), `main` branch, AWS Innovation Sandbox access confirmed working (`aws sts get-caller-identity`, account 443670029323, role via IAM Identity Center SSO). One commit, 106 files — the full backend, evals, tests, and the already-in-progress frontend routing work that was sitting uncommitted.
- [x] 2026-09-22 Vercel `jagaos` connected to `github.com/fresfrida/jagaos` for git-based auto-deploy (needed two manual owner steps first: a GitHub login connection on the Vercel account, then installing the Vercel GitHub App with access to the repo — neither doable from the CLI). Root Directory set to `web` (the repo is no longer web-only). Deployment protection re-verified `all` via the API afterward — held, did not reset.
- [x] 2026-09-21 backend skeleton (`app/`, `ARCHITECTURE.md` §9 layout): SQLite schema (10 tables), Pydantic tool contracts, gateway client with cost accounting, local text extraction (pdfplumber/pytesseract/EXIF), injection guardrail, statutory-calendar + gap-analysis rules, authority-separated status transitions, full LangGraph pipeline (ingest→classify→extract→verify→human_review→derive_events→derive_expectations→derive_obligations→archive) with `interrupt()`, FastAPI endpoints. Installed into conda env `agent`.
- [x] 2026-09-21 verified without a gateway key: `pytest tests/test_rules_smoke.py` (5/5 — schema, Annual Return date math, injection guardrail, obligation transition authority separation) and `python evals/run.py` (10/10 adversarial — injection + GST arithmetic; eval suite caught and fixed one real regex gap).
- [x] 2026-09-21 **verified live against the real gateway, all three LLM nodes**: classify→extract→verify on a synthetic invoice (7/7 fields, citations, GST check passed) and derive_events on a synthetic statutory letter (correct event kind + date). Found and fixed two real bugs in the process — `haiku`/`sonnet` model aliases rejected (only `sonnet4.5` approved for this key), and tool calls silently truncate without explicit `max_tokens` (now set to 2048). Both documented in `GAPS.md` §11.
- [x] 2026-09-21 **full pipeline run through the real FastAPI app on a synthetic demo corpus** ("Bright Harbour Pte Ltd", `evals/demo_corpus/` — used instead of the team's real documents, privacy). 8 documents, real gateway calls throughout. Found and fixed three more bugs: `main.py` never detected a paused human-review (langgraph 0.2.60 doesn't return `__interrupt__` the way assumed — fixed by reading `document.status`); gap analysis never matched a document to its expectation (free-text doc_type vs fixed slug — fixed with normalized substring matching, not complete); a gap that closed later never got re-checked (expectation status was write-once — fixed with a reconciliation pass). Verified correct result: 2/6 expected documents held, GST-mismatch invoice routed to review, injection attempt quarantined inside the real flow (not just the isolated eval), 2 obligations derived, $0.125 total cost across 8 documents. `pytest tests/` 9/9, `evals/run.py` 10/10. Full report: `evals/demo_corpus/RESULTS.md`.
- [x] Decide schema-to-SQLite mapping — resolved by `app/db.py`; Postgres-flavoured `DB/` screenshots translated (uuid→INTEGER PK, RLS→app-layer `company_id` scoping, `vector(1536)`→deferred to recall graph, not yet built)
- [x] 2026-09-21 fixed layout shift between pages (scrollbar gutter, instant swap + fade, footer min-height, constant tab weight); measured before/after with classic scrollbars; deployed to UAT and re-measured on the deployed bytes
- [x] 2026-09-21 path routes deployed to UAT; direct hits verified through the Vercel SPA rewrite
- [x] 2026-09-21 real path routes (`/`, `/calendar`, `/tags`, plus `/how-it-works`, `/stack`, `/get-started`); no `#` routes; header tabs Calendar + Tags; hero CTAs "Calendar in Time" / "Relevant Tags" link to `/calendar` and `/tags`; `web/vercel.json` SPA rewrite added. Verified locally (typecheck, build, browser run). **Not committed, not deployed.**
- [x] 2026-09-21 landing is hero-only (one viewport, no scroll); Calendar, Tags, How it works, Stack and Get Started are separate hash-route pages with a shared frame shell and link bar; footer only on inner pages; not-found page. Verified locally (typecheck, build, browser run). **Not committed, not deployed.**
- [x] 2026-09-21 landing changes: hero exactly one viewport; nav + mobile menu removed; Log In; View Calendar / View Tags as real `#calendar` / `#tags` links; deployed to the Vercel **UAT** environment (Vercel's `--prod` target, not our production) behind login (protection `all`), placeholder retired
- [x] Git repo initialised, first commit made locally (no remote yet)
- [x] Vercel UAT: placeholder on public alias, real app on protected preview (verified 2026-09-21: preview 302 logged-out, alias 200 placeholder, root files 200)
- [x] Discovery: inspected docs, DB screenshots, assets; reconciliation agreed
- [x] `web/` scaffold: Vite + React + TS strict + Tailwind v4 + Framer Motion + Lucide
- [x] Sections: Header, Hero, MemorySearch, ProductPreview (Calendar/Tags), HowItWorks, StackList, FinalCTA, Footer
- [x] Shared matching helper for tag / search / calendar detail
- [x] Typecheck + production build pass; browser checks at 1280 / 768 / 390 (no overflow, no console errors)
- [x] Python 3.11 `.venv` created at repo root
- [x] Product renamed to JagaOS (display name only; infra identifiers keep `jaga`)
- [x] docs/HANDOFF, KANBAN, DECISIONS
- [x] UAT policy (`docs/UAT-DEPLOYMENT.md`), Caddyfile catch-all fix, `scripts/prepush-check.sh`, `.vercel/` git-ignored

## Blocked / needs a decision
- [ ] Lightsail migration needs: spend approval (~$24/mo of the USD 100 credit; AWS access path resolved 2026-09-22, see Done) and a decision on UAT access control there.
- [ ] Repo is private for now (`github.com/fresfrida/jagaos`) — flip to public + add a license (MIT/Apache-2.0, `SUBMISSION.md` §5) before the 28 Sep submission. Decide whether the root strategy docs (`STRATEGY.md`, `WINNING.md`, `MOAT.md`) belong in a public repo, and re-run `scripts/prepush-check.sh` (also update it — it currently flags `.env`/`.vercel` by mere existence, not by git-tracked status, which is now a false positive now that local dev needs `.env`) before flipping visibility.
- [ ] Standing rule (DECISIONS #26): deploy every change to UAT with `vercel deploy --prod --yes` from `web/` (Vercel's target name; this is UAT), then check logged-out 302 and a deep path. Delete `web/.vercel/` before any git push.
- [x] Vercel team scope is now `fresfrida` (renamed 2026-09-21; team ID unchanged). Local CLI link still valid: project `jagaos` is found under `fresfrida`. Dashboard: vercel.com/fresfrida.
- [ ] Old Vercel project `jaga` is being retired: never deploy to it. The UAT project is `jagaos` under scope `fresfrida`.
- [ ] Names may still appear inside screenshots/PDFs in `admin/`, `Kiro/`, `DB/` (images not scanned). Check before making the repo public.
- [ ] **Caddy vs Nginx:** brief says Nginx; `deploy/` is Caddy.
- [ ] Validate the edited `deploy/Caddyfile` with `caddy validate` on the Lightsail box (edit made 2026-09-21, not yet validated).
- [ ] Ask organisers if a non-AWS preview host is acceptable for internal UAT (see `docs/UAT-DEPLOYMENT.md`).
- [ ] Confirm with organisers whether Jev / `langchain-typesafe` is within the allowed-usage list (GAPS §5 lists only Lightsail + Bedrock).
