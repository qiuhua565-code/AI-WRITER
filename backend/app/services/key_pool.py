"""
API Key 池管理。
管理员可配置多个 system key，每个 key 同时只能被一个任务占用。
通过 Redis 分布式锁实现互斥。
"""

import asyncio
import logging
import random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system_api_key import SystemApiKey
from app.models.user import User
from app.models.api_key import UserApiKey
from app.utils.security import decrypt_api_key

logger = logging.getLogger(__name__)

LOCK_PREFIX = "key_lock:"   # Redis 锁前缀，router 也用这个判断 in_use
LOCK_TTL = 360              # 锁过期时间（秒），心跳每 60s 续期
HEARTBEAT_INTERVAL = 60     # 心跳间隔（秒）


class NoKeyConfiguredError(RuntimeError):
    """管理员未配置任何 API Key。"""


class NoKeyAvailableError(RuntimeError):
    """所有 key 都在被其他任务占用。"""


async def get_user_bound_key_for_task(db: AsyncSession, user_id: int) -> str | None:
    """
    用户为「生稿/批任务」绑定的 Key：UserApiKey(claude|aipipe, purpose=generate|both)，
    否则回退到 users.llm_api_key_encrypted（与旧版设置页、Claude 同步字段一致）。
    """
    rows = (
        await db.execute(
            select(UserApiKey)
            .where(
                UserApiKey.user_id == user_id,
                UserApiKey.provider.in_(["claude", "aipipe"]),
                UserApiKey.purpose.in_(["both", "generate"]),
            )
        )
    ).scalars().all()
    if rows:
        row = random.choice(rows)
        return decrypt_api_key(row.key_encrypted)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user and user.llm_api_key_encrypted:
        return decrypt_api_key(user.llm_api_key_encrypted)
    return None


async def get_user_bound_key_for_chat(db: AsyncSession, user_id: int) -> str | None:
    """对话 / 审校辅助：UserApiKey(chat|both)，否则 users.llm_api_key_encrypted。"""
    rows = (
        await db.execute(
            select(UserApiKey)
            .where(
                UserApiKey.user_id == user_id,
                UserApiKey.provider.in_(["claude", "aipipe"]),
                UserApiKey.purpose.in_(["both", "chat"]),
            )
        )
    ).scalars().all()
    if rows:
        row = random.choice(rows)
        return decrypt_api_key(row.key_encrypted)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user and user.llm_api_key_encrypted:
        return decrypt_api_key(user.llm_api_key_encrypted)
    return None


async def acquire_task_llm_key(
    redis, db: AsyncSession, user_id: int
) -> tuple[bool, int | None, str]:
    """
    自动写稿任务取 Key：优先用户绑定 Key（不占系统池锁）；否则系统池抢占一把锁。
    返回 (use_system_pool, system_key_id_or_none, plaintext_api_key)。
    """
    bound = await get_user_bound_key_for_task(db, user_id)
    if bound:
        logger.info("Task uses user-bound LLM key user_id=%s", user_id)
        return False, None, bound
    key_id, api_key = await acquire_any_key(redis, db)
    return True, key_id, api_key


async def acquire_any_key(redis, db: AsyncSession) -> tuple[int, str]:
    """
    从系统 key 池里抢占一个空闲的写稿专用 key。
    只取 purpose in ("task", "both") 的 key。
    返回 (key_id, 解密后的 api_key)。
    """
    rows = (await db.execute(
        select(SystemApiKey)
        .where(
            SystemApiKey.is_active == True,
            SystemApiKey.provider.in_(["aipipe", "claude"]),
            SystemApiKey.purpose.in_(["task", "both"]),
        )
        .order_by(SystemApiKey.provider, SystemApiKey.id)  # aipipe 优先
    )).scalars().all()

    if not rows:
        raise NoKeyConfiguredError("管理员未配置 API Key，请在后台 API Key 管理页添加")

    for row in rows:
        lock_key = f"{LOCK_PREFIX}{row.id}"
        acquired = await redis.set(lock_key, "1", nx=True, ex=LOCK_TTL)
        if acquired:
            key = decrypt_api_key(row.key_encrypted)
            logger.info("Acquired key db_id=%s provider=%s key=%s...%s",
                        row.id, row.provider, key[:8], key[-4:])
            return row.id, key

    raise NoKeyAvailableError(f"所有 {len(rows)} 个 API Key 当前均被占用，请稍后重试")


async def get_key_for_chat(db: AsyncSession, user_id: int | None = None) -> str | None:
    """
    为聊天/辅助修改获取 key（不加互斥锁）。
    若传入 user_id，优先使用该用户在设置里绑定的 Key；否则仅用系统池。
    """
    if user_id is not None:
        chat_bound = await get_user_bound_key_for_chat(db, user_id)
        if chat_bound:
            logger.debug("Chat/review using user-bound key user_id=%s", user_id)
            return chat_bound

    rows = (await db.execute(
        select(SystemApiKey)
        .where(
            SystemApiKey.is_active == True,
            SystemApiKey.provider.in_(["aipipe", "claude"]),
            SystemApiKey.purpose.in_(["chat", "both"]),
        )
        .order_by(SystemApiKey.provider, SystemApiKey.id)
    )).scalars().all()

    if not rows:
        return None

    key = decrypt_api_key(rows[0].key_encrypted)
    logger.debug("Chat using key db_id=%s provider=%s", rows[0].id, rows[0].provider)
    return key


async def release_key(redis, key_id: int):
    """释放 key 锁。"""
    await redis.delete(f"{LOCK_PREFIX}{key_id}")
    logger.info("Released key db_id=%s", key_id)


async def key_heartbeat(redis, key_id: int):
    """定期续期 key 锁，防止任务运行中锁过期。"""
    lock_key = f"{LOCK_PREFIX}{key_id}"
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await redis.expire(lock_key, LOCK_TTL)
            logger.debug("Heartbeat refreshed lock for key db_id=%s", key_id)
    except asyncio.CancelledError:
        pass
