"""Add exam release controls and visitor register."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0027_exam_release_visitors"
down_revision = "0026_repair_school_setup_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "exams" in tables:
        columns = {column["name"] for column in inspector.get_columns("exams")}
        if "closed" not in columns:
            op.add_column("exams", sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "visitor_logs" not in tables:
        op.create_table(
            "visitor_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("visitor_name", sa.String(160), nullable=False),
            sa.Column("phone", sa.String(30), nullable=True),
            sa.Column("organisation", sa.String(160), nullable=True),
            sa.Column("person_to_see", sa.String(160), nullable=False),
            sa.Column("purpose", sa.String(255), nullable=False),
            sa.Column("vehicle_registration", sa.String(30), nullable=True),
            sa.Column("checked_in_at", sa.DateTime(), nullable=False),
            sa.Column("checked_out_at", sa.DateTime(), nullable=True),
            sa.Column("recorded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        )
        op.create_index("ix_visitor_logs_checked_in_at", "visitor_logs", ["checked_in_at"])


def downgrade() -> None:
    # Preserve visitor history and exam release state on rollback.
    pass
