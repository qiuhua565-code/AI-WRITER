from datetime import datetime
from sqlalchemy import BigInteger, Text, Integer, Boolean, ForeignKey, TIMESTAMP, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("idx_tasks_user_status", "user_id", "status"),
        Index("idx_tasks_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # 业务字段
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")
    # draft | queued | outlining | outline_review | writing
    # | paused | review | approved | rejected | cancelled | failed

    # 配置（详见 04 文档）
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # {target_words, genre, style, temperature, models, ...}
    need_outline_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 大纲
    outline: Mapped[dict | None] = mapped_column(JSONB)
    outline_buffer: Mapped[str | None] = mapped_column(Text)

    # 最终内容
    content: Mapped[str | None] = mapped_column(Text)
    word_count: Mapped[int | None] = mapped_column(Integer)

    # 进度展示（实时维护）
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 0-100
    current_chapter: Mapped[int | None] = mapped_column(Integer)

    # 错误与重试
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_msg: Mapped[str | None] = mapped_column(Text)
    warning_msg: Mapped[str | None] = mapped_column(Text)

    # LLM 用量统计
    total_tokens_in: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_tokens_out: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_llm_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Celery 集成
    celery_task_id: Mapped[str | None] = mapped_column(Text)

    # 时间
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="tasks")
    segments: Mapped[list["Segment"]] = relationship(
        "Segment", back_populates="task", order_by="Segment.index"
    )
    events: Mapped[list["TaskEvent"]] = relationship("TaskEvent", back_populates="task")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="task")
