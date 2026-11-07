"""Establish a non-destructive baseline for existing SchoolBridge databases.

Revision ID: 0001_existing_schema
Revises:
"""
from alembic import op

from app.database import Base
from app import models  # noqa: F401 - register all mapped tables

revision = "0001_existing_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_all(checkfirst=True) creates missing tables only. It does not drop,
    # rename, or alter existing tables and preserves all existing records.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    # A baseline downgrade could destroy a school's data. Schema changes must
    # be reversed with a reviewed, explicit migration instead.
    raise RuntimeError(
        "The SchoolBridge baseline is intentionally irreversible; "
        "create a reviewed forward migration instead."
    )
