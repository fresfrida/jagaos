# UAT and deployment policy

Written for: the team and anyone pushing to git.
Status: **tentative**, agreed 2026-09-21, updated same day (placeholder retired). The one **final** rule: the Lightsail URL is the only deployment evidence (GAPS §5, SUBMISSION §1).

## Environments

| | Where | Purpose | State |
|---|---|---|---|
| **UAT** | Vercel project `jagaos` (scope `fresfrida`), behind Vercel login | Testers review the frontend | Live |
| **Production** | AWS Lightsail (`ap-southeast-1`), per GAPS §5 | The real deployment and the submission evidence | Not built yet |

**Terminology:** Vercel calls its default publish target "production" (`vercel deploy --prod`). That is only how the UAT site is published to the `.vercel.app` alias. In our docs and reports, the Vercel site is **UAT**; "production" means AWS Lightsail only.

## Rules

1. **Lightsail is the only real deployment.** The submission's "Deployment evidence / URL" is the Lightsail instance. Nothing else is ever cited as evidence.
2. **Vercel is UAT only.** The UAT copy of the frontend runs on Vercel behind a login. Real production is AWS Lightsail (GAPS §5). Never cite the Vercel URL in the README, write-up, video, slides or the submission's deployment-evidence field.
3. **Sign-off happens on Lightsail.** A Vercel pass means "looks right". It does not mean "accepted". Final UAT sign-off requires the checklist below on the Lightsail URL.
4. **The product pages are same-origin; `/ops` is a deliberate, documented exception.** `/` and the marketing pages called relative `/api/...` against mock data — no absolute API URLs, no CORS allowance, no `*.vercel.app` in backend config, unchanged. (The mock-data Calendar and Tags pages are gone since DECISIONS #106, and the app pages call the backend at `VITE_API_BASE_URL`; this rule's premise is older than that.) **`/ops`** (added 2026-09-22, `web/src/features/ops/`) is a real backend test console, not part of the product — it calls an absolute `VITE_API_BASE_URL` and `app/main.py` allows `https://jagaos.vercel.app` in CORS so it *can* work once the backend is publicly reachable. It doesn't work yet (backend is localhost-only) — see `docs/HANDOFF.md`'s callout. Don't read this exception as license to loosen rule 4 for the actual product pages.
5. **Frontend only on Vercel.** No backend, no secrets, no env values, no real data, for the product pages. The `/ops` exception above is dev tooling, not the product, and still carries no secrets (the gateway key lives in the backend's own `.env`, never in `web/`).
6. **Standing permission (2026-09-21, "for now"):** every change is deployed to the UAT (Vercel `jagaos`, behind login) so the owner can see it. Nothing else is pre-approved: commits, pushes, any new URL, and any other host still need an explicit yes. Withdraw this rule when the owner says so.
7. **(2026-09-22) Testing shifted to the deployed UAT URL, not `npm run dev`.** The owner tests on their phone against `https://jagaos.vercel.app`, so it needs to stay current — this is why git-based auto-deploy (below) matters now. `npm run dev` is still fine for active local iteration, but isn't what gets checked on the phone until it's pushed and deployed.

## Why (the four risks this mitigates)

| Risk | Mitigation |
|---|---|
| A non-AWS host URL in the repo or submission invites a GAPS §5 question | Rule 2, protection level `all`, `.vercel/` and `vercel.json` are git-ignored, `scripts/prepush-check.sh` fails on any `vercel.app` string |
| Vercel cannot be the deployment evidence | Rule 1, cutover checklist |
| UAT on Vercel tests a different serving path than production | Rule 3. `deploy/Caddyfile` now serves root static files (the icons, `manifest.webmanifest`) via a catch-all `handle`, and the Lightsail checklist tests that path |
| Backend on Lightsail + frontend on Vercel needs cross-origin setup | Rules 4 and 5. Vercel never talks to the API; once the backend exists, UAT moves to Lightsail where Caddy serves site and `/api/*` on one origin |

## Vercel UAT deployment (login required)

Project `jagaos` under scope `fresfrida` is the **UAT environment**. Its `.vercel.app` alias (`https://jagaos.vercel.app`) serves the real app (the frontend) behind Vercel Authentication. The earlier placeholder page is **retired** (2026-09-21).

**Why this is safe now:** the project's Deployment Protection level is `all` (API value; dashboard: Vercel Authentication → All Deployments). Under the earlier level, `all_except_custom_domains` (Standard Protection), the production alias was public even with protection "on". Do not lower it. **Re-verify this setting holds after connecting git deploy below** — a repo-connection change is a plausible place for a protection setting to silently reset; don't assume it carries over unchecked.

**Deploy mechanism, as of 2026-09-22: switching from manual CLI to git-based auto-deploy.** Historically every deploy was a manual `vercel deploy --prod --yes` from `web/`. The owner now wants every push to `main` (`github.com/fresfrida/jagaos`) to deploy automatically, so the phone-tested UAT URL always reflects what's pushed. Status: blocked on a one-time manual step — the `fresfrida` Vercel account needs a GitHub login connection added via the dashboard (Account Settings → Login Connections) before `vercel git connect` will succeed; the CLI cannot do this step. Once connected, also set the project's Root Directory to `web` (the repo is no longer web-only — `app/`, the Python backend, now lives at root too, and a git-based build checks out the whole repo).

Manual deploy (still works, useful if auto-deploy is ever down or for a one-off preview) — from `web/`:

```bash
npm run typecheck && npm run build     # must pass first
vercel deploy --prod --yes             # Vercel's default target: publishes UAT to the .vercel.app alias (login required). NOT our production
```

After **every** deploy, verify logged out, expect 302/401 and never 200:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.vercel.app/
```

Then verify the content with the CLI (it handles the login): `vercel curl https://<project>.vercel.app/`.

- If the alias ever returns 200 logged out, remove the deployment at once (`vercel remove <deployment-url> --yes`) and re-check the protection level via `vercel api /v9/projects/<project>` (`ssoProtection.deploymentType` must be `all`).
- Vercel URLs contain the scope name. Do not paste them anywhere public.
- After a deploy, also check a deep path on the UAT URL with `vercel curl https://<project>.vercel.app/calendar` (expect the app's HTML, not a 404).
- Frontend only: no backend, secrets, env values or real data. Never deploy to the retired `jaga` project.
- `.vercel/` stays uncommitted (git-ignored). `web/vercel.json` (SPA rewrite so `/calendar` and `/company-files` work on a direct hit) is the one Vercel file that IS committed; it contains no URLs or secrets. `web/.vercel/` must be deleted before any git push (`scripts/prepush-check.sh` fails while it exists); relink with `vercel link --yes --project jagaos`.
- Do not add a custom domain. Delete the deployment when Lightsail UAT starts.

## Migrating UAT to AWS Lightsail (production)

The frontend is static (`web/dist`) with path routes (`/calendar`), so the host needs an SPA fallback: the Caddyfile's last `handle` (`try_files {path} /index.html`) already provides it. Verify a deep path after deploy (`curl -I https://<host>/calendar` returns 200). Steps, each needing your approval where it spends money or publishes:

1. Provision the Lightsail instance and run `deploy/bootstrap.sh` (`LIGHTSAIL.md`). Confirm the Python version (3.11 vs 3.12) first.
2. Build (`npm ci && npm run build` in `web/`) and copy `dist/*` to `/var/www/jaga/web`; compare the tracked `deploy/Caddyfile` with the box's (see the checklist below), validate it (`caddy validate`) and reload.
3. Put access control in front while it is still UAT-like (Caddy `basic_auth`, or restrict by IP); Vercel login no longer applies.
4. Run the checklist below on the Lightsail URL and attach screenshots.
5. Backend arrives: `/api/*` is proxied by Caddy on the same origin (rule 4).
6. Put the Lightsail URL in the submission's deployment-evidence field (SUBMISSION §1).
7. Retire Vercel: remove the deployment and the `jagaos` project, revoke the CLI login if unused, update these docs (`HANDOFF`, `KANBAN`, `DECISIONS`) to drop UAT-on-Vercel.

## Lightsail checklist (the one that counts)

Deploy (once you have approved spend and access; see `LIGHTSAIL.md`):

```bash
cd web && npm ci && npm run build
scp -r dist/* ubuntu@<IP>:/tmp/jaga-web        # then on the box:
sudo mkdir -p /var/www/jaga/web && sudo cp -r /tmp/jaga-web/* /var/www/jaga/web/
# BEFORE copying a Caddyfile over the live one: the tracked deploy/Caddyfile is the live file (site address written out,
# DECISIONS #100). Compare, and ship only differences you meant to:
sha256sum deploy/Caddyfile            # on your machine
sudo sha256sum /etc/caddy/Caddyfile   # on the box: equal, or `diff` shows only what you changed
# `caddy validate` checks syntax only. A wrong site address passes it and still takes the site down.
sudo caddy validate --config /etc/caddy/Caddyfile   # must say "Valid configuration"
sudo systemctl reload caddy
```

Verify on the live URL, and attach a screenshot to the report:

- [ ] `/` loads; hero, preview, How It Works, Stack, CTA, footer render
- [ ] `/icon-32.png`, `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png` and `/manifest.webmanifest` return 200 (root static files: this was the Caddy 404 bug; the icons were `/icon.svg` until DECISIONS #114)
- [ ] `/assets/*.js` and `.css` return 200 with gzip
- [ ] `/api/health` returns 200 once the backend exists
- [ ] Hero: Start Free Trial opens Calendar, Watch Demo opens Tags, search returns a result
- [ ] Calendar event selects; tag filters; mobile menu; 390px has no horizontal scroll
- [ ] Response header `X-Robots-Tag: noindex` present
- [ ] Optional: basic auth in front of the site while it is UAT-only (Caddy `basic_auth`, hash from `caddy hash-password`; never commit the password)

## Demo-window operating cautions (2026-09-27, until the replay revert after Monday 28 Sep)

Production runs in replay mode on purpose (`LLM_CALLS_DISABLED=1`, `LLM_REPLAY_DIR`; DECISIONS #132, #134). What that means for anyone operating the box:

- **Do not restart `jaga-api` before the demo.** The review checkpoint is in memory: a restart kills every pending review item (Confirm answers 410) until `scripts/rearm_review_queue.py` is run. Run it with `--dry-run` first (DECISIONS #140); it refuses to remove an archived or event-bearing copy.
- **State after the 2026-09-27 recording (DECISIONS #144):** document 05 (id 375) is FILED; the receipt (id 379) is pending in Jonathan's queue; document 373 has the owner's purge request standing (with the seeded one on 374, the tab reads "Purge requested (2)"). The review queue therefore needs a re-arm (`scripts/rearm_review_queue.py --dry-run`, then for real); the re-arm removes 05 to 08 and uploads them again under NEW ids (probably 380 to 383, since the free ids above 379 are used), so look the ids up before beautifying them.
- **After ANY box restart, re-run beautify on ids 375 and 377** (the live review documents 05 and 07). The re-arm script uploads the ORIGINAL old-look demo PDFs again, under NEW document ids, so look the new ids up first (Company Files, or `select id, filename from document where filename like '05_%' or filename like '07_%'`); a beat-3 upload of the receipt only works from Chromium and only for that photo (`evals/replay/a8fa37448029.*` and `d61176d64347.*`), then: `sudo -u jaga .venv/bin/python scripts/beautify_invoices.py --db data/jaga.db --manifest evals/seed_files/manifest.json --ids <new 05 id>,<new 07 id> --apply --backup-dir <dir>` (dry run first by leaving out `--apply`; the ids 375 and 377 apply only to the documents as they stand tonight). The other 167 seeded invoices are unaffected by a restart.
- **The purge request on document 373 after the recording is deliberate, judge-facing state.** Beat 8 asks Jonathan to request its purge; the owner then sees "Purge requested (1)". Leave it in place: do not clear, archive or purge it unless the user says so. Document 373 is a seeded BrightGrid Energy Retail invoice in Tembusu Row.
- **Never run the beautify script with `--apply` without `--backup-dir`, and never on documents outside the seed manifest except the named demo files 05_ and 07_.** It writes no database row, so `sha256` and `bytes` no longer match the re-rendered files (DECISIONS #142); `verify_seed_fixtures.py` accounts for that.
- **Never set `RUN_LIVE_GATEWAY_TESTS`, and do not upload a file that has no recorded answer** (it answers 503 `ai_unavailable`): only the eight files with fixtures in `evals/replay/` can be processed on the box.

## Before every push

```bash
./scripts/prepush-check.sh
```

It fails on: Vercel URLs, Supabase references, hardcoded absolute API URLs in `web/`, secret-looking assignments, `.env` files, and a `.vercel/` folder. Do not push if it fails.

## Open

- Ask the organisers whether a non-AWS preview host is acceptable for internal UAT (we are treating it as "keep private" until they answer).
- Caddy is not installed on the dev machine, so a Caddyfile change cannot be validated here; validate it on the box (the peer session did before its 2026-09-25 reloads). Validation checks syntax only: compare the tracked and live files before a reload (DECISIONS #100).
