"""add purpose field to user_api_keys

Revision ID: e5f6a7b8
Revises: d4e5f6a7
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8"
down_revision = "d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 新增 purpose 列，默认 both（兼容现有数据）
    op.add_column(
        "user_api_keys",
        sa.Column("purpose", sa.Text(), nullable=False, server_default="both"),
    )
    # 2. 删除旧唯一约束 (user_id, provider)
    op.drop_constraint("uq_user_api_keys_user_provider", "user_api_keys", type_="unique")
    # 3. 建新唯一约束 (user_id, provider, purpose)
    op.create_unique_constraint(
        "uq_user_api_keys_user_provider_purpose",
        "user_api_keys",
        ["user_id", "provider", "purpose"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_user_api_keys_user_provider_purpose", "user_api_keys", type_="unique")
    op.create_unique_constraint(
        "uq_user_api_keys_user_provider", "user_api_keys", ["user_id", "provider"]
    )
    op.drop_column("user_api_keys", "purpose")
