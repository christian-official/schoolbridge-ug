"""Make school business identifiers unique within each tenant.

Revision ID: 0033_tenant_scoped_uniqueness
Revises: 0032_school_tenant_ownership
"""
from alembic import op
from sqlalchemy import inspect

revision = "0033_tenant_scoped_uniqueness"
down_revision = "0032_school_tenant_ownership"
branch_labels = None
depends_on = None


def _replace_unique(table, old_columns, new_columns, new_name, as_index=False):
    bind = op.get_bind()
    inspector = inspect(bind)
    if table not in set(inspector.get_table_names()):
        return

    old_columns = tuple(old_columns)
    new_columns = list(new_columns)
    constraints = [
        item for item in inspector.get_unique_constraints(table)
        if tuple(item.get("column_names") or ()) == old_columns
    ]
    indexes = [
        item for item in inspector.get_indexes(table)
        if item.get("unique")
        and tuple(item.get("column_names") or ()) == old_columns
    ]

    # Batch recreation is required by SQLite to safely replace existing
    # unique constraints. Naming convention gives legacy unnamed SQLite
    # constraints a stable name for removal.
    naming = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table(
        table,
        recreate="always" if bind.dialect.name == "sqlite" else "auto",
        naming_convention=naming,
    ) as batch:
        for item in constraints:
            name = item.get("name") or f"uq_{table}_{old_columns[0]}"
            batch.drop_constraint(name, type_="unique")
        for item in indexes:
            batch.drop_index(item["name"])
        if as_index:
            batch.create_index(new_name, new_columns, unique=True)
        else:
            batch.create_unique_constraint(new_name, new_columns)


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # Keep FK checks deferred while SQLite rebuilds tables that may be
        # referenced by other school-owned tables in the same migration.
        bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")

    constraint_changes = [
        ("classes", ("name", "section"), ("school_tenant_id", "name", "section"), "uq_classes_tenant_name_section"),
        ("subjects", ("name", "school_type"), ("school_tenant_id", "name", "school_type"), "uq_subjects_tenant_name_school_type"),
        ("attendance", ("student_id", "attendance_date"), ("school_tenant_id", "student_id", "attendance_date"), "uq_attendance_tenant_student_date"),
        ("marks", ("student_id", "subject_id", "exam_id"), ("school_tenant_id", "student_id", "subject_id", "exam_id"), "uq_marks_tenant_student_subject_exam"),
        ("grade_bands", ("grade",), ("school_tenant_id", "grade"), "uq_grade_bands_tenant_grade"),
        ("teacher_assignments", ("teacher_id", "class_id", "subject_id"), ("school_tenant_id", "teacher_id", "class_id", "subject_id"), "uq_teacher_assignments_tenant_teacher_class_subject"),
        ("class_teacher_assignments", ("class_id",), ("school_tenant_id", "class_id"), "uq_class_teacher_tenant_class"),
        ("fee_charges", ("student_id", "term", "year"), ("school_tenant_id", "student_id", "term", "year"), "uq_fee_charges_tenant_student_term_year"),
        ("class_fees", ("class_id", "term", "year"), ("school_tenant_id", "class_id", "term", "year"), "uq_class_fees_tenant_class_term_year"),
        ("parent_student_links", ("user_id", "student_id"), ("school_tenant_id", "user_id", "student_id"), "uq_parent_student_tenant_user_student"),
        ("teacher_duties", ("duty_date",), ("school_tenant_id", "duty_date"), "uq_teacher_duties_tenant_date"),
        ("staff_attendance", ("staff_id", "attendance_date"), ("school_tenant_id", "staff_id", "attendance_date"), "uq_staff_attendance_tenant_staff_date"),
        ("timetable_entries", ("class_id", "day_of_week", "start_time"), ("school_tenant_id", "class_id", "day_of_week", "start_time"), "uq_timetable_tenant_class_day_start"),
        ("sync_devices", ("user_id", "device_id"), ("school_tenant_id", "user_id", "device_id"), "uq_sync_devices_tenant_user_device"),
        ("sync_change_proposals", ("user_id", "idempotency_key"), ("school_tenant_id", "user_id", "idempotency_key"), "uq_sync_proposal_tenant_user_key"),
    ]
    for change in constraint_changes:
        _replace_unique(*change)

    # These fields were declared as unique indexes rather than table
    # constraints. Replace each with a tenant-leading unique index.
    index_changes = [
        ("students", ("admission_number",), ("school_tenant_id", "admission_number"), "ux_students_tenant_admission_number"),
        ("staff_members", ("staff_number",), ("school_tenant_id", "staff_number"), "ux_staff_members_tenant_staff_number"),
        ("fee_payments", ("receipt_number",), ("school_tenant_id", "receipt_number"), "ux_fee_payments_tenant_receipt_number"),
    ]
    for table, old_columns, new_columns, new_name in index_changes:
        _replace_unique(table, old_columns, new_columns, new_name, as_index=True)


def downgrade():
    raise RuntimeError(
        "Tenant-scoped uniqueness is intentionally forward-only: restoring "
        "global uniqueness could make valid records from different schools "
        "conflict and must be handled by a reviewed data migration."
    )
