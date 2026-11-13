from datetime import date, datetime
from sqlalchemy import (
    String, Integer, Date, DateTime, Text, ForeignKey, UniqueConstraint, Index, Boolean
)
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class SchoolClass(Base):
    __tablename__ = "classes"
    __table_args__ = (UniqueConstraint("school_tenant_id", "name", "section", name="uq_classes_tenant_name_section"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), index=True)
    section: Mapped[str] = mapped_column(String(40), default="")


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (UniqueConstraint("school_tenant_id", "name", "school_type", name="uq_subjects_tenant_name_school_type"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    school_type: Mapped[str] = mapped_column(String(20), default="Secondary", nullable=False)


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("school_tenant_id", "admission_number", name="uq_students_tenant_admission_number"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    admission_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
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


class StudentGuardianContact(Base):
    __tablename__ = "student_guardian_contacts"
    __table_args__ = (
        UniqueConstraint(
            "school_tenant_id", "student_id", "legacy_slot",
            name="uq_student_guardian_legacy_slot",
        ),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    guardian_name: Mapped[str] = mapped_column(String(160))
    relationship: Mapped[str | None] = mapped_column(String(60), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    legacy_slot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str] = mapped_column(String(40), default="school_record", server_default="school_record")
    verification_status: Mapped[str] = mapped_column(String(20), default="unverified", server_default="unverified")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("school_tenant_id", "student_id", "attendance_date", name="uq_attendance_tenant_student_date"),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    attendance_date: Mapped[date] = mapped_column(Date, default=date.today)
    status: Mapped[str] = mapped_column(String(20))


class Exam(Base):
    __tablename__ = "exams"

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    term: Mapped[str] = mapped_column(String(40))
    year: Mapped[int] = mapped_column(Integer)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id"), nullable=True, index=True)
    exam_type: Mapped[str] = mapped_column(String(40), nullable=False, default="Other", server_default="Other")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", server_default="draft")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Mark(Base):
    __tablename__ = "marks"
    __table_args__ = (
        UniqueConstraint("school_tenant_id", "student_id", "subject_id", "exam_id", name="uq_marks_tenant_student_subject_exam"),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"))
    score: Mapped[float]
    verified: Mapped[bool] = mapped_column(default=False, nullable=False)


class GradeBand(Base):
    __tablename__ = "grade_bands"
    __table_args__ = (UniqueConstraint("school_tenant_id", "grade", name="uq_grade_bands_tenant_grade"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    grade: Mapped[str] = mapped_column(String(20))
    min_score: Mapped[float]
    max_score: Mapped[float]
    remark: Mapped[str] = mapped_column(String(100), default="")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ux_users_tenant_username", "school_tenant_id", "username", unique=True),
        Index("ux_users_tenant_email", "school_tenant_id", "email", unique=True),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80))
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="teacher")
    role_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    permissions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff_members.id"), unique=True, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    reset_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reset_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reset_attempts: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)
    must_change_password: Mapped[bool] = mapped_column(default=False, server_default="0", nullable=False)


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (
        UniqueConstraint("school_tenant_id", "teacher_id", "class_id", "subject_id", name="uq_teacher_assignments_tenant_teacher_class_subject"),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))


class ClassTeacherAssignment(Base):
    __tablename__ = "class_teacher_assignments"
    __table_args__ = (UniqueConstraint("school_tenant_id", "class_id", name="uq_class_teacher_tenant_class"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), index=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolSettings(Base):
    __tablename__ = "school_settings"
    __table_args__ = (UniqueConstraint("school_tenant_id", name="uq_school_settings_tenant"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
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
    __table_args__ = (UniqueConstraint("school_tenant_id", "staff_number", name="uq_staff_members_tenant_staff_number"),)
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_number: Mapped[str] = mapped_column(String(40))
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(30), default="Teaching")
    position: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    phone_source: Mapped[str] = mapped_column(String(40), default="legacy_staff_record", server_default="legacy_staff_record")
    phone_verification_status: Mapped[str] = mapped_column(String(20), default="unverified", server_default="unverified")
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    phone_verified_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    salary_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_frequency: Mapped[str] = mapped_column(String(20), default="Monthly")
    subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    house: Mapped[str | None] = mapped_column(String(80), nullable=True)
    photo_data: Mapped[str | None] = mapped_column(Text, nullable=True)

class FeeCharge(Base):
    __tablename__ = "fee_charges"
    __table_args__ = (UniqueConstraint("school_tenant_id", "student_id", "term", "year", name="uq_fee_charges_tenant_student_term_year"),)
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    term: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(160), default="Tuition fees")

class FeePayment(Base):
    __tablename__ = "fee_payments"
    __table_args__ = (UniqueConstraint("school_tenant_id", "receipt_number", name="uq_fee_payments_tenant_receipt_number"),)
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    charge_id: Mapped[int] = mapped_column(ForeignKey("fee_charges.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    payment_date: Mapped[date] = mapped_column(Date, default=date.today)
    method: Mapped[str] = mapped_column(String(30), default="Cash")
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    received_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    receipt_number: Mapped[str | None] = mapped_column(String(50), nullable=True)


class ClassFee(Base):
    __tablename__ = "class_fees"
    __table_args__ = (UniqueConstraint("school_tenant_id", "class_id", "term", "year", name="uq_class_fees_tenant_class_term_year"),)
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), index=True)
    term: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    boarding_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)


class SalaryPayment(Base):
    __tablename__ = "salary_payments"
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff_members.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    payment_date: Mapped[date] = mapped_column(Date, default=date.today)
    period: Mapped[str] = mapped_column(String(40))
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)


class OtherExpense(Base):
    __tablename__ = "other_expenses"
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(60), default="General")
    amount: Mapped[int] = mapped_column(Integer)
    expense_date: Mapped[date] = mapped_column(Date, default=date.today)
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
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
    __table_args__ = (UniqueConstraint("school_tenant_id", name="uq_school_profile_tenant"),)
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
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
    __table_args__ = (UniqueConstraint("school_tenant_id", "user_id", "student_id", name="uq_parent_student_tenant_user_student"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SchoolAnnouncement(Base):
    __tablename__ = "school_announcements"

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    audience: Mapped[str] = mapped_column(String(20), default="All")
    published: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PrefectAssignment(Base):
    __tablename__ = "prefect_assignments"

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    position: Mapped[str] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date, default=date.today)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(default=True)


class TeacherDuty(Base):
    __tablename__ = "teacher_duties"
    __table_args__ = (UniqueConstraint("school_tenant_id", "duty_date", name="uq_teacher_duties_tenant_date"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff_members.id"), index=True)
    duty_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

class StaffAttendance(Base):
    __tablename__ = "staff_attendance"
    __table_args__ = (UniqueConstraint("school_tenant_id", "staff_id", "attendance_date", name="uq_staff_attendance_tenant_staff_date"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff_members.id"), index=True)
    attendance_date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    status: Mapped[str] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    check_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    check_out_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TimetableEntry(Base):
    __tablename__ = "timetable_entries"
    __table_args__ = (UniqueConstraint("school_tenant_id", "class_id", "day_of_week", "start_time", name="uq_timetable_tenant_class_day_start"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
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

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
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

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("parent_liaison_threads.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RegistrationClaim(Base):
    __tablename__ = "registration_claims"
    __table_args__ = (
        Index("ix_registration_claims_tenant_status", "school_tenant_id", "status"),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    reference_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    claim_type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), default="pending_review", server_default="pending_review")
    submitted_name: Mapped[str] = mapped_column(String(160))
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    candidate_student_ids_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    candidate_contact_ids_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    candidate_staff_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    phone_masked: Mapped[str | None] = mapped_column(String(40), nullable=True)
    verification_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    requester_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SyncDevice(Base):
    __tablename__ = "sync_devices"
    __table_args__ = (
        UniqueConstraint("school_tenant_id", "user_id", "device_id", name="uq_sync_devices_user_device"),
    )

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(36), nullable=False)
    device_name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_sync_sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_issued_sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)



class EnrolmentInvitation(Base):
    """Single-use, account-bound device enrolment authorisation."""
    __tablename__ = "enrolment_invitations"

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    installation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SyncChangeProposal(Base):
    """Audited offline proposal; never applied directly to live records."""
    __tablename__ = "sync_change_proposals"
    __table_args__ = (UniqueConstraint("school_tenant_id", "user_id", "idempotency_key", name="uq_sync_proposal_tenant_user_key"),)
    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
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

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    operation: Mapped[str] = mapped_column(String(10), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    scope_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}", nullable=False)


class SchoolSetupState(Base):
    """Persistent installation activation and first-time setup state."""
    __tablename__ = "school_setup_state"
    __table_args__ = (UniqueConstraint("school_tenant_id", name="uq_school_setup_state_tenant"),)

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activation_license_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    activation_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    activation_locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activation_challenge_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    activation_challenge_options_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    activation_correct_option_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    machine_binding_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    setup_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    original_identity_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class SchoolIdentityCorrection(Base):
    """One-time owner-authorised change to a protected school identity."""
    __tablename__ = "school_identity_corrections"

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    license_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    license_id: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    old_identity_json: Mapped[str] = mapped_column(Text, nullable=False)
    new_identity_json: Mapped[str] = mapped_column(Text, nullable=False)
    corrected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

class SchoolMachineTransfer(Base):
    """One-time developer-authorised transfer of an installation to another computer."""
    __tablename__ = "school_machine_transfers"

    school_tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    license_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    license_id: Mapped[str] = mapped_column(String(100), nullable=False)
    previous_machine_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    new_machine_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    transferred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

class SchoolTenant(Base):
    """Stable tenant identity for one school in a shared SchoolBridge service.

    Installation identity remains separate: one school tenant may have one or
    more offline installations/devices, while public_id is the non-secret
    identifier used for school discovery.
    """
    __tablename__ = "school_tenants"
    __table_args__ = (
        UniqueConstraint("public_id", name="uq_school_tenants_public_id"),
        UniqueConstraint("installation_id", name="uq_school_tenants_installation_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    installation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, default="My School")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending_setup")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
