import asyncio
import concurrent.futures
import logging
from datetime import datetime, timezone, timedelta

from app.celery_app import celery_app

logger = logging.getLogger(__name__)

# 任务超过此时长仍未完成 → 视为卡死，标记失败
_MAX_TASK_AGE_HOURS = 16


def _run_async(coro):
    """
    在独立线程里运行 async 协程，规避 gevent worker 中已有事件循环导致的
    'asyncio.run() cannot be called from a running event loop' 错误。
    每次都起新线程 + 新事件循环，互不干扰。
    """
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, coro)
        return future.result()


@celery_app.task(
    name="run_story",
    bind=True,
    max_retries=None,           # 无限重试，兜底靠时间检查
    default_retry_delay=60,
    soft_time_limit=10800,      # 3 小时软限（13 章 + 续写充裕）
    time_limit=11100,           # 3 小时 5 分硬限
)
def run_story(self, task_id: int, user_id: int = None):
    from app.orchestrator.emotion_story import EmotionStoryOrchestrator
    from app.redis_client import reset_redis_pool
    from app.services.key_pool import NoKeyAvailableError, NoKeyConfiguredError

    # ── 兜底检查：任务是否已超龄 ──────────────────────────────────
    if _is_task_too_old(task_id):
        logger.error("Task %s has been queued/retrying for >%dh, marking failed", task_id, _MAX_TASK_AGE_HOURS)
        _mark_task_failed(task_id, f"任务等待超过 {_MAX_TASK_AGE_HOURS} 小时，自动标记失败")
        return

    reset_redis_pool()
    try:
        _run_async(EmotionStoryOrchestrator(task_id).run())
    except NoKeyConfiguredError as exc:
        # 管理员还没配置 Key，立即失败，不要傻等
        logger.error("Task %s failed: no system key configured", task_id)
        _mark_task_failed(task_id, "未配置可用的 API Key：请在个人设置中绑定 LLM Key，或由管理员配置系统 Key 池")
        return
    except NoKeyAvailableError:
        # Key 都在用，正常排队等待（前端列表仍显示 queued，用 warning_msg 说明原因）
        logger.info("Task %s waiting for free key — retry in 60s", task_id)
        _set_task_key_queue_waiting(task_id)
        raise self.retry(countdown=60)
    except Exception as exc:
        wait = min(30 * (self.request.retries + 1), 300)  # 最长等 5 分钟
        logger.warning(
            "Task %s error (attempt %d), retry in %ds — %s: %s",
            task_id,
            self.request.retries + 1,
            wait,
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        raise self.retry(exc=exc, countdown=wait)


def _is_task_too_old(task_id: int) -> bool:
    """Return True if the task was created more than _MAX_TASK_AGE_HOURS ago."""
    async def _check():
        from app.database import AsyncSessionLocal
        from app.models.task import Task
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
            if not task:
                return True  # 任务已被删除，不再重试
            age = datetime.now(timezone.utc) - task.created_at.replace(tzinfo=timezone.utc)
            return age > timedelta(hours=_MAX_TASK_AGE_HOURS)
    return _run_async(_check())


def _set_task_key_queue_waiting(task_id: int) -> None:
    """用户绑定 Key 时不会走此分支；仅系统池抢锁失败时提示排队原因。"""
    async def _do():
        from app.database import AsyncSessionLocal
        from app.models.task import Task
        from app.utils.task_messages import KEY_QUEUE_WAITING_MSG
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
            if task and task.status == "queued":
                task.warning_msg = KEY_QUEUE_WAITING_MSG
                await db.commit()

    _run_async(_do())


def _mark_task_failed(task_id: int, error_msg: str):
    async def _do():
        from app.database import AsyncSessionLocal
        from app.models.task import Task
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
            if task:
                task.status = "failed"
                task.error_msg = error_msg
                await db.commit()
    _run_async(_do())
