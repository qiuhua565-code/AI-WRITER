from datetime import datetime, timezone
from sqlalchemy import BigInteger, Text, Integer, ForeignKey, TIMESTAMP, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_messages_task_created", "task_id", "created_at"),
        Index("idx_messages_kind", "kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    segment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("segments.id", ondelete="SET NULL")
    )

    role: Mapped[str] = mapped_column(Text, nullable=False)
    # system | user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # 元信息
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="orchestration")
    # orchestration | review_chat | ai_edit | consistency_check
    model: Mapped[str | None] = mapped_column(Text)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer)

    # 上下文关联
    parent_message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("messages.id")
    )
    # "metadata" is reserved by SQLAlchemy — use msg_metadata as the Python attr
    msg_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB)
    # {finish_reason, prompt_template, ...}

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    task: Mapped["Task"] = relationship("Task", back_populates="messages")
    replies: Mapped[list["Message"]] = relationship(
        "Message", foreign_keys=[parent_message_id], back_populates="parent"
    )
    parent: Mapped["Message | None"] = relationship(
        "Message", foreign_keys=[parent_message_id], back_populates="replies",
        remote_side="Message.id",
    )
