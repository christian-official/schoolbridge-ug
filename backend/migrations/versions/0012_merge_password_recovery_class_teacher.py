"""Merge password recovery and class-teacher assignment migration branches.

Revision ID: 0012_merge_password_recovery_class_teacher
Revises: 0010_password_recovery, 0011_class_teacher_assignments
"""
revision = "0012_merge_password_recovery_class_teacher"
down_revision = ("0010_password_recovery", "0011_class_teacher_assignments")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This revision only joins the two existing migration branches.
    pass


def downgrade() -> None:
    # Keep both parent revisions applied; no schema changes are introduced here.
    pass
