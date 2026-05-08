import redis
import redis.asyncio as aioredis
from app.config import settings

_redis_pool: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=10,
            socket_connect_timeout=5,
            socket_keepalive=True,
            health_check_interval=30,
            retry_on_timeout=True,
        )
    return _redis_pool


def reset_redis_pool() -> None:
    """每个 Celery 任务调用 asyncio.run() 前调用，确保 Redis 客户端在新的事件循环里重建。"""
    global _redis_pool
    _redis_pool = None


def get_sync_redis() -> redis.Redis:
    """返回一个同步 Redis 客户端，专供 Celery 任务（gevent 环境外）使用。"""
    return redis.Redis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=5,
        socket_keepalive=True,
    )
