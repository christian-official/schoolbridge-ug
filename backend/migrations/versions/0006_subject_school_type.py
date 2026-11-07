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
    indexes = {index["name"]: index for index in inspect(op.get_bind()).get_indexes("subjects")}
    # Replace global name uniqueness with uniqueness within each school type.
    if "ix_subjects_name" in indexes:
        op.drop_index("ix_subjects_name", table_name="subjects")
    op.create_index("ix_subjects_name", "subjects", ["name"], unique=False)
    current_indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("subjects")}
    if "uq_subjects_name_school_type" not in current_indexes:
        op.create_index("uq_subjects_name_school_type", "subjects", ["name", "school_type"], unique=True)

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
        indexes = {index["name"] for index in inspector.get_indexes("subjects")}
        if "uq_subjects_name_school_type" in indexes:
            op.drop_index("uq_subjects_name_school_type", table_name="subjects")
        if "ix_subjects_name" in indexes:
            op.drop_index("ix_subjects_name", table_name="subjects")
        if "school_type" in columns:
            op.drop_column("subjects", "school_type")
        op.create_index("ix_subjects_name", "subjects", ["name"], unique=True)
