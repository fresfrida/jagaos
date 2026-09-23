"""jaga-vision — isolated local image-captioning service (2026-09-23,
DECISIONS #55). Deliberately NOT part of app/ (the main FastAPI backend):
torch/transformers are heavy ML dependencies that must never enter
jaga-api's own venv/dependency resolution, per the box's 4GB RAM budget.

Bound to 127.0.0.1 only (never a public interface, see deploy/
jaga-vision.service) — no auth needed, since it isn't reachable from
outside the box at all.

Explicit design decision, not an oversight: the model is loaded fresh on
every request and released after, never kept resident. Salesforce/
blip-image-captioning-base peaks at ~2GB RSS while loaded (measured) on a
box already running jaga-api, Caddy, SQLite and Tesseract with 4GB total
RAM — keeping it warm would trade a real stability risk for a latency
saving nobody is waiting on, since captioning is an async background job
(app/main.py's upload endpoint), not a request any human is blocked on.
~20s load + 0.5-2s inference per request, measured; nothing here should
try to optimize that away.
"""

from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel
from transformers import BlipForConditionalGeneration, BlipProcessor

MODEL_NAME = "Salesforce/blip-image-captioning-base"

app = FastAPI(title="jaga-vision")


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

    # Loaded fresh per request, released after — see module docstring for
    # why this isn't a global/cached instance.
    processor = BlipProcessor.from_pretrained(MODEL_NAME)
    model = BlipForConditionalGeneration.from_pretrained(MODEL_NAME)

    inputs = processor(image, return_tensors="pt")
    out = model.generate(**inputs)
    text = processor.decode(out[0], skip_special_tokens=True)

    return CaptionResponse(caption=text)
