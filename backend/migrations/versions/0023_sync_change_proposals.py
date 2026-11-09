"""Persist idempotent offline change proposals and conflict review state."""
from alembic import op
import sqlalchemy as sa

revision = "0023_sync_change_proposals"
down_revision = "0022_sync_device_issued_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "sync_change_proposals" not in inspector.get_table_names():
        op.create_table(
            "sync_change_proposals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("device_id", sa.String(length=36), nullable=False),
            sa.Column("idempotency_key", sa.String(length=100), nullable=False),
            sa.Column("entity_type", sa.String(length=40), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=True),
            sa.Column("operation", sa.String(length=10), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("base_sequence", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending_review"),
            sa.Column("conflict_sequence", sa.Integer(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
            sa.Column("resolution", sa.String(length=20), nullable=True),
            sa.UniqueConstraint("user_id", "idempotency_key", name="uq_sync_proposal_user_key"),
        )

    # The baseline migration uses current ORM metadata to create missing tables
    # on fresh installs. That can create this table and its indexes in advance.
    inspector = sa.inspect(bind)
    indexes = {item["name"] for item in inspector.get_indexes("sync_change_proposals")}
    if "ix_sync_change_proposals_user_id" not in indexes:
        op.create_index("ix_sync_change_proposals_user_id", "sync_change_proposals", ["user_id"])
    if "ix_sync_change_proposals_device_id" not in indexes:
        op.create_index("ix_sync_change_proposals_device_id", "sync_change_proposals", ["device_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "sync_change_proposals" not in sa.inspect(bind).get_table_names():
        return
    indexes = {item["name"] for item in sa.inspect(bind).get_indexes("sync_change_proposals")}
    if "ix_sync_change_proposals_device_id" in indexes:
        op.drop_index("ix_sync_change_proposals_device_id", table_name="sync_change_proposals")
    if "ix_sync_change_proposals_user_id" in indexes:
        op.drop_index("ix_sync_change_proposals_user_id", table_name="sync_change_proposals")
    op.drop_table("sync_change_proposals")
