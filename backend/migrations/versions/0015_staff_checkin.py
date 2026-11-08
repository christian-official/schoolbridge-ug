"""Store staff self check-in and check-out times."""
from alembic import op
import sqlalchemy as sa

revision = "0015_staff_checkin"
down_revision = "0014_exam_type"
branch_labels = None
depends_on = None


def _columns(bind):
    return {column["name"] for column in sa.inspect(bind).get_columns("staff_attendance")}


def upgrade():
    bind = op.get_bind()
    columns = _columns(bind)
    if "check_in_at" not in columns:
        op.add_column("staff_attendance", sa.Column("check_in_at", sa.DateTime(), nullable=True))
    if "check_out_at" not in columns:
        op.add_column("staff_attendance", sa.Column("check_out_at", sa.DateTime(), nullable=True))


def downgrade():
    bind = op.get_bind()
    columns = _columns(bind)
    if "check_out_at" in columns:
        op.drop_column("staff_attendance", "check_out_at")
    if "check_in_at" in columns:
        op.drop_column("staff_attendance", "check_in_at")
