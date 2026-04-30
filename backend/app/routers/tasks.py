import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
import redis.asyncio as aioredis

from app.celery_tasks.story import run_story
from app.database import get_db
from app.models.task import Task
from app.models.user import User
from app.redis_client import get_redis
from app.schemas.task import (
    BatchCreateRequest,
    BatchCreateResponse,
    TaskControlRequest,
    TaskListItem,
    TaskListResponse,
    TaskDetailResponse,
)
from app.utils.deps import get_current_user
from app.utils.task_control import set_task_control, clear_task_control

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.post("/batch", response_model=BatchCreateResponse)
async def batch_create_tasks(
    body: BatchCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task_ids = []
    config_dict = body.config.model_dump()

    for title in body.titles:
        task = Task(
            user_id=current_user.id,
            title=title,
            status="queued",
            config=config_dict,
        )
        db.add(task)
        await db.flush()  # 获取自增 id
        task_ids.append(task.id)

    await db.commit()

    # Dispatch Celery tasks after DB commit (so workers can load the rows)
    for tid in task_ids:
        run_story.delay(tid)

    return BatchCreateResponse(queued_count=len(task_ids), task_ids=task_ids)


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_q = select(func.count()).select_from(Task).where(Task.user_id == current_user.id)
    data_q = select(Task).where(Task.user_id == current_user.id)

    if status:
        count_q = count_q.where(Task.status == status)
        data_q = data_q.where(Task.status == status)

    total = (await db.execute(count_q)).scalar_one()

    data_q = (
        data_q
        .order_by(Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    tasks = (await db.execute(data_q)).scalars().all()

    return TaskListResponse(
        items=[TaskListItem.model_validate(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Task)
        .where(Task.id == task_id)
        .options(selectinload(Task.segments))
    )
    task = (await db.execute(q)).scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")

    return TaskDetailResponse.model_validate(task)


@router.patch("/{task_id}/control")
async def control_task(
    task_id: int,
    body: TaskControlRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此任务")

    action = body.action

    if action == "pause":
        if task.status != "writing":
            raise HTTPException(status_code=400, detail="只有 writing 状态的任务可以暂停")
        await set_task_control(redis, task_id, "pause")
        task.status = "paused"

    elif action == "resume":
        if task.status not in ("paused", "plan_review"):
            raise HTTPException(status_code=400, detail="只有 paused/plan_review 状态的任务可以继续")
        await clear_task_control(redis, task_id)
        task.status = "queued"
        await db.commit()
        # Re-dispatch to Celery so the orchestrator picks up from where it left off
        run_story.delay(task_id)

    elif action == "cancel":
        if task.status not in ("writing", "queued", "paused"):
            raise HTTPException(status_code=400, detail="只有 writing/queued/paused 状态的任务可以取消")
        await set_task_control(redis, task_id, "cancel")
        task.status = "cancelled"

    elif action == "approve":
        if task.status != "review":
            raise HTTPException(status_code=400, detail="只有 review 状态的任务可以通过")
        task.status = "approved"

    else:
        raise HTTPException(status_code=400, detail=f"不支持的操作: {action}")

    await db.commit()
    return {"status": task.status}


@router.get("/{task_id}/export")
async def export_task_docx(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export task content as a .docx file."""
    q = (
        select(Task)
        .where(Task.id == task_id)
        .options(selectinload(Task.segments))
    )
    task = (await db.execute(q)).scalar_one_or_none()

    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")
    if task.status not in ("review", "approved"):
        raise HTTPException(status_code=400, detail="只有 review/approved 状态的任务可以导出")

    from app.services.export import build_docx
    docx_bytes = build_docx(task, task.segments)

    # Encode filename for Content-Disposition (RFC 5987)
    safe_title = urllib.parse.quote(task.title, safe="")
    filename = f"{safe_title}.docx"

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
