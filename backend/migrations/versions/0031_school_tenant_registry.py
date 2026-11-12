"""Create the stable school tenant registry and backfill the existing installation.

Revision ID: 0031_school_tenant_registry
Revises: 0030_optional_admission_no
"""
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "0031_school_tenant_registry"
down_revision = "0030_optional_admission_no"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "school_tenants" not in inspector.get_table_names():
        op.create_table(
            "school_tenants",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("public_id", sa.String(36), nullable=False),
            sa.Column("installation_id", sa.String(36), nullable=True),
            sa.Column("name", sa.String(160), nullable=False, server_default="My School"),
            sa.Column("status", sa.String(24), nullable=False, server_default="pending_setup"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.UniqueConstraint("public_id", name="uq_school_tenants_public_id"),
            sa.UniqueConstraint("installation_id", name="uq_school_tenants_installation_id"),
        )
        op.create_index("ix_school_tenants_public_id", "school_tenants", ["public_id"])
        op.create_index("ix_school_tenants_installation_id", "school_tenants", ["installation_id"])

    existing = bind.execute(text("SELECT id FROM school_tenants ORDER BY id LIMIT 1")).first()
    if existing:
        return

    installation_id = None
    status = "pending_setup"
    if "school_setup_state" in inspect(bind).get_table_names():
        state = bind.execute(text(
            "SELECT installation_id, setup_completed_at FROM school_setup_state WHERE id=1"
        )).mappings().first()
        if state:
            installation_id = state["installation_id"]
            status = "active" if state["setup_completed_at"] is not None else "pending_setup"

    name = "My School"
    if "school_profile" in inspect(bind).get_table_names():
        profile = bind.execute(text(
            "SELECT name FROM school_profile WHERE id=1"
        )).first()
        if profile and profile[0]:
            name = profile[0]

    bind.execute(text("""
        INSERT INTO school_tenants
            (public_id, installation_id, name, status, created_at)
        VALUES
            (:public_id, :installation_id, :name, :status, CURRENT_TIMESTAMP)
    """), {
        "public_id": str(uuid4()),
        "installation_id": installation_id,
        "name": name,
        "status": status,
    })


def downgrade() -> None:
    op.drop_index("ix_school_tenants_installation_id", table_name="school_tenants")
    op.drop_index("ix_school_tenants_public_id", table_name="school_tenants")
    op.drop_table("school_tenants")
