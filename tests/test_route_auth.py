"""No route may be reachable without credentials unless it is on an explicit
allowlist (2026-09-24). GET/POST /api/companies had no auth dependency at
all and returned every tenant's company list to an anonymous caller —
confirmed live; the handlers were deleted outright (nothing called them).
The per-route checks elsewhere only test the routes someone remembered to
test; this walks every route the app actually registers, so a future
handler added without an auth dependency fails here instead of shipping.
"""

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.db import get_conn
from app.main import app

client = TestClient(app, raise_server_exceptions=False)

# The only two routes that legitimately work with no credentials: liveness,
# and the login that mints them.
PUBLIC = {("GET", "/api/health"), ("POST", "/api/auth/dev-login")}


def _routes() -> list[tuple[str, str]]:
    return sorted(
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    )


def _concrete(path: str) -> str:
    return path.replace("{company_id}", "1").replace("{document_id}", "1").replace(
        "{review_item_id}", "1"
    )


@pytest.mark.parametrize("method,path", [r for r in _routes() if r not in PUBLIC])
def test_every_non_public_route_rejects_a_request_with_no_credentials(method, path):
    resp = client.request(method, _concrete(path))
    assert resp.status_code == 401, f"{method} {path} answered {resp.status_code} with no Authorization header"


def test_the_public_allowlist_is_still_accurate():
    assert PUBLIC <= set(_routes()), "an allowlisted route no longer exists — tighten the allowlist"


def test_the_company_list_and_create_routes_are_gone_for_everyone():
    assert ("GET", "/api/companies") not in _routes()
    assert ("POST", "/api/companies") not in _routes()

    anonymous = client.get("/api/companies")
    assert anonymous.status_code in (404, 405)
    assert "name" not in anonymous.text  # not even an error body naming a company

    created = client.post("/api/companies", params={"name": "Leak Co", "fye_month": 1, "fye_day": 1})
    assert created.status_code in (404, 405)
    with get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM company WHERE name = 'Leak Co'").fetchone()[0] == 0


def test_a_signed_in_owner_cannot_list_companies_either():
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "routeauth@example.com", "company_name": "Route Auth Co", "fye_month": 12, "fye_day": 31},
    ).json()
    resp = client.get("/api/companies", headers={"Authorization": f"Bearer {owner['token']}"})
    assert resp.status_code in (404, 405)
