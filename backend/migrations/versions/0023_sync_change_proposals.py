"""Persist idempotent offline change proposals and conflict review state."""
from alembic import op
import sqlalchemy as sa
revision="0023_sync_change_proposals"
down_revision="0022_sync_device_issued_sequence"
branch_labels=None
depends_on=None

def upgrade():
    op.create_table("sync_change_proposals",
        sa.Column("id",sa.Integer(),primary_key=True),
        sa.Column("user_id",sa.Integer(),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("device_id",sa.String(36),nullable=False),
        sa.Column("idempotency_key",sa.String(100),nullable=False),
        sa.Column("entity_type",sa.String(40),nullable=False),
        sa.Column("entity_id",sa.Integer(),nullable=True),
        sa.Column("operation",sa.String(10),nullable=False),
        sa.Column("payload_json",sa.Text(),nullable=False),
        sa.Column("base_sequence",sa.Integer(),nullable=False),
        sa.Column("status",sa.String(20),nullable=False,server_default="pending_review"),
        sa.Column("conflict_sequence",sa.Integer(),nullable=True),
        sa.Column("submitted_at",sa.DateTime(),nullable=False),
        sa.Column("resolved_at",sa.DateTime(),nullable=True),
        sa.Column("resolution",sa.String(20),nullable=True),
        sa.UniqueConstraint("user_id","idempotency_key",name="uq_sync_proposal_user_key"))
    op.create_index("ix_sync_change_proposals_user_id","sync_change_proposals",["user_id"])
    op.create_index("ix_sync_change_proposals_device_id","sync_change_proposals",["device_id"])

def downgrade():
    op.drop_index("ix_sync_change_proposals_device_id",table_name="sync_change_proposals")
    op.drop_index("ix_sync_change_proposals_user_id",table_name="sync_change_proposals")
    op.drop_table("sync_change_proposals")
