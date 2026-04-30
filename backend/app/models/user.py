from datetime import datetime
from sqlalchemy import BigInteger, Text, Integer, LargeBinary, TIMESTAMP, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("idx_users_status", "status"),
        Index("idx_users_role", "role"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, default="user")
    # user | admin
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    # active | disabled

    # LLM 配置
    llm_api_key_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    # AES-GCM 密文（含 nonce 前12字节）
    llm_api_key_hint: Mapped[str | None] = mapped_column(Text)
    llm_api_key_status: Mapped[str] = mapped_column(Text, default="unknown")
    # unknown | valid | invalid | expired
    llm_api_key_validated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    llm_key_concurrency_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    # 配额
    daily_task_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    monthly_token_limit: Mapped[int | None] = mapped_column(BigInteger)
    max_running_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=50)

    # 偏好
    preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="user")
