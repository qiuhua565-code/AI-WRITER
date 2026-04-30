import asyncio
import logging

from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="run_story",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    soft_time_limit=1800,   # 30 min soft limit
    time_limit=2100,        # 35 min hard limit
)
def run_story(self, task_id: int):
    """
    Celery entry point.  Runs the full EmotionStoryOrchestrator for one task.
    Uses asyncio.run() to execute async code inside the gevent worker.
    """
    from app.orchestrator.emotion_story import EmotionStoryOrchestrator

    logger.info("Starting story generation for task_id=%s", task_id)
    try:
        asyncio.run(EmotionStoryOrchestrator(task_id).run())
        logger.info("Story generation finished for task_id=%s", task_id)
    except Exception as exc:
        logger.exception("Story generation failed for task_id=%s", task_id)
        raise self.retry(exc=exc, countdown=10 * (self.request.retries + 1))
