from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    UpdatePasswordRequest,
    UpdateLLMKeyRequest,
    UserMeResponse,
)
from app.utils.security import (
    verify_password_async,
    create_access_token,
    hash_password,
    encrypt_api_key,
    decrypt_api_key,
    make_key_hint,
)
from app.utils.deps import get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not await verify_password_async(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(
        access_token=token,
        user=UserMeResponse.model_validate(user),
    )


@router.get("/me", response_model=UserMeResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/password")
async def update_password(
    body: UpdatePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await verify_password_async(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码错误")
    current_user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"message": "密码修改成功"}


@router.put("/llm-key")
async def update_llm_key(
    body: UpdateLLMKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.llm_api_key_encrypted = encrypt_api_key(body.api_key)
    current_user.llm_api_key_hint = make_key_hint(body.api_key)
    current_user.llm_api_key_status = "unknown"
    await db.commit()
    return {"hint": current_user.llm_api_key_hint}


@router.delete("/llm-key")
async def delete_llm_key(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.llm_api_key_encrypted = None
    current_user.llm_api_key_hint = None
    current_user.llm_api_key_status = "unknown"
    await db.commit()
    return {"message": "已删除"}
