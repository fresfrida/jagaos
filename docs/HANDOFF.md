# Handoff

Last updated: 2026-09-21. Read this first when resuming.

## What this is

**JagaOS** — company memory for SMEs: capture documents, conversations, invoices and decisions, then retrieve them with natural-language search and cited sources.

This repo currently holds:
- **Planning docs** at the root (`ARCHITECTURE.md`, `PLATFORM.md`, `UI-SPEC.md`, `GAPS.md`, ...). Written for the earlier "JagaOS = Singapore corp-sec records keeper" concept. Useful context, not automatically current. `GAPS.md` §5 is still binding.
- **`web/`** — the marketing landing page + interactive product preview (this session's work). Frontend only, mock data.
- **`deploy/`** — Lightsail provisioning (Caddy, systemd, `bootstrap.sh`). Untouched.
- **Python env** — conda env `agent` (Python 3.11), empty, for the future backend. No `requirements.txt` yet.
- **`DB/`** — schema screenshots (source of truth for tables; no SQL file exists).

There is **no backend yet**.

## Architecture (intended)

One AWS Lightsail instance (Ubuntu 24.04, `ap-southeast-1a`). Allowed AWS usage: Lightsail + JSON calls to Bedrock Claude Sonnet 4.5 only (GAPS §5). SQLite + local disk. Python backend (FastAPI). Vite/React static build served by the reverse proxy. Supabase is **not** used (see DECISIONS.md).

## Data flow

- **Implemented (web/):** navigation: hero/header/bottom CTAs are real links (`#calendar`, `#tags`); `usePreviewNavigation` keeps the frame mode in the URL hash, scrolls to the frame and focuses its tab (deep links and the back button work). Search: `MemorySearch` → `useMemorySearch` → `searchService` (mock, 450 ms latency) → `filterMemories` over `MEMORIES`. Tag list and calendar detail panel read the same mock data through the same helper.
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
| Preview mode switching, URL hash, scroll + focus | `features/preview/usePreviewNavigation.ts`, `PreviewLink.tsx`, `ProductPreview.tsx` |
| Reusable UI | `components/ui/*` (Button, Badge, Card, Container, Reveal, EmptyState, MemoryCard, SourceLabel, Logo) |

## Commands (run in `web/`)

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc, strict
npm run build        # typecheck + production build to web/dist
npm run preview      # serve dist on :4173
```

Python (nothing to run yet): `conda activate agent` (conda env, Python 3.11, lives outside the repo at `/opt/anaconda3/envs/agent`).

## Deployment notes

- **Vercel UAT (login required):** project `jagaos`, scope `fresfrida`. The production alias serves the real app; project protection is `all`, so logged-out requests get 302 to Vercel login (verified 2026-09-21). The placeholder page is retired. Runbook and post-deploy check: `docs/UAT-DEPLOYMENT.md`. Real production = AWS Lightsail (GAPS §5), not deployed yet.
- Git: local repo initialised 2026-09-21 with one commit; **no remote configured, nothing pushed**. Local author is the neutral `JagaOS`.
- `bootstrap.sh` puts the static site in `/var/www/jaga/web`; copy `web/dist/*` there.
- `deploy/Caddyfile` was edited 2026-09-21 so root static files are served (catch-all `handle`). **Not yet validated** with `caddy validate`; do that on the box.
- UAT and deployment rules (Vercel policy, Lightsail checklist, pre-push check): `docs/UAT-DEPLOYMENT.md`. Run `./scripts/prepush-check.sh` before any push.
- Reverse proxy: `deploy/` uses Caddy; the original brief said Nginx. Undecided, see DECISIONS.md.

## Known risks

- The header has no nav (removed 2026-09-21). "Log In" and all footer links are placeholders. With no nav, sections below the hero are reached by scrolling or the `#calendar` / `#tags` links.
- DB schema screenshots are Postgres-flavoured (uuid, enums, `vector(1536)`, RLS, Supabase `auth_subject`); the chosen store is SQLite. Mapping is unresolved.
- Python version drift: `ARCHITECTURE.md` says 3.11, `bootstrap.sh` installs 3.12, conda env `agent` is 3.11.15.
- Fonts load from Google Fonts at runtime (external request).
- PWA is manifest + icon only; no service worker, no offline behaviour.
- Screenshots in `docs/screenshots/` were taken with headless Chrome against `vite preview`.

## How to resume

1. `cd web && npm install && npm run dev`
2. Read `docs/KANBAN.md` (Doing / Blocked) and `docs/DECISIONS.md`.
3. Next real milestone: backend skeleton + resolve the schema-to-SQLite mapping, then replace `mockSearchService`.
