"""Persist school report logo and editable report template settings.

Revision ID: 0007_report_branding
Revises: 0006_subject_school_type
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0007_report_branding"
down_revision = "0006_subject_school_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "school_profile" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("school_profile")}
    if "report_logo" not in columns:
        op.add_column("school_profile", sa.Column("report_logo", sa.Text(), nullable=True))
    if "report_template" not in columns:
        op.add_column("school_profile", sa.Column("report_template", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "school_profile" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("school_profile")}
    if "report_template" in columns:
        op.drop_column("school_profile", "report_template")
    if "report_logo" in columns:
        op.drop_column("school_profile", "report_logo")
