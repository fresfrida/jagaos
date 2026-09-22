# Handoff

Last updated: 2026-09-21. Read this first when resuming.

## What this is

**JagaOS** — company memory for SMEs: capture documents, conversations, invoices and decisions, then retrieve them with natural-language search and cited sources.

This repo currently holds:
- **Planning docs** at the root (`ARCHITECTURE.md`, `PLATFORM.md`, `UI-SPEC.md`, `GAPS.md`, ...). Written for the earlier "JagaOS = Singapore corp-sec records keeper" concept. Useful context, not automatically current. `GAPS.md` §5 is still binding.
- **`web/`** — the marketing landing page + interactive product preview (this session's work). Frontend only, mock data.
- **`app/`** — backend skeleton (2026-09-21), per `ARCHITECTURE.md` §9. See "Backend status" below.
- **`evals/`** — eval runner + adversarial cases, `evals/report.md` committed (10/10 passing, no gateway key needed).
- **`tests/`** — pytest smoke tests for the deterministic core (DB schema, statutory rules, injection guardrail, authority-separated transitions). 5/5 passing.
- **`deploy/`** — Lightsail provisioning (Caddy, systemd, `bootstrap.sh`). Untouched.
- **Python env** — conda env `agent` (Python 3.11.16), `requirements.txt` installed.
- **`DB/`** — schema screenshots (source of truth for tables; no SQL file exists). `app/db.py` implements the SQLite translation per `ARCHITECTURE.md` §2.

## Backend status (2026-09-21)

The core loop from `ARCHITECTURE.md` §3 is wired end to end: `ingest` (hash,
dedupe, pdfplumber/OCR/EXIF, no LLM) → `classify` (haiku) → `extract`
(sonnet4.5) → `verify` (deterministic: GST arithmetic, confidence floor,
injection scan) → `human_review` (LangGraph `interrupt()`) → `derive_events`
(sonnet4.5) → `derive_expectations` (deterministic gap analysis) →
`derive_obligations` (deterministic statutory clock) → `archive`. FastAPI
exposes it at `/api/documents` (upload), `/api/review/*` (resolve),
`/api/expectations`, `/api/obligations`, `/api/trace/{document_id}`.

**Verified without a gateway key** (`pytest tests/test_rules_smoke.py`,
`python evals/run.py`): DB schema creates all ten tables; the Annual Return
rule computes FYE + 7 months correctly; the injection guardrail catches the
five adversarial phrasings in `evals/cases/adversarial/injection.yaml`
(10/10, including one gap the eval suite itself found and that got fixed —
`app/guards/injection.py`'s regex list); GST arithmetic mismatches are
flagged; the `satisfied → open` obligation transition is correctly rejected
(authority separation, §5.2).

**Verified live against the real gateway** (2026-09-21, `tests/test_gateway_live.py`,
`.env` filled from the kickoff screenshots): classify → extract → verify
runs end to end on a synthetic invoice — correct lane, all 7 fields
extracted with citations and confidence, GST arithmetic checked, no false
review flag. **Two real bugs found and fixed in the process — see `GAPS.md`
§11**: (a) only the `sonnet4.5` model is approved for this team's key,
`haiku`/`sonnet` are rejected, so the cheap-routing design has no cost
saving to claim; (b) tool calls need an explicit `max_tokens` (now 2048 in
`app/llm.py`) or the gateway silently truncates a multi-field extraction —
this looked exactly like a schema bug and cost real debugging time.

**`derive_events` also verified live** (2026-09-21): a synthetic ACRA
notice of registered-office change correctly produced one `office_move`
event with the right date. All three LLM nodes in the pipeline
(classify/extract/derive_events) are now confirmed working against the
real gateway.

**Full pipeline run through the real FastAPI app** (2026-09-21,
`evals/demo_corpus/`): 8 synthetic documents for a fictional SME, "Bright
Harbour Pte Ltd" — used instead of the team's real documents (privacy;
see `WINNING.md`'s "clearly-labelled active-SME corpus"). Uploaded through
`/api/documents` via `TestClient`, not called as bare functions. Results
in `evals/demo_corpus/RESULTS.md`, regenerate with
`python evals/demo_corpus/run.py`. `pytest tests/` is 9/9.

This run found and fixed three more real bugs, on top of the two in
`GAPS.md` §11:
1. **`main.py` never detected a paused review.** `langgraph==0.2.60`'s
   `PIPELINE.invoke()` does not return a `"__interrupt__"` key the way the
   original code assumed — it just stops early with a partial state (the
   pause itself is real: `derive_events`/obligations correctly never ran).
   Fixed by reading `document.status` from the DB instead, which
   `verify.py` sets unconditionally.
2. **Gap analysis never matched a document to its expectation.**
   `classify`'s `doc_type` is free text ("ACRA Certificate of
   Incorporation"); `expectation.doc_type` is a fixed slug
   (`certificate_of_incorporation`). Exact-match never matched, so every
   expectation showed "missing" even when the document was right there.
   Fixed with normalized-slug substring matching in
   `app/graph/derive_expectations.py` — real but not complete; a
   differently-worded doc_type could still miss. Semantic matching is the
   proper long-term fix.
3. **A gap that closed later never got re-checked.** Expectation status
   was set once, at creation time, against whatever documents existed
   *then*. The constitution document, uploaded after the incorporation
   event (from a different document) had already created a "missing"
   Company Constitution row, stayed "missing" forever. Fixed with a
   reconciliation pass that re-checks open gaps against currently-held
   documents on every ingest.

**Verified real result on the demo corpus**: 2 of 6 expected documents
held (gap analysis correct), one GST-mismatch invoice correctly routed to
human review (not silently accepted), one injection-attempt invoice
correctly quarantined **inside the real product flow** — not just the
isolated eval case — with the obligation table untouched, 2 statutory
obligations derived with citations, total LLM cost $0.125 across 8
documents (≈1.6¢/document, placeholder pricing).

**Known gaps, in the order they'll bite:**
- `evals/cases/golden/` is empty — needs ~15 labelled real documents (see `evals/cases/golden/README.md`)
- `app/rules/expectations.py`'s expected-document-set is a small starter list, **not** the team's real "19 documents, 14 held" checklist — that external data needs to be loaded in before the gap-analysis demo means anything
- No scheduler (`APScheduler`), no Telegram bot — "the clock" (the actual agent, per `MOAT.md`'s one-liner) doesn't exist yet
- No multi-user/auth layer (`PLATFORM.md`) — single-tenant only, `company_id` passed as a plain query param, no session/membership tables
- `LangGraph` checkpointer is `MemorySaver` — a pending human review is lost on server restart; fine for a demo, not for the deployed box without a swap to a durable checkpointer
- `app/rules/statutory.py`'s Form C-S/C due date (30 Nov) is a working approximation, flagged in its own docstring — confirm before citing a specific date in `docs/WRITEUP.md`
- `app/llm.py`'s per-token pricing is Anthropic list pricing, not confirmed as the gateway's actual billed rate

## Environments

- **UAT:** Vercel project `jagaos` (scope `fresfrida`), behind Vercel login. Frontend only.
- **Production:** AWS Lightsail per GAPS §5. **Not built yet.** UAT will be migrated to it later (plan: `docs/UAT-DEPLOYMENT.md`, "Migrating UAT to AWS Lightsail").
- Vercel's "production" target (`--prod`) is only how UAT is published. The Vercel site is UAT, not production.

## Architecture (intended)

One AWS Lightsail instance (Ubuntu 24.04, `ap-southeast-1a`). Allowed AWS usage: Lightsail + JSON calls to Bedrock Claude Sonnet 4.5 only (GAPS §5). SQLite + local disk. Python backend (FastAPI). Vite/React static build served by the reverse proxy. Supabase is **not** used (see DECISIONS.md).

## Data flow

- **Implemented (web/):** routing: real URL paths (`/`, `/calendar`, `/tags`, `/how-it-works`, `/stack`, `/get-started`), no `#` routes. `Link` intercepts clicks and calls `navigate` (History API); `useRoute` listens to `popstate` and parses the path; `pages/Page.tsx` maps a route to a page; `useRouteEffects` sets the title, scrolls to top and focuses `<main>`. Direct hits need an SPA fallback to `index.html` (Vite dev/preview: built in; Caddy: catch-all `handle`; Vercel: `web/vercel.json`). Search: `MemorySearch` → `useMemorySearch` → `searchService` (mock, 450 ms latency) → `filterMemories` over `MEMORIES`. Tag list and calendar detail panel read the same mock data through the same helper.
- **Documented, not built:** upload/Telegram → FastAPI → extraction (Bedrock) → validation (Jev) → SQLite + disk → FTS5 search. See `ARCHITECTURE.md` §3.

## Where the main logic lives (web/src)

| Concern | File |
|---|---|
| Product name (single constant) | `config/product.ts` |
| Nav, copy, stack rows, footer content | `config/site.ts` |
| Shared matching rules (tag / query / event relations) | `features/memories/memoryMatching.ts` |
| Mock memories + tags | `features/memories/mockData.ts` |
| Event → documents/decisions rule | `features/calendar/eventRelations.ts` |
| Search boundary (swap mock for real API here) | `features/search/searchService.ts` |
| Routes, path parsing, page titles, header tabs | `router/routes.ts` (`ROUTES`, `TAB_ROUTES`, `parsePath`) |
| Client-side navigation | `router/Link.tsx`, `router/navigate.ts`, `router/useRoute.ts`, `router/useRouteEffects.ts` |
| Route → page mapping; shared frame shell | `pages/Page.tsx`, `pages/FramePage.tsx` |
| App window chrome around Calendar/Tags | `features/preview/ProductFrame.tsx` |
| Reusable UI | `components/ui/*` (Button, Badge, Card, Container, Reveal, EmptyState, MemoryCard, SourceLabel, Logo) |

## Commands (run in `web/`)

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc, strict (there is no lint or test runner yet)
npm run build        # typecheck + production build to web/dist
npm run preview      # serve dist on :4173
```

Python (nothing to run yet): `conda activate agent` (conda env, Python 3.11, lives outside the repo at `/opt/anaconda3/envs/agent`).

## Deployment notes

- **Vercel UAT (login required):** project `jagaos`, scope `fresfrida`. The `.vercel.app` alias serves the real app; project protection is `all`, so logged-out requests get 302 to Vercel login (verified 2026-09-21). The placeholder page is retired. Runbook and post-deploy check: `docs/UAT-DEPLOYMENT.md`. Real production = AWS Lightsail (GAPS §5), not deployed yet; migrate UAT there later.
- **The UAT URL serves the current working tree** (path routes + layout-shift fix), deployed 2026-09-21 under the standing rule "deploy every change to UAT" (DECISIONS #26). Direct hits like `/calendar` work through `web/vercel.json` (verified). Unknown paths return HTTP 200 with the Not found page (SPA soft-404). **The code is not committed** (latest commit `2bf00b3` is older than what is live).
- Git: local repo initialised 2026-09-21 with one commit; **no remote configured, nothing pushed**. Commit and push still need an explicit request. `web/.vercel/` exists locally for deploys: delete it before any push (the pre-push check fails while it exists). Local author is the neutral `JagaOS`.
- `bootstrap.sh` puts the static site in `/var/www/jaga/web`; copy `web/dist/*` there.
- `deploy/Caddyfile` was edited 2026-09-21 so root static files are served (catch-all `handle`). **Not yet validated** with `caddy validate`; do that on the box.
- UAT and deployment rules (Vercel policy, Lightsail checklist, pre-push check): `docs/UAT-DEPLOYMENT.md`. Run `./scripts/prepush-check.sh` before any push.
- Reverse proxy: `deploy/` uses Caddy; the original brief said Nginx. Undecided, see DECISIONS.md.

## Known risks

- Header: logo, tabs Calendar and Tags (`aria-current` on the active one), Log In, Get Started (hidden on phones). The old nav (Product, Use Cases, Security, Stack, Pricing) is gone. The landing (`/`) is hero-only. `/how-it-works`, `/stack` and `/get-started` still exist but have no header tab; they are reached from the footer (Guides, Security) and "Log In". Other footer labels are plain-text placeholders.
- The landing has no footer and no scroll, but the hero grows if search results are shown on a very short viewport (verified fine at 1440x900).
- DB schema screenshots are Postgres-flavoured (uuid, enums, `vector(1536)`, RLS, Supabase `auth_subject`); the chosen store is SQLite. Mapping is unresolved.
- Python version drift: `ARCHITECTURE.md` says 3.11, `bootstrap.sh` installs 3.12, conda env `agent` is 3.11.15.
- Fonts load from Google Fonts at runtime (external request).
- PWA is manifest + icon only; no service worker, no offline behaviour.
- Screenshots in `docs/screenshots/` were taken with headless Chrome against `vite preview`.

## How to resume

1. `cd web && npm install && npm run dev`
2. Read `docs/KANBAN.md` (Doing / Blocked) and `docs/DECISIONS.md`.
3. Next real milestone: backend skeleton + resolve the schema-to-SQLite mapping, then replace `mockSearchService`.
