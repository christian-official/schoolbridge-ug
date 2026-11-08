"""Create secure staff-initiated Parent Liaison communications."""
from alembic import op
import sqlalchemy as sa

revision = "0016_parent_liaison"
down_revision = "0015_staff_checkin"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "parent_liaison_threads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("students.id"), nullable=False),
        sa.Column("parent_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("initiated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subject", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False, server_default="General enquiry"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="Open"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_parent_liaison_threads_student_id", "parent_liaison_threads", ["student_id"])
    op.create_index("ix_parent_liaison_threads_parent_user_id", "parent_liaison_threads", ["parent_user_id"])
    op.create_index("ix_parent_liaison_threads_initiated_by", "parent_liaison_threads", ["initiated_by"])
    op.create_index("ix_parent_liaison_threads_updated_at", "parent_liaison_threads", ["updated_at"])
    op.create_table(
        "parent_liaison_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("thread_id", sa.Integer(), sa.ForeignKey("parent_liaison_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_parent_liaison_messages_thread_id", "parent_liaison_messages", ["thread_id"])
    op.create_index("ix_parent_liaison_messages_sender_id", "parent_liaison_messages", ["sender_id"])


def downgrade():
    op.drop_index("ix_parent_liaison_messages_sender_id", table_name="parent_liaison_messages")
    op.drop_index("ix_parent_liaison_messages_thread_id", table_name="parent_liaison_messages")
    op.drop_table("parent_liaison_messages")
    op.drop_index("ix_parent_liaison_threads_updated_at", table_name="parent_liaison_threads")
    op.drop_index("ix_parent_liaison_threads_initiated_by", table_name="parent_liaison_threads")
    op.drop_index("ix_parent_liaison_threads_parent_user_id", table_name="parent_liaison_threads")
    op.drop_index("ix_parent_liaison_threads_student_id", table_name="parent_liaison_threads")
    op.drop_table("parent_liaison_threads")
