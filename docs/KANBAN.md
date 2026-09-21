# Kanban

Updated 2026-09-21.

## Backlog
- [ ] Real Log In page (currently a placeholder anchor)
- [ ] If wanted: separate routes/pages for Calendar and Tags instead of one frame with two tabs
- [ ] Decide schema-to-SQLite mapping (see Blocked) and write the migration SQL
- [ ] Backend skeleton in `app/` (FastAPI) + `requirements.txt`; install into `.venv`
- [ ] Replace `mockSearchService` with a fetch to `/api/search` (FTS5)
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
- [x] 2026-09-21 landing changes: hero exactly one viewport; nav + mobile menu removed; Log In; View Calendar / View Tags as real `#calendar` / `#tags` links; deployed to Vercel production alias behind login (protection `all`), placeholder retired
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
- [ ] **Push blocked: no git remote.** Need the remote URL (and confirmation of which branch). Also decide whether the root strategy docs (`STRATEGY.md`, `WINNING.md`, `MOAT.md`) belong in a public repo.
- [ ] Redeploy from `web/` with `vercel deploy --prod --yes` after `vercel link --yes --project jagaos` (the local `web/.vercel/` was deleted so the pre-push check passes). Then run the logged-out check in `docs/UAT-DEPLOYMENT.md`.
- [x] Vercel team scope is now `fresfrida` (renamed 2026-09-21; team ID unchanged). Local CLI link still valid: project `jagaos` is found under `fresfrida`. Dashboard: vercel.com/fresfrida.
- [ ] Old Vercel project `jaga` is being retired: never deploy to it. The UAT project is `jagaos` under scope `fresfrida`.
- [ ] Names may still appear inside screenshots/PDFs in `admin/`, `Kiro/`, `DB/` (images not scanned). Check before making the repo public.
- [ ] **Schema on SQLite:** `DB/` screenshots use Postgres types (uuid, enums, `vector(1536)`, RLS, `auth_subject` = "Supabase auth user ID or AWS identity subject"). Needs a decision: translate to SQLite (tenant checks in the repository layer, FTS5 instead of pgvector) or ask organisers whether Postgres on the Lightsail box is acceptable.
- [ ] **Caddy vs Nginx:** brief says Nginx; `deploy/` is Caddy.
- [ ] Validate the edited `deploy/Caddyfile` with `caddy validate` on the Lightsail box (edit made 2026-09-21, not yet validated).
- [ ] Ask organisers if a non-AWS preview host is acceptable for internal UAT (see `docs/UAT-DEPLOYMENT.md`).
- [ ] Confirm with organisers whether Jev / `langchain-typesafe` is within the allowed-usage list (GAPS §5 lists only Lightsail + Bedrock).
