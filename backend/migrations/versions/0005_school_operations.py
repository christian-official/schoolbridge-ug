"""Add staff attendance and class timetable tables.

Revision ID: 0005_school_operations
Revises: 0004_mark_verification
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0005_school_operations"
down_revision = "0004_mark_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    if "staff_attendance" not in tables:
        op.create_table(
            "staff_attendance",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff_members.id"), nullable=False),
            sa.Column("attendance_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("notes", sa.String(length=255), nullable=True),
            sa.UniqueConstraint("staff_id", "attendance_date", name="uq_staff_attendance_date"),
        )
        op.create_index("ix_staff_attendance_staff_id", "staff_attendance", ["staff_id"])
        op.create_index("ix_staff_attendance_attendance_date", "staff_attendance", ["attendance_date"])
    if "timetable_entries" not in tables:
        op.create_table(
            "timetable_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id"), nullable=False),
            sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id"), nullable=True),
            sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff_members.id"), nullable=True),
            sa.Column("day_of_week", sa.Integer(), nullable=False),
            sa.Column("start_time", sa.String(length=5), nullable=False),
            sa.Column("end_time", sa.String(length=5), nullable=False),
            sa.Column("room", sa.String(length=60), nullable=True),
            sa.UniqueConstraint("class_id", "day_of_week", "start_time", name="uq_timetable_class_day_start"),
        )
        op.create_index("ix_timetable_entries_class_id", "timetable_entries", ["class_id"])


def downgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    if "timetable_entries" in tables:
        op.drop_table("timetable_entries")
    if "staff_attendance" in tables:
        op.drop_table("staff_attendance")
