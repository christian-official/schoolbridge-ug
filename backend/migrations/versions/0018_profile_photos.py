"""Add profile photo storage to existing student and staff tables.

Revision ID: 0018_profile_photos
Revises: 0017_house_and_fee_modes
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_profile_photos"
down_revision = "0017_house_and_fee_modes"
branch_labels = None
depends_on = None


def _add_if_missing(table_name: str, column: sa.Column) -> None:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return
    existing = {item["name"] for item in inspector.get_columns(table_name)}
    if column.name not in existing:
        op.add_column(table_name, column)


def upgrade() -> None:
    # These fields were added to the ORM for profile-photo uploads, but older
    # deployed databases already at revision 0017 did not receive the columns.
    _add_if_missing("students", sa.Column("photo_data", sa.Text(), nullable=True))
    _add_if_missing("staff_members", sa.Column("photo_data", sa.Text(), nullable=True))


def downgrade() -> None:
    # Keep uploaded profile photos; this migration is intentionally irreversible.
    pass
