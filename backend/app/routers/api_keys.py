from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.api_key import UserApiKey
from app.utils.deps import get_current_user
from app.services.user_api_key_ops import insert_user_api_key, sync_user_legacy_claude_from_pool

router = APIRouter(prefix="/api/v1/auth/api-keys", tags=["api-keys"])


class AddKeyRequest(BaseModel):
    provider: str
    purpose: str = "both"
    api_key: str
    label: str = ""


@router.get("")
async def list_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(UserApiKey)
        .where(UserApiKey.user_id == current_user.id)
        .order_by(UserApiKey.created_at.desc())
    )).scalars().all()

    return [
        {
            "id": r.id,
            "provider": r.provider,
            "purpose": r.purpose,
            "label": r.label,
            "key_hint": r.key_hint,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.post("")
async def add_key(
    body: AddKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        new_key = await insert_user_api_key(
            db,
            current_user.id,
            provider=body.provider,
            purpose=body.purpose,
            api_key=body.api_key.strip(),
            label=body.label.strip(),
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {
        "id": new_key.id,
        "provider": new_key.provider,
        "purpose": new_key.purpose,
        "label": new_key.label,
        "key_hint": new_key.key_hint,
        "created_at": new_key.created_at,
    }


@router.delete("/{key_id}")
async def delete_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(UserApiKey).where(UserApiKey.id == key_id, UserApiKey.user_id == current_user.id)
    )).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Key 不存在")

    await db.delete(row)
    await sync_user_legacy_claude_from_pool(db, current_user.id)
    await db.commit()
    return {"message": "已删除"}
