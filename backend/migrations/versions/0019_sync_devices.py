"""Create per-user registered device records for future sync access control.

Revision ID: 0019_sync_devices
Revises: 0018_profile_photos
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_sync_devices"
down_revision = "0018_profile_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sync_devices" not in inspector.get_table_names():
        op.create_table(
            "sync_devices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("device_id", sa.String(length=36), nullable=False),
            sa.Column("device_name", sa.String(length=100), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("user_id", "device_id", name="uq_sync_devices_user_device"),
        )

    # The non-destructive baseline uses current ORM metadata to create missing
    # tables on fresh installs, so the table or its index may already exist.
    inspector = sa.inspect(bind)
    indexes = {item["name"] for item in inspector.get_indexes("sync_devices")}
    if "ix_sync_devices_user_id" not in indexes:
        op.create_index("ix_sync_devices_user_id", "sync_devices", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "sync_devices" in sa.inspect(bind).get_table_names():
        indexes = {item["name"] for item in sa.inspect(bind).get_indexes("sync_devices")}
        if "ix_sync_devices_user_id" in indexes:
            op.drop_index("ix_sync_devices_user_id", table_name="sync_devices")
        op.drop_table("sync_devices")
