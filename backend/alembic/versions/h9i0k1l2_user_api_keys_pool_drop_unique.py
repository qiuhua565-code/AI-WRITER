"""user_api_keys: drop unique (user_id, provider, purpose) to allow per-user key pool

Revision ID: h9i0k1l2
Revises: g8h9i0j1
Create Date: 2026-05-06
"""

from alembic import op

revision = "h9i0k1l2"
down_revision = "g8h9i0j1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_user_api_keys_user_provider_purpose",
        "user_api_keys",
        type_="unique",
    )


def downgrade() -> None:
    # 若已存在重复 (user_id, provider, purpose)，降级会失败；生产慎用 downgrade。
    op.create_unique_constraint(
        "uq_user_api_keys_user_provider_purpose",
        "user_api_keys",
        ["user_id", "provider", "purpose"],
    )
