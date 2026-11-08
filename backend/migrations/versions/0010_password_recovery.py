"""Add password recovery and forced password change fields.

Revision ID: 0010_password_recovery
Revises: 0009_staff_permissions
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0010_password_recovery"
down_revision = "0009_staff_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "reset_code_hash" not in columns:
        op.add_column("users", sa.Column("reset_code_hash", sa.String(length=255), nullable=True))
    if "reset_expires_at" not in columns:
        op.add_column("users", sa.Column("reset_expires_at", sa.DateTime(), nullable=True))
    if "reset_requested_at" not in columns:
        op.add_column("users", sa.Column("reset_requested_at", sa.DateTime(), nullable=True))
    if "reset_attempts" not in columns:
        op.add_column("users", sa.Column("reset_attempts", sa.Integer(), nullable=False, server_default="0"))
    if "must_change_password" not in columns:
        op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    for name in ("must_change_password", "reset_attempts", "reset_requested_at", "reset_expires_at", "reset_code_hash"):
        if name in columns:
            op.drop_column("users", name)
