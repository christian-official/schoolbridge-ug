"""Create secure staff-initiated Parent Liaison communications."""
from alembic import op
import sqlalchemy as sa

revision = "0016_parent_liaison"
down_revision = "0015_staff_checkin"
branch_labels = None
depends_on = None


def _tables(bind):
    return set(sa.inspect(bind).get_table_names())


def _ensure_index(bind, table, name, columns):
    existing = {item["name"] for item in sa.inspect(bind).get_indexes(table)}
    if name not in existing:
        op.create_index(name, table, columns)


def upgrade():
    bind = op.get_bind()
    tables = _tables(bind)
    if "parent_liaison_threads" not in tables:
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
    if "parent_liaison_messages" not in tables:
        op.create_table(
            "parent_liaison_messages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("thread_id", sa.Integer(), sa.ForeignKey("parent_liaison_threads.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sender_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("read_at", sa.DateTime(), nullable=True),
        )
    _ensure_index(bind, "parent_liaison_threads", "ix_parent_liaison_threads_student_id", ["student_id"])
    _ensure_index(bind, "parent_liaison_threads", "ix_parent_liaison_threads_parent_user_id", ["parent_user_id"])
    _ensure_index(bind, "parent_liaison_threads", "ix_parent_liaison_threads_initiated_by", ["initiated_by"])
    _ensure_index(bind, "parent_liaison_threads", "ix_parent_liaison_threads_updated_at", ["updated_at"])
    _ensure_index(bind, "parent_liaison_messages", "ix_parent_liaison_messages_thread_id", ["thread_id"])
    _ensure_index(bind, "parent_liaison_messages", "ix_parent_liaison_messages_sender_id", ["sender_id"])


def downgrade():
    bind = op.get_bind()
    tables = _tables(bind)
    if "parent_liaison_messages" in tables:
        indexes = {item["name"] for item in sa.inspect(bind).get_indexes("parent_liaison_messages")}
        for name in ("ix_parent_liaison_messages_sender_id", "ix_parent_liaison_messages_thread_id"):
            if name in indexes:
                op.drop_index(name, table_name="parent_liaison_messages")
        op.drop_table("parent_liaison_messages")
    if "parent_liaison_threads" in tables:
        indexes = {item["name"] for item in sa.inspect(bind).get_indexes("parent_liaison_threads")}
        for name in ("ix_parent_liaison_threads_updated_at", "ix_parent_liaison_threads_initiated_by", "ix_parent_liaison_threads_parent_user_id", "ix_parent_liaison_threads_student_id"):
            if name in indexes:
                op.drop_index(name, table_name="parent_liaison_threads")
        op.drop_table("parent_liaison_threads")
