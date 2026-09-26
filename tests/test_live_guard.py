"""The guard on the scripts that spend the gateway budget (round 7, DECISIONS #133; scripts/_live_guard.py).

A live target is refused even with the flag; anywhere else the flag is required; both exit with status 2 and a plain message. The
three guarded scripts are exercised through their real main(): they must refuse BEFORE doing anything, so no server, database or
gateway is needed. scripts/purge_document.py is not guarded (it makes no gateway call)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
sys.path.insert(0, str(Path(__file__).parent.parent))

import _live_guard  # noqa: E402

LOCAL_DB = "./data/jaga.db"
LOCAL_API = "http://127.0.0.1:8000"


@pytest.mark.parametrize("db", ["/opt/jaga/backend/data/jaga.db", "/opt/jaga/data/jaga.db", "/opt/jaga"])
def test_a_database_under_the_live_root_is_live(db):
    reasons = _live_guard.live_target_reasons(db, LOCAL_API)
    assert len(reasons) == 1 and "/opt/jaga" in reasons[0]


@pytest.mark.parametrize("db", [LOCAL_DB, "/tmp/x/jaga.db", "/opt/jaga-not/x.db", "/opt/jagax/jaga.db", "data/jaga.db"])
def test_other_databases_are_local(db):
    assert _live_guard.live_target_reasons(db, LOCAL_API) == []


@pytest.mark.parametrize("api", ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "http://LOCALHOST"])
def test_local_hosts_are_local(api):
    assert _live_guard.live_target_reasons(LOCAL_DB, api) == []


@pytest.mark.parametrize("api", ["https://box.example.test", "https://api.example.test", "http://192.168.1.5:8000", "http://localhost.evil.test", "not-a-url"])
def test_any_other_host_is_live(api):
    reasons = _live_guard.live_target_reasons(LOCAL_DB, api)
    assert len(reasons) == 1 and "not localhost" in reasons[0]


def test_both_reasons_are_reported_together():
    assert len(_live_guard.live_target_reasons("/opt/jaga/x.db", "https://box.example")) == 2


def _refused(capsys, **kwargs) -> str:
    with pytest.raises(SystemExit) as raised:
        _live_guard.refuse_unless_allowed("scripts/x.py", **kwargs)
    assert raised.value.code == 2  # STATUS 2, not the 1 that sys.exit("text") would give
    return capsys.readouterr().err


def test_a_local_target_without_the_flag_is_refused_and_says_how_to_proceed(capsys):
    err = _refused(capsys, allowed=False, db_path=LOCAL_DB, api_base=LOCAL_API)
    assert "--allow-gateway-spend" in err and "spends the gateway budget" in err and "seed_demo_fixtures.py" in err


def test_a_local_target_with_the_flag_is_allowed():
    assert _live_guard.refuse_unless_allowed("scripts/x.py", True, db_path=LOCAL_DB, api_base=LOCAL_API) is None


@pytest.mark.parametrize("kwargs", [
    {"db_path": "/opt/jaga/backend/data/jaga.db", "api_base": LOCAL_API},
    {"db_path": LOCAL_DB, "api_base": "https://box.example.test"},
])
def test_a_live_target_is_refused_even_with_the_flag(capsys, kwargs):
    err = _refused(capsys, allowed=True, **kwargs)
    assert "LIVE" in err and "even with the flag" in err


def test_the_message_never_suggests_running_it_against_the_live_target(capsys):
    err = _refused(capsys, allowed=False, db_path="/opt/jaga/x.db", api_base=LOCAL_API)
    assert "--allow-gateway-spend" not in err  # the flag cannot help here, so it is not offered


def test_seed_dev_db_refuses_before_touching_anything(capsys):
    import seed_dev_db
    with pytest.raises(SystemExit) as raised:
        seed_dev_db.main([])
    assert raised.value.code == 2 and "--allow-gateway-spend" in capsys.readouterr().err


def test_reset_demo_data_refuses_before_touching_anything_even_for_a_dry_run(capsys):
    import reset_demo_data
    with pytest.raises(SystemExit) as raised:
        reset_demo_data.main([])
    assert raised.value.code == 2 and "--allow-gateway-spend" in capsys.readouterr().err


def test_the_eval_run_refuses_before_touching_anything(tmp_path):
    """A subprocess, not an import: importing evals/demo_corpus/run.py repoints app.db.DB_PATH and the ingest store for the WHOLE test
    session (a module-level side effect that predates this guard), which would break every test that runs after this one."""
    import os
    import subprocess

    run = Path(__file__).parent.parent / "evals" / "demo_corpus" / "run.py"
    env = {**os.environ, "JAGA_DB_PATH": str(tmp_path / "x.db"), "JAGA_API_BASE_URL": LOCAL_API}
    result = subprocess.run([sys.executable, str(run)], capture_output=True, text=True, env=env, timeout=120)
    assert result.returncode == 2 and "--allow-gateway-spend" in result.stderr
    assert not (tmp_path / "x.db").exists()  # it refused before creating a database


def test_purge_document_is_not_guarded():
    import purge_document
    assert not hasattr(purge_document, "_live_guard")
