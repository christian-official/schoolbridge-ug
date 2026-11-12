"""Add tenant ownership keys to every school-owned data table.

Revision ID: 0032_school_tenant_ownership
Revises: 0031_school_tenant_registry
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "0032_school_tenant_ownership"
down_revision = "0031_school_tenant_registry"
branch_labels = None
depends_on = None

# Keep this list explicit: a newly introduced school-owned table must be added
# here before it can participate in hosted multi-school operation.
TENANT_TABLES = (
    "classes", "subjects", "students", "attendance", "exams", "marks",
    "grade_bands", "users", "teacher_assignments", "class_teacher_assignments",
    "school_settings", "staff_members", "fee_charges", "fee_payments",
    "class_fees", "salary_payments", "other_expenses", "audit_logs",
    "school_profile", "parent_student_links", "school_announcements",
    "prefect_assignments", "teacher_duties", "staff_attendance",
    "timetable_entries", "parent_liaison_threads", "parent_liaison_messages",
    "sync_devices", "enrolment_invitations", "sync_change_proposals",
    "sync_changes", "school_setup_state", "school_identity_corrections",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())

    tenant = bind.execute(text(
        "SELECT id FROM school_tenants ORDER BY id LIMIT 1"
    )).first()
    if tenant is None:
        raise RuntimeError(
            "Cannot assign school ownership: the school tenant registry is empty."
        )
    tenant_id = int(tenant[0])

    for table in TENANT_TABLES:
        if table not in existing_tables:
            raise RuntimeError(
                f"Cannot add school ownership to missing table: {table}"
            )
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if "school_tenant_id" not in columns:
            op.add_column(
                table,
                sa.Column(
                    "school_tenant_id",
                    sa.Integer(),
                    nullable=False,
                    server_default=str(tenant_id),
                ),
            )
        bind.execute(
            text(f'UPDATE "{table}" SET school_tenant_id = :tenant_id '
                 "WHERE school_tenant_id IS NULL"),
            {"tenant_id": tenant_id},
        )
        index_name = f"ix_{table}_school_tenant_id"
        indexes = {item["name"] for item in inspect(bind).get_indexes(table)}
        if index_name not in indexes:
            op.create_index(index_name, table, ["school_tenant_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    existing_tables = set(inspect(bind).get_table_names())
    for table in reversed(TENANT_TABLES):
        if table not in existing_tables:
            continue
        indexes = {item["name"] for item in inspect(bind).get_indexes(table)}
        index_name = f"ix_{table}_school_tenant_id"
        if index_name in indexes:
            op.drop_index(index_name, table_name=table)
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        if "school_tenant_id" in columns:
            op.drop_column(table, "school_tenant_id")
