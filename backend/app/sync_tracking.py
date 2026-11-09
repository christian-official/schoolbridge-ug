"""Database-level ORM hooks for the append-only sync change journal."""
from datetime import datetime

from sqlalchemy import event

from . import models


_TRACKED_MODELS = (
    models.Student,
    models.SchoolClass,
    models.Subject,
    models.StaffMember,
    models.Attendance,
    models.StaffAttendance,
    models.Exam,
    models.Mark,
    models.FeeCharge,
    models.FeePayment,
    models.ClassFee,
    models.SalaryPayment,
    models.OtherExpense,
    models.TimetableEntry,
)


def register_sync_tracking() -> None:
    """Register mapper hooks once; metadata only is written, never record contents."""
    if getattr(register_sync_tracking, "_registered", False):
        return

    def record(operation):
        def listener(mapper, connection, target):
            connection.execute(
                models.SyncChange.__table__.insert().values(
                    entity_type=target.__class__.__name__,
                    entity_id=target.id,
                    operation=operation,
                    changed_at=datetime.utcnow(),
                )
            )
        return listener

    for model in _TRACKED_MODELS:
        event.listen(model, "after_insert", record("insert"))
        event.listen(model, "after_update", record("update"))
        event.listen(model, "after_delete", record("delete"))

    register_sync_tracking._registered = True
