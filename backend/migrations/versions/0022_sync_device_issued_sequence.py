"""Track the highest change sequence issued to each device.

Revision ID: 0022_sync_device_issued_sequence
Revises: 0021_sync_device_checkpoint
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_sync_device_issued_sequence"
down_revision = "0021_sync_device_checkpoint"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {item["name"] for item in sa.inspect(bind).get_columns("sync_devices")}
    if "last_issued_sequence" not in columns:
        op.add_column(
            "sync_devices",
            sa.Column("last_issued_sequence", sa.Integer(), nullable=False, server_default="0"),
        )
    with op.batch_alter_table("sync_devices") as batch_op:
        batch_op.alter_column("last_issued_sequence", server_default=None)


def downgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("sync_devices")}
    if "last_issued_sequence" in columns:
        op.drop_column("last_issued_sequence")
