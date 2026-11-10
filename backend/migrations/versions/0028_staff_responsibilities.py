"""Store staff-declared responsibilities."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0028_staff_responsibilities"
down_revision = "0027_exam_release_visitors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "staff_members" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("staff_members")}
    if "special_roles_json" not in columns:
        op.add_column("staff_members", sa.Column("special_roles_json", sa.Text(), nullable=True))


def downgrade() -> None:
    # Keep staff responsibility declarations on rollback.
    pass
