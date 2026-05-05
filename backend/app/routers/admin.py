from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.models.user import User
from app.models.task import Task
from app.models.api_key import UserApiKey
from app.utils.deps import get_current_user
from app.utils.security import hash_password
from app.services.user_api_key_ops import insert_user_api_key, sync_user_legacy_claude_from_pool

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user


# ── 仪表盘统计（全站任务，非当前用户过滤）──────────────────────────
class AdminRecentTask(BaseModel):
    id: int
    title: str
    user_id: int
    user_email: str
    status: str
    progress: int
    word_count: int | None
    updated_at: datetime


class AdminDashboardStats(BaseModel):
    users_total: int
    users_active: int
    tasks_total: int
    tasks_by_status: dict[str, int]
    tasks_running: int  # queued + writing
    recent_tasks: list[AdminRecentTask]


@router.get("/stats", response_model=AdminDashboardStats)
async def admin_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    users_total = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    users_active = (
        await db.execute(
            select(func.count()).select_from(User).where(User.status == "active")
        )
    ).scalar_one()

    tasks_total = (await db.execute(select(func.count()).select_from(Task))).scalar_one()

    status_rows = (
        await db.execute(select(Task.status, func.count()).group_by(Task.status))
    ).all()
    tasks_by_status = {row[0]: int(row[1]) for row in status_rows}

    q = int(tasks_by_status.get("queued", 0)) + int(tasks_by_status.get("writing", 0))

    recent_q = (
        await db.execute(
            select(Task, User.email)
            .join(User, Task.user_id == User.id)
            .order_by(Task.updated_at.desc())
            .limit(40)
        )
    ).all()

    recent_tasks = [
        AdminRecentTask(
            id=t.id,
            title=t.title[:200] + ("…" if len(t.title) > 200 else ""),
            user_id=t.user_id,
            user_email=email,
            status=t.status,
            progress=t.progress,
            word_count=t.word_count,
            updated_at=t.updated_at,
        )
        for t, email in recent_q
    ]

    return AdminDashboardStats(
        users_total=int(users_total),
        users_active=int(users_active),
        tasks_total=int(tasks_total),
        tasks_by_status=tasks_by_status,
        tasks_running=q,
        recent_tasks=recent_tasks,
    )


# ── 创建用户 ──────────────────────────────────────────────
class InitialApiKeyItem(BaseModel):
    provider: str
    purpose: str = "both"
    api_key: str
    label: str = ""


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "user"
    initial_api_keys: list[InitialApiKeyItem] | None = None


@router.post("/users")
async def create_user(
    body: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已被注册")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        role=body.role,
        status="active",
    )
    db.add(user)
    await db.flush()

    if body.initial_api_keys:
        for item in body.initial_api_keys:
            raw = item.api_key.strip()
            if len(raw) < 10:
                raise HTTPException(status_code=400, detail="预置 API Key 长度不足")
            try:
                await insert_user_api_key(
                    db,
                    user.id,
                    provider=item.provider,
                    purpose=item.purpose,
                    api_key=raw,
                    label=item.label.strip(),
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


# ── 用户列表 ──────────────────────────────────────────────
@router.get("/users")
async def list_users(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    total = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    users = (await db.execute(
        select(User).order_by(User.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    counts_rows = (
        await db.execute(
            select(UserApiKey.user_id, func.count(UserApiKey.id)).group_by(UserApiKey.user_id)
        )
    ).all()
    key_counts = {int(uid): int(c) for uid, c in counts_rows}

    return {
        "total": total,
        "items": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "role": u.role,
                "status": u.status,
                "llm_api_key_hint": u.llm_api_key_hint,
                "api_keys_count": key_counts.get(u.id, 0),
                "daily_task_limit": u.daily_task_limit,
                "created_at": u.created_at,
            }
            for u in users
        ],
    }


# ── 修改用户状态/重置密码 ─────────────────────────────────
class UpdateUserRequest(BaseModel):
    status: str | None = None      # active | disabled
    password: str | None = None
    daily_task_limit: int | None = None
    role: str | None = None


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UpdateUserRequest,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if body.status is not None:
        user.status = body.status
    if body.password is not None:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="密码至少6位")
        user.password_hash = hash_password(body.password)
    if body.daily_task_limit is not None:
        user.daily_task_limit = body.daily_task_limit
    if body.role is not None:
        user.role = body.role

    await db.commit()
    return {"id": user.id, "email": user.email, "status": user.status, "role": user.role}


# ── 删除用户 ──────────────────────────────────────────────
@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    if user_id == current_admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    await db.delete(user)
    await db.commit()
    return {"message": "已删除"}


# ── 指定用户的个人 Key 池（管理员代管）──────────────────────────────


@router.get("/users/{user_id}/api-keys")
async def admin_list_user_api_keys(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    rows = (
        await db.execute(
            select(UserApiKey)
            .where(UserApiKey.user_id == user_id)
            .order_by(UserApiKey.created_at.desc())
        )
    ).scalars().all()
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


@router.post("/users/{user_id}/api-keys")
async def admin_add_user_api_key(
    user_id: int,
    body: InitialApiKeyItem,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    try:
        row = await insert_user_api_key(
            db,
            user_id,
            provider=body.provider,
            purpose=body.purpose,
            api_key=body.api_key.strip(),
            label=body.label.strip(),
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "id": row.id,
        "provider": row.provider,
        "purpose": row.purpose,
        "label": row.label,
        "key_hint": row.key_hint,
        "created_at": row.created_at,
    }


@router.delete("/users/{user_id}/api-keys/{key_id}")
async def admin_delete_user_api_key(
    user_id: int,
    key_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = (
        await db.execute(
            select(UserApiKey).where(UserApiKey.id == key_id, UserApiKey.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Key 不存在")
    await db.delete(row)
    await sync_user_legacy_claude_from_pool(db, user_id)
    await db.commit()
    return {"message": "已删除"}
