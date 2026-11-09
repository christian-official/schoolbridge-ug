"""Add per-device sync checkpoint.

Revision ID: 0021_sync_device_checkpoint
Revises: 0020_sync_change_log
"""
from alembic import op
import sqlalchemy as sa

revision = "0021_sync_device_checkpoint"
down_revision = "0020_sync_change_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {item["name"] for item in sa.inspect(bind).get_columns("sync_devices")}
    if "last_sync_sequence" not in columns:
        op.add_column(
            "sync_devices",
            sa.Column("last_sync_sequence", sa.Integer(), nullable=False, server_default="0"),
        )
    with op.batch_alter_table("sync_devices") as batch_op:
        batch_op.alter_column("last_sync_sequence", server_default=None)


def downgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("sync_devices")}
    if "last_sync_sequence" in columns:
        op.drop_column("sync_devices", "last_sync_sequence")
