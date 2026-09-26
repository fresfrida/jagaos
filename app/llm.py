"""LLM gateway client. STRATEGY.md, ARCHITECTURE.md §1.

OpenAI-compatible gateway, native tool calling verified working (GAPS.md
§9) — no JSON-string workaround needed. `haiku` routes/classifies,
`sonnet4.5` extracts and reasons. Every call is costed and returned
alongside the trace row the caller writes.
"""

import json
import logging
import os
import time
from dataclasses import dataclass
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


def calls_disabled() -> bool:
    """True when the operator has switched every gateway call off (env LLM_CALLS_DISABLED = 1, true or yes, any case). Read from the
    environment at call time, not import time, so flipping it never needs a restart of anything but the process that reads it. Unset,
    empty or any other value means off, which is the default: production on the box is unchanged unless someone opts in. It exists
    because DECISIONS #130 bans spending the gateway budget on seeding, resets and evals and nothing in code enforced it."""
    return os.environ.get("LLM_CALLS_DISABLED", "").strip().lower() in _TRUTHY


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
    except (openai.RateLimitError, openai.APIConnectionError, openai.InternalServerError) as e:
        # APITimeoutError is an APIConnectionError. openai maps every 5xx to InternalServerError. One numbers-only line: the class
        # and the HTTP status, never the prompt or the response. No other status is mapped: what this gateway sends when the team's
        # budget runs out has never been recorded (MDs/GAPS.md has only the 400 "Only the approved model is allowed"), so a guess
        # would be a guess.
        status = getattr(e, "status_code", None)
        _log.warning(
            "LLM_UNAVAILABLE reason=%s status=%s purpose=%s document_id=%s", type(e).__name__, status, purpose, document_id,
        )
        raise LLMUnavailable(f"gateway unavailable ({type(e).__name__}, status {status})") from e
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
