# deploy/

Everything needed to stand up JagaOS on one Lightsail box (ARCHITECTURE.md §8).

| File | Purpose |
|---|---|
| `Caddyfile` | reverse proxy + auto-TLS, static site + `/api/*` |
| `jaga-api.service` | FastAPI/uvicorn, systemd |
| `jaga-bot.service` | Telegram worker, systemd |
| `jaga-scheduler.service` | the Clock — APScheduler obligation ladder, systemd |
| `jaga-vision.service` | local image-captioning (isolated venv), systemd — see below |
| `bootstrap.sh` | one-shot provisioning: packages, Caddy, firewall, users, units |

Run `bootstrap.sh` as root on a fresh Ubuntu 24.04 Lightsail instance, after
copying this `deploy/` folder to `/opt/jaga/deploy/`. See `../MDs/LIGHTSAIL.md`
for how to get the instance itself provisioned and reachable over SSH.

## jaga-vision (2026-09-23, DECISIONS #55)

Captions picture-lane uploads (the "is this a picture?" toggle, DECISIONS
#52) using `Salesforce/blip-image-captioning-base` (transformers), run as a
**separate service with its own venv** — torch/transformers never enter
`jaga-api`'s own venv/dependency resolution. Bound to `127.0.0.1:8100`
only, never a public interface; no auth needed since it isn't reachable
from outside the box. `jaga-api` calls it as a fire-and-forget background
task per upload (`app/main.py`), never blocking the upload response.

**Explicit design decision: the model loads fresh on every request and is
never kept resident.** Peak RSS while loaded is ~2GB, measured — on a 4GB
box already running `jaga-api`, Caddy, SQLite and Tesseract, keeping that
resident permanently is a real stability risk for a latency saving nobody
is waiting on (captioning is async; nothing blocks on the ~20s load time).
Do not "optimize" this into a warm/cached model without re-deciding this
tradeoff explicitly.

### Deploying (not yet run on the live box as of this writing)

1. Copy `vision/` (repo root, alongside `app/` and `web/`) to `/opt/jaga/vision`.
2. As the `jaga` user, create an isolated venv and install:
   ```bash
   cd /opt/jaga/vision
   python3.12 -m venv .venv
   .venv/bin/pip install --upgrade pip
   .venv/bin/pip install -r requirements.txt
   ```
   `requirements.txt` pins `--extra-index-url https://download.pytorch.org/whl/cpu`
   so `torch` resolves to the CPU-only build (much smaller than the default,
   which bundles CUDA support this box will never use) — `--extra-index-url`,
   not `--index-url`, so `transformers`/`pillow`/`fastapi`/`uvicorn` still
   resolve from PyPI too. Verified locally (macOS, Python 3.13): installs
   cleanly, ~74MB for the torch wheel alone. **Not yet verified against
   Ubuntu 24.04 / Python 3.12** — the exact pinned versions may need a
   compatible bump there; treat the first install on the box as a real
   check, not a formality.
3. Pre-download the model (avoids a slow, uncached first real request):
   ```bash
   .venv/bin/python -c "
   from transformers import BlipProcessor, BlipForConditionalGeneration
   BlipProcessor.from_pretrained('Salesforce/blip-image-captioning-base')
   BlipForConditionalGeneration.from_pretrained('Salesforce/blip-image-captioning-base')
   "
   ```
   This caches the model under the `jaga` user's `~/.cache/huggingface` —
   confirm it's the `jaga` user (not root) running this step, or the
   service will re-download on its first real request instead of using
   the cache.
4. Install and enable the service:
   ```bash
   cp /opt/jaga/deploy/jaga-vision.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now jaga-vision
   ```
5. Smoke test: `curl http://127.0.0.1:8100/health` → `{"status":"ok"}`,
   then a real `POST /caption` with `{"path": "<absolute path to any real
   image on the box>"}` → `{"caption": "..."}`.

### Verifying jaga-vision.service's MemoryMax actually works

**This is the safety mechanism the whole isolation design depends on —
its config syntax being correct is not the same as it actually firing.**
It could not be verified locally (no systemd/cgroups on macOS, where this
was built) — verify on the box itself before trusting it in production:

```bash
# 1. Confirm the unit's own cap is what you think it is.
systemctl show jaga-vision -p MemoryMax

# 2. Prove systemd's cgroup memory enforcement actually works on this
#    box/kernel at all, with a cheap, throwaway 100M cap (not the real
#    service — a disposable scope) before trusting the real 2.5G one:
sudo systemd-run --scope -p MemoryMax=100M --unit=jaga-vision-memtest \
  python3 -c "
data = bytearray(200 * 1024 * 1024)  # 200MB, well past the 100MB test cap
import time; time.sleep(5)
"
# Expect the process to be killed (OOM) before the 5s sleep completes —
# confirm with: journalctl -u jaga-vision-memtest | grep -i oom

# 3. Confirm the real service survives and restarts under an *actual*
#    breach, and that the rest of the box is unaffected while it happens:
#    watch `systemctl status jaga-vision` and `htop`/`free -h` in one
#    terminal, and in another, send several concurrent /caption requests
#    (each loads its own ~2GB model copy, so 2+ concurrent requests should
#    approach or exceed the 2.5G cap). Confirm: jaga-vision gets killed
#    and restarts on its own (Restart=on-failure), jaga-api/Caddy/SSH stay
#    responsive throughout, `journalctl -u jaga-vision` shows the kill.
```

If any of this doesn't behave as expected, do not treat the isolation as
real — the whole point of a separate service is that a crash there can't
take down the rest of the box, and that's only true once actually shown,
not configured.
