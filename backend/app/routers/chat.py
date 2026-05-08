import asyncio
import base64
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete as sa_delete
from pydantic import BaseModel, ConfigDict

from app.database import AsyncSessionLocal, get_db
from app.models.chat import ChatSession, ChatMessage
from app.models.user import User
from app.utils.deps import get_current_user
from app.services.llm import llm_client
from app.config import settings
from app.utils.intent_detection import (
    detect_user_intent_with_llm,
    detect_intent_by_keywords,
    UserIntent,
    generate_continue_prompt,
    should_continue_for_word_count,
    count_words,
)
from app.utils.word_count import (
    detect_lazy_response,
)

from app.utils.async_persist import spawn_persist_task, best_effort_wait

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

# 对话默认 system：减少「模拟界面 / 断网 Banner」类问题被模型习惯性打成整页 HTML/CSS 代码块。
AI_STORYFLOW_CHAT_SYSTEM = (
    "你是 AI-StoryFlow 的写作与产品助手。\n\n"
    "当用户问的是**本产品界面会怎样表现**（断网、停止生成、保存失败、Banner 颜色与文案、"
    "点击图片全屏等），或让你「模拟」某种交互时：请用简洁中文分条说明**用户会看到什么、"
    "提示条的大致样式与原文案**即可；像说明产品行为一样回答，不要默认给出整页 HTML/CSS/"
    "独立网页 Demo，除非对方明确写「给代码」「写 HTML」「要可运行示例」等。\n\n"
    "**普通问答**（常识、解释概念、写作技巧、资料整理等）按用户问题正常作答即可。\n\n"
    "**续写、润色、审稿、大纲、标题等创作类任务**须按用户要求完整输出正文或 Markdown（标题、列表、"
    "引用等）；仅避免与写作无关的冗长代码块；用户若明确要代码或小段示例仍可给出。"
)


_MAX_LINKED_ARTICLE_CHARS = 120_000


def _messages_for_chat_llm(msgs: list[dict], editor_content: str = "") -> list[dict]:
    """为流式对话注入 system；可选带上「关联文章」全文供模型改稿/摘要/引用。"""
    body: list[dict] = []
    for m in msgs:
        if m.get("role") == "system":
            continue
        body.append(m)
    sys_text = AI_STORYFLOW_CHAT_SYSTEM
    ec = (editor_content or "").strip()
    if ec:
        if len(ec) > _MAX_LINKED_ARTICLE_CHARS:
            ec = ec[:_MAX_LINKED_ARTICLE_CHARS] + (
                f"\n\n[…关联正文已截断至前 {_MAX_LINKED_ARTICLE_CHARS} 字]"
            )
        sys_text = (
            f"{sys_text}\n\n---\n【用户当前关联的成稿全文】\n"
            "以下为写作任务生成的正文（用户在「AI 对话」里通过「关联文章」挂载）。"
            "用户可能要求摘要、查找情节、引用段落、局部改写、输出全文等，请严格基于下文作答。"
            "若用户未要求修改正文，不要随意改写或覆盖全文。\n\n"
            f"{ec}"
        )
    return [{"role": "system", "content": sys_text}, *body]


MAX_CHAT_ATTACHMENTS = 8
MAX_SINGLE_ATTACHMENT_BYTES = 6 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_EXTRACTED_TEXT_CHARS = 200_000

MULTIMEDIA_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"}
)
DOCX_MT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TEXT_MEDIA_TYPES = frozenset(
    {
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
        "text/html",
        "text/xml",
        "application/xml",
    }
)
_TEXT_EXT_SUFFIX = (
    ".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".xml", ".log",
    ".yaml", ".yml", ".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".sh",
    ".bat", ".ps1", ".env", ".ini", ".cfg", ".toml", ".go", ".rs", ".java", ".c", ".h",
    ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".kt", ".sql", ".vue", ".svelte",
)
_EXT_TO_MM = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}

_DISPLAY_SPLIT_MARKER = "\n\n--- 《"


class AttachmentPart(BaseModel):
    """Base64 正文，不含 data: 前缀。filename 用于识别 .docx / 文本类型。"""

    model_config = ConfigDict(extra="ignore")

    media_type: str
    data: str
    filename: str | None = None


class ChatStreamRequest(BaseModel):
    content: str = ""
    model: str | None = None
    attachments: list[AttachmentPart] | None = None
    context: dict | None = None  # 新增：上下文信息（如编辑器内容）


@dataclass
class MaterializedUserMessage:
    """用户可见正文与发给模型的全文拆分（文档正文仅存在于 llm_text_suffix）。"""

    display_text: str
    llm_text_suffix: str
    mm_attachments: list[AttachmentPart] | None
    docs: list[dict] = field(default_factory=list)


def _normalize_part(p: AttachmentPart) -> AttachmentPart:
    mt = (p.media_type or "").split(";")[0].strip().lower()
    if mt in MULTIMEDIA_TYPES:
        return p
    fn = (p.filename or "").lower()
    for ext, mmt in _EXT_TO_MM.items():
        if fn.endswith(ext):
            return AttachmentPart(media_type=mmt, data=p.data, filename=p.filename)
    return p


def _attachment_kind(p: AttachmentPart) -> str:
    pn = _normalize_part(p)
    mt = (pn.media_type or "").split(";")[0].strip().lower()
    fn = (pn.filename or "").lower()
    if mt in MULTIMEDIA_TYPES:
        return "mm"
    if mt == DOCX_MT or fn.endswith(".docx"):
        return "docx"
    if mt in TEXT_MEDIA_TYPES:
        return "text"
    if any(fn.endswith(sfx) for sfx in _TEXT_EXT_SUFFIX):
        return "text"
    return "unsupported"


def _truncate_extract(s: str) -> str:
    if len(s) <= MAX_EXTRACTED_TEXT_CHARS:
        return s
    return s[: MAX_EXTRACTED_TEXT_CHARS - 80] + "\n\n…（文本过长，已截断）"


def _extract_docx_with_meta(raw: bytes) -> tuple[str, int]:
    import io

    from docx import Document

    doc = Document(io.BytesIO(raw))
    paras = [p.text for p in doc.paragraphs]
    text = "\n".join(paras).strip()
    if not text:
        return "（Word 中未检测到段落文本）", 1
    n_lines = sum(1 for t in paras if t.strip())
    if n_lines == 0:
        n_lines = max(1, len(text.splitlines()))
    return text, n_lines


def _extract_plain_bytes(raw: bytes) -> str:
    try:
        t = raw.decode("utf-8")
    except UnicodeDecodeError:
        t = raw.decode("utf-8", errors="replace")
    return _truncate_extract(t)


def _materialize_user_message(body: ChatStreamRequest) -> MaterializedUserMessage:
    """解析附件：气泡仅展示用户输入 + 文档卡片；拼接全文仅在 llm_text_suffix（发给模型）。"""
    display_text = (body.content or "").strip()
    if not body.attachments:
        return MaterializedUserMessage(
            display_text=display_text,
            llm_text_suffix="",
            mm_attachments=None,
            docs=[],
        )
    chunks: list[str] = []
    mm_parts: list[AttachmentPart] = []
    docs_meta: list[dict] = []
    for raw_p in body.attachments:
        p = _normalize_part(raw_p)
        kind = _attachment_kind(p)
        try:
            decoded = base64.b64decode(p.data, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="附件编码无效") from None
        label = p.filename or "附件"
        if kind == "mm":
            mm_parts.append(p)
        elif kind == "docx":
            try:
                raw_text, line_count = _extract_docx_with_meta(decoded)
                extracted = _truncate_extract(raw_text)
            except Exception as exc:
                logger.exception("DOCX extract failed: %s", label)
                raise HTTPException(status_code=400, detail=f"无法解析 Word 文档：{label}") from exc
            chunks.append(f"\n\n--- 《{label}》（Word 正文提取）---\n\n{extracted}")
            docs_meta.append({"filename": label, "kind": "docx", "lines": line_count})
        elif kind == "text":
            extracted = _extract_plain_bytes(decoded)
            line_count = max(1, len(extracted.splitlines()))
            chunks.append(f"\n\n--- 《{label}》（文本文件）---\n\n{extracted}")
            docs_meta.append({"filename": label, "kind": "text", "lines": line_count})
        else:
            raise HTTPException(
                status_code=400,
                detail=f"暂不支持的文件：{label}。支持图片、PDF、Word（.docx）、常见源码与文本；其它格式请转为 PDF 或纯文本。",
            )
    suffix = "".join(chunks)
    mm = mm_parts if mm_parts else None
    return MaterializedUserMessage(
        display_text=display_text,
        llm_text_suffix=suffix,
        mm_attachments=mm,
        docs=docs_meta,
    )


def _validate_attachment_parts(parts: list[AttachmentPart] | None) -> None:
    if not parts:
        return
    if len(parts) > MAX_CHAT_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"最多上传 {MAX_CHAT_ATTACHMENTS} 个文件")
    total = 0
    for raw in parts:
        p = _normalize_part(raw)
        if _attachment_kind(p) == "unsupported":
            raise HTTPException(
                status_code=400,
                detail=f"不支持的类型：{p.filename or p.media_type}",
            )
        try:
            raw_bytes = base64.b64decode(p.data, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="附件编码无效，请重新选择文件")
        if len(raw_bytes) > MAX_SINGLE_ATTACHMENT_BYTES:
            raise HTTPException(status_code=400, detail="单个文件不超过 6MB")
        total += len(raw_bytes)
    if total > MAX_TOTAL_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="附件总大小超出限制")


def _serialize_user_message_materialized(mat: MaterializedUserMessage) -> str:
    has_mm = bool(mat.mm_attachments)
    has_docs = bool(mat.docs)
    has_suffix = bool(mat.llm_text_suffix.strip())
    if has_mm or has_docs or has_suffix:
        images: list[dict] = []
        if mat.mm_attachments:
            images = [
                {
                    "media_type": (a.media_type or "").split(";")[0].strip().lower(),
                    "data": a.data,
                }
                for a in mat.mm_attachments
            ]
        payload = {
            "_mm": True,
            "text": mat.display_text,
            "llm_text_suffix": mat.llm_text_suffix,
            "images": images,
            "docs": mat.docs,
        }
        return json.dumps(payload, ensure_ascii=False)
    return mat.display_text


def _user_stored_to_anthropic_content(stored: str):
    """数据库中的用户消息 -> Anthropic API content（str 或 block 列表）。"""
    s = stored.strip()
    if not s.startswith("{"):
        return stored
    try:
        obj = json.loads(stored)
    except json.JSONDecodeError:
        return stored
    if not isinstance(obj, dict) or not obj.get("_mm"):
        return stored
    images = obj.get("images") or []
    parts: list = []
    for im in images:
        mt = (im.get("media_type") or "image/jpeg").split(";")[0].strip().lower()
        data = im.get("data") or ""
        if mt == "application/pdf":
            parts.append(
                {
                    "type": "document",
                    "source": {"type": "base64", "media_type": mt, "data": data},
                }
            )
        else:
            parts.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": mt, "data": data},
                }
            )
    if "llm_text_suffix" in obj:
        txt = ((obj.get("text") or "") + (obj.get("llm_text_suffix") or "")).strip()
    else:
        txt = (obj.get("text") or "").strip()
    if txt:
        parts.append({"type": "text", "text": txt})
    if not parts:
        return txt or ""
    if len(parts) == 1 and parts[0].get("type") == "text":
        return parts[0].get("text") or ""
    return parts


def _message_row_to_llm_dict(m: ChatMessage) -> dict:
    if m.role == "assistant":
        return {"role": "assistant", "content": m.content}
    return {"role": "user", "content": _user_stored_to_anthropic_content(m.content)}


def _history_to_llm_messages(rows: list[ChatMessage]) -> list[dict]:
    return [_message_row_to_llm_dict(m) for m in rows]


def _api_user_display_from_mm_obj(obj: dict) -> str:
    """GET 消息列表时用户气泡正文：不含文档内联展开段。"""
    if "llm_text_suffix" in obj:
        return (obj.get("text") or "").strip()
    t = (obj.get("text") or "").strip()
    if _DISPLAY_SPLIT_MARKER in t:
        return t.split(_DISPLAY_SPLIT_MARKER)[0].strip()
    return t


def _api_plain_display(raw: str) -> str:
    """旧数据整条字符串含提取段时，接口展示裁掉展开部分。"""
    if _DISPLAY_SPLIT_MARKER in raw:
        return raw.split(_DISPLAY_SPLIT_MARKER)[0].strip()
    return raw


def _serialize_message_api(m: ChatMessage) -> dict:
    row = {
        "id": m.id,
        "role": m.role,
        "model": m.model,
        "created_at": m.created_at,
    }
    if m.role != "user":
        return {**row, "content": m.content, "attachments": None}

    s = m.content.strip()
    if not s.startswith("{"):
        return {**row, "content": _api_plain_display(m.content), "attachments": None}

    try:
        obj = json.loads(m.content)
    except json.JSONDecodeError:
        return {**row, "content": m.content, "attachments": None}

    if not isinstance(obj, dict) or not obj.get("_mm"):
        return {**row, "content": m.content, "attachments": None}

    display = _api_user_display_from_mm_obj(obj)
    imgs = obj.get("images") or []
    docs = obj.get("docs") or []
    attachments: list[dict] = []
    for d in docs:
        attachments.append(
            {
                "kind": d.get("kind"),
                "filename": d.get("filename"),
                "lines": d.get("lines"),
            }
        )
    for im in imgs:
        attachments.append({"media_type": im.get("media_type"), "data": im.get("data")})
    return {
        **row,
        "content": display,
        "attachments": attachments if attachments else None,
    }


async def _get_user_api_key(user_id: int, db: AsyncSession) -> str:
    from app.services.key_pool import get_key_for_chat
    logger.warning("🔍 Fetching API key for chat | user_id=%d", user_id)
    key = await get_key_for_chat(db, user_id)
    if not key:
        logger.error("❌ No API key available | user_id=%d", user_id)
        raise HTTPException(status_code=503, detail="未配置可用的 API Key：请在设置中绑定您自己的 Key，或由管理员配置系统 Key")
    logger.warning("✅ API key retrieved | user_id=%d | key=%s...%s", user_id, key[:12], key[-6:])
    return key


# ── 会话 CRUD ──────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    title: str = "新对话"


@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
        .limit(100)
    )).scalars().all()
    return [{"id": r.id, "title": r.title, "created_at": r.created_at, "updated_at": r.updated_at} for r in rows]


@router.post("/sessions")
async def create_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = ChatSession(user_id=current_user.id, title=body.title, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
    db.add(session)
    await db.commit()
    return {"id": session.id, "title": session.title, "created_at": session.created_at, "updated_at": session.updated_at}


class UpdateSessionRequest(BaseModel):
    title: str


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: int,
    body: UpdateSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    session.title = body.title
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": session.id, "title": session.title}


@router.delete("/sessions/empty")
async def cleanup_empty_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批量删除当前用户名下所有空会话（没有任何消息的会话）。"""
    msg_count_subq = (
        select(func.count(ChatMessage.id))
        .where(ChatMessage.session_id == ChatSession.id)
        .correlate(ChatSession)
        .scalar_subquery()
    )
    target_ids = (
        await db.execute(
            select(ChatSession.id)
            .where(ChatSession.user_id == current_user.id)
            .where(msg_count_subq == 0)
        )
    ).scalars().all()
    if not target_ids:
        return {"deleted_count": 0, "deleted_ids": []}
    await db.execute(sa_delete(ChatSession).where(ChatSession.id.in_(target_ids)))
    await db.commit()
    return {"deleted_count": len(target_ids), "deleted_ids": list(target_ids)}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    await db.delete(session)
    await db.commit()
    return {"message": "已删除"}


@router.get("/sessions/{session_id}/messages")
async def get_messages(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    msgs = (await db.execute(
        select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc())
    )).scalars().all()

    return [_serialize_message_api(m) for m in msgs]

@router.delete("/sessions/{session_id}/messages/{message_id}")
async def delete_message(
    session_id: int,
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    msg = (await db.execute(
        select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.session_id == session_id)
    )).scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")

    # If deleting a user message, also delete the immediately following assistant reply
    if msg.role == "user":
        next_msg = (await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id, ChatMessage.created_at > msg.created_at)
            .order_by(ChatMessage.created_at.asc())
            .limit(1)
        )).scalar_one_or_none()
        if next_msg and next_msg.role == "assistant":
            await db.delete(next_msg)

    await db.delete(msg)
    await db.commit()
    return {"message": "已删除"}


class UpdateMessageRequest(BaseModel):
    content: str


@router.patch("/sessions/{session_id}/messages/{message_id}")
async def update_message(
    session_id: int,
    message_id: int,
    body: UpdateMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    msg = (await db.execute(
        select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.session_id == session_id)
    )).scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")

    text = (body.content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="内容不能为空")

    msg.content = text
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": msg.id, "role": msg.role, "content": msg.content, "model": msg.model, "created_at": msg.created_at}


class RegenerateRequest(BaseModel):
    assistant_message_id: int
    model: str | None = None


@router.post("/sessions/{session_id}/regenerate")
async def regenerate_assistant(
    session_id: int,
    body: RegenerateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        session = (await db.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        )).scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")

        assistant = (await db.execute(
            select(ChatMessage).where(
                ChatMessage.id == body.assistant_message_id,
                ChatMessage.session_id == session_id,
                ChatMessage.role == "assistant",
            )
        )).scalar_one_or_none()
        if not assistant:
            raise HTTPException(status_code=404, detail="回复不存在")

        prev_user = (await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id, ChatMessage.created_at < assistant.created_at)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        if not prev_user or prev_user.role != "user":
            raise HTTPException(status_code=400, detail="无法重新生成：缺少对应的用户消息")

        await db.delete(assistant)
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()

        api_key = await _get_user_api_key(current_user.id, db)

        history = (await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(20)
        )).scalars().all()
        history.reverse()
        messages = _history_to_llm_messages(list(history))

        model = body.model or settings.LLM_DEFAULT_MODEL

    return StreamingResponse(
        _chat_generator(request, session_id, api_key, messages, model, editor_content=""),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/sessions/{session_id}/stream")
async def stream_chat(
    session_id: int,
    body: ChatStreamRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        session = (await db.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        )).scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")

        _validate_attachment_parts(body.attachments)
        mat = await asyncio.to_thread(_materialize_user_message, body)
        if (
            not mat.display_text.strip()
            and not mat.mm_attachments
            and not mat.llm_text_suffix.strip()
        ):
            raise HTTPException(status_code=400, detail="请输入文字或上传附件（图片 / PDF / Word / 文本等）")

        api_key = await _get_user_api_key(current_user.id, db)

        # Save user message
        user_msg = ChatMessage(
            session_id=session_id,
            role="user",
            content=_serialize_user_message_materialized(mat),
            created_at=datetime.now(timezone.utc),
        )
        db.add(user_msg)
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()

        # Build context from last 20 messages
        history = (await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(20)
        )).scalars().all()
        history.reverse()

        messages = _history_to_llm_messages(list(history))

        model = body.model or settings.LLM_DEFAULT_MODEL

        # 提取编辑器内容（如果有）
        editor_content = ""
        if body.context and body.context.get('type') == 'editor_content':
            editor_content = body.context.get('content', '')

    return StreamingResponse(
        _chat_generator(request, session_id, api_key, messages, model, editor_content=editor_content),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _chat_stream_should_continue(stop_reason: str | None) -> bool:
    """
    [已废弃] 原有的简单判断逻辑，现在由 should_continue_for_word_count 替代

    Anthropic 为 max_tokens；部分 OpenAI 兼容中转用 length 表示输出触顶。
    """
    if not stop_reason:
        return False
    r = str(stop_reason).strip().lower()
    return r in ("max_tokens", "length")


async def _merge_llm_stream_with_heartbeats(
    request: Request,
    llm_chunks: AsyncIterator,
    heartbeat_interval: float,
    *,
    log_session_id: int | None = None,
):
    """
    在 upstream 长时间不返回 token 时仍向客户端写入 SSE 注释行，
    避免反向代理 / 负载均衡因读超时关闭连接（浏览器表现为 network error）。
    以 None 表示一次心跳，由调用方 yield ``: heartbeat``。
    """
    queue: asyncio.Queue = asyncio.Queue()
    stop = asyncio.Event()

    async def pump() -> None:
        try:
            async for chunk in llm_chunks:
                await queue.put(("c", chunk))
        except BaseException as exc:
            await queue.put(("x", exc))
        finally:
            stop.set()
            await queue.put(("d", None))

    async def heartbeat() -> None:
        try:
            while True:
                await asyncio.sleep(heartbeat_interval)
                if stop.is_set():
                    return
                await queue.put(("h", None))
        except asyncio.CancelledError:
            return

    pump_task = asyncio.create_task(pump())
    hb_task = asyncio.create_task(heartbeat())
    try:
        while True:
            kind, data = await queue.get()
            if kind == "d":
                break
            if kind == "x":
                if isinstance(data, BaseException):
                    logger.error(
                        "chat llm upstream stream failed session=%s",
                        log_session_id,
                        exc_info=data,
                    )
                else:
                    logger.error(
                        "chat llm upstream stream failed session=%s err=%r",
                        log_session_id,
                        data,
                    )
                raise data
            if kind == "h":
                yield None
            elif kind == "c":
                yield data
    finally:
        stop.set()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass
        pump_task.cancel()
        try:
            await pump_task
        except BaseException:
            pass


async def _persist_assistant_message(
    session_id: int,
    content: str,
    used_model: str | None,
    tokens_in: int | None,
    tokens_out: int | None,
) -> None:
    """流式结束后单独开会话写入 DB，避免长时间 SSE 占用 Depends 连接导致 PG/asyncpg 断开。"""
    async with AsyncSessionLocal() as db:
        session = (
            await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        ).scalar_one_or_none()
        if session is None:
            logger.warning("persist assistant: session %s not found", session_id)
            return
        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=content,
            model=used_model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            created_at=datetime.now(timezone.utc),
        )
        db.add(assistant_msg)
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info(
            "chat persist ok session=%s model=%s content_len=%s tokens_in=%s tokens_out=%s",
            session_id,
            used_model,
            len(content),
            tokens_in,
            tokens_out,
        )


async def _chat_generator(request: Request, session_id: int, api_key: str, messages: list, model: str, editor_content: str = ""):
    """
    流式生成助手回复；支持智能字数控制：
    1. 使用 LLM 自动识别用户意图（字数要求、完整输出、继续请求、检查请求等）
    2. 实时统计已输出字数
    3. 字数不足时强制续写，直到满足要求
    4. 在续写 prompt 中明确告知还差多少字
    5. 检测 AI "偷懒"行为，自动重试
    6. 支持文章检查功能
    """
    full_response: list[str] = []
    stream_token_events = 0
    stream_chars = 0
    tokens_in: int | None = None
    tokens_out: int | None = None
    used_model = model
    last_finish: str | None = None
    base_messages = messages
    accumulated = ""
    max_segments = max(1, settings.LLM_CHAT_MAX_SEGMENTS)
    stop_stream = False
    # 出错时仍要把信息落库，避免用户切回看到空对话；与前端 reconcileChatMessages 的展示对齐。
    stream_error_msg: str | None = None
    client_disconnected = False

    # SSE 心跳：防止长时间无数据导致连接超时
    last_heartbeat = time.time()
    heartbeat_interval = 15  # 每 15 秒发送一次心跳

    # 从末条用户消息提取纯文本（用于意图识别与偷懒检测）
    user_intent: UserIntent | None = None
    user_request = ""

    if messages:
        last_user_msg = None
        for msg in reversed(messages):
            if msg.get("role") == "user":
                last_user_msg = msg
                break
        if last_user_msg:
            content = last_user_msg.get("content", "")
            if isinstance(content, str):
                user_request = content
            elif isinstance(content, list):
                # 处理多模态消息
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        user_request = block.get("text", "")
                        break

    # 重试机制：如果检测到 AI 偷懒，最多重试 1 次
    max_retries = 1
    retry_count = 0

    try:
        yield ": connected\n\n"
        logger.info(
            "chat stream connected session=%s model=%s history_msgs=%s",
            session_id,
            model,
            len(messages),
        )

        article_to_check = ""
        # 规则型意图识别（零延迟，无需额外 LLM 调用）
        user_intent = detect_intent_by_keywords(user_request)
        logger.info(
            "✅ Intent | action=%s continue=%s check=%s word_count=%s target=%s | session=%s",
            user_intent.action, user_intent.is_continue_request, user_intent.is_check_request,
            user_intent.word_count_requirement, user_intent.target_section, session_id,
        )

        if user_intent:
            logger.info(
                "Detected user intent: word_count=%s, full_output=%s, continue=%s, check=%s, action=%s, target=%s, summary=%s (session=%s)",
                user_intent.word_count_requirement,
                user_intent.is_full_output,
                user_intent.is_continue_request,
                user_intent.is_check_request,
                user_intent.action,
                user_intent.target_section,
                user_intent.summary,
                session_id,
            )

        if user_intent and user_intent.is_check_request:
            # 优先使用编辑器内容
            if editor_content:
                article_to_check = editor_content
            else:
                # 从对话历史中查找最近的助手回复（文章内容）
                for msg in reversed(messages):
                    if msg.get("role") == "assistant":
                        content = msg.get("content", "")
                        if isinstance(content, str) and len(content) > 100:
                            article_to_check = content
                            break

            if not article_to_check:
                logger.warning("Check request but no article content found for session=%s", session_id)
            else:
                logger.info(
                    "Check request: article length=%s words for session=%s",
                    count_words(article_to_check),
                    session_id,
                )

        while retry_count <= max_retries:
            # 重置累积内容（重试时）
            if retry_count > 0:
                accumulated = ""
                full_response = []
                stream_token_events = 0
                stream_chars = 0

                # 发送重试警告到前端
                warning_payload = json.dumps({
                    "type": "warning",
                    "message": "AI 响应不完整，正在重试..."
                }, ensure_ascii=False)
                yield f"event: warning\ndata: {warning_payload}\n\n"

                logger.warning(
                    "Detected lazy response, retrying (%s/%s) for session=%s",
                    retry_count,
                    max_retries,
                    session_id,
                )

            # 审稿专用：丢掉所有历史（包括"补充到 X 字"等创作语境），只发一条 user 含 check_prompt，
            # 否则模型容易被历史污染，回头继续写新故事而不是审阅。
            is_check_branch = bool(user_intent and user_intent.is_check_request and article_to_check)
            check_max_segments = 1 if is_check_branch else max_segments

            for seg_idx in range(check_max_segments):
                if stop_stream:
                    break

                # 构建消息：第一轮用原始消息，后续轮次添加续写提示
                if seg_idx == 0 and retry_count == 0:
                    if is_check_branch:
                        from app.utils.intent_detection import generate_check_prompt
                        check_prompt = generate_check_prompt(article_to_check)
                        # 不带任何历史；审稿是独立任务
                        msgs = [{"role": "user", "content": check_prompt}]
                        logger.info(
                            "📝 Check request | article_len=%d | history dropped | session=%s",
                            len(article_to_check), session_id,
                        )
                    elif user_intent and user_intent.is_continue_request:
                        # 用户在中断后说「继续完成」之类。模型直接看 history 时常出现两种偏差：
                        #   a) partial 较长（已写到中段）→ 模型从头重写一遍，重复浪费 token
                        #   b) partial 较短（只写了标题/声明）→ 模型不知道这是被截断的「开头」，
                        #      处理方式不一：可能续上、可能照搬。
                        # 我们按 partial 的长度选择**轻指令**或**严格指令**，避免一刀切。
                        last_assistant_content = ""
                        for hist_msg in reversed(base_messages[:-1]):
                            if hist_msg.get("role") == "assistant":
                                hc = hist_msg.get("content", "")
                                if isinstance(hc, str) and hc.strip():
                                    last_assistant_content = hc
                                    break
                        if last_assistant_content:
                            prev_len = len(last_assistant_content)
                            user_request_clean = (user_request or "继续完成上文未写完的部分。").strip()

                            # 阈值经验值：< 600 字符通常说明只是开了个头（标题+声明 ~150 字、
                            # 加上引子开头一两段 ~600 字），允许模型沿用并补全；
                            # >= 600 字符 大概率已进入正文，需要严格续接而非重写。
                            if prev_len < 600:
                                explicit_continue = (
                                    "【任务：基于上文开头继续完成全文】\n"
                                    f"上一条助手回复因用户主动中断而提前停止，已经写了 {prev_len} 字（属于较短的开头）：\n"
                                    f"「{last_assistant_content}」\n\n"
                                    "请基于上面这个开头**直接继续完成全文**：\n"
                                    "- ✅ 你可以沿着这个开头自然往下展开（推荐做法），上面用户已经能看到了\n"
                                    "- ✅ 如果用户在下方有补充指令（风格、字数等），按指令调整\n"
                                    "- ⚠️ 如果你打算保留上面那段开头，**不要把它一字不差地重新输出一遍**——那样会让用户屏幕上出现两份重复的开头\n"
                                    "- ⚠️ 如果你确实需要重写开头，请明确说明「重新版本如下」并继续写完整个故事\n\n"
                                    "用户最新指令原文：\n"
                                    f"{user_request_clean}"
                                )
                                continue_mode = "soft-head"
                            else:
                                tail_anchor = last_assistant_content[-200:]
                                explicit_continue = (
                                    "【任务：从中断处继续】\n"
                                    f"上一条助手回复因用户主动中断而提前停止，已写约 {prev_len} 字。末尾内容是：\n"
                                    f"「…{tail_anchor}」\n\n"
                                    "请你接着这个末尾**自然衔接**地继续写下去：\n"
                                    "- ✅ 你输出的第一句必须直接续接上文末尾，仿佛中间没有中断过\n"
                                    "- ✅ 如果用户在下方有具体补充指令（风格调整、剧情走向等），请按指令调整后再继续写\n"
                                    "- ❌ 不要重复任何已经出现过的句子或段落\n"
                                    "- ❌ 不要写「接下来我将继续」「让我继续」之类的开场白\n\n"
                                    "用户最新指令原文：\n"
                                    f"{user_request_clean}"
                                )
                                continue_mode = "strict-tail"
                            msgs = list(base_messages[:-1]) + [
                                {"role": "user", "content": explicit_continue}
                            ]
                            logger.info(
                                "📝 Explicit continue | session=%s | mode=%s | prev_len=%d",
                                session_id, continue_mode, prev_len,
                            )
                        else:
                            # 没有可续接的助手历史，按普通起始处理
                            msgs = base_messages
                            logger.info("📤 Continue intent but no prior assistant | session=%s", session_id)
                    else:
                        msgs = base_messages
                        logger.info("📤 Initial request | session=%s | seg=%d", session_id, seg_idx)
                elif seg_idx == 0 and retry_count > 0:
                    # 重试时，添加更强硬的提示
                    logger.info("🔄 Retry request | session=%s | retry=%d", session_id, retry_count)
                    msgs = list(base_messages) + [
                        {
                            "role": "user",
                            "content": "请不要只是确认任务或重复我的话，直接开始输出完整的文章内容。从第一个字开始，完整输出，不要添加任何前缀（如'好的'、'明白了'等）。"
                        }
                    ]
                else:
                    # 自动续写循环：用 Anthropic 的 assistant prefill 模式 —— messages 最后一条
                    # 是 assistant 时，模型会从该 content 直接续写，而不会把它当成"对话轮次回应"。
                    #
                    # 关键好处：此模式下，LLM 视角中"最近的 user 消息"仍是用户原始详细指令
                    # （扣题、分段、字数、风格等），不会被项目 hardcoded 的「请继续...」prompt 稀释。
                    # 这解决了用户反映的「续写后 LLM 自由发挥、忘记最初约束」的问题。
                    #
                    # 字数控制由后续 should_continue_for_word_count 在外层守住，无需再插入指令。
                    msgs = list(base_messages) + [
                        {"role": "assistant", "content": accumulated},
                    ]
                    logger.info(
                        "➕ Continue (prefill) | session=%s | seg=%d | current_words=%d | required=%s",
                        session_id, seg_idx, count_words(accumulated),
                        user_intent.word_count_requirement if user_intent else "None"
                    )

                logger.info(
                    "🚀 LLM Stream Starting | session=%s | seg=%d | model=%s | max_tokens=%d | api_key=%s...%s",
                    session_id, seg_idx, model, settings.LLM_CHAT_MAX_OUTPUT_TOKENS,
                    api_key[:12] if len(api_key) > 12 else api_key[:4],
                    api_key[-6:] if len(api_key) > 12 else ""
                )

                round_finish: str | None = None
                round_parts: list[str] = []

                # 唯一化 tag：sess<id>-seg<n>-r<retry>-<unix_ms>。下发到 LLM 的 metadata.user_id，
                # 防止中转站对相同 messages 做"无脑缓存"返回旧响应（这是用户反馈"换对话框输出
                # 一模一样"最常见的根因之一）。
                request_tag = f"sess{session_id}-seg{seg_idx}-r{retry_count}-{int(time.time()*1000)}"
                async for item in _merge_llm_stream_with_heartbeats(
                    request,
                    llm_client.stream(
                        api_key=api_key,
                        messages=_messages_for_chat_llm(msgs, editor_content),
                        model=model,
                        max_tokens=settings.LLM_CHAT_MAX_OUTPUT_TOKENS,
                        temperature=0.7,
                        request_tag=request_tag,
                    ),
                    heartbeat_interval,
                    log_session_id=session_id,
                ):
                    if await request.is_disconnected():
                        stop_stream = True
                        client_disconnected = True
                        logger.warning(
                            "chat stream client disconnect session=%s seg=%s chunks=%s chars=%s",
                            session_id,
                            seg_idx,
                            stream_token_events,
                            stream_chars,
                        )
                        break

                    if item is None:
                        yield ": heartbeat\n\n"
                        last_heartbeat = time.time()
                        continue

                    chunk = item
                    if chunk.content:
                        round_parts.append(chunk.content)
                        full_response.append(chunk.content)
                        stream_token_events += 1
                        stream_chars += len(chunk.content)
                        if stream_token_events % 250 == 0:
                            logger.info(
                                "chat stream progress session=%s seg=%s chunks=%s chars=%s",
                                session_id,
                                seg_idx,
                                stream_token_events,
                                stream_chars,
                            )
                        payload = json.dumps({"type": "token", "content": chunk.content}, ensure_ascii=False)
                        yield f"event: token\ndata: {payload}\n\n"
                        last_heartbeat = time.time()
                    if chunk.finish_reason:
                        round_finish = chunk.finish_reason
                        if chunk.usage_input_tokens is not None:
                            tokens_in = (tokens_in or 0) + chunk.usage_input_tokens
                        if chunk.usage_output_tokens is not None:
                            tokens_out = (tokens_out or 0) + chunk.usage_output_tokens

                accumulated += "".join(round_parts)
                last_finish = round_finish

                if stop_stream:
                    break

                # 审稿分支：拿到一段 Markdown 报告即停，永远不要再续写
                if is_check_branch:
                    should_continue = False
                    reason = "check request: single-shot, no continuation"
                else:
                    # 设计取舍：不再用「字数不足」驱动续写。即使用户在指令里写了「大约 6000 字」，
                    # 也只让 LLM 自己负责长度——LLM 写完一段说停就停，不再追着补字数。
                    # 这样可以杜绝用户觉得「答非所问 / 越写越偏」的问题（项目自动注入的续写
                    # prompt 会稀释用户原始约束）。
                    #
                    # 仅保留 max_tokens 截断场景下的续写：避免 LLM 句子被硬截断半句话。
                    # 这点通过 required_words=None 后 should_continue_for_word_count 的
                    # 默认分支自动保住（finish_reason=max_tokens/length 时 return True）。
                    should_continue, reason = should_continue_for_word_count(
                        accumulated_text=accumulated,
                        required_words=None,
                        finish_reason=round_finish,
                        segment_index=seg_idx,
                        max_segments=max_segments,
                    )

                if reason:
                    logger.info(
                        "Chat segment %s: %s (session=%s, model=%s)",
                        seg_idx,
                        reason,
                        session_id,
                        model,
                    )

                if not should_continue:
                    break

            # 检查是否偷懒（只在第一轮检查，避免无限重试）
            # 审稿分支：报告本身偏短且经常会带"我会"等确认词，会被误判为偷懒；这里跳过。
            if (
                not is_check_branch
                and retry_count == 0
                and detect_lazy_response(accumulated, user_request)
            ):
                retry_count += 1
                continue  # 重试
            else:
                # 响应正常或已达到最大重试次数，退出循环
                break

        if full_response and not stop_stream:
            # 在完成时发送字数统计信息
            final_word_count = count_words(accumulated)
            done_reason = last_finish or "end_turn"
            done_payload = {
                "type": "done",
                "finish_reason": done_reason,
                "word_count": final_word_count,
            }
            if user_intent and user_intent.word_count_requirement:
                done_payload["required_words"] = user_intent.word_count_requirement
                done_payload["word_count_satisfied"] = final_word_count >= user_intent.word_count_requirement

            payload = json.dumps(done_payload, ensure_ascii=False)
            yield f"event: done\ndata: {payload}\n\n"

    except asyncio.CancelledError:
        logger.warning(
            "chat stream cancelled session=%s chunks=%s accum_len=%s full_parts=%s",
            session_id,
            stream_token_events,
            len(accumulated),
            len(full_response),
        )
        raise
    except Exception as exc:
        logger.exception("Chat stream error for session %s", session_id)
        stream_error_msg = str(exc) or exc.__class__.__name__
        payload = json.dumps({"type": "error", "error": stream_error_msg}, ensure_ascii=False)
        yield f"event: error\ndata: {payload}\n\n"
    finally:
        # 与 accumulated 对齐：异常或中途断开时可能未执行 accumulated +=，但仍需落库已产出的片段，
        # 否则用户切走再回来 getMessages 只有用户消息、助手行缺失。
        content = "".join(full_response)
        if not content and accumulated:
            content = accumulated
        # 错误场景：即使一个 token 都没收到，也要落一条助手消息，否则用户切走再切回会看不到任何反馈。
        # 与前端 reconcileChatMessages 的展示对齐：有内容则尾部追加错误说明；无内容则单独写一句失败提示。
        if stream_error_msg and not client_disconnected:
            tail = f"\n\n—\n（未能完整保存：{stream_error_msg}）"
            if content.strip():
                content = content.rstrip() + tail
            else:
                content = f"请求失败：{stream_error_msg}\n\n请重试，或检查 API Key / 网络连接。"
        logger.info(
            "chat stream finally session=%s stop_stream=%s err=%s chunks=%s stream_chars=%s accum_len=%s persist_len=%s",
            session_id,
            stop_stream,
            bool(stream_error_msg),
            stream_token_events,
            stream_chars,
            len(accumulated),
            len(content),
        )
        if content:
            # Cancel-safe persistence: detach into an independent task so the DB write
            # survives starlette cancelling this generator on client disconnect.
            persist_task = spawn_persist_task(
                _persist_assistant_message(
                    session_id,
                    content,
                    used_model,
                    tokens_in,
                    tokens_out,
                )
            )
            await best_effort_wait(persist_task, timeout=5.0, label=f"chat-persist session={session_id}")
