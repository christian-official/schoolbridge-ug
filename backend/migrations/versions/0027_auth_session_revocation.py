"""Add per-account authentication session revocation."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0027_auth_session_revocation"
down_revision = "0026_repair_school_setup_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "token_version" not in columns:
        op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "token_version" in columns:
        op.drop_column("users", "token_version")
