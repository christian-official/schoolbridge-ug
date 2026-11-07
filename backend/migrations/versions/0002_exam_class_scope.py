"""Scope examinations to classes.

Revision ID: 0002_exam_class_scope
Revises: 0001_existing_schema
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0002_exam_class_scope"
down_revision = "0001_existing_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "exams" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "class_id" not in columns:
        op.add_column(
            "exams",
            sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id"), nullable=True),
        )
    indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("exams")}
    if "ix_exams_class_id" not in indexes:
        op.create_index("ix_exams_class_id", "exams", ["class_id"], unique=False)


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "exams" not in set(inspector.get_table_names()):
        return
    indexes = {index["name"] for index in inspector.get_indexes("exams")}
    if "ix_exams_class_id" in indexes:
        op.drop_index("ix_exams_class_id", table_name="exams")
    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "class_id" in columns:
        with op.batch_alter_table("exams") as batch:
            batch.drop_column("class_id")
