import redis.asyncio as aioredis


async def set_task_control(redis: aioredis.Redis, task_id: int, signal: str, ttl: int = 300):
    await redis.setex(f"task:{task_id}:control", ttl, signal)


async def get_task_control(redis: aioredis.Redis, task_id: int) -> str | None:
    return await redis.get(f"task:{task_id}:control")


async def clear_task_control(redis: aioredis.Redis, task_id: int):
    await redis.delete(f"task:{task_id}:control")
