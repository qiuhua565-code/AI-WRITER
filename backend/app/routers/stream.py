"""
SSE (Server-Sent Events) endpoint for real-time task streaming.

Clients connect to GET /api/v1/tasks/{task_id}/stream and receive a stream of
events from the Redis Stream `task:{id}:stream`.

Event format (text/event-stream):
  id: <redis-stream-entry-id>
  data: <json>

Clients should reconnect with `Last-Event-ID` header to resume from the last
received message.

Redis Stream entry fields (always strings):
  type        – token | stage | segment_status | task_status | plan_ready | task_failed
  content     – token text (type=token only)
  segment_id  – str(segment.id) (for segment-scoped events)
  status      – new status value
  word_count  – current word count
  stage       – plan | intro | free | paywall | paid
  error       – error message (type=task_failed)
"""

import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.task import Task
from app.redis_client import get_redis
from app.utils.deps import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/tasks", tags=["stream"])

# How long (seconds) to block waiting for new Redis Stream entries
BLOCK_MS = 5000   # 5 s
# Keepalive comment every N seconds of silence
KEEPALIVE_INTERVAL = 20
# Stop streaming after task reaches one of these terminal states
TERMINAL_STATUSES = {"review", "approved", "failed", "cancelled"}
# Token events: read one at a time for real-time feel
# Non-token events: can batch since they're infrequent
TOKEN_READ_COUNT = 1
BATCH_READ_COUNT = 10


@router.get("/{task_id}/stream")
async def stream_task(
    task_id: int,
    request: Request,
    last_event_id: str | None = Header(default=None, alias="last-event-id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    SSE endpoint.  Streams all events from Redis Stream `task:{id}:stream`.
    Supports resuming via Last-Event-ID header.
    """
    # Verify task exists and belongs to user
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")

    return StreamingResponse(
        _event_generator(request, redis, task_id, last_event_id, task.status),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


async def _event_generator(
    request: Request,
    redis,
    task_id: int,
    last_event_id: str | None,
    initial_status: str,
) -> AsyncGenerator[str, None]:
    stream_key = f"task:{task_id}:stream"

    # Determine start position in the Redis Stream
    # ">" means "everything from the beginning", otherwise resume after last_event_id
    start_id = last_event_id if last_event_id else "0"

    # If the task is already terminal, drain existing entries then close
    is_terminal = initial_status in TERMINAL_STATUSES

    # Send an initial comment so the connection is established
    yield ": connected\n\n"

    keepalive_counter = 0
    current_status = initial_status
    catching_up = True   # True = draining historical entries in bulk

    try:
        while True:
            # Client disconnected?
            if await request.is_disconnected():
                break

            # When catching up on history use larger batch; once live use 1
            read_count = BATCH_READ_COUNT if catching_up else TOKEN_READ_COUNT

            # Read new entries from the Redis Stream
            entries = await redis.xread(
                {stream_key: start_id},
                count=read_count,
                block=BLOCK_MS if not is_terminal else 0,
            )

            if not entries:
                # No more historical data — we're now live
                catching_up = False
                # Timeout – send keepalive comment
                keepalive_counter += 1
                if keepalive_counter * (BLOCK_MS / 1000) >= KEEPALIVE_INTERVAL:
                    yield ": keepalive\n\n"
                    keepalive_counter = 0

                if is_terminal:
                    # No more data and task is done – close stream
                    break
                continue

            # If we got fewer entries than requested, we've caught up
            total_received = sum(len(msgs) for _, msgs in entries)
            if total_received < read_count:
                catching_up = False

            keepalive_counter = 0
            # entries = [(stream_key, [(entry_id, {field: value, ...}), ...])]
            for _key, messages in entries:
                for entry_id, fields in messages:
                    start_id = entry_id  # advance cursor

                    event_type = fields.get("type", "unknown")

                    # Track task status transitions so we know when to stop
                    if event_type == "task_status":
                        current_status = fields.get("status", current_status)
                        if current_status in TERMINAL_STATUSES:
                            is_terminal = True

                    payload = dict(fields)
                    data_str = json.dumps(payload, ensure_ascii=False)

                    yield f"id: {entry_id}\nevent: {event_type}\ndata: {data_str}\n\n"

            if is_terminal:
                # Drain any remaining buffered entries then close
                break

    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.exception("SSE generator error for task %s", task_id)
        error_payload = json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)
        yield f"event: error\ndata: {error_payload}\n\n"
