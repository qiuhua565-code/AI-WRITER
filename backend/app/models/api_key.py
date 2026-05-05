from datetime import datetime, timezone
from sqlalchemy import BigInteger, Text, LargeBinary, TIMESTAMP, Index, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserApiKey(Base):
    __tablename__ = "user_api_keys"
    __table_args__ = (Index("idx_user_api_keys_user_id", "user_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)   # claude / aipipe / openai / deepseek / custom
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="both")  # both / chat / generate
    label: Mapped[str] = mapped_column(Text, nullable=False)
    key_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_hint: Mapped[str] = mapped_column(Text, nullable=False)   # sk-PxABsMKg****A9lf
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped["User"] = relationship("User", back_populates="api_keys")  # type: ignore
