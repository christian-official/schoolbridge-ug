"""Scope user login identifiers to each school tenant.

Revision ID: 0035_tenant_scoped_user_identity
Revises: 0034_tenant_singleton_records
"""
from alembic import op
from sqlalchemy import inspect

revision = "0035_tenant_scoped_user_identity"
down_revision = "0034_tenant_singleton_records"
branch_labels = None
depends_on = None

IDENTIFIERS = (
    ("username", "ix_users_username", "ux_users_tenant_username"),
    ("email", "ix_users_email", "ux_users_tenant_email"),
)


def upgrade():
    bind = op.get_bind()
    for column, old_name, new_name in IDENTIFIERS:
        inspector = inspect(bind)
        if "users" not in set(inspector.get_table_names()):
            continue
        indexes = inspector.get_indexes("users")
        old_indexes = [
            item for item in indexes
            if item.get("unique")
            and tuple(item.get("column_names") or ()) == (column,)
        ]
        new_exists = any(
            item.get("unique")
            and tuple(item.get("column_names") or ()) == ("school_tenant_id", column)
            for item in indexes
        )
        for item in old_indexes:
            op.drop_index(item["name"], table_name="users")
        if not new_exists:
            op.create_index(
                new_name, "users", ["school_tenant_id", column], unique=True
            )


def downgrade():
    bind = op.get_bind()
    for column, old_name, new_name in reversed(IDENTIFIERS):
        inspector = inspect(bind)
        if "users" not in set(inspector.get_table_names()):
            continue
        indexes = inspector.get_indexes("users")
        for item in indexes:
            if item.get("unique") and tuple(item.get("column_names") or ()) == ("school_tenant_id", column):
                op.drop_index(item["name"], table_name="users")
        duplicate = bind.exec_driver_sql(
            f'SELECT 1 FROM users GROUP BY "{column}" HAVING COUNT(*) > 1 LIMIT 1'
        ).first()
        if duplicate:
            raise RuntimeError(
                f"Cannot restore global uniqueness for users.{column}: "
                "multiple schools now use the same value."
            )
        current = inspect(bind).get_indexes("users")
        if not any(
            item.get("unique") and tuple(item.get("column_names") or ()) == (column,)
            for item in current
        ):
            op.create_index(old_name, "users", [column], unique=True)
