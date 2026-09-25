"""LLM gateway client. STRATEGY.md, ARCHITECTURE.md §1.

OpenAI-compatible gateway, native tool calling verified working (GAPS.md
§9) — no JSON-string workaround needed. `haiku` routes/classifies,
`sonnet4.5` extracts and reasons. Every call is costed and returned
alongside the trace row the caller writes.
"""

import os
import time
from dataclasses import dataclass
from typing import Any

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


@dataclass
class LLMResult:
    content: str
    tool_calls: list[dict[str, Any]] | None
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int


def _client() -> OpenAI:
    if not API_KEY:
        raise RuntimeError(
            "LLM_GATEWAY_API_KEY is not set — copy .env.example to .env and fill it in"
        )
    # max_retries=0: the SDK otherwise silently retries a timeout/429/5xx up to 2
    # more times, tripling the cost of a single call with no visibility into it.
    return OpenAI(base_url=BASE_URL, api_key=API_KEY, max_retries=0)


def _cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rate = PRICE_PER_M_TOKENS.get(model, PRICE_PER_M_TOKENS["sonnet4.5"])
    return (input_tokens * rate["input"] + output_tokens * rate["output"]) / 1_000_000


def call(
    model: str,
    system: str,
    user: str,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | str | None = None,
    max_tokens: int = 2048,
) -> LLMResult:
    """One chat-completion call. Raises on transport/API error — callers
    (graph nodes) decide whether that becomes a review_item or a 5xx.

    max_tokens defaults to 2048, not the gateway's own default: confirmed
    live 2026-09-21 that a tool call filling a multi-field schema
    (InvoiceFields) silently truncates mid-JSON at ~256 output tokens
    without this, producing what looks like "dropped fields" rather than an
    error (GAPS.md new §11)."""
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
    resp = client.chat.completions.create(**kwargs)
    latency_ms = int((time.monotonic() - start) * 1000)

    choice = resp.choices[0]
    tool_calls = (
        [tc.model_dump() for tc in choice.message.tool_calls]
        if choice.message.tool_calls
        else None
    )
    usage = resp.usage
    input_tokens = usage.prompt_tokens if usage else 0
    output_tokens = usage.completion_tokens if usage else 0

    return LLMResult(
        content=choice.message.content or "",
        tool_calls=tool_calls,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=_cost(model, input_tokens, output_tokens),
        latency_ms=latency_ms,
    )
