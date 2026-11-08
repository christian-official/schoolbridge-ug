import os
import json
import re
import secrets
import smtplib
from email.message import EmailMessage
from datetime import date, datetime
from uuid import uuid4
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import update, func, or_

from .database import DATABASE_URL, Base, engine, get_db, SessionLocal
from .migrations import upgrade_database
from . import models

from dotenv import load_dotenv
import jwt
from datetime import timedelta, timezone
from pwdlib import PasswordHash
from jwt.exceptions import InvalidTokenError
from fastapi import Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

load_dotenv()
password_hash = PasswordHash.recommended()
JWT_SECRET = os.environ["SCHOOLBRIDGE_SECRET_KEY"]
JWT_ALGORITHM = "HS256"
TOKEN_HOURS = 8
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (InvalidTokenError, ValueError, KeyError, TypeError):
        raise HTTPException(401, "Invalid or expired login token.")
    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Account is unavailable.")
    return user


PERMISSION_SECTIONS = {
    "Overview", "Students", "Staff", "Fees & Finance", "Examinations",
    "Attendance", "Staff Attendance", "Timetable", "Leadership & Duty",
    "Parent Access", "Announcements", "Reports", "Settings",
    "My Classes", "My Attendance", "My Results",
}
PERMISSION_ACTIONS = {"view", "add", "edit", "delete", "approve", "print"}
ADMIN_ONLY_PATHS = {
    "/api/auth/users", "/api/auth/teachers", "/api/auth/permissions",
    "/api/teacher-assignments",
}


def user_permissions(user):
    if user.role == "admin":
        return {section: set(PERMISSION_ACTIONS) for section in PERMISSION_SECTIONS}
    try:
        raw = json.loads(user.permissions_json or "{}")
    except (TypeError, ValueError):
        raw = {}
    clean = {}
    if isinstance(raw, dict):
        for section, actions in raw.items():
            if section in PERMISSION_SECTIONS and isinstance(actions, list):
                clean[section] = set(actions) & PERMISSION_ACTIONS
    if user.role == "teacher" and not clean:
        clean = {
            "My Classes": {"view"}, "Attendance": {"view", "add"},
            "My Attendance": {"view"}, "My Results": {"view", "add", "edit"},
            "Announcements": {"view"},
        }
    return clean


def permission_for_path(path: str):
    if path.startswith("/api/teacher/my-assignments") or path.startswith("/api/teacher/students"): return "My Classes"
    if path.startswith("/api/teacher/my-staff-attendance"): return "My Attendance"
    if path.startswith("/api/teacher/attendance"): return "Attendance"
    if path.startswith(("/api/teacher/marks", "/api/teacher/exams")): return "My Results"
    if path.startswith("/api/students"): return "Students"
    if path.startswith("/api/staff"): return "Staff"
    if path.startswith(("/api/finance", "/api/fees", "/api/salary", "/api/expenses")): return "Fees & Finance"
    if path.startswith(("/api/exams", "/api/marks", "/api/grades", "/api/subjects", "/api/grading-scale")): return "Examinations"
    if path.startswith("/api/attendance"): return "Attendance"
    if path.startswith("/api/staff-attendance"): return "Staff Attendance"
    if path.startswith("/api/timetable"): return "Timetable"
    if path.startswith(("/api/leadership", "/api/prefects", "/api/teacher-duties")): return "Leadership & Duty"
    if path.startswith("/api/parent-accounts"): return "Parent Access"
    if path.startswith("/api/announcements"): return "Announcements"
    if path.startswith("/api/reports"): return "Reports"
    if path.startswith(("/api/settings", "/api/backups", "/api/audit-logs")): return "Settings"
    if path.startswith("/api/dashboard"): return "Overview"
    if path.startswith("/api/classes"): return "Students"
    return None


def action_for_method(method: str):
    return {"GET": "view", "POST": "add", "PUT": "edit", "PATCH": "edit", "DELETE": "delete"}.get(method, "view")


def require_admin(request: Request, user=Depends(get_current_user)):
    path = request.url.path
    if user.role == "admin":
        return user
    if path in ADMIN_ONLY_PATHS or path.startswith("/api/auth/"):
        raise HTTPException(403, "Administrator permission required.")
    section = permission_for_path(path)
    action = action_for_method(request.method)
    if not section or action not in user_permissions(user).get(section, set()):
        raise HTTPException(403, "You do not have permission to perform this action.")
    return user


def apply_pending_database_restore():
    """Apply a validated restore before SQLAlchemy opens the database at startup."""
    import os, sqlite3
    if engine.dialect.name != "sqlite":
        return
    db_path = engine.url.database
    if not db_path or db_path == ":memory:":
        return
    absolute_path = os.path.abspath(db_path)
    pending_path = absolute_path + ".restore_pending"
    if not os.path.exists(pending_path):
        return
    if os.path.exists(absolute_path):
        safety_path = absolute_path + ".before_restore_" + str(int(datetime.now().timestamp())) + ".bak"
        current = sqlite3.connect(absolute_path)
        safety = sqlite3.connect(safety_path)
        try:
            current.backup(safety)
        finally:
            safety.close()
            current.close()
    os.replace(pending_path, absolute_path)


apply_pending_database_restore()
upgrade_database(DATABASE_URL)


def seed_demo_data_if_empty():
    """Populate a fresh preview database with clearly labelled demo records."""
    if os.getenv("SCHOOLBRIDGE_SEED_DEMO_DATA", "true").lower() not in {"1", "true", "yes"}:
        return
    db = SessionLocal()
    try:
        profile = db.get(models.SchoolProfile, 1)
        if profile is None:
            profile = models.SchoolProfile(id=1, name="SchoolBridge Demo School", school_type="Secondary")
            db.add(profile)
            db.flush()
        school_type = profile.school_type or "Secondary"

        classes = db.query(models.SchoolClass).all()
        if not classes:
            class_names = [f"S{i}" for i in range(1, 7)] if school_type == "Secondary" else [f"P{i}" for i in range(1, 8)]
            classes = [models.SchoolClass(name=name, section="") for name in class_names]
            db.add_all(classes)
            db.flush()

        existing_subjects = {
            item.name.lower()
            for item in db.query(models.Subject).filter(models.Subject.school_type == school_type).all()
        }
        subject_names = (
            ["Mathematics", "English", "Biology", "Chemistry", "Physics", "Geography", "History", "Christian Religious Education"]
            if school_type == "Secondary"
            else ["English", "Mathematics", "Science", "Social Studies", "Literacy", "Religious Education"]
        )
        for name in subject_names:
            if name.lower() not in existing_subjects:
                db.add(models.Subject(name=name, school_type=school_type))

        class_by_name = {item.name.upper(): item for item in classes}
        existing_demo_admissions = {
            row.admission_number for row in db.query(models.Student.admission_number).filter(
                models.Student.admission_number.like(f"DEMO-{date.today().year}-%")
            ).all()
        }
        first_names = [
            "Amina", "Brian", "Carol", "Daniel", "Esther", "Farid", "Grace", "Henry",
            "Irene", "James", "Kevin", "Lydia", "Moses", "Nadia", "Oscar", "Patricia",
            "Quincy", "Ruth", "Samuel", "Tina", "Umar", "Vanessa", "William", "Xavier",
            "Yasmin", "Zach", "Andrew", "Bella", "Charles", "Diana"
        ]
        last_names = [
            "Demo", "Sample", "Test", "Preview", "Nabirye", "Okello", "Namutebi", "Kato",
            "Akena", "Atim", "Mugisha", "Nansubuga", "Ssemanda", "Auma", "Tumusiime"
        ]
        class_names = (
            [f"S{i}" for i in range(1, 7)] if school_type == "Secondary"
            else [f"P{i}" for i in range(1, 8)]
        )
        for index in range(1, 31):
            admission_number = f"DEMO-{date.today().year}-{index:03d}"
            if admission_number in existing_demo_admissions:
                continue
            class_name = class_names[(index - 1) % len(class_names)]
            selected = class_by_name.get(class_name.upper())
            if not selected:
                continue
            level = None
            combination = None
            if school_type == "Secondary":
                level = "A-Level" if class_name in {"S5", "S6"} else "O-Level"
                if level == "A-Level":
                    combination = "Sciences — PCB"
            first = first_names[index - 1]
            last = last_names[(index - 1) % len(last_names)]
            gender = "Female" if index % 2 else "Male"
            db.add(models.Student(
                admission_number=admission_number,
                first_name=first,
                last_name=last,
                gender=gender,
                guardian_name=f"{first} Demo Guardian",
                guardian_relationship="Parent",
                guardian_phone="0000000000",
                previous_school="Demo Primary School",
                admission_date=date.today(),
                class_id=selected.id,
                academic_level=level,
                combination=combination,
            ))

        if db.query(models.StaffMember).count() == 0:
            db.add_all([
                models.StaffMember(staff_number="DEMO-ST-001", first_name="Peter", last_name="Teacher", category="Teaching", position="Class Teacher", department="Academics", status="active"),
                models.StaffMember(staff_number="DEMO-ST-002", first_name="Sarah", last_name="Instructor", category="Teaching", position="Subject Teacher", department="Sciences", status="active"),
                models.StaffMember(staff_number="DEMO-ST-003", first_name="David", last_name="Accounts", category="Non-Teaching", position="Accounts Assistant", department="Finance", status="active"),
            ])
        db.flush()

        demo_students = db.query(models.Student).filter(
            models.Student.admission_number.like("DEMO-%")
        ).all()
        demo_classes = db.query(models.SchoolClass).all()
        current_year = date.today().year
        active_term = "Term 1"


        # Demo class fees and student charges (UGX), without touching real records.
        demo_class_ids = {student.class_id for student in demo_students if student.class_id is not None}
        # A realistic Monday-Friday demo timetable for classes containing demo learners.
        demo_teachers = db.query(models.StaffMember).filter(
            models.StaffMember.category == "Teaching",
            models.StaffMember.status == "active"
        ).order_by(models.StaffMember.id).all()
        timetable_subjects = demo_subjects_for_school = db.query(models.Subject).filter(
            models.Subject.school_type == school_type
        ).order_by(models.Subject.id).all()
        lesson_slots = [
            ("08:00", "08:40"), ("08:40", "09:20"),
            ("09:40", "10:20"), ("10:20", "11:00"),
            ("11:40", "12:20"),
        ]
        for school_class in demo_classes:
            if school_class.id not in demo_class_ids:
                continue
            for day in range(1, 6):
                for period, (start_time, end_time) in enumerate(lesson_slots):
                    exists = db.query(models.TimetableEntry).filter_by(
                        class_id=school_class.id,
                        day_of_week=day,
                        start_time=start_time,
                    ).first()
                    if exists:
                        continue
                    subject = timetable_subjects[(day * 2 + period) % len(timetable_subjects)] if timetable_subjects else None
                    teacher = demo_teachers[(day + period) % len(demo_teachers)] if demo_teachers else None
                    db.add(models.TimetableEntry(
                        class_id=school_class.id,
                        subject_id=subject.id if subject else None,
                        staff_id=teacher.id if teacher else None,
                        day_of_week=day,
                        start_time=start_time,
                        end_time=end_time,
                        room="Room " + str(((school_class.id + period) % 6) + 1),
                    ))
        db.flush()
        for school_class in demo_classes:
            if school_class.id not in demo_class_ids:
                continue
            class_fee = db.query(models.ClassFee).filter_by(
                class_id=school_class.id, term=active_term, year=current_year
            ).first()
            if class_fee is None:
                class_fee = models.ClassFee(
                    class_id=school_class.id, term=active_term,
                    year=current_year, amount=650000
                )
                db.add(class_fee)
        db.flush()

        for index, student in enumerate(demo_students, start=1):
            charge = db.query(models.FeeCharge).filter_by(
                student_id=student.id, term=active_term, year=current_year
            ).first()
            if charge is None:
                charge = models.FeeCharge(
                    student_id=student.id, term=active_term,
                    year=current_year, amount=650000,
                    description="DEMO tuition fees"
                )
                db.add(charge)
                db.flush()
            if index % 2 == 1 and not db.query(models.FeePayment).filter_by(charge_id=charge.id).first():
                db.add(models.FeePayment(
                    charge_id=charge.id,
                    amount=250000,
                    payment_date=date.today(),
                    method="Cash",
                    reference=f"DEMO-PAY-{index:03d}",
                    received_by="Demo Accounts",
                    receipt_number=f"DEMO-RCPT-{current_year}-{index:03d}",
                ))

        # Demo attendance for today, one record per sample learner.
        for index, student in enumerate(demo_students):
            if not db.query(models.Attendance).filter_by(
                student_id=student.id, attendance_date=date.today()
            ).first():
                db.add(models.Attendance(
                    student_id=student.id,
                    attendance_date=date.today(),
                    status="Absent" if index % 7 == 6 else ("Late" if index % 5 == 4 else "Present"),
                ))

        # Demo exams, marks and a usable grading scale.
        demo_subjects = db.query(models.Subject).filter(
            models.Subject.school_type == school_type
        ).order_by(models.Subject.id).all()
        for school_class in demo_classes:
            exam = db.query(models.Exam).filter_by(
                name="DEMO End of Term Assessment",
                term=active_term, year=current_year,
                class_id=school_class.id
            ).first()
            if exam is None:
                exam = models.Exam(
                    name="DEMO End of Term Assessment",
                    term=active_term, year=current_year,
                    class_id=school_class.id
                )
                db.add(exam)
                db.flush()
            class_students = [s for s in demo_students if s.class_id == school_class.id]
            for student in class_students:
                for subject_index, subject in enumerate(demo_subjects[:4]):
                    if db.query(models.Mark).filter_by(
                        student_id=student.id, subject_id=subject.id, exam_id=exam.id
                    ).first():
                        continue
                    db.add(models.Mark(
                        student_id=student.id,
                        subject_id=subject.id,
                        exam_id=exam.id,
                        score=float(55 + ((student.id * 7 + subject_index * 9) % 41)),
                        verified=True,
                    ))

        if db.query(models.GradeBand).count() == 0:
            db.add_all([
                models.GradeBand(grade="A", min_score=80, max_score=100, remark="Excellent"),
                models.GradeBand(grade="B", min_score=70, max_score=79.99, remark="Very good"),
                models.GradeBand(grade="C", min_score=60, max_score=69.99, remark="Good"),
                models.GradeBand(grade="D", min_score=50, max_score=59.99, remark="Fair"),
                models.GradeBand(grade="E", min_score=0, max_score=49.99, remark="Needs improvement"),
            ])
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


seed_demo_data_if_empty()

app = FastAPI(
    title="SchoolBridge API",
    description="Offline-first school management system API.",
    version="0.2.0",
)

cors_origins = [origin.strip() for origin in os.getenv("SCHOOLBRIDGE_CORS_ORIGINS", "*").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    section: str = Field(default="", max_length=40)


class SubjectCreate(BaseModel):
    name: str
    code: str | None = None


class StudentCreate(BaseModel):
    admission_number: str | None = None
    first_name: str
    middle_name: str | None = None
    last_name: str
    gender: str | None = None
    date_of_birth: date | None = None
    religion: str | None = None
    nationality: str | None = None
    phone: str | None = None
    address: str | None = None
    guardian_name: str | None = None
    guardian_relationship: str | None = None
    guardian_phone: str | None = None
    previous_school: str | None = None
    admission_date: date | None = None
    class_id: int | None = None
    fee_amount: int | None = Field(default=None, ge=0)
    academic_level: str | None = Field(default=None, pattern="^(O-Level|A-Level)$")
    combination: str | None = None
    optional_subjects: str | None = None
    subsidiary_subjects: str | None = None


class StudentUpdate(BaseModel):
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    religion: str | None = None
    nationality: str | None = None
    phone: str | None = None
    address: str | None = None
    guardian_name: str | None = None
    guardian_relationship: str | None = None
    guardian_phone: str | None = None
    previous_school: str | None = None
    admission_date: date | None = None
    class_id: int | None = None
    status: str | None = Field(default=None, pattern="^(active|transferred|dismissed|inactive)$")
    academic_level: str | None = Field(default=None, pattern="^(O-Level|A-Level)$")
    combination: str | None = None
    optional_subjects: str | None = None
    subsidiary_subjects: str | None = None


class AdmissionSettingsUpdate(BaseModel):
    admission_prefix: str = Field(default="SB", max_length=20)
    include_year: bool = True
    admission_separator: str = Field(default="-", max_length=5)
    admission_padding: int = Field(default=4, ge=1, le=8)
    next_admission_number: int = Field(default=1, ge=1)


def get_or_create_school_settings(db: Session):
    settings = db.get(models.SchoolSettings, 1)
    if settings is None:
        settings = models.SchoolSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


class AttendanceCreate(BaseModel):
    student_id: int
    attendance_date: date = Field(default_factory=date.today)
    status: str = Field(pattern="^(Present|Absent|Late|Excused)$")

class AttendanceRegisterEntry(BaseModel):
    student_id: int
    status: str = Field(pattern="^(Present|Absent|Late|Excused)$")


class AttendanceRegisterUpdate(BaseModel):
    class_id: int
    attendance_date: date = Field(default_factory=date.today)
    records: list[AttendanceRegisterEntry] = Field(min_length=1, max_length=500)

class StaffAttendanceEntry(BaseModel):
    staff_id: int
    status: str = Field(pattern="^(Present|Absent|Late|Excused)$")
    notes: str | None = Field(default=None, max_length=255)


class StaffAttendanceRegisterUpdate(BaseModel):
    attendance_date: date = Field(default_factory=date.today)
    records: list[StaffAttendanceEntry] = Field(min_length=1, max_length=300)


class TimetableEntryCreate(BaseModel):
    class_id: int
    subject_id: int | None = None
    staff_id: int | None = None
    day_of_week: int = Field(ge=1, le=5)
    start_time: str = Field(pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")
    end_time: str = Field(pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")
    room: str | None = Field(default=None, max_length=60)


class ExamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    term: str = Field(pattern="^(Term 1|Term 2|Term 3)$")
    year: int = Field(ge=2000, le=2100)
    class_id: int


class MarkCreate(BaseModel):
    student_id: int
    subject_id: int
    exam_id: int
    score: float = Field(ge=0, le=100)


class MarkUpdate(BaseModel):
    score: float = Field(ge=0, le=100)



class GradeBandInput(BaseModel):
    grade: str = Field(min_length=1, max_length=20)
    min_score: float = Field(ge=0, le=100)
    max_score: float = Field(gt=0, le=100)
    remark: str = Field(default="", max_length=100)


class GradingScaleUpdate(BaseModel):
    bands: list[GradeBandInput] = Field(min_length=1, max_length=20)


class ClassOut(ClassCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class SubjectOut(SubjectCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class StudentOut(StudentCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class AttendanceOut(AttendanceCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ExamOut(BaseModel):
    id: int
    name: str
    term: str
    year: int
    class_id: int | None = None
    model_config = ConfigDict(from_attributes=True)


class MarkOut(MarkCreate):
    id: int
    verified: bool = False
    model_config = ConfigDict(from_attributes=True)



@app.get("/api/settings/admission-number", tags=["School Settings"])
def read_admission_settings(db: Session = Depends(get_db)):
    settings = get_or_create_school_settings(db)
    return {
        "admission_prefix": settings.admission_prefix,
        "include_year": settings.include_year,
        "admission_separator": settings.admission_separator,
        "admission_padding": settings.admission_padding,
        "next_admission_number": settings.next_admission_number,
        "academic_year": settings.academic_year,
        "active_term": settings.active_term,
    }


@app.put("/api/settings/admission-number", tags=["School Settings"])
def update_admission_settings(
    data: AdmissionSettingsUpdate,
    db: Session = Depends(get_db),
):
    settings = get_or_create_school_settings(db)
    settings.admission_prefix = data.admission_prefix.strip()
    settings.include_year = data.include_year
    settings.admission_separator = data.admission_separator
    settings.admission_padding = data.admission_padding
    settings.next_admission_number = data.next_admission_number
    db.commit()
    db.refresh(settings)
    return {
        "message": "Admission numbering settings saved.",
        "admission_prefix": settings.admission_prefix,
        "include_year": settings.include_year,
        "admission_separator": settings.admission_separator,
        "admission_padding": settings.admission_padding,
        "next_admission_number": settings.next_admission_number,
        "academic_year": settings.academic_year,
        "active_term": settings.active_term,
    }


@app.get("/", include_in_schema=False)
def root():
    return {"message": "SchoolBridge API is running. Visit /docs for API documentation."}


@app.get("/api/health", tags=["System"])
def health_check():
    return {"status": "ok", "application": "SchoolBridge", "version": "0.2.0"}


@app.post("/api/classes", response_model=ClassOut, tags=["Classes"])
def create_class(data: ClassCreate, db: Session = Depends(get_db)):
    if not data.name.strip():
        raise HTTPException(422, "Enter a class name.")
    item = models.SchoolClass(name=data.name.strip(), section=(data.section or "").strip())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That class and stream combination already exists.")
    return item


@app.delete("/api/classes/{class_id}", tags=["Classes"])
def delete_class(class_id: int, db: Session = Depends(get_db)):
    item = db.get(models.SchoolClass, class_id)
    if not item:
        raise HTTPException(404, "Class not found.")

    linked_students = db.query(models.Student).filter(models.Student.class_id == class_id).count()
    linked_fees = db.query(models.ClassFee).filter(models.ClassFee.class_id == class_id).count()
    linked_assignments = db.query(models.TeacherAssignment).filter(models.TeacherAssignment.class_id == class_id).count()
    if linked_students or linked_fees or linked_assignments:
        raise HTTPException(
            409,
            "This class cannot be removed because it has linked students, class fee records or teacher assignments. Remove or reassign those records first."
        )

    db.delete(item)
    db.commit()
    return {"message": "Class removed successfully."}


@app.get("/api/classes", response_model=list[ClassOut], tags=["Classes"])
def list_classes(db: Session = Depends(get_db)):
    return db.query(models.SchoolClass).order_by(models.SchoolClass.name, models.SchoolClass.section).all()


@app.post("/api/subjects", response_model=SubjectOut, tags=["Subjects"])
def create_subject(data: SubjectCreate, db: Session = Depends(get_db)):
    profile = db.get(models.SchoolProfile, 1)
    school_type = profile.school_type if profile else "Secondary"
    existing = db.query(models.Subject).filter(
        models.Subject.school_type == school_type,
        func.lower(models.Subject.name) == data.name.strip().lower(),
    ).first()
    if existing:
        raise HTTPException(409, "That subject already exists for this school type.")
    item = models.Subject(**{**data.model_dump(), "name": data.name.strip()}, school_type=school_type)
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That subject already exists.")
    return item


@app.get("/api/subjects", response_model=list[SubjectOut], tags=["Subjects"])
def list_subjects(db: Session = Depends(get_db)):
    profile = db.get(models.SchoolProfile, 1)
    school_type = profile.school_type if profile else "Secondary"
    return db.query(models.Subject).filter(
        models.Subject.school_type == school_type
    ).order_by(models.Subject.name).all()


@app.post("/api/students", response_model=StudentOut, tags=["Students"])
def create_student(data: StudentCreate, db: Session = Depends(get_db)):
    if not data.first_name.strip() or not data.last_name.strip():
        raise HTTPException(422, "Enter the student's first and last names before registering.")
    if not data.gender or not data.gender.strip():
        raise HTTPException(422, "Select the student's gender before registering.")
    if not data.guardian_name or not data.guardian_name.strip():
        raise HTTPException(422, "Enter a parent or guardian name before registering.")
    if not data.guardian_phone or not data.guardian_phone.strip():
        raise HTTPException(422, "Enter a parent or guardian phone number before registering.")
    if data.class_id is None:
        raise HTTPException(422, "Select a class before registering the student.")
    selected_class = db.get(models.SchoolClass, data.class_id)
    if not selected_class:
        raise HTTPException(404, "Choose a valid class.")
    profile = db.get(models.SchoolProfile, 1)
    school_type = profile.school_type if profile else "Secondary"
    class_label = re.sub(r"[\s._-]+", "", selected_class.name.lower())
    level_match = re.search(r"(?:senior|s)?([1-6])$", class_label)
    if school_type == "Secondary" and level_match:
        grade = int(level_match.group(1))
        derived_level = "A-Level" if grade in (5, 6) else "O-Level"
        if data.academic_level and data.academic_level != derived_level:
            raise HTTPException(422, f"{selected_class.name} is {derived_level}; the level is determined by the selected class.")
        if derived_level == "A-Level":
            if not data.combination or not data.combination.strip():
                raise HTTPException(422, "Choose an Arts or Sciences combination for this A-Level class.")
            if not (data.combination.startswith("Arts — ") or data.combination.startswith("Sciences — ")):
                raise HTTPException(422, "Choose the A-Level stream and a combination.")
        student_academic_level = derived_level
    else:
        student_academic_level = None
    student_data = data.model_dump()
    student_data.pop("fee_amount", None)
    student_data["academic_level"] = student_academic_level
    if student_academic_level != "A-Level":
        student_data["combination"] = None
        student_data["subsidiary_subjects"] = None
    if student_academic_level != "O-Level":
        student_data["optional_subjects"] = None
    supplied_number = (student_data.pop("admission_number") or "").strip()
    settings = get_or_create_school_settings(db)
    item = models.Student(
        **student_data,
        admission_number=supplied_number or f"PENDING-{uuid4().hex}",
    )
    db.add(item)
    try:
        db.flush()
        if not supplied_number:
            next_value = db.execute(
                update(models.SchoolSettings)
                .where(models.SchoolSettings.id == 1)
                .values(next_admission_number=models.SchoolSettings.next_admission_number + 1)
                .returning(models.SchoolSettings.next_admission_number)
            ).scalar_one() - 1
            parts = []
            if settings.admission_prefix.strip():
                parts.append(settings.admission_prefix.strip())
            if settings.include_year:
                parts.append(str(date.today().year))
            parts.append(str(next_value).zfill(settings.admission_padding))
            item.admission_number = settings.admission_separator.join(parts)
        db.flush()
        if item.class_id is not None:
            school_settings = get_or_create_school_settings(db)
            active_term = school_settings.active_term
            active_year = school_settings.academic_year or date.today().year
            class_fee = db.query(models.ClassFee).filter_by(
                class_id=item.class_id, term=active_term, year=active_year
            ).first()
            selected_fee = data.fee_amount if data.fee_amount is not None else (class_fee.amount if class_fee else 0)
            if selected_fee > 0:
                db.add(models.FeeCharge(
                    student_id=item.id, term=active_term,
                    year=active_year, amount=selected_fee
                ))
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That admission number is already registered. Check the school's numbering sequence.")
    return item

@app.get("/api/students", response_model=list[StudentOut], tags=["Students"])
def list_students(db: Session = Depends(get_db)):
    return db.query(models.Student).order_by(models.Student.last_name).all()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM]
        )
        user_id = int(payload["sub"])
    except (InvalidTokenError, ValueError, KeyError):
        raise HTTPException(401, "Invalid or expired login token.")

    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Account is unavailable.")
    return user


@app.post("/api/attendance", response_model=AttendanceOut, tags=["Attendance"])
def record_attendance(data: AttendanceCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    student = db.get(models.Student, data.student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    if user.role != "admin":
        if user.role != "teacher" or not db.query(models.TeacherAssignment).filter_by(teacher_id=user.id, class_id=student.class_id).first():
            raise HTTPException(403, "You are not assigned to this student's class.")
    item = models.Attendance(**data.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Attendance has already been recorded for this student on that date.")
    return item



@app.get("/api/attendance", response_model=list[AttendanceOut], tags=["Attendance"])
def list_attendance(
    attendance_date: date | None = None,
    class_id: int | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user.role == "teacher" and (not class_id or not db.query(models.TeacherAssignment).filter_by(teacher_id=user.id, class_id=class_id).first()):
        raise HTTPException(403, "You are not assigned to this class.")
    if user.role not in {"admin", "teacher"}:
        raise HTTPException(403, "Administrator or teacher permission required.")
    query = db.query(models.Attendance).join(
        models.Student, models.Student.id == models.Attendance.student_id
    )
    if attendance_date:
        query = query.filter(models.Attendance.attendance_date == attendance_date)
    if class_id:
        query = query.filter(models.Student.class_id == class_id)
    return query.order_by(
        models.Attendance.attendance_date.desc(), models.Attendance.id.desc()
    ).all()


@app.get("/api/attendance/summary", tags=["Attendance"])
def attendance_summary(
    attendance_date: date | None = None,
    class_id: int | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    attendance_date = attendance_date or date.today()
    if user.role == "teacher" and (not class_id or not db.query(models.TeacherAssignment).filter_by(teacher_id=user.id, class_id=class_id).first()):
        raise HTTPException(403, "You are not assigned to this class.")
    if user.role not in {"admin", "teacher"}:
        raise HTTPException(403, "Administrator or teacher permission required.")
    students_query = db.query(models.Student).filter(models.Student.status == "active")
    if class_id:
        students_query = students_query.filter(models.Student.class_id == class_id)
    students = students_query.all()
    student_ids = [student.id for student in students]
    rows = db.query(models.Attendance).filter(
        models.Attendance.attendance_date == attendance_date,
        models.Attendance.student_id.in_(student_ids or [-1]),
    ).all()
    counts = {status: sum(1 for row in rows if row.status == status)
              for status in ("Present", "Absent", "Late", "Excused")}
    return {
        "attendance_date": attendance_date,
        "class_id": class_id,
        "total_students": len(students),
        "marked": len(rows),
        "unmarked": max(0, len(students) - len(rows)),
        "present": counts["Present"],
        "absent": counts["Absent"],
        "late": counts["Late"],
        "excused": counts["Excused"],
        "attendance_rate": round(
            (counts["Present"] + counts["Late"] + counts["Excused"]) / len(students) * 100, 2
        ) if students else 0,
    }


@app.post("/api/exams", response_model=ExamOut, tags=["Exams"])
def create_exam(data: ExamCreate, db: Session = Depends(get_db)):
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Select a valid class for this examination.")
    duplicate = db.query(models.Exam).filter_by(
        name=data.name.strip(), term=data.term, year=data.year, class_id=data.class_id
    ).first()
    if duplicate:
        raise HTTPException(409, "This examination already exists for the selected class, term and year.")
    item = models.Exam(**{**data.model_dump(), "name": data.name.strip()})
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/exams", response_model=list[ExamOut], tags=["Exams"])
def list_exams(class_id: int | None = None, year: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Exam)
    if class_id is not None:
        query = query.filter(models.Exam.class_id == class_id)
    if year is not None:
        query = query.filter(models.Exam.year == year)
    return query.order_by(models.Exam.year.desc(), models.Exam.term, models.Exam.name).all()


@app.post("/api/marks", response_model=MarkOut, tags=["Marks"])
def record_mark(data: MarkCreate, db: Session = Depends(get_db)):
    student = db.get(models.Student, data.student_id)
    subject = db.get(models.Subject, data.subject_id)
    exam = db.get(models.Exam, data.exam_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    if not subject:
        raise HTTPException(404, "Subject not found.")
    if not exam:
        raise HTTPException(404, "Exam not found.")
    if exam.class_id is not None and student.class_id != exam.class_id:
        raise HTTPException(422, "The selected student does not belong to this examination's class.")
    item = models.Mark(**data.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A mark already exists for this student, subject and exam.")
    return item


@app.get("/api/marks", response_model=list[MarkOut], tags=["Marks"])
def list_marks(exam_id: int | None = None, student_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Mark)
    if exam_id is not None:
        query = query.filter(models.Mark.exam_id == exam_id)
    if student_id is not None:
        query = query.filter(models.Mark.student_id == student_id)
    return query.order_by(models.Mark.student_id, models.Mark.subject_id).all()


@app.patch("/api/marks/{mark_id}", response_model=MarkOut, tags=["Marks"])
def update_mark(mark_id: int, data: MarkUpdate, db: Session = Depends(get_db)):
    item = db.get(models.Mark, mark_id)
    if not item:
        raise HTTPException(404, "Mark record not found.")
    exam = db.get(models.Exam, item.exam_id)
    student = db.get(models.Student, item.student_id)
    if exam and exam.class_id is not None and student and student.class_id != exam.class_id:
        raise HTTPException(409, "This mark no longer matches the examination class.")
    item.score = data.score
    item.verified = False
    db.commit()
    db.refresh(item)
    return item


@app.patch("/api/marks/{mark_id}/verification", tags=["Marks"])
def verify_mark(mark_id: int, verified: bool, db: Session = Depends(get_db), admin=Depends(require_admin)):
    item = db.get(models.Mark, mark_id)
    if not item:
        raise HTTPException(404, "Mark record not found.")
    item.verified = verified
    write_audit(
        db, admin, "mark_verified" if verified else "mark_unlocked",
        "mark", item.id,
        f"exam={item.exam_id}; student={item.student_id}; subject={item.subject_id}",
    )
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/grading-scale", tags=["Grading"])
def get_grading_scale(db: Session = Depends(get_db)):
    return db.query(models.GradeBand).order_by(
        models.GradeBand.min_score, models.GradeBand.grade
    ).all()


@app.put("/api/grading-scale", tags=["Grading"])
def update_grading_scale(data: GradingScaleUpdate, db: Session = Depends(get_db)):
    bands = sorted(data.bands, key=lambda band: band.min_score)
    grades = [band.grade.strip().upper() for band in bands]
    if any(not grade for grade in grades) or len(set(grades)) != len(grades):
        raise HTTPException(422, "Each grading band must have a unique grade label.")
    if any(band.min_score >= band.max_score for band in bands):
        raise HTTPException(422, "Each grading band minimum must be lower than its maximum.")
    if bands[0].min_score != 0 or bands[-1].max_score != 100:
        raise HTTPException(422, "The grading scale must start at 0 and end at 100.")
    for previous, current in zip(bands, bands[1:]):
        if current.min_score != previous.max_score:
            raise HTTPException(422, "Grading bands must meet exactly without gaps or overlaps.")
    db.query(models.GradeBand).delete(synchronize_session=False)
    db.add_all([
        models.GradeBand(
            grade=band.grade.strip().upper(),
            min_score=band.min_score,
            max_score=band.max_score,
            remark=band.remark.strip(),
        ) for band in bands
    ])
    db.commit()
    return get_grading_scale(db)


# ========== AUTHENTICATION AND USER MANAGEMENT ==========

def bootstrap_initial_admin():
    """Create the first administrator only when explicitly configured by environment."""
    username = os.getenv("SCHOOLBRIDGE_INITIAL_ADMIN_USERNAME", "").strip()
    email = os.getenv("SCHOOLBRIDGE_INITIAL_ADMIN_EMAIL", "").strip()
    initial_password = os.getenv("SCHOOLBRIDGE_INITIAL_ADMIN_PASSWORD", "")

    supplied = [bool(username), bool(email), bool(initial_password)]
    if any(supplied) and not all(supplied):
        raise RuntimeError(
            "Set all three SCHOOLBRIDGE_INITIAL_ADMIN_* variables to bootstrap "
            "the first administrator."
        )
    if not all(supplied):
        return

    if len(initial_password) < 12:
        raise RuntimeError("SCHOOLBRIDGE_INITIAL_ADMIN_PASSWORD must be at least 12 characters.")

    db = SessionLocal()
    try:
        if db.query(models.User).count() == 0:
            admin = models.User(
                username=username,
                email=email,
                hashed_password=password_hash.hash(initial_password),
                role="admin",
                is_active=True,
            )
            db.add(admin)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise
    finally:
        db.close()


bootstrap_initial_admin()

class LoginInput(BaseModel):
    username: str
    password: str


class TeacherCreate(BaseModel):
    username: str
    email: str
    password: str = Field(min_length=12)


class AssignmentCreate(BaseModel):
    teacher_id: int
    class_id: int
    subject_id: int

class ParentAccountCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: str = Field(min_length=5, max_length=150)
    student_ids: list[int] = Field(min_length=1, max_length=10)


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=3, max_length=5000)
    audience: str = Field(default="All", pattern="^(All|Parents|Teachers)$")
    published: bool = True


def require_parent(user=Depends(get_current_user)):
    if user.role != "parent":
        raise HTTPException(403, "Parent account required.")
    return user


def linked_parent_student(db: Session, parent, student_id: int):
    link = db.query(models.ParentStudentLink).filter_by(
        user_id=parent.id, student_id=student_id
    ).first()
    if not link:
        raise HTTPException(404, "This student is not linked to your parent account.")
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student record not found.")
    return student


def create_access_token(user):
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "exp": expires,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)



@app.put("/api/attendance/register", tags=["Attendance"])
def save_attendance_register(
    data: AttendanceRegisterUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    selected_class = db.get(models.SchoolClass, data.class_id)
    if not selected_class:
        raise HTTPException(404, "Class not found.")
    if user.role != "admin":
        if user.role != "teacher" or not db.query(models.TeacherAssignment).filter_by(
            teacher_id=user.id, class_id=data.class_id
        ).first():
            raise HTTPException(403, "You are not assigned to this class.")
    student_ids = [entry.student_id for entry in data.records]
    if len(student_ids) != len(set(student_ids)):
        raise HTTPException(422, "A student can appear only once in a class register.")
    students = db.query(models.Student).filter(
        models.Student.id.in_(student_ids),
        models.Student.class_id == data.class_id,
        models.Student.status == "active",
    ).all()
    if len(students) != len(student_ids):
        raise HTTPException(422, "Every selected student must be active and belong to the chosen class.")
    saved = 0
    for entry in data.records:
        record = db.query(models.Attendance).filter_by(
            student_id=entry.student_id, attendance_date=data.attendance_date
        ).first()
        if record:
            record.status = entry.status
        else:
            db.add(models.Attendance(
                student_id=entry.student_id,
                attendance_date=data.attendance_date,
                status=entry.status,
            ))
        saved += 1
    write_audit(db, user, "attendance_register_saved", "class", data.class_id,
                f"{saved} student records; {data.attendance_date}")
    db.commit()
    return {
        "message": "Class attendance register saved.",
        "class_id": data.class_id,
        "attendance_date": data.attendance_date,
        "saved": saved,
    }




@app.get("/api/staff-attendance", tags=["Attendance"])
def list_staff_attendance(
    attendance_date: date | None = None,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    query = db.query(models.StaffAttendance)
    if attendance_date:
        query = query.filter(models.StaffAttendance.attendance_date == attendance_date)
    return query.order_by(models.StaffAttendance.attendance_date.desc(), models.StaffAttendance.id.desc()).all()


@app.get("/api/staff-attendance/summary", tags=["Attendance"])
def staff_attendance_summary(
    attendance_date: date | None = None,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    selected_date = attendance_date or date.today()
    active_staff = db.query(models.StaffMember).filter(models.StaffMember.status == "active").all()
    active_ids = [person.id for person in active_staff]
    rows = db.query(models.StaffAttendance).filter(
        models.StaffAttendance.attendance_date == selected_date,
        models.StaffAttendance.staff_id.in_(active_ids or [-1]),
    ).all()
    counts = {status: sum(1 for row in rows if row.status == status)
              for status in ("Present", "Absent", "Late", "Excused")}
    return {
        "attendance_date": selected_date,
        "total_staff": len(active_staff),
        "marked": len(rows),
        "unmarked": max(0, len(active_staff) - len(rows)),
        "present": counts["Present"],
        "absent": counts["Absent"],
        "late": counts["Late"],
        "excused": counts["Excused"],
    }


@app.put("/api/staff-attendance/register", tags=["Attendance"])
def save_staff_attendance_register(
    data: StaffAttendanceRegisterUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    staff_ids = [entry.staff_id for entry in data.records]
    if len(staff_ids) != len(set(staff_ids)):
        raise HTTPException(422, "A staff member can appear only once in a daily register.")
    staff_rows = db.query(models.StaffMember).filter(
        models.StaffMember.id.in_(staff_ids),
        models.StaffMember.status == "active",
    ).all()
    if len(staff_rows) != len(staff_ids):
        raise HTTPException(422, "Every selected staff member must be active.")
    for entry in data.records:
        record = db.query(models.StaffAttendance).filter_by(
            staff_id=entry.staff_id, attendance_date=data.attendance_date
        ).first()
        if record:
            record.status = entry.status
            record.notes = entry.notes
        else:
            db.add(models.StaffAttendance(
                staff_id=entry.staff_id,
                attendance_date=data.attendance_date,
                status=entry.status,
                notes=entry.notes,
            ))
    write_audit(db, admin, "staff_attendance_register_saved", "staff_attendance", 0,
                f"{len(staff_ids)} staff records; {data.attendance_date}")
    db.commit()
    return {"message": "Staff attendance register saved.", "attendance_date": data.attendance_date, "saved": len(staff_ids)}


@app.get("/api/timetable", tags=["Timetable"])
def list_timetable(
    class_id: int | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = db.query(models.TimetableEntry)
    if user.role == "teacher":
        assigned_class_ids = [
            row.class_id for row in db.query(models.TeacherAssignment.class_id)
            .filter_by(teacher_id=user.id).distinct().all()
        ]
        query = query.filter(models.TimetableEntry.class_id.in_(assigned_class_ids or [-1]))
    elif user.role != "admin":
        raise HTTPException(403, "Administrator or teacher permission required.")
    if class_id:
        query = query.filter(models.TimetableEntry.class_id == class_id)
    return query.order_by(
        models.TimetableEntry.day_of_week,
        models.TimetableEntry.start_time,
        models.TimetableEntry.id,
    ).all()


@app.post("/api/timetable", tags=["Timetable"])
def create_timetable_entry(
    data: TimetableEntryCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    if data.end_time <= data.start_time:
        raise HTTPException(422, "Lesson end time must be later than its start time.")
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")
    if data.subject_id is not None and not db.get(models.Subject, data.subject_id):
        raise HTTPException(404, "Subject not found.")
    if data.staff_id is not None:
        staff = db.get(models.StaffMember, data.staff_id)
        if not staff or staff.status != "active":
            raise HTTPException(404, "Active staff member not found.")
    overlaps = db.query(models.TimetableEntry).filter(
        models.TimetableEntry.class_id == data.class_id,
        models.TimetableEntry.day_of_week == data.day_of_week,
        models.TimetableEntry.start_time < data.end_time,
        models.TimetableEntry.end_time > data.start_time,
    ).first()
    if overlaps:
        raise HTTPException(409, "This lesson overlaps another lesson for the selected class.")
    if data.staff_id is not None:
        staff_overlap = db.query(models.TimetableEntry).filter(
            models.TimetableEntry.staff_id == data.staff_id,
            models.TimetableEntry.day_of_week == data.day_of_week,
            models.TimetableEntry.start_time < data.end_time,
            models.TimetableEntry.end_time > data.start_time,
        ).first()
        if staff_overlap:
            raise HTTPException(409, "This staff member already has a lesson scheduled at that time.")
    item = models.TimetableEntry(**data.model_dump())
    db.add(item)
    try:
        db.flush()
        write_audit(db, admin, "timetable_entry_created", "timetable_entry", item.id,
                    f"Class {data.class_id}; day {data.day_of_week}; {data.start_time}-{data.end_time}")
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A timetable entry already exists for this class and start time.")
    return item


@app.delete("/api/timetable/{entry_id}", tags=["Timetable"])
def delete_timetable_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    item = db.get(models.TimetableEntry, entry_id)
    if not item:
        raise HTTPException(404, "Timetable entry not found.")
    write_audit(db, admin, "timetable_entry_removed", "timetable_entry", item.id,
                f"Class {item.class_id}; day {item.day_of_week}; {item.start_time}-{item.end_time}")
    db.delete(item)
    db.commit()
    return {"message": "Timetable entry removed."}




@app.middleware("http")
async def protect_school_data(request: Request, call_next):
    path = request.url.path
    public_paths = {"/api/health", "/api/auth/login"}

    # Browser CORS preflight requests must reach CORSMiddleware without auth.
    if request.method == "OPTIONS":
        return await call_next(request)

    if not path.startswith("/api/") or path in public_paths:
        return await call_next(request)

    from starlette.responses import JSONResponse

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse({"detail": "Login required."}, status_code=401)

    db = SessionLocal()
    try:
        try:
            payload = jwt.decode(
                auth[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM]
            )
            user_id = int(payload["sub"])
        except (InvalidTokenError, ValueError, KeyError, TypeError):
            return JSONResponse(
                {"detail": "Invalid or expired login token."},
                status_code=401,
            )

        # Always load the current account from the database. Never trust a
        # role stored in a token: account deactivation and role changes must
        # take effect immediately, even for tokens issued earlier.
        user = db.get(models.User, user_id)
        if not user or not user.is_active:
            return JSONResponse(
                {"detail": "Account is unavailable."}, status_code=401
            )

        if path == "/api/auth/me":
            pass
        elif path.startswith("/api/teacher/"):
            if user.role != "teacher":
                return JSONResponse({"detail": "Teacher account required."}, status_code=403)
            section = permission_for_path(path)
            action = action_for_method(request.method)
            if not section or action not in user_permissions(user).get(section, set()):
                return JSONResponse({"detail": "Your teacher account is not permitted to perform this action."}, status_code=403)
        elif path.startswith("/api/parent/"):
            if user.role != "parent":
                return JSONResponse({"detail": "Parent account required."}, status_code=403)
        elif path == "/api/announcements" and user.role == "parent":
            pass
        elif user.role != "admin":
            if path in ADMIN_ONLY_PATHS or path.startswith("/api/auth/"):
                return JSONResponse({"detail": "Administrator permission required."}, status_code=403)
            section = permission_for_path(path)
            action = action_for_method(request.method)
            if not section or action not in user_permissions(user).get(section, set()):
                return JSONResponse({"detail": "You do not have permission to access this section or perform this action."}, status_code=403)

        return await call_next(request)
    finally:
        db.close()


@app.post("/api/auth/login", tags=["Authentication"])
def login(
    data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(models.User).filter(
        models.User.username == data.username
    ).first()

    if not user or not user.is_active:
        raise HTTPException(401, "Incorrect username or password.")

    if not password_hash.verify(data.password, user.hashed_password):
        raise HTTPException(401, "Incorrect username or password.")

    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "role": user.role,
        "username": user.username,
    }


@app.get("/api/auth/me", tags=["Authentication"])
def current_account(user=Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "role_label": user.role_label or user.role.title(),
        "permissions": {k: sorted(v) for k, v in user_permissions(user).items()},
        "active": user.is_active,
    }


@app.post("/api/auth/teachers", tags=["User Management"])
def create_teacher(
    data: TeacherCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    teacher = models.User(
        username=data.username,
        email=data.email,
        hashed_password=password_hash.hash(data.password),
        role="teacher",
        role_label="Teacher",
    )
    db.add(teacher)

    try:
        db.commit()
        db.refresh(teacher)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Username or email is already registered."
        )

    return {
        "id": teacher.id,
        "username": teacher.username,
        "email": teacher.email,
        "role": teacher.role,
    }


class UserPermissionsUpdate(BaseModel):
    role: str = Field(pattern="^(teacher|staff)$")
    role_label: str = Field(min_length=2, max_length=80)
    permissions: dict[str, list[str]]


@app.get("/api/auth/permissions", tags=["User Management"])
def permission_catalog(admin=Depends(require_admin)):
    presets = {
        "Headteacher": ["Overview", "Students", "Staff", "Fees & Finance", "Examinations", "Attendance", "Staff Attendance", "Timetable", "Leadership & Duty", "Parent Access", "Announcements", "Reports"],
        "Deputy Headteacher": ["Overview", "Students", "Staff", "Examinations", "Attendance", "Timetable", "Leadership & Duty", "Announcements", "Reports"],
        "DOS": ["Overview", "Examinations", "Attendance", "Timetable", "Students", "Reports", "Announcements"],
        "Bursar": ["Overview", "Fees & Finance", "Students", "Reports"],
        "Accountant": ["Overview", "Fees & Finance", "Staff", "Reports"],
        "Secretary": ["Overview", "Students", "Staff", "Parent Access", "Announcements", "Reports"],
        "Teacher": ["My Classes", "Attendance", "My Attendance", "My Results", "Announcements", "Timetable"],
        "Class Teacher": ["My Classes", "Students", "Attendance", "My Attendance", "My Results", "Announcements", "Timetable"],
    }
    return {"sections": sorted(PERMISSION_SECTIONS), "actions": sorted(PERMISSION_ACTIONS), "presets": presets}


@app.put("/api/auth/users/{user_id}/permissions", tags=["User Management"])
def update_user_permissions(user_id: int, data: UserPermissionsUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    target = db.get(models.User, user_id)
    if not target or target.role in {"admin", "parent"}:
        raise HTTPException(404, "Staff login account not found.")
    cleaned = {}
    for section, actions in data.permissions.items():
        if section not in PERMISSION_SECTIONS or not isinstance(actions, list):
            raise HTTPException(422, "Invalid permission section.")
        invalid = set(actions) - PERMISSION_ACTIONS
        if invalid:
            raise HTTPException(422, "Invalid permission action.")
        if actions:
            cleaned[section] = sorted(set(actions))
    if data.role == "teacher" and not any(k in cleaned for k in ("My Classes", "Attendance", "My Results")):
        raise HTTPException(422, "Teacher accounts must retain at least one teaching permission.")
    target.role = data.role
    target.role_label = data.role_label.strip()
    target.permissions_json = json.dumps(cleaned)
    db.commit()
    return {"id": target.id, "role": target.role, "role_label": target.role_label, "permissions": cleaned}


@app.get("/api/auth/users", tags=["User Management"])
def list_users(
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    users = db.query(models.User).order_by(models.User.username).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "role": u.role,
            "role_label": u.role_label or u.role.title(),
            "permissions": {k: sorted(v) for k, v in user_permissions(u).items()},
            "active": u.is_active,
        }
        for u in users
    ]




@app.post("/api/parent-accounts", tags=["Parent Access"])
def create_parent_account(data: ParentAccountCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    temporary_password = secrets.token_urlsafe(12)
    student_ids = list(dict.fromkeys(data.student_ids))
    students = db.query(models.Student).filter(models.Student.id.in_(student_ids)).all()
    if len(students) != len(student_ids):
        raise HTTPException(404, "One or more selected students could not be found.")
    parent = models.User(
        username=data.username.strip(),
        email=data.email.strip().lower(),
        hashed_password=password_hash.hash(temporary_password),
        role="parent",
    )
    db.add(parent)
    try:
        db.flush()
        db.add_all([models.ParentStudentLink(user_id=parent.id, student_id=student_id) for student_id in student_ids])
        write_audit(db, admin, "parent_account_created", "user", parent.id, f"Linked student IDs: {', '.join(map(str, student_ids))}")
        db.commit()
        db.refresh(parent)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That username or email is already registered, or a parent link already exists.")
    email_sent = False
    email_error = None
    smtp_host = os.getenv("SCHOOLBRIDGE_SMTP_HOST", "smtp.gmail.com").strip()
    smtp_user = os.getenv("SCHOOLBRIDGE_SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("SCHOOLBRIDGE_SMTP_PASSWORD", "")
    smtp_from = os.getenv("SCHOOLBRIDGE_SMTP_FROM", smtp_user).strip()
    if smtp_host and smtp_user and smtp_password and smtp_from:
        try:
            message = EmailMessage()
            message["Subject"] = "Your SchoolBridge parent account"
            message["From"] = smtp_from
            message["To"] = parent.email
            message.set_content(
                f"Hello,\n\nYour SchoolBridge parent account has been created.\n"
                f"Username: {parent.username}\nTemporary passcode: {temporary_password}\n\n"
                "Sign in using the SchoolBridge portal and change your passcode after signing in. Keep these details private.\n"
            )
            smtp_port = int(os.getenv("SCHOOLBRIDGE_SMTP_PORT", "587"))
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                server.ehlo()
                if os.getenv("SCHOOLBRIDGE_SMTP_USE_TLS", "true").lower() not in ("0", "false", "no"):
                    server.starttls()
                    server.ehlo()
                if smtp_user:
                    server.login(smtp_user, smtp_password)
                server.send_message(message)
            email_sent = True
        except Exception:
            email_error = "Email delivery could not be completed. Use the displayed local handover details."
    else:
        email_error = "Email delivery needs the school's SMTP username and app password in server settings."
    return {"id": parent.id, "username": parent.username, "email": parent.email, "role": parent.role, "linked_students": len(student_ids), "temporary_password": temporary_password, "email_sent": email_sent, "email_error": email_error}


@app.get("/api/parent-accounts", tags=["Parent Access"])
def list_parent_accounts(db: Session = Depends(get_db), admin=Depends(require_admin)):
    parents = db.query(models.User).filter_by(role="parent").order_by(models.User.username).all()
    output = []
    for parent in parents:
        links = db.query(models.ParentStudentLink).filter_by(user_id=parent.id).all()
        children = []
        for link in links:
            student = db.get(models.Student, link.student_id)
            if student:
                children.append({"id": student.id, "name": " ".join(x for x in [student.first_name, student.middle_name, student.last_name] if x), "admission_number": student.admission_number})
        output.append({"id": parent.id, "username": parent.username, "email": parent.email, "active": parent.is_active, "children": children})
    return output


@app.get("/api/parent/children", tags=["Parent Portal"])
def parent_children(db: Session = Depends(get_db), parent=Depends(require_parent)):
    links = db.query(models.ParentStudentLink).filter_by(user_id=parent.id).all()
    output = []
    for link in links:
        student = db.get(models.Student, link.student_id)
        if not student:
            continue
        school_class = db.get(models.SchoolClass, student.class_id) if student.class_id else None
        charges = db.query(models.FeeCharge).filter_by(student_id=student.id).all()
        total_charged = sum(row.amount for row in charges)
        total_paid = sum(db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter_by(charge_id=row.id).scalar() or 0 for row in charges)
        output.append({"id": student.id, "name": " ".join(x for x in [student.first_name, student.middle_name, student.last_name] if x), "admission_number": student.admission_number, "status": student.status, "class_name": school_class.name if school_class else "Unassigned", "stream": school_class.section if school_class else "", "fees_charged": total_charged, "fees_paid": total_paid, "balance": total_charged-total_paid})
    return output


@app.get("/api/parent/children/{student_id}/results", tags=["Parent Portal"])
def parent_child_results(student_id: int, db: Session = Depends(get_db), parent=Depends(require_parent)):
    student = linked_parent_student(db, parent, student_id)
    rows = db.query(models.Mark, models.Exam, models.Subject).join(
        models.Exam, models.Exam.id == models.Mark.exam_id
    ).join(models.Subject, models.Subject.id == models.Mark.subject_id).filter(
        models.Mark.student_id == student.id, models.Mark.verified.is_(True)
    ).order_by(models.Exam.year.desc(), models.Exam.term, models.Exam.name, models.Subject.name).all()
    return [{"exam": exam.name, "term": exam.term, "year": exam.year, "subject": subject.name, "score": mark.score} for mark, exam, subject in rows]


@app.get("/api/parent/children/{student_id}/attendance", tags=["Parent Portal"])
def parent_child_attendance(student_id: int, db: Session = Depends(get_db), parent=Depends(require_parent)):
    student = linked_parent_student(db, parent, student_id)
    rows = db.query(models.Attendance).filter_by(student_id=student.id).order_by(
        models.Attendance.attendance_date.desc(), models.Attendance.id.desc()
    ).limit(120).all()
    return [{"date": row.attendance_date, "status": row.status} for row in rows]


@app.get("/api/parent/children/{student_id}/fees", tags=["Parent Portal"])
def parent_child_fees(student_id: int, db: Session = Depends(get_db), parent=Depends(require_parent)):
    student = linked_parent_student(db, parent, student_id)
    charges = db.query(models.FeeCharge).filter_by(student_id=student.id).order_by(
        models.FeeCharge.year.desc(), models.FeeCharge.term
    ).all()
    output = []
    for charge in charges:
        payments = db.query(models.FeePayment).filter_by(charge_id=charge.id).order_by(
            models.FeePayment.payment_date.desc(), models.FeePayment.id.desc()
        ).all()
        paid = sum(row.amount for row in payments)
        output.append({"term": charge.term, "year": charge.year, "charged": charge.amount, "paid": paid, "balance": charge.amount-paid, "payments": [{"date": row.payment_date, "amount": row.amount, "receipt_number": row.receipt_number} for row in payments]})
    return output


@app.post("/api/announcements", tags=["School Announcements"])
def create_announcement(data: AnnouncementCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    item = models.SchoolAnnouncement(**data.model_dump(), created_by=admin.id)
    db.add(item)
    db.flush()
    write_audit(db, admin, "announcement_created", "announcement", item.id, item.title)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/announcements", tags=["School Announcements"])
def list_announcements(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role == "admin":
        query = db.query(models.SchoolAnnouncement)
    elif user.role == "parent":
        query = db.query(models.SchoolAnnouncement).filter(models.SchoolAnnouncement.published.is_(True), models.SchoolAnnouncement.audience.in_(["All", "Parents"]))
    elif user.role == "teacher":
        query = db.query(models.SchoolAnnouncement).filter(models.SchoolAnnouncement.published.is_(True), models.SchoolAnnouncement.audience.in_(["All", "Teachers"]))
    else:
        raise HTTPException(403, "This account cannot view school announcements.")
    return query.order_by(models.SchoolAnnouncement.created_at.desc(), models.SchoolAnnouncement.id.desc()).limit(100).all()

@app.post("/api/teacher-assignments", tags=["Teacher Management"])
def assign_teacher(
    data: AssignmentCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    teacher = db.get(models.User, data.teacher_id)

    if not teacher or teacher.role != "teacher":
        raise HTTPException(404, "Teacher account not found.")

    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")

    if not db.get(models.Subject, data.subject_id):
        raise HTTPException(404, "Subject not found.")

    assignment = models.TeacherAssignment(**data.model_dump())
    db.add(assignment)

    try:
        db.commit()
        db.refresh(assignment)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This assignment already exists.")

    return {"message": "Teacher assigned successfully.", "id": assignment.id}


@app.get("/api/teacher/my-staff-attendance", tags=["Teacher Workspace"])
def teacher_my_staff_attendance(
    db: Session = Depends(get_db),
    teacher=Depends(get_current_user),
):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    staff_member = db.query(models.StaffMember).filter(
        func.lower(models.StaffMember.email) == teacher.email.lower()
    ).first()
    if not staff_member:
        raise HTTPException(
            404,
            "Your login email is not linked to a staff profile. Ask the administrator to use the same email on your staff record."
        )
    records = db.query(models.StaffAttendance).filter(
        models.StaffAttendance.staff_id == staff_member.id
    ).order_by(
        models.StaffAttendance.attendance_date.desc(),
        models.StaffAttendance.id.desc(),
    ).limit(60).all()
    return {
        "staff_name": f"{staff_member.first_name} {staff_member.last_name}",
        "staff_number": staff_member.staff_number,
        "records": [
            {
                "id": row.id,
                "attendance_date": row.attendance_date,
                "status": row.status,
                "notes": row.notes,
            }
            for row in records
        ],
    }


@app.get("/api/teacher/my-assignments", tags=["Teacher Management"])
def my_assignments(
    db: Session = Depends(get_db),
    teacher=Depends(get_current_user),
):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")

    assignments = db.query(models.TeacherAssignment).filter(
        models.TeacherAssignment.teacher_id == teacher.id
    ).all()

    return [
        {
            "assignment_id": a.id,
            "class_id": a.class_id,
            "class": db.get(models.SchoolClass, a.class_id).name + " — " + db.get(models.SchoolClass, a.class_id).section,
            "subject_id": a.subject_id,
            "subject": db.get(models.Subject, a.subject_id).name,
        }
        for a in assignments
    ]


@app.get("/api/teacher/exams", tags=["Teacher Workspace"])
def teacher_exams(db: Session = Depends(get_db), teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    class_ids = [
        row.class_id for row in db.query(models.TeacherAssignment).filter_by(
            teacher_id=teacher.id
        ).all()
    ]
    if not class_ids:
        return []
    return db.query(models.Exam).filter(
        models.Exam.class_id.in_(class_ids)
    ).order_by(models.Exam.year.desc(), models.Exam.term, models.Exam.name).all()


@app.get("/api/teacher/marks", tags=["Teacher Workspace"])
def teacher_marks(exam_id: int | None = None, db: Session = Depends(get_db),
                  teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    assignments = db.query(models.TeacherAssignment).filter_by(
        teacher_id=teacher.id
    ).all()
    allowed = {(row.class_id, row.subject_id) for row in assignments}
    if not allowed:
        return []
    query = db.query(models.Mark, models.Student, models.Exam).join(
        models.Student, models.Student.id == models.Mark.student_id
    ).join(models.Exam, models.Exam.id == models.Mark.exam_id)
    if exam_id is not None:
        query = query.filter(models.Mark.exam_id == exam_id)
    rows = []
    for mark, student, exam in query.order_by(
        models.Mark.exam_id, models.Student.last_name, models.Mark.subject_id
    ).all():
        if (student.class_id, mark.subject_id) not in allowed:
            continue
        rows.append({
            "id": mark.id, "student_id": mark.student_id,
            "subject_id": mark.subject_id, "exam_id": mark.exam_id,
            "score": mark.score, "verified": mark.verified, "student_name": " ".join(
                part for part in [student.first_name, student.middle_name, student.last_name] if part
            ), "admission_number": student.admission_number,
            "class_id": student.class_id,
        })
    return rows


@app.put("/api/teacher/marks", tags=["Teacher Workspace"])
def save_teacher_mark(data: MarkCreate, db: Session = Depends(get_db),
                      teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    student = db.get(models.Student, data.student_id)
    subject = db.get(models.Subject, data.subject_id)
    exam = db.get(models.Exam, data.exam_id)
    if not student or not subject or not exam:
        raise HTTPException(404, "Student, subject or examination not found.")
    if exam.class_id is None or student.class_id != exam.class_id:
        raise HTTPException(422, "The student does not belong to this class examination.")
    assignment = db.query(models.TeacherAssignment).filter_by(
        teacher_id=teacher.id, class_id=exam.class_id, subject_id=subject.id
    ).first()
    if not assignment:
        raise HTTPException(403, "You are not assigned to teach this subject in this class.")
    item = db.query(models.Mark).filter_by(
        student_id=student.id, subject_id=subject.id, exam_id=exam.id
    ).first()
    if item is not None and item.verified:
        raise HTTPException(409, "This mark has been verified by the administrator. Contact the administrator to unlock it before editing.")
    if item is None:
        item = models.Mark(**data.model_dump())
        db.add(item)
    else:
        item.score = data.score
    db.commit()
    db.refresh(item)
    return item


class StaffCreate(BaseModel):
    first_name: str
    last_name: str
    subjects: str | None = None
    category: str = Field(default="Teaching", pattern="^(Teaching|Non-teaching)$")
    position: str | None = None
    department: str | None = None
    phone: str | None = None
    email: str | None = None
    salary_amount: int | None = Field(default=None, ge=0)
    salary_frequency: str = Field(default="Monthly", pattern="^(Monthly|Termly|Weekly|Daily)$")

def write_audit(db: Session, actor, action: str, entity_type: str, entity_id: int, details: str = ""):
    db.add(models.AuditLog(
        actor_id=actor.id if actor else None,
        actor_username=actor.username if actor else "system",
        action=action, entity_type=entity_type, entity_id=entity_id, details=details
    ))


class FeePaymentCreate(BaseModel):
    charge_id: int
    amount: int = Field(gt=0)
    payment_date: date = Field(default_factory=date.today)
    method: str = Field(default="Cash", max_length=30)
    reference: str | None = Field(default=None, max_length=80)

def upgrade_existing_database():
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "students" not in inspector.get_table_names(): return
    existing = {column["name"] for column in inspector.get_columns("students")}
    additions = {
        "middle_name": "VARCHAR(80)", "religion": "VARCHAR(60)", "nationality": "VARCHAR(60)",
        "phone": "VARCHAR(30)", "address": "VARCHAR(255)", "guardian_name": "VARCHAR(160)",
        "guardian_relationship": "VARCHAR(60)", "guardian_phone": "VARCHAR(30)",
        "previous_school": "VARCHAR(160)", "admission_date": "DATE",
        "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
        "academic_level": "VARCHAR(20)", "combination": "VARCHAR(100)", "optional_subjects": "TEXT", "subsidiary_subjects": "TEXT",
    }
    settings_columns = {c["name"] for c in inspector.get_columns("school_settings")} if "school_settings" in inspector.get_table_names() else set()
    staff_columns = {c["name"] for c in inspector.get_columns("staff_members")} if "staff_members" in inspector.get_table_names() else set()
    payment_columns = {c["name"] for c in inspector.get_columns("fee_payments")} if "fee_payments" in inspector.get_table_names() else set()
    with engine.begin() as connection:
        for name, sql_type in additions.items():
            if name not in existing: connection.execute(text("ALTER TABLE students ADD COLUMN " + name + " " + sql_type))
        if "staff_members" in inspector.get_table_names():
            if "subjects" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN subjects TEXT"))
            if "salary_amount" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN salary_amount INTEGER"))
            if "salary_frequency" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN salary_frequency VARCHAR(20) NOT NULL DEFAULT 'Monthly'"))
        if "fee_payments" in inspector.get_table_names() and "receipt_number" not in payment_columns:
            connection.execute(text("ALTER TABLE fee_payments ADD COLUMN receipt_number VARCHAR(50)"))
        if "fee_payments" in inspector.get_table_names():
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_fee_payments_receipt_number ON fee_payments (receipt_number)"))
        if "school_profile" in inspector.get_table_names():
            profile_columns = {c["name"] for c in inspector.get_columns("school_profile")}
            profile_additions = {"school_type": "VARCHAR(20) NOT NULL DEFAULT 'Secondary'", "a_level_combinations": "TEXT", "o_level_optional_subjects": "TEXT", "a_level_subsidiary_subjects": "TEXT"}
            for name, sql_type in profile_additions.items():
                if name not in profile_columns: connection.execute(text("ALTER TABLE school_profile ADD COLUMN " + name + " " + sql_type))
        if "school_settings" in inspector.get_table_names():
            if "academic_year" not in settings_columns:
                connection.execute(text("ALTER TABLE school_settings ADD COLUMN academic_year INTEGER"))
            if "active_term" not in settings_columns:
                connection.execute(text("ALTER TABLE school_settings ADD COLUMN active_term VARCHAR(20) NOT NULL DEFAULT 'Term 1'"))

upgrade_existing_database()

def upgrade_class_stream_uniqueness():
    """Allow multiple streams per grade while preserving existing class IDs and foreign keys."""
    from sqlalchemy import inspect, text
    import os, shutil, sqlite3
    inspector = inspect(engine)
    if "classes" not in inspector.get_table_names():
        return
    uniques = inspector.get_unique_constraints("classes")
    unique_indexes = [i for i in inspector.get_indexes("classes") if i.get("unique")]
    name_only = (any(u.get("column_names") == ["name"] for u in uniques)
                 or any(i.get("column_names") == ["name"] for i in unique_indexes))
    if not name_only:
        return
    if engine.dialect.name == "sqlite":
        db_path = engine.url.database
        if not db_path or db_path == ":memory:":
            raise RuntimeError("Cannot safely migrate an in-memory classes database.")
        absolute_path = os.path.abspath(db_path)
        backup_path = absolute_path + ".pre_stream_migration.bak"
        if not os.path.exists(backup_path):
            shutil.copy2(absolute_path, backup_path)
        raw = sqlite3.connect(absolute_path)
        try:
            raw.execute("PRAGMA foreign_keys=OFF")
            raw.execute("BEGIN")
            raw.execute("""CREATE TABLE classes_new (
                id INTEGER NOT NULL PRIMARY KEY,
                name VARCHAR(80) NOT NULL,
                section VARCHAR(40) NOT NULL DEFAULT 'General',
                CONSTRAINT uq_classes_name_section UNIQUE (name, section)
            )""")
            raw.execute("INSERT INTO classes_new (id,name,section) SELECT id,name,COALESCE(section,'General') FROM classes")
            raw.execute("DROP TABLE classes")
            raw.execute("ALTER TABLE classes_new RENAME TO classes")
            raw.execute("CREATE INDEX ix_classes_name ON classes (name)")
            raw.commit()
            raw.execute("PRAGMA foreign_keys=ON")
            violations = raw.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError("Class stream migration found foreign-key violations; restore the automatic backup.")
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()
    elif engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("UPDATE classes SET section='General' WHERE section IS NULL"))
            for unique in uniques:
                if unique.get("column_names") == ["name"] and unique.get("name"):
                    connection.execute(text('ALTER TABLE classes DROP CONSTRAINT "' + unique["name"] + '"'))
            for index in unique_indexes:
                if index.get("column_names") == ["name"] and index.get("name"):
                    connection.execute(text('DROP INDEX IF EXISTS "' + index["name"] + '"'))
            connection.execute(text("ALTER TABLE classes ALTER COLUMN section SET DEFAULT 'General'"))
            connection.execute(text("ALTER TABLE classes ALTER COLUMN section SET NOT NULL"))
            connection.execute(text("ALTER TABLE classes ADD CONSTRAINT uq_classes_name_section UNIQUE (name, section)"))

upgrade_class_stream_uniqueness()

@app.get("/api/students/search", tags=["Students"])
def search_students(page: int = 1, page_size: int = 25, search: str = "", class_id: int | None = None, db: Session = Depends(get_db)):
    page_size = min(max(page_size, 1), 100)
    query = db.query(models.Student)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(models.Student.admission_number.ilike(term), models.Student.first_name.ilike(term), models.Student.middle_name.ilike(term), models.Student.last_name.ilike(term)))
    if class_id is not None:
        query = query.filter(models.Student.class_id == class_id)
    total = query.count()
    rows = query.order_by(models.Student.last_name, models.Student.first_name).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size, "pages": (total + page_size - 1) // page_size}


@app.get("/api/dashboard/summary", tags=["Dashboard"])
def dashboard_summary(attendance_date: date | None = None, db: Session = Depends(get_db)):
    selected_attendance_date = attendance_date or date.today()
    settings = get_or_create_school_settings(db)
    academic_year = settings.academic_year or date.today().year
    year_start = date(academic_year, 1, 1)
    year_end = date(academic_year, 12, 31)
    students_present_today = db.query(models.Attendance).join(
        models.Student, models.Student.id == models.Attendance.student_id
    ).filter(
        models.Attendance.attendance_date == selected_attendance_date,
        models.Attendance.status == "Present",
        models.Student.status == "active",
    ).count()
    return {
        "active_students": db.query(models.Student).filter(models.Student.status == "active").count(),
        "new_admissions_this_year": db.query(models.Student).filter(
            models.Student.admission_date >= year_start,
            models.Student.admission_date <= year_end,
        ).count(),
        "students_present_today": students_present_today,
        "active_staff": db.query(models.StaffMember).filter(models.StaffMember.status == "active").count(),
        "total_classes": db.query(models.SchoolClass).count(),
        "academic_year": academic_year,
    }



class PrefectAssignmentCreate(BaseModel):
    student_id: int
    position: str = Field(min_length=2, max_length=100)
    start_date: date = Field(default_factory=date.today)
    end_date: date | None = None


class TeacherDutyCreate(BaseModel):
    staff_id: int
    duty_date: date
    notes: str | None = Field(default=None, max_length=255)


@app.get("/api/leadership/prefects", tags=["Leadership"])
def list_prefects(active_only: bool = True, db: Session = Depends(get_db), admin=Depends(require_admin)):
    query = db.query(models.PrefectAssignment, models.Student, models.SchoolClass).join(
        models.Student, models.Student.id == models.PrefectAssignment.student_id
    ).outerjoin(models.SchoolClass, models.SchoolClass.id == models.Student.class_id)
    if active_only:
        query = query.filter(models.PrefectAssignment.active.is_(True))
    rows = query.order_by(models.PrefectAssignment.active.desc(), models.PrefectAssignment.position).all()
    return [{
        "id": assignment.id, "student_id": student.id,
        "student_name": f"{student.first_name} {student.last_name}",
        "admission_number": student.admission_number,
        "class_name": school_class.name if school_class else "Unassigned",
        "stream": school_class.section if school_class else None,
        "position": assignment.position, "start_date": assignment.start_date,
        "end_date": assignment.end_date, "active": assignment.active,
    } for assignment, student, school_class in rows]


@app.post("/api/leadership/prefects", tags=["Leadership"])
def appoint_prefect(data: PrefectAssignmentCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    student = db.get(models.Student, data.student_id)
    if not student or student.status != "active":
        raise HTTPException(404, "Select an active student.")
    if data.end_date and data.end_date < data.start_date:
        raise HTTPException(422, "End date cannot be earlier than start date.")
    if db.query(models.PrefectAssignment).filter_by(student_id=student.id, active=True).first():
        raise HTTPException(409, "This student already has an active prefect appointment.")
    if db.query(models.PrefectAssignment).filter_by(position=data.position, active=True).first():
        raise HTTPException(409, "This prefect position already has an active appointment. End the previous term first.")
    assignment = models.PrefectAssignment(**data.model_dump())
    db.add(assignment)
    db.flush()
    write_audit(db, admin, "prefect_appointed", "prefect_assignment", assignment.id,
                f"{student.admission_number}; {data.position}")
    db.commit()
    db.refresh(assignment)
    return {"id": assignment.id, "message": "Prefect appointed successfully."}


@app.patch("/api/leadership/prefects/{assignment_id}/end", tags=["Leadership"])
def end_prefect_term(assignment_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    assignment = db.get(models.PrefectAssignment, assignment_id)
    if not assignment:
        raise HTTPException(404, "Prefect appointment not found.")
    assignment.active = False
    assignment.end_date = date.today()
    write_audit(db, admin, "prefect_term_ended", "prefect_assignment", assignment.id, assignment.position)
    db.commit()
    return {"message": "Prefect appointment ended."}


@app.get("/api/leadership/teacher-duties", tags=["Leadership"])
def list_teacher_duties(from_date: date | None = None, to_date: date | None = None,
                        db: Session = Depends(get_db), admin=Depends(require_admin)):
    query = db.query(models.TeacherDuty, models.StaffMember).join(
        models.StaffMember, models.StaffMember.id == models.TeacherDuty.staff_id
    )
    if from_date:
        query = query.filter(models.TeacherDuty.duty_date >= from_date)
    if to_date:
        query = query.filter(models.TeacherDuty.duty_date <= to_date)
    rows = query.order_by(models.TeacherDuty.duty_date.desc()).limit(150).all()
    return [{
        "id": duty.id, "staff_id": staff.id,
        "teacher_name": f"{staff.first_name} {staff.last_name}",
        "staff_number": staff.staff_number, "duty_date": duty.duty_date,
        "notes": duty.notes,
    } for duty, staff in rows]


@app.post("/api/leadership/teacher-duties", tags=["Leadership"])
def assign_teacher_duty(data: TeacherDutyCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    staff = db.get(models.StaffMember, data.staff_id)
    if not staff or staff.status != "active" or staff.category != "Teaching":
        raise HTTPException(404, "Select an active teaching staff member.")
    if db.query(models.TeacherDuty).filter_by(duty_date=data.duty_date).first():
        raise HTTPException(409, "A teacher is already assigned to this duty date.")
    duty = models.TeacherDuty(**data.model_dump())
    db.add(duty)
    db.flush()
    write_audit(db, admin, "teacher_duty_assigned", "teacher_duty", duty.id,
                f"{staff.staff_number}; {data.duty_date}")
    db.commit()
    db.refresh(duty)
    return {"id": duty.id, "message": "Teacher duty assigned successfully."}


@app.delete("/api/leadership/teacher-duties/{duty_id}", tags=["Leadership"])
def remove_teacher_duty(duty_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    duty = db.get(models.TeacherDuty, duty_id)
    if not duty:
        raise HTTPException(404, "Duty assignment not found.")
    write_audit(db, admin, "teacher_duty_removed", "teacher_duty", duty.id, str(duty.duty_date))
    db.delete(duty)
    db.commit()
    return {"message": "Duty assignment removed."}


@app.post("/api/staff", tags=["Staff"])
def create_staff(data: StaffCreate, db: Session = Depends(get_db)):
    if not data.first_name.strip() or not data.last_name.strip():
        raise HTTPException(422, "Enter the staff member's first and last names before saving.")
    if not data.category:
        raise HTTPException(422, "Select a staff category before saving.")
    if not data.position or not data.position.strip():
        raise HTTPException(422, "Enter the staff member's job title or position.")
    if not data.department or not data.department.strip():
        raise HTTPException(422, "Enter the staff member's department.")
    if data.category == "Teaching" and (not data.subjects or not data.subjects.strip()):
        raise HTTPException(422, "Enter at least one subject taught by this teacher.")
    item = models.StaffMember(staff_number="STF-" + str(date.today().year) + "-" + uuid4().hex[:6].upper(), **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/staff", tags=["Staff"])
def list_staff(search: str = "", category: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    page_size = min(max(page_size, 1), 100)
    query = db.query(models.StaffMember)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(models.StaffMember.staff_number.ilike(term), models.StaffMember.first_name.ilike(term), models.StaffMember.last_name.ilike(term)))
    if category:
        query = query.filter(models.StaffMember.category == category)
    total = query.count()
    rows = query.order_by(models.StaffMember.last_name).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size, "pages": (total + page_size - 1) // page_size}


@app.get("/api/finance/summary", tags=["Finance"])
def finance_summary(db: Session = Depends(get_db)):
    charged = db.query(func.coalesce(func.sum(models.FeeCharge.amount), 0)).scalar() or 0
    paid = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).scalar() or 0
    salary_expenses = db.query(func.coalesce(func.sum(models.SalaryPayment.amount), 0)).scalar() or 0
    other_expenses = db.query(func.coalesce(func.sum(models.OtherExpense.amount), 0)).scalar() or 0
    return {"fees_expected": float(charged), "fees_collected": float(paid),
            "outstanding": float(charged - paid),
            "salary_expenses": int(salary_expenses),
            "other_expenses": int(other_expenses),
            "total_expenses": int(salary_expenses + other_expenses),
            "net_cash_position": int(paid - salary_expenses - other_expenses)}


@app.get("/api/finance/charges", tags=["Finance"])
def list_fee_charges(search: str = "", class_id: int | None = None, stream: str | None = None, outstanding_only: bool = False, db: Session = Depends(get_db)):
    payment_totals = db.query(
        models.FeePayment.charge_id.label("charge_id"),
        func.sum(models.FeePayment.amount).label("paid")
    ).group_by(models.FeePayment.charge_id).subquery()
    query = db.query(
        models.FeeCharge, models.Student, models.SchoolClass,
        func.coalesce(payment_totals.c.paid, 0)
    ).join(
        models.Student, models.Student.id == models.FeeCharge.student_id
    ).outerjoin(
        models.SchoolClass, models.SchoolClass.id == models.Student.class_id
    ).outerjoin(
        payment_totals, payment_totals.c.charge_id == models.FeeCharge.id
    )
    if class_id is not None:
        query = query.filter(models.Student.class_id == class_id)
    if stream:
        query = query.filter(models.SchoolClass.section == stream)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(
            models.Student.admission_number.ilike(term),
            models.Student.first_name.ilike(term),
            models.Student.middle_name.ilike(term),
            models.Student.last_name.ilike(term)
        ))
    results = []
    for charge, student, school_class, paid in query.order_by(
        models.FeeCharge.year.desc(), models.FeeCharge.term,
        models.Student.last_name, models.Student.first_name
    ).all():
        balance = charge.amount - int(paid or 0)
        if outstanding_only and balance <= 0:
            continue
        results.append({
            "id": charge.id, "student_id": student.id,
            "student_name": " ".join(x for x in [student.first_name, student.middle_name, student.last_name] if x),
            "admission_number": student.admission_number,
            "class_id": student.class_id,
            "class_name": school_class.name if school_class else "",
            "stream": school_class.section if school_class else "",
            "term": charge.term, "year": charge.year,
            "amount": charge.amount, "paid": int(paid or 0),
            "balance": balance
        })
    return results

@app.post("/api/finance/payments", tags=["Finance"])
def record_fee_payment(data: FeePaymentCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    charge = db.get(models.FeeCharge, data.charge_id)
    if not charge:
        raise HTTPException(404, "Fee charge not found.")
    paid = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter(models.FeePayment.charge_id == charge.id).scalar() or 0
    if data.amount > charge.amount - paid:
        raise HTTPException(400, "Payment exceeds the outstanding balance.")
    item = models.FeePayment(**data.model_dump(), receipt_number="RCPT-" + str(date.today().year) + "-" + uuid4().hex[:8].upper())
    db.add(item)
    db.flush()
    write_audit(db, admin, "payment_received", "fee_payment", item.id,
                f"Receipt {item.receipt_number}; amount {item.amount}; charge {item.charge_id}")
    db.commit()
    db.refresh(item)
    return {"id": item.id, "charge_id": item.charge_id, "amount": item.amount, "payment_date": item.payment_date, "method": item.method, "reference": item.reference, "receipt_number": item.receipt_number}


class ClassFeeUpdate(BaseModel):
    term: str = Field(pattern="^(Term 1|Term 2|Term 3)$")
    year: int = Field(ge=2000, le=2100)
    amount: int = Field(ge=0)


class AcademicSettingsUpdate(BaseModel):
    academic_year: int = Field(ge=2000, le=2100)
    active_term: str = Field(pattern="^(Term 1|Term 2|Term 3)$")


@app.get("/api/settings/academic", tags=["School Settings"])
def read_academic_settings(db: Session = Depends(get_db)):
    settings = get_or_create_school_settings(db)
    if settings.academic_year is None:
        settings.academic_year = date.today().year
        db.commit()
    return {"academic_year": settings.academic_year, "active_term": settings.active_term}


@app.put("/api/settings/academic", tags=["School Settings"])
def update_academic_settings(data: AcademicSettingsUpdate, db: Session = Depends(get_db)):
    settings = get_or_create_school_settings(db)
    settings.academic_year = data.academic_year
    settings.active_term = data.active_term
    db.flush()
    created = 0
    active_students = db.query(models.Student).filter(
        models.Student.status == "active",
        models.Student.class_id.is_not(None)
    ).all()
    for student in active_students:
        class_fee = db.query(models.ClassFee).filter_by(
            class_id=student.class_id, term=data.active_term, year=data.academic_year
        ).first()
        if not class_fee or class_fee.amount <= 0:
            continue
        existing = db.query(models.FeeCharge).filter_by(
            student_id=student.id, term=data.active_term, year=data.academic_year
        ).first()
        if existing is None:
            db.add(models.FeeCharge(
                student_id=student.id, term=data.active_term,
                year=data.academic_year, amount=class_fee.amount
            ))
            created += 1
    db.commit()
    return {"message": "Academic settings saved and class fees assigned to active students.",
            **data.model_dump(), "charges_created": created}


@app.get("/api/classes/{class_id}/fees", tags=["Classes"])
def get_class_fees(class_id: int, year: int | None = None, db: Session = Depends(get_db)):
    if not db.get(models.SchoolClass, class_id):
        raise HTTPException(404, "Class not found.")
    settings = get_or_create_school_settings(db)
    selected_year = year or settings.academic_year or date.today().year
    rows = db.query(models.ClassFee).filter_by(class_id=class_id, year=selected_year).all()
    by_term = {row.term: row.amount for row in rows}
    return {"class_id": class_id, "year": selected_year,
            "fees": [{"term": term, "amount": by_term.get(term, 0)}
                     for term in ("Term 1", "Term 2", "Term 3")]}


@app.put("/api/classes/{class_id}/fees", tags=["Classes"])
def save_class_fee(class_id: int, data: ClassFeeUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    selected_class = db.get(models.SchoolClass, class_id)
    if not selected_class:
        raise HTTPException(404, "Class not found.")
    # Streams under the same grade share one standard term fee.
    grade_classes = db.query(models.SchoolClass).filter(
        models.SchoolClass.name == selected_class.name
    ).all()
    created = 0
    settings = get_or_create_school_settings(db)
    for grade_class in grade_classes:
        row = db.query(models.ClassFee).filter_by(
            class_id=grade_class.id, term=data.term, year=data.year
        ).first()
        if row is None:
            row = models.ClassFee(class_id=grade_class.id, **data.model_dump())
            db.add(row)
            db.flush()
        else:
            row.amount = data.amount
        if settings.active_term == data.term and (settings.academic_year or date.today().year) == data.year:
            active_students = db.query(models.Student).filter_by(
                class_id=grade_class.id, status="active"
            ).all()
            for student in active_students:
                existing = db.query(models.FeeCharge).filter_by(
                    student_id=student.id, term=data.term, year=data.year
                ).first()
                if existing is None and data.amount > 0:
                    db.add(models.FeeCharge(
                        student_id=student.id, term=data.term,
                        year=data.year, amount=data.amount
                    ))
                    created += 1
    db.flush()
    write_audit(db, admin, "class_fee_updated", "class_fee", class_id,
                f"Grade {selected_class.name}; {data.term} {data.year}; UGX {data.amount}")
    db.commit()
    return {"message": "Class fee saved for all streams. Existing charges were not changed.",
            "class_id": class_id, "term": data.term, "year": data.year,
            "amount": data.amount, "streams_updated": len(grade_classes),
            "charges_created": created}

@app.get("/api/students/{student_id}/profile", tags=["Students"])
def student_profile(student_id: int, db: Session = Depends(get_db)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    charges = db.query(models.FeeCharge).filter_by(student_id=student_id).order_by(
        models.FeeCharge.year.desc(), models.FeeCharge.term
    ).all()
    fee_history = []
    for charge in charges:
        payments = db.query(models.FeePayment).filter_by(charge_id=charge.id).order_by(
            models.FeePayment.payment_date.desc(), models.FeePayment.id.desc()
        ).all()
        paid = sum(p.amount for p in payments)
        fee_history.append({
            "charge_id": charge.id, "term": charge.term, "year": charge.year,
            "amount": charge.amount, "paid": paid, "balance": charge.amount-paid,
            "payments": [{
                "id": p.id, "amount": p.amount, "date": p.payment_date,
                "method": p.method, "reference": p.reference, "receipt_number": p.receipt_number
            } for p in payments]
        })
    school_class = db.get(models.SchoolClass, student.class_id) if student.class_id else None
    return {
        "student": student,
        "class": school_class.name if school_class else None,
        "stream": school_class.section if school_class else None,
        "fees": fee_history,
        "total_charged": sum(x["amount"] for x in fee_history),
        "total_paid": sum(x["paid"] for x in fee_history),
        "total_balance": sum(x["balance"] for x in fee_history),
    }


@app.patch("/api/students/{student_id}", tags=["Students"])
def update_student(student_id: int, data: StudentUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    changes = data.model_dump(exclude_unset=True)
    if "class_id" in changes and changes["class_id"] is not None and not db.get(models.SchoolClass, changes["class_id"]):
        raise HTTPException(404, "Class not found.")
    for key, value in changes.items():
        setattr(student, key, value)
    write_audit(db, admin, "student_updated", "student", student.id, ", ".join(changes.keys()))
    db.commit()
    db.refresh(student)
    return {"message": "Student profile updated.", "student": student}


@app.patch("/api/students/{student_id}/status", tags=["Students"])
def change_student_status(student_id: int, status: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if status not in {"active", "transferred", "dismissed", "inactive"}:
        raise HTTPException(422, "Status must be active, transferred, dismissed or inactive.")
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    student.status = status
    write_audit(db, admin, "student_status_changed", "student", student.id, status)
    db.commit()
    return {"message": "Student status updated. Historical academic and financial records were retained.", "status": status}


class StaffUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    subjects: str | None = None
    category: str | None = Field(default=None, pattern="^(Teaching|Non-teaching)$")
    position: str | None = None
    department: str | None = None
    phone: str | None = None
    email: str | None = None
    salary_amount: int | None = Field(default=None, ge=0)
    salary_frequency: str | None = Field(default=None, pattern="^(Monthly|Termly|Weekly|Daily)$")
    status: str | None = Field(default=None, pattern="^(active|archived|inactive)$")


class SalaryPaymentCreate(BaseModel):
    staff_id: int
    amount: int = Field(gt=0)
    payment_date: date = Field(default_factory=date.today)
    period: str = Field(min_length=2, max_length=40)
    reference: str | None = Field(default=None, max_length=80)


class OtherExpenseCreate(BaseModel):
    description: str = Field(min_length=2, max_length=160)
    category: str = Field(default="General", max_length=60)
    amount: int = Field(gt=0)
    expense_date: date = Field(default_factory=date.today)
    reference: str | None = Field(default=None, max_length=80)


@app.patch("/api/staff/{staff_id}", tags=["Staff"])
def update_staff(staff_id: int, data: StaffUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    staff = db.get(models.StaffMember, staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    changes = data.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(staff, key, value)
    write_audit(db, admin, "staff_updated", "staff", staff.id, ", ".join(changes.keys()))
    db.commit()
    db.refresh(staff)
    return {"message": "Staff profile updated.", "staff": staff}


@app.post("/api/staff/{staff_id}/archive", tags=["Staff"])
def archive_staff(staff_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    staff = db.get(models.StaffMember, staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    staff.status = "archived"
    write_audit(db, admin, "staff_archived", "staff", staff.id, "Staff archived; history retained.")
    db.commit()
    return {"message": "Staff member archived. Historical salary records were retained."}


@app.post("/api/finance/salary-payments", tags=["Finance"])
def record_salary_payment(data: SalaryPaymentCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    staff = db.get(models.StaffMember, data.staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    payment = models.SalaryPayment(**data.model_dump())
    db.add(payment)
    db.flush()
    write_audit(db, admin, "salary_paid", "salary_payment", payment.id,
                f"Staff {staff.staff_number}; amount {payment.amount}; period {payment.period}")
    db.commit()
    db.refresh(payment)
    return {"id": payment.id, "staff_id": payment.staff_id, "amount": payment.amount, "payment_date": payment.payment_date, "period": payment.period}


@app.post("/api/finance/other-expenses", tags=["Finance"])
def record_other_expense(data: OtherExpenseCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    expense = models.OtherExpense(**data.model_dump())
    db.add(expense)
    db.flush()
    write_audit(db, admin, "expense_recorded", "other_expense", expense.id,
                f"{expense.category}; amount {expense.amount}; {expense.description}")
    db.commit()
    db.refresh(expense)
    return expense


@app.get("/api/finance/expenses", tags=["Finance"])
def finance_expenses(db: Session = Depends(get_db)):
    salary_total = db.query(func.coalesce(func.sum(models.SalaryPayment.amount), 0)).scalar() or 0
    other_total = db.query(func.coalesce(func.sum(models.OtherExpense.amount), 0)).scalar() or 0
    return {"salary_expenses": int(salary_total), "other_expenses": int(other_total), "total_expenses": int(salary_total + other_total)}


@app.get("/api/teacher/students", tags=["Teacher Workspace"])
def teacher_students(class_id: int, db: Session = Depends(get_db), teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    assigned = db.query(models.TeacherAssignment).filter_by(
        teacher_id=teacher.id, class_id=class_id
    ).first()
    if not assigned:
        raise HTTPException(403, "This class is not assigned to your account.")
    return db.query(models.Student).filter(
        models.Student.class_id == class_id, models.Student.status == "active"
    ).order_by(models.Student.last_name, models.Student.first_name).all()


@app.post("/api/teacher/attendance", tags=["Teacher Workspace"])
def teacher_record_attendance(data: AttendanceCreate, db: Session = Depends(get_db), teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    student = db.get(models.Student, data.student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    assigned = db.query(models.TeacherAssignment).filter_by(
        teacher_id=teacher.id, class_id=student.class_id
    ).first()
    if not assigned:
        raise HTTPException(403, "You cannot record attendance for this student's class.")
    item = models.Attendance(**data.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Attendance already recorded for this student on this date.")
    return item


@app.get("/api/audit-logs", tags=["System Audit"])
def list_audit_logs(page: int = 1, page_size: int = 50, db: Session = Depends(get_db), admin=Depends(require_admin)):
    page_size = min(max(page_size, 1), 100)
    query = db.query(models.AuditLog)
    total = query.count()
    rows = query.order_by(models.AuditLog.created_at.desc(), models.AuditLog.id.desc()).offset((page-1)*page_size).limit(page_size).all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


class SchoolProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=150)
    motto: str | None = Field(default=None, max_length=200)
    school_type: str = Field(default="Secondary", pattern="^(Primary|Secondary)$")
    a_level_combinations: str | None = None
    o_level_optional_subjects: str | None = None
    a_level_subsidiary_subjects: str | None = None
    report_logo: str | None = Field(default=None, max_length=2_000_000)
    report_template: str | None = Field(default=None, max_length=100_000)


@app.get("/api/settings/school-profile", tags=["School Settings"])
def get_school_profile(db: Session = Depends(get_db)):
    profile = db.get(models.SchoolProfile, 1)
    if profile is None:
        profile = models.SchoolProfile(id=1)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@app.put("/api/settings/school-profile", tags=["School Settings"])
def save_school_profile(data: SchoolProfileUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    profile = db.get(models.SchoolProfile, 1)
    if profile is None:
        profile = models.SchoolProfile(id=1)
        db.add(profile)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    db.flush()
    write_audit(db, admin, "school_profile_updated", "school_profile", profile.id, "School profile and report branding updated.")
    db.commit()
    db.refresh(profile)
    return {"message": "School profile saved.", "profile": profile}


@app.post("/api/backups/create", tags=["Backups"])
def create_database_backup(admin=Depends(require_admin)):
    import os, sqlite3, tempfile
    if engine.dialect.name != "sqlite":
        raise HTTPException(501, "Direct file backups are currently supported for the local SQLite installation.")
    db_path = engine.url.database
    if not db_path or db_path == ":memory:":
        raise HTTPException(400, "A file-based school database is required.")
    fd, backup_path = tempfile.mkstemp(prefix="schoolbridge-backup-", suffix=".sqlite3")
    os.close(fd)
    try:
        source = sqlite3.connect(os.path.abspath(db_path))
        destination = sqlite3.connect(backup_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
    except Exception:
        if os.path.exists(backup_path):
            os.unlink(backup_path)
        raise HTTPException(500, "Could not create a database backup.")
    filename = "schoolbridge-backup-" + date.today().isoformat() + ".sqlite3"
    return FileResponse(
        backup_path, media_type="application/vnd.sqlite3", filename=filename,
        background=BackgroundTask(lambda: os.path.exists(backup_path) and os.unlink(backup_path))
    )


@app.post("/api/backups/restore", tags=["Backups"])
async def restore_database_backup(file: UploadFile = File(...), admin=Depends(require_admin)):
    import os, sqlite3, tempfile
    if engine.dialect.name != "sqlite":
        raise HTTPException(501, "Direct file restore is currently supported for the local SQLite installation.")
    db_path = engine.url.database
    if not db_path or db_path == ":memory:":
        raise HTTPException(400, "A file-based school database is required.")
    payload = await file.read(512 * 1024 * 1024 + 1)
    if len(payload) > 512 * 1024 * 1024:
        raise HTTPException(413, "Backup file is larger than 512 MB.")
    absolute_path = os.path.abspath(db_path)
    directory = os.path.dirname(absolute_path)
    fd, uploaded_path = tempfile.mkstemp(prefix="schoolbridge-restore-", suffix=".sqlite3", dir=directory)
    os.close(fd)
    pending_path = absolute_path + ".restore_pending"
    try:
        with open(uploaded_path, "wb") as output:
            output.write(payload)
        candidate = sqlite3.connect(uploaded_path)
        try:
            integrity = candidate.execute("PRAGMA integrity_check").fetchone()
            foreign_key_errors = candidate.execute("PRAGMA foreign_key_check").fetchall()
            tables = {row[0] for row in candidate.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            required = {"users", "students", "classes", "school_settings"}
            if not integrity or integrity[0] != "ok" or foreign_key_errors or not required.issubset(tables):
                raise HTTPException(400, "This file is not a valid SchoolBridge database backup.")
        finally:
            candidate.close()
        os.replace(uploaded_path, pending_path)
        return {"message": "Backup validated and staged. Restart the SchoolBridge backend to apply it. The current database will be copied to a safety backup before replacement."}
    except HTTPException:
        raise
    except sqlite3.DatabaseError as exc:
        raise HTTPException(400, "The uploaded file is not a readable SQLite database backup.") from exc
    except Exception as exc:
        raise HTTPException(500, "Could not stage the database restore.") from exc
    finally:
        if os.path.exists(uploaded_path):
            os.unlink(uploaded_path)


class FeeChargeUpdate(BaseModel):
    amount: int = Field(ge=0)
    reason: str = Field(min_length=3, max_length=255)


@app.patch("/api/finance/charges/{charge_id}", tags=["Finance"])
def adjust_fee_charge(charge_id: int, data: FeeChargeUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    charge = db.get(models.FeeCharge, charge_id)
    if not charge:
        raise HTTPException(404, "Fee charge not found.")
    paid = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter(
        models.FeePayment.charge_id == charge.id
    ).scalar() or 0
    if data.amount < paid:
        raise HTTPException(400, "The revised charge cannot be less than payments already received.")
    previous = charge.amount
    charge.amount = data.amount
    write_audit(db, admin, "fee_charge_adjusted", "fee_charge", charge.id,
                f"Previous UGX {previous}; new UGX {data.amount}; reason: {data.reason}")
    db.commit()
    return {"message": "Fee charge adjusted and recorded in the audit log.", "charge_id": charge.id, "amount": charge.amount, "paid": paid, "balance": charge.amount-paid}
