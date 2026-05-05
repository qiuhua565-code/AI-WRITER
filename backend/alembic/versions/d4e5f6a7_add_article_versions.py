"""add article_versions table

Revision ID: d4e5f6a7
Revises: c3d4e5f6
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7"
down_revision = "c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "article_versions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("label", sa.Text(), nullable=False, server_default="手动编辑"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_article_versions_task_created", "article_versions", ["task_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_article_versions_task_created", table_name="article_versions")
    op.drop_table("article_versions")
