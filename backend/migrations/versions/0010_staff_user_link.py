"""Link login accounts to existing staff directory records.

Revision ID: 0010_staff_user_link
Revises: 0009_staff_permissions
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0010_staff_user_link"
down_revision = "0009_staff_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("users")}
    indexes = {index["name"] for index in inspector.get_indexes("users")}
    foreign_keys = {fk.get("name") for fk in inspector.get_foreign_keys("users")}
    with op.batch_alter_table("users") as batch_op:
        if "staff_id" not in columns:
            batch_op.add_column(sa.Column("staff_id", sa.Integer(), nullable=True))
        if "fk_users_staff_id_staff_members" not in foreign_keys:
            batch_op.create_foreign_key(
                "fk_users_staff_id_staff_members", "staff_members",
                ["staff_id"], ["id"], ondelete="SET NULL"
            )
        if "ix_users_staff_id" not in indexes:
            batch_op.create_index("ix_users_staff_id", ["staff_id"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_staff_id")
        batch_op.drop_constraint("fk_users_staff_id_staff_members", type_="foreignkey")
        batch_op.drop_column("staff_id")
