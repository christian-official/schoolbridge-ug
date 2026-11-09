"""Create append-only versioned change metadata for offline sync.

Revision ID: 0020_sync_change_log
Revises: 0019_sync_devices
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_sync_change_log"
down_revision = "0019_sync_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sync_changes" not in inspector.get_table_names():
        op.create_table(
            "sync_changes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entity_type", sa.String(length=40), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("operation", sa.String(length=10), nullable=False),
            sa.Column("changed_at", sa.DateTime(), nullable=False),
        )
    inspector = sa.inspect(bind)
    indexes = {item["name"] for item in inspector.get_indexes("sync_changes")}
    if "ix_sync_changes_entity_type" not in indexes:
        op.create_index("ix_sync_changes_entity_type", "sync_changes", ["entity_type"])
    if "ix_sync_changes_changed_at" not in indexes:
        op.create_index("ix_sync_changes_changed_at", "sync_changes", ["changed_at"])


def downgrade() -> None:
    op.drop_index("ix_sync_changes_changed_at", table_name="sync_changes")
    op.drop_index("ix_sync_changes_entity_type", table_name="sync_changes")
    op.drop_table("sync_changes")
