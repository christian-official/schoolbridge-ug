"""Add parent access links and school announcements.

Revision ID: 0008_parent_access
Revises: 0007_report_branding
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0008_parent_access"
down_revision = "0007_report_branding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    if "parent_student_links" not in tables:
        op.create_table(
            "parent_student_links",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("student_id", sa.Integer(), sa.ForeignKey("students.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "student_id", name="uq_parent_student_link"),
        )
        op.create_index("ix_parent_student_links_user_id", "parent_student_links", ["user_id"])
        op.create_index("ix_parent_student_links_student_id", "parent_student_links", ["student_id"])
    if "school_announcements" not in tables:
        op.create_table(
            "school_announcements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(160), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("audience", sa.String(20), nullable=False, server_default="All"),
            sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )


def downgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    if "school_announcements" in tables:
        op.drop_table("school_announcements")
    if "parent_student_links" in tables:
        op.drop_index("ix_parent_student_links_student_id", table_name="parent_student_links")
        op.drop_index("ix_parent_student_links_user_id", table_name="parent_student_links")
        op.drop_table("parent_student_links")
