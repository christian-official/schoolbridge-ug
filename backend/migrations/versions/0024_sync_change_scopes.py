"""Add historical permission scope metadata to sync journal events."""
from alembic import op
import sqlalchemy as sa

revision = "0024_sync_change_scopes"
down_revision = "0023_sync_change_proposals"
branch_labels = None
depends_on = None

def upgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("sync_changes")}
    if "scope_json" not in columns:
        op.add_column("sync_changes", sa.Column("scope_json", sa.Text(), nullable=False, server_default="{}"))

def downgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("sync_changes")}
    if "scope_json" in columns: op.drop_column("sync_changes", "scope_json")
