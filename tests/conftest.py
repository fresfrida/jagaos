"""Fixes a real test-isolation bug found live 2026-09-22: app/graph/*.py
and app/rules/transitions.py all do `from app.db import DB_PATH` at module
import time, so a later test's `monkeypatch.setattr(db_module, "DB_PATH",
...)` only ever changes app.db's own attribute — every module that already
imported DB_PATH keeps writing to whichever path was current the *first*
time it was imported this session, silently. Not a production bug (the
real app is one process with one fixed DB_PATH for its whole lifetime,
which is correct) — purely a test-isolation problem from trying to swap
paths mid-session.

Fix: set JAGA_DB_PATH before anything under app/ is ever imported (conftest
collection runs before test-module imports), so every module's DB_PATH
binds to the same one test database from the start. Reset its tables
before each test instead of swapping paths.
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TEST_DB = str(Path(__file__).parent / "_test.db")
os.environ["JAGA_DB_PATH"] = _TEST_DB

# 2026-09-24: uploads in tests used to land in the real ./data/docs — the dev
# app's own document store (JAGA_DOCS_PATH became a real setting in round 9).
# A private directory per session keeps test files out of it, and lets a test
# assert "no file was left behind" against a directory it fully controls.
_TEST_DOCS = Path(tempfile.mkdtemp(prefix="jaga-test-docs-"))
os.environ["JAGA_DOCS_PATH"] = str(_TEST_DOCS)

_TABLES = [
    "notification", "security_event", "trace", "review_item", "obligation",
    "expectation", "event", "extraction",
    # document_tag/tag (2026-09-22) superseded the same day by bucket/
    # vendor_name columns on document itself (DECISIONS #42) — no join
    # tables left to reset. document_search (FTS5) has no real FK but is
    # reset here too, so a prior test's rows for a reused rowid never leak
    # into the next test.
    "document_search",
    # document_activity has no foreign keys at all (round 6, DECISIONS #129): it must survive a purge, so nothing points at it or from it.
    "document_activity",
    # download_link points at document and app_user (round 4, DECISIONS #122), so it goes before both.
    "download_link",
    "document", "session", "membership",
    # company_group after company: company.group_id points at it (round 12).
    "app_user", "company", "company_group",
]


@pytest.fixture(autouse=True)
def _gateway_calls_switched_on(monkeypatch):
    """LLM_CALLS_DISABLED (round 7, DECISIONS #132) must never leak into a test. app.main runs load_dotenv() when it is imported, so a
    developer who put the flag in their real .env would otherwise switch calls off for the whole suite, and a process that sets it in
    the environment would do the same. Every test starts with it removed; a test that wants it on sets it itself."""
    monkeypatch.delenv("LLM_CALLS_DISABLED", raising=False)
    monkeypatch.delenv("LLM_REPLAY_DIR", raising=False)  # replay mode (DECISIONS #134) must never leak in from a developer's environment either


class _CannedToolCall:
    def __init__(self, name: str, arguments: dict):
        self._data = {"id": "canned", "type": "function", "function": {"name": name, "arguments": __import__("json").dumps(arguments)}}

    def model_dump(self) -> dict:
        return self._data


class _CannedResponse:
    """Just enough of an OpenAI chat completion for app/llm.py::call(): one choice, optional tool calls, a usage object."""

    def __init__(self, tool_calls: list | None):
        message = type("Message", (), {"content": "", "tool_calls": tool_calls})()
        self.choices = [type("Choice", (), {"message": message})()]
        usage = {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
        self.usage = type("Usage", (), {**usage, "model_dump": lambda self_: dict(usage)})()


@pytest.fixture(autouse=True)
def _default_gateway_answers_are_canned(monkeypatch):
    """The safe default for every test that has not mocked the gateway itself (DECISIONS #135). A test that uploads a random-pixel JPEG
    (several modules do) sometimes gets junk text back from OCR, which sends classify to the real gateway on THAT run only: an
    intermittent, unrecorded spend. With this, the OpenAI SDK's own `create` answers from a canned response, so the whole call path
    (app/llm.py::call(), usage logging, tool-call parsing) still runs and nothing can leave the process. classify gets a 'memory' lane
    photo (no extractor, so no further call); any other tool gets no tool call. A test that patches `llm._client` or a node's `call`
    is unaffected (its own patch wins). Off for opted-in live runs."""
    if os.environ.get("RUN_LIVE_GATEWAY_TESTS") == "1":
        return
    import json  # noqa: F401  (used by _CannedToolCall)

    from openai.resources.chat.completions import Completions

    def canned_create(self, **kwargs):
        tools = kwargs.get("tools") or []
        name = tools[0]["function"]["name"] if tools else None
        if name == "classify_document":
            return _CannedResponse([_CannedToolCall(name, {
                "lane": "memory", "doc_type": "photo", "confidence": 0.3, "injection_suspected": False,
                "description": "A canned test photo", "description_en": "A canned test photo",
                "bucket": "Memory Lane", "vendor_name": None,
            })])
        return _CannedResponse(None)

    canned_create.original = Completions.create  # tests/test_no_real_network.py puts the real one back to prove the network tripwire
    monkeypatch.setattr(Completions, "create", canned_create)


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Tripwire (DECISIONS #135): a plain `pytest tests/` must never reach the network, and above all never the paid gateway. Found
    2026-09-27: tests/test_pipeline_review_diagnostic.py made real gateway calls on every run (its gate was only "the key is set", and
    app.main's load_dotenv() sets it from .env), unrecorded because the test DB is reset per test. The LLM_CALLS_DISABLED switch does
    not help here (the fixture above removes it on purpose). So the real transport hop is refused: httpx's own network transports, the
    only way the OpenAI client (or any httpx.Client) leaves the process. Starlette's TestClient uses its own in-process transport and
    is unaffected. The attempt is also RECORDED and asserted at teardown, because the OpenAI SDK turns any exception raised in the
    transport into a connection error that a test may swallow: the recorded attempt still fails the test. Off only when a person opts
    in with RUN_LIVE_GATEWAY_TESTS=1 (the live modules, which spend real tokens)."""
    attempts: list[str] = []
    if os.environ.get("RUN_LIVE_GATEWAY_TESTS") == "1":
        yield attempts
        return
    import httpx

    real_sync, real_async = httpx.HTTPTransport.handle_request, httpx.AsyncHTTPTransport.handle_async_request
    # Loopback is never the paid gateway (which is an external host) and is what the jaga-vision caption service is called on
    # (app/main.py CAPTION_SERVICE_URL, 127.0.0.1:8100); those calls are free and behave exactly as before this tripwire existed.
    loopback = {"127.0.0.1", "localhost", "::1", "[::1]"}

    def _refuse(request) -> None:
        attempts.append(f"{request.method} {request.url.host}")
        raise AssertionError(
            f"a test tried to make a real network request ({request.method} to {request.url.host}); a plain pytest run must never "
            "spend the gateway budget (DECISIONS #135)"
        )

    def _guarded(self, request, *args, **kwargs):
        if request.url.host in loopback:
            return real_sync(self, request, *args, **kwargs)
        _refuse(request)

    async def _guarded_async(self, request, *args, **kwargs):
        if request.url.host in loopback:
            return await real_async(self, request, *args, **kwargs)
        _refuse(request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _guarded)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _guarded_async)
    yield attempts
    assert not attempts, f"real network requests were attempted in this test: {attempts}"


@pytest.fixture(autouse=True)
def _reset_test_db():
    from app.db import get_conn, init_db

    init_db(_TEST_DB)
    with get_conn(_TEST_DB) as conn:
        for table in _TABLES:
            conn.execute(f"DELETE FROM {table}")
    for leftover in _TEST_DOCS.iterdir():
        leftover.unlink() if leftover.is_file() else shutil.rmtree(leftover)
    yield
