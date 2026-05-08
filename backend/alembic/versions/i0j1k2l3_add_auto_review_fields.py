"""tasks: add auto_review_report / auto_review_model / auto_review_at

Revision ID: i0j1k2l3
Revises: h9i0k1l2
Create Date: 2026-05-07

把自动审阅报告与正文分离存储，便于 UI 展示「仅供参考」、导出 docx 时跳过。
"""

from alembic import op
import sqlalchemy as sa


revision = "i0j1k2l3"
down_revision = "h9i0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("auto_review_report", sa.Text(), nullable=True),
    )
    op.add_column(
        "tasks",
        sa.Column("auto_review_model", sa.Text(), nullable=True),
    )
    op.add_column(
        "tasks",
        sa.Column("auto_review_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tasks", "auto_review_at")
    op.drop_column("tasks", "auto_review_model")
    op.drop_column("tasks", "auto_review_report")
