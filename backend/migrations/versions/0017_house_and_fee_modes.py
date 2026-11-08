"""Add guardian, house and boarding/day fee fields."""
from alembic import op
import sqlalchemy as sa

revision = "0017_house_and_fee_modes"
down_revision = "0016_parent_liaison"
branch_labels = None
depends_on = None


def _add(table, name, column):
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}
    if name not in columns:
        op.add_column(table, column)


def upgrade():
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "students" in tables:
        _add("students", "guardian2_name", sa.Column("guardian2_name", sa.String(160), nullable=True))
        _add("students", "guardian2_relationship", sa.Column("guardian2_relationship", sa.String(60), nullable=True))
        _add("students", "guardian2_phone", sa.Column("guardian2_phone", sa.String(30), nullable=True))
        _add("students", "study_mode", sa.Column("study_mode", sa.String(20), nullable=False, server_default="Day"))
        _add("students", "house", sa.Column("house", sa.String(80), nullable=True))
    if "staff_members" in tables:
        _add("staff_members", "house", sa.Column("house", sa.String(80), nullable=True))
    if "class_fees" in tables:
        _add("class_fees", "boarding_amount", sa.Column("boarding_amount", sa.Integer(), nullable=True))
        _add("class_fees", "day_amount", sa.Column("day_amount", sa.Integer(), nullable=True))
    if "school_profile" in tables:
        _add("school_profile", "house_names", sa.Column("house_names", sa.Text(), nullable=True))


def downgrade():
    pass
