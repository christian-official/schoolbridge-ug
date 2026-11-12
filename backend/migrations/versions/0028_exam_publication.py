"""Add formal examination close and publication state."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0028_exam_publication"
down_revision = "0027_auth_session_revocation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "exams" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "status" not in columns:
        op.add_column("exams", sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"))
    if "closed_at" not in columns:
        op.add_column("exams", sa.Column("closed_at", sa.DateTime(), nullable=True))
    if "published_at" not in columns:
        op.add_column("exams", sa.Column("published_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "exams" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("exams")}
    for name in ("published_at", "closed_at", "status"):
        if name in columns:
            op.drop_column("exams", name)
