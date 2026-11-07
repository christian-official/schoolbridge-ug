from datetime import date
from uuid import uuid4
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import update, func, or_

from .database import Base, engine, get_db, SessionLocal
from . import models

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SchoolBridge API",
    description="Offline-first school management system API.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)


class ClassCreate(BaseModel):
    name: str
    section: str | None = None


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
    status: str


class ExamCreate(BaseModel):
    name: str
    term: str
    year: int


class MarkCreate(BaseModel):
    student_id: int
    subject_id: int
    exam_id: int
    score: float = Field(ge=0, le=100)


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


class ExamOut(ExamCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class MarkOut(MarkCreate):
    id: int
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
    item = models.SchoolClass(name=data.name.strip(), section=(data.section or "General").strip())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That class and stream combination already exists.")
    return item


@app.get("/api/classes", response_model=list[ClassOut], tags=["Classes"])
def list_classes(db: Session = Depends(get_db)):
    return db.query(models.SchoolClass).order_by(models.SchoolClass.name, models.SchoolClass.section).all()


@app.post("/api/subjects", response_model=SubjectOut, tags=["Subjects"])
def create_subject(data: SubjectCreate, db: Session = Depends(get_db)):
    item = models.Subject(**data.model_dump())
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
    return db.query(models.Subject).order_by(models.Subject.name).all()


@app.post("/api/students", response_model=StudentOut, tags=["Students"])
def create_student(data: StudentCreate, db: Session = Depends(get_db)):
    if data.class_id is not None and not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")
    student_data = data.model_dump()
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
            # Atomic counter increment prevents two concurrent registrations
            # from receiving the same sequence number.
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
            if class_fee and class_fee.amount > 0:
                db.add(models.FeeCharge(
                    student_id=item.id, term=active_term,
                    year=active_year, amount=class_fee.amount
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


@app.post("/api/attendance", response_model=AttendanceOut, tags=["Attendance"])
def record_attendance(data: AttendanceCreate, db: Session = Depends(get_db)):
    if not db.get(models.Student, data.student_id):
        raise HTTPException(404, "Student not found.")
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
def list_attendance(db: Session = Depends(get_db)):
    return db.query(models.Attendance).order_by(
        models.Attendance.attendance_date.desc()
    ).all()


@app.post("/api/exams", response_model=ExamOut, tags=["Exams"])
def create_exam(data: ExamCreate, db: Session = Depends(get_db)):
    item = models.Exam(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/exams", response_model=list[ExamOut], tags=["Exams"])
def list_exams(db: Session = Depends(get_db)):
    return db.query(models.Exam).order_by(models.Exam.year.desc()).all()


@app.post("/api/marks", response_model=MarkOut, tags=["Marks"])
def record_mark(data: MarkCreate, db: Session = Depends(get_db)):
    for model, record_id, label in [
        (models.Student, data.student_id, "Student"),
        (models.Subject, data.subject_id, "Subject"),
        (models.Exam, data.exam_id, "Exam"),
    ]:
        if not db.get(model, record_id):
            raise HTTPException(404, f"{label} not found.")
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
def list_marks(db: Session = Depends(get_db)):
    return db.query(models.Mark).all()


# ========== AUTHENTICATION AND USER MANAGEMENT ==========

import os
from dotenv import load_dotenv
import jwt
from datetime import datetime, timedelta, timezone
from pwdlib import PasswordHash
from jwt.exceptions import InvalidTokenError
from fastapi import Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError

password_hash = PasswordHash.recommended()
load_dotenv()
JWT_SECRET = os.environ["SCHOOLBRIDGE_SECRET_KEY"]
JWT_ALGORITHM = "HS256"
TOKEN_HOURS = 8

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


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


def create_access_token(user):
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "exp": expires,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


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


def require_admin(user=Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Administrator permission required.")
    return user


@app.middleware("http")
async def protect_school_data(request: Request, call_next):
    path = request.url.path
    public_paths = {"/api/health", "/api/auth/login"}

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
        elif path == "/api/teacher/my-assignments":
            if user.role != "teacher":
                return JSONResponse(
                    {"detail": "Teacher permission required."},
                    status_code=403,
                )
        elif user.role != "admin":
            return JSONResponse(
                {"detail": "Administrator permission required."},
                status_code=403,
            )

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
            "active": u.is_active,
        }
        for u in users
    ]


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
            "class": db.get(models.SchoolClass, a.class_id).name,
            "subject": db.get(models.Subject, a.subject_id).name,
        }
        for a in assignments
    ]


class StaffCreate(BaseModel):
    first_name: str
    last_name: str
    category: str = Field(default="Teaching", pattern="^(Teaching|Non-teaching)$")
    position: str | None = None
    department: str | None = None
    phone: str | None = None
    email: str | None = None
    salary_amount: int | None = Field(default=None, ge=0)
    salary_frequency: str = Field(default="Monthly", pattern="^(Monthly|Termly|Weekly|Daily)$")

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
    }
    settings_columns = {c["name"] for c in inspector.get_columns("school_settings")} if "school_settings" in inspector.get_table_names() else set()
    staff_columns = {c["name"] for c in inspector.get_columns("staff_members")} if "staff_members" in inspector.get_table_names() else set()
    payment_columns = {c["name"] for c in inspector.get_columns("fee_payments")} if "fee_payments" in inspector.get_table_names() else set()
    with engine.begin() as connection:
        for name, sql_type in additions.items():
            if name not in existing: connection.execute(text("ALTER TABLE students ADD COLUMN " + name + " " + sql_type))
        if "staff_members" in inspector.get_table_names():
            if "salary_amount" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN salary_amount INTEGER"))
            if "salary_frequency" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN salary_frequency VARCHAR(20) NOT NULL DEFAULT 'Monthly'"))
        if "fee_payments" in inspector.get_table_names() and "receipt_number" not in payment_columns:
            connection.execute(text("ALTER TABLE fee_payments ADD COLUMN receipt_number VARCHAR(50)"))
        if "fee_payments" in inspector.get_table_names():
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_fee_payments_receipt_number ON fee_payments (receipt_number)"))
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
    name_only = any(u.get("column_names") == ["name"] for u in uniques)
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


@app.post("/api/staff", tags=["Staff"])
def create_staff(data: StaffCreate, db: Session = Depends(get_db)):
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
    query = db.query(models.FeeCharge, models.Student).join(models.Student, models.Student.id == models.FeeCharge.student_id)
    if class_id is not None:
        query = query.filter(models.Student.class_id == class_id)
    if stream:
        query = query.join(models.SchoolClass, models.SchoolClass.id == models.Student.class_id).filter(models.SchoolClass.section == stream)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(models.Student.admission_number.ilike(term), models.Student.first_name.ilike(term), models.Student.last_name.ilike(term)))
    results = []
    for charge, student in query.order_by(models.FeeCharge.year.desc(), models.FeeCharge.term, models.Student.last_name).limit(500).all():
        paid = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter(models.FeePayment.charge_id == charge.id).scalar() or 0
        balance = charge.amount - paid
        if outstanding_only and balance <= 0:
            continue
        school_class = db.get(models.SchoolClass, student.class_id) if student.class_id else None
        results.append({"id": charge.id, "student_id": student.id, "student_name": student.first_name + " " + student.last_name, "admission_number": student.admission_number, "class_id": student.class_id, "class_name": school_class.name if school_class else "", "stream": school_class.section if school_class else "", "term": charge.term, "year": charge.year, "amount": charge.amount, "paid": float(paid), "balance": float(balance)})
    return results


@app.post("/api/finance/payments", tags=["Finance"])
def record_fee_payment(data: FeePaymentCreate, db: Session = Depends(get_db)):
    charge = db.get(models.FeeCharge, data.charge_id)
    if not charge:
        raise HTTPException(404, "Fee charge not found.")
    paid = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter(models.FeePayment.charge_id == charge.id).scalar() or 0
    if data.amount > charge.amount - paid:
        raise HTTPException(400, "Payment exceeds the outstanding balance.")
    item = models.FeePayment(**data.model_dump(), receipt_number="RCPT-" + str(date.today().year) + "-" + uuid4().hex[:8].upper())
    db.add(item)
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
    db.commit()
    return {"message": "Academic settings saved.", **data.model_dump()}


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
def save_class_fee(class_id: int, data: ClassFeeUpdate, db: Session = Depends(get_db)):
    if not db.get(models.SchoolClass, class_id):
        raise HTTPException(404, "Class not found.")
    row = db.query(models.ClassFee).filter_by(
        class_id=class_id, term=data.term, year=data.year
    ).first()
    if row is None:
        row = models.ClassFee(class_id=class_id, **data.model_dump())
        db.add(row)
    else:
        row.amount = data.amount
    db.commit()
    db.refresh(row)
    return {"message": "Class fee saved.", "class_id": class_id,
            "term": row.term, "year": row.year, "amount": row.amount}


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
    return {
        "student": student,
        "class": db.get(models.SchoolClass, student.class_id).name if student.class_id and db.get(models.SchoolClass, student.class_id) else None,
        "fees": fee_history,
        "total_charged": sum(x["amount"] for x in fee_history),
        "total_paid": sum(x["paid"] for x in fee_history),
        "total_balance": sum(x["balance"] for x in fee_history),
    }


@app.patch("/api/students/{student_id}", tags=["Students"])
def update_student(student_id: int, data: StudentUpdate, db: Session = Depends(get_db)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    changes = data.model_dump(exclude_unset=True)
    if "class_id" in changes and changes["class_id"] is not None and not db.get(models.SchoolClass, changes["class_id"]):
        raise HTTPException(404, "Class not found.")
    for key, value in changes.items():
        setattr(student, key, value)
    db.commit()
    db.refresh(student)
    return {"message": "Student profile updated.", "student": student}


@app.patch("/api/students/{student_id}/status", tags=["Students"])
def change_student_status(student_id: int, status: str, db: Session = Depends(get_db)):
    if status not in {"active", "transferred", "dismissed", "inactive"}:
        raise HTTPException(422, "Status must be active, transferred, dismissed or inactive.")
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    student.status = status
    db.commit()
    return {"message": "Student status updated. Historical academic and financial records were retained.", "status": status}


class StaffUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
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
def update_staff(staff_id: int, data: StaffUpdate, db: Session = Depends(get_db)):
    staff = db.get(models.StaffMember, staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(staff, key, value)
    db.commit()
    db.refresh(staff)
    return {"message": "Staff profile updated.", "staff": staff}


@app.post("/api/staff/{staff_id}/archive", tags=["Staff"])
def archive_staff(staff_id: int, db: Session = Depends(get_db)):
    staff = db.get(models.StaffMember, staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    staff.status = "archived"
    db.commit()
    return {"message": "Staff member archived. Historical salary records were retained."}


@app.post("/api/finance/salary-payments", tags=["Finance"])
def record_salary_payment(data: SalaryPaymentCreate, db: Session = Depends(get_db)):
    staff = db.get(models.StaffMember, data.staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    payment = models.SalaryPayment(**data.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return {"id": payment.id, "staff_id": payment.staff_id, "amount": payment.amount, "payment_date": payment.payment_date, "period": payment.period}


@app.post("/api/finance/other-expenses", tags=["Finance"])
def record_other_expense(data: OtherExpenseCreate, db: Session = Depends(get_db)):
    expense = models.OtherExpense(**data.model_dump())
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@app.get("/api/finance/expenses", tags=["Finance"])
def finance_expenses(db: Session = Depends(get_db)):
    salary_total = db.query(func.coalesce(func.sum(models.SalaryPayment.amount), 0)).scalar() or 0
    other_total = db.query(func.coalesce(func.sum(models.OtherExpense.amount), 0)).scalar() or 0
    return {"salary_expenses": int(salary_total), "other_expenses": int(other_total), "total_expenses": int(salary_total + other_total)}
