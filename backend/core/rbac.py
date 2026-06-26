# Role-based access checks — no roles.
#
# The community edition has no authentication and no roles, so admin
# gating is meaningless. `require_admin` is a no-op; every endpoint is open.

from __future__ import annotations


def require_admin(token: str) -> None:
    """No-op — the community edition has no roles; every endpoint is open."""
    return None
