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


def _unique_columns(inspector, table):
    constraints = inspector.get_unique_constraints(table)
    indexes = inspector.get_indexes(table)
    return [
        tuple(item.get("column_names") or ())
        for item in constraints
    ] + [
        tuple(item.get("column_names") or ())
        for item in indexes if item.get("unique")
    ]


def _replace_unique(table, old_columns, new_columns, new_name):
    bind = op.get_bind()
    inspector = inspect(bind)
    if table not in set(inspector.get_table_names()):
        return

    old_columns = tuple(old_columns)
    new_columns = tuple(new_columns)
    constraints = [
        item for item in inspector.get_unique_constraints(table)
        if tuple(item.get("column_names") or ()) == old_columns
    ]
    indexes = [
        item for item in inspector.get_indexes(table)
        if item.get("unique")
        and tuple(item.get("column_names") or ()) == old_columns
    ]
    new_already_exists = new_columns in _unique_columns(inspector, table)
    if not constraints and not indexes and new_already_exists:
        return

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
        if not new_already_exists:
            batch.create_unique_constraint(new_name, list(new_columns))


CHANGES = [
    ("classes", ("name", "section"), ("school_tenant_id", "name", "section"), "uq_classes_tenant_name_section", "uq_classes_name_section"),
    ("subjects", ("name", "school_type"), ("school_tenant_id", "name", "school_type"), "uq_subjects_tenant_name_school_type", "uq_subjects_name_school_type"),
    ("attendance", ("student_id", "attendance_date"), ("school_tenant_id", "student_id", "attendance_date"), "uq_attendance_tenant_student_date", "uq_attendance_student_id"),
    ("marks", ("student_id", "subject_id", "exam_id"), ("school_tenant_id", "student_id", "subject_id", "exam_id"), "uq_marks_tenant_student_subject_exam", "uq_marks_student_id"),
    ("grade_bands", ("grade",), ("school_tenant_id", "grade"), "uq_grade_bands_tenant_grade", "uq_grade_bands_grade"),
    ("teacher_assignments", ("teacher_id", "class_id", "subject_id"), ("school_tenant_id", "teacher_id", "class_id", "subject_id"), "uq_teacher_assignments_tenant_teacher_class_subject", "uq_teacher_assignments_teacher_id"),
    ("class_teacher_assignments", ("class_id",), ("school_tenant_id", "class_id"), "uq_class_teacher_tenant_class", "uq_class_teacher_class"),
    ("fee_charges", ("student_id", "term", "year"), ("school_tenant_id", "student_id", "term", "year"), "uq_fee_charges_tenant_student_term_year", "uq_fee_charges_student_id"),
    ("class_fees", ("class_id", "term", "year"), ("school_tenant_id", "class_id", "term", "year"), "uq_class_fees_tenant_class_term_year", "uq_class_fees_class_id"),
    ("parent_student_links", ("user_id", "student_id"), ("school_tenant_id", "user_id", "student_id"), "uq_parent_student_tenant_user_student", "uq_parent_student_link"),
    ("teacher_duties", ("duty_date",), ("school_tenant_id", "duty_date"), "uq_teacher_duties_tenant_date", "uq_teacher_duties_duty_date"),
    ("staff_attendance", ("staff_id", "attendance_date"), ("school_tenant_id", "staff_id", "attendance_date"), "uq_staff_attendance_tenant_staff_date", "uq_staff_attendance_staff_id"),
    ("timetable_entries", ("class_id", "day_of_week", "start_time"), ("school_tenant_id", "class_id", "day_of_week", "start_time"), "uq_timetable_tenant_class_day_start", "uq_timetable_entries_class_id"),
    ("sync_devices", ("user_id", "device_id"), ("school_tenant_id", "user_id", "device_id"), "uq_sync_devices_user_device", "uq_sync_devices_user_device"),
    ("sync_change_proposals", ("user_id", "idempotency_key"), ("school_tenant_id", "user_id", "idempotency_key"), "uq_sync_proposal_tenant_user_key", "uq_sync_proposal_user_key"),
    ("students", ("admission_number",), ("school_tenant_id", "admission_number"), "uq_students_tenant_admission_number", "uq_students_admission_number"),
    ("staff_members", ("staff_number",), ("school_tenant_id", "staff_number"), "uq_staff_members_tenant_staff_number", "uq_staff_members_staff_number"),
    ("fee_payments", ("receipt_number",), ("school_tenant_id", "receipt_number"), "uq_fee_payments_tenant_receipt_number", "uq_fee_payments_receipt_number"),
]


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # Keep FK checks deferred while SQLite rebuilds tables that may be
        # referenced by other school-owned tables in the same migration.
        bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
    for table, old_columns, new_columns, new_name, _old_name in CHANGES:
        _replace_unique(table, old_columns, new_columns, new_name)


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
    inspector = inspect(bind)
    for table, old_columns, new_columns, _new_name, old_name in reversed(CHANGES):
        if table not in set(inspector.get_table_names()):
            continue
        # Reverting to global uniqueness is safe only when no two tenants have
        # adopted the same identifier. Never discard or rewrite school data.
        grouped = ", ".join(f'"{column}"' for column in old_columns)
        non_null = " AND ".join(f'"{column}" IS NOT NULL' for column in old_columns)
        duplicate = bind.exec_driver_sql(
            f'SELECT 1 FROM "{table}" WHERE {non_null} '
            f'GROUP BY {grouped} HAVING COUNT(*) > 1 LIMIT 1'
        ).first()
        if duplicate:
            raise RuntimeError(
                f"Cannot restore global uniqueness for {table}: "
                "multiple schools now use the same identifier."
            )
        _replace_unique(table, new_columns, old_columns, old_name)


