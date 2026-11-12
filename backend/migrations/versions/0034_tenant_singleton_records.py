"""Enforce one profile, settings row and setup state per school tenant.

Revision ID: 0034_tenant_singleton_records
Revises: 0033_tenant_scoped_uniqueness
"""
from alembic import op
from sqlalchemy import inspect

revision = "0034_tenant_singleton_records"
down_revision = "0033_tenant_scoped_uniqueness"
branch_labels = None
depends_on = None

SINGLETONS = (
    ("school_profile", "uq_school_profile_tenant"),
    ("school_settings", "uq_school_settings_tenant"),
    ("school_setup_state", "uq_school_setup_state_tenant"),
)


def upgrade():
    bind = op.get_bind()
    for table, name in SINGLETONS:
        inspector = inspect(bind)
        if table not in set(inspector.get_table_names()):
            continue
        if any(
            tuple(item.get("column_names") or ()) == ("school_tenant_id",)
            for item in inspector.get_unique_constraints(table)
        ):
            continue
        with op.batch_alter_table(
            table,
            recreate="always" if bind.dialect.name == "sqlite" else "auto",
        ) as batch:
            batch.create_unique_constraint(name, ["school_tenant_id"])


def downgrade():
    bind = op.get_bind()
    for table, name in reversed(SINGLETONS):
        inspector = inspect(bind)
        if table not in set(inspector.get_table_names()):
            continue
        target = next(
            (item for item in inspector.get_unique_constraints(table)
             if tuple(item.get("column_names") or ()) == ("school_tenant_id",)),
            None,
        )
        if target is None:
            continue
        with op.batch_alter_table(
            table,
            recreate="always" if bind.dialect.name == "sqlite" else "auto",
        ) as batch:
            batch.drop_constraint(target.get("name") or name, type_="unique")
