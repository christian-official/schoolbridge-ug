from datetime import date, datetime
from sqlalchemy import (
    String, Integer, Date, DateTime, Text, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class SchoolClass(Base):
    __tablename__ = "classes"
    __table_args__ = (UniqueConstraint("name", "section", name="uq_classes_name_section"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), index=True)
    section: Mapped[str] = mapped_column(String(40), default="")


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (UniqueConstraint("name", "school_type", name="uq_subjects_name_school_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    school_type: Mapped[str] = mapped_column(String(20), default="Secondary", nullable=False)


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    admission_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id"), nullable=True)
    middle_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    religion: Mapped[str | None] = mapped_column(String(60), nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(60), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    guardian_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    guardian_relationship: Mapped[str | None] = mapped_column(String(60), nullable=True)
    guardian_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    previous_school: Mapped[str | None] = mapped_column(String(160), nullable=True)
    admission_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    academic_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    combination: Mapped[str | None] = mapped_column(String(100), nullable=True)
    optional_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    subsidiary_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    guardian2_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    guardian2_relationship: Mapped[str | None] = mapped_column(String(60), nullable=True)
    guardian2_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    study_mode: Mapped[str] = mapped_column(String(20), default="Day", server_default="Day", nullable=False)
    house: Mapped[str | None] = mapped_column(String(80), nullable=True)
    photo_data: Mapped[str | None] = mapped_column(Text, nullable=True)


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("student_id", "attendance_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    attendance_date: Mapped[date] = mapped_column(Date, default=date.today)
    status: Mapped[str] = mapped_column(String(20))


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    term: Mapped[str] = mapped_column(String(40))
    year: Mapped[int] = mapped_column(Integer)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id"), nullable=True, index=True)
    exam_type: Mapped[str] = mapped_column(String(40), nullable=False, default="Other", server_default="Other")


class Mark(Base):
    __tablename__ = "marks"
    __table_args__ = (
        UniqueConstraint("student_id", "subject_id", "exam_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"))
    score: Mapped[float]
    verified: Mapped[bool] = mapped_column(default=False, nullable=False)


class GradeBand(Base):
    __tablename__ = "grade_bands"
    __table_args__ = (UniqueConstraint("grade"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    grade: Mapped[str] = mapped_column(String(20), unique=True)
    min_score: Mapped[float]
    max_score: Mapped[float]
    remark: Mapped[str] = mapped_column(String(100), default="")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="teacher")
    role_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    permissions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff_members.id"), unique=True, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    reset_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reset_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reset_attempts: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)
    must_change_password: Mapped[bool] = mapped_column(default=False, server_default="0", nullable=False)


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (
        UniqueConstraint("teacher_id", "class_id", "subject_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))


class ClassTeacherAssignment(Base):
    __tablename__ = "class_teacher_assignments"
    __table_args__ = (UniqueConstraint("class_id", name="uq_class_teacher_class"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), index=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolSettings(Base):
    __tablename__ = "school_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    admission_prefix: Mapped[str] = mapped_column(String(20), default="SB")
    include_year: Mapped[bool] = mapped_column(default=True)
    admission_separator: Mapped[str] = mapped_column(String(5), default="-")
    admission_padding: Mapped[int] = mapped_column(Integer, default=4)
    next_admission_number: Mapped[int] = mapped_column(Integer, default=1)
    academic_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_term: Mapped[str] = mapped_column(String(20), default="Term 1")

class StaffMember(Base):
    __tablename__ = "staff_members"
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(30), default="Teaching")
    position: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    salary_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_frequency: Mapped[str] = mapped_column(String(20), default="Monthly")
    subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    house: Mapped[str | None] = mapped_column(String(80), nullable=True)
    photo_data: Mapped[str | None] = mapped_column(Text, nullable=True)

class FeeCharge(Base):
    __tablename__ = "fee_charges"
    __table_args__ = (UniqueConstraint("student_id", "term", "year"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    term: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(160), default="Tuition fees")

class FeePayment(Base):
    __tablename__ = "fee_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    charge_id: Mapped[int] = mapped_column(ForeignKey("fee_charges.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    payment_date: Mapped[date] = mapped_column(Date, default=date.today)
    method: Mapped[str] = mapped_column(String(30), default="Cash")
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    received_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    receipt_number: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)


class ClassFee(Base):
    __tablename__ = "class_fees"
    __table_args__ = (UniqueConstraint("class_id", "term", "year"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), index=True)
    term: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    boarding_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)


class SalaryPayment(Base):
    __tablename__ = "salary_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff_members.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    payment_date: Mapped[date] = mapped_column(Date, default=date.today)
    period: Mapped[str] = mapped_column(String(40))
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)


class OtherExpense(Base):
    __tablename__ = "other_expenses"
    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(60), default="General")
    amount: Mapped[int] = mapped_column(Integer)
    expense_date: Mapped[date] = mapped_column(Date, default=date.today)
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_username: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(40))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int]
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolProfile(Base):
    __tablename__ = "school_profile"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), default="My School")
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    motto: Mapped[str | None] = mapped_column(String(200), nullable=True)
    school_type: Mapped[str] = mapped_column(String(20), default="Secondary")
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    school_structure: Mapped[str | None] = mapped_column(String(20), nullable=True)
    a_level_combinations: Mapped[str | None] = mapped_column(Text, nullable=True)
    o_level_optional_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    a_level_subsidiary_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    house_names: Mapped[str | None] = mapped_column(Text, nullable=True)


class ParentStudentLink(Base):
    __tablename__ = "parent_student_links"
    __table_args__ = (UniqueConstraint("user_id", "student_id", name="uq_parent_student_link"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolAnnouncement(Base):
    __tablename__ = "school_announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    audience: Mapped[str] = mapped_column(String(20), default="All")
    published: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PrefectAssignment(Base):
    __tablename__ = "prefect_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    position: Mapped[str] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date, default=date.today)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(default=True)


class TeacherDuty(Base):
    __tablename__ = "teacher_duties"
    __table_args__ = (UniqueConstraint("duty_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff_members.id"), index=True)
    duty_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

class StaffAttendance(Base):
    __tablename__ = "staff_attendance"
    __table_args__ = (UniqueConstraint("staff_id", "attendance_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff_members.id"), index=True)
    attendance_date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    status: Mapped[str] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    check_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    check_out_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TimetableEntry(Base):
    __tablename__ = "timetable_entries"
    __table_args__ = (UniqueConstraint("class_id", "day_of_week", "start_time"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), index=True)
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subjects.id"), nullable=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff_members.id"), nullable=True)
    day_of_week: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[str] = mapped_column(String(5))
    end_time: Mapped[str] = mapped_column(String(5))
    room: Mapped[str | None] = mapped_column(String(60), nullable=True)


class ParentLiaisonThread(Base):
    __tablename__ = "parent_liaison_threads"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    parent_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    initiated_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    subject: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(40), default="General enquiry")
    status: Mapped[str] = mapped_column(String(20), default="Open")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ParentLiaisonMessage(Base):
    __tablename__ = "parent_liaison_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("parent_liaison_threads.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SyncDevice(Base):
    __tablename__ = "sync_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_sync_devices_user_device"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(36), nullable=False)
    device_name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_sync_sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_issued_sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)



class SyncChangeProposal(Base):
    """Audited offline proposal; never applied directly to live records."""
    __tablename__ = "sync_change_proposals"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_sync_proposal_user_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operation: Mapped[str] = mapped_column(String(10), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    base_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending_review")
    conflict_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(20), nullable=True)


class SyncChange(Base):
    """Append-only metadata journal; record contents remain on the authoritative server."""
    __tablename__ = "sync_changes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    operation: Mapped[str] = mapped_column(String(10), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    scope_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}", nullable=False)


class SchoolSetupState(Base):
    """Persistent installation activation and first-time setup state."""
    __tablename__ = "school_setup_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activation_license_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    activation_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    activation_locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    setup_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    original_identity_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class SchoolIdentityCorrection(Base):
    """One-time owner-authorised change to a protected school identity."""
    __tablename__ = "school_identity_corrections"

    id: Mapped[int] = mapped_column(primary_key=True)
    license_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    license_id: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    old_identity_json: Mapped[str] = mapped_column(Text, nullable=False)
    new_identity_json: Mapped[str] = mapped_column(Text, nullable=False)
    corrected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
