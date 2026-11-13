"""Record single-use developer-authorised installation transfers.

Revision ID: 0040_school_machine_transfers
Revises: 0039_installation_machine_binding
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0040_school_machine_transfers"
down_revision = "0039_installation_machine_binding"
branch_labels = None
depends_on = None


def upgrade():
    if "school_machine_transfers" in set(inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "school_machine_transfers",
        sa.Column("school_tenant_id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("installation_id", sa.String(36), nullable=False),
        sa.Column("license_hash", sa.String(64), nullable=False),
        sa.Column("license_id", sa.String(100), nullable=False),
        sa.Column("previous_machine_hash", sa.String(64), nullable=False),
        sa.Column("new_machine_hash", sa.String(64), nullable=False),
        sa.Column("transferred_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("license_hash", name="uq_school_machine_transfers_license_hash"),
    )
    op.create_index("ix_school_machine_transfers_school_tenant_id", "school_machine_transfers", ["school_tenant_id"])
    op.create_index("ix_school_machine_transfers_installation_id", "school_machine_transfers", ["installation_id"])


def downgrade():
    if "school_machine_transfers" in set(inspect(op.get_bind()).get_table_names()):
        op.drop_index("ix_school_machine_transfers_installation_id", table_name="school_machine_transfers")
        op.drop_index("ix_school_machine_transfers_school_tenant_id", table_name="school_machine_transfers")
        op.drop_table("school_machine_transfers")
