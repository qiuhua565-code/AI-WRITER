"""创建 / 写入用户个人 API Key（user_api_keys），供设置页与管理员接口共用。"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import UserApiKey
from app.models.user import User
from app.utils.security import encrypt_api_key, make_key_hint

PROVIDER_LABELS = {
    "claude": "Claude (Anthropic)",
    "aipipe": "AIPipe 中转",
    "openai": "OpenAI",
    "deepseek": "DeepSeek",
    "gemini": "Google Gemini",
    "custom": "自定义",
}
PURPOSE_LABELS = {
    "both": "通用",
    "chat": "AI 对话专用",
    "generate": "批量生成专用",
}


async def insert_user_api_key(
    db: AsyncSession,
    user_id: int,
    *,
    provider: str,
    purpose: str,
    api_key: str,
    label: str = "",
) -> UserApiKey:
    if len(api_key) < 10:
        raise ValueError("API Key 太短")
    if purpose not in ("both", "chat", "generate"):
        raise ValueError("purpose 必须为 both / chat / generate")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise ValueError("用户不存在")

    resolved_label = label.strip() or (
        f"{PROVIDER_LABELS.get(provider, provider)} · {PURPOSE_LABELS.get(purpose, purpose)}"
    )
    encrypted = encrypt_api_key(api_key)
    hint = make_key_hint(api_key)

    row = UserApiKey(
        user_id=user_id,
        provider=provider,
        purpose=purpose,
        label=resolved_label,
        key_encrypted=encrypted,
        key_hint=hint,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)

    if provider == "claude":
        user.llm_api_key_encrypted = encrypted
        user.llm_api_key_hint = hint
        user.llm_api_key_status = "unknown"

    await db.flush()
    await db.refresh(row)
    return row


async def sync_user_legacy_claude_from_pool(db: AsyncSession, user_id: int) -> None:
    """users.llm_* 与剩余 Claude 个人 Key 对齐（若无则清空）。"""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        return
    row = (
        await db.execute(
            select(UserApiKey)
            .where(UserApiKey.user_id == user_id, UserApiKey.provider == "claude")
            .order_by(UserApiKey.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row:
        user.llm_api_key_encrypted = row.key_encrypted
        user.llm_api_key_hint = row.key_hint
        user.llm_api_key_status = "unknown"
    else:
        user.llm_api_key_encrypted = None
        user.llm_api_key_hint = None
        user.llm_api_key_status = "unknown"
