"""Live updates: one monotonically increasing data version, pushed to every
open browser over Server-Sent Events.

Anything that changes what a screen shows — a plan approved, a block
placed by the sweep, a request submitted — bumps the version (the API
middleware does it after every mutating call, the clock after every sweep
that changed something). Each browser keeps one EventSource open and
refetches when the version it sees moves. Cheap, no per-topic bookkeeping,
and it can never miss an update: the version is the source of truth.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Iterator

_version = 0
_cond = threading.Condition()

HEARTBEAT_S = 15.0


def bump(reason: str = "") -> int:
    global _version
    with _cond:
        _version += 1
        _cond.notify_all()
        return _version


def current() -> int:
    with _cond:
        return _version


def stream(start_after: int | None = None) -> Iterator[str]:
    """SSE frames: `change` whenever the version moves, a comment as a
    heartbeat otherwise so proxies keep the connection open."""
    last = current() if start_after is None else start_after
    yield f"event: hello\ndata: {json.dumps({'version': last})}\n\n"
    while True:
        with _cond:
            if _version == last:
                _cond.wait(timeout=HEARTBEAT_S)
            now = _version
        if now != last:
            last = now
            yield f"event: change\ndata: {json.dumps({'version': now, 'at': time.time()})}\n\n"
        else:
            yield ": keep-alive\n\n"
