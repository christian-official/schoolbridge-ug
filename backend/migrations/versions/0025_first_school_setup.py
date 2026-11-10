"""Persist installation activation and immutable first-school identity."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text
from uuid import uuid4

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
    if "school_identity_corrections" not in inspect(bind).get_table_names():
        op.create_table(
            "school_identity_corrections",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("license_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("license_id", sa.String(100), nullable=False),
            sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("old_identity_json", sa.Text(), nullable=False),
            sa.Column("new_identity_json", sa.Text(), nullable=False),
            sa.Column("corrected_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        )
    tables = set(inspect(bind).get_table_names())
    has_existing_use = False
    # A previously-created school profile is evidence that this database was
    # already configured, even if an administrator account has since been
    # removed or the school has not yet entered student/staff records.
    if "school_profile" in tables:
        has_existing_use = bind.execute(
            text("SELECT 1 FROM school_profile LIMIT 1")
        ).first() is not None
    if not has_existing_use and "users" in tables:
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
        identity = None if profile is None else {
            "school_name": profile.get("name") or "Existing School",
            "school_type": profile.get("school_type") or "Secondary",
            "country": profile.get("country"),
            "school_structure": profile.get("school_structure"),
            "installation_id": "legacy-existing-installation",
        }
        import json
        legacy_installation_id = str(uuid4())
        if identity is not None:
            identity["installation_id"] = legacy_installation_id
        bind.execute(text("""
            INSERT INTO school_setup_state
            (id, installation_id, activated_at, activation_license_hash, setup_completed_at, original_identity_json)
            VALUES (1, :installation_id, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, :identity)
        """), {
            "installation_id": legacy_installation_id,
            "identity": json.dumps(identity, sort_keys=True) if identity else None,
        })


def downgrade() -> None:
    op.drop_table("school_identity_corrections")
    op.drop_table("school_setup_state")
    with op.batch_alter_table("school_profile") as batch:
        columns = {c["name"] for c in inspect(op.get_bind()).get_columns("school_profile")}
        if "school_structure" in columns:
            batch.drop_column("school_structure")
        if "country" in columns:
            batch.drop_column("country")
