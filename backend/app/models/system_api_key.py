from datetime import datetime, timezone
from sqlalchemy import BigInteger, Text, Boolean, LargeBinary, TIMESTAMP, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SystemApiKey(Base):
    """管理员统一配置的系统 API Key 池，所有用户任务共享。"""
    __tablename__ = "system_api_keys"
    __table_args__ = (
        Index("idx_system_api_keys_provider", "provider"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    # aipipe | claude | openai | deepseek | gemini | custom
    label: Mapped[str] = mapped_column(Text, nullable=False, default="")
    key_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_hint: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # task = 仅写稿任务（排他锁）; chat = 仅对话/辅助修改; both = 两者都用
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="both")
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
