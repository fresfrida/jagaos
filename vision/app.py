"""jaga-vision — isolated local image-captioning service (2026-09-23,
DECISIONS #55). Deliberately NOT part of app/ (the main FastAPI backend):
torch/transformers are heavy ML dependencies that must never enter
jaga-api's own venv/dependency resolution, per the box's 4GB RAM budget.

Bound to 127.0.0.1 only (never a public interface, see deploy/
jaga-vision.service) — no auth needed, since it isn't reachable from
outside the box at all.

**Supersedes DECISIONS #55's per-request load/release (2026-09-23,
DECISIONS #58).** #55 loaded the model fresh on every request and
released it after, based on a ~2GB peak RSS measured during development
on a Mac. The real number on the actual Lightsail box, under a real
captioning call, is ~390MB RSS (`systemctl status jaga-vision`) — a 5x
difference, most likely macOS/MPS-backend memory accounting that doesn't
apply to this box's CPU-only Linux build. At ~390MB, keeping the model
resident is comfortably affordable on the 4GB box (see deploy/
jaga-vision.service's MemoryMax=2.5G, unchanged) and removes the ~20s
per-request load penalty, which was the actual source of a real user's
"captions feel slow" complaint. The model now loads once, at process
startup (module level, below — before Uvicorn binds the port), and stays
resident for the life of the process. Inference alone is ~0.5-2s; that's
the only per-request cost now. A cold start (first request after any
service (re)start or crash-restart) still pays the ~20s load cost once —
see OpsConsole.tsx's "generating caption…" indicator, added as a UI
backstop for exactly that window.
"""

from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel
from transformers import BlipForConditionalGeneration, BlipProcessor

MODEL_NAME = "Salesforce/blip-image-captioning-base"

app = FastAPI(title="jaga-vision")

# Loaded once, at import time — Uvicorn finishes importing this module
# (and everything below executes) before it binds the port and starts
# accepting requests, so this genuinely happens "at startup," not on the
# first request. Kept resident for the life of the process (see module
# docstring for why this now differs from DECISIONS #55's original
# per-request pattern).
_processor = BlipProcessor.from_pretrained(MODEL_NAME)
_model = BlipForConditionalGeneration.from_pretrained(MODEL_NAME)


class CaptionRequest(BaseModel):
    # A filesystem path, not uploaded bytes — jaga-api and jaga-vision run
    # on the same box and already share the same disk (the document's
    # stored_path), so there's no reason to re-encode/re-transmit the
    # image bytes over HTTP when a path both processes can read is simpler
    # and cheaper.
    path: str


class CaptionResponse(BaseModel):
    caption: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/caption", response_model=CaptionResponse)
def caption(body: CaptionRequest) -> CaptionResponse:
    try:
        image = Image.open(body.path).convert("RGB")
    except (FileNotFoundError, OSError) as e:
        raise HTTPException(400, f"could not open image at {body.path}: {e}") from e

    # Module-level singletons, loaded once at process startup — see module
    # docstring (DECISIONS #58 supersedes #55's per-request load/release).
    inputs = _processor(image, return_tensors="pt")
    out = _model.generate(**inputs)
    text = _processor.decode(out[0], skip_special_tokens=True)

    return CaptionResponse(caption=text)
