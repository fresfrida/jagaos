"""LLM gateway client. STRATEGY.md, ARCHITECTURE.md §1.

OpenAI-compatible gateway, native tool calling verified working (GAPS.md
§9) — no JSON-string workaround needed. `haiku` routes/classifies,
`sonnet4.5` extracts and reasons. Every call is costed and returned
alongside the trace row the caller writes.
"""

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import openai
from openai import OpenAI

BASE_URL = os.environ.get("LLM_GATEWAY_BASE_URL", "https://api.softwaresystems.app/v1")
API_KEY = os.environ.get("LLM_GATEWAY_API_KEY", "")
# 2026-09-24 (item 3, portability audit): the model alias was a hardcoded
# "sonnet4.5" string literal in every graph node that calls the gateway
# (classify.py/extract.py/derive_events.py) — this key's own gateway only
# approves this one alias today (GAPS.md §11), but that's a fact about
# *this* key, not something that should be baked into the call sites
# themselves. One env-configurable default, same pattern BASE_URL/API_KEY
# above already use.
MODEL_NAME = os.environ.get("LLM_MODEL_NAME", "sonnet4.5")

# USD per 1M tokens. Placeholder Sonnet-4.5 list pricing (Anthropic direct,
# not necessarily the gateway's actual rate) — replace before trusting the
# cost-per-document number in the write-up (docs/WRITEUP.md §3). "haiku" is
# rejected by this team's gateway key (GAPS.md new §11: "Only the approved
# model is allowed") — kept here only in case a future key allows it.
PRICE_PER_M_TOKENS = {
    "haiku": {"input": 0.80, "output": 4.00},
    "sonnet4.5": {"input": 3.00, "output": 15.00},
}


# The service journal's logger (main.py's `_audit` writes to it too), so a usage line reaches the box's journal.
_log = logging.getLogger("uvicorn.error")

# One call whose PROMPT alone is this large gets a WARNING as well as its usual line (round 6, DECISIONS #129). Three graph nodes
# each send the document's text, so a single very large prompt is the first thing to look at when a document's cost surprises.
INPUT_TOKEN_WARN = int(os.environ.get("LLM_INPUT_TOKEN_WARN", "20000"))


class LLMUnavailable(RuntimeError):
    """The gateway cannot be used right now, and a caller may say so plainly instead of failing with a bare 500 (round 7,
    DECISIONS #132). Raised for exactly two reasons: the operator switched calls off (LLM_CALLS_DISABLED), or the gateway refused or
    could not be reached in a transient way (rate limit, timeout, connection failure, a 5xx). Anything else the SDK raises (a 400, an
    auth error, our own bug) is NOT converted: it stays what it was. The message never carries the SDK's own text, which can echo
    a response body."""


_TRUTHY = {"1", "true", "yes"}

# HTTP statuses (besides every 5xx, and a failed connection or timeout) that read to the person as "try again shortly". 429 is the SDK's
# RateLimitError. 402 and 403 are a USER-DIRECTED BEST GUESS at how this gateway says the team's budget is spent (round 7, DECISIONS
# #132): what it really sends was never recorded. A 403 can equally mean a bad key or a permission problem, which then also reads as
# "try again shortly"; the LLM_ERROR_UNMAPPED line below is how we find out if some other status turns up.
# ---- REPLAY MODE (round 7, item S2, DECISIONS #134). Env LLM_REPLAY_DIR names a folder of recorded answers, one JSON file per
# (run_id, purpose): `<run_id>.<purpose>.json`, where run_id is the first 12 hex characters of the file's sha256 (app/graph/ingest.py)
# and purpose is classify, extract or derive_events. When a file for the call being made exists, call() returns ITS answer and the real
# pipeline carries on around it (verify, human review, transitions, the trace, the history), so only the model's answer is canned.
# Off unless the variable is set. It is a TIME-BOXED EXCEPTION on the production box for the 28 Sep 2026 demo, recorded files only
# (DECISIONS #134, the revert is in KANBAN Backlog). What a MISS does is the named constant below.
REPLAY_ENV = "LLM_REPLAY_DIR"
REPLAY_ON_MISS = "fall_through"  # "fall_through": carry on to the kill switch and then the real gateway (the agreed policy); "raise": LLMUnavailable
_REPLAY_KEY = re.compile(r"^[0-9a-f]{12}$")
_REPLAY_PURPOSE = re.compile(r"^[a-z_]{1,32}$")

_UNAVAILABLE_STATUSES = {402, 403, 429}
_LOGGED_FIELD_MAX = 80


def calls_disabled() -> bool:
    """True when the operator has switched every gateway call off (env LLM_CALLS_DISABLED = 1, true or yes, any case). Read from the
    environment at call time, not import time, so flipping it never needs a restart of anything but the process that reads it. Unset,
    empty or any other value means off, which is the default: production on the box is unchanged unless someone opts in. It exists
    because DECISIONS #130 bans spending the gateway budget on seeding, resets and evals and nothing in code enforced it."""
    return os.environ.get("LLM_CALLS_DISABLED", "").strip().lower() in _TRUTHY


def replay_dir() -> Path | None:
    """The replay folder, or None when replay is off. Read from the environment at call time."""
    raw = os.environ.get(REPLAY_ENV, "").strip()
    return Path(raw) if raw else None


def replay_configured() -> bool:
    return replay_dir() is not None


def _replay_file(run_id: str | None, purpose: str) -> Path | None:
    """The fixture for this call if one exists. The key is checked against a strict pattern first, so a hostile run_id or purpose can
    never name a path outside the folder."""
    folder = replay_dir()
    if folder is None or not run_id or not _REPLAY_KEY.match(run_id) or not _REPLAY_PURPOSE.match(purpose):
        return None
    path = folder / f"{run_id}.{purpose}.json"
    return path if path.is_file() else None


def replay_available(run_id: str) -> bool:
    """True when replay is on and the file with this run_id has a recorded classify answer: the upload preflight (app/main.py) lets such a
    file through even while the kill switch is armed, because every call it will make is answered from a fixture."""
    return _replay_file(run_id, "classify") is not None


def _replay_result(purpose: str, document_id: int | None, run_id: str | None) -> "LLMResult | None":
    path = _replay_file(run_id, purpose)
    if path is None:
        return None
    try:
        fixture = json.loads(path.read_text())
        arguments = fixture["arguments"]
        tool_name = fixture["tool_name"]
        if not isinstance(arguments, dict) or not isinstance(tool_name, str):
            raise ValueError("bad fixture shape")
    except (OSError, ValueError, KeyError):
        _log.warning("LLM_REPLAY_UNREADABLE purpose=%s run_id=%s document_id=%s", purpose, run_id, document_id)
        return None  # an unreadable fixture is a miss, never a crash
    _log.info("LLM_REPLAY purpose=%s run_id=%s document_id=%s", purpose, run_id, document_id)
    # A known FREE call (0 tokens, $0.0), unlike an unknown-usage real call (None, DECISIONS #129); model "replay" is what the trace records.
    return LLMResult(
        content="", tool_calls=[{"id": "replay", "type": "function", "function": {"name": tool_name, "arguments": json.dumps(arguments)}}],
        model="replay", input_tokens=0, output_tokens=0, cost_usd=0.0, latency_ms=0, cached_input_tokens=0,
    )


def _log_safe(value: Any) -> str | None:
    """A gateway-supplied short identifier (an error `type` or `code`) made safe to put in a log line: only a string or a number, control
    characters replaced, cut to _LOGGED_FIELD_MAX. Anything else (a dict, a list, None) is not logged at all."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    return "".join(ch if ch.isprintable() else "?" for ch in str(value))[:_LOGGED_FIELD_MAX]


def _unavailable(e: Exception, purpose: str, document_id: int | None) -> LLMUnavailable:
    status = getattr(e, "status_code", None)
    _log.warning("LLM_UNAVAILABLE reason=%s status=%s purpose=%s document_id=%s", type(e).__name__, status, purpose, document_id)
    return LLMUnavailable(f"gateway unavailable ({type(e).__name__}, status {status})")


def _log_unmapped(e: "openai.APIStatusError", purpose: str, document_id: int | None) -> None:
    """ONE line for a gateway status error we do NOT map, so the mapping can be widened later from real evidence. The class, the status,
    the purpose, the document id and the gateway's structured error `type` and `code` when its body carries them. NEVER the error
    message or the response body (the SDK's message can echo response content) or anything from the prompt."""
    line = f"LLM_ERROR_UNMAPPED reason={type(e).__name__} status={e.status_code} purpose={purpose} document_id={document_id}"
    for name in ("type", "code"):
        value = _log_safe(getattr(e, name, None))
        if value is not None:
            line += f" {name}={value}"
    _log.warning("%s", line)


@dataclass
class LLMResult:
    content: str
    tool_calls: list[dict[str, Any]] | None
    model: str
    # None means the gateway did not report it, NOT zero (round 6, DECISIONS #129): a response with no `usage` object used to
    # be recorded as 0 tokens and $0, indistinguishable from a real free call. A trace row now stores NULL for it.
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    latency_ms: int
    # Input tokens served from a prompt cache, when the gateway reports such a field at all; None = not reported (which is what
    # has been observed so far, see docs/DECISIONS.md #129), 0 = reported and nothing was cached.
    cached_input_tokens: int | None = None

    @property
    def total_tokens(self) -> int | None:
        if self.input_tokens is None or self.output_tokens is None:
            return None
        return self.input_tokens + self.output_tokens


def _client() -> OpenAI:
    if not API_KEY:
        raise RuntimeError(
            "LLM_GATEWAY_API_KEY is not set — copy .env.example to .env and fill it in"
        )
    # max_retries=0: the SDK otherwise silently retries a timeout/429/5xx up to 2
    # more times, tripling the cost of a single call with no visibility into it.
    return OpenAI(base_url=BASE_URL, api_key=API_KEY, max_retries=0)


def _cost(model: str, input_tokens: int | None, output_tokens: int | None) -> float | None:
    if input_tokens is None or output_tokens is None:
        return None
    rate = PRICE_PER_M_TOKENS.get(model, PRICE_PER_M_TOKENS["sonnet4.5"])
    return (input_tokens * rate["input"] + output_tokens * rate["output"]) / 1_000_000


def _reported_int(value: Any) -> int | None:
    """A token count the gateway reported, or None when the field is absent or not a whole number."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _cached_input_tokens(usage: Any) -> int | None:
    """Cached input tokens, from whichever field the gateway uses to say so: the OpenAI-style
    `prompt_tokens_details.cached_tokens`, or an Anthropic-style `cache_read_input_tokens`. None when NEITHER is present:
    "not reported" is not "zero", and a cache is never inferred from a request having been accepted (this gateway accepted an
    image block and silently discarded it, MDs/GAPS.md §8, so acceptance proves nothing)."""
    details = getattr(usage, "prompt_tokens_details", None)
    cached = _reported_int(getattr(details, "cached_tokens", None)) if details is not None else None
    if cached is not None:
        return cached
    extra = getattr(usage, "model_extra", None) or {}
    return _reported_int(extra.get("cache_read_input_tokens", getattr(usage, "cache_read_input_tokens", None)))


def _log_usage(
    *, purpose: str, document_id: int | None, run_id: str | None, model: str, usage: Any, input_chars: int, latency_ms: int,
    result: "LLMResult",
) -> None:
    """ONE structured line per paid call, numbers only. Deliberately never the prompt, the document text, an image, a credential
    or any response content: `input_chars` is a COUNT of the characters sent, which is what lets an oversized OCR text be spotted
    without the text being in a log. A missing usage object is logged as unknown, not as 0."""
    record = {
        "purpose": purpose, "document_id": document_id, "run_id": run_id, "model": model,
        "usage": "reported" if usage is not None else "unknown",
        "input_tokens": result.input_tokens, "output_tokens": result.output_tokens, "total_tokens": result.total_tokens,
        "cached_input_tokens": result.cached_input_tokens, "input_chars": input_chars, "latency_ms": latency_ms,
        # Which fields the gateway's usage object carries (names only), so whether it reports any cache field is visible.
        "usage_fields": sorted(usage.model_dump().keys()) if usage is not None and hasattr(usage, "model_dump") else None,
    }
    _log.info("LLM_USAGE %s", json.dumps(record, sort_keys=True))
    if result.input_tokens is not None and result.input_tokens >= INPUT_TOKEN_WARN:
        _log.warning(
            "LLM_USAGE_LARGE purpose=%s document_id=%s input_tokens=%s input_chars=%s (threshold %s)",
            purpose, document_id, result.input_tokens, input_chars, INPUT_TOKEN_WARN,
        )


def call(
    model: str,
    system: str,
    user: str,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | str | None = None,
    max_tokens: int = 2048,
    purpose: str = "unspecified",
    document_id: int | None = None,
    run_id: str | None = None,
) -> LLMResult:
    """One chat-completion call. Raises on transport/API error — callers
    (graph nodes) decide whether that becomes a review_item or a 5xx.

    max_tokens defaults to 2048, not the gateway's own default: confirmed
    live 2026-09-21 that a tool call filling a multi-field schema
    (InvoiceFields) silently truncates mid-JSON at ~256 output tokens
    without this, producing what looks like "dropped fields" rather than an
    error (GAPS.md new §11).

    Raises LLMUnavailable (never a bare SDK error) when calls are switched off or the gateway is transiently unavailable; see
    that class. The switch is checked FIRST, before a client is built, so with it on nothing is constructed and nothing is sent."""
    # Replay comes BEFORE the kill switch (DECISIONS #134): with the switch armed, a recorded file is still answered and an unrecorded one
    # still cannot reach a paid call. A hit never builds a client.
    replayed = _replay_result(purpose, document_id, run_id)
    if replayed is not None:
        return replayed
    if replay_configured() and REPLAY_ON_MISS == "raise":
        _log.warning("LLM_REPLAY_MISS purpose=%s run_id=%s document_id=%s policy=raise", purpose, run_id, document_id)
        raise LLMUnavailable("no recorded answer for this call and replay is set to refuse a miss")
    if calls_disabled():
        _log.warning("LLM_UNAVAILABLE reason=disabled purpose=%s document_id=%s", purpose, document_id)
        raise LLMUnavailable("LLM calls are switched off (LLM_CALLS_DISABLED)")
    client = _client()
    start = time.monotonic()
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice or "required"
    try:
        resp = client.chat.completions.create(**kwargs)
    except openai.APIConnectionError as e:
        # A connection failure or a timeout (APITimeoutError is an APIConnectionError): no HTTP status at all.
        raise _unavailable(e, purpose, document_id) from e
    except openai.APIStatusError as e:
        # 429, 402, 403 and every 5xx read as "unavailable"; one numbers-only line, never the prompt or the response. Everything else
        # (400 including the known "Only the approved model is allowed", 401, 404, 422) is NOT converted: it is logged once as
        # LLM_ERROR_UNMAPPED and re-raised exactly as it was.
        if e.status_code in _UNAVAILABLE_STATUSES or e.status_code >= 500:
            raise _unavailable(e, purpose, document_id) from e
        _log_unmapped(e, purpose, document_id)
        raise
    latency_ms = int((time.monotonic() - start) * 1000)

    choice = resp.choices[0]
    tool_calls = (
        [tc.model_dump() for tc in choice.message.tool_calls]
        if choice.message.tool_calls
        else None
    )
    usage = resp.usage
    input_tokens = _reported_int(getattr(usage, "prompt_tokens", None)) if usage is not None else None
    output_tokens = _reported_int(getattr(usage, "completion_tokens", None)) if usage is not None else None

    result = LLMResult(
        content=choice.message.content or "",
        tool_calls=tool_calls,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=_cost(model, input_tokens, output_tokens),
        latency_ms=latency_ms,
        cached_input_tokens=_cached_input_tokens(usage) if usage is not None else None,
    )
    _log_usage(
        purpose=purpose, document_id=document_id, run_id=run_id, model=model, usage=usage,
        input_chars=len(system) + len(user), latency_ms=latency_ms, result=result,
    )
    return result
