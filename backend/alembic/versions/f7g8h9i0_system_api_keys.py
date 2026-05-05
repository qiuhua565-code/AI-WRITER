"""add system_api_keys table

Revision ID: f7g8h9i0
Revises: e5f6a7b8
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa

revision = "f7g8h9i0"
down_revision = "e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_api_keys",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False, server_default=""),
        sa.Column("key_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column("key_hint", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("system_api_keys")
