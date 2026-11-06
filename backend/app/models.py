from datetime import date, datetime
from sqlalchemy import (
    String, Integer, Date, DateTime, ForeignKey, UniqueConstraint, Boolean, Text
)
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class SchoolClass(Base):
    __tablename__ = "classes"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    section: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)


class Student(Base):
    __tablename__ = "students"
    id: Mapped[int] = mapped_column(primary_key=True)
    admission_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(80), index=True)
    last_name: Mapped[str] = mapped_column(String(80), index=True)
    middle_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    religion: Mapped[str | None] = mapped_column(String(60), nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(60), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    guardian_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    guardian_relationship: Mapped[str | None] = mapped_column(String(60), nullable=True)
    guardian_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    previous_school: Mapped[str | None] = mapped_column(String(160), nullable=True)
    admission_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id"), nullable=True)


class StaffMember(Base):
    __tablename__ = "staff_members"
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(80), index=True)
    last_name: Mapped[str] = mapped_column(String(80), index=True)
    category: Mapped[str] = mapped_column(String(30), default="Teaching", index=True)
    job_title: Mapped[str] = mapped_column(String(100))
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    employment_status: Mapped[str] = mapped_column(String(30), default="Active")


class FeeStructure(Base):
    __tablename__ = "fee_structures"
    __table_args__ = (UniqueConstraint("class_id", "academic_year", "term"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"))
    academic_year: Mapped[int] = mapped_column(Integer, index=True)
    term: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(String(160), default="Tuition and school fees")


class FeeCharge(Base):
    __tablename__ = "fee_charges"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    academic_year: Mapped[int] = mapped_column(Integer, index=True)
    term: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(String(160))
    amount: Mapped[float] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FeePayment(Base):
    __tablename__ = "fee_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    academic_year: Mapped[int] = mapped_column(Integer, index=True)
    term: Mapped[str] = mapped_column(String(20))
    amount: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(40), default="Cash")
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True)
    received_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("student_id", "attendance_date"),)
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


class Mark(Base):
    __tablename__ = "marks"
    __table_args__ = (UniqueConstraint("student_id", "subject_id", "exam_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"))
    score: Mapped[float]


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="teacher")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (UniqueConstraint("teacher_id", "class_id", "subject_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))


class SchoolSettings(Base):
    __tablename__ = "school_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    admission_prefix: Mapped[str] = mapped_column(String(20), default="SB")
    include_year: Mapped[bool] = mapped_column(Boolean, default=True)
    admission_separator: Mapped[str] = mapped_column(String(5), default="-")
    admission_padding: Mapped[int] = mapped_column(Integer, default=4)
    next_admission_number: Mapped[int] = mapped_column(Integer, default=1)
