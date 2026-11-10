"""Database-level ORM hooks for an append-only, permission-scoped sync journal."""
import json
from datetime import datetime
from sqlalchemy import event, select, inspect as sa_inspect
from . import models

_TRACKED_MODELS = (
    models.User, models.Student, models.SchoolClass, models.Subject, models.StaffMember,
    models.TeacherAssignment, models.ClassTeacherAssignment, models.ParentStudentLink,
    models.Attendance, models.StaffAttendance, models.Exam, models.Mark,
    models.FeeCharge, models.FeePayment, models.ClassFee, models.SalaryPayment,
    models.OtherExpense, models.TimetableEntry,
)

def _scope_for_target(connection, target):
    scope = {"class_ids": set(), "student_ids": set(), "subject_ids": set(),
             "parent_user_ids": set(), "teacher_user_ids": set(), "staff_ids": set(),
             "finance_only": False, "verified": None}
    def add_staff(staff_id):
        if not staff_id: return
        scope["staff_ids"].add(int(staff_id))
        rows = connection.execute(select(models.User.id).where(models.User.staff_id == staff_id)).all()
        scope["teacher_user_ids"].update(int(row[0]) for row in rows)
    def add_subject(subject_id):
        if not subject_id: return
        scope["subject_ids"].add(int(subject_id))
        rows = connection.execute(select(models.TeacherAssignment.teacher_id).where(models.TeacherAssignment.subject_id == subject_id)).all()
        scope["teacher_user_ids"].update(int(row[0]) for row in rows)
    def add_student(student_id, class_hint=None):
        if not student_id: return
        scope["student_ids"].add(int(student_id))
        row = connection.execute(select(models.Student.class_id).where(models.Student.id == student_id)).first()
        class_id = row[0] if row else class_hint
        if class_id: add_class(class_id, include_students=False)
        parents = connection.execute(select(models.ParentStudentLink.user_id).where(models.ParentStudentLink.student_id == student_id)).all()
        scope["parent_user_ids"].update(int(item[0]) for item in parents)
    def add_class(class_id, include_students=True):
        if not class_id: return
        scope["class_ids"].add(int(class_id))
        teachers = connection.execute(select(models.TeacherAssignment.teacher_id).where(models.TeacherAssignment.class_id == class_id)).all()
        scope["teacher_user_ids"].update(int(item[0]) for item in teachers)
        class_teachers = connection.execute(select(models.ClassTeacherAssignment.teacher_id).where(models.ClassTeacherAssignment.class_id == class_id)).all()
        scope["teacher_user_ids"].update(int(item[0]) for item in class_teachers)
        if include_students:
            students = connection.execute(select(models.Student.id).where(models.Student.class_id == class_id)).all()
            for item in students: add_student(item[0], class_id)
    if isinstance(target, models.User):
        scope["teacher_user_ids"].add(int(target.id))
    elif isinstance(target, models.Student):
        add_student(target.id, target.class_id)
        try:
            history = sa_inspect(target).attrs.class_id.history
            for class_id in list(history.deleted) + list(history.added): add_class(class_id)
        except Exception: pass
    elif isinstance(target, models.ParentStudentLink):
        scope["parent_user_ids"].add(int(target.user_id)); add_student(target.student_id)
    elif isinstance(target, models.TeacherAssignment):
        scope["teacher_user_ids"].add(int(target.teacher_id)); add_class(target.class_id); add_subject(target.subject_id)
    elif isinstance(target, models.ClassTeacherAssignment):
        scope["teacher_user_ids"].add(int(target.teacher_id)); add_class(target.class_id)
    elif isinstance(target, models.SchoolClass): add_class(target.id)
    elif isinstance(target, models.Subject): add_subject(target.id)
    elif isinstance(target, models.Attendance): add_student(target.student_id)
    elif isinstance(target, models.Exam): add_class(target.class_id)
    elif isinstance(target, models.Mark):
        add_student(target.student_id); add_subject(target.subject_id); scope["verified"] = bool(target.verified)
    elif isinstance(target, models.FeeCharge): add_student(target.student_id)
    elif isinstance(target, models.FeePayment):
        charge = connection.execute(select(models.FeeCharge.student_id).where(models.FeeCharge.id == target.charge_id)).first()
        if charge: add_student(charge[0])
    elif isinstance(target, models.ClassFee): add_class(target.class_id)
    elif isinstance(target, models.StaffMember): add_staff(target.id)
    elif isinstance(target, (models.StaffAttendance, models.SalaryPayment)): add_staff(target.staff_id)
    elif isinstance(target, models.TimetableEntry):
        add_class(target.class_id); add_subject(target.subject_id); add_staff(target.staff_id)
    elif isinstance(target, models.OtherExpense): scope["finance_only"] = True
    return {key: sorted(value) if isinstance(value, set) else value for key, value in scope.items()}

def register_sync_tracking() -> None:
    """Record entity metadata and historical access scopes, never record contents."""
    if getattr(register_sync_tracking, "_registered", False): return
    def record(operation):
        def listener(mapper, connection, target):
            scope = _scope_for_target(connection, target)
            common = {"entity_id": target.id, "operation": operation,
                      "changed_at": datetime.utcnow(),
                      "scope_json": json.dumps(scope, sort_keys=True, separators=(",", ":"))}
            entity_type = "UserAccess" if isinstance(target, models.User) else target.__class__.__name__
            connection.execute(models.SyncChange.__table__.insert().values(entity_type=entity_type, **common))
            if isinstance(target, models.Attendance):
                connection.execute(models.SyncChange.__table__.insert().values(
                    entity_type=f"AttendanceScope:{target.attendance_date.isoformat()}",
                    entity_id=target.student_id, operation=operation,
                    changed_at=datetime.utcnow(),
                    scope_json=json.dumps(scope, sort_keys=True, separators=(",", ":"))))
            if isinstance(target, models.Mark):
                # Parents may already have cached a verified mark. When an
                # administrator revokes verification, publish a scoped delete
                # invalidation so the parent's offline copy can remove it.
                verified_history = sa_inspect(target).attrs.verified.history
                was_verified = any(bool(value) for value in verified_history.deleted)
                parent_scope = dict(scope)
                parent_scope["verified"] = bool(target.verified or was_verified)
                parent_operation = (
                    "delete" if was_verified and not target.verified else operation
                )
                connection.execute(models.SyncChange.__table__.insert().values(
                    entity_type=f"MarkScope:{target.exam_id}:{target.subject_id}",
                    entity_id=target.student_id, operation=parent_operation,
                    changed_at=datetime.utcnow(),
                    scope_json=json.dumps(parent_scope, sort_keys=True, separators=(",", ":"))))
        return listener
    for model in _TRACKED_MODELS:
        event.listen(model, "after_insert", record("insert"))
        event.listen(model, "after_update", record("update"))
        event.listen(model, "after_delete", record("delete"))
    register_sync_tracking._registered = True
