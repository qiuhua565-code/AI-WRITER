from celery import Celery
from app.config import settings

# Windows multiprocessing fix: must be called before any process is spawned
import multiprocessing
multiprocessing.freeze_support()

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

    # Worker — 并发数建议 = key 池里写稿 key 的数量
    worker_concurrency=settings.CELERY_WORKER_CONCURRENCY,
    worker_prefetch_multiplier=1,   # 每个 slot 只预取1个任务，避免抢占

    # Task behavior
    task_acks_late=True,            # ack only after task finishes (safer)
    task_reject_on_worker_lost=True,
    task_track_started=True,

    # Results
    result_expires=3600 * 24 * 7,  # keep results 7 days

    # Retry defaults (overridden per task)
    task_default_retry_delay=10,
    task_max_retries=3,

    # Broker connection resilience (remote Redis over WAN)
    broker_transport_options={
        "socket_timeout": 30,
        "socket_connect_timeout": 10,
        "socket_keepalive": True,
        "retry_on_timeout": True,
        "health_check_interval": 30,
    },
    broker_connection_retry_on_startup=True,
    broker_connection_retry=True,
    broker_connection_max_retries=None,  # retry forever
)
