"""Add verification state to examination marks.

Revision ID: 0004_mark_verification
Revises: 0003_configurable_grading
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004_mark_verification"
down_revision = "0003_configurable_grading"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "marks" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("marks")}
    if "verified" not in columns:
        op.add_column(
            "marks",
            sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "marks" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("marks")}
    if "verified" in columns:
        op.drop_column("marks", "verified")
