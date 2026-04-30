from datetime import datetime
from sqlalchemy import BigInteger, Text, ForeignKey, TIMESTAMP, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TaskEvent(Base):
    __tablename__ = "task_events"
    __table_args__ = (
        Index("idx_task_events_task_created", "task_id", "created_at"),
        Index("idx_task_events_type", "event_type"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )

    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    # status_changed | llm_call | llm_failed | model_fallback
    # | paused | resumed | cancelled
    # | segment_edited | segment_rolled_back
    # | rejected | approved | exported
    # | watchdog_requeued | timeout

    actor: Mapped[str] = mapped_column(Text, nullable=False)
    # system | worker | user:<id>

    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )

    # Relationships
    task: Mapped["Task"] = relationship("Task", back_populates="events")
