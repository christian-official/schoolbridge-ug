"""Add per-account authentication session revocation."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0027_auth_session_revocation"
down_revision = "0026_repair_school_setup_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    # Some supported legacy databases only contain setup metadata at this point.
    # They must still advance through the migration chain; the users table is
    # created by the later baseline migration when the full schema is applied.
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "token_version" not in columns:
        op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "token_version" in columns:
        op.drop_column("users", "token_version")
