"""Persist installation activation and immutable first-school identity."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "0025_first_school_setup"
down_revision = "0024_sync_change_scopes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "school_profile" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("school_profile")}
        if "country" not in columns:
            op.add_column("school_profile", sa.Column("country", sa.String(80), nullable=True))
        if "school_structure" not in columns:
            op.add_column("school_profile", sa.Column("school_structure", sa.String(20), nullable=True))
    if "school_setup_state" not in inspect(bind).get_table_names():
        op.create_table(
            "school_setup_state",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("installation_id", sa.String(36), nullable=False, unique=True),
            sa.Column("activated_at", sa.DateTime(), nullable=True),
            sa.Column("activation_license_hash", sa.String(64), nullable=True),
            sa.Column("activation_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("activation_locked_until", sa.DateTime(), nullable=True),
            sa.Column("setup_completed_at", sa.DateTime(), nullable=True),
            sa.Column("original_identity_json", sa.Text(), nullable=True),
        )
    tables = set(inspect(bind).get_table_names())
    has_existing_use = False
    if "users" in tables:
        has_existing_use = bind.execute(text("SELECT 1 FROM users LIMIT 1")).first() is not None
    if not has_existing_use:
        for table in ("students", "staff_members", "classes"):
            if table in tables and bind.execute(text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
                has_existing_use = True
                break
    if has_existing_use:
        profile = None
        if "school_profile" in tables:
            profile = bind.execute(text("SELECT name, school_type, country, school_structure FROM school_profile WHERE id=1")).mappings().first()
        identity = {
            "school_name": (profile or {}).get("name") or "Existing School",
            "school_type": (profile or {}).get("school_type") or "Secondary",
            "country": (profile or {}).get("country"),
            "school_structure": (profile or {}).get("school_structure"),
            "installation_id": "legacy-existing-installation",
        }
        import json
        bind.execute(text("""
            INSERT INTO school_setup_state
            (id, installation_id, activated_at, activation_license_hash, setup_completed_at, original_identity_json)
            VALUES (1, 'legacy-existing-installation', CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, :identity)
        """), {"identity": json.dumps(identity, sort_keys=True)})


def downgrade() -> None:
    op.drop_table("school_setup_state")
    with op.batch_alter_table("school_profile") as batch:
        columns = {c["name"] for c in inspect(op.get_bind()).get_columns("school_profile")}
        if "school_structure" in columns:
            batch.drop_column("school_structure")
        if "country" in columns:
            batch.drop_column("country")
