"""Add parent and teacher self-registration claims.

Revision ID: 0037_registration_claims
Revises: 0036_trusted_school_contacts
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0037_registration_claims"
down_revision = "0036_trusted_school_contacts"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
    inspector = inspect(bind)
    if "users" in set(inspector.get_table_names()):
        email_column = next(
            (column for column in inspector.get_columns("users") if column["name"] == "email"),
            None,
        )
        if email_column is not None and not email_column.get("nullable", True):
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("users") as batch:
                    batch.alter_column("email", existing_type=sa.String(150), nullable=True)
            else:
                op.alter_column("users", "email", existing_type=sa.String(150), nullable=True)

    if "registration_claims" not in set(inspect(bind).get_table_names()):
        op.create_table(
            "registration_claims",
            sa.Column("school_tenant_id", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reference_hash", sa.String(64), nullable=False),
            sa.Column("claim_type", sa.String(20), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, server_default="pending_review"),
            sa.Column("submitted_name", sa.String(160), nullable=False),
            sa.Column("details_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("candidate_student_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("candidate_contact_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("candidate_staff_id", sa.Integer(), nullable=True),
            sa.Column("phone_masked", sa.String(40), nullable=True),
            sa.Column("verification_code_hash", sa.String(64), nullable=True),
            sa.Column("verification_expires_at", sa.DateTime(), nullable=True),
            sa.Column("verification_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("requester_ip_hash", sa.String(64), nullable=True),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("review_note", sa.Text(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )

    indexes = {item["name"] for item in inspect(bind).get_indexes("registration_claims")}
    if "ix_registration_claims_school_tenant_id" not in indexes:
        op.create_index("ix_registration_claims_school_tenant_id", "registration_claims", ["school_tenant_id"])
    if "ix_registration_claims_reference_hash" not in indexes:
        op.create_index("ix_registration_claims_reference_hash", "registration_claims", ["reference_hash"], unique=True)
    if "ix_registration_claims_tenant_status" not in indexes:
        op.create_index("ix_registration_claims_tenant_status", "registration_claims", ["school_tenant_id", "status"])


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
    if "registration_claims" in set(inspect(bind).get_table_names()):
        indexes = {item["name"] for item in inspect(bind).get_indexes("registration_claims")}
        for name in ("ix_registration_claims_tenant_status", "ix_registration_claims_reference_hash", "ix_registration_claims_school_tenant_id"):
            if name in indexes:
                op.drop_index(name, table_name="registration_claims")
        op.drop_table("registration_claims")

    inspector = inspect(bind)
    if "users" in set(inspector.get_table_names()):
        has_null_email = bind.exec_driver_sql("SELECT 1 FROM users WHERE email IS NULL LIMIT 1").first()
        if has_null_email:
            raise RuntimeError("Cannot make users.email required while accounts without email addresses exist.")
        email_column = next(
            (column for column in inspector.get_columns("users") if column["name"] == "email"),
            None,
        )
        if email_column is not None and email_column.get("nullable", True):
            if bind.dialect.name == "sqlite":
                with op.batch_alter_table("users") as batch:
                    batch.alter_column("email", existing_type=sa.String(150), nullable=False)
            else:
                op.alter_column("users", "email", existing_type=sa.String(150), nullable=False)
