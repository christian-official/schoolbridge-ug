"""Create configurable school grading bands.

Revision ID: 0003_configurable_grading
Revises: 0002_exam_class_scope
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0003_configurable_grading"
down_revision = "0002_exam_class_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "grade_bands" not in set(inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "grade_bands",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("grade", sa.String(length=20), nullable=False),
            sa.Column("min_score", sa.Float(), nullable=False),
            sa.Column("max_score", sa.Float(), nullable=False),
            sa.Column("remark", sa.String(length=100), nullable=False, server_default=""),
            sa.UniqueConstraint("grade", name="uq_grade_bands_grade"),
        )


def downgrade() -> None:
    if "grade_bands" in set(inspect(op.get_bind()).get_table_names()):
        op.drop_table("grade_bands")
