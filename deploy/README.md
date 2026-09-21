# deploy/

Everything needed to stand up JagaOS on one Lightsail box (ARCHITECTURE.md §8).

| File | Purpose |
|---|---|
| `Caddyfile` | reverse proxy + auto-TLS, static site + `/api/*` |
| `jaga-api.service` | FastAPI/uvicorn, systemd |
| `jaga-bot.service` | Telegram worker, systemd |
| `jaga-scheduler.service` | the Clock — APScheduler obligation ladder, systemd |
| `bootstrap.sh` | one-shot provisioning: packages, Caddy, firewall, users, units |

Run `bootstrap.sh` as root on a fresh Ubuntu 24.04 Lightsail instance, after
copying this `deploy/` folder to `/opt/jaga/deploy/`. See `../LIGHTSAIL.md`
for how to get the instance itself provisioned and reachable over SSH.
