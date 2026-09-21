# UAT and deployment policy

Written for: the team and anyone pushing to git.
Status: **tentative**, agreed 2026-09-21, updated same day (placeholder retired). The one **final** rule: the Lightsail URL is the only deployment evidence (GAPS §5, SUBMISSION §1).

## Rules

1. **Lightsail is the only real deployment.** The submission's "Deployment evidence / URL" is the Lightsail instance. Nothing else is ever cited as evidence.
2. **Vercel is UAT only.** The UAT copy of the frontend runs on Vercel behind a login. Real production is AWS Lightsail (GAPS §5). Never cite the Vercel URL in the README, write-up, video, slides or the submission's deployment-evidence field.
3. **Sign-off happens on Lightsail.** A Vercel pass means "looks right". It does not mean "accepted". Final UAT sign-off requires the checklist below on the Lightsail URL.
4. **The API is same-origin.** The frontend calls relative `/api/...`. No absolute API URLs in `web/`, no CORS allowance for preview domains, no `*.vercel.app` in backend config.
5. **Frontend only on Vercel.** No backend, no secrets, no env values, no real data. The build uses mock data.
6. **Ask before publishing.** Creating any public or shared URL needs an explicit yes (also our global rule).

## Why (the four risks this mitigates)

| Risk | Mitigation |
|---|---|
| A non-AWS host URL in the repo or submission invites a GAPS §5 question | Rule 2, protection level `all`, `.vercel/` and `vercel.json` are git-ignored, `scripts/prepush-check.sh` fails on any `vercel.app` string |
| Vercel cannot be the deployment evidence | Rule 1, cutover checklist |
| UAT on Vercel tests a different serving path than production | Rule 3. `deploy/Caddyfile` now serves root static files (`icon.svg`, `manifest.webmanifest`) via a catch-all `handle`, and the Lightsail checklist tests that path |
| Backend on Lightsail + frontend on Vercel needs cross-origin setup | Rules 4 and 5. Vercel never talks to the API; once the backend exists, UAT moves to Lightsail where Caddy serves site and `/api/*` on one origin |

## Vercel UAT deployment (login required)

Project `jagaos` under scope `fresfrida`. The Vercel "production" alias (`<project>.vercel.app`) serves the **real app**, behind Vercel Authentication. The earlier placeholder page is **retired** (2026-09-21).

**Why this is safe now:** the project's Deployment Protection level is `all` (API value; dashboard: Vercel Authentication → All Deployments). Under the earlier level, `all_except_custom_domains` (Standard Protection), the production alias was public even with protection "on". Do not lower it.

From `web/`:

```bash
npm run typecheck && npm run build     # must pass first
vercel deploy --prod --yes             # production alias = real app, login required
```

After **every** deploy, verify logged out, expect 302/401 and never 200:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.vercel.app/
```

Then verify the content with the CLI (it handles the login): `vercel curl https://<project>.vercel.app/`.

- If the alias ever returns 200 logged out, remove the deployment at once (`vercel remove <deployment-url> --yes`) and re-check the protection level via `vercel api /v9/projects/<project>` (`ssoProtection.deploymentType` must be `all`).
- Vercel URLs contain the scope name. Do not paste them anywhere public.
- Frontend only: no backend, secrets, env values or real data. Never deploy to the retired `jaga` project.
- `.vercel/` and `vercel.json` stay uncommitted (git-ignored). `web/.vercel/` must be deleted before any git push (`scripts/prepush-check.sh` fails while it exists); relink with `vercel link --yes --project jagaos`.
- Do not add a custom domain. Delete the deployment when Lightsail UAT starts.

## Lightsail UAT checklist (the one that counts)

Deploy (once you have approved spend and access; see `LIGHTSAIL.md`):

```bash
cd web && npm ci && npm run build
scp -r dist/* ubuntu@<IP>:/tmp/jaga-web        # then on the box:
sudo mkdir -p /var/www/jaga/web && sudo cp -r /tmp/jaga-web/* /var/www/jaga/web/
sudo caddy validate --config /etc/caddy/Caddyfile   # must say "Valid configuration"
sudo systemctl reload caddy
```

Verify on the live URL, and attach a screenshot to the report:

- [ ] `/` loads; hero, preview, How It Works, Stack, CTA, footer render
- [ ] `/icon.svg` and `/manifest.webmanifest` return 200 (this was the Caddy 404 bug)
- [ ] `/assets/*.js` and `.css` return 200 with gzip
- [ ] `/api/health` returns 200 once the backend exists
- [ ] Hero: Start Free Trial opens Calendar, Watch Demo opens Tags, search returns a result
- [ ] Calendar event selects; tag filters; mobile menu; 390px has no horizontal scroll
- [ ] Response header `X-Robots-Tag: noindex` present
- [ ] Optional: basic auth in front of the site while it is UAT-only (Caddy `basic_auth`, hash from `caddy hash-password`; never commit the password)

## Before every push

```bash
./scripts/prepush-check.sh
```

It fails on: Vercel URLs, Supabase references, hardcoded absolute API URLs in `web/`, secret-looking assignments, `.env` files, and a `.vercel/` folder. Do not push if it fails.

## Open

- Ask the organisers whether a non-AWS preview host is acceptable for internal UAT (we are treating it as "keep private" until they answer).
- Caddyfile edit is **not yet validated** by `caddy validate` (Caddy is not installed on the dev machine). Validate on the Lightsail box before relying on it.
