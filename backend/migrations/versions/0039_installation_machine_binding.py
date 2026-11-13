"""Bind SchoolBridge installation state to its original desktop credential.

Revision ID: 0039_installation_machine_binding
Revises: 0038_owner_activation_challenge
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0039_installation_machine_binding"
down_revision = "0038_owner_activation_challenge"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if "school_setup_state" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("school_setup_state")}
    if "machine_binding_hash" not in columns:
        op.add_column(
            "school_setup_state",
            sa.Column("machine_binding_hash", sa.String(64), nullable=True),
        )


def downgrade():
    inspector = inspect(op.get_bind())
    if "school_setup_state" in set(inspector.get_table_names()):
        columns = {column["name"] for column in inspector.get_columns("school_setup_state")}
        if "machine_binding_hash" in columns:
            op.drop_column("school_setup_state", "machine_binding_hash")
