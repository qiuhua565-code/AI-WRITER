from celery import Celery
from app.config import settings

celery_app = Celery(
    "ai_storyflow",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.celery_tasks.story"],
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,

    # Worker
    worker_concurrency=settings.CELERY_WORKER_CONCURRENCY,
    worker_prefetch_multiplier=1,   # one task at a time per worker slot

    # Task behavior
    task_acks_late=True,            # ack only after task finishes (safer)
    task_reject_on_worker_lost=True,
    task_track_started=True,

    # Results
    result_expires=3600 * 24 * 7,  # keep results 7 days

    # Retry defaults (overridden per task)
    task_default_retry_delay=10,
    task_max_retries=3,
)
