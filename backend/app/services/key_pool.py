"""
API Key 池管理。
管理员可配置多个 system key，每个 key 同时只能被一个任务占用。
通过 Redis 分布式锁实现互斥。

写稿任务取 key 时**统一**走互斥锁：
- 系统池 key   → 锁名 `key_lock:{key_id}`（保留旧约定，admin UI 据此判断 in_use）。
- 用户绑定 key → 锁名 `key_lock:user_bound:{sha256(plaintext)[:16]}`。
  同一明文 key 不论被几个用户绑定，都共享一把锁，避免上游被并发滥用导致 429。
"""

import asyncio
import hashlib
import logging
import random
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system_api_key import SystemApiKey
from app.models.user import User
from app.models.api_key import UserApiKey
from app.utils.security import decrypt_api_key

logger = logging.getLogger(__name__)

LOCK_PREFIX = "key_lock:"   # Redis 锁前缀，router 也用这个判断 in_use
USER_BOUND_LOCK_PREFIX = f"{LOCK_PREFIX}user_bound:"
LOCK_TTL = 360              # 锁过期时间（秒），心跳每 60s 续期
HEARTBEAT_INTERVAL = 60     # 心跳间隔（秒）


class NoKeyConfiguredError(RuntimeError):
    """管理员未配置任何 API Key。"""


class NoKeyAvailableError(RuntimeError):
    """所有 key 都在被其他任务占用。"""


@dataclass
class KeyLease:
    """对一个已加锁的 LLM key 的租约；持有期间锁不会被别的任务抢到。

    fields:
        api_key:        明文 key，传给 LLMClient
        lock_key:       Redis 锁的完整 key（用于 release / heartbeat）
        system_key_id:  仅当来自系统池时有值（admin UI 据 id 判断 in_use）
        is_user_bound:  True 表示用户在「设置」里绑定的 key
    """

    api_key: str
    lock_key: str
    system_key_id: int | None
    is_user_bound: bool


def _user_bound_lock_key(plaintext_api_key: str) -> str:
    """同一明文 key 全局唯一一把锁，避免不同用户用同一个 key 时仍并发限流。"""
    digest = hashlib.sha256(plaintext_api_key.encode("utf-8")).hexdigest()[:16]
    return f"{USER_BOUND_LOCK_PREFIX}{digest}"


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
        decrypted_key = decrypt_api_key(row.key_encrypted)
        logger.warning(
            "🔐 Using user chat key | user_id=%d | provider=%s | purpose=%s | label=%s | key=%s...%s",
            user_id, row.provider, row.purpose, row.label or "(无标签)",
            decrypted_key[:12] if len(decrypted_key) > 12 else decrypted_key[:4],
            decrypted_key[-6:] if len(decrypted_key) > 12 else ""
        )
        return decrypted_key
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user and user.llm_api_key_encrypted:
        decrypted_key = decrypt_api_key(user.llm_api_key_encrypted)
        logger.warning(
            "🔐 Using legacy user key | user_id=%d | key=%s...%s",
            user_id,
            decrypted_key[:12] if len(decrypted_key) > 12 else decrypted_key[:4],
            decrypted_key[-6:] if len(decrypted_key) > 12 else ""
        )
        return decrypted_key
    return None


async def acquire_task_llm_key(
    redis, db: AsyncSession, user_id: int
) -> KeyLease:
    """
    自动写稿任务取 Key：优先用户绑定 Key，否则系统池。**两者都加 Redis 互斥锁**，
    避免同一 key 被多个任务并发调用 → 上游 429 / RateLimit。

    抢锁失败时抛 NoKeyAvailableError，由 Celery retry 60s 后重试（自动排队）。
    若管理员未配置任何 key（且用户也没绑定）→ NoKeyConfiguredError，直接失败。
    """
    bound = await get_user_bound_key_for_task(db, user_id)
    if bound:
        lock_key = _user_bound_lock_key(bound)
        acquired = await redis.set(lock_key, str(user_id), nx=True, ex=LOCK_TTL)
        if not acquired:
            raise NoKeyAvailableError(
                "您绑定的 API Key 当前正被另一个任务使用，已为此任务自动排队"
            )
        logger.info(
            "Task uses user-bound LLM key | user_id=%s | lock=%s | key=%s...%s",
            user_id, lock_key, bound[:8], bound[-4:],
        )
        return KeyLease(
            api_key=bound,
            lock_key=lock_key,
            system_key_id=None,
            is_user_bound=True,
        )
    key_id, api_key = await acquire_any_key(redis, db)
    return KeyLease(
        api_key=api_key,
        lock_key=f"{LOCK_PREFIX}{key_id}",
        system_key_id=key_id,
        is_user_bound=False,
    )


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


async def release_lease(redis, lease: KeyLease | None) -> None:
    """释放租约锁；幂等。"""
    if lease is None:
        return
    try:
        await redis.delete(lease.lock_key)
        logger.info(
            "Released key lock | lock=%s | system_key_id=%s | user_bound=%s",
            lease.lock_key, lease.system_key_id, lease.is_user_bound,
        )
    except Exception:
        logger.exception("Failed to release key lock %s", lease.lock_key)


async def lease_heartbeat(redis, lease: KeyLease) -> None:
    """定期续期租约锁，防止任务运行中锁过期。"""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            try:
                await redis.expire(lease.lock_key, LOCK_TTL)
                logger.debug("Heartbeat refreshed lock %s", lease.lock_key)
            except Exception:
                logger.exception("Heartbeat error for %s", lease.lock_key)
    except asyncio.CancelledError:
        pass


# ── 兼容旧调用位（如未来有遗留代码引用，保持可运行） ───────────────────────
async def release_key(redis, key_id: int) -> None:
    """已废弃：保留以兼容旧调用；新代码请使用 release_lease(redis, lease)。"""
    await redis.delete(f"{LOCK_PREFIX}{key_id}")
    logger.info("Released key (legacy) db_id=%s", key_id)


async def key_heartbeat(redis, key_id: int) -> None:
    """已废弃：保留以兼容旧调用；新代码请使用 lease_heartbeat(redis, lease)。"""
    lock_key = f"{LOCK_PREFIX}{key_id}"
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await redis.expire(lock_key, LOCK_TTL)
            logger.debug("Heartbeat (legacy) refreshed lock for key db_id=%s", key_id)
    except asyncio.CancelledError:
        pass
