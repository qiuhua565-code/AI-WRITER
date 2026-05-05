import base64
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, ConfigDict

from app.database import get_db
from app.models.chat import ChatSession, ChatMessage
from app.models.user import User
from app.utils.deps import get_current_user
from app.services.llm import llm_client
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

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
    key = await get_key_for_chat(db, user_id)
    if not key:
        raise HTTPException(status_code=503, detail="未配置可用的 API Key：请在设置中绑定您自己的 Key，或由管理员配置系统 Key")
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
        _chat_generator(request, db, session_id, session, api_key, messages, model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/sessions/{session_id}/stream")
async def stream_chat(
    session_id: int,
    body: ChatStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    _validate_attachment_parts(body.attachments)
    mat = _materialize_user_message(body)
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

    return StreamingResponse(
        _chat_generator(request, db, session_id, session, api_key, messages, model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _chat_stream_should_continue(stop_reason: str | None) -> bool:
    """Anthropic 为 max_tokens；部分 OpenAI 兼容中转用 length 表示输出触顶。"""
    if not stop_reason:
        return False
    r = str(stop_reason).strip().lower()
    return r in ("max_tokens", "length")


async def _chat_generator(request: Request, db: AsyncSession, session_id: int, session: ChatSession, api_key: str, messages: list, model: str):
    """流式生成助手回复；若上游 stop_reason=max_tokens，自动追加多轮续写并拼成一条消息。"""
    full_response: list[str] = []
    tokens_in: int | None = None
    tokens_out: int | None = None
    used_model = model
    last_finish: str | None = None
    base_messages = messages
    accumulated = ""
    max_segments = max(1, settings.LLM_CHAT_MAX_SEGMENTS)
    stop_stream = False

    try:
        yield ": connected\n\n"
        for seg_idx in range(max_segments):
            if stop_stream:
                break
            msgs = base_messages if seg_idx == 0 else (
                list(base_messages)
                + [
                    {"role": "assistant", "content": accumulated},
                    {"role": "user", "content": settings.LLM_CHAT_CONTINUE_PROMPT},
                ]
            )
            round_finish: str | None = None
            round_parts: list[str] = []

            async for chunk in llm_client.stream(
                api_key=api_key,
                messages=msgs,
                model=model,
                max_tokens=settings.LLM_CHAT_MAX_OUTPUT_TOKENS,
                temperature=0.7,
            ):
                if await request.is_disconnected():
                    stop_stream = True
                    break
                if chunk.content:
                    round_parts.append(chunk.content)
                    full_response.append(chunk.content)
                    payload = json.dumps({"type": "token", "content": chunk.content}, ensure_ascii=False)
                    yield f"event: token\ndata: {payload}\n\n"
                if chunk.finish_reason:
                    round_finish = chunk.finish_reason
                    if _chat_stream_should_continue(chunk.finish_reason):
                        logger.warning(
                            "Chat segment %s hit output limit (%s) session=%s model=%s",
                            seg_idx,
                            chunk.finish_reason,
                            session_id,
                            model,
                        )
                    if chunk.usage_input_tokens is not None:
                        tokens_in = (tokens_in or 0) + chunk.usage_input_tokens
                    if chunk.usage_output_tokens is not None:
                        tokens_out = (tokens_out or 0) + chunk.usage_output_tokens

            accumulated += "".join(round_parts)
            last_finish = round_finish

            if stop_stream:
                break
            if not _chat_stream_should_continue(round_finish):
                break
            if seg_idx == max_segments - 1:
                logger.warning(
                    "Chat stopped after max_segments=%s still at output limit (session=%s)",
                    max_segments,
                    session_id,
                )

        if full_response and not stop_stream:
            done_reason = last_finish or "end_turn"
            payload = json.dumps({"type": "done", "finish_reason": done_reason}, ensure_ascii=False)
            yield f"event: done\ndata: {payload}\n\n"

    except Exception as exc:
        logger.exception("Chat stream error for session %s", session_id)
        payload = json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)
        yield f"event: error\ndata: {payload}\n\n"
    finally:
        if full_response:
            content = "".join(full_response)
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
