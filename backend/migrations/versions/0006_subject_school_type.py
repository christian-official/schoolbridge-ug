"""Separate registered subjects by school type.

Revision ID: 0006_subject_school_type
Revises: 0005_school_operations
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0006_subject_school_type"
down_revision = "0005_school_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "subjects" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("subjects")}
    if "school_type" not in columns:
        op.add_column(
            "subjects",
            sa.Column("school_type", sa.String(length=20), nullable=False, server_default="Secondary"),
        )
    tables = set(inspect(op.get_bind()).get_table_names())
    if "school_profile" in tables:
        op.execute(
            sa.text(
                "UPDATE subjects SET school_type = COALESCE("
                "(SELECT school_type FROM school_profile WHERE id = 1), 'Secondary')"
            )
        )


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "subjects" in set(inspector.get_table_names()):
        columns = {column["name"] for column in inspector.get_columns("subjects")}
        if "school_type" in columns:
            op.drop_column("subjects", "school_type")
