"""Per-call usage logging at the one paid-model boundary (round 6, DECISIONS #129).

`app.llm.call` writes ONE structured `LLM_USAGE` line per gateway call, numbers only. These tests replace the OpenAI client with a
recorder (no network, no key spent), so they check the record, that it leaks nothing, that a missing usage object is reported as
unknown rather than as zero, that cached tokens are read only from a field the gateway actually returns, and that the request
carries nothing speculative.
"""

import json
import logging
from types import SimpleNamespace

import pytest
from openai import OpenAI
from openai.types import CompletionUsage
from openai.types.completion_usage import PromptTokensDetails

import app.llm as llm

SECRET_SYSTEM = "SYSTEM-PROMPT-MARKER-91f3"
SECRET_DOCUMENT = "DOCUMENT-TEXT-MARKER-55ab account 123-456-789"
FAKE_KEY = "sk-test-key-do-not-log-7d21"


class _Recorder:
    def __init__(self, usage):
        self.usage = usage
        self.requests: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        message = SimpleNamespace(content="RESPONSE-CONTENT-MARKER-c0de", tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=self.usage)


@pytest.fixture
def recorder(monkeypatch):
    def install(usage):
        rec = _Recorder(usage)
        monkeypatch.setattr(llm, "_client", lambda: rec)
        return rec
    return install


def _usage_records(caplog) -> list[dict]:
    return [
        json.loads(r.getMessage().split("LLM_USAGE ", 1)[1])
        for r in caplog.records if r.getMessage().startswith("LLM_USAGE ") and not r.getMessage().startswith("LLM_USAGE_LARGE")
    ]


def _go(**kw):
    return llm.call("sonnet4.5", SECRET_SYSTEM, SECRET_DOCUMENT, purpose="classify", document_id=42, run_id="abc123def456", **kw)


def test_one_structured_record_per_call_with_the_full_input_output_cached_split(recorder, caplog):
    recorder(CompletionUsage(prompt_tokens=1800, completion_tokens=230, total_tokens=2030, prompt_tokens_details=PromptTokensDetails(cached_tokens=1200)))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        result = _go()
    (record,) = _usage_records(caplog)
    assert record["purpose"] == "classify" and record["document_id"] == 42 and record["run_id"] == "abc123def456"
    assert record["model"] == "sonnet4.5" and record["usage"] == "reported"
    assert (record["input_tokens"], record["output_tokens"], record["total_tokens"], record["cached_input_tokens"]) == (1800, 230, 2030, 1200)
    assert record["input_chars"] == len(SECRET_SYSTEM) + len(SECRET_DOCUMENT)
    assert isinstance(record["latency_ms"], int)
    assert "prompt_tokens_details" in record["usage_fields"]
    assert result.total_tokens == 2030 and result.cached_input_tokens == 1200


def test_the_log_never_carries_prompt_text_document_text_response_text_or_the_key(recorder, caplog, monkeypatch):
    monkeypatch.setattr(llm, "API_KEY", FAKE_KEY)
    recorder(CompletionUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15))
    with caplog.at_level(logging.DEBUG, logger="uvicorn.error"):
        _go()
    everything = "\n".join(r.getMessage() for r in caplog.records)
    for secret in (SECRET_SYSTEM, "DOCUMENT-TEXT-MARKER-55ab", "123-456-789", "RESPONSE-CONTENT-MARKER-c0de", FAKE_KEY):
        assert secret not in everything, secret


def test_a_response_with_no_usage_object_is_unknown_not_zero(recorder, caplog):
    recorder(None)
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        result = _go()
    (record,) = _usage_records(caplog)
    assert record["usage"] == "unknown"
    assert record["input_tokens"] is None and record["output_tokens"] is None and record["total_tokens"] is None
    assert result.input_tokens is None and result.output_tokens is None and result.cost_usd is None and result.total_tokens is None


def test_a_reported_zero_is_still_a_zero_and_is_not_confused_with_unknown(recorder):
    recorder(CompletionUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0))
    result = _go()
    assert (result.input_tokens, result.output_tokens, result.cost_usd) == (0, 0, 0.0)


@pytest.mark.parametrize("usage, expected", [
    (CompletionUsage(prompt_tokens=5, completion_tokens=1, total_tokens=6), None),  # the field is absent: NOT reported
    (CompletionUsage(prompt_tokens=5, completion_tokens=1, total_tokens=6, prompt_tokens_details=PromptTokensDetails(cached_tokens=0)), 0),
    (CompletionUsage(prompt_tokens=5, completion_tokens=1, total_tokens=6, prompt_tokens_details=PromptTokensDetails(cached_tokens=4)), 4),
    (CompletionUsage(prompt_tokens=5, completion_tokens=1, total_tokens=6, cache_read_input_tokens=3), 3),  # an Anthropic-style field
])
def test_cached_tokens_come_only_from_a_field_the_gateway_reports(recorder, usage, expected):
    recorder(usage)
    assert _go().cached_input_tokens == expected


def test_a_very_large_prompt_adds_a_warning_line(recorder, caplog, monkeypatch):
    monkeypatch.setattr(llm, "INPUT_TOKEN_WARN", 1000)
    recorder(CompletionUsage(prompt_tokens=1500, completion_tokens=10, total_tokens=1510))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        _go()
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "LLM_USAGE_LARGE" in r.getMessage()]
    assert len(warnings) == 1 and "input_tokens=1500" in warnings[0].getMessage()
    assert SECRET_DOCUMENT not in warnings[0].getMessage()


def test_the_request_carries_only_plain_text_messages_and_no_speculative_parameter(recorder):
    rec = recorder(CompletionUsage(prompt_tokens=5, completion_tokens=1, total_tokens=6))
    llm.call("sonnet4.5", SECRET_SYSTEM, SECRET_DOCUMENT, tools=[{"type": "function", "function": {"name": "t", "parameters": {}}}], purpose="extract")
    (request,) = rec.requests
    assert set(request) <= {"model", "max_tokens", "messages", "tools", "tool_choice"}
    assert all(isinstance(m["content"], str) for m in request["messages"])  # text only: no image block, no cache_control block
    assert "cache_control" not in json.dumps(request) and "image" not in json.dumps(request).lower()


def test_the_sdk_still_makes_exactly_one_attempt_per_call(monkeypatch):
    monkeypatch.setattr(llm, "API_KEY", FAKE_KEY)
    client = llm._client()
    assert isinstance(client, OpenAI) and client.max_retries == 0
