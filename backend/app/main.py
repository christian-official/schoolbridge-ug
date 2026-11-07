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

from .database import Base, engine, get_db, SessionLocal
from .migrations import upgrade_database
from . import models

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
upgrade_database()

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
    fee_amount: int | None = Field(default=None, ge=0)


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
    student_data.pop("fee_amount", None)
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
        elif path in {"/api/teacher/my-assignments", "/api/teacher/students", "/api/teacher/attendance"}:
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
            "class_id": a.class_id,
            "class": db.get(models.SchoolClass, a.class_id).name + " — " + db.get(models.SchoolClass, a.class_id).section,
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
def dashboard_summary(db: Session = Depends(get_db)):
    settings = get_or_create_school_settings(db)
    academic_year = settings.academic_year or date.today().year
    year_start = date(academic_year, 1, 1)
    year_end = date(academic_year, 12, 31)
    return {
        "active_students": db.query(models.Student).filter(models.Student.status == "active").count(),
        "new_admissions_this_year": db.query(models.Student).filter(
            models.Student.admission_date >= year_start,
            models.Student.admission_date <= year_end,
        ).count(),
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
    for key, value in data.model_dump().items():
        setattr(profile, key, value)
    db.flush()
    write_audit(db, admin, "school_profile_updated", "school_profile", profile.id, profile.name)
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
