"""The one way the backend writes down "now"."""

from __future__ import annotations

from datetime import datetime, timezone


def now_iso() -> str:
    """This moment as UTC ISO 8601 with a `Z`, to the second — how the stores and the
    run reports record time."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
