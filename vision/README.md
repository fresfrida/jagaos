# vision/

Isolated image-captioning service (2026-09-23, DECISIONS #55) — kept fully
separate from `app/` (the main backend) so its heavy ML dependencies
(torch, transformers) never enter `app/`'s own venv/dependency resolution.
See `../deploy/README.md`'s "jaga-vision" section for live-box deployment
(systemd unit, `MemoryMax` verification, model pre-download). This file is
local development only.

## Local setup

```bash
cd vision
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt   # ~75MB for the CPU torch wheel
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8100
```

Then, from another terminal:

```bash
curl http://127.0.0.1:8100/health
# {"status":"ok"}

curl -X POST http://127.0.0.1:8100/caption \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/a/real/image.jpg"}'
# {"caption": "..."}
```

The path must be one this process can actually read — it's a plain
filesystem path, not uploaded bytes (see `app.py`'s `CaptionRequest`
docstring for why). The main backend resolves this to an absolute path
before calling in (`app/main.py`'s `upload_document`) — a relative path
only means something relative to *some* process's own working directory,
and jaga-api and jaga-vision are two separate processes that won't
necessarily share one.

## What this is not

- Not kept warm: the model loads fresh on every `/caption` call and is
  released after (no global instance). This is a deliberate tradeoff, not
  a missing optimization — see `app.py`'s module docstring.
- Not authenticated: bind to `127.0.0.1` only, always. It's a plain,
  unauthenticated HTTP endpoint reachable by anything else already running
  on the same box, which is fine only because nothing external can reach
  it.
- Not wired into the main test suite (`tests/`) — those mock the HTTP call
  to `app/main.py`'s side of this integration
  (`tests/test_vision_caption.py`) rather than requiring torch/transformers
  in that environment. This service's own correctness (does the model
  actually load and produce a real caption) is verified by hand, per
  `docs/DECISIONS.md` #55.
