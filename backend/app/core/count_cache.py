"""A few seconds' memory for the queue counts, emptied by every commit.

One click asks for the same counts several times: the sidebar badges, the
page's own tab badges and the Action Center counters all want them, often in
the same second. Each of those used to compute them again from scratch. This
lets them share one answer.

Two rules keep a shared answer from becoming a wrong one:

* **Any commit empties it.** Assigning, reviewing or approving anything is a
  commit, so the read that follows an action always computes afresh -- the
  badge moves the moment the work does, exactly as it did uncached.
* **A value computed across a commit is not kept.** A count that started before
  someone else's commit and finished after it may already be out of date, so
  it is handed to its caller but not stored.

What it cannot see is a commit in *another* backend worker process, each of
which has its own copy. A count can therefore lag another worker's action by at
most ``TTL_SECONDS``. That bound is why the lifetime is short.

Concurrent requests for the same key wait for the first one to finish rather
than all computing it at once, which is the case the cache exists for.
"""
from __future__ import annotations

import copy
import threading
import time
from collections.abc import Callable, Hashable
from typing import Any

from sqlalchemy import event

from app.core.database import SessionLocal

TTL_SECONDS = 5.0

_lock = threading.Lock()
_values: dict[Hashable, tuple[float, Any]] = {}
_key_locks: dict[Hashable, threading.Lock] = {}
_generation = 0


def get_or_compute(key: Hashable, compute: Callable[[], Any]) -> Any:
    """The cached value for *key*, computing and storing it if absent or stale.

    Always returns a copy, so a caller that edits what it was given (the
    Action Center renames one of the keys) cannot change what the next caller
    receives.
    """
    with _lock:
        hit = _values.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return copy.deepcopy(hit[1])
        key_lock = _key_locks.setdefault(key, threading.Lock())

    with key_lock:
        # Whoever held the key lock may have just stored it.
        with _lock:
            hit = _values.get(key)
            if hit is not None and hit[0] > time.monotonic():
                return copy.deepcopy(hit[1])
            started_at = _generation

        value = compute()

        with _lock:
            if _generation == started_at:
                _values[key] = (time.monotonic() + TTL_SECONDS, value)
    return copy.deepcopy(value)


def clear() -> None:
    """Forget every cached value. Called on commit; also useful in tests."""
    global _generation
    with _lock:
        _values.clear()
        _generation += 1


@event.listens_for(SessionLocal, "after_commit")
def _clear_on_commit(_session) -> None:
    clear()
