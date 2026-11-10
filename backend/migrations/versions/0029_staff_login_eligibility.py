"""Add staff login eligibility control."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0029_staff_login_eligibility"
down_revision = "0028_staff_responsibilities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "staff_members" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("staff_members")}
    if "login_allowed" not in columns:
        op.add_column("staff_members", sa.Column("login_allowed", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    # Preserve account eligibility settings on rollback.
    pass
