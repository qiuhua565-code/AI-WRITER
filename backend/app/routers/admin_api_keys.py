from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
import redis.asyncio as aioredis

from app.database import get_db
from app.models.system_api_key import SystemApiKey
from app.models.user import User
from app.utils.deps import get_current_admin
from app.utils.security import encrypt_api_key, make_key_hint
from app.redis_client import get_redis
from app.services.key_pool import LOCK_PREFIX

router = APIRouter(prefix="/api/v1/admin/api-keys", tags=["admin-api-keys"])

PROVIDER_LABELS = {
    "claude": "Claude (Anthropic)",
    "aipipe": "AIPipe 中转",
    "openai": "OpenAI",
    "deepseek": "DeepSeek",
    "gemini": "Google Gemini",
    "custom": "自定义",
}


class AddKeyRequest(BaseModel):
    provider: str
    api_key: str
    label: str = ""
    purpose: str = "both"   # task | chat | both


def _row_to_dict(row: SystemApiKey, in_use: bool) -> dict:
    return {
        "id": row.id,
        "provider": row.provider,
        "label": row.label,
        "purpose": row.purpose,
        "key_hint": row.key_hint,
        "is_active": row.is_active,
        "in_use": in_use,
        "created_at": row.created_at,
    }


@router.get("")
async def list_system_keys(
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(
        select(SystemApiKey).order_by(SystemApiKey.created_at.desc())
    )).scalars().all()

    result = []
    for r in rows:
        in_use = bool(await redis.exists(f"{LOCK_PREFIX}{r.id}"))
        result.append(_row_to_dict(r, in_use))
    return result


@router.post("")
async def add_system_key(
    body: AddKeyRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if body.purpose not in ("task", "chat", "both"):
        raise HTTPException(status_code=400, detail="purpose 必须是 task、chat 或 both")
    if len(body.api_key) < 10:
        raise HTTPException(status_code=400, detail="API Key 太短")

    label = body.label or PROVIDER_LABELS.get(body.provider, body.provider)
    key = SystemApiKey(
        provider=body.provider,
        label=label,
        key_encrypted=encrypt_api_key(body.api_key),
        key_hint=make_key_hint(body.api_key),
        is_active=True,
        purpose=body.purpose,
        created_at=datetime.now(timezone.utc),
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return _row_to_dict(key, False)


@router.delete("/{key_id}", status_code=204)
async def delete_system_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    _: User = Depends(get_current_admin),
):
    row = (await db.execute(select(SystemApiKey).where(SystemApiKey.id == key_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Key 不存在")
    if await redis.exists(f"{LOCK_PREFIX}{key_id}"):
        raise HTTPException(status_code=400, detail="该 Key 正在使用中，无法删除，请等待任务完成")

    await db.execute(delete(SystemApiKey).where(SystemApiKey.id == key_id))
    await db.commit()


@router.patch("/{key_id}/toggle")
async def toggle_system_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    row = (await db.execute(select(SystemApiKey).where(SystemApiKey.id == key_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Key 不存在")
    row.is_active = not row.is_active
    await db.commit()
    return {"id": row.id, "is_active": row.is_active}


@router.post("/{key_id}/release")
async def force_release_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
    _: User = Depends(get_current_admin),
):
    row = (await db.execute(select(SystemApiKey).where(SystemApiKey.id == key_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Key 不存在")
    await redis.delete(f"{LOCK_PREFIX}{key_id}")
    return {"message": "已强制释放锁"}
