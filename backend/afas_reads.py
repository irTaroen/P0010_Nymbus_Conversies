"""A short cache for the customer reads the payload view shows on every render.

The *Bestaat al* / *Nieuw* marks (`existing.fetch_keys`) and the lookup marks
(`lookups.fetch_table`) each read a whole connector — paged, a debiteurenlijst of
thousands of rows — and the panel asks again on every mount, tab switch and filter
change. Nothing in those connectors changes between two clicks unless this tool wrote
to them, so a minute's cache answers the clicks and a write clears it.

**Only for display.** What decides a write is never served from here: the pre-send
re-check (`_verified_verbs` in main.py) and the delete route read AFAS afresh, because
a stale "new" there would POST a duplicate into a customer's administratie. A mark
on screen a few seconds old costs nothing; a verb chosen on one could.

Cleared per environment whenever a send or delete run starts or ends
(`payload_send._execute`), so the marks after a run show what the run did.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Hashable
from typing import TypeVar

from afas import AfasEnvironment, AfasResult
from clock import now_iso

_T = TypeVar("_T")

_TTL_SECONDS = 60.0

# (omgevingnummer, stage, kind, key) -> (monotonic time it was read, the answer)
_entries: dict[tuple, tuple[float, tuple[object, AfasResult, str]]] = {}
_locks: dict[tuple, asyncio.Lock] = {}


def _environment(env: AfasEnvironment) -> tuple[str, str]:
    return (env.omgevingnummer, env.stage.value)


async def cached(
    env: AfasEnvironment,
    kind: str,
    key: Hashable,
    load: Callable[[], Awaitable[tuple[_T | None, AfasResult]]],
) -> tuple[_T | None, AfasResult, str]:
    """`load()`'s answer and **when AFAS gave it** (UTC ISO, what a route reports as
    `fetchedAt` — a cached mark must not claim to be fresh), from the cache while it
    is under a minute old. Only an answer is cached — a `None` (AFAS couldn't say)
    is asked again next time — and concurrent callers for one key share one read."""
    cache_key = (*_environment(env), kind, key)
    async with _locks.setdefault(cache_key, asyncio.Lock()):
        entry = _entries.get(cache_key)
        if entry is not None and time.monotonic() - entry[0] <= _TTL_SECONDS:
            return entry[1]  # type: ignore[return-value]
        value, result = await load()
        answer = (value, result, now_iso())
        if value is not None:
            _entries[cache_key] = (time.monotonic(), answer)
        return answer


def forget_environment(env: AfasEnvironment) -> None:
    """Drop everything read from this environment — it has just been written to."""
    prefix = _environment(env)
    for cache_key in [k for k in _entries if k[:2] == prefix]:
        del _entries[cache_key]
