"""Guards on deploy/Caddyfile (2026-09-25, DECISIONS #100).

`caddy validate` only checks syntax. It cannot tell whether the site address will match real traffic, and
that is exactly how a Caddyfile passed validation and still took production down: the tracked file used
`{$JAGA_DOMAIN:localhost}`, the box's caddy service sets no JAGA_DOMAIN, so the address silently became
`localhost` and no request for the real domain matched. The file on the box is hand-maintained with the
domain written out, so the tracked file must be that file, not a template of it. These tests fail on the
regression at test time instead of on the box.
"""

import re
from pathlib import Path

from app.limits import BODY_LIMITS

CADDYFILE = Path(__file__).resolve().parent.parent / "deploy" / "Caddyfile"
MIB = 1024 * 1024


def _text() -> str:
    return CADDYFILE.read_text()


def _site_address(text: str) -> str:
    """The address of the one top-level site block: the first non-comment line that opens a block."""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        assert line.rstrip().endswith("{") and not line[0].isspace(), f"expected a site block first, got {line!r}"
        return line.rstrip()[:-1].strip()
    raise AssertionError("no site block found")


def test_the_site_address_is_a_literal_hostname_not_a_template():
    address = _site_address(_text())
    assert "{" not in address and "$" not in address, f"{address!r} is templated: an unset variable silently changes it"
    # Caddy accepts several comma-separated hostnames on one site block (jagaos.<ip>.nip.io and the bare
    # <ip>.nip.io both resolve to the same box via nip.io's wildcard DNS); each one must still be a literal
    # hostname, not a template.
    hostnames = [h.strip() for h in address.split(",")]
    assert hostnames, f"{address!r} has no hostname"
    for hostname in hostnames:
        assert re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+", hostname), (
            f"{hostname!r} is not a literal domain name"
        )


def test_no_environment_placeholder_with_a_fallback_anywhere_in_the_file():
    # the same failure class as the site address: a value that is quietly something else when the variable is unset
    assert "{$" not in _text()


def test_the_body_ceiling_is_above_the_apis_own_largest_body_bound():
    text = _text()
    api_block = re.search(r"handle /api/\*\s*\{(.*?)\n\t\}", text, re.S)
    assert api_block, "no `handle /api/*` block"
    ceiling = re.search(r"request_body\s*\{\s*max_size\s+(\d+)\s*MiB\s*\}", api_block.group(1))
    assert ceiling, "the /api/* block has no `request_body { max_size N MiB }`"
    # if the proxy refused first, a client would get Caddy's bare 413 instead of the API's structured one
    assert int(ceiling.group(1)) * MIB > max(BODY_LIMITS.values())
