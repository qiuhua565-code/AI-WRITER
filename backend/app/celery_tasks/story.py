import asyncio
import logging
import random
import threading
from datetime import datetime, timezone, timedelta

from app.celery_app import celery_app

logger = logging.getLogger(__name__)

# 任务超过此时长仍未完成 → 视为卡死，标记失败
_MAX_TASK_AGE_HOURS = 16

# Key 抢锁失败时的指数退避（秒）：第 N 次失败 → min(KEY_RETRY_BASE * N, KEY_RETRY_CAP) + jitter
# 设计目标：用户绑 1 把 key 提多个任务时，前一任务释放锁后下一个最多等约 KEY_RETRY_CAP 秒就接上。
_KEY_RETRY_BASE = 8
_KEY_RETRY_CAP = 25


def _run_async(coro):
    """
    在**独占 OS 线程**里用全新 event loop 跑协程。

    Celery `--pool=gevent` 下，`ThreadPoolExecutor` 可能被猴子补丁导致工作项在当前绿let/线程执行，
    从而出现「第二次 asyncio.run() → RuntimeError: already running event loop」。
    因此不用 asyncio.run、不用线程池，改为显式 new_event_loop + threading.Thread。
    """
    result: list = []
    errors: list = []

    def _in_thread() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result.append(loop.run_until_complete(coro))
        except BaseException as exc:
            errors.append(exc)
            try:
                coro.close()
            except Exception:
                pass
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                pass
            try:
                loop.close()
            except Exception:
                pass
            asyncio.set_event_loop(None)

    t = threading.Thread(target=_in_thread, name="celery-story-asyncio", daemon=True)
    t.start()
    t.join()
    if errors:
        raise errors[0]
    return result[0] if result else None


async def kick_queued_stories_for_user_async(user_id: int) -> None:
    """
    在**当前**事件循环里查询并投递下一条 queued（须在 asyncio.run 线程内 await）。
    """
    from app.database import AsyncSessionLocalWorker
    from app.models.task import Task
    from sqlalchemy import select

    async with AsyncSessionLocalWorker() as db:
        row = (
            await db.execute(
                select(Task.id).where(
                    Task.user_id == user_id,
                    Task.status == "queued",
                ).order_by(Task.created_at.asc()).limit(1)
            )
        ).first()
    tid = int(row[0]) if row else None
    if tid is None:
        return
    try:
        run_story.apply_async(args=[tid, user_id], countdown=0)
        logger.info("Kick queued story | user_id=%s task_id=%s", user_id, tid)
    except Exception:
        logger.exception("kick apply_async failed | user_id=%s task_id=%s", user_id, tid)


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
        # Key 都在用，正常排队等待。退避策略：从 8s 起步、上限 25s + 抖动，避免雷鸣群效应。
        attempt = self.request.retries + 1
        countdown = min(_KEY_RETRY_BASE * attempt, _KEY_RETRY_CAP) + random.randint(0, 3)
        logger.info("Task %s waiting for free key — retry in %ds (attempt=%d)", task_id, countdown, attempt)
        _set_task_key_queue_waiting(task_id)
        raise self.retry(countdown=countdown)
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
        from app.database import AsyncSessionLocalWorker
        from app.models.task import Task
        from sqlalchemy import select
        async with AsyncSessionLocalWorker() as db:
            task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
            if not task:
                return True  # 任务已被删除，不再重试
            age = datetime.now(timezone.utc) - task.created_at.replace(tzinfo=timezone.utc)
            return age > timedelta(hours=_MAX_TASK_AGE_HOURS)
    return _run_async(_check())


def _set_task_key_queue_waiting(task_id: int) -> None:
    """用户绑定 Key 时不会走此分支；仅系统池抢锁失败时提示排队原因。"""
    async def _do():
        from app.database import AsyncSessionLocalWorker
        from app.models.task import Task
        from app.utils.task_messages import KEY_QUEUE_WAITING_MSG
        from sqlalchemy import select

        async with AsyncSessionLocalWorker() as db:
            task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
            if task and task.status == "queued":
                task.warning_msg = KEY_QUEUE_WAITING_MSG
                await db.commit()

    _run_async(_do())


def _mark_task_failed(task_id: int, error_msg: str):
    async def _do():
        from app.database import AsyncSessionLocalWorker
        from app.models.task import Task
        from sqlalchemy import select
        async with AsyncSessionLocalWorker() as db:
            task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
            if task:
                task.status = "failed"
                task.error_msg = error_msg
                await db.commit()
    _run_async(_do())


def kick_queued_stories_for_user(user_id: int) -> None:
    """
    当前 run 已释放写稿 Redis 锁之后：为同一用户再投递最早一条 queued 任务。
    仅在有**运行中事件循环**的上下文中请改用 `await kick_queued_stories_for_user_async`。
    """
    _run_async(kick_queued_stories_for_user_async(user_id))
