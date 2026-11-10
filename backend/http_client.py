"""The backend's outgoing HTTP connections, kept open between calls.

A fresh `httpx.AsyncClient` per call — what `afas.py` and `oidc.py` used to do —
means a fresh TCP connection and TLS handshake per call. For a payload send that is
hundreds of sequential POSTs to the same AFAS host, each paying ~100 ms before a byte
of the record goes out. One pooled client per event loop keeps those connections
alive and reuses them.

**Per event loop**, not one global: an async client is bound to the loop it first
ran on, and the backend's scripts (`scripts/`, `migrations/`) each start their own
loop with `asyncio.run`. The server has one loop for its whole life, so in practice
that is one client; a script that runs `asyncio.run` twice gets a second one rather
than a client whose loop is closed.

Each caller still passes its own `timeout` per request — the pool is shared, the
patience isn't.
"""

from __future__ import annotations

import asyncio
import weakref

import httpx

_clients: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, httpx.AsyncClient]" = (
    weakref.WeakKeyDictionary()
)


def async_client() -> httpx.AsyncClient:
    """The pooled client for the running event loop, created on first use."""
    loop = asyncio.get_running_loop()
    client = _clients.get(loop)
    if client is None or client.is_closed:
        client = httpx.AsyncClient()
        _clients[loop] = client
    return client


async def aclose() -> None:
    """Close the running loop's client — the app's shutdown, so its sockets don't
    outlive the server."""
    client = _clients.pop(asyncio.get_running_loop(), None)
    if client is not None:
        await client.aclose()


_sync_client: httpx.Client | None = None


def sync_client() -> httpx.Client:
    """One pooled blocking client, for the code that runs in worker threads (the
    Graph mail). `httpx.Client` is safe to share between threads."""
    global _sync_client
    if _sync_client is None or _sync_client.is_closed:
        _sync_client = httpx.Client()
    return _sync_client
