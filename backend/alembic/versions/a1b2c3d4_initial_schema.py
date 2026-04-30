"""initial_schema

Revision ID: a1b2c3d4
Revises:
Create Date: 2026-04-29

Complete schema for AI StoryFlow:
  users, tasks, segments, segment_versions, messages, task_events
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a1b2c3d4"
down_revision = None
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default="user"),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        # LLM 配置
        sa.Column("llm_api_key_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("llm_api_key_hint", sa.Text(), nullable=True),
        sa.Column("llm_api_key_status", sa.Text(), nullable=True, server_default="unknown"),
        sa.Column("llm_api_key_validated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "llm_key_concurrency_limit", sa.Integer(), nullable=False, server_default="5"
        ),
        # 配额
        sa.Column("daily_task_limit", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("monthly_token_limit", sa.BigInteger(), nullable=True),
        sa.Column("max_running_tasks", sa.Integer(), nullable=False, server_default="50"),
        # 偏好
        sa.Column(
            "preferences",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        # 时间
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("email", name="users_email_unique"),
    )
    op.create_index("idx_users_status", "users", ["status"])
    op.create_index("idx_users_role", "users", ["role"])

    # ------------------------------------------------------------------
    # tasks
    # ------------------------------------------------------------------
    op.create_table(
        "tasks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        # draft | queued | outlining | outline_review | writing
        # | paused | review | approved | rejected | cancelled | failed
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "need_outline_review", sa.Boolean(), nullable=False, server_default="false"
        ),
        # 大纲
        sa.Column(
            "outline", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("outline_buffer", sa.Text(), nullable=True),
        # 最终内容
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=True),
        # 进度
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_chapter", sa.Integer(), nullable=True),
        # 错误与重试
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_msg", sa.Text(), nullable=True),
        sa.Column("warning_msg", sa.Text(), nullable=True),
        # LLM 用量统计
        sa.Column("total_tokens_in", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_tokens_out", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_llm_calls", sa.Integer(), nullable=False, server_default="0"),
        # Celery 集成
        sa.Column("celery_task_id", sa.Text(), nullable=True),
        # 时间
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("idx_tasks_user_status", "tasks", ["user_id", "status"])
    op.create_index("idx_tasks_status_created", "tasks", ["status", "created_at"])
    op.execute(
        "CREATE INDEX idx_tasks_user_created ON tasks(user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_tasks_completed_at ON tasks(completed_at)"
        " WHERE completed_at IS NOT NULL"
    )

    # updated_at 自动维护触发器（tasks & segments 共用）
    op.execute(
        """
        CREATE OR REPLACE FUNCTION trigger_set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER tasks_set_updated_at
        BEFORE UPDATE ON tasks
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
        """
    )

    # ------------------------------------------------------------------
    # segments
    # ------------------------------------------------------------------
    op.create_table(
        "segments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "task_id",
            sa.BigInteger(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("segment_type", sa.Text(), nullable=False, server_default="free"),
        # intro | free | paywall | paid
        sa.Column("target_word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        # pending | generating | needs_continuation
        # | completed | failed | partial_failed | cancelled
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("finish_reason", sa.Text(), nullable=True),
        sa.Column("tokens_used", sa.Integer(), nullable=True),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("task_id", "index", name="segments_task_index_unique"),
    )
    op.create_index("idx_segments_task", "segments", ["task_id", "index"])
    op.execute(
        "CREATE INDEX idx_segments_status ON segments(status)"
        " WHERE status NOT IN ('completed', 'cancelled')"
    )
    op.execute(
        """
        CREATE TRIGGER segments_set_updated_at
        BEFORE UPDATE ON segments
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
        """
    )

    # ------------------------------------------------------------------
    # segment_versions
    # ------------------------------------------------------------------
    op.create_table(
        "segment_versions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "segment_id",
            sa.BigInteger(),
            sa.ForeignKey("segments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("edit_type", sa.Text(), nullable=False),
        # ai_initial | ai_continuation | manual | ai_partial | ai_full | rollback
        sa.Column(
            "edited_by",
            sa.BigInteger(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "edit_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("segment_id", "version", name="segment_versions_unique"),
    )
    op.execute(
        "CREATE INDEX idx_segment_versions_segment"
        " ON segment_versions(segment_id, version DESC)"
    )

    # ------------------------------------------------------------------
    # messages
    # ------------------------------------------------------------------
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "task_id",
            sa.BigInteger(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "segment_id",
            sa.BigInteger(),
            sa.ForeignKey("segments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("role", sa.Text(), nullable=False),
        # system | user | assistant
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="orchestration"),
        # orchestration | review_chat | ai_edit | consistency_check
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=True),
        sa.Column(
            "parent_message_id",
            sa.BigInteger(),
            sa.ForeignKey("messages.id"),
            nullable=True,
        ),
        sa.Column(
            "metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_messages_task_created", "messages", ["task_id", "created_at"])
    op.create_index("idx_messages_kind", "messages", ["kind"])
    op.execute(
        "CREATE INDEX idx_messages_segment ON messages(segment_id)"
        " WHERE segment_id IS NOT NULL"
    )

    # ------------------------------------------------------------------
    # task_events
    # ------------------------------------------------------------------
    op.create_table(
        "task_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "task_id",
            sa.BigInteger(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        # status_changed | llm_call | llm_failed | model_fallback
        # | paused | resumed | cancelled | segment_edited | segment_rolled_back
        # | rejected | approved | exported | watchdog_requeued | timeout
        sa.Column("actor", sa.Text(), nullable=False),
        # system | worker | user:<id>
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_task_events_task_created", "task_events", ["task_id", "created_at"])
    op.create_index("idx_task_events_type", "task_events", ["event_type"])
    op.execute(
        "CREATE INDEX idx_task_events_payload_gin"
        " ON task_events USING gin(payload)"
    )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    op.drop_table("task_events")
    op.drop_table("messages")
    op.drop_table("segment_versions")
    op.drop_table("segments")
    op.drop_table("tasks")
    op.drop_table("users")
    op.execute("DROP FUNCTION IF EXISTS trigger_set_updated_at() CASCADE;")
