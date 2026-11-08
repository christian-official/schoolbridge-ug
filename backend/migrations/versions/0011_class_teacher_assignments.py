"""Add distinct class-teacher responsibility assignments.

Revision ID: 0011_class_teacher_assignments
Revises: 0010_staff_user_link
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0011_class_teacher_assignments"
down_revision = "0010_staff_user_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "class_teacher_assignments" not in inspector.get_table_names():
        op.create_table(
            "class_teacher_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id"), nullable=False),
            sa.Column("assigned_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("class_id", name="uq_class_teacher_class"),
        )
    indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("class_teacher_assignments")}
    if "ix_class_teacher_assignments_teacher_id" not in indexes:
        op.create_index("ix_class_teacher_assignments_teacher_id", "class_teacher_assignments", ["teacher_id"])
    if "ix_class_teacher_assignments_class_id" not in indexes:
        op.create_index("ix_class_teacher_assignments_class_id", "class_teacher_assignments", ["class_id"])


def downgrade() -> None:
    op.drop_index("ix_class_teacher_assignments_class_id", table_name="class_teacher_assignments")
    op.drop_index("ix_class_teacher_assignments_teacher_id", table_name="class_teacher_assignments")
    op.drop_table("class_teacher_assignments")
