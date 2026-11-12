"""Add trusted guardian and staff contact verification metadata.

Revision ID: 0036_trusted_school_contacts
Revises: 0035_tenant_scoped_user_identity
"""
from alembic import op
import sqlalchemy as sa

revision = "0036_trusted_school_contacts"
down_revision = "0035_tenant_scoped_user_identity"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "staff_members",
        sa.Column("phone_source", sa.String(40), nullable=False, server_default="legacy_staff_record"),
    )
    op.add_column(
        "staff_members",
        sa.Column("phone_verification_status", sa.String(20), nullable=False, server_default="unverified"),
    )
    op.add_column("staff_members", sa.Column("phone_verified_at", sa.DateTime(), nullable=True))
    op.add_column("staff_members", sa.Column("phone_verified_by", sa.Integer(), nullable=True))

    op.create_table(
        "student_guardian_contacts",
        sa.Column("school_tenant_id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("students.id"), nullable=False),
        sa.Column("guardian_name", sa.String(160), nullable=False),
        sa.Column("relationship", sa.String(60), nullable=True),
        sa.Column("phone", sa.String(30), nullable=True),
        sa.Column("legacy_slot", sa.String(20), nullable=True),
        sa.Column("source", sa.String(40), nullable=False, server_default="school_record"),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="unverified"),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("verified_by", sa.Integer(), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["school_tenant_id"], ["school_tenants.id"]),
        sa.UniqueConstraint("school_tenant_id", "student_id", "legacy_slot", name="uq_student_guardian_legacy_slot"),
    )
    op.create_index("ix_student_guardian_contacts_school_tenant_id", "student_guardian_contacts", ["school_tenant_id"])
    op.create_index("ix_student_guardian_contacts_student_id", "student_guardian_contacts", ["student_id"])

    # Preserve existing paper-record guardian details without treating them
    # as verified. A school administrator must explicitly confirm trust.
    op.execute(sa.text("""
        INSERT INTO student_guardian_contacts
            (school_tenant_id, student_id, guardian_name, relationship, phone,
             legacy_slot, source, verification_status, is_primary, active,
             created_at, updated_at)
        SELECT school_tenant_id, id, guardian_name, guardian_relationship, guardian_phone,
               'primary', 'legacy_student_fields', 'unverified', 1, 1,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM students
        WHERE guardian_name IS NOT NULL AND trim(guardian_name) <> ''
    """))
    op.execute(sa.text("""
        INSERT INTO student_guardian_contacts
            (school_tenant_id, student_id, guardian_name, relationship, phone,
             legacy_slot, source, verification_status, is_primary, active,
             created_at, updated_at)
        SELECT school_tenant_id, id, guardian2_name, guardian2_relationship, guardian2_phone,
               'secondary', 'legacy_student_fields', 'unverified', 0, 1,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM students
        WHERE guardian2_name IS NOT NULL AND trim(guardian2_name) <> ''
    """))


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
    op.drop_index("ix_student_guardian_contacts_student_id", table_name="student_guardian_contacts")
    op.drop_index("ix_student_guardian_contacts_school_tenant_id", table_name="student_guardian_contacts")
    op.drop_table("student_guardian_contacts")
    with op.batch_alter_table("staff_members") as batch:
        batch.drop_column("phone_verified_by")
        batch.drop_column("phone_verified_at")
        batch.drop_column("phone_verification_status")
        batch.drop_column("phone_source")
