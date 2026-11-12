import os
import json
import re
import secrets
import hashlib
import hmac
from io import BytesIO
from urllib.parse import urlsplit
import qrcode
from qrcode.image.svg import SvgPathImage
import smtplib
from email.message import EmailMessage
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Response, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.convertors import Convertor, register_url_convertor
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import update, func, or_, text

from dotenv import load_dotenv

# Load the installed configuration before importing database.py, which captures
# SCHOOLBRIDGE_DATABASE_URL when its SQLAlchemy engine is created.
load_dotenv()

# Desktop builds provide a per-user data directory. Resolve its SQLite file before
# database.py creates the SQLAlchemy engine; this deliberately overrides any
# install-relative database URL shipped in the USB configuration template.
from .desktop_storage import configure_desktop_database
configure_desktop_database()

from .database import DATABASE_URL, Base, engine, get_db, SessionLocal, create_sqlite_backup, apply_sqlite_restore, sqlite_connection_diagnostics, set_tenant_context
from .migrations import upgrade_database
from . import models
from .sync_tracking import register_sync_tracking
from .school_setup import verify_activation_license, license_fingerprint
from .sms import send_schoolbridge_sms

import jwt
from datetime import timedelta, timezone
from pwdlib import PasswordHash
from jwt.exceptions import InvalidTokenError
from fastapi import Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

class FrontendPathConvertor(Convertor):
    # Keep API and framework routes out of the SPA fallback.
    regex = r"(?!(?:api|docs|redoc|openapi\.json)(?:/|$)).+"

    def convert(self, value: str) -> str:
        return value

    def to_string(self, value: str) -> str:
        return value


register_url_convertor("frontend", FrontendPathConvertor())

password_hash = PasswordHash.recommended()
JWT_SECRET = os.environ["SCHOOLBRIDGE_SECRET_KEY"]
JWT_ALGORITHM = "HS256"
TOKEN_HOURS = 8
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def get_current_tenant_id(db: Session) -> int:
    """Return the tenant already selected for this database session.

    Unauthenticated local-installation flows retain tenant 1 until the
    explicit public school-selection flow is introduced.
    """
    return int(db.info.get("school_tenant_id", 1))


def get_tenant_singleton(db: Session, model):
    """Load a school's one-per-tenant profile, settings, or setup record."""
    return db.query(model).filter(
        model.school_tenant_id == get_current_tenant_id(db)
    ).order_by(model.id).first()


def resolve_school_tenant(db: Session, school_id: str | None = None):
    """Select a school by its public QR identifier, never by a secret installation ID."""
    if school_id:
        tenant = db.query(models.SchoolTenant).filter(
            models.SchoolTenant.public_id == school_id
        ).first()
        if tenant is None:
            raise HTTPException(404, "The selected school could not be found.")
    else:
        tenants = db.query(models.SchoolTenant).order_by(
            models.SchoolTenant.id
        ).limit(2).all()
        if len(tenants) > 1:
            raise HTTPException(
                400, "Select your school using its official SchoolBridge access QR code."
            )
        tenant = tenants[0] if tenants else None

    set_tenant_context(db, tenant.id if tenant else 1)
    return tenant


def _registration_name_key(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def _registration_phone_key(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def _mask_registration_phone(value: str) -> str:
    digits = _registration_phone_key(value)
    if len(digits) < 4:
        return "••••"
    if digits.startswith("256"):
        return "+256 " + ("•" * max(3, len(digits) - 6)) + " " + digits[-3:]
    return ("•" * max(3, len(digits) - 3)) + digits[-3:]


def _registration_reference_hash(reference: str) -> str:
    return hashlib.sha256(reference.encode("utf-8")).hexdigest()


def _registration_code_hash(claim: models.RegistrationClaim, code: str) -> str:
    material = f"{claim.reference_hash}:{code}:{JWT_SECRET}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _create_registration_claim(
    db: Session,
    claim_type: str,
    submitted_name: str,
    details: dict,
    candidate_student_ids: list[int] | None = None,
    candidate_contact_ids: list[int] | None = None,
    candidate_staff_id: int | None = None,
    trusted_phone: str | None = None,
):
    reference = secrets.token_urlsafe(32)
    claim = models.RegistrationClaim(
        school_tenant_id=get_current_tenant_id(db),
        reference_hash=_registration_reference_hash(reference),
        claim_type=claim_type,
        status="pending_review",
        submitted_name=submitted_name,
        details_json=json.dumps(details, sort_keys=True),
        candidate_student_ids_json=json.dumps(candidate_student_ids or []),
        candidate_contact_ids_json=json.dumps(candidate_contact_ids or []),
        candidate_staff_id=candidate_staff_id,
        phone_masked=_mask_registration_phone(trusted_phone) if trusted_phone else None,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(claim)
    db.flush()

    if trusted_phone:
        code = f"{secrets.randbelow(1_000_000):06d}"
        claim.verification_code_hash = _registration_code_hash(claim, code)
        claim.verification_expires_at = datetime.utcnow() + timedelta(minutes=10)
        claim.status = "verification_pending"
        db.commit()
        delivered = send_schoolbridge_sms(
            trusted_phone,
            f"Your SchoolBridge verification code is {code}. It expires in 10 minutes. Do not share it.",
        )
        if not delivered:
            claim.status = "pending_review"
            claim.verification_code_hash = None
            claim.verification_expires_at = None
            db.commit()
    else:
        db.commit()
    db.refresh(claim)
    return reference, claim


def _match_parent_registration(db: Session, data: ParentSelfRegistrationRequest):
    student_ids: list[int] = []
    contact_ids: list[int] = []
    phones: list[str] = []
    automatic_match = True
    for child in data.children:
        query = db.query(models.Student).filter(
            models.Student.status == "active",
            func.lower(models.Student.first_name) == child.first_name.strip().lower(),
            func.lower(models.Student.last_name) == child.last_name.strip().lower(),
        )
        if child.admission_number:
            query = query.filter(
                func.lower(models.Student.admission_number) == child.admission_number.strip().lower()
            )
        if child.date_of_birth:
            query = query.filter(models.Student.date_of_birth == child.date_of_birth)
        if child.class_name:
            query = query.join(
                models.SchoolClass,
                models.Student.class_id == models.SchoolClass.id,
            ).filter(func.lower(models.SchoolClass.name) == child.class_name.strip().lower())
        matches = query.all()
        if len(matches) != 1:
            automatic_match = False
            continue
        student = matches[0]
        student_ids.append(student.id)
        contacts = db.query(models.StudentGuardianContact).filter(
            models.StudentGuardianContact.student_id == student.id,
            models.StudentGuardianContact.active.is_(True),
            models.StudentGuardianContact.verification_status == "school_verified",
            models.StudentGuardianContact.phone.isnot(None),
        ).all()
        matching_contacts = [
            contact for contact in contacts
            if _registration_name_key(contact.guardian_name) == _registration_name_key(data.parent_name)
            and (
                not data.relationship
                or _registration_name_key(contact.relationship) == _registration_name_key(data.relationship)
            )
        ]
        if len(matching_contacts) != 1:
            automatic_match = False
            continue
        contact = matching_contacts[0]
        contact_ids.append(contact.id)
        phones.append(contact.phone or "")

    normalized_phones = {_registration_phone_key(phone) for phone in phones if phone}
    trusted_phone = None
    if (
        automatic_match
        and len(student_ids) == len(data.children)
        and len(contact_ids) == len(data.children)
        and len(normalized_phones) == 1
    ):
        trusted_phone = phones[0]
    return student_ids, contact_ids, trusted_phone


def _match_teacher_registration(db: Session, data: TeacherSelfRegistrationRequest):
    query = db.query(models.StaffMember).filter(
        models.StaffMember.status == "active",
        func.lower(models.StaffMember.category).in_(["teaching", "teacher"]),
    )
    if data.staff_number:
        query = query.filter(
            func.lower(models.StaffMember.staff_number) == data.staff_number.strip().lower()
        )
    else:
        query = query.filter(
            func.lower(models.StaffMember.first_name) == data.first_name.strip().lower(),
            func.lower(models.StaffMember.last_name) == data.last_name.strip().lower(),
        )
        if data.position:
            query = query.filter(func.lower(models.StaffMember.position) == data.position.strip().lower())
        if data.department:
            query = query.filter(func.lower(models.StaffMember.department) == data.department.strip().lower())
    matches = query.all()
    if len(matches) != 1:
        return None, None
    staff = matches[0]
    trusted_phone = (
        staff.phone
        if staff.phone and staff.phone_verification_status == "school_verified"
        else None
    )
    return staff.id, trusted_phone


def sync_legacy_guardian_contacts(db: Session, student: models.Student) -> None:
    """Keep legacy guardian fields represented as explicitly unverified contacts."""
    for slot, name, relationship, phone, is_primary in (
        ("primary", student.guardian_name, student.guardian_relationship, student.guardian_phone, True),
        ("secondary", student.guardian2_name, student.guardian2_relationship, student.guardian2_phone, False),
    ):
        guardian_name = (name or "").strip()
        contact = db.query(models.StudentGuardianContact).filter_by(
            student_id=student.id, legacy_slot=slot
        ).first()
        if not guardian_name:
            if contact:
                contact.active = False
                contact.verification_status = "unverified"
                contact.verified_at = None
                contact.verified_by = None
            continue
        normalized_relationship = (relationship or "").strip() or None
        normalized_phone = (phone or "").strip() or None
        if contact is None:
            db.add(models.StudentGuardianContact(
                school_tenant_id=student.school_tenant_id,
                student_id=student.id,
                guardian_name=guardian_name,
                relationship=normalized_relationship,
                phone=normalized_phone,
                legacy_slot=slot,
                source="legacy_student_fields",
                verification_status="unverified",
                is_primary=is_primary,
                active=True,
            ))
            continue
        changed = (
            contact.guardian_name != guardian_name
            or contact.relationship != normalized_relationship
            or contact.phone != normalized_phone
        )
        contact.guardian_name = guardian_name
        contact.relationship = normalized_relationship
        contact.phone = normalized_phone
        contact.is_primary = is_primary
        contact.active = True
        if changed:
            contact.source = "legacy_student_fields"
            contact.verification_status = "unverified"
            contact.verified_at = None
            contact.verified_by = None




def token_version_matches(payload, user) -> bool:
    """Reject tokens issued before the account's most recent session revocation."""
    try:
        return int(payload.get("ver", 0)) == int(getattr(user, "token_version", 0) or 0)
    except (TypeError, ValueError):
        return False


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        tenant_id = int(payload["tenant"])
    except (InvalidTokenError, ValueError, KeyError, TypeError):
        raise HTTPException(401, "Invalid or expired login token.")
    user = db.query(models.User).filter(
        models.User.id == user_id,
        models.User.school_tenant_id == tenant_id,
    ).first()
    if not user or not user.is_active:
        raise HTTPException(401, "Account is unavailable.")
    if not token_version_matches(payload, user):
        raise HTTPException(401, "Invalid or expired login token.")
    try:
        from .database import set_tenant_context
        set_tenant_context(db, tenant_id)
    except ValueError:
        raise HTTPException(401, "Invalid or expired login token.")
    return user


PERMISSION_SECTIONS = {
    "Overview", "Students", "Staff", "Fees & Finance", "Examinations",
    "Attendance", "Staff Attendance", "Timetable", "Leadership & Duty",
    "Parent Access", "Parent Liaison", "Announcements", "Reports", "Settings",
    "My Classes", "My Attendance", "My Results", "School Community",
}
PERMISSION_ACTIONS = {"view", "add", "edit", "delete", "approve", "print"}
ADMIN_ONLY_PATHS = {
    "/api/auth/users", "/api/auth/teachers", "/api/auth/permissions",
    "/api/backups/restore",
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
            "Overview": {"view"}, "My Classes": {"view"},
            "My Attendance": {"view"}, "My Results": {"view", "add", "edit"},
            "Announcements": {"view"}, "Parent Liaison": {"view", "add", "edit"},
        }
    # DOS and designated academic officers manage the school-wide timetable.
    if (user.role_label or "").strip().lower() in {
        "academic administrator", "academics administrator", "academics officer",
        "director of studies", "dos", "deputy director of studies",
    }:
        clean.setdefault("Timetable", set()).update({"view", "add", "edit", "delete"})
    # Academic officers are responsible for reviewing and approving submitted marks.
    if (user.role_label or "").strip().lower() in {
        "academic administrator", "academics administrator", "academics officer",
        "director of studies", "dos", "deputy director of studies",
    }:
        clean.setdefault("Examinations", set()).update({"view", "approve"})
    return clean


def permission_for_path(path: str):
    if path.startswith(("/api/teacher/my-assignments", "/api/teacher/my-class-teacher-assignments", "/api/teacher/students")): return "My Classes"
    if path.startswith("/api/teacher/my-staff-attendance"): return "My Attendance"
    if path.startswith("/api/teacher/attendance"): return "Attendance"
    if path.startswith(("/api/teacher/marks", "/api/teacher/exams", "/api/teacher/result-status")): return "My Results"
    if path.startswith("/api/school-community"): return "School Community"
    if path.startswith("/api/students"): return "Students"
    if path.startswith(("/api/staff", "/api/teacher-assignments", "/api/class-teacher-assignments")): return "Staff"
    if path.startswith(("/api/finance", "/api/fees", "/api/salary", "/api/expenses")): return "Fees & Finance"
    if path.startswith(("/api/exams", "/api/marks", "/api/grades", "/api/subjects", "/api/grading-scale")): return "Examinations"
    if path.startswith("/api/attendance"): return "Attendance"
    if path.startswith("/api/staff-attendance"): return "Staff Attendance"
    if path.startswith("/api/timetable"): return "Timetable"
    if path.startswith(("/api/leadership", "/api/prefects", "/api/teacher-duties")): return "Leadership & Duty"
    if path.startswith("/api/parent-accounts"): return "Parent Access"
    if path.startswith("/api/parent-liaison"): return "Parent Liaison"
    if path.startswith("/api/announcements"): return "Announcements"
    if path.startswith("/api/reports"): return "Reports"
    if path.startswith(("/api/settings", "/api/backups", "/api/audit-logs")): return "Settings"
    if path.startswith("/api/dashboard"): return "Overview"
    if path.startswith("/api/classes"): return "Students"
    return None


def is_assigned_class_teacher(db: Session, teacher_id: int, class_id: int) -> bool:
    return db.query(models.ClassTeacherAssignment.id).filter_by(
        teacher_id=teacher_id, class_id=class_id
    ).first() is not None


def require_class_attendance_access(db: Session, user, class_id: int, action: str = "view"):
    if user.role == "admin":
        return
    if user.role == "teacher":
        if not is_assigned_class_teacher(db, user.id, class_id):
            raise HTTPException(403, "Only the teacher assigned as this class teacher may manage its attendance.")
        return
    if action not in user_permissions(user).get("Attendance", set()):
        raise HTTPException(403, "You do not have permission to access class attendance.")


def action_for_method(method: str, path: str = ""):
    if path.endswith("/archive") and method == "POST":
        return "delete"
    if method in {"PATCH", "PUT"} and (path.endswith("/verification") or "/approve" in path):
        return "approve"
    return {"GET": "view", "POST": "add", "PUT": "edit", "PATCH": "edit", "DELETE": "delete"}.get(method, "view")


def require_admin(request: Request, user=Depends(get_current_user)):
    path = request.url.path
    if user.role == "admin":
        return user
    if path in ADMIN_ONLY_PATHS or path.startswith("/api/auth/"):
        raise HTTPException(403, "Administrator permission required.")
    section = permission_for_path(path)
    action = action_for_method(request.method, path)
    if not section or action not in user_permissions(user).get(section, set()):
        raise HTTPException(403, "You do not have permission to perform this action.")
    return user


def is_academic_officer(user) -> bool:
    label = (user.role_label or "").strip().lower()
    return user.role == "admin" or label in {
        "academic administrator", "academics administrator", "academics officer",
        "director of studies", "dos", "deputy director of studies",
    }


def require_timetable_editor(request: Request, user=Depends(get_current_user)):
    if user.role == "admin":
        return user
    action = action_for_method(request.method, request.url.path)
    if not is_academic_officer(user) or action not in user_permissions(user).get("Timetable", set()):
        raise HTTPException(403, "Only the Academics Administrator or a designated academic officer may change the timetable.")
    return user


def apply_pending_database_restore():
    """Apply a staged SQLite restore before migrations or application sessions start."""
    import os
    from time import time_ns
    if engine.dialect.name != "sqlite":
        return
    db_path = engine.url.database
    if not db_path or db_path == ":memory:":
        return
    absolute_path = os.path.abspath(db_path)
    pending_path = absolute_path + ".restore_pending"
    if not os.path.isfile(pending_path):
        return

    # Startup restoration must not race with pooled connections left by imports
    # or earlier startup hooks.
    engine.dispose()
    safety_path = absolute_path + ".before_restore_" + str(time_ns()) + ".bak"
    apply_sqlite_restore(absolute_path, pending_path, safety_path)


register_sync_tracking()
apply_pending_database_restore()
upgrade_database(DATABASE_URL)


def seed_demo_data_if_empty():
    """Populate a fresh preview database with clearly labelled demo records."""
    if os.getenv("SCHOOLBRIDGE_SEED_DEMO_DATA", "false").lower() not in {"1", "true", "yes"}:
        return
    db = SessionLocal()
    try:
        profile = get_tenant_singleton(db, models.SchoolProfile)
        if profile is None:
            profile = models.SchoolProfile(school_tenant_id=get_current_tenant_id(db), name="SchoolBridge Demo School", school_type="Secondary")
            db.add(profile)
            db.flush()
        school_type = profile.school_type or "Secondary"

        classes = db.query(models.SchoolClass).all()
        if school_type == "Combined":
            class_names = [f"Primary {i}" for i in range(1, 8)] + [f"Senior {i}" for i in range(1, 7)]
        elif school_type == "Secondary":
            class_names = [f"S{i}" for i in range(1, 7)]
        else:
            class_names = [f"P{i}" for i in range(1, 8)]
        if not classes:
            classes = [models.SchoolClass(name=name, section="") for name in class_names]
            db.add_all(classes)
            db.flush()

        subject_types = ["Primary", "Secondary"] if school_type == "Combined" else [school_type]
        existing_subjects = {
            (item.school_type, item.name.lower())
            for item in db.query(models.Subject).filter(models.Subject.school_type.in_(subject_types)).all()
        }
        subject_catalogues = {
            "Secondary": ["Mathematics", "English", "Biology", "Chemistry", "Physics", "Geography", "History", "Christian Religious Education"],
            "Primary": ["English", "Mathematics", "Science", "Social Studies", "Literacy", "Religious Education"],
        }
        for subject_type in subject_types:
            for name in subject_catalogues[subject_type]:
                if (subject_type, name.lower()) not in existing_subjects:
                    db.add(models.Subject(name=name, school_type=subject_type))

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
            secondary_grade = re.search(r"(?:senior|s)[\s._-]*([1-6])$", class_name, re.IGNORECASE)
            if school_type in {"Secondary", "Combined"} and secondary_grade:
                level = "A-Level" if int(secondary_grade.group(1)) in {5, 6} else "O-Level"
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
            models.Subject.school_type.in_(subject_types)
        ).order_by(models.Subject.school_type, models.Subject.id).all()
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
                    class_curriculum = "Secondary" if re.search(r"(?:senior|s)[\s._-]*[1-6]$", school_class.name, re.IGNORECASE) else "Primary"
                    class_subjects = [item for item in timetable_subjects if item.school_type == class_curriculum] if school_type == "Combined" else timetable_subjects
                    subject = class_subjects[(day * 2 + period) % len(class_subjects)] if class_subjects else None
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
            models.Subject.school_type.in_(subject_types)
        ).order_by(models.Subject.school_type, models.Subject.id).all()
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
            class_curriculum = "Secondary" if re.search(r"(?:senior|s)[\s._-]*[1-6]$", school_class.name, re.IGNORECASE) else "Primary"
            class_demo_subjects = [item for item in demo_subjects if item.school_type == class_curriculum] if school_type == "Combined" else demo_subjects
            for student in class_students:
                for subject_index, subject in enumerate(class_demo_subjects[:4]):
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

# The optional LAN listener supplies its exact private-IP Host allow-list.
# Local desktop and hosted deployments retain their existing host behavior.
allowed_hosts = [host.strip() for host in os.getenv("SCHOOLBRIDGE_ALLOWED_HOSTS", "").split(",") if host.strip()]
if allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    section: str = Field(default="", max_length=40)


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str | None = Field(default=None, max_length=20)
    school_type: str | None = Field(default=None, pattern="^(Primary|Secondary)$")


class StudentCreate(BaseModel):
    admission_number: str | None = None
    generate_admission_number: bool = False
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
    guardian2_name: str | None = None
    guardian2_relationship: str | None = None
    guardian2_phone: str | None = None
    study_mode: str = Field(default="Day", pattern="^(Boarding|Day)$")
    house: str | None = None
    previous_school: str | None = None
    admission_date: date | None = None
    class_id: int | None = None
    fee_amount: int | None = Field(default=None, ge=0)
    academic_level: str | None = Field(default=None, pattern="^(O-Level|A-Level)$")
    combination: str | None = None
    optional_subjects: str | None = None
    subsidiary_subjects: str | None = None
    photo_data: str | None = Field(default=None, max_length=1_800_000)


class ParentRegistrationChild(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    admission_number: str | None = Field(default=None, max_length=40)
    date_of_birth: date | None = None
    class_name: str | None = Field(default=None, max_length=80)


class ParentSelfRegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    school_id: UUID
    parent_name: str = Field(min_length=2, max_length=160)
    relationship: str | None = Field(default=None, max_length=60)
    children: list[ParentRegistrationChild] = Field(min_length=1, max_length=10)


class TeacherSelfRegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    school_id: UUID
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    staff_number: str | None = Field(default=None, max_length=40)
    position: str | None = Field(default=None, max_length=100)
    department: str | None = Field(default=None, max_length=100)


class RegistrationClaimVerifyRequest(BaseModel):
    school_id: UUID
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class RegistrationClaimCompleteRequest(BaseModel):
    school_id: UUID
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=8, max_length=128)
    email: str | None = Field(default=None, max_length=150)


class RegistrationClaimDecisionRequest(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    student_ids: list[int] = Field(default_factory=list, max_length=10)
    staff_id: int | None = None
    note: str | None = Field(default=None, max_length=1000)


class GuardianContactCreate(BaseModel):
    guardian_name: str = Field(min_length=2, max_length=160)
    relationship: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=30)
    is_primary: bool = False


class GuardianContactVerificationUpdate(BaseModel):
    status: str = Field(pattern="^(school_verified|unverified|rejected)$")


class StudentDismissal(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
    effective_date: date = Field(default_factory=date.today)


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
    guardian2_name: str | None = None
    guardian2_relationship: str | None = None
    guardian2_phone: str | None = None
    study_mode: str | None = Field(default=None, pattern="^(Boarding|Day)$")
    house: str | None = None
    previous_school: str | None = None
    admission_date: date | None = None
    class_id: int | None = None
    photo_data: str | None = Field(default=None, max_length=1_800_000)
    status: str | None = Field(default=None, pattern="^(active|transferred|inactive)$")
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
    settings = get_tenant_singleton(db, models.SchoolSettings)
    if settings is None:
        settings = models.SchoolSettings(school_tenant_id=get_current_tenant_id(db))
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


class OfflineAttendanceBatchEntry(BaseModel):
    student_id: int
    status: str = Field(pattern="^(Present|Absent|Late|Excused)$")


class OfflineAttendanceBatchCreate(BaseModel):
    device_id: UUID
    idempotency_key: str = Field(min_length=8, max_length=100)
    class_id: int
    attendance_date: date
    base_sequence: int = Field(ge=0)
    base_attendance_ids: dict[int, int | None]
    records: list[OfflineAttendanceBatchEntry] = Field(min_length=1, max_length=500)

class StaffAttendanceEntry(BaseModel):
    staff_id: int
    status: str = Field(pattern="^(Present|Absent|Late|Excused)$")
    notes: str | None = Field(default=None, max_length=255)
    check_in_time: str | None = Field(default=None, pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")
    check_out_time: str | None = Field(default=None, pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")


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
    exam_type: str = Field(default="Other", min_length=2, max_length=40)
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
    status: str = "active"
    model_config = ConfigDict(from_attributes=True)


class AttendanceOut(AttendanceCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ExamOut(BaseModel):
    id: int
    name: str
    exam_type: str = "Other"
    term: str
    year: int
    class_id: int | None = None
    status: str = "draft"
    closed_at: datetime | None = None
    published_at: datetime | None = None
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


def _schoolbridge_static_directory() -> Path:
    configured = os.getenv("SCHOOLBRIDGE_STATIC_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parent / "static"


@app.get("/", include_in_schema=False)
def root():
    index = _schoolbridge_static_directory() / "index.html"
    if index.is_file():
        return FileResponse(index)
    return {"message": "SchoolBridge API is running. Visit /docs for API documentation."}


@app.get("/api/health", tags=["System"])
def health_check(response: Response):
    database_type = engine.dialect.name
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            database_info = {"status": "connected", "type": database_type}
            if database_type == "sqlite":
                database_info.update(sqlite_connection_diagnostics(connection))
                database_info["deployment_mode"] = "single_host"
                database_info["network_shared_database_supported"] = False
            else:
                database_info["deployment_mode"] = "multi_host"
                database_info["network_shared_database_supported"] = True
    except Exception:
        response.status_code = 503
        return {
            "status": "degraded",
            "application": "SchoolBridge",
            "version": "0.2.0",
            "database": {"status": "unavailable", "type": database_type},
        }
    return {
        "status": "ok",
        "application": "SchoolBridge",
        "version": "0.2.0",
        "database": database_info,
    }


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
    linked_class_teacher = db.query(models.ClassTeacherAssignment).filter(models.ClassTeacherAssignment.class_id == class_id).count()
    if linked_students or linked_fees or linked_assignments or linked_class_teacher:
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
    profile = get_tenant_singleton(db, models.SchoolProfile)
    school_type = profile.school_type if profile else "Secondary"
    if school_type == "Combined":
        if data.school_type not in {"Primary", "Secondary"}:
            raise HTTPException(422, "Choose whether this subject belongs to the Primary or Secondary curriculum.")
        subject_type = data.school_type
    else:
        subject_type = school_type
        if data.school_type and data.school_type != subject_type:
            raise HTTPException(422, "The selected subject curriculum does not match this school's type.")
    existing = db.query(models.Subject).filter(
        models.Subject.school_type == subject_type,
        func.lower(models.Subject.name) == data.name.strip().lower(),
    ).first()
    if existing:
        raise HTTPException(409, "That subject already exists for this curriculum.")
    item = models.Subject(name=data.name.strip(), code=data.code, school_type=subject_type)
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
    profile = get_tenant_singleton(db, models.SchoolProfile)
    school_type = profile.school_type if profile else "Secondary"
    allowed_types = ["Primary", "Secondary"] if school_type == "Combined" else [school_type]
    return db.query(models.Subject).filter(
        models.Subject.school_type.in_(allowed_types)
    ).order_by(models.Subject.school_type, models.Subject.name).all()


@app.post("/api/students", response_model=StudentOut, tags=["Students"])
def create_student(data: StudentCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if data.photo_data is not None:
        validate_profile_photo(data.photo_data)
    if not data.first_name.strip() or not data.last_name.strip():
        raise HTTPException(422, "Enter the student's first and last names before registering.")
    if not data.gender or not data.gender.strip():
        raise HTTPException(422, "Select the student's gender before registering.")
    if not data.guardian_name or not data.guardian_name.strip():
        raise HTTPException(422, "Enter a parent or guardian name before registering.")
    if data.class_id is None:
        raise HTTPException(422, "Select a class before registering the student.")
    selected_class = db.get(models.SchoolClass, data.class_id)
    if not selected_class:
        raise HTTPException(404, "Choose a valid class.")
    profile = get_tenant_singleton(db, models.SchoolProfile)
    school_type = profile.school_type if profile else "Secondary"
    class_label = re.sub(r"[\s._-]+", "", selected_class.name.lower())
    level_match = re.search(r"(?:senior|s)?([1-6])$", class_label)
    if school_type in {"Secondary", "Combined"} and level_match:
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
    supplied_number = (student_data.pop("admission_number") or "").strip() or None
    generate_number = bool(student_data.pop("generate_admission_number", False))
    item = models.Student(**student_data, admission_number=supplied_number)
    db.add(item)
    try:
        db.flush()
        if generate_number and not supplied_number:
            settings = get_or_create_school_settings(db)
            next_value = db.execute(
                update(models.SchoolSettings)
                .where(models.SchoolSettings.school_tenant_id == get_current_tenant_id(db))
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
        sync_legacy_guardian_contacts(db, item)
        if item.class_id is not None:
            school_settings = get_or_create_school_settings(db)
            active_term = school_settings.active_term
            active_year = school_settings.academic_year or date.today().year
            class_fee = db.query(models.ClassFee).filter_by(
                class_id=item.class_id, term=active_term, year=active_year
            ).first()
            default_fee = (class_fee.boarding_amount if item.study_mode == "Boarding" else class_fee.day_amount) if class_fee else None
            if default_fee is None and class_fee: default_fee = class_fee.amount
            selected_fee = data.fee_amount if data.fee_amount is not None else (default_fee or 0)
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
def list_students(status: str = "active", db: Session = Depends(get_db), admin=Depends(require_admin)):
    if status not in {"active", "dismissed", "transferred", "inactive", "all"}:
        raise HTTPException(422, "Choose a valid student status.")
    query = db.query(models.Student)
    if status != "all":
        query = query.filter(models.Student.status == status)
    return query.order_by(models.Student.last_name, models.Student.first_name).all()



@app.get("/api/attendance/options", tags=["Attendance"])
def attendance_options(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role == "teacher":
        class_ids = [row.class_id for row in db.query(models.ClassTeacherAssignment.class_id).filter_by(teacher_id=user.id).all()]
        classes = db.query(models.SchoolClass).filter(models.SchoolClass.id.in_(class_ids or [-1])).order_by(
            models.SchoolClass.name, models.SchoolClass.section
        ).all()
    else:
        classes = db.query(models.SchoolClass).order_by(models.SchoolClass.name, models.SchoolClass.section).all()
    return [{"id": row.id, "name": row.name, "section": row.section} for row in classes]


@app.get("/api/attendance/students", tags=["Attendance"])
def attendance_students(class_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require_class_attendance_access(db, user, class_id, "view")
    return db.query(models.Student).filter(
        models.Student.class_id == class_id, models.Student.status == "active"
    ).order_by(models.Student.last_name, models.Student.first_name).all()


@app.post("/api/attendance", response_model=AttendanceOut, tags=["Attendance"])
def record_attendance(data: AttendanceCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    student = db.get(models.Student, data.student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    require_class_attendance_access(db, user, student.class_id, "add")
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
    if not class_id:
        raise HTTPException(422, "Choose a class to view its attendance register.")
    require_class_attendance_access(db, user, class_id, "view")
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
    if not class_id:
        raise HTTPException(422, "Choose a class to view its attendance summary.")
    require_class_attendance_access(db, user, class_id, "view")
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


def require_exam_open(exam: models.Exam) -> None:
    if exam.status != "draft":
        raise HTTPException(409, "This examination is closed. Marks can no longer be changed.")


@app.post("/api/exams/{exam_id}/close", tags=["Exams"])
def close_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    exam = db.get(models.Exam, exam_id)
    if not exam:
        raise HTTPException(404, "Examination not found.")
    if exam.status != "draft":
        raise HTTPException(409, "Only a draft examination can be closed.")
    marks = db.query(models.Mark).filter(models.Mark.exam_id == exam.id).all()
    if not marks:
        raise HTTPException(409, "Results must be entered before this examination can be closed.")
    if any(not mark.verified for mark in marks):
        raise HTTPException(409, "All examination results must be verified before the examination can be closed.")
    exam.status = "closed"
    exam.closed_at = datetime.utcnow()
    write_audit(db, admin, "exam_closed", "exam", exam.id, f"{exam.name}; class={exam.class_id}")
    db.commit()
    db.refresh(exam)
    return {"id": exam.id, "status": exam.status, "closed_at": exam.closed_at}


@app.post("/api/exams/{exam_id}/publish", tags=["Exams"])
def publish_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    exam = db.get(models.Exam, exam_id)
    if not exam:
        raise HTTPException(404, "Examination not found.")
    if exam.status != "closed":
        raise HTTPException(409, "Close and verify the examination before publishing results.")
    exam.status = "published"
    exam.published_at = datetime.utcnow()
    write_audit(db, admin, "exam_results_published", "exam", exam.id, f"{exam.name}; class={exam.class_id}")
    db.commit()
    db.refresh(exam)
    return {"id": exam.id, "status": exam.status, "published_at": exam.published_at}


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
    require_exam_open(exam)
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
    if exam:
        require_exam_open(exam)
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
    exam = db.get(models.Exam, item.exam_id)
    if exam:
        require_exam_open(exam)
    item.verified = verified
    write_audit(
        db, admin, "mark_verified" if verified else "mark_unlocked",
        "mark", item.id,
        f"exam={item.exam_id}; student={item.student_id}; subject={item.subject_id}",
    )
    db.commit()
    db.refresh(item)
    return item

@app.patch("/api/subjects/{subject_id}/marks/verification", tags=["Marks"])
def verify_subject_marks_batch(
    subject_id: int,
    exam_id: int,
    verified: bool = True,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    exam = db.get(models.Exam, exam_id)
    subject = db.get(models.Subject, subject_id)
    if not exam or not subject:
        raise HTTPException(404, "Examination or subject not found.")
    require_exam_open(exam)
    query = db.query(models.Mark).filter(
        models.Mark.exam_id == exam_id,
        models.Mark.subject_id == subject_id,
    )
    if exam.class_id is not None:
        query = query.join(models.Student, models.Student.id == models.Mark.student_id).filter(
            models.Student.class_id == exam.class_id
        )
    rows = query.all()
    if not rows:
        raise HTTPException(404, "There are no recorded scores for this subject and examination to update.")
    changed = 0
    for mark in rows:
        if mark.verified != verified:
            mark.verified = verified
            changed += 1
    write_audit(
        db, admin, "subject_marks_verified" if verified else "subject_marks_unlocked",
        "subject_marks", subject_id,
        f"exam={exam_id}; subject={subject.name}; records={len(rows)}; changed={changed}",
    )
    db.commit()
    return {"exam_id": exam_id, "subject_id": subject_id, "verified": verified, "records": len(rows), "changed": changed}


@app.patch("/api/exams/{exam_id}/results/verification", tags=["Marks"])
def verify_exam_results_batch(
    exam_id: int,
    verified: bool = True,
    db: Session = Depends(get_db),
    approver=Depends(require_admin),
):
    exam = db.get(models.Exam, exam_id)
    if not exam:
        raise HTTPException(404, "Examination not found.")
    require_exam_open(exam)
    query = db.query(models.Mark).filter(models.Mark.exam_id == exam_id)
    if exam.class_id is not None:
        query = query.join(models.Student, models.Student.id == models.Mark.student_id).filter(
            models.Student.class_id == exam.class_id
        )
    rows = query.all()
    if not rows:
        raise HTTPException(404, "There are no submitted results for this examination.")
    changed = 0
    for mark in rows:
        if mark.verified != verified:
            mark.verified = verified
            changed += 1
    write_audit(
        db, approver, "exam_results_verified" if verified else "exam_results_unlocked",
        "exam", exam.id,
        f"records={len(rows)}; changed={changed}; class={exam.class_id}",
    )
    db.commit()
    return {"exam_id": exam.id, "verified": verified, "records": len(rows), "changed": changed}


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
    """Retain legacy environment bootstrap only for already-initialised installations."""
    setup_probe = SessionLocal()
    try:
        setup_state = get_tenant_singleton(setup_probe, models.SchoolSetupState)
        if not setup_state or not setup_state.setup_completed_at:
            return
    finally:
        setup_probe.close()

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
        setup_state = get_tenant_singleton(db, models.SchoolSetupState)
        if not setup_state or not setup_state.setup_completed_at:
            return
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

class SyncChangeProposalCreate(BaseModel):
    device_id: UUID
    idempotency_key: str = Field(min_length=16, max_length=100)
    entity_type: str = Field(min_length=1, max_length=40)
    entity_id: int | None = Field(default=None, ge=1)
    operation: str = Field(pattern="^(create|update|delete)$")
    base_sequence: int = Field(ge=0)
    payload: dict = Field(default_factory=dict)


class SyncChangeProposalResolution(BaseModel):
    device_id: UUID
    decision: str = Field(pattern="^(discard|rebase)$")


class EnrolmentInvitationCreate(BaseModel):
    user_id: int = Field(ge=1)
    expires_in_minutes: int = Field(default=60, ge=5, le=10080)


class EnrolmentRedeemRequest(BaseModel):
    token: str = Field(min_length=30, max_length=200)
    device_id: UUID
    device_name: str = Field(min_length=1, max_length=100)


class SyncDeviceRegistration(BaseModel):
    device_id: UUID
    device_name: str = Field(min_length=1, max_length=100)


class LoginInput(BaseModel):
    username: str
    password: str


class TeacherCreate(BaseModel):
    staff_id: int
    username: str = Field(min_length=3, max_length=80)
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=12)


class AssignmentCreate(BaseModel):
    teacher_id: int
    class_id: int
    subject_id: int

class ClassTeacherAssignmentCreate(BaseModel):
    teacher_id: int
    class_id: int


class BulkMarkEntry(BaseModel):
    student_id: int
    score: float = Field(ge=0, le=100)


class BulkMarkCreate(BaseModel):
    exam_id: int
    subject_id: int
    records: list[BulkMarkEntry] = Field(min_length=1, max_length=500)


class ParentAccountCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: str = Field(min_length=5, max_length=150)
    student_ids: list[int] = Field(min_length=1, max_length=10)




class ParentLiaisonThreadCreate(BaseModel):
    student_id: int
    parent_user_id: int | None = None
    subject: str = Field(min_length=3, max_length=160)
    category: str = Field(default="General enquiry", pattern="^(Academic performance|Attendance|Behaviour and discipline|Fees and payments|Meeting request|General enquiry)$")
    message: str = Field(min_length=2, max_length=5000)


class ParentLiaisonMessageCreate(BaseModel):
    message: str = Field(min_length=2, max_length=5000)


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
    if student.status != "active":
        raise HTTPException(404, "This student is no longer active on the parent portal.")
    return student


def create_access_token(user):
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    payload = {
        "sub": str(user.id),
        "tenant": int(getattr(user, "school_tenant_id", 1) or 1),
        "role": user.role,
        "ver": int(getattr(user, "token_version", 0) or 0),
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
    require_class_attendance_access(db, user, data.class_id, "add")
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




@app.get("/api/sync/attendance-baseline", tags=["Offline Synchronisation"])
def get_offline_attendance_baseline(
    device_id: UUID, class_id: int, attendance_date: date,
    db: Session = Depends(get_db), user=Depends(get_current_user),
):
    device = _sync_active_device(db, user, device_id)
    if not db.get(models.SchoolClass, class_id):
        raise HTTPException(404, "Class not found.")
    require_class_attendance_access(db, user, class_id, "view")
    permissions = user_permissions(user)
    if user.role == "teacher":
        if "view" not in permissions.get("My Attendance", set()) and "view" not in permissions.get("Attendance", set()):
            raise HTTPException(403, "You do not have permission to view this attendance register.")
    elif user.role != "admin" and "view" not in permissions.get("Attendance", set()):
        raise HTTPException(403, "You do not have permission to view this attendance register.")
    student_ids = [row[0] for row in db.query(models.Student.id).filter(
        models.Student.class_id == class_id, models.Student.status == "active"
    ).all()]
    rows = db.query(models.Attendance).filter(
        models.Attendance.student_id.in_(student_ids or [-1]),
        models.Attendance.attendance_date == attendance_date,
    ).all()
    sequence = db.query(func.max(models.SyncChange.id)).scalar() or 0
    device.last_issued_sequence = max(device.last_issued_sequence, sequence)
    db.commit()
    return {"class_id": class_id, "attendance_date": attendance_date,
            "base_sequence": sequence,
            "base_attendance_ids": {str(student_id): next((row.id for row in rows if row.student_id == student_id), None) for student_id in student_ids}}


@app.post("/api/sync/attendance-batches", tags=["Offline Synchronisation"])
def submit_offline_attendance_batch(data: OfflineAttendanceBatchCreate,
                                    db: Session = Depends(get_db),
                                    user=Depends(get_current_user)):
    device = _sync_active_device(db, user, data.device_id)
    if data.base_sequence > device.last_issued_sequence:
        raise HTTPException(409, "The attendance baseline has not been issued to this device.")
    student_ids = [entry.student_id for entry in data.records]
    if len(student_ids) != len(set(student_ids)):
        raise HTTPException(422, "A student can appear only once in an offline attendance register.")
    baseline = {int(key): value for key, value in data.base_attendance_ids.items()}
    payload = json.dumps({
        "class_id": data.class_id, "attendance_date": data.attendance_date.isoformat(),
        "base_attendance_ids": baseline, "records": [entry.model_dump() for entry in data.records],
    }, sort_keys=True, separators=(",", ":"))
    if len(payload.encode("utf-8")) > 32768:
        raise HTTPException(413, "Offline attendance payload exceeds 32 KB.")
    old = db.query(models.SyncChangeProposal).filter_by(user_id=user.id, idempotency_key=data.idempotency_key).first()
    if old:
        same = (old.device_id == str(data.device_id) and old.entity_type == "AttendanceBatch"
                and old.entity_id == data.class_id and old.operation == "update"
                and old.base_sequence == data.base_sequence and old.payload_json == payload)
        if not same:
            raise HTTPException(409, "Idempotency key already used for different attendance content.")
        return {"proposal_id": old.id, "status": old.status, "duplicate": True,
                "applied": old.status == "applied", "saved": len(data.records) if old.status == "applied" else 0}
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")
    existing = db.query(models.Attendance).filter(
        models.Attendance.student_id.in_(student_ids),
        models.Attendance.attendance_date == data.attendance_date,
    ).with_for_update().all()
    existing_by_student = {row.student_id: row for row in existing}
    needs_add = any(student_id not in existing_by_student for student_id in student_ids)
    needs_edit = any(student_id in existing_by_student for student_id in student_ids)
    permissions = user_permissions(user)
    if user.role == "admin":
        pass
    elif user.role == "teacher":
        require_class_attendance_access(db, user, data.class_id, "add" if needs_add else "edit")
        allowed = permissions.get("My Attendance", set()) | permissions.get("Attendance", set())
        if (needs_add and "add" not in allowed) or (needs_edit and "edit" not in allowed):
            raise HTTPException(403, "Your current attendance permissions do not allow this register.")
    else:
        if needs_add: require_class_attendance_access(db, user, data.class_id, "add")
        if needs_edit: require_class_attendance_access(db, user, data.class_id, "edit")
        allowed = permissions.get("Attendance", set())
        if (needs_add and "add" not in allowed) or (needs_edit and "edit" not in allowed):
            raise HTTPException(403, "Your current attendance permissions do not allow this register.")
    students = db.query(models.Student).filter(
        models.Student.id.in_(student_ids), models.Student.class_id == data.class_id,
        models.Student.status == "active",
    ).all()
    if len(students) != len(student_ids):
        raise HTTPException(422, "Every submitted student must be active and belong to the selected class.")
    if set(baseline) != set(student_ids):
        raise HTTPException(422, "The attendance baseline must include every submitted student.")
    conflict = any(
        baseline[student_id] != (existing_by_student[student_id].id if student_id in existing_by_student else None)
        for student_id in student_ids
    )
    if not conflict:
        conflict = db.query(models.SyncChange.id).filter(
            models.SyncChange.id > data.base_sequence,
            models.SyncChange.entity_type == f"AttendanceScope:{data.attendance_date.isoformat()}",
            models.SyncChange.entity_id.in_(student_ids),
        ).first() is not None
    row = models.SyncChangeProposal(
        user_id=user.id, device_id=device.device_id, idempotency_key=data.idempotency_key,
        entity_type="AttendanceBatch", entity_id=data.class_id, operation="update",
        payload_json=payload, base_sequence=data.base_sequence,
        status="conflict" if conflict else "applied",
        resolution="system_conflict" if conflict else "system_auto_apply",
        resolved_at=datetime.utcnow(),
    )
    db.add(row)
    try:
        db.flush()
        if conflict:
            write_audit(db, user, "offline_attendance_rejected", "sync_change_proposal", row.id,
                        f"class={data.class_id}; date={data.attendance_date}; records={len(data.records)}; reason=baseline_conflict")
            db.commit()
            return {"proposal_id": row.id, "status": "conflict", "duplicate": False, "applied": False, "saved": 0}
        for entry in data.records:
            attendance = existing_by_student.get(entry.student_id)
            if attendance:
                attendance.status = entry.status
            else:
                db.add(models.Attendance(student_id=entry.student_id, attendance_date=data.attendance_date, status=entry.status))
        write_audit(db, user, "offline_attendance_auto_applied", "sync_change_proposal", row.id,
                    f"class={data.class_id}; date={data.attendance_date}; records={len(data.records)}")
        db.commit()
        return {"proposal_id": row.id, "status": "applied", "duplicate": False, "applied": True, "saved": len(data.records)}
    except IntegrityError:
        db.rollback()
        old = db.query(models.SyncChangeProposal).filter_by(user_id=user.id, idempotency_key=data.idempotency_key).first()
        if (old and old.payload_json == payload and old.device_id == str(data.device_id)
                and old.entity_type == "AttendanceBatch" and old.entity_id == data.class_id
                and old.operation == "update" and old.base_sequence == data.base_sequence):
            return {"proposal_id": old.id, "status": old.status, "duplicate": True,
                    "applied": old.status == "applied", "saved": len(data.records) if old.status == "applied" else 0}
        raise HTTPException(409, "Offline attendance submission collision; retry using the same request.")


@app.get("/api/staff-attendance/roster", tags=["Attendance"])
def staff_attendance_roster(db: Session = Depends(get_db), admin=Depends(require_admin)):
    rows = db.query(models.StaffMember).filter_by(status="active").order_by(
        models.StaffMember.category, models.StaffMember.first_name, models.StaffMember.last_name
    ).all()
    return [{
        "id": row.id, "first_name": row.first_name, "last_name": row.last_name,
        "staff_number": row.staff_number, "category": row.category, "status": row.status,
    } for row in rows]


@app.get("/api/staff-attendance", tags=["Attendance"])
def list_staff_attendance(
    attendance_date: date | None = None,
    month: str | None = None,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    query = db.query(models.StaffAttendance)
    if attendance_date:
        query = query.filter(models.StaffAttendance.attendance_date == attendance_date)
    elif month:
        try:
            month_start = datetime.strptime(month, "%Y-%m").date()
        except ValueError:
            raise HTTPException(422, "Month must use YYYY-MM format.")
        next_month = date(month_start.year + (month_start.month == 12), 1 if month_start.month == 12 else month_start.month + 1, 1)
        query = query.filter(
            models.StaffAttendance.attendance_date >= month_start,
            models.StaffAttendance.attendance_date < next_month,
        )
    rows = query.order_by(models.StaffAttendance.attendance_date.desc(), models.StaffAttendance.id.desc()).all()
    return [{
        "id": row.id, "staff_id": row.staff_id, "attendance_date": row.attendance_date,
        "status": row.status, "notes": row.notes,
        "check_in_at": row.check_in_at, "check_out_at": row.check_out_at,
    } for row in rows]


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
            if "check_in_time" in entry.model_fields_set:
                record.check_in_at = datetime.combine(data.attendance_date, time.fromisoformat(entry.check_in_time)) if entry.check_in_time else None
            if "check_out_time" in entry.model_fields_set:
                record.check_out_at = datetime.combine(data.attendance_date, time.fromisoformat(entry.check_out_time)) if entry.check_out_time else None
        else:
            db.add(models.StaffAttendance(
                staff_id=entry.staff_id,
                attendance_date=data.attendance_date,
                status=entry.status,
                notes=entry.notes,
                check_in_at=datetime.combine(data.attendance_date, time.fromisoformat(entry.check_in_time)) if entry.check_in_time else None,
                check_out_at=datetime.combine(data.attendance_date, time.fromisoformat(entry.check_out_time)) if entry.check_out_time else None,
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
    # Fetch lesson details in one joined query instead of issuing three extra
    # database lookups for every timetable row.
    query = (
        db.query(
            models.TimetableEntry,
            models.SchoolClass,
            models.Subject,
            models.StaffMember,
        )
        .join(models.SchoolClass, models.TimetableEntry.class_id == models.SchoolClass.id)
        .outerjoin(models.Subject, models.TimetableEntry.subject_id == models.Subject.id)
        .outerjoin(models.StaffMember, models.TimetableEntry.staff_id == models.StaffMember.id)
    )
    # Timetable view permission grants access to the complete class timetable,
    # not only the lessons personally taught by the signed-in teacher. This lets
    # teachers and read-only staff see every subject, teacher and period in a class.
    if user.role != "admin" and "view" not in user_permissions(user).get("Timetable", set()):
        raise HTTPException(403, "You do not have permission to view the timetable.")
    if class_id:
        query = query.filter(models.TimetableEntry.class_id == class_id)
    rows = query.order_by(
        models.TimetableEntry.day_of_week,
        models.TimetableEntry.start_time,
        models.TimetableEntry.id,
    ).all()
    return [
        {
            "id": entry.id,
            "class_id": entry.class_id,
            "class_name": school_class.name,
            "class_section": school_class.section or "",
            "subject_id": entry.subject_id,
            "subject_name": subject.name if subject else "Lesson",
            "staff_id": entry.staff_id,
            "teacher_name": (staff.first_name + " " + staff.last_name) if staff else "Unassigned",
            "day_of_week": entry.day_of_week,
            "start_time": entry.start_time,
            "end_time": entry.end_time,
        }
        for entry, school_class, subject, staff in rows
    ]

@app.get("/api/timetable/options", tags=["Timetable"])
def timetable_options(db: Session = Depends(get_db), user=Depends(get_current_user)):
    # Any account with Timetable:view can browse the complete class timetable.
    # The edit form and write endpoints remain restricted to academic officers.
    if user.role != "admin" and "view" not in user_permissions(user).get("Timetable", set()):
        raise HTTPException(403, "You do not have permission to view timetable options.")
    classes_query = db.query(models.SchoolClass)
    subjects_query = db.query(models.Subject)
    staff = []
    if user.role == "admin" or is_academic_officer(user):
        staff = db.query(models.StaffMember).filter_by(category="Teaching", status="active").order_by(
            models.StaffMember.first_name, models.StaffMember.last_name
        ).all()
    classes = classes_query.order_by(models.SchoolClass.name, models.SchoolClass.section).all()
    subjects = subjects_query.order_by(models.Subject.name).all()
    return {
        "classes": [{"id": row.id, "name": row.name, "section": row.section} for row in classes],
        "subjects": [{"id": row.id, "name": row.name, "code": row.code} for row in subjects],
        "staff": [{"id": row.id, "first_name": row.first_name, "last_name": row.last_name,
                   "staff_number": row.staff_number, "category": row.category, "status": row.status} for row in staff],
    }


@app.post("/api/timetable", tags=["Timetable"])
def create_timetable_entry(
    data: TimetableEntryCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_timetable_editor),
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


@app.put("/api/timetable/{entry_id}", tags=["Timetable"])
def update_timetable_entry(entry_id: int, data: TimetableEntryCreate, db: Session = Depends(get_db),
                           academic=Depends(require_timetable_editor)):
    item = db.get(models.TimetableEntry, entry_id)
    if not item:
        raise HTTPException(404, "Timetable entry not found.")
    if data.end_time <= data.start_time:
        raise HTTPException(422, "Lesson end time must be later than its start time.")
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")
    if data.subject_id is not None and not db.get(models.Subject, data.subject_id):
        raise HTTPException(404, "Subject not found.")
    if data.staff_id is not None:
        staff = db.get(models.StaffMember, data.staff_id)
        if not staff or staff.status != "active" or staff.category != "Teaching":
            raise HTTPException(404, "Select an active teaching staff member.")
    overlaps = db.query(models.TimetableEntry).filter(
        models.TimetableEntry.class_id == data.class_id,
        models.TimetableEntry.day_of_week == data.day_of_week,
        models.TimetableEntry.id != entry_id,
        models.TimetableEntry.start_time < data.end_time,
        models.TimetableEntry.end_time > data.start_time,
    ).first()
    if overlaps:
        raise HTTPException(409, "This lesson overlaps another lesson for the same class.")
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    write_audit(db, academic, "timetable_entry_updated", "timetable_entry", item.id,
                f"Class {data.class_id}; day {data.day_of_week}; {data.start_time}-{data.end_time}")
    db.commit()
    db.refresh(item)
    return item


@app.delete("/api/timetable/{entry_id}", tags=["Timetable"])
def delete_timetable_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_timetable_editor),
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
    public_paths = {"/api/health", "/api/auth/login", "/api/setup/status", "/api/setup/activate", "/api/setup/complete", "/api/public/school", "/api/public/registration"}

    # Browser CORS preflight requests must reach CORSMiddleware without auth.
    if request.method == "OPTIONS":
        return await call_next(request)

    if not path.startswith("/api/") or path in public_paths or path.startswith("/api/public/registration/") or path in {"/api/auth/password-reset/request", "/api/auth/password-reset/confirm"}:
        return await call_next(request)

    from starlette.responses import JSONResponse

    auth = request.headers.get("Authorization", "")
    tenant_id = 1
    if auth.startswith("Bearer "):
        try:
            claims = jwt.decode(auth[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM])
            tenant_id = int(claims["tenant"])
        except (InvalidTokenError, KeyError, TypeError, ValueError):
            # The authentication dependency returns the standard 401 response.
            pass

    setup_db = SessionLocal()
    try:
        from .database import set_tenant_context
        set_tenant_context(setup_db, tenant_id)
        setup_state = get_tenant_singleton(setup_db, models.SchoolSetupState)
        if not setup_state or not setup_state.setup_completed_at:
            return JSONResponse({"detail": "Complete SchoolBridge first-time setup before accessing school records."}, status_code=403)
    finally:
        setup_db.close()

    if not auth.startswith("Bearer "):
        return JSONResponse({"detail": "Login required."}, status_code=401)

    db = SessionLocal()
    try:
        try:
            payload = jwt.decode(
                auth[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM]
            )
            user_id = int(payload["sub"])
            tenant_id = int(payload["tenant"])
            from .database import set_tenant_context
            set_tenant_context(db, tenant_id)
        except (InvalidTokenError, ValueError, KeyError, TypeError):
            return JSONResponse(
                {"detail": "Invalid or expired login token."},
                status_code=401,
            )

        # Always load the current account from the token's school tenant.
        # Never trust a role stored in a token: account deactivation and role
        # changes must take effect immediately, even for tokens issued earlier.
        user = db.query(models.User).filter(
            models.User.id == user_id,
            models.User.school_tenant_id == tenant_id,
        ).first()
        if not user or not user.is_active:
            return JSONResponse(
                {"detail": "Account is unavailable."}, status_code=401
            )
        if not token_version_matches(payload, user):
            return JSONResponse(
                {"detail": "Invalid or expired login token."}, status_code=401
            )

        if user.must_change_password and path not in {"/api/auth/me", "/api/me/password"}:
            return JSONResponse({"detail": "Password change required. Set a new password before continuing."}, status_code=403)

        if path == "/api/auth/me" or path.startswith("/api/me/") or path == "/api/dashboard/my-work":
            # Self-service profile, password and personal dashboard endpoints
            # are scoped to the authenticated account.
            pass
        elif path == "/api/enrolment/redeem" or path == "/api/sync/devices" or path.startswith("/api/sync/devices/") or path in {"/api/sync/changes", "/api/sync/students", "/api/sync/classes", "/api/sync/attendance", "/api/sync/exams", "/api/sync/marks", "/api/sync/fees", "/api/sync/proposals", "/api/sync/attendance-baseline", "/api/sync/attendance-batches", "/api/sync/finance-payments"} or path.startswith("/api/sync/teacher-mark-proposals"):
            # Sync routes enforce account, device and record scope in each handler.
            pass
        elif path.startswith("/api/teacher/"):
            if user.role != "teacher":
                return JSONResponse({"detail": "Teacher account required."}, status_code=403)
            section = permission_for_path(path)
            action = action_for_method(request.method, path)
            class_teacher_attendance = path == "/api/teacher/attendance" and request.method == "POST"
            if class_teacher_attendance:
                # The route validates the submitted student's class against
                # the distinct class-teacher assignment before writing.
                pass
            elif not section or action not in user_permissions(user).get(section, set()):
                return JSONResponse({"detail": "Your teacher account is not permitted to perform this action."}, status_code=403)
        elif path.startswith("/api/parent/"):
            if user.role != "parent":
                return JSONResponse({"detail": "Parent account required."}, status_code=403)
        elif path.startswith("/api/parent-liaison/") and user.role == "parent":
            # Parents may only access threads explicitly linked to their account;
            # the route handlers enforce thread ownership and prohibit initiation.
            pass
        elif path == "/api/announcements" and user.role == "parent":
            pass
        elif user.role != "admin":
            if path in ADMIN_ONLY_PATHS or path.startswith("/api/auth/"):
                return JSONResponse({"detail": "Administrator permission required."}, status_code=403)
            section = permission_for_path(path)
            # Finance staff need student lookup for payment processing, without
            # granting them access to the wider Students workspace.
            if path == "/api/students/search" and "view" in user_permissions(user).get("Fees & Finance", set()):
                section = "Fees & Finance"
            action = action_for_method(request.method, path)
            class_teacher_register = path in {"/api/attendance", "/api/attendance/summary", "/api/attendance/options", "/api/attendance/students"} and user.role == "teacher"
            if class_teacher_register:
                if path == "/api/attendance/options":
                    allowed = db.query(models.ClassTeacherAssignment.id).filter_by(teacher_id=user.id).first() is not None
                else:
                    class_id = request.query_params.get("class_id")
                    allowed = bool(class_id and is_assigned_class_teacher(db, user.id, int(class_id)))
                if not allowed:
                    return JSONResponse({"detail": "Only the assigned class teacher may access this register."}, status_code=403)
            elif not section or action not in user_permissions(user).get(section, set()):
                return JSONResponse({"detail": "You do not have permission to access this section or perform this action."}, status_code=403)

        return await call_next(request)
    finally:
        db.close()



class SchoolActivationRequest(BaseModel):
    license: str = Field(min_length=20, max_length=4096)
    school_id: str | None = Field(default=None, min_length=36, max_length=36)


class FirstSchoolSetupRequest(BaseModel):
    school_id: str | None = Field(default=None, min_length=36, max_length=36)
    activation_license: str = Field(min_length=20, max_length=4096)
    school_name: str = Field(min_length=2, max_length=160)
    school_type: str = Field(pattern="^(Primary|Secondary|Combined)$")
    country: str = Field(min_length=2, max_length=80)
    school_structure: str = Field(pattern="^(Day|Boarding|Both)$")
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=150)
    motto: str | None = Field(default=None, max_length=200)
    report_logo: str | None = Field(default=None, max_length=2_000_000)
    house_names: str | None = Field(default=None, max_length=5000)
    admin_username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")
    admin_email: str = Field(min_length=5, max_length=150)
    admin_password: str = Field(min_length=12, max_length=128)


def get_or_create_setup_state(db: Session):
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if state is None:
        state = models.SchoolSetupState(school_tenant_id=get_current_tenant_id(db), installation_id=str(uuid4()))
        db.add(state)
        db.commit()
        db.refresh(state)
    return state



class SchoolIdentityCorrectionRequest(BaseModel):
    license: str = Field(min_length=20, max_length=4096)


@app.post("/api/setup/identity-correction", tags=["First-time Setup"])
def apply_school_identity_correction(
    data: SchoolIdentityCorrectionRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if not state or not state.setup_completed_at or not state.original_identity_json:
        raise HTTPException(409, "There is no protected school identity to correct.")
    try:
        claims = verify_activation_license(data.license)
    except (ValueError, RuntimeError):
        raise HTTPException(403, "The owner correction license is invalid or cannot be verified.")
    if claims.get("installation_id") != state.installation_id or claims.get("action") != "school_identity_correction":
        raise HTTPException(403, "This license does not authorise a school identity correction for this installation.")
    fingerprint = license_fingerprint(data.license)
    if db.query(models.SchoolIdentityCorrection.id).filter_by(license_hash=fingerprint).first():
        raise HTTPException(409, "This owner correction license has already been used.")
    identity = claims.get("school_identity")
    if not isinstance(identity, dict):
        raise HTTPException(422, "The signed correction license does not contain a school identity.")
    school_name = str(identity.get("school_name") or "").strip()
    school_type = identity.get("school_type")
    country = str(identity.get("country") or "").strip()
    school_structure = identity.get("school_structure")
    if not school_name or len(school_name) > 160 or school_type not in {"Primary", "Secondary", "Combined"} or not country or len(country) > 80 or school_structure not in {"Day", "Boarding", "Both"}:
        raise HTTPException(422, "The signed school identity details are incomplete or invalid.")
    profile = get_tenant_singleton(db, models.SchoolProfile)
    if not profile:
        raise HTTPException(404, "School profile not found.")
    old_identity = {
        "school_name": profile.name, "school_type": profile.school_type,
        "country": profile.country, "school_structure": profile.school_structure,
    }
    new_identity = {
        "school_name": school_name, "school_type": school_type,
        "country": country, "school_structure": school_structure,
        "installation_id": state.installation_id,
    }
    profile.name = school_name
    profile.school_type = school_type
    tenant = db.query(models.SchoolTenant).filter_by(id=state.school_tenant_id).first()
    if tenant:
        tenant.name = school_name
    profile.country = country
    profile.school_structure = school_structure
    # Preserve the immutable first-install identity snapshot. Current identity
    # lives in SchoolProfile; each authorised change is recorded separately.
    db.add(models.SchoolIdentityCorrection(
        license_hash=fingerprint,
        license_id=str(claims["license_id"]),
        actor_id=admin.id,
        old_identity_json=json.dumps(old_identity, sort_keys=True),
        new_identity_json=json.dumps(new_identity, sort_keys=True),
    ))
    write_audit(db, admin, "school_identity_corrected", "school_profile", profile.id,
                "Owner-signed identity correction applied; license " + str(claims["license_id"]))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This owner correction license has already been used.")
    return {"message": "Owner-authorised school identity correction applied.", "school": new_identity}


@app.get("/api/setup/status", tags=["First-time Setup"])
def school_setup_status(school: str | None = Query(default=None, min_length=36, max_length=36), db: Session = Depends(get_db)):
    tenant = resolve_school_tenant(db, school)
    state = get_or_create_setup_state(db)
    return {
        "installation_id": state.installation_id,
        "school_id": tenant.public_id if tenant else None,
        "activated": bool(state.activated_at),
        "setup_completed": bool(state.setup_completed_at),
        "requires_activation": not bool(state.activated_at),
        "requires_setup": not bool(state.setup_completed_at),
        "identity_locked": bool(state.original_identity_json),
    }


@app.post("/api/setup/activate", tags=["First-time Setup"])
def activate_school_installation(data: SchoolActivationRequest, db: Session = Depends(get_db)):
    resolve_school_tenant(db, data.school_id)
    state = get_or_create_setup_state(db)
    if state.activated_at:
        raise HTTPException(409, "This SchoolBridge installation has already been activated.")
    now = datetime.utcnow()
    if state.activation_locked_until and state.activation_locked_until > now:
        raise HTTPException(429, "Too many invalid activation attempts. Try again after the temporary security lock expires.")
    try:
        claims = verify_activation_license(data.license)
        if claims.get("installation_id") != state.installation_id or claims.get("product") != "SchoolBridge" or claims.get("action", "activate") != "activate":
            raise ValueError("License is for another installation.")
    except (ValueError, RuntimeError):
        state.activation_attempts = (state.activation_attempts or 0) + 1
        if state.activation_attempts >= 5:
            state.activation_locked_until = now + timedelta(minutes=15)
        db.commit()
        raise HTTPException(403, "The activation license is invalid or cannot be verified.")
    state.activated_at = now
    state.activation_license_hash = license_fingerprint(data.license)
    state.activation_attempts = 0
    state.activation_locked_until = None
    db.add(models.AuditLog(
        school_tenant_id=state.school_tenant_id,
        actor_id=None, actor_username="SchoolBridge Owner",
        action="installation_activated", entity_type="school_setup",
        entity_id=state.id, details="Owner-signed activation license accepted.",
    ))
    db.commit()
    return {"message": "SchoolBridge installation activated.", "activated": True}


@app.post("/api/setup/complete", tags=["First-time Setup"])
def complete_first_school_setup(data: FirstSchoolSetupRequest, db: Session = Depends(get_db)):
    tenant = resolve_school_tenant(db, data.school_id)
    state = get_or_create_setup_state(db)
    if not state.activated_at:
        raise HTTPException(403, "Activate this installation before completing school setup.")
    if license_fingerprint(data.activation_license) != state.activation_license_hash:
        raise HTTPException(403, "The owner activation license used for this installation is required to create the first administrator.")
    if state.setup_completed_at or db.query(models.User).count():
        raise HTTPException(409, "First-time setup has already been completed.")
    if get_tenant_singleton(db, models.SchoolProfile):
        raise HTTPException(409, "A school profile already exists. Contact the SchoolBridge owner for assistance.")
    if db.query(models.User).filter(
        or_(models.User.username == data.admin_username, models.User.email == data.admin_email)
    ).first():
        raise HTTPException(409, "The administrator username or email is already in use.")
    if data.report_logo and not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", data.report_logo):
        raise HTTPException(422, "School logo must be a PNG, JPEG or WebP image uploaded through the setup form.")
    profile = models.SchoolProfile(
        school_tenant_id=get_current_tenant_id(db), name=data.school_name.strip(), school_type=data.school_type,
        country=data.country.strip(), school_structure=data.school_structure,
        address=data.address, phone=data.phone, email=data.email, motto=data.motto,
        report_logo=data.report_logo, house_names=data.house_names,
    )
    admin = models.User(
        username=data.admin_username.strip(), email=data.admin_email.strip().lower(),
        hashed_password=password_hash.hash(data.admin_password), role="admin", is_active=True,
    )
    identity = {
        "school_name": profile.name, "school_type": profile.school_type,
        "country": profile.country, "school_structure": profile.school_structure,
        "installation_id": state.installation_id,
    }
    db.add(profile)
    db.add(admin)
    db.flush()
    state.original_identity_json = json.dumps(identity, sort_keys=True)
    state.setup_completed_at = datetime.utcnow()
    if tenant:
        tenant.installation_id = state.installation_id
        tenant.name = profile.name
        tenant.status = "active"
    write_audit(db, admin, "school_first_setup_completed", "school_profile", profile.id,
                "Initial school identity and first administrator created.")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "School setup could not be completed because an account already exists.")
    return {"message": "School setup completed. You can now sign in with the administrator account.", "school": identity}


@app.post("/api/auth/login", tags=["Authentication"])
def login(
    data: OAuth2PasswordRequestForm = Depends(),
    school_id: str | None = Form(default=None, min_length=36, max_length=36),
    db: Session = Depends(get_db)
):
    resolve_school_tenant(db, school_id)
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if not state or not state.setup_completed_at:
        raise HTTPException(403, "SchoolBridge first-time setup must be completed before signing in.")
    login_name = data.username.strip()
    tenant_id = int(getattr(state, "school_tenant_id", 1) or 1)
    user = db.query(models.User).filter(
        models.User.username == login_name,
        models.User.school_tenant_id == tenant_id,
    ).first()
    if user is None:
        # Staff may use their registered staff number, but surnames are not
        # login credentials because they are neither unique nor secret.
        user = db.query(models.User).join(
            models.StaffMember,
            (models.User.staff_id == models.StaffMember.id)
            & (models.User.school_tenant_id == models.StaffMember.school_tenant_id),
        ).filter(
            models.User.school_tenant_id == tenant_id,
            models.StaffMember.school_tenant_id == tenant_id,
            func.lower(models.StaffMember.staff_number) == login_name.lower(),
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
        "must_change_password": bool(user.must_change_password),
    }


class PasswordResetRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=160)
    school_id: str | None = Field(default=None, min_length=36, max_length=36)


class PasswordResetConfirm(BaseModel):
    identifier: str = Field(min_length=1, max_length=160)
    school_id: str | None = Field(default=None, min_length=36, max_length=36)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128)


def find_password_recovery_account(db: Session, identifier: str):
    value = identifier.strip().lower()
    matches = db.query(models.User).filter(or_(
        func.lower(models.User.username) == value,
        func.lower(models.User.email) == value,
    )).all()
    staff_matches = db.query(models.User).join(
        models.StaffMember, models.User.staff_id == models.StaffMember.id
    ).filter(or_(
        func.lower(models.StaffMember.last_name) == value,
        func.lower(models.StaffMember.staff_number) == value,
    )).all()
    unique = {item.id: item for item in matches + staff_matches}
    return next(iter(unique.values())) if len(unique) == 1 else None


def send_password_recovery_email(user, code: str) -> bool:
    smtp_host = os.getenv("SCHOOLBRIDGE_SMTP_HOST", "smtp.gmail.com").strip()
    smtp_user = os.getenv("SCHOOLBRIDGE_SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("SCHOOLBRIDGE_SMTP_PASSWORD", "")
    smtp_from = os.getenv("SCHOOLBRIDGE_SMTP_FROM", smtp_user).strip()
    recipient = (user.email or "").strip()
    if not (smtp_host and smtp_user and smtp_password and smtp_from and recipient and not recipient.endswith(".schoolbridge.local")):
        return False
    message = EmailMessage()
    message["Subject"] = "SchoolBridge password recovery code"
    message["From"] = smtp_from
    message["To"] = recipient
    message.set_content(
        "A password reset was requested for your SchoolBridge account.\n\n"
        f"Your verification code is: {code}\n"
        "This code expires in 15 minutes and can only be used once. "
        "If you did not request this, you can ignore this email.\n"
    )
    port = int(os.getenv("SCHOOLBRIDGE_SMTP_PORT", "587"))
    with smtplib.SMTP(smtp_host, port, timeout=15) as server:
        server.ehlo()
        if os.getenv("SCHOOLBRIDGE_SMTP_USE_TLS", "true").lower() not in ("0", "false", "no"):
            server.starttls()
            server.ehlo()
        server.login(smtp_user, smtp_password)
        server.send_message(message)
    return True


@app.post("/api/auth/password-reset/request", tags=["Authentication"])
def request_password_reset(data: PasswordResetRequest, db: Session = Depends(get_db)):
    # Always return the same response so account names and email addresses cannot be enumerated.
    resolve_school_tenant(db, data.school_id)
    user = find_password_recovery_account(db, data.identifier)
    now = datetime.utcnow()
    if user and user.is_active and user.email and not user.email.endswith(".schoolbridge.local"):
        if not user.reset_requested_at or (now - user.reset_requested_at).total_seconds() >= 60:
            code = f"{secrets.randbelow(1000000):06d}"
            user.reset_code_hash = password_hash.hash(code)
            user.reset_expires_at = now + timedelta(minutes=15)
            user.reset_requested_at = now
            user.reset_attempts = 0
            db.commit()
            try:
                delivered = send_password_recovery_email(user, code)
            except Exception:
                delivered = False
            if not delivered:
                user.reset_code_hash = None
                user.reset_expires_at = None
                db.commit()
    return {"message": "If the account exists and has a registered email address, a verification code will be sent."}


@app.post("/api/auth/password-reset/confirm", tags=["Authentication"])
def confirm_password_reset(data: PasswordResetConfirm, db: Session = Depends(get_db)):
    resolve_school_tenant(db, data.school_id)
    user = find_password_recovery_account(db, data.identifier)
    now = datetime.utcnow()
    if not user or not user.is_active or not user.reset_code_hash or not user.reset_expires_at or user.reset_expires_at < now or user.reset_attempts >= 5:
        raise HTTPException(400, "The verification code is invalid or has expired. Request a new code.")
    if not password_hash.verify(data.code, user.reset_code_hash):
        user.reset_attempts += 1
        db.commit()
        raise HTTPException(400, "The verification code is invalid or has expired. Request a new code.")
    if password_hash.verify(data.new_password, user.hashed_password):
        raise HTTPException(400, "Choose a password different from your current password.")
    user.hashed_password = password_hash.hash(data.new_password)
    user.token_version = (user.token_version or 0) + 1
    user.reset_code_hash = None
    user.reset_expires_at = None
    user.reset_attempts = 0
    user.must_change_password = False
    db.commit()
    return {"message": "Password reset successfully. You can now sign in with your new password."}


@app.post("/api/auth/logout", tags=["Authentication"])
def logout(user=Depends(get_current_user), db: Session = Depends(get_db)):
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    return {"message": "Signed out successfully."}


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
        "must_change_password": bool(user.must_change_password),
    }


@app.post("/api/public/registration/parent", tags=["Parent & Teacher Registration"])
def submit_parent_registration(data: ParentSelfRegistrationRequest, db: Session = Depends(get_db)):
    resolve_school_tenant(db, str(data.school_id))
    student_ids, contact_ids, trusted_phone = _match_parent_registration(db, data)
    reference, claim = _create_registration_claim(
        db, "parent", data.parent_name.strip(),
        {
            "parent_name": data.parent_name.strip(),
            "relationship": data.relationship,
            "children": [child.model_dump(mode="json") for child in data.children],
        },
        student_ids, contact_ids, trusted_phone=trusted_phone,
    )
    message = (
        f"A verification code was sent to the number on your school's record: {claim.phone_masked}."
        if claim.status == "verification_pending"
        else "Your request has been sent to the school for review. The school will use its existing records; you do not need to enter a phone number."
    )
    return {"claim_reference": reference, "status": claim.status, "phone_masked": claim.phone_masked, "message": message}


@app.post("/api/public/registration/teacher", tags=["Parent & Teacher Registration"])
def submit_teacher_registration(data: TeacherSelfRegistrationRequest, db: Session = Depends(get_db)):
    resolve_school_tenant(db, str(data.school_id))
    staff_id, trusted_phone = _match_teacher_registration(db, data)
    reference, claim = _create_registration_claim(
        db, "teacher", f"{data.first_name.strip()} {data.last_name.strip()}",
        {
            "first_name": data.first_name.strip(),
            "last_name": data.last_name.strip(),
            "staff_number": data.staff_number,
            "position": data.position,
            "department": data.department,
        },
        candidate_staff_id=staff_id, trusted_phone=trusted_phone,
    )
    message = (
        f"A verification code was sent to the number on your school's record: {claim.phone_masked}."
        if claim.status == "verification_pending"
        else "Your request has been sent to the school for review. The school will use its existing records; you do not need to enter a phone number."
    )
    return {"claim_reference": reference, "status": claim.status, "phone_masked": claim.phone_masked, "message": message}


@app.get("/api/public/registration/claims/{reference}", tags=["Parent & Teacher Registration"])
def get_public_registration_claim(reference: str, school_id: UUID = Query(...), db: Session = Depends(get_db)):
    resolve_school_tenant(db, str(school_id))
    claim = db.query(models.RegistrationClaim).filter_by(
        school_tenant_id=get_current_tenant_id(db),
        reference_hash=_registration_reference_hash(reference),
    ).first()
    if not claim:
        raise HTTPException(404, "Registration request not found.")
    return {"status": claim.status, "phone_masked": claim.phone_masked, "expires_at": claim.expires_at}


@app.post("/api/public/registration/claims/{reference}/verify", tags=["Parent & Teacher Registration"])
def verify_public_registration_claim(reference: str, data: RegistrationClaimVerifyRequest, db: Session = Depends(get_db)):
    resolve_school_tenant(db, str(data.school_id))
    claim = db.query(models.RegistrationClaim).filter_by(
        school_tenant_id=get_current_tenant_id(db),
        reference_hash=_registration_reference_hash(reference),
    ).first()
    if not claim:
        raise HTTPException(404, "Registration request not found.")
    now = datetime.utcnow()
    if claim.status != "verification_pending" or not claim.verification_code_hash:
        raise HTTPException(409, "This request is not waiting for phone verification.")
    if not claim.verification_expires_at or claim.verification_expires_at < now:
        claim.status = "pending_review"
        claim.verification_code_hash = None
        claim.verification_expires_at = None
        db.commit()
        raise HTTPException(410, "The verification code expired. Your request has been sent to the school for review.")
    if claim.verification_attempts >= 5:
        claim.status = "pending_review"
        claim.verification_code_hash = None
        claim.verification_expires_at = None
        db.commit()
        raise HTTPException(429, "Too many incorrect codes. Your request has been sent to the school for review.")
    claim.verification_attempts += 1
    if not hmac.compare_digest(_registration_code_hash(claim, data.code), claim.verification_code_hash):
        db.commit()
        raise HTTPException(400, "The verification code is incorrect.")
    claim.status = "verified"
    claim.verification_code_hash = None
    claim.verification_expires_at = None
    db.commit()
    return {"status": "verified", "message": "Phone access verified. You can now complete your account setup."}


@app.get("/api/admin/registration-claims", tags=["Parent & Teacher Registration"])
def list_registration_claims(status: str = "pending_review", db: Session = Depends(get_db), admin=Depends(require_admin)):
    if status not in {"pending_review", "verification_pending", "verified", "approved", "rejected", "completed"}:
        raise HTTPException(422, "Invalid registration claim status.")
    return db.query(models.RegistrationClaim).filter_by(status=status).order_by(
        models.RegistrationClaim.created_at.asc()
    ).limit(200).all()


@app.post("/api/admin/registration-claims/{claim_id}/decision", tags=["Parent & Teacher Registration"])
def decide_registration_claim(claim_id: int, data: RegistrationClaimDecisionRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    claim = db.get(models.RegistrationClaim, claim_id)
    if not claim:
        raise HTTPException(404, "Registration request not found.")
    if claim.status in {"completed", "rejected"}:
        raise HTTPException(409, "This registration request is already closed.")
    if data.status == "approved":
        if claim.claim_type == "parent":
            student_ids = list(dict.fromkeys(data.student_ids or json.loads(claim.candidate_student_ids_json or "[]")))
            expected_count = len(json.loads(claim.details_json or "{}").get("children", []))
            students = db.query(models.Student).filter(models.Student.id.in_(student_ids)).all()
            if not student_ids or len(student_ids) != expected_count or len(students) != len(student_ids):
                raise HTTPException(422, "Select one valid student record for every child before approving the parent request.")
            claim.candidate_student_ids_json = json.dumps(student_ids)
        elif claim.claim_type == "teacher":
            staff_id = data.staff_id or claim.candidate_staff_id
            staff = db.get(models.StaffMember, staff_id) if staff_id else None
            if not staff or staff.status != "active" or staff.category.lower() not in {"teaching", "teacher"}:
                raise HTTPException(422, "Select an active teaching staff record before approving the teacher request.")
            claim.candidate_staff_id = staff.id
        else:
            raise HTTPException(409, "Unsupported registration request type.")
        claim.status = "approved"
    else:
        claim.status = "rejected"
    claim.reviewed_by = admin.id
    claim.reviewed_at = datetime.utcnow()
    claim.review_note = data.note
    write_audit(db, admin, "registration_claim_reviewed", "registration_claim", claim.id,
                f"type={claim.claim_type}; status={claim.status}")
    db.commit()
    db.refresh(claim)
    return {"message": "Registration request decision saved.", "claim": claim}


@app.post("/api/public/registration/claims/{reference}/complete", tags=["Parent & Teacher Registration"])
def complete_public_registration_claim(reference: str, data: RegistrationClaimCompleteRequest, db: Session = Depends(get_db)):
    resolve_school_tenant(db, str(data.school_id))
    claim = db.query(models.RegistrationClaim).filter_by(
        school_tenant_id=get_current_tenant_id(db),
        reference_hash=_registration_reference_hash(reference),
    ).first()
    if not claim:
        raise HTTPException(404, "Registration request not found.")
    if claim.status not in {"verified", "approved"}:
        raise HTTPException(409, "The school or phone verification must approve this request before account setup.")
    if claim.expires_at < datetime.utcnow():
        claim.status = "expired"
        db.commit()
        raise HTTPException(410, "This registration request has expired.")
    if db.query(models.User).filter(func.lower(models.User.username) == data.username.strip().lower()).first():
        raise HTTPException(409, "That username is already in use at this school.")
    email = data.email.strip().lower() if data.email and data.email.strip() else None
    if email and db.query(models.User).filter(func.lower(models.User.email) == email).first():
        raise HTTPException(409, "That email address is already in use at this school.")

    if claim.claim_type == "parent":
        student_ids = list(dict.fromkeys(json.loads(claim.candidate_student_ids_json or "[]")))
        students = db.query(models.Student).filter(models.Student.id.in_(student_ids)).all()
        if not student_ids or len(students) != len(student_ids):
            raise HTTPException(409, "The linked student records are no longer available. Ask the school to review the request again.")
        already_linked = db.query(models.ParentStudentLink).filter(
            models.ParentStudentLink.student_id.in_(student_ids)
        ).first()
        if already_linked:
            raise HTTPException(409, "A parent account is already linked to at least one selected student. Ask the school to review the request.")
        user = models.User(
            school_tenant_id=get_current_tenant_id(db),
            username=data.username.strip(), email=email,
            hashed_password=password_hash.hash(data.password),
            role="parent", is_active=True,
        )
        db.add(user)
        db.flush()
        db.add_all([
            models.ParentStudentLink(
                school_tenant_id=get_current_tenant_id(db),
                user_id=user.id, student_id=student_id,
            )
            for student_id in student_ids
        ])
    elif claim.claim_type == "teacher":
        staff = db.get(models.StaffMember, claim.candidate_staff_id) if claim.candidate_staff_id else None
        if not staff or staff.status != "active" or staff.category.lower() not in {"teaching", "teacher"}:
            raise HTTPException(409, "The linked teaching staff record is no longer available.")
        if db.query(models.User).filter(models.User.staff_id == staff.id).first():
            raise HTTPException(409, "An account is already linked to this staff record.")
        user = models.User(
            school_tenant_id=get_current_tenant_id(db),
            username=data.username.strip(),
            email=email or (staff.email.strip().lower() if staff.email and staff.email.strip() else None),
            hashed_password=password_hash.hash(data.password),
            role="teacher", staff_id=staff.id, is_active=True,
        )
        db.add(user)
        db.flush()
    else:
        raise HTTPException(409, "Unsupported registration request type.")

    claim.status = "completed"
    write_audit(db, user, "self_registration_completed", "user", user.id,
                f"claim_id={claim.id}; type={claim.claim_type}")
    db.commit()
    return {"message": "Your SchoolBridge account has been created. Sign in using your selected school.", "username": user.username}


@app.get("/api/public/school", tags=["Public School Identity"])
def public_school_identity(school: str | None = Query(default=None, min_length=36, max_length=36), db: Session = Depends(get_db)):
    tenant = resolve_school_tenant(db, school)
    state = get_tenant_singleton(db, models.SchoolSetupState)
    profile = get_tenant_singleton(db, models.SchoolProfile)
    if not state or not state.setup_completed_at or not profile:
        raise HTTPException(404, "School identity is not available.")
    return {
        "school_name": profile.name,
        "school_id": tenant.public_id if tenant else None,
        "school_type": profile.school_type,
        "country": profile.country,
        "installation_id": state.installation_id,
    }


@app.get("/api/enrolment/school-qr.svg", tags=["Mobile Enrolment"])
def school_access_qr(
    request: Request,
    origin: str = Query(..., min_length=8, max_length=300),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if not state or not state.setup_completed_at:
        raise HTTPException(409, "Complete school setup before creating an access QR code.")
    parsed = urlsplit(origin)
    request_origin = request.headers.get("origin") or f"{request.url.scheme}://{request.url.netloc}"
    parsed_origin = f"{parsed.scheme}://{parsed.netloc}"
    if (
        parsed.scheme not in {"http", "https"}
        or parsed_origin.lower() != request_origin.rstrip("/").lower()
        or not parsed.hostname
        or parsed.username or parsed.password
        or parsed.query or parsed.fragment or parsed.path not in {"", "/"}
    ):
        raise HTTPException(400, "The QR destination must be this SchoolBridge installation's current web origin.")
    tenant = db.query(models.SchoolTenant).filter_by(id=state.school_tenant_id).first()
    if tenant is None:
        raise HTTPException(409, "This installation is not registered in the school directory.")
    target = origin.rstrip("/") + "/?school=" + tenant.public_id
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=4,
    )
    qr.add_data(target)
    qr.make(fit=True)
    image = qr.make_image(image_factory=SvgPathImage)
    output = BytesIO()
    image.save(output)
    return Response(
        content=output.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-store", "Content-Disposition": 'inline; filename="schoolbridge-school-access.svg"'},
    )


@app.post("/api/enrolment/invitations", tags=["Mobile Enrolment"])
def create_enrolment_invitation(
    data: EnrolmentInvitationCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if not state or not state.setup_completed_at:
        raise HTTPException(409, "Complete school setup before issuing device enrolment invitations.")
    target = db.get(models.User, data.user_id)
    if not target or not target.is_active:
        raise HTTPException(404, "The target account is unavailable.")
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    invitation = models.EnrolmentInvitation(
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        installation_id=state.installation_id,
        target_user_id=target.id,
        created_by=admin.id,
        created_at=now,
        expires_at=now + timedelta(minutes=data.expires_in_minutes),
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    return {
        "id": invitation.id,
        "token": token,
        "target_user_id": target.id,
        "expires_at": invitation.expires_at,
        "message": "Copy this invitation token now. It is shown only once and can enrol one device for the named account.",
    }


@app.get("/api/enrolment/invitations", tags=["Mobile Enrolment"])
def list_enrolment_invitations(
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    invitations = db.query(models.EnrolmentInvitation).order_by(models.EnrolmentInvitation.created_at.desc()).limit(200).all()
    users = {user.id: user for user in db.query(models.User).filter(
        models.User.id.in_([item.target_user_id for item in invitations])
    ).all()} if invitations else {}
    now = datetime.utcnow()
    return {"invitations": [
        {
            "id": item.id,
            "target_user_id": item.target_user_id,
            "target_username": users[item.target_user_id].username if item.target_user_id in users else "Unavailable account",
            "created_at": item.created_at,
            "expires_at": item.expires_at,
            "redeemed_at": item.redeemed_at,
            "revoked_at": item.revoked_at,
            "status": "redeemed" if item.redeemed_at else "revoked" if item.revoked_at else "expired" if item.expires_at <= now else "pending",
        }
        for item in invitations
    ]}


@app.post("/api/enrolment/invitations/{invitation_id}/revoke", tags=["Mobile Enrolment"])
def revoke_enrolment_invitation(
    invitation_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    invitation = db.get(models.EnrolmentInvitation, invitation_id)
    if not invitation:
        raise HTTPException(404, "The enrolment invitation was not found.")
    if invitation.redeemed_at:
        raise HTTPException(409, "A redeemed invitation cannot be revoked.")
    if invitation.revoked_at:
        return {"message": "Invitation is already revoked."}
    invitation.revoked_at = datetime.utcnow()
    db.commit()
    return {"message": "Enrolment invitation revoked."}


@app.post("/api/enrolment/redeem", tags=["Mobile Enrolment"])
def redeem_enrolment_invitation(
    data: EnrolmentRedeemRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    token_hash = hashlib.sha256(data.token.encode("utf-8")).hexdigest()
    now = datetime.utcnow()
    # A conditional UPDATE makes redemption single-use even when two requests
    # attempt to redeem the same token concurrently.
    invitation = db.query(models.EnrolmentInvitation).filter_by(token_hash=token_hash).first()
    if not invitation:
        raise HTTPException(404, "The enrolment invitation is invalid or unavailable.")
    if invitation.target_user_id != user.id:
        raise HTTPException(403, "This invitation was issued for another account.")
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if not state or invitation.installation_id != state.installation_id:
        raise HTTPException(403, "This invitation belongs to another school installation.")
    claimed = db.query(models.EnrolmentInvitation).filter(
        models.EnrolmentInvitation.id == invitation.id,
        models.EnrolmentInvitation.redeemed_at.is_(None),
        models.EnrolmentInvitation.revoked_at.is_(None),
        models.EnrolmentInvitation.expires_at > now,
    ).update({models.EnrolmentInvitation.redeemed_at: now}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        raise HTTPException(409, "This invitation has expired, been revoked, or has already been used.")
    device_id = str(data.device_id)
    existing = db.query(models.SyncDevice).filter_by(user_id=user.id, device_id=device_id).first()
    if existing and existing.revoked_at is not None:
        db.rollback()
        raise HTTPException(409, "This device identity was previously revoked. Use a new device identity.")
    if existing is None:
        existing = models.SyncDevice(
            user_id=user.id, device_id=device_id, device_name=data.device_name.strip(),
            created_at=now, last_seen_at=now,
        )
        db.add(existing)
    else:
        existing.device_name = data.device_name.strip()
        existing.last_seen_at = now
    if not data.device_name.strip():
        db.rollback()
        raise HTTPException(422, "Device name cannot be empty.")
    db.commit()
    return {
        "device_id": existing.device_id,
        "device_name": existing.device_name,
        "active": True,
        "school_installation_id": state.installation_id,
        "message": "School enrolment verified and this device registered.",
    }


@app.post("/api/sync/devices", tags=["Offline Synchronisation"])
def register_sync_device(
    data: SyncDeviceRegistration,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    device_id = str(data.device_id)
    device_name = data.device_name.strip()
    if not device_name:
        raise HTTPException(422, "Device name cannot be empty.")

    device = db.query(models.SyncDevice).filter_by(
        user_id=user.id, device_id=device_id
    ).first()
    if device and device.revoked_at is not None:
        raise HTTPException(409, "This device has been revoked. Register it using a new device identity.")

    now = datetime.utcnow()
    if device is None:
        device = models.SyncDevice(
            user_id=user.id,
            device_id=device_id,
            device_name=device_name,
            created_at=now,
            last_seen_at=now,
        )
        db.add(device)
    else:
        device.device_name = device_name
        device.last_seen_at = now

    try:
        db.commit()
        db.refresh(device)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This device could not be registered because its identity was already used.")

    return {
        "device_id": device.device_id,
        "device_name": device.device_name,
        "created_at": device.created_at,
        "last_seen_at": device.last_seen_at,
        "active": device.revoked_at is None,
    }


@app.get("/api/sync/devices", tags=["Offline Synchronisation"])
def list_sync_devices(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    devices = db.query(models.SyncDevice).filter_by(
        user_id=user.id
    ).order_by(models.SyncDevice.last_seen_at.desc(), models.SyncDevice.id.desc()).all()
    return {
        "devices": [
            {
                "device_id": device.device_id,
                "device_name": device.device_name,
                "created_at": device.created_at,
                "last_seen_at": device.last_seen_at,
                "last_sync_sequence": device.last_sync_sequence,
                "last_issued_sequence": device.last_issued_sequence,
                "revoked_at": device.revoked_at,
                "active": device.revoked_at is None,
            }
            for device in devices
        ]
    }


def _sync_change_visible_to_user(row, user):
    if user.role == "admin": return True
    try: scope = json.loads(row.scope_json or "{}")
    except (TypeError, ValueError): scope = {}
    entity = row.entity_type.split(":", 1)[0]
    if entity == "AttendanceScope":
        entity = "Attendance"
    parent_visible = user.id in scope.get("parent_user_ids", [])
    teacher_visible = user.id in scope.get("teacher_user_ids", [])
    permissions = user_permissions(user)
    if user.role == "parent":
        if not parent_visible: return False
        # Deliver the parent's own account changes so offline permissions can be revalidated.
        if entity == "UserAccess": return True
        if entity in {"Mark", "MarkScope"}: return scope.get("verified") is True
        return entity in {"Student","SchoolClass","Attendance","Exam","Mark","MarkScope","FeeCharge","FeePayment","ClassFee","ParentStudentLink"}
    if user.role == "teacher":
        if entity in {"UserAccess"}:
            return user.id in scope.get("teacher_user_ids", [])
        if teacher_visible:
            if entity in {"Student", "SchoolClass"}:
                return "view" in permissions.get("My Classes", set()) or "view" in permissions.get("Students", set())
            if entity in {"Subject", "Exam", "Mark", "MarkScope"}:
                return "view" in permissions.get("My Results", set()) or "view" in permissions.get("Examinations", set())
            if entity == "Attendance":
                return "view" in permissions.get("My Attendance", set()) or "view" in permissions.get("Attendance", set())
            if entity in {"TeacherAssignment", "ClassTeacherAssignment"}:
                # Assignment changes can invalidate several kinds of cached
                # teacher data, not only the class list: marks, timetable and
                # attendance are all scoped by these relationships.
                affected_sections = (
                    "My Classes", "My Results", "Timetable",
                    "My Attendance", "Attendance",
                )
                return any("view" in permissions.get(section, set()) for section in affected_sections)
            if entity == "TimetableEntry":
                return "view" in permissions.get("Timetable", set())
        if entity in {"FeeCharge", "FeePayment", "ClassFee"}:
            return "view" in permissions.get("Fees & Finance", set())
        return entity in {"Student", "SchoolClass"} and "view" in permissions.get("Students", set())
    section_by_entity = {
        "Student":"Students","SchoolClass":"Students","StaffMember":"Staff",
        "Attendance":"Attendance","StaffAttendance":"Staff Attendance",
        "Exam":"Examinations","Mark":"Examinations","MarkScope":"Examinations",
        "Subject":"Examinations","FeeCharge":"Fees & Finance","FeePayment":"Fees & Finance",
        "ClassFee":"Fees & Finance","SalaryPayment":"Fees & Finance",
        "OtherExpense":"Fees & Finance","TimetableEntry":"Timetable",
    }
    section = section_by_entity.get(entity)
    if entity == "UserAccess": return user.id in scope.get("teacher_user_ids", [])
    if not section or "view" not in permissions.get(section, set()): return False
    return entity != "OtherExpense" or bool(scope.get("finance_only"))


@app.get("/api/sync/changes", tags=["Offline Synchronisation"])
def list_sync_changes(device_id: UUID, cursor: int = 0, limit: int = 200,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return only changes within the authenticated account's historical record scope."""
    if cursor < 0 or limit < 1 or limit > 500:
        raise HTTPException(422, "Cursor must be non-negative and limit must be between 1 and 500.")
    device = db.query(models.SyncDevice).filter_by(user_id=user.id, device_id=str(device_id)).first()
    if device is None or device.revoked_at is not None:
        raise HTTPException(403, "An active registered device is required.")
    if cursor > device.last_issued_sequence:
        raise HTTPException(409, "A change-feed cursor cannot skip beyond changes already delivered to this device.")
    # Bound each poll to 500 journal rows, even when almost every event is
    # hidden from this account. Otherwise a quiet parent/teacher feed can scan
    # the entire school history in one request as the journal grows.
    batch = db.query(models.SyncChange).filter(models.SyncChange.id > cursor).order_by(
        models.SyncChange.id.asc()).limit(500).all()
    visible, scan_cursor, has_more = [], cursor, False
    for row in batch:
        scan_cursor = row.id
        if _sync_change_visible_to_user(row, user):
            visible.append(row)
            if len(visible) > limit:
                has_more = True
                scan_cursor = visible[limit - 1].id
                visible = visible[:limit]
                break
    if not has_more and batch:
        has_more = db.query(models.SyncChange.id).filter(
            models.SyncChange.id > scan_cursor
        ).first() is not None
    next_cursor = scan_cursor
    device.last_issued_sequence = max(device.last_issued_sequence, next_cursor)
    device.last_seen_at = datetime.utcnow()
    db.commit()
    return {"changes":[{"sequence":row.id,"entity_type":row.entity_type,"entity_id":row.entity_id,
        "operation":row.operation,"changed_at":row.changed_at} for row in visible],
        "next_cursor":next_cursor,"has_more":has_more}


@app.post("/api/sync/proposals", tags=["Offline Synchronisation"])
def submit_sync_change_proposal(data: SyncChangeProposalCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Offline change submissions are currently restricted to administrators.")
    device = _sync_active_device(db, user, data.device_id)
    allowed = {"Student","SchoolClass","Subject","StaffMember","Attendance","StaffAttendance","Exam","Mark","FeeCharge","FeePayment","ClassFee","SalaryPayment","OtherExpense","TimetableEntry"}
    if data.entity_type not in allowed:
        raise HTTPException(422, "This record type is not enabled for offline proposals.")
    if (data.operation == "create" and data.entity_id is not None) or (data.operation != "create" and data.entity_id is None):
        raise HTTPException(422, "Create must omit entity_id; update and delete require it.")
    if data.base_sequence > device.last_issued_sequence:
        raise HTTPException(409, "The proposal base sequence has not been delivered to this device.")
    payload=json.dumps(data.payload,sort_keys=True,separators=(",",":"))
    if len(payload.encode("utf-8")) > 32768:
        raise HTTPException(413, "Offline proposal payload exceeds 32 KB.")
    old=db.query(models.SyncChangeProposal).filter_by(user_id=user.id,idempotency_key=data.idempotency_key).first()
    if old:
        same=(old.device_id==str(data.device_id) and old.entity_type==data.entity_type and old.entity_id==data.entity_id and old.operation==data.operation and old.base_sequence==data.base_sequence and old.payload_json==payload)
        if not same: raise HTTPException(409,"Idempotency key already used for different content.")
        return {"proposal_id":old.id,"status":old.status,"conflict_sequence":old.conflict_sequence,"duplicate":True,"applied":False}
    conflict=None
    if data.entity_id is not None:
        conflict=db.query(models.SyncChange).filter(models.SyncChange.entity_type==data.entity_type,models.SyncChange.entity_id==data.entity_id,models.SyncChange.id>data.base_sequence).order_by(models.SyncChange.id.desc()).first()
    row=models.SyncChangeProposal(user_id=user.id,device_id=device.device_id,idempotency_key=data.idempotency_key,entity_type=data.entity_type,entity_id=data.entity_id,operation=data.operation,payload_json=payload,base_sequence=data.base_sequence,status="conflict" if conflict else "pending_review",conflict_sequence=conflict.id if conflict else None)
    db.add(row)
    try:
        # Allocate the proposal ID before writing its audit event so the audit
        # trail points to the exact proposal rather than the previous placeholder.
        db.flush()
        write_audit(
            db, user, "sync_proposal_submitted", "sync_change_proposal", row.id,
            f"proposal_entity={data.entity_type}; entity_id={data.entity_id}; operation={data.operation}; base_sequence={data.base_sequence}; status={row.status}",
        )
        db.commit(); db.refresh(row)
    except IntegrityError:
        db.rollback()
        old=db.query(models.SyncChangeProposal).filter_by(user_id=user.id,idempotency_key=data.idempotency_key).first()
        if old and old.payload_json==payload and old.device_id==str(data.device_id) and old.entity_type==data.entity_type and old.entity_id==data.entity_id and old.operation==data.operation and old.base_sequence==data.base_sequence:
            return {"proposal_id":old.id,"status":old.status,"conflict_sequence":old.conflict_sequence,"duplicate":True,"applied":False}
        raise HTTPException(409,"Proposal key collision; retry with the same request.")
    return {"proposal_id":row.id,"status":row.status,"conflict_sequence":row.conflict_sequence,"duplicate":False,"applied":False}


@app.get("/api/sync/proposals", tags=["Offline Synchronisation"])
def list_sync_change_proposals(device_id: UUID, after_id: int=Query(0,ge=0), limit: int=Query(100,ge=1,le=200), db: Session=Depends(get_db), user=Depends(get_current_user)):
    if user.role!="admin": raise HTTPException(403,"Proposal review is administrator-only.")
    _sync_active_device(db,user,device_id)
    rows=db.query(models.SyncChangeProposal).filter(models.SyncChangeProposal.user_id==user.id,models.SyncChangeProposal.id>after_id).order_by(models.SyncChangeProposal.id.asc()).limit(limit+1).all()
    more=len(rows)>limit; rows=rows[:limit]
    return {"proposals":[{"id":r.id,"device_id":r.device_id,"idempotency_key":r.idempotency_key,"entity_type":r.entity_type,"entity_id":r.entity_id,"operation":r.operation,"payload":json.loads(r.payload_json),"base_sequence":r.base_sequence,"status":r.status,"conflict_sequence":r.conflict_sequence,"submitted_at":r.submitted_at,"resolved_at":r.resolved_at,"resolution":r.resolution} for r in rows],"next_after_id":rows[-1].id if rows else after_id,"has_more":more}


@app.patch("/api/sync/proposals/{proposal_id}/resolution", tags=["Offline Synchronisation"])
def resolve_sync_change_proposal(proposal_id: int, data: SyncChangeProposalResolution, db: Session=Depends(get_db), user=Depends(get_current_user)):
    if user.role!="admin": raise HTTPException(403,"Proposal resolution is administrator-only.")
    _sync_active_device(db,user,data.device_id)
    row=db.query(models.SyncChangeProposal).filter_by(id=proposal_id,user_id=user.id).with_for_update().first()
    if not row: raise HTTPException(404,"Offline proposal not found.")
    if row.status not in {"conflict","pending_review"}: raise HTTPException(409,"Proposal already resolved.")
    if data.decision=="discard":
        row.status="discarded"; row.resolution="discard"
    else:
        latest=None
        if row.entity_id is not None:
            latest=db.query(models.SyncChange).filter_by(entity_type=row.entity_type,entity_id=row.entity_id).order_by(models.SyncChange.id.desc()).first()
        row.base_sequence=latest.id if latest else row.base_sequence
        row.conflict_sequence=None; row.status="pending_review"; row.resolution="rebase"
    row.resolved_at=datetime.utcnow()
    write_audit(
        db, user, "sync_proposal_resolved", "sync_change_proposal", row.id,
        f"decision={data.decision}; resulting_status={row.status}; base_sequence={row.base_sequence}; applied=false",
    )
    db.commit()
    return {"proposal_id":row.id,"status":row.status,"base_sequence":row.base_sequence,"resolution":row.resolution,"applied":False}


def _sync_snapshot_sequence(db: Session) -> int:
    """Read the journal high-water mark used to validate one snapshot page."""
    return db.query(func.max(models.SyncChange.id)).scalar() or 0


@app.get("/api/sync/students", tags=["Offline Synchronisation"])
def list_sync_student_snapshot(
    device_id: UUID,
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return a minimal student snapshot limited to the signed-in user's scope."""
    device = db.query(models.SyncDevice).filter_by(
        user_id=user.id, device_id=str(device_id)
    ).first()
    if device is None or device.revoked_at is not None:
        raise HTTPException(403, "An active registered device is required.")
    snapshot_start_sequence = _sync_snapshot_sequence(db)

    query = db.query(models.Student)
    scope = None
    if user.role == "admin":
        scope = "school"
    elif user.role == "teacher":
        if "view" not in user_permissions(user).get("My Classes", set()) and "view" not in user_permissions(user).get("Students", set()):
            raise HTTPException(403, "You do not have permission to view assigned students.")
        class_ids = {
            row[0] for row in db.query(models.TeacherAssignment.class_id).filter_by(
                teacher_id=user.id
            ).distinct().all()
        }
        class_ids.update(
            row[0] for row in db.query(models.ClassTeacherAssignment.class_id).filter_by(
                teacher_id=user.id
            ).all()
        )
        if not class_ids:
            query = query.filter(models.Student.id == -1)
        else:
            query = query.filter(models.Student.class_id.in_(class_ids))
        scope = "assigned_classes"
    elif user.role == "parent":
        student_ids = [
            row[0] for row in db.query(models.ParentStudentLink.student_id).filter_by(
                user_id=user.id
            ).all()
        ]
        query = query.filter(models.Student.id.in_(student_ids) if student_ids else models.Student.id == -1)
        scope = "linked_students"
    elif "view" in user_permissions(user).get("Students", set()):
        scope = "school"
    else:
        raise HTTPException(403, "Your account is not authorised to download student records.")

    rows = query.filter(models.Student.id > after_id).order_by(
        models.Student.id.asc()
    ).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_after_id = rows[-1].id if rows else after_id

    # Keep this bootstrap payload deliberately small; sensitive contact,
    # guardian and photo fields are never included.
    payload = [
        {
            "id": row.id,
            "admission_number": row.admission_number,
            "first_name": row.first_name,
            "middle_name": row.middle_name,
            "last_name": row.last_name,
            "class_id": row.class_id,
            "status": row.status,
            "academic_level": row.academic_level,
            "combination": row.combination,
            "study_mode": row.study_mode,
        }
        for row in rows
    ]
    snapshot_sequence = _sync_snapshot_sequence(db)
    if snapshot_sequence != snapshot_start_sequence:
        raise HTTPException(409, "School records changed while this snapshot page was being prepared. Retry the download.")
    device.last_issued_sequence = max(device.last_issued_sequence, snapshot_sequence)
    device.last_seen_at = datetime.utcnow()
    db.commit()
    return {
        "students": payload,
        "scope": scope,
        "snapshot_sequence": snapshot_sequence,
        "next_after_id": next_after_id,
        "has_more": has_more,
    }


@app.get("/api/sync/classes", tags=["Offline Synchronisation"])
def list_sync_class_snapshot(
    device_id: UUID,
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return class metadata only for classes represented in the user's student scope."""
    device = db.query(models.SyncDevice).filter_by(
        user_id=user.id, device_id=str(device_id)
    ).first()
    if device is None or device.revoked_at is not None:
        raise HTTPException(403, "An active registered device is required.")
    snapshot_start_sequence = _sync_snapshot_sequence(db)

    query = db.query(models.SchoolClass)
    scope = None
    if user.role == "admin":
        scope = "school"
    elif user.role == "teacher":
        if "view" not in user_permissions(user).get("My Classes", set()) and "view" not in user_permissions(user).get("Students", set()):
            raise HTTPException(403, "You do not have permission to view assigned classes.")
        class_ids = {
            row[0] for row in db.query(models.TeacherAssignment.class_id).filter_by(
                teacher_id=user.id
            ).distinct().all()
        }
        class_ids.update(
            row[0] for row in db.query(models.ClassTeacherAssignment.class_id).filter_by(
                teacher_id=user.id
            ).all()
        )
        query = query.filter(models.SchoolClass.id.in_(class_ids) if class_ids else models.SchoolClass.id == -1)
        scope = "assigned_classes"
    elif "view" in user_permissions(user).get("Students", set()):
        scope = "school"
    elif user.role == "parent":
        linked_student_ids = [
            row[0] for row in db.query(models.ParentStudentLink.student_id).filter_by(
                user_id=user.id
            ).all()
        ]
        class_ids = {
            row[0] for row in db.query(models.Student.class_id).filter(
                models.Student.id.in_(linked_student_ids),
                models.Student.class_id.isnot(None),
            ).all()
        } if linked_student_ids else set()
        query = query.filter(models.SchoolClass.id.in_(class_ids) if class_ids else models.SchoolClass.id == -1)
        scope = "linked_students"
    else:
        raise HTTPException(403, "Your account is not authorised to download class records.")

    rows = query.filter(models.SchoolClass.id > after_id).order_by(
        models.SchoolClass.id.asc()
    ).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_after_id = rows[-1].id if rows else after_id

    payload = [
        {"id": row.id, "name": row.name, "section": row.section}
        for row in rows
    ]
    snapshot_sequence = _sync_snapshot_sequence(db)
    if snapshot_sequence != snapshot_start_sequence:
        raise HTTPException(409, "School records changed while this snapshot page was being prepared. Retry the download.")
    device.last_issued_sequence = max(device.last_issued_sequence, snapshot_sequence)
    device.last_seen_at = datetime.utcnow()
    db.commit()
    return {
        "classes": payload,
        "scope": scope,
        "snapshot_sequence": snapshot_sequence,
        "next_after_id": next_after_id,
        "has_more": has_more,
    }




def _sync_active_device(db: Session, user, device_id: UUID):
    device = db.query(models.SyncDevice).filter_by(
        user_id=user.id, device_id=str(device_id)
    ).first()
    if device is None or device.revoked_at is not None:
        raise HTTPException(403, "An active registered device is required.")
    device.last_seen_at = datetime.utcnow()
    return device


def _sync_linked_student_ids(db: Session, user):
    return {
        row[0] for row in db.query(models.ParentStudentLink.student_id).filter_by(
            user_id=user.id
        ).all()
    }


def _sync_teacher_class_ids(db: Session, user):
    ids = {
        row[0] for row in db.query(models.TeacherAssignment.class_id).filter_by(
            teacher_id=user.id
        ).distinct().all()
    }
    ids.update(
        row[0] for row in db.query(models.ClassTeacherAssignment.class_id).filter_by(
            teacher_id=user.id
        ).all()
    )
    return ids




@app.get("/api/sync/attendance", tags=["Offline Synchronisation"])
def list_sync_attendance_snapshot(
    device_id: UUID,
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return minimal attendance records visible to this account."""
    device = _sync_active_device(db, user, device_id)
    snapshot_start_sequence = _sync_snapshot_sequence(db)
    query = db.query(models.Attendance).join(
        models.Student, models.Student.id == models.Attendance.student_id
    )
    scope = None
    if user.role == "admin":
        scope = "school"
    elif user.role == "parent":
        student_ids = _sync_linked_student_ids(db, user)
        query = query.filter(models.Attendance.student_id.in_(student_ids) if student_ids else models.Attendance.id == -1)
        scope = "linked_students"
    elif user.role == "teacher":
        permissions = user_permissions(user)
        if "view" not in permissions.get("My Attendance", set()) and "view" not in permissions.get("Attendance", set()):
            raise HTTPException(403, "You do not have permission to view attendance.")
        # Attendance is visible to both explicitly assigned subject teachers
        # and class teachers, matching the class/student snapshot scope.
        class_ids = _sync_teacher_class_ids(db, user)
        query = query.filter(models.Student.class_id.in_(class_ids) if class_ids else models.Attendance.id == -1)
        scope = "assigned_classes"
    elif "view" in user_permissions(user).get("Attendance", set()):
        scope = "school"
    else:
        raise HTTPException(403, "Your account is not authorised to download attendance records.")

    rows = query.filter(models.Attendance.id > after_id).order_by(
        models.Attendance.id.asc()
    ).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_after_id = rows[-1].id if rows else after_id
    payload = [
        {"id": row.id, "student_id": row.student_id,
         "attendance_date": row.attendance_date, "status": row.status}
        for row in rows
    ]
    snapshot_sequence = _sync_snapshot_sequence(db)
    if snapshot_sequence != snapshot_start_sequence:
        raise HTTPException(409, "School records changed while this snapshot page was being prepared. Retry the download.")
    device.last_issued_sequence = max(device.last_issued_sequence, snapshot_sequence)
    db.commit()
    return {"attendance": payload, "scope": scope, "snapshot_sequence": snapshot_sequence,
            "next_after_id": next_after_id, "has_more": has_more}


@app.get("/api/sync/exams", tags=["Offline Synchronisation"])
def list_sync_exam_snapshot(
    device_id: UUID,
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return exam metadata for classes the account is allowed to see."""
    device = _sync_active_device(db, user, device_id)
    snapshot_start_sequence = _sync_snapshot_sequence(db)
    query = db.query(models.Exam)
    scope = None
    if user.role == "admin":
        scope = "school"
    elif user.role == "parent":
        student_ids = _sync_linked_student_ids(db, user)
        class_ids = {
            row[0] for row in db.query(models.Student.class_id).filter(
                models.Student.id.in_(student_ids), models.Student.class_id.isnot(None)
            ).all()
        } if student_ids else set()
        query = query.filter(
            models.Exam.class_id.in_(class_ids) if class_ids else models.Exam.id == -1,
            models.Exam.status == "published",
        )
        scope = "linked_students"
    elif user.role == "teacher":
        if "view" not in user_permissions(user).get("My Results", set()):
            raise HTTPException(403, "You do not have permission to view assigned exam records.")
        class_ids = _sync_teacher_class_ids(db, user)
        query = query.filter(models.Exam.class_id.in_(class_ids) if class_ids else models.Exam.id == -1)
        scope = "assigned_classes"
    elif "view" in user_permissions(user).get("Examinations", set()):
        scope = "school"
    else:
        raise HTTPException(403, "Your account is not authorised to download examination records.")

    rows = query.filter(models.Exam.id > after_id).order_by(
        models.Exam.id.asc()
    ).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_after_id = rows[-1].id if rows else after_id
    payload = [
        {"id": row.id, "name": row.name, "term": row.term, "year": row.year,
         "class_id": row.class_id, "exam_type": row.exam_type, "status": row.status}
        for row in rows
    ]
    snapshot_sequence = _sync_snapshot_sequence(db)
    if snapshot_sequence != snapshot_start_sequence:
        raise HTTPException(409, "School records changed while this snapshot page was being prepared. Retry the download.")
    device.last_issued_sequence = max(device.last_issued_sequence, snapshot_sequence)
    db.commit()
    return {"exams": payload, "scope": scope, "snapshot_sequence": snapshot_sequence,
            "next_after_id": next_after_id, "has_more": has_more}


@app.get("/api/sync/marks", tags=["Offline Synchronisation"])
def list_sync_mark_snapshot(
    device_id: UUID,
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return marks restricted by student, class, subject and verification scope."""
    device = _sync_active_device(db, user, device_id)
    snapshot_start_sequence = _sync_snapshot_sequence(db)
    query = db.query(models.Mark).join(
        models.Student, models.Student.id == models.Mark.student_id
    )
    scope = None
    if user.role == "admin":
        scope = "school"
    elif user.role == "parent":
        student_ids = _sync_linked_student_ids(db, user)
        query = query.join(models.Exam, models.Exam.id == models.Mark.exam_id).filter(
            models.Mark.student_id.in_(student_ids) if student_ids else models.Mark.id == -1,
            models.Mark.verified.is_(True),
            models.Exam.status == "published",
        )
        scope = "linked_verified_results"
    elif user.role == "teacher":
        if "view" not in user_permissions(user).get("My Results", set()):
            raise HTTPException(403, "You do not have permission to view assigned marks.")
        assignments = db.query(
            models.TeacherAssignment.class_id, models.TeacherAssignment.subject_id
        ).filter_by(teacher_id=user.id).all()
        if not assignments:
            query = query.filter(models.Mark.id == -1)
        else:
            pairs = [(class_id, subject_id) for class_id, subject_id in assignments]
            pair_filter = or_(*[
                (models.Student.class_id == class_id) & (models.Mark.subject_id == subject_id)
                for class_id, subject_id in pairs
            ])
            query = query.filter(pair_filter)
        scope = "assigned_class_subjects"
    elif "view" in user_permissions(user).get("Examinations", set()):
        scope = "school"
    else:
        raise HTTPException(403, "Your account is not authorised to download marks.")

    rows = query.filter(models.Mark.id > after_id).order_by(
        models.Mark.id.asc()
    ).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_after_id = rows[-1].id if rows else after_id
    payload = [
        {"id": row.id, "student_id": row.student_id, "subject_id": row.subject_id,
         "exam_id": row.exam_id, "score": row.score, "verified": row.verified}
        for row in rows
    ]
    snapshot_sequence = _sync_snapshot_sequence(db)
    if snapshot_sequence != snapshot_start_sequence:
        raise HTTPException(409, "School records changed while this snapshot page was being prepared. Retry the download.")
    device.last_issued_sequence = max(device.last_issued_sequence, snapshot_sequence)
    db.commit()
    return {"marks": payload, "scope": scope, "snapshot_sequence": snapshot_sequence,
            "next_after_id": next_after_id, "has_more": has_more}


@app.get("/api/sync/fees", tags=["Offline Synchronisation"])
def list_sync_fee_snapshot(
    device_id: UUID,
    after_charge_id: int = Query(0, ge=0),
    after_payment_id: int = Query(0, ge=0),
    after_class_fee_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return fee records only for linked children or authorised finance staff."""
    device = _sync_active_device(db, user, device_id)
    snapshot_start_sequence = _sync_snapshot_sequence(db)
    is_parent = user.role == "parent"
    if user.role == "admin":
        scope = "school"
        student_ids = None
        class_ids = None
    elif is_parent:
        scope = "linked_students"
        student_ids = _sync_linked_student_ids(db, user)
        class_ids = {
            row[0] for row in db.query(models.Student.class_id).filter(
                models.Student.id.in_(student_ids), models.Student.class_id.isnot(None)
            ).all()
        } if student_ids else set()
    elif "view" in user_permissions(user).get("Fees & Finance", set()):
        scope = "school"
        student_ids = None
        class_ids = None
    else:
        raise HTTPException(403, "Your account is not authorised to download fee records.")

    charge_query = db.query(models.FeeCharge)
    payment_query = db.query(models.FeePayment).join(
        models.FeeCharge, models.FeeCharge.id == models.FeePayment.charge_id
    )
    class_fee_query = db.query(models.ClassFee)
    if is_parent:
        charge_query = charge_query.filter(
            models.FeeCharge.student_id.in_(student_ids) if student_ids else models.FeeCharge.id == -1
        )
        payment_query = payment_query.filter(
            models.FeeCharge.student_id.in_(student_ids) if student_ids else models.FeePayment.id == -1
        )
        class_fee_query = class_fee_query.filter(
            models.ClassFee.class_id.in_(class_ids) if class_ids else models.ClassFee.id == -1
        )

    charges = charge_query.filter(models.FeeCharge.id > after_charge_id).order_by(
        models.FeeCharge.id.asc()
    ).limit(limit + 1).all()
    payments = payment_query.filter(models.FeePayment.id > after_payment_id).order_by(
        models.FeePayment.id.asc()
    ).limit(limit + 1).all()
    class_fees = class_fee_query.filter(models.ClassFee.id > after_class_fee_id).order_by(
        models.ClassFee.id.asc()
    ).limit(limit + 1).all()

    charge_more, payment_more, class_fee_more = (
        len(charges) > limit, len(payments) > limit, len(class_fees) > limit
    )
    charges, payments, class_fees = charges[:limit], payments[:limit], class_fees[:limit]
    payload_charges = [
        {"id": row.id, "student_id": row.student_id, "term": row.term,
         "year": row.year, "amount": row.amount, "description": row.description}
        for row in charges
    ]
    payload_payments = [
        {"id": row.id, "charge_id": row.charge_id, "amount": row.amount,
         "payment_date": row.payment_date, "method": row.method,
         "receipt_number": row.receipt_number}
        for row in payments
    ]
    payload_class_fees = [
        {"id": row.id, "class_id": row.class_id, "term": row.term, "year": row.year,
         "amount": row.amount, "boarding_amount": row.boarding_amount,
         "day_amount": row.day_amount}
        for row in class_fees
    ]
    snapshot_sequence = _sync_snapshot_sequence(db)
    if snapshot_sequence != snapshot_start_sequence:
        raise HTTPException(409, "School records changed while this snapshot page was being prepared. Retry the download.")
    device.last_issued_sequence = max(device.last_issued_sequence, snapshot_sequence)
    db.commit()
    return {
        "scope": scope, "snapshot_sequence": snapshot_sequence,
        "charges": payload_charges, "payments": payload_payments,
        "class_fees": payload_class_fees,
        "next_after_charge_id": charges[-1].id if charges else after_charge_id,
        "next_after_payment_id": payments[-1].id if payments else after_payment_id,
        "next_after_class_fee_id": class_fees[-1].id if class_fees else after_class_fee_id,
        "has_more": {"charges": charge_more, "payments": payment_more, "class_fees": class_fee_more},
    }



@app.post("/api/sync/devices/{device_id}/checkpoint", tags=["Offline Synchronisation"])
def acknowledge_sync_checkpoint(
    device_id: UUID,
    sequence: int = Query(..., ge=0),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Persist the highest change sequence successfully processed by this device."""
    # Checkpoints belong to the authenticated device owner, not an admin role.
    # Any account may acknowledge only sequences delivered to its own active device.
    device = db.query(models.SyncDevice).filter_by(
        user_id=user.id, device_id=str(device_id)
    ).first()
    if device is None or device.revoked_at is not None:
        raise HTTPException(403, "An active registered device is required.")

    if sequence > device.last_issued_sequence:
        raise HTTPException(409, "A device cannot acknowledge changes that have not been delivered to it.")
    if sequence < device.last_sync_sequence:
        raise HTTPException(409, "A sync checkpoint cannot move backwards.")

    device.last_sync_sequence = sequence
    device.last_seen_at = datetime.utcnow()
    db.commit()
    return {
        "device_id": device.device_id,
        "last_sync_sequence": device.last_sync_sequence,
        "message": "Sync checkpoint saved.",
    }


@app.delete("/api/sync/devices/{device_id}", tags=["Offline Synchronisation"])
def revoke_sync_device(
    device_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    device = db.query(models.SyncDevice).filter_by(
        user_id=user.id, device_id=str(device_id)
    ).first()
    if device is None:
        raise HTTPException(404, "Registered device not found.")

    if device.revoked_at is None:
        device.revoked_at = datetime.utcnow()
        write_audit(
            db, user, "sync_device_revoked", "sync_device", device.id,
            f"device_id={device.device_id}; device_name={device.device_name}",
        )
        db.commit()

    return {"message": "Device access to future SchoolBridge synchronisation has been revoked."}


@app.post("/api/auth/users/{user_id}/reset-password", tags=["User Management"])
def admin_reset_user_password(user_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    target = db.get(models.User, user_id)
    if not target or target.role not in {"teacher", "staff"}:
        raise HTTPException(404, "Staff login account not found.")
    temporary_password = secrets.token_urlsafe(10)
    target.hashed_password = password_hash.hash(temporary_password)
    target.must_change_password = True
    target.reset_code_hash = None
    target.reset_expires_at = None
    target.reset_requested_at = None
    target.reset_attempts = 0
    write_audit(db, admin, "staff_password_reset", "user", target.id, "Administrator issued a one-time temporary passcode.")
    db.commit()
    return {"message": "Temporary passcode generated. It is shown only once; the staff member must change it after signing in.", "username": target.username, "temporary_password": temporary_password}


@app.post("/api/auth/teachers", tags=["User Management"])
def create_teacher(
    data: TeacherCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    staff = db.get(models.StaffMember, data.staff_id)
    if not staff or staff.status != "active":
        raise HTTPException(404, "Select an existing active staff member.")
    if db.query(models.User).filter(models.User.staff_id == staff.id).first():
        raise HTTPException(409, "This staff member already has a login account.")
    role_type = "teacher" if staff.category == "Teaching" else "staff"
    teacher = models.User(
        username=data.username.strip(),
        email=data.email.strip().lower(),
        hashed_password=password_hash.hash(data.password),
        role=role_type,
        role_label=(staff.position or ("Teacher" if role_type == "teacher" else "Staff"))[:80],
        staff_id=staff.id,
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
        "Headteacher": ["Overview", "School Community", "Students", "Staff", "Fees & Finance", "Examinations", "Attendance", "Staff Attendance", "Timetable", "Leadership & Duty", "Parent Access", "Parent Liaison", "Announcements", "Reports"],
        "Deputy Headteacher": ["Overview", "School Community", "Students", "Staff", "Examinations", "Attendance", "Timetable", "Leadership & Duty", "Parent Liaison", "Announcements", "Reports"],
        "DOS": ["Overview", "School Community", "Staff", "Examinations", "Attendance", "Timetable", "Students", "Parent Liaison", "Reports", "Announcements"],
        "Academic Administrator": ["Overview", "Examinations", "Timetable", "Students", "Parent Liaison", "Reports", "Announcements"],
        "Academics Officer": ["Overview", "Examinations", "Timetable", "Students", "Reports"],
        "Bursar": ["Overview", "Fees & Finance", "Students", "Reports"],
        "Accountant": ["Overview", "Fees & Finance", "Staff", "Reports"],
        "Secretary": ["Overview", "School Community", "Students", "Staff", "Parent Access", "Parent Liaison", "Announcements", "Reports"],
        "Attendance Officer": ["Overview", "Attendance", "Staff Attendance", "Reports"],
        "Teacher": ["School Community", "My Classes", "My Attendance", "My Results", "Parent Liaison", "Announcements", "Timetable"],
        "Class Teacher": ["School Community", "My Classes", "Students", "Attendance", "My Attendance", "My Results", "Parent Liaison", "Announcements", "Timetable"],
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
            "staff_id": u.staff_id,
        }
        for u in users
    ]




@app.post("/api/parent-accounts", tags=["Parent Access"])
def create_parent_account(data: ParentAccountCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    temporary_password = secrets.token_urlsafe(12)
    student_ids = list(dict.fromkeys(data.student_ids))
    students = db.query(models.Student).filter(
        models.Student.id.in_(student_ids), models.Student.status == "active"
    ).all()
    if len(students) != len(student_ids):
        raise HTTPException(404, "One or more selected students could not be found or are no longer active.")
    already_linked = db.query(models.ParentStudentLink).filter(models.ParentStudentLink.student_id.in_(student_ids)).first()
    if already_linked:
        raise HTTPException(409, "At least one selected student already has a parent login. Use that same account for both guardians; do not create a second login.")
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
    return {"id": parent.id, "username": parent.username, "email": parent.email, "role": parent.role, "linked_students": len(student_ids), "guardians": list(dict.fromkeys(name for student in students for name in [student.guardian_name, student.guardian2_name] if name)), "guardian_phones": list(dict.fromkeys(phone for student in students for phone in [student.guardian_phone, student.guardian2_phone] if phone)), "temporary_password": temporary_password, "email_sent": email_sent, "email_error": email_error}


@app.get("/api/parent-accounts", tags=["Parent Access"])
def list_parent_accounts(db: Session = Depends(get_db), admin=Depends(require_admin)):
    parents = db.query(models.User).filter_by(role="parent", is_active=True).order_by(models.User.username).all()
    output = []
    for parent in parents:
        links = db.query(models.ParentStudentLink).filter_by(user_id=parent.id).all()
        children = []
        for link in links:
            student = db.get(models.Student, link.student_id)
            if student and student.status == "active":
                children.append({"id": student.id, "name": " ".join(x for x in [student.first_name, student.middle_name, student.last_name] if x), "admission_number": student.admission_number, "guardians": [name for name in [student.guardian_name, student.guardian2_name] if name], "guardian_phones": [phone for phone in [student.guardian_phone, student.guardian2_phone] if phone]})
        output.append({"id": parent.id, "username": parent.username, "email": parent.email, "active": parent.is_active, "children": children})
    return output


@app.delete("/api/parent-accounts/{parent_id}", tags=["Parent Access"])
def remove_parent_account(parent_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    parent = db.query(models.User).filter_by(id=parent_id, role="parent").first()
    if not parent:
        raise HTTPException(404, "Parent account not found.")
    links = db.query(models.ParentStudentLink).filter_by(user_id=parent.id).all()
    linked_student_ids = [str(link.student_id) for link in links]
    if parent.is_active:
        parent.is_active = False
        parent.token_version = int(parent.token_version or 0) + 1
    write_audit(
        db, admin, "parent_account_deactivated", "user", parent.id,
        f"username={parent.username}; retained_student_links={','.join(linked_student_ids)}",
    )
    db.commit()
    return {"deactivated": True, "parent_id": parent_id, "retained_student_links": len(links)}


@app.get("/api/parent/children", tags=["Parent Portal"])
def parent_children(db: Session = Depends(get_db), parent=Depends(require_parent)):
    links = db.query(models.ParentStudentLink).filter_by(user_id=parent.id).all()
    output = []
    for link in links:
        student = db.get(models.Student, link.student_id)
        if not student or student.status != "active":
            continue
        school_class = db.get(models.SchoolClass, student.class_id) if student.class_id else None
        charges = db.query(models.FeeCharge).filter_by(student_id=student.id).all()
        total_charged = sum(row.amount for row in charges)
        total_paid = sum(db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter_by(charge_id=row.id).scalar() or 0 for row in charges)
        output.append({"id": student.id, "name": " ".join(x for x in [student.first_name, student.middle_name, student.last_name] if x), "admission_number": student.admission_number, "status": student.status, "class_id": student.class_id,
            "class_name": (school_class.name + (" — " + school_class.section if school_class and school_class.section else "")) if school_class else "Unassigned", "stream": school_class.section if school_class else "", "fees_charged": total_charged, "fees_paid": total_paid, "balance": total_charged-total_paid})
    return output


@app.get("/api/parent/children/{student_id}/results", tags=["Parent Portal"])
def parent_child_results(student_id: int, db: Session = Depends(get_db), parent=Depends(require_parent)):
    student = linked_parent_student(db, parent, student_id)
    rows = db.query(models.Mark, models.Exam, models.Subject).join(
        models.Exam, models.Exam.id == models.Mark.exam_id
    ).join(models.Subject, models.Subject.id == models.Mark.subject_id).filter(
        models.Mark.student_id == student.id, models.Mark.verified.is_(True),
        models.Exam.status == "published",
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




def _parent_liaison_staff_access(user, action: str = "view"):
    if user.role == "admin":
        return
    if user.role not in {"teacher", "staff"}:
        raise HTTPException(403, "Authorised staff account required.")
    if action not in user_permissions(user).get("Parent Liaison", set()):
        raise HTTPException(403, "You do not have permission to use Parent Liaison.")


def _staff_can_contact_student(db: Session, user, student):
    if user.role == "admin":
        return True
    if user.role == "teacher":
        if is_assigned_class_teacher(db, user.id, student.class_id or -1):
            return True
        return db.query(models.TeacherAssignment.id).filter_by(
            teacher_id=user.id, class_id=student.class_id
        ).first() is not None
    return "add" in user_permissions(user).get("Parent Liaison", set())


def _liaison_thread_access(db: Session, user, thread):
    if user.role == "parent":
        if thread.parent_user_id != user.id:
            raise HTTPException(404, "Communication record not found.")
        linked_parent_student(db, user, thread.student_id)
        return "parent"
    _parent_liaison_staff_access(user, "view")
    if user.role == "admin" or thread.initiated_by == user.id:
        return "staff"
    student = db.get(models.Student, thread.student_id)
    if student and _staff_can_contact_student(db, user, student):
        return "staff"
    raise HTTPException(404, "Communication record not found.")


@app.get("/api/parent-liaison/recipients", tags=["Parent Liaison"])
def parent_liaison_recipients(class_id: int | None = None, search: str = "", db: Session = Depends(get_db), user=Depends(get_current_user)):
    _parent_liaison_staff_access(user, "add")
    query = db.query(models.Student).filter(models.Student.status == "active")
    if class_id is not None: query = query.filter(models.Student.class_id == class_id)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(models.Student.admission_number.ilike(term), models.Student.first_name.ilike(term), models.Student.middle_name.ilike(term), models.Student.last_name.ilike(term)))
    students = query.order_by(models.Student.last_name, models.Student.first_name).limit(500).all()
    output = []
    for student in students:
        if not _staff_can_contact_student(db, user, student):
            continue
        links = db.query(models.ParentStudentLink, models.User).join(
            models.User, models.User.id == models.ParentStudentLink.user_id
        ).filter(models.ParentStudentLink.student_id == student.id, models.User.is_active.is_(True), models.User.role == "parent").order_by(models.ParentStudentLink.created_at.asc(), models.User.id.asc()).all()
        if not links: continue
        primary_parent = links[0][1]
        school_class = db.get(models.SchoolClass, student.class_id) if student.class_id else None
        output.append({
            "student_id": student.id,
            "student_name": " ".join(part for part in [student.first_name, student.middle_name, student.last_name] if part),
            "admission_number": student.admission_number,
            "class_name": school_class.name if school_class else "Unassigned",
            "parent_account": primary_parent.username,
            "parents": [{"id": primary_parent.id, "username": primary_parent.username, "email": primary_parent.email}],
            "parents": [{"id": primary_parent.id, "username": primary_parent.username, "email": primary_parent.email}],
        })
    return output


@app.post("/api/parent-liaison/threads", tags=["Parent Liaison"])
def create_parent_liaison_thread(data: ParentLiaisonThreadCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _parent_liaison_staff_access(user, "add")
    student = db.get(models.Student, data.student_id)
    if not student or student.status != "active":
        raise HTTPException(404, "Active student record not found.")
    if not _staff_can_contact_student(db, user, student):
        raise HTTPException(403, "You are not authorised to contact parents for this student.")
    linked_accounts = db.query(models.User).join(models.ParentStudentLink, models.ParentStudentLink.user_id == models.User.id).filter(
        models.ParentStudentLink.student_id == student.id, models.User.role == "parent", models.User.is_active.is_(True)
    ).order_by(models.ParentStudentLink.created_at.asc(), models.User.id.asc()).all()
    if not linked_accounts:
        raise HTTPException(422, "No active parent account is linked to this student. Link one parent account before sending a communication.")
    parent = linked_accounts[0]
    thread = models.ParentLiaisonThread(
        student_id=student.id, parent_user_id=parent.id, initiated_by=user.id,
        subject=data.subject.strip(), category=data.category,
    )
    db.add(thread)
    db.flush()
    first_message = models.ParentLiaisonMessage(thread_id=thread.id, sender_id=user.id, message=data.message.strip())
    db.add(first_message)
    write_audit(db, user, "parent_liaison_initiated", "parent_liaison_thread", thread.id,
                f"student_id={student.id}; parent_user_id={parent.id}; category={data.category}")
    db.commit()
    db.refresh(thread)
    return {"id": thread.id, "subject": thread.subject, "status": thread.status, "created_at": thread.created_at}


@app.get("/api/parent-liaison/threads", tags=["Parent Liaison"])
def list_parent_liaison_threads(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role == "parent":
        query = db.query(models.ParentLiaisonThread).filter_by(parent_user_id=user.id)
    else:
        _parent_liaison_staff_access(user, "view")
        if user.role == "admin":
            query = db.query(models.ParentLiaisonThread)
        else:
            query = db.query(models.ParentLiaisonThread).filter(
                models.ParentLiaisonThread.initiated_by == user.id
            )
    rows = query.order_by(models.ParentLiaisonThread.updated_at.desc(), models.ParentLiaisonThread.id.desc()).limit(200).all()
    output = []
    for thread in rows:
        student = db.get(models.Student, thread.student_id)
        parent = db.get(models.User, thread.parent_user_id)
        last = db.query(models.ParentLiaisonMessage).filter_by(thread_id=thread.id).order_by(
            models.ParentLiaisonMessage.id.desc()
        ).first()
        output.append({
            "id": thread.id, "student_id": thread.student_id,
            "student_name": " ".join(part for part in [student.first_name, student.middle_name, student.last_name] if part) if student else "Student",
            "parent_name": parent.username if parent else "Parent",
            "subject": thread.subject, "category": thread.category, "status": thread.status,
            "created_at": thread.created_at, "updated_at": thread.updated_at,
            "last_message": last.message[:180] if last else "",
            "last_sender_id": last.sender_id if last else None,
        })
    return output


@app.get("/api/parent-liaison/threads/{thread_id}", tags=["Parent Liaison"])
def get_parent_liaison_thread(thread_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    thread = db.get(models.ParentLiaisonThread, thread_id)
    if not thread:
        raise HTTPException(404, "Communication record not found.")
    _liaison_thread_access(db, user, thread)
    messages = db.query(models.ParentLiaisonMessage).filter_by(thread_id=thread.id).order_by(
        models.ParentLiaisonMessage.id
    ).all()
    for item in messages:
        if item.sender_id != user.id and item.read_at is None:
            item.read_at = datetime.utcnow()
    db.commit()
    return {
        "current_user_id": user.id,
        "id": thread.id, "student_id": thread.student_id, "subject": thread.subject,
        "category": thread.category, "status": thread.status,
        "student_name": " ".join(part for part in [
            db.get(models.Student, thread.student_id).first_name,
            db.get(models.Student, thread.student_id).middle_name,
            db.get(models.Student, thread.student_id).last_name,
        ] if part),
        "messages": [{
            "id": item.id, "sender_id": item.sender_id,
            "sender_name": (db.get(models.User, item.sender_id).username if db.get(models.User, item.sender_id) else "User"),
            "sender_role": (db.get(models.User, item.sender_id).role if db.get(models.User, item.sender_id) else "unknown"),
            "message": item.message, "created_at": item.created_at,
            "read_at": item.read_at,
        } for item in messages],
    }


@app.post("/api/parent-liaison/threads/{thread_id}/messages", tags=["Parent Liaison"])
def reply_parent_liaison_thread(thread_id: int, data: ParentLiaisonMessageCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    thread = db.get(models.ParentLiaisonThread, thread_id)
    if not thread:
        raise HTTPException(404, "Communication record not found.")
    side = _liaison_thread_access(db, user, thread)
    if thread.status != "Open":
        raise HTTPException(409, "This communication record is closed.")
    item = models.ParentLiaisonMessage(thread_id=thread.id, sender_id=user.id, message=data.message.strip())
    thread.updated_at = datetime.utcnow()
    db.add(item)
    write_audit(db, user, "parent_liaison_reply_sent", "parent_liaison_thread", thread.id,
                f"sender_role={side}")
    db.commit()
    db.refresh(item)
    return {"id": item.id, "created_at": item.created_at, "message": item.message}


@app.patch("/api/parent-liaison/threads/{thread_id}/status", tags=["Parent Liaison"])
def update_parent_liaison_status(thread_id: int, status: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _parent_liaison_staff_access(user, "edit")
    thread = db.get(models.ParentLiaisonThread, thread_id)
    if not thread:
        raise HTTPException(404, "Communication record not found.")
    if user.role != "admin" and thread.initiated_by != user.id:
        raise HTTPException(404, "Communication record not found.")
    if status not in {"Open", "Closed"}:
        raise HTTPException(422, "Status must be Open or Closed.")
    thread.status = status
    thread.updated_at = datetime.utcnow()
    write_audit(db, user, "parent_liaison_status_changed", "parent_liaison_thread", thread.id, status)
    db.commit()
    return {"id": thread.id, "status": thread.status}


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

    subject = db.get(models.Subject, data.subject_id)
    if not subject:
        raise HTTPException(404, "Subject not found.")

    if not teacher.staff_id:
        raise HTTPException(422, "This teacher login is not linked to a staff registration profile.")
    staff_profile = db.get(models.StaffMember, teacher.staff_id)
    registered_subjects = {
        name.strip().casefold()
        for name in (staff_profile.subjects or "").split(",")
        if name.strip()
    } if staff_profile else set()
    if subject.name.strip().casefold() not in registered_subjects:
        raise HTTPException(422, "This subject was not registered under the selected teacher. Update the teacher's registered subjects first.")

    assignment = models.TeacherAssignment(**data.model_dump())
    db.add(assignment)

    try:
        db.commit()
        db.refresh(assignment)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This assignment already exists.")

    return {"message": "Teacher assigned successfully.", "id": assignment.id}


@app.get("/api/class-teacher-assignments", tags=["Teacher Management"])
def list_class_teacher_assignments(db: Session = Depends(get_db), admin=Depends(require_admin)):
    rows = db.query(models.ClassTeacherAssignment, models.User, models.SchoolClass).join(
        models.User, models.User.id == models.ClassTeacherAssignment.teacher_id
    ).join(models.SchoolClass, models.SchoolClass.id == models.ClassTeacherAssignment.class_id).order_by(
        models.SchoolClass.name, models.SchoolClass.section
    ).all()
    return [{
        "id": assignment.id, "teacher_id": teacher.id, "class_id": school_class.id,
        "teacher_name": teacher.username, "class_name": school_class.name,
        "section": school_class.section,
    } for assignment, teacher, school_class in rows]


@app.post("/api/class-teacher-assignments", tags=["Teacher Management"])
def assign_class_teacher(data: ClassTeacherAssignmentCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    teacher = db.get(models.User, data.teacher_id)
    if not teacher or teacher.role != "teacher":
        raise HTTPException(404, "Select a valid teacher login account.")
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")
    existing = db.query(models.ClassTeacherAssignment).filter_by(class_id=data.class_id).first()
    if existing:
        previous_teacher_id = existing.teacher_id
        existing.teacher_id = data.teacher_id
        assignment = existing
        if previous_teacher_id != data.teacher_id:
            previous_teacher = db.get(models.User, previous_teacher_id)
            remaining = db.query(models.ClassTeacherAssignment.id).filter(
                models.ClassTeacherAssignment.teacher_id == previous_teacher_id,
                models.ClassTeacherAssignment.id != existing.id,
            ).first()
            if previous_teacher and not remaining:
                previous_permissions = user_permissions(previous_teacher)
                previous_permissions.pop("Attendance", None)
                previous_teacher.permissions_json = json.dumps({key: sorted(value) for key, value in previous_permissions.items()})
    else:
        assignment = models.ClassTeacherAssignment(**data.model_dump())
        db.add(assignment)
    permissions = user_permissions(teacher)
    permissions["Attendance"] = {"view", "add", "edit"}
    teacher.permissions_json = json.dumps({key: sorted(value) for key, value in permissions.items()})
    write_audit(db, admin, "class_teacher_assigned", "class", data.class_id, f"Teacher account {teacher.username}")
    db.commit()
    db.refresh(assignment)
    return {"id": assignment.id, "message": "Class teacher assigned successfully."}


@app.delete("/api/class-teacher-assignments/{assignment_id}", tags=["Teacher Management"])
def remove_class_teacher(assignment_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    assignment = db.get(models.ClassTeacherAssignment, assignment_id)
    if not assignment:
        raise HTTPException(404, "Class teacher assignment not found.")
    teacher = db.get(models.User, assignment.teacher_id)
    class_id = assignment.class_id
    write_audit(db, admin, "class_teacher_removed", "class", class_id, f"Assignment {assignment.id}")
    db.delete(assignment)
    db.flush()
    if teacher and not db.query(models.ClassTeacherAssignment.id).filter_by(teacher_id=teacher.id).first():
        permissions = user_permissions(teacher)
        permissions.pop("Attendance", None)
        teacher.permissions_json = json.dumps({key: sorted(value) for key, value in permissions.items()})
    db.commit()
    return {"message": "Class teacher assignment removed."}


@app.get("/api/teacher/my-class-teacher-assignments", tags=["Teacher Workspace"])
def my_class_teacher_assignments(db: Session = Depends(get_db), teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    rows = db.query(models.ClassTeacherAssignment, models.SchoolClass).join(
        models.SchoolClass, models.SchoolClass.id == models.ClassTeacherAssignment.class_id
    ).filter(models.ClassTeacherAssignment.teacher_id == teacher.id).all()
    return [{
        "assignment_id": assignment.id, "class_id": school_class.id,
        "class": school_class.name + (" — " + school_class.section if school_class.section else ""),
    } for assignment, school_class in rows]


def get_linked_staff_member(db: Session, user):
    staff_member = db.get(models.StaffMember, user.staff_id) if user.staff_id else None
    if staff_member is None:
        staff_member = db.query(models.StaffMember).filter(
            func.lower(models.StaffMember.email) == (user.email or "").lower()
        ).first()
    if staff_member is None and user.username:
        staff_member = db.query(models.StaffMember).filter(
            func.lower(models.StaffMember.staff_number) == user.username.lower()
        ).first()
    return staff_member


@app.get("/api/me/staff-attendance", tags=["Staff Attendance"])
def my_staff_attendance(db: Session = Depends(get_db), user=Depends(get_current_user)):
    staff_member = get_linked_staff_member(db, user)
    if not staff_member:
        raise HTTPException(404, "Your login is not linked to a staff profile. Ask the administrator to link your staff account.")
    records = db.query(models.StaffAttendance).filter(
        models.StaffAttendance.staff_id == staff_member.id
    ).order_by(models.StaffAttendance.attendance_date.desc(), models.StaffAttendance.id.desc()).limit(90).all()
    today_local = datetime.now(ZoneInfo("Africa/Kampala")).date()
    today_record = next((row for row in records if row.attendance_date == today_local), None)
    return {
        "staff_name": f"{staff_member.first_name} {staff_member.last_name}",
        "staff_number": staff_member.staff_number,
        "today": {
            "attendance_date": today_local,
            "status": today_record.status if today_record else "Not checked in",
            "check_in_at": today_record.check_in_at if today_record else None,
            "check_out_at": today_record.check_out_at if today_record else None,
        },
        "records": [{
            "id": row.id, "attendance_date": row.attendance_date, "status": row.status,
            "notes": row.notes, "check_in_at": row.check_in_at, "check_out_at": row.check_out_at,
        } for row in records],
    }


@app.get("/api/me/staff-attendance", tags=["Staff Attendance"])
def get_my_staff_attendance(db: Session = Depends(get_db), user=Depends(get_current_user)):
    staff_member = get_linked_staff_member(db, user)
    if not staff_member:
        raise HTTPException(404, "Your login is not linked to a staff profile.")
    records = db.query(models.StaffAttendance).filter(
        models.StaffAttendance.staff_id == staff_member.id
    ).order_by(models.StaffAttendance.attendance_date.desc(), models.StaffAttendance.id.desc()).limit(60).all()
    return {"records": [{
        "id": row.id, "attendance_date": row.attendance_date, "status": row.status,
        "notes": row.notes, "check_in_at": row.check_in_at, "check_out_at": row.check_out_at,
    } for row in records]}


@app.post("/api/me/staff-attendance/check-in", tags=["Staff Attendance"])
def staff_self_check_in(db: Session = Depends(get_db), user=Depends(get_current_user)):
    staff_member = get_linked_staff_member(db, user)
    if not staff_member or staff_member.status != "active":
        raise HTTPException(404, "Your active staff profile could not be found.")
    local_now = datetime.now(ZoneInfo("Africa/Kampala")).replace(tzinfo=None, microsecond=0)
    record = db.query(models.StaffAttendance).filter_by(
        staff_id=staff_member.id, attendance_date=local_now.date()
    ).first()
    if record and record.check_in_at:
        raise HTTPException(409, "You have already checked in today.")
    if record is None:
        record = models.StaffAttendance(
            staff_id=staff_member.id, attendance_date=local_now.date(),
            status="Present", notes="On shift",
        )
        db.add(record)
    record.check_in_at = local_now
    # Keep the shift note in sync even when today's attendance row already existed.
    record.notes = "On shift"
    # A successful self check-in confirms presence; authorised attendance staff
    # may later revise the status to Late, Excused or another valid value.
    record.status = "Present"
    write_audit(db, user, "staff_self_check_in", "staff_attendance", staff_member.id,
                f"Checked in at {local_now.strftime('%H:%M')} on {local_now.date()}.")
    db.commit()
    db.refresh(record)
    return {"message": "Check-in recorded and sent to the attendance office.", "check_in_at": record.check_in_at, "status": record.status}


@app.post("/api/me/staff-attendance/check-out", tags=["Staff Attendance"])
def staff_self_check_out(db: Session = Depends(get_db), user=Depends(get_current_user)):
    staff_member = get_linked_staff_member(db, user)
    if not staff_member or staff_member.status != "active":
        raise HTTPException(404, "Your active staff profile could not be found.")
    local_now = datetime.now(ZoneInfo("Africa/Kampala")).replace(tzinfo=None, microsecond=0)
    record = db.query(models.StaffAttendance).filter_by(
        staff_id=staff_member.id, attendance_date=local_now.date()
    ).first()
    if not record or not record.check_in_at:
        raise HTTPException(409, "Check in before recording your check-out.")
    if record.check_out_at:
        raise HTTPException(409, "You have already checked out today.")
    record.check_out_at = local_now
    record.notes = "Shift ended"
    write_audit(db, user, "staff_self_check_out", "staff_attendance", staff_member.id,
                f"Checked out at {local_now.strftime('%H:%M')} on {local_now.date()}.")
    db.commit()
    return {"message": "Check-out time recorded.", "check_out_at": record.check_out_at, "status": record.status}


@app.get("/api/teacher/my-staff-attendance", tags=["Teacher Workspace"])
def teacher_my_staff_attendance(
    db: Session = Depends(get_db),
    teacher=Depends(get_current_user),
):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    staff_member = get_linked_staff_member(db, teacher)
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
                "check_in_at": row.check_in_at,
                "check_out_at": row.check_out_at,
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
    assigned_pairs = {
        (row.class_id, row.subject_id) for row in db.query(models.TeacherAssignment).filter_by(teacher_id=teacher.id).all()
    }
    class_ids = sorted({class_id for class_id, _ in assigned_pairs})
    if not class_ids:
        return []
    exams = db.query(models.Exam).filter(models.Exam.class_id.in_(class_ids)).order_by(
        models.Exam.year.desc(), models.Exam.term, models.Exam.name
    ).all()
    output = []
    for exam in exams:
        subject_ids = [subject_id for class_id, subject_id in assigned_pairs if class_id == exam.class_id]
        subjects = db.query(models.Subject).filter(models.Subject.id.in_(subject_ids or [-1])).order_by(models.Subject.name).all()
        if subjects:
            output.append({**{key: getattr(exam, key) for key in ("id", "name", "term", "year", "class_id", "status")},
                           "assigned_subjects": [{"id": subject.id, "name": subject.name} for subject in subjects]})
    return output


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
        if mark.verified:
            continue
        rows.append({
            "id": mark.id, "student_id": mark.student_id,
            "subject_id": mark.subject_id, "exam_id": mark.exam_id,
            "score": mark.score, "verified": False, "student_name": " ".join(
                part for part in [student.first_name, student.middle_name, student.last_name] if part
            ), "admission_number": student.admission_number,
            "class_id": student.class_id,
        })
    return rows


@app.get("/api/teacher/result-status", tags=["Teacher Workspace"])
def teacher_result_status(exam_id: int, db: Session = Depends(get_db),
                          teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    exam = db.get(models.Exam, exam_id)
    if not exam:
        raise HTTPException(404, "Examination not found.")
    assignments = db.query(models.TeacherAssignment).filter_by(
        teacher_id=teacher.id, class_id=exam.class_id
    ).all()
    if not assignments:
        raise HTTPException(403, "You are not assigned to this examination's class.")
    subject_ids = {row.subject_id for row in assignments}
    marks = db.query(models.Mark).filter(
        models.Mark.exam_id == exam.id,
        models.Mark.subject_id.in_(subject_ids or {-1})
    ).all()
    output = []
    for subject_id in sorted(subject_ids):
        subject_marks = [mark for mark in marks if mark.subject_id == subject_id]
        submitted = len(subject_marks)
        pending = sum(1 for mark in subject_marks if not mark.verified)
        verified = sum(1 for mark in subject_marks if mark.verified)
        status = "Not submitted" if not submitted else ("Verified" if pending == 0 else "Not verified")
        output.append({
            "subject_id": subject_id,
            "submitted_count": submitted,
            "pending_count": pending,
            "verified_count": verified,
            "status": status,
        })
    return output


@app.post("/api/teacher/marks/bulk", tags=["Teacher Workspace"])
def save_teacher_marks_bulk(data: BulkMarkCreate, db: Session = Depends(get_db), teacher=Depends(get_current_user)):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    exam = db.get(models.Exam, data.exam_id)
    subject = db.get(models.Subject, data.subject_id)
    if not exam or not subject or exam.class_id is None:
        raise HTTPException(404, "Class examination or subject not found.")
    require_exam_open(exam)
    assigned = db.query(models.TeacherAssignment).filter_by(
        teacher_id=teacher.id, class_id=exam.class_id, subject_id=subject.id
    ).first()
    if not assigned:
        raise HTTPException(403, "You are not assigned to teach this subject in this class.")
    student_ids = [row.student_id for row in data.records]
    if len(student_ids) != len(set(student_ids)):
        raise HTTPException(422, "Each student may appear only once in this class submission.")
    students = db.query(models.Student).filter(
        models.Student.id.in_(student_ids), models.Student.class_id == exam.class_id,
        models.Student.status == "active"
    ).all()
    if len(students) != len(student_ids):
        raise HTTPException(422, "Every submitted student must be active and belong to this examination's class.")
    existing = db.query(models.Mark).filter(
        models.Mark.exam_id == exam.id, models.Mark.subject_id == subject.id
    ).all()
    if any(row.verified for row in existing):
        raise HTTPException(409, "These results have been verified and locked. Teachers can no longer submit or change this subject's results.")
    existing = [row for row in existing if row.student_id in set(student_ids)]
    by_student = {row.student_id: row for row in existing}
    verified = {row.student_id: row for row in existing if row.verified}
    changed_verified = [entry.student_id for entry in data.records
                        if entry.student_id in verified and verified[entry.student_id].score != entry.score]
    if changed_verified:
        raise HTTPException(409, "Some submitted marks have already been verified. Ask the administrator to unlock them before changing those scores.")
    saved = 0
    for entry in data.records:
        mark = by_student.get(entry.student_id)
        if mark:
            if not mark.verified:
                mark.score = entry.score
                saved += 1
        else:
            db.add(models.Mark(student_id=entry.student_id, subject_id=subject.id, exam_id=exam.id, score=entry.score))
            saved += 1
    no_score_count = sum(1 for entry in data.records if entry.score == 0)
    # Create explicit zero-score rows for active learners omitted from the submission.
    # This records "No score" and lets academic officers verify the complete class.
    missing_students = db.query(models.Student).filter(
        models.Student.class_id == exam.class_id,
        models.Student.status == "active",
        ~models.Student.id.in_(student_ids),
    ).all()
    for student in missing_students:
        db.add(models.Mark(
            student_id=student.id, subject_id=subject.id, exam_id=exam.id, score=0
        ))
        no_score_count += 1
        saved += 1
    write_audit(db, teacher, "teacher_class_marks_submitted", "exam", exam.id,
                f"{saved} marks including {no_score_count} No score entries; class {exam.class_id}; subject {subject.name}")
    db.commit()
    return {"message": "Class results submitted successfully.", "saved": saved, "no_score": no_score_count, "exam_id": exam.id,
            "class_id": exam.class_id, "subject_id": subject.id}


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
    require_exam_open(exam)
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
    house: str | None = None

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

class OfflineFinancePaymentCreate(BaseModel):
    device_id: UUID
    idempotency_key: str = Field(min_length=16, max_length=100)
    charge_id: int = Field(ge=1)
    amount: int = Field(gt=0)
    payment_date: date = Field(default_factory=date.today)
    method: str = Field(default="Cash", max_length=30)
    reference: str | None = Field(default=None, max_length=80)
    base_sequence: int = Field(ge=0)



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
        "guardian2_name": "VARCHAR(160)", "guardian2_relationship": "VARCHAR(60)", "guardian2_phone": "VARCHAR(30)", "study_mode": "VARCHAR(20) NOT NULL DEFAULT 'Day'", "house": "VARCHAR(80)", "photo_data": "TEXT",
    }
    settings_columns = {c["name"] for c in inspector.get_columns("school_settings")} if "school_settings" in inspector.get_table_names() else set()
    staff_columns = {c["name"] for c in inspector.get_columns("staff_members")} if "staff_members" in inspector.get_table_names() else set()
    payment_columns = {c["name"] for c in inspector.get_columns("fee_payments")} if "fee_payments" in inspector.get_table_names() else set()
    class_fee_columns = {c["name"] for c in inspector.get_columns("class_fees")} if "class_fees" in inspector.get_table_names() else set()
    with engine.begin() as connection:
        for name, sql_type in additions.items():
            if name not in existing: connection.execute(text("ALTER TABLE students ADD COLUMN " + name + " " + sql_type))
        if "staff_members" in inspector.get_table_names():
            if "subjects" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN subjects TEXT"))
            if "salary_amount" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN salary_amount INTEGER"))
            if "salary_frequency" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN salary_frequency VARCHAR(20) NOT NULL DEFAULT 'Monthly'"))
            if "house" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN house VARCHAR(80)"))
            if "photo_data" not in staff_columns: connection.execute(text("ALTER TABLE staff_members ADD COLUMN photo_data TEXT"))
        if "class_fees" in inspector.get_table_names():
            if "boarding_amount" not in class_fee_columns: connection.execute(text("ALTER TABLE class_fees ADD COLUMN boarding_amount INTEGER"))
            if "day_amount" not in class_fee_columns: connection.execute(text("ALTER TABLE class_fees ADD COLUMN day_amount INTEGER"))
        if "fee_payments" in inspector.get_table_names() and "receipt_number" not in payment_columns:
            connection.execute(text("ALTER TABLE fee_payments ADD COLUMN receipt_number VARCHAR(50)"))
        if "school_profile" in inspector.get_table_names():
            profile_columns = {c["name"] for c in inspector.get_columns("school_profile")}
            profile_additions = {"school_type": "VARCHAR(20) NOT NULL DEFAULT 'Secondary'", "a_level_combinations": "TEXT", "o_level_optional_subjects": "TEXT", "a_level_subsidiary_subjects": "TEXT", "house_names": "TEXT"}
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
    class_columns = {column["name"] for column in inspector.get_columns("classes")}
    if "school_tenant_id" not in class_columns:
        raise RuntimeError("Class stream migration requires the school tenant migration to run first.")
    tenant_unique_exists = (
        any(u.get("column_names") == ["school_tenant_id", "name", "section"] for u in uniques)
        or any(i.get("column_names") == ["school_tenant_id", "name", "section"] for i in unique_indexes)
    )
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
                school_tenant_id INTEGER NOT NULL DEFAULT 1,
                id INTEGER NOT NULL PRIMARY KEY,
                name VARCHAR(80) NOT NULL,
                section VARCHAR(40) NOT NULL DEFAULT 'General',
                CONSTRAINT uq_classes_tenant_name_section UNIQUE (school_tenant_id, name, section)
            )""")
            raw.execute("INSERT INTO classes_new (school_tenant_id,id,name,section) SELECT school_tenant_id,id,name,COALESCE(section,'General') FROM classes")
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
            if not tenant_unique_exists:
                connection.execute(text("ALTER TABLE classes ADD CONSTRAINT uq_classes_tenant_name_section UNIQUE (school_tenant_id, name, section)"))

upgrade_class_stream_uniqueness()

@app.get("/api/students/search", tags=["Students"])
def search_students(page: int = 1, page_size: int = 25, search: str = "", class_id: int | None = None, status: str = "active", db: Session = Depends(get_db), user=Depends(get_current_user)):
    if status not in {"active", "dismissed", "transferred", "inactive", "all"}:
        raise HTTPException(422, "Choose a valid student status.")
    if status != "active" and user.role != "admin" and "view" not in user_permissions(user).get("Students", set()):
        raise HTTPException(403, "You do not have permission to view student history.")
    page_size = min(max(page_size, 1), 100)
    query = db.query(models.Student)
    if status != "all":
        query = query.filter(models.Student.status == status)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(models.Student.admission_number.ilike(term), models.Student.first_name.ilike(term), models.Student.middle_name.ilike(term), models.Student.last_name.ilike(term)))
    if class_id is not None:
        query = query.filter(models.Student.class_id == class_id)
    total = query.count()
    rows = query.order_by(models.Student.last_name, models.Student.first_name).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size, "pages": (total + page_size - 1) // page_size}



@app.get("/api/school-community", tags=["School Community"])
def school_community(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Read-only directory of enrolled learners and active staff for authorised school members."""
    students = db.query(models.Student, models.SchoolClass).outerjoin(
        models.SchoolClass, models.SchoolClass.id == models.Student.class_id
    ).filter(models.Student.status == "active").order_by(
        models.Student.last_name, models.Student.first_name
    ).all()
    staff_rows = db.query(models.StaffMember).filter(
        models.StaffMember.status == "active"
    ).order_by(models.StaffMember.first_name, models.StaffMember.last_name).all()
    house_names = []
    profile = get_tenant_singleton(db, models.SchoolProfile)
    if profile and profile.house_names:
        house_names = [name.strip() for name in profile.house_names.splitlines() if name.strip()]
    house_names = sorted(set(house_names) | {
        row.house.strip() for row, _ in students if row.house and row.house.strip()
    } | {row.house.strip() for row in staff_rows if row.house and row.house.strip()})
    return {
        "houses": house_names,
        "students": [{
            "id": student.id,
            "name": " ".join(part for part in [student.first_name, student.middle_name, student.last_name] if part),
            "admission_number": student.admission_number,
            "class_name": (school_class.name + (" — " + school_class.section if school_class.section else "")) if school_class else "Unassigned",
            "study_mode": student.study_mode or "Day",
            "house": student.house,
            "photo_data": student.photo_data,
            "member_type": "Student",
        } for student, school_class in students],
        "staff": [{
            "id": member.id,
            "name": " ".join(part for part in [member.first_name, member.last_name] if part),
            "staff_number": member.staff_number,
            "position": member.position or member.category,
            "house": member.house,
            "photo_data": member.photo_data,
            "member_type": "Staff",
        } for member in staff_rows],
    }

@app.get("/api/dashboard/my-work", tags=["Dashboard"])
def my_dashboard_work(db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()
    staff_id = user.staff_id
    staff = db.get(models.StaffMember, staff_id) if staff_id else None
    if staff is None and user.email:
        staff = db.query(models.StaffMember).filter(func.lower(models.StaffMember.email) == user.email.lower()).first()
    permissions = user_permissions(user)
    today_lessons = []
    class_teacher_classes = []
    today_duty = None
    if staff:
        lessons = db.query(models.TimetableEntry, models.SchoolClass, models.Subject).outerjoin(
            models.SchoolClass, models.SchoolClass.id == models.TimetableEntry.class_id
        ).outerjoin(models.Subject, models.Subject.id == models.TimetableEntry.subject_id).filter(
            models.TimetableEntry.staff_id == staff.id,
            models.TimetableEntry.day_of_week == today.weekday() + 1,
        ).order_by(models.TimetableEntry.start_time).all()
        today_lessons = [{
            "class_id": cls.id if cls else None,
            "class_name": (cls.name + (" — " + cls.section if cls.section else "")) if cls else "Class",
            "subject": subject.name if subject else "Lesson",
            "start_time": entry.start_time, "end_time": entry.end_time,
        } for entry, cls, subject in lessons]
        duty = db.query(models.TeacherDuty).filter_by(staff_id=staff.id, duty_date=today).first()
        if duty:
            today_duty = {"date": duty.duty_date, "notes": duty.notes or "Assigned duty"}
    if user.role == "teacher":
        rows = db.query(models.ClassTeacherAssignment, models.SchoolClass).join(
            models.SchoolClass, models.SchoolClass.id == models.ClassTeacherAssignment.class_id
        ).filter(models.ClassTeacherAssignment.teacher_id == user.id).all()
        class_teacher_classes = [{
            "class_id": assignment.class_id,
            "class_name": cls.name + (" — " + cls.section if cls.section else ""),
        } for assignment, cls in rows]
    available_sections = sorted(
        section for section, actions in permissions.items() if "view" in actions
    )
    if user.role == "admin":
        available_sections = sorted(PERMISSION_SECTIONS)
    return {
        "staff_name": f"{staff.first_name} {staff.last_name}" if staff else user.username,
        "role_label": user.role_label or user.role.title(),
        "available_sections": available_sections,
        "today_lessons": today_lessons,
        "class_teacher_classes": class_teacher_classes,
        "today_duty": today_duty,
    }


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
def create_staff(data: StaffCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
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
    # Generate a fresh staff number and login ID; never reject a new employee
    # merely because their contact email is already used by another account.
    staff_number = ""
    username = ""
    for _ in range(8):
        candidate = "STF-" + str(date.today().year) + "-" + uuid4().hex[:8].upper()
        candidate_username = candidate.lower()
        if not db.query(models.StaffMember.id).filter_by(staff_number=candidate).first() and not db.query(models.User.id).filter_by(username=candidate_username).first():
            staff_number, username = candidate, candidate_username
            break
    if not staff_number:
        raise HTTPException(503, "A unique staff login could not be generated. Please try again.")
    item = models.StaffMember(staff_number=staff_number, phone_source="school_record", **data.model_dump())
    # Create the staff profile and login together so registration is one step.
    temporary_passcode = secrets.token_urlsafe(9)
    account_role = "teacher" if data.category == "Teaching" else "staff"
    requested_email = (data.email or "").strip().lower()
    email_in_use = bool(requested_email and db.query(models.User.id).filter_by(email=requested_email).first())
    account_email = f"{username}@accounts.schoolbridge.local" if email_in_use or not requested_email else requested_email
    if account_role == "teacher":
        default_permissions = {
            "Overview": ["view"], "My Classes": ["view"],
            "My Attendance": ["view"], "My Results": ["view", "add", "edit"],
            "Announcements": ["view"],
        }
    else:
        title = (data.position or "").strip().lower()
        if "bursar" in title or "account" in title:
            sections = ["Overview", "Fees & Finance"]
        elif "secretary" in title or "admin" in title:
            sections = ["Overview", "Students", "Staff", "Parent Access", "Announcements", "Reports"]
        elif "head" in title or title == "dos" or "director of studies" in title:
            sections = ["Overview", "Students", "Staff", "Examinations", "Attendance", "Timetable", "Leadership & Duty", "Announcements", "Reports"]
        else:
            sections = ["Overview"]
        default_permissions = {section: ["view"] for section in sections}
    item_user = models.User(
        username=username,
        email=account_email,
        hashed_password=password_hash.hash(temporary_passcode),
        role=account_role,
        role_label=(data.position or ("Teacher" if account_role == "teacher" else "Staff"))[:80],
        permissions_json=json.dumps(default_permissions),
    )
    db.add(item)
    try:
        db.flush()
        item_user.staff_id = item.id
        db.add(item_user)
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "The staff member was not saved because a unique staff number, username or login email conflicts with an existing account. The form is safe to retry; check whether this email is already assigned to another login.")
    # Keep the original staff fields at the top level for existing API clients,
    # while also returning the grouped staff/login objects used by the new UI.
    staff_data = {column.name: getattr(item, column.name) for column in item.__table__.columns}
    return {
        **staff_data,
        "staff": staff_data,
        "login": {
            "username": item_user.username,
            "email": item_user.email,
            "temporary_passcode": temporary_passcode,
            "role": item_user.role,
            "role_label": item_user.role_label,
        },
    }


@app.get("/api/staff", tags=["Staff"])
def list_staff(search: str = "", category: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db)):
    page_size = min(max(page_size, 1), 100)
    query = db.query(models.StaffMember)
    if search.strip():
        term = "%" + search.strip() + "%"
        query = query.filter(or_(models.StaffMember.staff_number.ilike(term), models.StaffMember.first_name.ilike(term), models.StaffMember.last_name.ilike(term), models.StaffMember.position.ilike(term), models.StaffMember.department.ilike(term), models.StaffMember.email.ilike(term), models.StaffMember.phone.ilike(term)))
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

@app.post("/api/sync/finance-payments", tags=["Offline Synchronisation"])
def submit_offline_finance_payment(data: OfflineFinancePaymentCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Idempotently apply an offline fee payment after current balance and scope checks."""
    device = _sync_active_device(db, user, data.device_id)
    if data.base_sequence > device.last_issued_sequence:
        raise HTTPException(409, "The finance snapshot has not been issued to this device.")
    if user.role != "admin" and "add" not in user_permissions(user).get("Fees & Finance", set()):
        raise HTTPException(403, "You do not have permission to record fee payments.")
    payload = json.dumps({"charge_id": data.charge_id, "amount": data.amount,
        "payment_date": data.payment_date.isoformat(), "method": data.method,
        "reference": data.reference}, sort_keys=True, separators=(",", ":"))
    old = db.query(models.SyncChangeProposal).filter_by(user_id=user.id, idempotency_key=data.idempotency_key).first()
    if old:
        same = (old.device_id == str(data.device_id) and old.entity_type == "FinancePayment"
                and old.entity_id == data.charge_id and old.operation == "create"
                and old.base_sequence == data.base_sequence and old.payload_json == payload)
        if not same:
            raise HTTPException(409, "Idempotency key already used for different payment content.")
        return {
            "proposal_id": old.id,
            "status": old.status,
            "duplicate": True,
            "applied": old.status == "applied",
            "payment_id": old.conflict_sequence if old.status == "applied" else None,
            "conflict_sequence": old.conflict_sequence if old.status == "conflict" else None,
        }
    charge = db.query(models.FeeCharge).filter_by(id=data.charge_id).with_for_update().first()
    if not charge:
        raise HTTPException(404, "Fee charge not found.")
    payment_ids = [row[0] for row in db.query(models.FeePayment.id).filter_by(charge_id=charge.id).all()]
    changed = db.query(models.SyncChange).filter(
        models.SyncChange.id > data.base_sequence,
        models.SyncChange.entity_type.in_(["FeeCharge", "FeePayment"]),
        models.SyncChange.entity_id.in_([charge.id] + payment_ids),
    ).order_by(models.SyncChange.id.desc()).first()
    if changed:
        proposal = models.SyncChangeProposal(user_id=user.id, device_id=device.device_id,
            idempotency_key=data.idempotency_key, entity_type="FinancePayment", entity_id=charge.id,
            operation="create", payload_json=payload, base_sequence=data.base_sequence,
            status="conflict", conflict_sequence=changed.id, resolution="system_conflict",
            resolved_at=datetime.utcnow())
        db.add(proposal)
        db.flush()
        write_audit(db, user, "offline_finance_payment_conflict", "sync_change_proposal", proposal.id,
                    f"charge={charge.id}; conflict_sequence={changed.id}")
        db.commit()
        return {"proposal_id": proposal.id, "status": "conflict", "duplicate": False,
                "applied": False, "payment_id": None, "conflict_sequence": changed.id}
    paid = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0)).filter(models.FeePayment.charge_id == charge.id).scalar() or 0
    if data.amount > charge.amount - paid:
        # Persist a terminal conflict so retries remain idempotent and the
        # device can review/discard the same proposal instead of retrying forever.
        proposal = models.SyncChangeProposal(user_id=user.id, device_id=device.device_id,
            idempotency_key=data.idempotency_key, entity_type="FinancePayment", entity_id=charge.id,
            operation="create", payload_json=payload, base_sequence=data.base_sequence,
            status="conflict", resolution="system_conflict", resolved_at=datetime.utcnow())
        db.add(proposal)
        db.flush()
        write_audit(db, user, "offline_finance_payment_conflict", "sync_change_proposal", proposal.id,
                    f"charge={charge.id}; reason=outstanding_balance_changed")
        db.commit()
        return {"proposal_id": proposal.id, "status": "conflict", "duplicate": False,
                "applied": False, "payment_id": None, "conflict_sequence": None}
    proposal = models.SyncChangeProposal(user_id=user.id, device_id=device.device_id,
        idempotency_key=data.idempotency_key, entity_type="FinancePayment", entity_id=charge.id,
        operation="create", payload_json=payload, base_sequence=data.base_sequence,
        status="applied", resolution="system_auto_apply", resolved_at=datetime.utcnow())
    db.add(proposal)
    try:
        db.flush()
        payment = models.FeePayment(charge_id=charge.id, amount=data.amount, payment_date=data.payment_date,
            method=data.method, reference=data.reference, received_by=user.username,
            receipt_number="RCPT-" + str(date.today().year) + "-" + uuid4().hex[:8].upper())
        db.add(payment)
        db.flush()
        proposal.conflict_sequence = payment.id
        write_audit(db, user, "offline_fee_payment_received", "fee_payment", payment.id,
                    f"Receipt {payment.receipt_number}; amount {payment.amount}; charge {charge.id}")
        db.commit()
        return {"proposal_id": proposal.id, "status": "applied", "duplicate": False,
                "applied": True, "payment_id": payment.id, "receipt_number": payment.receipt_number}
    except IntegrityError:
        db.rollback()
        old = db.query(models.SyncChangeProposal).filter_by(user_id=user.id, idempotency_key=data.idempotency_key).first()
        if old and old.device_id == str(data.device_id) and old.payload_json == payload:
            return {"proposal_id": old.id, "status": old.status, "duplicate": True,
                    "applied": old.status == "applied", "payment_id": old.conflict_sequence}
        raise HTTPException(409, "Offline payment key collision; retry with the same request.")


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
    amount: int | None = Field(default=None, ge=0)
    boarding_amount: int | None = Field(default=None, ge=0)
    day_amount: int | None = Field(default=None, ge=0)


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
        if not class_fee: continue
        selected_amount = class_fee.boarding_amount if student.study_mode == "Boarding" else class_fee.day_amount
        if selected_amount is None: selected_amount = class_fee.amount
        if selected_amount <= 0: continue
        existing = db.query(models.FeeCharge).filter_by(
            student_id=student.id, term=data.active_term, year=data.academic_year
        ).first()
        if existing is None:
            db.add(models.FeeCharge(
                student_id=student.id, term=data.active_term,
                year=data.academic_year, amount=selected_amount
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
    by_term = {row.term: row for row in rows}
    return {"class_id": class_id, "year": selected_year,
            "fees": [{"term": term, "amount": by_term[term].amount if term in by_term else 0,
                      "boarding_amount": (by_term[term].boarding_amount if by_term[term].boarding_amount is not None else by_term[term].amount) if term in by_term else 0,
                      "day_amount": (by_term[term].day_amount if by_term[term].day_amount is not None else by_term[term].amount) if term in by_term else 0}
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
    boarding_amount = data.boarding_amount if data.boarding_amount is not None else (data.amount or 0)
    day_amount = data.day_amount if data.day_amount is not None else (data.amount or 0)
    created = 0
    settings = get_or_create_school_settings(db)
    for grade_class in grade_classes:
        row = db.query(models.ClassFee).filter_by(
            class_id=grade_class.id, term=data.term, year=data.year
        ).first()
        if row is None:
            row = models.ClassFee(class_id=grade_class.id, amount=max(boarding_amount, day_amount), boarding_amount=boarding_amount, day_amount=day_amount, term=data.term, year=data.year)
            db.add(row)
            db.flush()
        else:
            row.boarding_amount = boarding_amount
            row.day_amount = day_amount
            row.amount = max(boarding_amount, day_amount)
        if settings.active_term == data.term and (settings.academic_year or date.today().year) == data.year:
            active_students = db.query(models.Student).filter_by(
                class_id=grade_class.id, status="active"
            ).all()
            for student in active_students:
                existing = db.query(models.FeeCharge).filter_by(
                    student_id=student.id, term=data.term, year=data.year
                ).first()
                selected_amount = boarding_amount if student.study_mode == "Boarding" else day_amount
                if existing is None and selected_amount > 0:
                    db.add(models.FeeCharge(student_id=student.id, term=data.term, year=data.year, amount=selected_amount))
                    created += 1
    db.flush()
    write_audit(db, admin, "class_fee_updated", "class_fee", class_id,
                f"Grade {selected_class.name}; {data.term} {data.year}; boarding UGX {boarding_amount}; day UGX {day_amount}")
    db.commit()
    return {"message": "Boarding and day fee structures saved for all streams. Existing charges were not changed.",
            "class_id": class_id, "term": data.term, "year": data.year,
            "amount": max(boarding_amount, day_amount), "boarding_amount": boarding_amount, "day_amount": day_amount, "streams_updated": len(grade_classes),
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


def validate_profile_photo(photo_data: str):
    import base64, binascii
    match = re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})", photo_data or "")
    if not match:
        raise HTTPException(422, "Upload a JPG, PNG or WEBP passport photo.")
    try:
        decoded = base64.b64decode(match.group(1), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "The selected photo could not be read. Please choose another image.")
    if not decoded or len(decoded) > 1_200_000:
        raise HTTPException(413, "Passport photos must be 1.2 MB or smaller.")


@app.patch("/api/students/{student_id}", tags=["Students"])
def update_student(student_id: int, data: StudentUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    changes = data.model_dump(exclude_unset=True)
    if not student.photo_data and not changes.get("photo_data"):
        raise HTTPException(422, "Upload a passport photo to complete this student profile.")
    if changes.get("photo_data") is not None:
        validate_profile_photo(changes["photo_data"])
    if "class_id" in changes and changes["class_id"] is not None and not db.get(models.SchoolClass, changes["class_id"]):
        raise HTTPException(404, "Class not found.")
    for key, value in changes.items():
        setattr(student, key, value)
    sync_legacy_guardian_contacts(db, student)
    write_audit(db, admin, "student_updated", "student", student.id, ", ".join(changes.keys()))
    db.commit()
    db.refresh(student)
    return {"message": "Student profile updated.", "student": student}


@app.get("/api/students/{student_id}/guardian-contacts", tags=["Parent Access"])
def list_student_guardian_contacts(student_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    return db.query(models.StudentGuardianContact).filter(
        models.StudentGuardianContact.student_id == student_id,
        models.StudentGuardianContact.active.is_(True),
    ).order_by(models.StudentGuardianContact.is_primary.desc(), models.StudentGuardianContact.id).all()


@app.post("/api/students/{student_id}/guardian-contacts", tags=["Parent Access"])
def add_student_guardian_contact(student_id: int, data: GuardianContactCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    contact = models.StudentGuardianContact(
        school_tenant_id=get_current_tenant_id(db),
        student_id=student.id,
        guardian_name=data.guardian_name.strip(),
        relationship=data.relationship.strip() if data.relationship and data.relationship.strip() else None,
        phone=data.phone.strip() if data.phone and data.phone.strip() else None,
        source="school_record",
        verification_status="unverified",
        is_primary=data.is_primary,
        active=True,
    )
    db.add(contact)
    db.flush()
    write_audit(db, admin, "guardian_contact_added", "student_guardian_contact", contact.id,
                f"student_id={student.id}; contact initially unverified")
    db.commit()
    db.refresh(contact)
    return contact


@app.patch("/api/guardian-contacts/{contact_id}/verification", tags=["Parent Access"])
def update_guardian_contact_verification(contact_id: int, data: GuardianContactVerificationUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    contact = db.get(models.StudentGuardianContact, contact_id)
    if not contact or not contact.active:
        raise HTTPException(404, "Guardian contact not found.")
    if data.status == "school_verified" and not (contact.phone or "").strip():
        raise HTTPException(409, "A guardian contact without a recorded phone number cannot be verified.")
    contact.verification_status = data.status
    contact.verified_at = datetime.utcnow() if data.status == "school_verified" else None
    contact.verified_by = admin.id if data.status == "school_verified" else None
    if data.status == "school_verified":
        contact.source = "admin_verified_school_record"
    write_audit(db, admin, "guardian_contact_verification_changed", "student_guardian_contact",
                contact.id, f"status={data.status}; student_id={contact.student_id}")
    db.commit()
    db.refresh(contact)
    return contact


@app.post("/api/students/{student_id}/dismiss", tags=["Students"])
def dismiss_student(student_id: int, data: StudentDismissal, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if admin.role != "admin" and "delete" not in user_permissions(admin).get("Students", set()):
        raise HTTPException(403, "Student dismissal requires delete permission.")
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    if student.status == "dismissed":
        raise HTTPException(409, "This student has already been dismissed.")
    if student.status != "active":
        raise HTTPException(409, "Only an active student can be dismissed.")
    student.status = "dismissed"
    linked_parents = db.query(models.User).join(
        models.ParentStudentLink, models.ParentStudentLink.user_id == models.User.id
    ).filter(
        models.ParentStudentLink.student_id == student.id,
        models.User.role == "parent",
        models.User.is_active.is_(True),
    ).all()
    deactivated_parent_ids = []
    for parent in linked_parents:
        other_active_children = db.query(models.Student.id).join(
            models.ParentStudentLink, models.ParentStudentLink.student_id == models.Student.id
        ).filter(
            models.ParentStudentLink.user_id == parent.id,
            models.Student.id != student.id,
            models.Student.status == "active",
        ).first()
        if not other_active_children:
            parent.is_active = False
            parent.token_version = int(parent.token_version or 0) + 1
            deactivated_parent_ids.append(parent.id)
            write_audit(db, admin, "parent_account_deactivated", "user", parent.id,
                        f"All linked students inactive after dismissal of student {student.id}.")
    write_audit(db, admin, "student_dismissed", "student", student.id,
                f"reason={data.reason.strip()}; effective_date={data.effective_date.isoformat()}; deactivated_parent_ids={deactivated_parent_ids}")
    db.commit()
    return {"message": "Student dismissed. Academic, attendance and financial history has been retained.",
            "student_id": student.id, "status": student.status, "effective_date": data.effective_date,
            "deactivated_parent_ids": deactivated_parent_ids}


@app.patch("/api/students/{student_id}/status", tags=["Students"])
def change_student_status(student_id: int, status: str, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if status not in {"active", "transferred", "inactive"}:
        raise HTTPException(422, "Use the formal dismissal workflow to dismiss a student.")
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
    house: str | None = None
    status: str | None = Field(default=None, pattern="^(active|archived|inactive)$")


class StaffPhoneVerificationUpdate(BaseModel):
    status: str = Field(pattern="^(school_verified|unverified|rejected)$")


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


class MyStaffProfileUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=150)
    photo_data: str | None = Field(default=None, max_length=1_800_000)


class MyPasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


@app.get("/api/me/staff-profile", tags=["Staff"])
def get_my_staff_profile(user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.staff_id:
        raise HTTPException(404, "This account is not linked to a staff profile.")
    staff = db.get(models.StaffMember, user.staff_id)
    if not staff:
        raise HTTPException(404, "Staff profile not found.")
    return {
        "id": staff.id, "first_name": staff.first_name, "last_name": staff.last_name,
        "staff_number": staff.staff_number, "phone": staff.phone, "email": staff.email,
        "position": staff.position, "department": staff.department, "category": staff.category,
        "photo_data": staff.photo_data,
        "username": user.username,
    }


@app.patch("/api/me/staff-profile", tags=["Staff"])
def update_my_staff_profile(data: MyStaffProfileUpdate, user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.staff_id:
        raise HTTPException(404, "This account is not linked to a staff profile.")
    staff = db.get(models.StaffMember, user.staff_id)
    if not staff:
        raise HTTPException(404, "Staff profile not found.")
    if not staff.photo_data and not data.photo_data:
        raise HTTPException(422, "Upload a passport photo to complete your staff profile.")
    email = data.email.strip().lower() if data.email and data.email.strip() else user.email
    if email:
        duplicate = db.query(models.User).filter(models.User.email == email, models.User.id != user.id).first()
        if duplicate:
            raise HTTPException(409, "That email address is already used by another account.")
        user.email = email
    if data.photo_data is not None:
        validate_profile_photo(data.photo_data)
        staff.photo_data = data.photo_data
    staff.first_name = data.first_name.strip()
    next_phone = data.phone.strip() if data.phone and data.phone.strip() else None
    if next_phone != staff.phone:
        staff.phone_source = "staff_self_updated"
        staff.phone_verification_status = "unverified"
        staff.phone_verified_at = None
        staff.phone_verified_by = None
    staff.phone = next_phone
    staff.email = email
    db.commit()
    db.refresh(staff)
    return {"message": "Profile updated. Your surname, staff number, position, department and subject assignments remain unchanged.", "profile": {
        "id": staff.id, "first_name": staff.first_name, "last_name": staff.last_name,
        "staff_number": staff.staff_number, "phone": staff.phone, "email": staff.email,
        "position": staff.position, "department": staff.department, "category": staff.category,
        "photo_data": staff.photo_data,
        "username": user.username,
    }}


@app.put("/api/me/password", tags=["Authentication"])
def update_my_password(data: MyPasswordUpdate, user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not password_hash.verify(data.current_password, user.hashed_password):
        raise HTTPException(400, "Your current password is incorrect.")
    if password_hash.verify(data.new_password, user.hashed_password):
        raise HTTPException(400, "Choose a password different from your current password.")
    user.hashed_password = password_hash.hash(data.new_password)
    user.token_version = (user.token_version or 0) + 1
    user.must_change_password = False
    user.reset_code_hash = None
    user.reset_expires_at = None
    user.reset_attempts = 0
    db.commit()
    return {"message": "Password updated successfully."}


@app.patch("/api/staff/{staff_id}", tags=["Staff"])
def update_staff(staff_id: int, data: StaffUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    staff = db.get(models.StaffMember, staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    changes = data.model_dump(exclude_unset=True)
    if "phone" in changes and changes["phone"] != staff.phone:
        staff.phone_source = "staff_record_updated"
        staff.phone_verification_status = "unverified"
        staff.phone_verified_at = None
        staff.phone_verified_by = None
    for key, value in changes.items():
        setattr(staff, key, value)
    write_audit(db, admin, "staff_updated", "staff", staff.id, ", ".join(changes.keys()))
    db.commit()
    db.refresh(staff)
    return {"message": "Staff profile updated.", "staff": staff}


@app.patch("/api/staff/{staff_id}/phone-verification", tags=["Staff"])
def update_staff_phone_verification(staff_id: int, data: StaffPhoneVerificationUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    staff = db.get(models.StaffMember, staff_id)
    if not staff:
        raise HTTPException(404, "Staff member not found.")
    if data.status == "school_verified" and not (staff.phone or "").strip():
        raise HTTPException(409, "A staff member without a recorded phone number cannot be verified.")
    staff.phone_verification_status = data.status
    staff.phone_verified_at = datetime.utcnow() if data.status == "school_verified" else None
    staff.phone_verified_by = admin.id if data.status == "school_verified" else None
    if data.status == "school_verified":
        staff.phone_source = "admin_verified_school_record"
    write_audit(db, admin, "staff_phone_verification_changed", "staff", staff.id,
                f"status={data.status}; staff_number={staff.staff_number}")
    db.commit()
    db.refresh(staff)
    return {"message": "Staff contact verification updated.", "staff": staff}


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
    class_teacher = is_assigned_class_teacher(db, teacher.id, class_id)
    if not assigned and not class_teacher:
        raise HTTPException(403, "This class is not assigned to your teaching or class-teacher responsibilities.")
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
    require_class_attendance_access(db, teacher, student.class_id, "add")
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
    school_type: str = Field(default="Secondary", pattern="^(Primary|Secondary|Combined)$")
    country: str | None = Field(default=None, max_length=80)
    school_structure: str | None = Field(default=None, pattern="^(Day|Boarding|Both)$")
    a_level_combinations: str | None = None
    o_level_optional_subjects: str | None = None
    a_level_subsidiary_subjects: str | None = None
    report_logo: str | None = Field(default=None, max_length=2_000_000)
    report_template: str | None = Field(default=None, max_length=100_000)
    house_names: str | None = Field(default=None, max_length=5000)


@app.get("/api/settings/school-profile", tags=["School Settings"])
def get_school_profile(db: Session = Depends(get_db)):
    profile = get_tenant_singleton(db, models.SchoolProfile)
    if profile is None:
        profile = models.SchoolProfile(school_tenant_id=get_current_tenant_id(db))
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@app.put("/api/settings/school-profile", tags=["School Settings"])
def save_school_profile(data: SchoolProfileUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    profile = get_tenant_singleton(db, models.SchoolProfile)
    if profile is None:
        profile = models.SchoolProfile(school_tenant_id=get_current_tenant_id(db))
        db.add(profile)
    updates = data.model_dump(exclude_unset=True)
    for optional_identity_field in ("country", "school_structure"):
        if optional_identity_field in updates and not updates[optional_identity_field]:
            updates[optional_identity_field] = None
    state = get_tenant_singleton(db, models.SchoolSetupState)
    if state and state.setup_completed_at and state.original_identity_json:
        # Protect the current registered identity, not the immutable first-install
        # snapshot. Owner-authorised corrections update the current profile while
        # preserving the original snapshot and correction history.
        identity_fields = {
            "name": profile.name,
            "school_type": profile.school_type,
            "country": profile.country,
            "school_structure": profile.school_structure,
        }
        changed_identity = [
            field for field, current_value in identity_fields.items()
            if field in updates and updates[field] != current_value
        ]
        if changed_identity:
            raise HTTPException(403, "Official school identity is protected after first-time setup. Contact the SchoolBridge owner for an authorised, audited correction.")
    for key, value in updates.items():
        setattr(profile, key, value)
    if state and state.setup_completed_at and not state.original_identity_json:
        state.original_identity_json = json.dumps({
            "school_name": profile.name, "school_type": profile.school_type,
            "country": profile.country, "school_structure": profile.school_structure,
            "installation_id": state.installation_id,
        }, sort_keys=True)
    db.flush()
    write_audit(db, admin, "school_profile_updated", "school_profile", profile.id, "School profile and report branding updated.")
    db.commit()
    db.refresh(profile)
    return {"message": "School profile saved.", "profile": profile}


def require_single_tenant_database_for_backup(db: Session):
    tenant_count = db.query(models.SchoolTenant.id).count()
    if tenant_count > 1:
        raise HTTPException(
            403,
            "Whole-database backup and restore are disabled in shared multi-school mode. "
            "Use a school-scoped backup once that feature is available.",
        )


@app.post("/api/backups/create", tags=["Backups"])
def create_database_backup(db: Session = Depends(get_db), admin=Depends(require_admin)):
    require_single_tenant_database_for_backup(db)
    import os, sqlite3, tempfile
    if engine.dialect.name != "sqlite":
        raise HTTPException(501, "Direct file backups are currently supported for the local SQLite installation.")
    db_path = engine.url.database
    if not db_path or db_path == ":memory:":
        raise HTTPException(400, "A file-based school database is required.")
    fd, backup_path = tempfile.mkstemp(prefix="schoolbridge-backup-", suffix=".sqlite3")
    os.close(fd)
    try:
        create_sqlite_backup(os.path.abspath(db_path), backup_path)
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
async def restore_database_backup(file: UploadFile = File(...), db: Session = Depends(get_db), admin=Depends(require_admin)):
    require_single_tenant_database_for_backup(db)
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


def _offline_teacher_mark_conflict(db: Session, exam_id: int, subject_id: int, entries: list, base_mark_ids: dict, base_sequence: int):
    """Detect updates, inserts and deletions against each student's mark baseline."""
    conflict = False
    conflict_sequence = None
    for entry in entries:
        student_id = int(entry["student_id"] if isinstance(entry, dict) else entry.student_id)
        baseline_id = base_mark_ids.get(str(student_id), base_mark_ids.get(student_id))
        current = db.query(models.Mark).filter_by(student_id=student_id, exam_id=exam_id, subject_id=subject_id).with_for_update().first()
        scope_change = db.query(func.max(models.SyncChange.id)).filter(
            models.SyncChange.entity_type == f"MarkScope:{exam_id}:{subject_id}",
            models.SyncChange.entity_id == student_id,
            models.SyncChange.id > base_sequence,
        ).scalar()
        if scope_change:
            conflict = True
            conflict_sequence = max(conflict_sequence or 0, scope_change)
        if baseline_id is None:
            if current is not None:
                conflict = True
                changed = db.query(func.max(models.SyncChange.id)).filter(
                    models.SyncChange.entity_type == "Mark", models.SyncChange.entity_id == current.id,
                    models.SyncChange.id > base_sequence).scalar()
                conflict_sequence = max(conflict_sequence or 0, changed or 0) or conflict_sequence
        else:
            if current is None or current.id != int(baseline_id):
                conflict = True
            changed = db.query(func.max(models.SyncChange.id)).filter(
                models.SyncChange.entity_type == "Mark", models.SyncChange.entity_id == int(baseline_id),
                models.SyncChange.id > base_sequence).scalar()
            if changed:
                conflict = True
                conflict_sequence = max(conflict_sequence or 0, changed)
    return conflict, conflict_sequence


def _offline_teacher_mark_missing_permissions(teacher, entries, base_mark_ids):
    """Require add/edit permission for the operation represented by each snapshot row."""
    permissions = user_permissions(teacher).get("My Results", set())
    missing = set()
    for entry in entries:
        student_id = int(entry["student_id"] if isinstance(entry, dict) else entry.student_id)
        baseline_id = base_mark_ids.get(str(student_id), base_mark_ids.get(student_id))
        required = "edit" if baseline_id is not None else "add"
        if required not in permissions:
            missing.add(required)
    return missing


class OfflineTeacherMarkEntry(BaseModel):
    student_id: int = Field(ge=1)
    score: float = Field(ge=0, le=100)


class OfflineTeacherMarkBatch(BaseModel):
    device_id: UUID
    idempotency_key: str = Field(min_length=16, max_length=100)
    exam_id: int = Field(ge=1)
    subject_id: int = Field(ge=1)
    base_sequence: int = Field(ge=0)
    base_mark_ids: dict[int, int | None] = Field(default_factory=dict)
    records: list[OfflineTeacherMarkEntry] = Field(min_length=1, max_length=500)


@app.post("/api/sync/teacher-mark-proposals", tags=["Offline Synchronisation"])
def submit_offline_teacher_marks(data: OfflineTeacherMarkBatch, db: Session = Depends(get_db), teacher=Depends(get_current_user)):
    """Automatically apply valid offline marks; retain conflicts without overwriting live records."""
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    device = _sync_active_device(db, teacher, data.device_id)
    if data.base_sequence > device.last_issued_sequence:
        raise HTTPException(409, "The submission baseline has not been issued to this device.")
    if len({entry.student_id for entry in data.records}) != len(data.records):
        raise HTTPException(422, "Each student may appear only once in an offline submission.")
    exam = db.get(models.Exam, data.exam_id)
    subject = db.get(models.Subject, data.subject_id)
    if not exam or not subject or exam.class_id is None:
        raise HTTPException(404, "Class examination or subject not found.")
    require_exam_open(exam)
    payload = json.dumps({
        "class_id": exam.class_id, "exam_id": exam.id, "subject_id": subject.id,
        "records": [entry.model_dump() for entry in data.records],
        "base_mark_ids": {str(key): value for key, value in data.base_mark_ids.items()},
    }, sort_keys=True, separators=(",", ":"))
    if len(payload.encode("utf-8")) > 32768:
        raise HTTPException(413, "Offline marks payload exceeds 32 KB.")
    old = db.query(models.SyncChangeProposal).filter_by(
        user_id=teacher.id, idempotency_key=data.idempotency_key
    ).first()
    if old:
        same = (old.device_id == str(data.device_id) and old.entity_type == "TeacherMarkBatch"
                and old.entity_id == exam.id and old.operation == "update"
                and old.base_sequence == data.base_sequence and old.payload_json == payload)
        if not same:
            raise HTTPException(409, "Idempotency key already used for different content.")
        return {
            "proposal_id": old.id, "status": old.status, "duplicate": True,
            "applied": old.status == "applied", "saved": len(data.records) if old.status == "applied" else 0,
        }
    assignment = db.query(models.TeacherAssignment.id).filter_by(
        teacher_id=teacher.id, class_id=exam.class_id, subject_id=subject.id
    ).first()
    if not assignment:
        raise HTTPException(403, "You are not currently assigned to this subject and class.")
    student_ids = [entry.student_id for entry in data.records]
    students = db.query(models.Student).filter(
        models.Student.id.in_(student_ids), models.Student.class_id == exam.class_id,
        models.Student.status == "active"
    ).all()
    if len(students) != len(student_ids):
        raise HTTPException(422, "Every submitted student must be active and belong to this examination's class.")
    missing_permissions = _offline_teacher_mark_missing_permissions(teacher, data.records, data.base_mark_ids)
    if missing_permissions:
        raise HTTPException(
            403,
            "Your current My Results permissions do not allow this batch: "
            + ", ".join(sorted(missing_permissions)) + " permission required.",
        )


    locked = db.query(models.Mark.id).filter(
        models.Mark.exam_id == exam.id, models.Mark.subject_id == subject.id,
        models.Mark.verified.is_(True)
    ).first()
    if locked:
        raise HTTPException(409, "These results are verified and locked. Ask an administrator to unlock them before submitting changes.")

    conflict, conflict_sequence = _offline_teacher_mark_conflict(
        db, exam.id, subject.id, data.records, data.base_mark_ids, data.base_sequence
    )
    row = models.SyncChangeProposal(
        user_id=teacher.id, device_id=device.device_id, idempotency_key=data.idempotency_key,
        entity_type="TeacherMarkBatch", entity_id=exam.id, operation="update",
        payload_json=payload, base_sequence=data.base_sequence,
        status="conflict" if conflict else "applied",
        conflict_sequence=conflict_sequence,
        resolution="system_conflict" if conflict else "system_auto_apply",
        resolved_at=datetime.utcnow(),
    )
    db.add(row)
    try:
        db.flush()
        if conflict:
            write_audit(
                db, teacher, "offline_teacher_marks_rejected", "sync_change_proposal", row.id,
                f"exam={exam.id}; class={exam.class_id}; subject={subject.id}; records={len(data.records)}; reason=baseline_conflict; conflict_sequence={conflict_sequence}",
            )
            db.commit()
            return {"proposal_id": row.id, "status": "conflict", "duplicate": False, "applied": False, "saved": 0, "conflict_sequence": conflict_sequence}

        saved = 0
        for entry in data.records:
            mark = db.query(models.Mark).filter_by(
                student_id=entry.student_id, subject_id=subject.id, exam_id=exam.id
            ).with_for_update().first()
            if mark and mark.verified:
                raise HTTPException(409, "A mark became verified during synchronisation; no submission was applied.")
            if mark:
                mark.score = float(entry.score)
                mark.verified = False
            else:
                db.add(models.Mark(
                    student_id=entry.student_id, subject_id=subject.id,
                    exam_id=exam.id, score=float(entry.score), verified=False,
                ))
            saved += 1
        write_audit(
            db, teacher, "offline_teacher_marks_auto_applied", "sync_change_proposal", row.id,
            f"exam={exam.id}; class={exam.class_id}; subject={subject.id}; records={saved}; verified=false",
        )
        db.commit()
        return {"proposal_id": row.id, "status": "applied", "duplicate": False, "applied": True, "saved": saved}
    except IntegrityError:
        db.rollback()
        old = db.query(models.SyncChangeProposal).filter_by(
            user_id=teacher.id, idempotency_key=data.idempotency_key
        ).first()
        if (old and old.payload_json == payload and old.device_id == str(data.device_id)
                and old.entity_type == "TeacherMarkBatch" and old.entity_id == exam.id
                and old.operation == "update" and old.base_sequence == data.base_sequence):
            return {
                "proposal_id": old.id, "status": old.status, "duplicate": True,
                "applied": old.status == "applied", "saved": len(data.records) if old.status == "applied" else 0,
            }
        raise HTTPException(409, "Offline submission key collision; retry using the same request.")


@app.get("/api/sync/teacher-mark-proposals/mine", tags=["Offline Synchronisation"])
def list_my_offline_teacher_mark_proposals(
    db: Session = Depends(get_db), teacher=Depends(get_current_user)
):
    if teacher.role != "teacher":
        raise HTTPException(403, "Teacher account required.")
    rows = db.query(models.SyncChangeProposal).filter_by(
        user_id=teacher.id, entity_type="TeacherMarkBatch"
    ).order_by(
        models.SyncChangeProposal.submitted_at.desc(),
        models.SyncChangeProposal.id.desc(),
    ).limit(50).all()
    proposals = []
    for row in rows:
        payload = json.loads(row.payload_json)
        exam = db.get(models.Exam, payload.get("exam_id"))
        subject = db.get(models.Subject, payload.get("subject_id"))
        proposals.append({
            "id": row.id,
            "exam_name": exam.name if exam else "Unavailable examination",
            "term": exam.term if exam else "",
            "year": exam.year if exam else None,
            "subject_name": subject.name if subject else "Unavailable subject",
            "status": row.status,
            "record_count": len(payload.get("records", [])),
            "submitted_at": row.submitted_at,
            "resolved_at": row.resolved_at,
            "resolution": row.resolution,
            "conflict_sequence": row.conflict_sequence,
        })
    return {"proposals": proposals}



@app.get("/{frontend_path:frontend}", include_in_schema=False)
def serve_schoolbridge_frontend(frontend_path: str):
    """Serve the bundled SPA for a single-origin, container-free installation."""
    static_dir = _schoolbridge_static_directory()
    candidate = (static_dir / frontend_path).resolve()
    try:
        candidate.relative_to(static_dir)
    except ValueError:
        raise HTTPException(404, "Not found.")
    if candidate.is_file():
        return FileResponse(candidate)
    index = static_dir / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(404, "Frontend bundle is not installed.")
