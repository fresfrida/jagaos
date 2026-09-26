"""The no-real-network tripwire in tests/conftest.py (DECISIONS #135) works: a real transport hop is refused and recorded, including
when it is the OpenAI client (the paid gateway's only way out of the process) that tries. Nothing here sends a byte."""

import os

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_GATEWAY_TESTS") == "1", reason="the tripwire is off when live gateway tests are opted in",
)


def test_a_real_httpx_transport_is_refused_and_recorded(no_real_network):
    request = httpx.Request("POST", "https://api.softwaresystems.app/v1/chat/completions")
    with pytest.raises(AssertionError, match="real network request"):
        httpx.HTTPTransport().handle_request(request)
    assert no_real_network == ["POST api.softwaresystems.app"]
    no_real_network.clear()  # the tripwire's own teardown would otherwise (rightly) fail this test


def test_an_openai_client_cannot_leave_the_process(no_real_network, monkeypatch):
    from openai import OpenAI
    from openai.resources.chat.completions import Completions

    # Put the REAL SDK method back (conftest's canned default would otherwise answer first), to prove the network tripwire holds even
    # if the canned default were ever bypassed.
    monkeypatch.setattr(Completions, "create", Completions.create.original)
    client = OpenAI(base_url="https://api.softwaresystems.app/v1", api_key="not-a-real-key", max_retries=0)
    with pytest.raises(Exception):
        client.chat.completions.create(model="x", messages=[{"role": "user", "content": "hi"}])
    assert no_real_network, "the request should have reached the transport and been refused there"
    assert all(entry.endswith("api.softwaresystems.app") for entry in no_real_network)
    no_real_network.clear()


def test_loopback_is_left_alone_so_the_local_caption_service_behaves_as_before(no_real_network):
    """127.0.0.1 is never the paid gateway; a closed local port fails with an ordinary connection error, as it always did, and is not a
    tripwire hit."""
    with pytest.raises(httpx.ConnectError):
        httpx.post("http://127.0.0.1:9/caption", json={}, timeout=2)
    assert no_real_network == []


def test_the_in_process_test_client_is_not_blocked():
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/documents").status_code == 401
