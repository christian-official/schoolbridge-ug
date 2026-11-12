"""Allow student records without admission numbers.

Revision ID: 0030_optional_admission_no
Revises: 0029_enrolment_invitations
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "0030_optional_admission_no"
down_revision = "0029_enrolment_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "students" not in inspector.get_table_names():
        return
    columns = {column["name"]: column for column in inspector.get_columns("students")}
    if "admission_number" not in columns or columns["admission_number"].get("nullable", True):
        return
    with op.batch_alter_table("students") as batch:
        batch.alter_column(
            "admission_number",
            existing_type=sa.String(length=40),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "students" not in inspector.get_table_names():
        return
    columns = {column["name"]: column for column in inspector.get_columns("students")}
    if "admission_number" not in columns or not columns["admission_number"].get("nullable", True):
        return
    missing = bind.execute(text(
        "SELECT COUNT(*) FROM students WHERE admission_number IS NULL"
    )).scalar_one()
    if missing:
        raise RuntimeError(
            "Cannot restore NOT NULL admission numbers while student records "
            "without admission numbers exist. Assign numbers before downgrading."
        )
    with op.batch_alter_table("students") as batch:
        batch.alter_column(
            "admission_number",
            existing_type=sa.String(length=40),
            nullable=False,
        )
