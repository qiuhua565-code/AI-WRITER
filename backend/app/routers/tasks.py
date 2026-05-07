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
    ExtractEditPatchRequest,
    ExtractEditPatchResponse,
)
from app.utils.deps import get_current_user
from app.utils.task_control import set_task_control, clear_task_control
from app.utils.async_persist import spawn_persist_task, best_effort_wait
from app.database import AsyncSessionLocal

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

    system += (
        "\n\n【修改落稿】若用户希望把修改应用到正文："
        "给出替换稿时尽量附带「被替换的原文连续片段」以便核对；"
        "用户也可在助手回复后点击「智能应用到正文」，由系统根据对话在全文中匹配替换。"
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
        _review_chat_generator(request, task_id, current_user.id, api_key, messages, settings.LLM_DEFAULT_MODEL),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _persist_review_chat(task_id: int, content: str, model: str) -> None:
    """Persist a review-chat assistant message in its own DB session.

    Must use AsyncSessionLocal (not the request-scoped session) because this is
    typically run as a fire-and-forget task after the request handler has returned.
    """
    from datetime import datetime, timezone

    async with AsyncSessionLocal() as db:
        msg = Message(
            task_id=task_id,
            role="assistant",
            content=content,
            kind="review_chat",
            model=model,
            created_at=datetime.now(timezone.utc),
        )
        db.add(msg)
        await db.commit()
        logger.info(
            "review-chat persist ok task=%s content_len=%s model=%s",
            task_id,
            len(content),
            model,
        )


async def _review_chat_generator(request: Request, task_id: int, user_id: int, api_key: str, messages: list, model: str):
    from app.services.llm import llm_client

    full_response: list[str] = []
    stream_error_msg: str | None = None
    client_disconnected = False
    try:
        yield ": connected\n\n"
        async for chunk in llm_client.stream(api_key=api_key, messages=messages, model=model, max_tokens=2000, temperature=0.75):
            if await request.is_disconnected():
                client_disconnected = True
                break
            if chunk.content:
                full_response.append(chunk.content)
                payload = json.dumps({"type": "token", "content": chunk.content}, ensure_ascii=False)
                yield f"event: token\ndata: {payload}\n\n"
            if chunk.finish_reason:
                payload = json.dumps({"type": "done"}, ensure_ascii=False)
                yield f"event: done\ndata: {payload}\n\n"
    except asyncio.CancelledError:
        # Client disconnect: starlette cancelled this generator. Mark and re-raise
        # so the cleanup in `finally` still runs (Python guarantees finally on
        # CancelledError) and we can safely persist the partial content.
        client_disconnected = True
        raise
    except Exception as exc:
        logger.exception("review-chat error task=%s", task_id)
        stream_error_msg = str(exc) or exc.__class__.__name__
        payload = json.dumps({"type": "error", "error": stream_error_msg}, ensure_ascii=False)
        yield f"event: error\ndata: {payload}\n\n"
    finally:
        content = "".join(full_response)
        # Append a discreet error tail only when the failure was real and the
        # client is still here to read it; on user-initiated abort we keep the
        # partial as-is so the next reload shows clean text.
        if stream_error_msg and not client_disconnected and content.strip():
            content = content.rstrip() + f"\n\n—\n（未能完整保存：{stream_error_msg}）"
        if content:
            persist_task = spawn_persist_task(_persist_review_chat(task_id, content, model))
            await best_effort_wait(persist_task, timeout=5.0, label=f"review-chat-persist task={task_id}")


_ARTICLE_CHECK_BRIEF = """你是资深网文与新媒体故事审校。请通读用户给出的【整篇文章】（虚构创作），按下列维度逐项检查，输出 Markdown 报告（## 小节 + 要点列表）。某项若无问题可写「未见明显问题」。

1. 称谓、人称是否前后一致、有无明显错误
2. 情节逻辑是否自洽，有无明显不合理之处
3. 故事内时间安排是否合理，有无不可能发生的时间线
4. 「免费部分」与「付费卡点/悬念」衔接是否自然；免费段是否过早泄露悬疑答案
5. 是否有强烈暗示导致付费前剧透感
6. 字数与节奏（是否明显偏短或拖沓；若配置有目标字数可对比）
7. 重复句、反复表达、相似段落、无效描写、暗示性剧透情节
8. 真实地名、精确日期（如「2025年x月x日」）、真实人名；国内过于具体的小地名（如北京某具体路名/小区名等）——列出建议删除或虚化的原文短语引用
9. 分段是否合理；大段未分段处请指出位置并给出拆段建议（不要在此全文改写，仅审阅与建议）

保持客观可执行；不对用户做道德说教；本文为用户商业创作审阅场景。"""


@router.post("/{task_id}/article-check")
async def article_full_check(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    model: str | None = Query(default=None, description="覆盖默认审校模型"),
):
    """对整篇成稿做结构化审阅。使用 SSE + 心跳，避免网关长时间无字节返回 502。"""
    task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")
    if task.status not in ("review", "approved"):
        raise HTTPException(status_code=400, detail="只有 review/approved 状态的任务支持全文检查")

    body = (task.content or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="文章内容为空")

    max_chars = 120_000
    if len(body) > max_chars:
        body = body[:max_chars] + f"\n\n[…正文已截断至前 {max_chars} 字供审阅；全文过长时可分章检查]"

    from app.services.key_pool import get_key_for_chat
    from app.services.llm import llm_client
    from app.config import settings

    api_key = await get_key_for_chat(db, current_user.id)
    if not api_key:
        raise HTTPException(status_code=503, detail="未配置可用的 API Key")

    use_model = (model or "").strip() or settings.LLM_DEFAULT_MODEL
    messages = [
        {"role": "system", "content": _ARTICLE_CHECK_BRIEF},
        {"role": "user", "content": f"【整篇文章如下】\n---\n{body}\n---\n请开始审阅。"},
    ]

    async def event_gen():
        yield ": connected\n\n"
        pending = asyncio.create_task(
            llm_client.complete(
                api_key=api_key,
                messages=messages,
                model=use_model,
                max_tokens=16_000,
                temperature=0.25,
                read_timeout=900.0,
            )
        )
        try:
            while True:
                done, _ = await asyncio.wait({pending}, timeout=12.0)
                if pending in done:
                    break
                yield ": keepalive\n\n"
            result = await pending
            payload = json.dumps(
                {
                    "type": "done",
                    "report": (result.content or "").strip(),
                    "model_used": result.model,
                },
                ensure_ascii=False,
            )
            yield f"event: done\ndata: {payload}\n\n"
        except Exception as exc:
            logger.exception("article-check failed task=%s", task_id)
            err = json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)
            yield f"event: error\ndata: {err}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{task_id}/extract-edit-patch", response_model=ExtractEditPatchResponse)
async def extract_edit_patch(
    task_id: int,
    body: ExtractEditPatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """根据用户与助手对话，从正文中抠出可唯一替换的 old_text / new_text，供前端「智能应用」。"""
    from app.utils.intent_detection import _extract_first_json_object, _normalize_intent_raw_response

    q = select(Task).where(Task.id == task_id).options(selectinload(Task.segments))
    task = (await db.execute(q)).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")
    if task.status not in ("review", "approved"):
        raise HTTPException(status_code=400, detail="只有 review/approved 状态支持此功能")

    article = (task.content or "").strip()
    if not article:
        raise HTTPException(status_code=400, detail="文章内容为空")

    seg_hint = ""
    if body.segment_type:
        seg = next((s for s in task.segments if s.segment_type == body.segment_type), None)
        if seg and (seg.content or "").strip():
            seg_hint = f"\n用户侧栏聚焦章节：{seg.title or body.segment_type}\n该章正文节选（供对齐）：\n---\n{(seg.content or '')[:12000]}\n---\n"

    from app.services.key_pool import get_key_for_chat
    from app.services.llm import llm_client
    from app.config import settings

    api_key = await get_key_for_chat(db, current_user.id)
    if not api_key:
        raise HTTPException(status_code=503, detail="未配置可用的 API Key")

    sys = (
        "你是精确文本编辑助手。下面是一篇完整正文，以及用户与助手的对话。"
        "请判断助手是否给出了对正文的「具体替换」意图。"
        "只输出一个 JSON 对象（不要 markdown 围栏），字段："
        '`"old_text"`（必须从【完整正文】中逐字复制的连续子串，若无法唯一确定则置空字符串）、'
        '`"new_text"`（替换后的完整连续文本；若 old_text 为空则置空）、'
        '`"notes"`（简短中文说明）、`"confidence"`（"high"|"medium"|"low"）。'
        "若助手仅泛泛而谈、未给出可落地替换，则 old_text 与 new_text 都为空，confidence 为 low。"
        "\n\n【完整正文】\n---\n"
        f"{article[:180000]}"
        "\n---"
        f"{seg_hint}"
    )
    user_blob = (
        "【用户说明】\n"
        + (body.user_message or "").strip()
        + "\n\n【助手回复】\n"
        + (body.assistant_reply or "").strip()
    )
    messages = [
        {"role": "system", "content": sys},
        {"role": "user", "content": user_blob},
    ]
    try:
        result = await llm_client.complete(
            api_key=api_key,
            messages=messages,
            model=settings.LLM_DEFAULT_MODEL,
            max_tokens=8000,
            temperature=0.1,
        )
    except Exception as exc:
        logger.exception("extract-edit-patch failed task=%s", task_id)
        raise HTTPException(status_code=502, detail=f"分析失败：{exc}") from exc

    raw = _normalize_intent_raw_response(result.content)
    blob = _extract_first_json_object(raw) or raw
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        return ExtractEditPatchResponse(
            old_text="",
            new_text="",
            notes="模型未返回合法 JSON，请手动复制修改或缩小修改范围后重试。",
            confidence="low",
        )

    old_t = str(data.get("old_text") or "").strip()
    new_t = str(data.get("new_text") or "").strip()
    notes = str(data.get("notes") or "").strip()
    conf = str(data.get("confidence") or "low").strip().lower()
    if conf not in ("high", "medium", "low"):
        conf = "low"

    if old_t and old_t not in article:
        return ExtractEditPatchResponse(
            old_text="",
            new_text="",
            notes="模型给出的 old_text 在正文中未逐字匹配，已拒绝自动替换。" + (notes and f" {notes}" or ""),
            confidence="low",
        )

    return ExtractEditPatchResponse(old_text=old_t, new_text=new_t, notes=notes, confidence=conf)


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
