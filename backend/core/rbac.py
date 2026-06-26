# Role-based access checks — STRIPPED for the community edition.
#
# The community edition has no authentication and no roles, so admin
# gating is meaningless. `require_admin` is a no-op kept under its
# historical name for import compatibility; every endpoint is open.

from __future__ import annotations


def require_admin(token: str) -> None:
    """No-op — the community edition has no roles; every endpoint is open."""
    return None
