"""Add staff role labels and granular permissions.

Revision ID: 0009_staff_permissions
Revises: 0008_parent_access
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0009_staff_permissions"
down_revision = "0008_parent_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "role_label" not in columns:
        op.add_column("users", sa.Column("role_label", sa.String(length=80), nullable=True))
    if "permissions_json" not in columns:
        op.add_column("users", sa.Column("permissions_json", sa.Text(), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "permissions_json" in columns:
        op.drop_column("users", "permissions_json")
    if "role_label" in columns:
        op.drop_column("users", "role_label")
