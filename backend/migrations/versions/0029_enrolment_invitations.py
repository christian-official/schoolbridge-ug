"""Add single-use, account-bound device enrolment invitations."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0029_enrolment_invitations"
down_revision = "0028_exam_publication"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "enrolment_invitations" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "enrolment_invitations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("installation_id", sa.String(36), nullable=False),
            sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("redeemed_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_enrolment_invitations_token_hash", "enrolment_invitations", ["token_hash"], unique=True)
        op.create_index("ix_enrolment_invitations_installation_id", "enrolment_invitations", ["installation_id"])
        op.create_index("ix_enrolment_invitations_target_user_id", "enrolment_invitations", ["target_user_id"])


def downgrade() -> None:
    if "enrolment_invitations" in inspect(op.get_bind()).get_table_names():
        op.drop_table("enrolment_invitations")
