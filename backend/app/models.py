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
    is_active: Mapped[bool] = mapped_column(default=True)


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (
        UniqueConstraint("teacher_id", "class_id", "subject_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))


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
    a_level_combinations: Mapped[str | None] = mapped_column(Text, nullable=True)
    o_level_optional_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    a_level_subsidiary_subjects: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_template: Mapped[str | None] = mapped_column(Text, nullable=True)


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
