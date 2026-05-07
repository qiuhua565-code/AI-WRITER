"""Cancel-safe persistence helpers for SSE streaming endpoints.

Background:
    When the HTTP client disconnects mid-stream, starlette cancels the entire
    StreamingResponse generator task. Any `await` that follows in the generator's
    `finally` block runs in a cancelled task and therefore re-raises CancelledError
    immediately — silently dropping work like writing partial assistant content to DB.

The fix is to detach the persistence work into an independent asyncio.Task. Tasks
created via asyncio.create_task are NOT cancelled when the originating task is
cancelled, so they keep running until completion in the event loop.

We additionally hold strong references to the spawned tasks in a module-level set
to prevent them from being garbage-collected before they finish.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Coroutine

logger = logging.getLogger(__name__)

_pending_persist_tasks: set[asyncio.Task] = set()


def spawn_persist_task(coro: Coroutine) -> asyncio.Task:
    """Create a fire-and-forget task that survives caller cancellation.

    The returned task is rooted in the running event loop, not in the caller's
    cancel scope, so client-disconnect-induced cancellation propagates only to
    the caller — the persistence work itself runs to completion.
    """
    task = asyncio.create_task(coro)
    _pending_persist_tasks.add(task)
    task.add_done_callback(_pending_persist_tasks.discard)
    return task


async def best_effort_wait(
    task: asyncio.Task | Awaitable, *, timeout: float = 5.0, label: str = "persist"
) -> None:
    """Wait briefly for ``task`` to finish without aborting it on timeout/cancel.

    ``asyncio.wait_for`` would cancel the inner task on timeout, which is exactly
    what we want to avoid here — we use ``asyncio.wait`` (which does not cancel
    its inputs) wrapped in ``asyncio.shield`` so external cancellation can't
    propagate down either.

    On CancelledError or timeout, the underlying task continues running detached
    in the event loop.
    """
    if not isinstance(task, asyncio.Task):
        task = asyncio.ensure_future(task)
        _pending_persist_tasks.add(task)
        task.add_done_callback(_pending_persist_tasks.discard)
    try:
        await asyncio.shield(asyncio.wait({task}, timeout=timeout))
    except asyncio.CancelledError:
        # Caller (the SSE generator) was cancelled by client disconnect. We deliberately
        # swallow this so the surrounding `finally` block can finish cleanly; the
        # detached task itself is unaffected and continues running until done.
        logger.info("%s detached (caller cancelled) — task continues in background", label)
