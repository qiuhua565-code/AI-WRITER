import asyncio
import json
import logging
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete, update as sa_update, desc
from sqlalchemy.orm import selectinload
import redis.asyncio as aioredis

from app.celery_tasks.story import run_story
from app.database import get_db
from app.models.task import Task
from app.models.user import User
from app.models.message import Message
from app.models.article_version import ArticleVersion
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


def _resolved_emotion_target_words(cfg: dict) -> int:
    """与 EmotionStoryOrchestrator._resolve_target_words 一致，供审校对话等复用。"""
    raw = cfg.get("target_words")
    if raw is None:
        return 18_000
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 18_000
    return max(10_000, min(25_000, n))


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
        result = run_story.delay(tid, current_user.id)
        await db.execute(sa_update(Task).where(Task.id == tid).values(celery_task_id=result.id))
    await db.commit()

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


@router.delete("/{task_id}")
async def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此任务")
    if task.status in ("writing", "queued"):
        raise HTTPException(status_code=400, detail="生成中或排队中的任务不能删除，请先取消")
    await db.execute(sa_delete(Task).where(Task.id == task_id))
    await db.commit()
    return {"message": "已删除"}


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
        result = run_story.delay(task_id, task.user_id)
        await db.execute(sa_update(Task).where(Task.id == task_id).values(celery_task_id=result.id))
        await db.commit()
        return {"status": "queued"}

    elif action == "cancel":
        if task.status not in ("writing", "queued", "paused"):
            raise HTTPException(status_code=400, detail="只有 writing/queued/paused 状态的任务可以取消")
        await set_task_control(redis, task_id, "cancel")
        task.status = "cancelled"
        if task.celery_task_id:
            from app.celery_app import celery_app as _celery
            _celery.control.revoke(task.celery_task_id, terminate=True, signal="SIGTERM")

    elif action == "retry":
        if task.status not in ("failed", "cancelled"):
            raise HTTPException(status_code=400, detail="只有 failed/cancelled 状态的任务可以重试")
        if task.celery_task_id:
            from app.celery_app import celery_app as _celery
            _celery.control.revoke(task.celery_task_id, terminate=True, signal="SIGTERM")
        task.status = "queued"
        task.error_msg = None
        task.warning_msg = None
        await db.commit()
        result = run_story.delay(task_id, task.user_id)
        await db.execute(sa_update(Task).where(Task.id == task_id).values(celery_task_id=result.id))
        await db.commit()
        return {"status": "queued"}

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


# ── 保存文章内容 ──────────────────────────────────────────────────────────────

class SaveContentRequest(BaseModel):
    content: str


@router.patch("/{task_id}/content")
async def save_task_content(
    task_id: int,
    body: SaveContentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此任务")
    if task.status not in ("review", "approved"):
        raise HTTPException(status_code=400, detail="只有 review/approved 状态的任务可以编辑")

    import re
    wc = len(re.sub(r"\s", "", body.content))
    task.content = body.content
    task.word_count = wc
    await db.commit()
    return {"message": "已保存", "word_count": wc}


# ── 审核 AI 辅助 ─────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)


class ReviewChatRequest(BaseModel):
    message: str
    selected_text: str | None = None
    action: str | None = None  # polish | expand | rewrite | chat
    # 侧栏选中章节时传入，便于模型聚焦本章修改意图（对应 Segment.segment_type）
    segment_type: str | None = None


@router.post("/{task_id}/review-chat")
async def review_chat(
    task_id: int,
    body: ReviewChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Task).where(Task.id == task_id).options(selectinload(Task.segments))
    task = (await db.execute(q)).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")
    if task.status not in ("review", "approved"):
        raise HTTPException(status_code=400, detail="只有 review/approved 状态的任务支持 AI 辅助")

    # Get API key from system pool (round-robin, no exclusive lock needed for short chat requests)
    from app.services.key_pool import get_key_for_chat
    api_key = await get_key_for_chat(db, current_user.id)
    if not api_key:
        raise HTTPException(status_code=503, detail="未配置可用的 API Key：请在设置中绑定您自己的 Key，或由管理员配置系统 Key")
    from app.services.llm import llm_client
    from app.config import settings

    ACTION_PROMPTS = {
        "polish": "请对以下文字进行润色，保持原意，让语言更流畅自然：\n\n{text}",
        "expand": "请对以下文字进行扩写，丰富细节和描写，字数扩展到原来的1.5-2倍：\n\n{text}",
        "rewrite": "请对以下文字进行重写，在保持核心情节的基础上，换一种表达方式：\n\n{text}",
    }

    # Build system prompt with article context
    system = f"你是一个专业的情感故事写作助手。以下是当前文章的完整内容，请根据用户的要求进行辅助：\n\n---\n{task.content or '（文章内容暂未生成）'}\n---"

    cfg = task.config if isinstance(task.config, dict) else {}
    batch_prompt = (cfg.get("batch_prompt") or "").strip()
    instruction_doc = (cfg.get("instruction_doc_text") or "").strip()
    instruction_fn = (cfg.get("instruction_doc_filename") or "").strip()
    extra_ctx = []
    if instruction_doc:
        label = f"（文件：{instruction_fn}）" if instruction_fn else ""
        extra_ctx.append(f"【基础指令文档】{label}\n{instruction_doc}")
    if batch_prompt:
        extra_ctx.append(f"【用户补充提示】\n{batch_prompt}")
    if cfg.get("template") == "emotion_story":
        extra_ctx.append(f"【目标总字数】约 {_resolved_emotion_target_words(cfg)} 字。")
    if extra_ctx:
        system += (
            "\n\n【该文在自动生成时须遵守的创作配置】"
            "修改与润色应尽量与下列要求一致：\n"
            + "\n\n".join(extra_ctx)
        )

    if body.selected_text:
        system += f"\n\n用户当前选中的文字：\n{body.selected_text}"

    if body.segment_type:
        seg = next((s for s in task.segments if s.segment_type == body.segment_type), None)
        if seg and (seg.content or "").strip():
            label = seg.title or body.segment_type
            excerpt = (seg.content or "").strip()
            if len(excerpt) > 14000:
                excerpt = excerpt[:14000] + "\n…（本章较长，已截断后半部分；如需全文语境请切回「完整文章」提问）"
            system += (
                f"\n\n【用户当前聚焦的章节】{label}（{body.segment_type}）\n"
                "以下为该章正文；用户的修改说明如无特殊指向全文，请优先落在本章。\n"
                f"---\n{excerpt}\n---"
            )

    # Build user message
    if body.action and body.action in ACTION_PROMPTS and body.selected_text:
        user_content = ACTION_PROMPTS[body.action].format(text=body.selected_text)
    else:
        user_content = body.message

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]

    return StreamingResponse(
        _review_chat_generator(request, db, task_id, current_user.id, api_key, messages, settings.LLM_DEFAULT_MODEL),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _review_chat_generator(request: Request, db: AsyncSession, task_id: int, user_id: int, api_key: str, messages: list, model: str):
    from app.services.llm import llm_client
    from datetime import datetime, timezone

    full_response = []
    try:
        yield ": connected\n\n"
        async for chunk in llm_client.stream(api_key=api_key, messages=messages, model=model, max_tokens=2000, temperature=0.75):
            if await request.is_disconnected():
                break
            if chunk.content:
                full_response.append(chunk.content)
                payload = json.dumps({"type": "token", "content": chunk.content}, ensure_ascii=False)
                yield f"event: token\ndata: {payload}\n\n"
            if chunk.finish_reason:
                payload = json.dumps({"type": "done"}, ensure_ascii=False)
                yield f"event: done\ndata: {payload}\n\n"
    except Exception as exc:
        logger.exception("review-chat error task=%s", task_id)
        payload = json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)
        yield f"event: error\ndata: {payload}\n\n"
    finally:
        if full_response:
            msg = Message(
                task_id=task_id,
                role="assistant",
                content="".join(full_response),
                kind="review_chat",
                model=model,
                created_at=datetime.now(timezone.utc),
            )
            db.add(msg)
            await db.commit()


# ── 历史版本 ──────────────────────────────────────────────────────────────────


class CreateVersionRequest(BaseModel):
    label: str = "手动编辑"
    content: str | None = None  # if provided, use directly; else fall back to task.content


class VersionItem(BaseModel):
    id: int
    label: str
    word_count: int
    preview: str
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/{task_id}/versions")
async def list_versions(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")

    rows = (await db.execute(
        select(ArticleVersion)
        .where(ArticleVersion.task_id == task_id)
        .order_by(desc(ArticleVersion.created_at))
        .limit(50)
    )).scalars().all()

    return [
        {
            "id": v.id,
            "label": v.label,
            "word_count": v.word_count,
            "preview": (v.content or "")[:80].replace("\n", " "),
            "created_at": v.created_at.isoformat(),
        }
        for v in rows
    ]


@router.post("/{task_id}/versions")
async def create_version(
    task_id: int,
    body: CreateVersionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")
    if task.status not in ("review", "approved"):
        raise HTTPException(status_code=400, detail="只有 review/approved 状态可创建版本")

    from datetime import datetime, timezone
    import re
    snap_content = body.content if body.content is not None else (task.content or "")
    snap_wc = len(re.sub(r"\s", "", snap_content))
    ver = ArticleVersion(
        task_id=task_id,
        content=snap_content,
        word_count=snap_wc,
        label=body.label,
        created_at=datetime.now(timezone.utc),
    )
    db.add(ver)
    await db.commit()
    await db.refresh(ver)
    return {"id": ver.id, "label": ver.label, "created_at": ver.created_at.isoformat()}


@router.get("/{task_id}/versions/{version_id}")
async def get_version(
    task_id: int,
    version_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")

    ver = (await db.execute(
        select(ArticleVersion).where(ArticleVersion.id == version_id, ArticleVersion.task_id == task_id)
    )).scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    return {
        "id": ver.id,
        "label": ver.label,
        "content": ver.content,
        "word_count": ver.word_count,
        "created_at": ver.created_at.isoformat(),
    }


@router.delete("/{task_id}/versions/{version_id}", status_code=204)
async def delete_version(
    task_id: int,
    version_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")

    ver = (await db.execute(
        select(ArticleVersion).where(ArticleVersion.id == version_id, ArticleVersion.task_id == task_id)
    )).scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    await db.execute(sa_delete(ArticleVersion).where(ArticleVersion.id == version_id))
    await db.commit()


@router.post("/{task_id}/versions/{version_id}/restore")
async def restore_version(
    task_id: int,
    version_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")

    ver = (await db.execute(
        select(ArticleVersion).where(ArticleVersion.id == version_id, ArticleVersion.task_id == task_id)
    )).scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    from datetime import datetime, timezone
    # Auto-save current content as a snapshot before restoring
    if task.content:
        snapshot = ArticleVersion(
            task_id=task_id,
            content=task.content,
            word_count=task.word_count or 0,
            label="恢复前快照",
            created_at=datetime.now(timezone.utc),
        )
        db.add(snapshot)

    task.content = ver.content
    task.word_count = ver.word_count
    await db.commit()
    return {"content": ver.content, "word_count": ver.word_count}
