"""system_api_keys add purpose column

Revision ID: g8h9i0j1
Revises: f7g8h9i0
Create Date: 2026-05-05
"""

from alembic import op
import sqlalchemy as sa

revision = "g8h9i0j1"
down_revision = "f7g8h9i0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_api_keys",
        sa.Column("purpose", sa.Text(), nullable=False, server_default="both"),
    )


def downgrade() -> None:
    op.drop_column("system_api_keys", "purpose")
