"""Repair partially-created first-school setup state tables."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0026_repair_school_setup_state"
down_revision = "0025_first_school_setup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "school_setup_state" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("school_setup_state")}
    missing_columns = [
        ("installation_id", sa.String(36), True, None),
        ("activated_at", sa.DateTime(), True, None),
        ("activation_license_hash", sa.String(64), True, None),
        ("activation_attempts", sa.Integer(), False, "0"),
        ("activation_locked_until", sa.DateTime(), True, None),
        ("setup_completed_at", sa.DateTime(), True, None),
        ("original_identity_json", sa.Text(), True, None),
    ]
    for name, column_type, nullable, server_default in missing_columns:
        if name in existing:
            continue
        op.add_column(
            "school_setup_state",
            sa.Column(
                name,
                column_type,
                nullable=nullable,
                server_default=server_default,
            ),
        )


def downgrade() -> None:
    # Keep the repaired columns in place: removing them could make a previously
    # running installation unusable and would discard activation security state.
    pass
