from datetime import datetime, timezone
from sqlalchemy import BigInteger, Text, Integer, ForeignKey, TIMESTAMP, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Segment(Base):
    __tablename__ = "segments"
    __table_args__ = (
        UniqueConstraint("task_id", "index", name="segments_task_index_unique"),
        Index("idx_segments_task", "task_id", "index"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )

    # 章节信息
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 第几章 (1-based)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    segment_type: Mapped[str] = mapped_column(Text, nullable=False, default="free")
    # intro | free | paywall | paid
    target_word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 状态
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    # pending | generating | needs_continuation
    # | completed | failed | partial_failed | cancelled

    # 内容
    content: Mapped[str | None] = mapped_column(Text)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 乐观锁版本号

    # LLM 元信息
    finish_reason: Mapped[str | None] = mapped_column(Text)
    tokens_used: Mapped[int | None] = mapped_column(Integer)
    model_used: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 时间
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    task: Mapped["Task"] = relationship("Task", back_populates="segments")
    versions: Mapped[list["SegmentVersion"]] = relationship(
        "SegmentVersion", back_populates="segment"
    )


class SegmentVersion(Base):
    __tablename__ = "segment_versions"
    __table_args__ = (
        UniqueConstraint("segment_id", "version", name="segment_versions_unique"),
        Index("idx_segment_versions_segment", "segment_id", "version"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    segment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("segments.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)

    content: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    edit_type: Mapped[str] = mapped_column(Text, nullable=False)
    # ai_initial | ai_continuation | manual | ai_partial | ai_full | rollback

    edited_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    # NULL 表示系统 / AI

    edit_metadata: Mapped[dict | None] = mapped_column(JSONB)
    # {instruction, selection_range, ...}

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    segment: Mapped["Segment"] = relationship("Segment", back_populates="versions")
