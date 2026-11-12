"""Add trusted guardian and staff contact verification metadata.

Revision ID: 0036_trusted_school_contacts
Revises: 0035_tenant_scoped_user_identity
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0036_trusted_school_contacts"
down_revision = "0035_tenant_scoped_user_identity"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    # The baseline migration creates missing tables from current ORM metadata.
    # Therefore a fresh database may already have these columns and table.
    if "staff_members" in tables:
        columns = {item["name"] for item in inspector.get_columns("staff_members")}
        additions = (
            ("phone_source", sa.String(40), "legacy_staff_record"),
            ("phone_verification_status", sa.String(20), "unverified"),
            ("phone_verified_at", sa.DateTime(), None),
            ("phone_verified_by", sa.Integer(), None),
        )
        for name, column_type, default in additions:
            if name in columns:
                continue
            column = sa.Column(name, column_type, nullable=default is None)
            if default is not None:
                column.server_default = default
            op.add_column("staff_members", column)

    if "student_guardian_contacts" not in tables:
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
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("school_tenant_id", "student_id", "legacy_slot", name="uq_student_guardian_legacy_slot"),
        )

    inspector = inspect(bind)
    if "student_guardian_contacts" in set(inspector.get_table_names()):
        indexes = {item["name"] for item in inspector.get_indexes("student_guardian_contacts")}
        if "ix_student_guardian_contacts_school_tenant_id" not in indexes:
            op.create_index("ix_student_guardian_contacts_school_tenant_id", "student_guardian_contacts", ["school_tenant_id"])
        if "ix_student_guardian_contacts_student_id" not in indexes:
            op.create_index("ix_student_guardian_contacts_student_id", "student_guardian_contacts", ["student_id"])

    # Older supported databases may not yet contain the legacy guardian fields,
    # or may not have a students table at all. Backfill only when the source
    # columns exist. Boolean literals remain portable across SQLite/PostgreSQL.
    inspector = inspect(bind)
    if "students" in set(inspector.get_table_names()):
        student_columns = {item["name"] for item in inspector.get_columns("students")}
        primary_fields = {"school_tenant_id", "id", "guardian_name", "guardian_relationship", "guardian_phone"}
        if primary_fields <= student_columns:
            op.execute(sa.text("""
                INSERT INTO student_guardian_contacts
                    (school_tenant_id, student_id, guardian_name, relationship, phone,
                     legacy_slot, source, verification_status, is_primary, active,
                     created_at, updated_at)
                SELECT s.school_tenant_id, s.id, s.guardian_name, s.guardian_relationship, s.guardian_phone,
                       'primary', 'legacy_student_fields', 'unverified', TRUE, TRUE,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM students AS s
                WHERE s.guardian_name IS NOT NULL AND trim(s.guardian_name) <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM student_guardian_contacts AS c
                      WHERE c.school_tenant_id = s.school_tenant_id
                        AND c.student_id = s.id AND c.legacy_slot = 'primary'
                  )
            """))
        secondary_fields = {"school_tenant_id", "id", "guardian2_name", "guardian2_relationship", "guardian2_phone"}
        if secondary_fields <= student_columns:
            op.execute(sa.text("""
                INSERT INTO student_guardian_contacts
                    (school_tenant_id, student_id, guardian_name, relationship, phone,
                     legacy_slot, source, verification_status, is_primary, active,
                     created_at, updated_at)
                SELECT s.school_tenant_id, s.id, s.guardian2_name, s.guardian2_relationship, s.guardian2_phone,
                       'secondary', 'legacy_student_fields', 'unverified', FALSE, TRUE,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM students AS s
                WHERE s.guardian2_name IS NOT NULL AND trim(s.guardian2_name) <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM student_guardian_contacts AS c
                      WHERE c.school_tenant_id = s.school_tenant_id
                        AND c.student_id = s.id AND c.legacy_slot = 'secondary'
                  )
            """))


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "student_guardian_contacts" in tables:
        if bind.dialect.name == "sqlite":
            bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
        indexes = {item["name"] for item in inspector.get_indexes("student_guardian_contacts")}
        for name in ("ix_student_guardian_contacts_student_id", "ix_student_guardian_contacts_school_tenant_id"):
            if name in indexes:
                op.drop_index(name, table_name="student_guardian_contacts")
        op.drop_table("student_guardian_contacts")
    if "staff_members" in tables:
        columns = {item["name"] for item in inspect(bind).get_columns("staff_members")}
        with op.batch_alter_table("staff_members") as batch:
            for name in ("phone_verified_by", "phone_verified_at", "phone_verification_status", "phone_source"):
                if name in columns:
                    batch.drop_column(name)
