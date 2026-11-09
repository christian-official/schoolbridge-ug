import os
import sqlite3
from datetime import date

# Configure an isolated SQLite database before importing the application.
os.environ["SCHOOLBRIDGE_DATABASE_URL"] = "sqlite:///./schoolbridge_test.db"
os.environ["SCHOOLBRIDGE_SECRET_KEY"] = "test-only-secret-key-that-is-not-used-in-production"

from fastapi.testclient import TestClient
from types import SimpleNamespace
from sqlalchemy import func

from app.database import Base, engine, SessionLocal
from app.main import app, create_access_token, password_hash
from app import models


def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def create_admin():
    db = SessionLocal()
    try:
        admin = models.User(
            username="test-admin",
            email="test-admin@example.invalid",
            hashed_password=password_hash.hash("TestPassword123!"),
            role="admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        return SimpleNamespace(id=admin.id, role=admin.role, username=admin.username)
    finally:
        db.close()


def test_health_endpoint_is_public():
    reset_database()
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_school_records_require_authentication():
    reset_database()
    with TestClient(app) as client:
        response = client.get("/api/classes")
    assert response.status_code == 401
    assert response.json()["detail"] == "Login required."


def test_admin_can_login_and_create_class():
    reset_database()
    create_admin()

    with TestClient(app) as client:
        login = client.post(
            "/api/auth/login",
            data={"username": "test-admin", "password": "TestPassword123!"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]

        created = client.post(
            "/api/classes",
            json={"name": "Primary 1", "section": "East"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert created.status_code == 200
    assert created.json()["name"] == "Primary 1"
    assert created.json()["section"] == "East"


def test_duplicate_class_and_stream_is_rejected():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        first = client.post(
            "/api/classes",
            json={"name": "Primary 2", "section": "West"},
            headers=headers,
        )
        duplicate = client.post(
            "/api/classes",
            json={"name": "Primary 2", "section": "West"},
            headers=headers,
        )

    assert first.status_code == 200
    assert duplicate.status_code == 409



def create_teacher():
    db = SessionLocal()
    try:
        teacher = models.User(
            username="test-teacher",
            email="test-teacher@example.invalid",
            hashed_password=password_hash.hash("TeacherPassword123!"),
            role="teacher",
            is_active=True,
        )
        db.add(teacher)
        db.commit()
        db.refresh(teacher)
        return SimpleNamespace(id=teacher.id, role=teacher.role)
    finally:
        db.close()


def test_backup_download_is_restricted_to_admins():
    reset_database()
    teacher = create_teacher()
    teacher_token = create_access_token(teacher)

    with TestClient(app) as client:
        anonymous = client.post("/api/backups/create")
        teacher_response = client.post(
            "/api/backups/create",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )

    assert anonymous.status_code == 401
    assert teacher_response.status_code == 403


def test_admin_can_download_valid_sqlite_backup():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)

    with TestClient(app) as client:
        response = client.post(
            "/api/backups/create",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    assert response.content.startswith(b"SQLite format 3\x00")
    assert "attachment" in response.headers.get("content-disposition", "")


def test_restore_rejects_invalid_database_file(tmp_path):
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)
    database_path = os.path.abspath(engine.url.database)
    pending_path = database_path + ".restore_pending"
    if os.path.exists(pending_path):
        os.unlink(pending_path)

    with TestClient(app) as client:
        response = client.post(
            "/api/backups/restore",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("not-a-backup.sqlite3", b"not a SQLite database", "application/octet-stream")},
        )

    assert response.status_code == 400
    assert not os.path.exists(pending_path)


def test_admin_can_stage_valid_restore_without_immediate_replacement(tmp_path):
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)
    database_path = os.path.abspath(engine.url.database)
    pending_path = database_path + ".restore_pending"
    if os.path.exists(pending_path):
        os.unlink(pending_path)

    backup_path = tmp_path / "valid-school-backup.sqlite3"
    source = sqlite3.connect(database_path)
    destination = sqlite3.connect(str(backup_path))
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()

    # Make the uploaded backup intentionally different from the live database.
    backup_db = sqlite3.connect(str(backup_path))
    try:
        backup_db.execute(
            "INSERT INTO users (username, email, hashed_password, role, is_active) "
            "VALUES (?, ?, ?, ?, ?)",
            ("backup-only-teacher", "backup-only@example.invalid", "test-hash", "teacher", 1),
        )
        backup_db.commit()
    finally:
        # Close the WAL-backed copy before reading its main database file.
        backup_db.close()

    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/backups/restore",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": ("valid-school-backup.sqlite3", backup_path.read_bytes(), "application/octet-stream")},
            )

        assert response.status_code == 200
        assert "Restart the SchoolBridge backend" in response.json()["message"]
        assert os.path.exists(pending_path)
        # The live database remains untouched; the distinct uploaded copy is staged.
        with sqlite3.connect(database_path) as live_db:
            assert live_db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
            assert live_db.execute(
                "SELECT username FROM users"
            ).fetchone()[0] == "test-admin"
        with sqlite3.connect(pending_path) as staged_db:
            assert staged_db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
            assert staged_db.execute(
                "SELECT username FROM users WHERE username = ?",
                ("backup-only-teacher",),
            ).fetchone() is not None
    finally:
        if os.path.exists(pending_path):
            os.unlink(pending_path)



def test_teacher_cannot_access_admin_records_or_mutations():
    reset_database()
    teacher = create_teacher()
    token = create_access_token(teacher)
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        students = client.get("/api/students", headers=headers)
        finance = client.get("/api/finance/summary", headers=headers)
        create_class = client.post(
            "/api/classes",
            json={"name": "Primary 3", "section": "North"},
            headers=headers,
        )
        teacher_workspace = client.get(
            "/api/teacher/my-assignments", headers=headers
        )

    assert students.status_code == 403
    assert finance.status_code == 403
    assert create_class.status_code == 403
    assert teacher_workspace.status_code == 200


def test_admin_cannot_use_teacher_only_workspace():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)

    with TestClient(app) as client:
        response = client.get(
            "/api/teacher/my-assignments",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 403



def test_fee_payments_cannot_exceed_charge_and_balance_updates():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)
    db = SessionLocal()
    try:
        student = models.Student(
            admission_number="SB-TEST-001",
            first_name="Test",
            last_name="Learner",
        )
        db.add(student)
        db.commit()
        db.refresh(student)
        charge = models.FeeCharge(
            student_id=student.id,
            term="Term 1",
            year=2026,
            amount=100000,
        )
        db.add(charge)
        db.commit()
        db.refresh(charge)
        charge_id = charge.id
    finally:
        db.close()

    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        first = client.post(
            "/api/finance/payments",
            headers=headers,
            json={"charge_id": charge_id, "amount": 75000},
        )
        overpayment = client.post(
            "/api/finance/payments",
            headers=headers,
            json={"charge_id": charge_id, "amount": 30000},
        )
        final_payment = client.post(
            "/api/finance/payments",
            headers=headers,
            json={"charge_id": charge_id, "amount": 25000},
        )
        payment_after_settlement = client.post(
            "/api/finance/payments",
            headers=headers,
            json={"charge_id": charge_id, "amount": 1},
        )
        summary = client.get("/api/finance/summary", headers=headers)

    assert first.status_code == 200
    assert first.json()["receipt_number"].startswith("RCPT-")
    assert overpayment.status_code == 400
    assert final_payment.status_code == 200
    assert payment_after_settlement.status_code == 400
    assert summary.status_code == 200
    assert summary.json()["fees_collected"] == 100000.0
    assert summary.json()["outstanding"] == 0.0


def test_fee_payment_amount_must_be_positive():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)

    with TestClient(app) as client:
        response = client.post(
            "/api/finance/payments",
            headers={"Authorization": f"Bearer {token}"},
            json={"charge_id": 1, "amount": 0},
        )

    assert response.status_code == 422


def test_phase_one_staff_and_finance_workflow_end_to_end():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)
    headers = {"Authorization": f"Bearer {token}"}

    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="Senior 2", section="East")
        db.add(school_class)
        db.flush()
        student = models.Student(
            admission_number="SB-FIN-001",
            first_name="Amina",
            middle_name="N.",
            last_name="Learner",
            class_id=school_class.id,
            status="active",
        )
        db.add(student)
        db.commit()
        class_id = school_class.id
        student_id = student.id
    finally:
        db.close()

    with TestClient(app) as client:
        # Staff registration, listing and salary history.
        created_staff = client.post(
            "/api/staff",
            headers=headers,
            json={
                "first_name": "Alex",
                "last_name": "Teacher",
                "category": "Non-teaching",
                "position": "Bursar",
                "department": "Finance",
                "salary_amount": 500000,
                "salary_frequency": "Monthly",
            },
        )
        assert created_staff.status_code == 200, created_staff.text
        staff_id = created_staff.json()["id"]

        staff_page = client.get("/api/staff?page=1&page_size=100", headers=headers)
        assert staff_page.status_code == 200, staff_page.text
        assert any(item["id"] == staff_id for item in staff_page.json()["items"])

        salary = client.post(
            "/api/finance/salary-payments",
            headers=headers,
            json={"staff_id": staff_id, "amount": 450000, "period": "November 2026"},
        )
        assert salary.status_code == 200, salary.text

        # Configure the active term fee and confirm it creates student charges.
        academic = client.put(
            "/api/settings/academic",
            headers=headers,
            json={"academic_year": 2026, "active_term": "Term 1"},
        )
        assert academic.status_code == 200, academic.text

        class_fee = client.put(
            f"/api/classes/{class_id}/fees",
            headers=headers,
            json={"term": "Term 1", "year": 2026, "amount": 800000},
        )
        assert class_fee.status_code == 200, class_fee.text
        assert class_fee.json()["charges_created"] == 1

        matches = client.get(
            "/api/students/search?search=SB-FIN-001&page=1&page_size=30",
            headers=headers,
        )
        assert matches.status_code == 200, matches.text
        assert matches.json()["total"] == 1
        assert matches.json()["items"][0]["id"] == student_id

        charges = client.get(
            "/api/finance/charges?search=SB-FIN-001",
            headers=headers,
        )
        assert charges.status_code == 200, charges.text
        charge = charges.json()[0]
        assert charge["balance"] == 800000

        payment = client.post(
            "/api/finance/payments",
            headers=headers,
            json={"charge_id": charge["id"], "amount": 300000, "method": "Mobile Money"},
        )
        assert payment.status_code == 200, payment.text
        assert payment.json()["receipt_number"].startswith("RCPT-")

        expense = client.post(
            "/api/finance/other-expenses",
            headers=headers,
            json={"description": "Classroom stationery", "category": "Supplies", "amount": 50000},
        )
        assert expense.status_code == 200, expense.text

        balances = client.get(
            "/api/finance/charges?class_id=" + str(class_id) + "&outstanding_only=true",
            headers=headers,
        )
        assert balances.status_code == 200, balances.text
        assert len(balances.json()) == 1
        assert balances.json()[0]["balance"] == 500000

        summary = client.get("/api/finance/summary", headers=headers)
        assert summary.status_code == 200, summary.text
        totals = summary.json()
        assert totals["fees_expected"] == 800000
        assert totals["fees_collected"] == 300000
        assert totals["outstanding"] == 500000
        assert totals["salary_expenses"] == 450000
        assert totals["other_expenses"] == 50000
        assert totals["net_cash_position"] == -200000

        archived = client.post(f"/api/staff/{staff_id}/archive", headers=headers)
        assert archived.status_code == 200, archived.text


def test_class_scoped_exams_and_mark_correction():
    reset_database()
    admin = create_admin()
    token = create_access_token(admin)
    headers = {"Authorization": f"Bearer {token}"}

    db = SessionLocal()
    try:
        class_one = models.SchoolClass(name="Senior 3", section="East")
        class_two = models.SchoolClass(name="Senior 3", section="West")
        subject = models.Subject(name="Mathematics", code="MATH")
        db.add_all([class_one, class_two, subject])
        db.flush()
        student_one = models.Student(
            admission_number="SB-EXAM-001", first_name="Sarah",
            last_name="Student", class_id=class_one.id,
        )
        student_two = models.Student(
            admission_number="SB-EXAM-002", first_name="David",
            last_name="Student", class_id=class_two.id,
        )
        db.add_all([student_one, student_two])
        db.commit()
        class_one_id, class_two_id = class_one.id, class_two.id
        subject_id = subject.id
        student_one_id, student_two_id = student_one.id, student_two.id
    finally:
        db.close()

    with TestClient(app) as client:
        payload = {
            "name": "Mid-Term Assessment", "term": "Term 1",
            "year": 2026, "class_id": class_one_id,
        }
        created = client.post("/api/exams", headers=headers, json=payload)
        assert created.status_code == 200, created.text
        exam_id = created.json()["id"]

        duplicate = client.post("/api/exams", headers=headers, json=payload)
        assert duplicate.status_code == 409

        wrong_class_mark = client.post(
            "/api/marks", headers=headers,
            json={"student_id": student_two_id, "subject_id": subject_id, "exam_id": exam_id, "score": 75},
        )
        assert wrong_class_mark.status_code == 422

        saved = client.post(
            "/api/marks", headers=headers,
            json={"student_id": student_one_id, "subject_id": subject_id, "exam_id": exam_id, "score": 68},
        )
        assert saved.status_code == 200, saved.text
        mark_id = saved.json()["id"]

        duplicate_mark = client.post(
            "/api/marks", headers=headers,
            json={"student_id": student_one_id, "subject_id": subject_id, "exam_id": exam_id, "score": 70},
        )
        assert duplicate_mark.status_code == 409

        corrected = client.patch(
            f"/api/marks/{mark_id}", headers=headers, json={"score": 91.5},
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["score"] == 91.5

        exam_marks = client.get(f"/api/marks?exam_id={exam_id}", headers=headers)
        assert exam_marks.status_code == 200
        assert len(exam_marks.json()) == 1
        assert exam_marks.json()[0]["score"] == 91.5

        class_exams = client.get(
            f"/api/exams?class_id={class_one_id}&year=2026", headers=headers,
        )
        assert class_exams.status_code == 200
        assert [row["id"] for row in class_exams.json()] == [exam_id]
        other_class_exams = client.get(
            f"/api/exams?class_id={class_two_id}", headers=headers,
        )
        assert other_class_exams.status_code == 200
        assert other_class_exams.json() == []


def test_teacher_exam_access_is_limited_to_assigned_class_and_subject():
    reset_database()
    admin = create_admin()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher = create_teacher()
    teacher_headers = {"Authorization": f"Bearer " + create_access_token(teacher)}

    db = SessionLocal()
    try:
        assigned_class = models.SchoolClass(name="Senior 4", section="North")
        other_class = models.SchoolClass(name="Senior 4", section="South")
        math = models.Subject(name="Mathematics")
        biology = models.Subject(name="Biology")
        db.add_all([assigned_class, other_class, math, biology])
        db.flush()
        student = models.Student(
            admission_number="SB-TEACH-001", first_name="Joan",
            last_name="Learner", class_id=assigned_class.id,
        )
        db.add(student)
        db.flush()
        exam = models.Exam(
            name="End of Term", term="Term 2", year=2026,
            class_id=assigned_class.id,
        )
        db.add(exam)
        assignment = models.TeacherAssignment(
            teacher_id=teacher.id, class_id=assigned_class.id, subject_id=math.id,
        )
        db.add(assignment)
        db.commit()
        exam_id, student_id = exam.id, student.id
        math_id, biology_id = math.id, biology.id
        other_class_id = other_class.id
    finally:
        db.close()

    with TestClient(app) as client:
        teacher_exams = client.get("/api/teacher/exams", headers=teacher_headers)
        assert teacher_exams.status_code == 200
        assert [row["id"] for row in teacher_exams.json()] == [exam_id]

        allowed = client.put(
            "/api/teacher/marks", headers=teacher_headers,
            json={"student_id": student_id, "subject_id": math_id, "exam_id": exam_id, "score": 84},
        )
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["score"] == 84

        forbidden_subject = client.put(
            "/api/teacher/marks", headers=teacher_headers,
            json={"student_id": student_id, "subject_id": biology_id, "exam_id": exam_id, "score": 72},
        )
        assert forbidden_subject.status_code == 403

        teacher_rows = client.get(
            f"/api/teacher/marks?exam_id={exam_id}", headers=teacher_headers,
        )
        assert teacher_rows.status_code == 200
        assert len(teacher_rows.json()) == 1
        assert teacher_rows.json()[0]["subject_id"] == math_id

        other_class_exams = client.get(
            f"/api/exams?class_id={other_class_id}", headers=admin_headers,
        )
        assert other_class_exams.status_code == 200
        assert other_class_exams.json() == []


def test_grading_scale_requires_complete_non_overlapping_bands():
    reset_database()
    admin = create_admin()
    headers = {"Authorization": f"Bearer {create_access_token(admin)}"}

    with TestClient(app) as client:
        gap = client.put(
            "/api/grading-scale", headers=headers,
            json={"bands": [
                {"grade": "U", "min_score": 0, "max_score": 39, "remark": "Ungraded"},
                {"grade": "C", "min_score": 40, "max_score": 69, "remark": "Credit"},
                {"grade": "A", "min_score": 70, "max_score": 100, "remark": "Excellent"},
            ]},
        )
        assert gap.status_code == 422

        overlap = client.put(
            "/api/grading-scale", headers=headers,
            json={"bands": [
                {"grade": "U", "min_score": 0, "max_score": 50, "remark": "Ungraded"},
                {"grade": "C", "min_score": 49, "max_score": 70, "remark": "Credit"},
                {"grade": "A", "min_score": 70, "max_score": 100, "remark": "Excellent"},
            ]},
        )
        assert overlap.status_code == 422

        saved = client.put(
            "/api/grading-scale", headers=headers,
            json={"bands": [
                {"grade": "U", "min_score": 0, "max_score": 40, "remark": "Ungraded"},
                {"grade": "C", "min_score": 40, "max_score": 70, "remark": "Credit"},
                {"grade": "A", "min_score": 70, "max_score": 100, "remark": "Excellent"},
            ]},
        )
        assert saved.status_code == 200, saved.text
        assert [row["grade"] for row in saved.json()] == ["U", "C", "A"]

        fetched = client.get("/api/grading-scale", headers=headers)
        assert fetched.status_code == 200
        assert fetched.json() == saved.json()



def test_verified_marks_are_locked_for_teachers_until_admin_unlocks():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}

    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="Senior 5", section="Arts")
        subject = models.Subject(name="History")
        db.add_all([school_class, subject])
        db.flush()
        student = models.Student(
            admission_number="SB-VERIFY-001", first_name="Martha",
            last_name="Learner", class_id=school_class.id,
        )
        exam = models.Exam(
            name="Term Assessment", term="Term 1", year=2026,
            class_id=school_class.id,
        )
        db.add_all([student, exam])
        db.flush()
        db.add(models.TeacherAssignment(
            teacher_id=teacher.id, class_id=school_class.id, subject_id=subject.id,
        ))
        db.commit()
        student_id, subject_id, exam_id = student.id, subject.id, exam.id
    finally:
        db.close()

    with TestClient(app) as client:
        saved = client.put(
            "/api/teacher/marks", headers=teacher_headers,
            json={"student_id": student_id, "subject_id": subject_id, "exam_id": exam_id, "score": 76},
        )
        assert saved.status_code == 200, saved.text
        mark_id = saved.json()["id"]
        verified = client.patch(
            f"/api/marks/{mark_id}/verification?verified=true",
            headers=admin_headers,
        )
        assert verified.status_code == 200, verified.text
        assert verified.json()["verified"] is True

        locked_edit = client.put(
            "/api/teacher/marks", headers=teacher_headers,
            json={"student_id": student_id, "subject_id": subject_id, "exam_id": exam_id, "score": 88},
        )
        assert locked_edit.status_code == 409

        unlocked = client.patch(
            f"/api/marks/{mark_id}/verification?verified=false",
            headers=admin_headers,
        )
        assert unlocked.status_code == 200
        assert unlocked.json()["verified"] is False

        corrected = client.put(
            "/api/teacher/marks", headers=teacher_headers,
            json={"student_id": student_id, "subject_id": subject_id, "exam_id": exam_id, "score": 88},
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["score"] == 88
        assert corrected.json()["verified"] is False



def test_staff_registration_handles_contact_email_already_used_by_another_login():
    reset_database()
    admin = create_admin()
    headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    payload = {
        "category": "Non-teaching",
        "position": "Secretary",
        "department": "Administration",
        "email": "shared-staff@example.com",
    }
    with TestClient(app) as client:
        first = client.post("/api/staff", headers=headers, json={
            **payload, "first_name": "Alex", "last_name": "One",
        })
        second = client.post("/api/staff", headers=headers, json={
            **payload, "first_name": "Sam", "last_name": "Two",
        })
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["login"]["email"] == "shared-staff@example.com"
        assert second.json()["login"]["email"].endswith("@accounts.schoolbridge.local")
        assert second.json()["email"] == "shared-staff@example.com"

        searched = client.get("/api/staff?search=Administration&page_size=100", headers=headers)
        assert searched.status_code == 200
        assert searched.json()["total"] == 2


def test_admin_can_verify_all_scores_for_one_subject_in_one_action():
    reset_database()
    admin = create_admin()
    headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="Senior 2", section="East")
        biology = models.Subject(name="Biology")
        chemistry = models.Subject(name="Chemistry")
        db.add_all([school_class, biology, chemistry])
        db.flush()
        exam = models.Exam(name="Term 1 Assessment", term="Term 1", year=2026, class_id=school_class.id)
        students = [
            models.Student(admission_number="SB-BATCH-001", first_name="A", last_name="One", class_id=school_class.id),
            models.Student(admission_number="SB-BATCH-002", first_name="B", last_name="Two", class_id=school_class.id),
        ]
        db.add_all([exam, *students])
        db.flush()
        db.add_all([
            models.Mark(student_id=students[0].id, subject_id=biology.id, exam_id=exam.id, score=70),
            models.Mark(student_id=students[1].id, subject_id=biology.id, exam_id=exam.id, score=80),
            models.Mark(student_id=students[0].id, subject_id=chemistry.id, exam_id=exam.id, score=60),
        ])
        db.commit()
        exam_id, biology_id, chemistry_id = exam.id, biology.id, chemistry.id
    finally:
        db.close()

    with TestClient(app) as client:
        verified = client.patch(
            f"/api/subjects/{biology_id}/marks/verification?exam_id={exam_id}&verified=true",
            headers=headers,
        )
        assert verified.status_code == 200, verified.text
        assert verified.json()["records"] == 2
        assert verified.json()["changed"] == 2
        marks = client.get(f"/api/marks?exam_id={exam_id}", headers=headers).json()
        biology_marks = [row for row in marks if row["subject_id"] == biology_id]
        chemistry_marks = [row for row in marks if row["subject_id"] == chemistry_id]
        assert all(row["verified"] for row in biology_marks)
        assert not any(row["verified"] for row in chemistry_marks)



def test_parent_portal_only_exposes_linked_child_records_and_audience_announcements():
    reset_database()
    admin = create_admin()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher = create_teacher()
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}

    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="Primary 4", section="Blue")
        subject = models.Subject(name="English")
        db.add_all([school_class, subject])
        db.flush()
        child = models.Student(admission_number="SB-PARENT-001", first_name="Amina", last_name="Learner", class_id=school_class.id)
        unrelated = models.Student(admission_number="SB-PARENT-002", first_name="Brian", last_name="Learner", class_id=school_class.id)
        db.add_all([child, unrelated])
        db.flush()
        charge = models.FeeCharge(student_id=child.id, term="Term 1", year=2026, amount=1000)
        exam = models.Exam(name="Mid-Term", term="Term 1", year=2026, class_id=school_class.id)
        db.add_all([charge, exam])
        db.flush()
        db.add(models.FeePayment(charge_id=charge.id, amount=300, payment_date=date(2026, 2, 10)))
        db.add(models.Mark(student_id=child.id, subject_id=subject.id, exam_id=exam.id, score=82, verified=True))
        db.add(models.Attendance(student_id=child.id, attendance_date=date(2026, 2, 11), status="Present"))
        db.commit()
        child_id, unrelated_id = child.id, unrelated.id
    finally:
        db.close()

    with TestClient(app) as client:
        created = client.post("/api/parent-accounts", headers=admin_headers, json={
            "username": "amina-parent", "email": "parent@example.invalid",
            "student_ids": [child_id],
        })
        assert created.status_code == 200, created.text
        temporary_password = created.json()["temporary_password"]
        assert temporary_password
        parent_login = client.post("/api/auth/login", data={
            "username": "amina-parent", "password": temporary_password,
        })
        assert parent_login.status_code == 200
        parent_headers = {"Authorization": f"Bearer {parent_login.json()['access_token']}"}

        children = client.get("/api/parent/children", headers=parent_headers)
        assert children.status_code == 200
        assert [row["id"] for row in children.json()] == [child_id]
        assert children.json()[0]["balance"] == 700

        results = client.get(f"/api/parent/children/{child_id}/results", headers=parent_headers)
        assert results.status_code == 200, results.text
        assert len(results.json()) == 1
        assert results.json()[0]["score"] == 82

        attendance = client.get(f"/api/parent/children/{child_id}/attendance", headers=parent_headers)
        assert attendance.status_code == 200
        assert attendance.json()[0]["status"] == "Present"

        hidden_child = client.get(f"/api/parent/children/{unrelated_id}/fees", headers=parent_headers)
        assert hidden_child.status_code == 404
        parent_forbidden = client.get("/api/parent/children", headers=teacher_headers)
        assert parent_forbidden.status_code == 403

        for audience, title in [("Parents", "Parent Update"), ("Teachers", "Teacher Update"), ("All", "Whole School Update")]:
            published = client.post("/api/announcements", headers=admin_headers, json={
                "title": title, "message": "Important school information.", "audience": audience, "published": True,
            })
            assert published.status_code == 200, published.text

        parent_announcements = client.get("/api/announcements", headers=parent_headers)
        teacher_announcements = client.get("/api/announcements", headers=teacher_headers)
        assert {row["title"] for row in parent_announcements.json()} == {"Parent Update", "Whole School Update"}
        assert {row["title"] for row in teacher_announcements.json()} == {"Teacher Update", "Whole School Update"}


def test_parent_liaison_is_staff_initiated_and_student_linked():
    reset_database()
    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="S2", section="A")
        db.add(school_class)
        db.flush()
        student = models.Student(
            admission_number="PL-001", first_name="Amina", last_name="Sample",
            class_id=school_class.id, status="active",
        )
        teacher = models.User(
            username="liaison-teacher", email="liaison-teacher@example.invalid",
            hashed_password=password_hash.hash("TeacherPassword123!"),
            role="teacher", is_active=True,
        )
        parent = models.User(
            username="liaison-parent", email="liaison-parent@example.invalid",
            hashed_password=password_hash.hash("ParentPassword123!"),
            role="parent", is_active=True,
        )
        unrelated_parent = models.User(
            username="other-parent", email="other-parent@example.invalid",
            hashed_password=password_hash.hash("ParentPassword123!"),
            role="parent", is_active=True,
        )
        db.add_all([student, teacher, parent, unrelated_parent])
        db.flush()
        db.add(models.ParentStudentLink(user_id=parent.id, student_id=student.id))
        db.add(models.ClassTeacherAssignment(teacher_id=teacher.id, class_id=school_class.id))
        db.commit()
        student_id, teacher_id, parent_id, unrelated_parent_id = student.id, teacher.id, parent.id, unrelated_parent.id
    finally:
        db.close()

    teacher_token = create_access_token(SimpleNamespace(id=teacher_id, role="teacher"))
    parent_token = create_access_token(SimpleNamespace(id=parent_id, role="parent"))
    unrelated_token = create_access_token(SimpleNamespace(id=unrelated_parent_id, role="parent"))
    teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
    parent_headers = {"Authorization": f"Bearer {parent_token}"}
    unrelated_headers = {"Authorization": f"Bearer {unrelated_token}"}

    with TestClient(app) as client:
        recipients = client.get("/api/parent-liaison/recipients", headers=teacher_headers)
        assert recipients.status_code == 200
        assert [row["student_id"] for row in recipients.json()] == [student_id]
        assert recipients.json()[0]["parents"][0]["id"] == parent_id

        created = client.post(
            "/api/parent-liaison/threads",
            headers=teacher_headers,
            json={
                "student_id": student_id,
                "parent_user_id": parent_id,
                "subject": "Attendance follow-up",
                "category": "Attendance",
                "message": "Please contact the school office about the recent absence.",
            },
        )
        assert created.status_code == 200
        thread_id = created.json()["id"]

        parent_threads = client.get("/api/parent-liaison/threads", headers=parent_headers)
        assert parent_threads.status_code == 200
        assert len(parent_threads.json()) == 1
        assert parent_threads.json()[0]["id"] == thread_id

        parent_cannot_start = client.post(
            "/api/parent-liaison/threads",
            headers=parent_headers,
            json={
                "student_id": student_id, "parent_user_id": parent_id,
                "subject": "Unrestricted message", "category": "General enquiry",
                "message": "This should not be allowed.",
            },
        )
        assert parent_cannot_start.status_code == 403

        # Closing before the parent replies preserves history and blocks replies.
        closed = client.patch(
            f"/api/parent-liaison/threads/{thread_id}/status?status=Closed",
            headers=teacher_headers,
        )
        assert closed.status_code == 200
        assert closed.json()["status"] == "Closed"
        closed_detail = client.get(f"/api/parent-liaison/threads/{thread_id}", headers=parent_headers)
        assert closed_detail.status_code == 200
        assert closed_detail.json()["status"] == "Closed"
        assert len(closed_detail.json()["messages"]) == 1
        blocked_reply = client.post(
            f"/api/parent-liaison/threads/{thread_id}/messages",
            headers=parent_headers,
            json={"message": "A late response while closed."},
        )
        assert blocked_reply.status_code == 409

        reopened = client.patch(
            f"/api/parent-liaison/threads/{thread_id}/status?status=Open",
            headers=teacher_headers,
        )
        assert reopened.status_code == 200
        assert reopened.json()["status"] == "Open"
        reply = client.post(
            f"/api/parent-liaison/threads/{thread_id}/messages",
            headers=parent_headers,
            json={"message": "Thank you. I will follow up with the office."},
        )
        assert reply.status_code == 200

        unrelated_access = client.get(
            f"/api/parent-liaison/threads/{thread_id}", headers=unrelated_headers
        )
        assert unrelated_access.status_code == 404


def test_sync_device_registration_is_authenticated_user_scoped_and_revocable():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}
    device_id = "00000000-0000-4000-8000-000000000001"

    with TestClient(app) as client:
        anonymous = client.post("/api/sync/devices", json={
            "device_id": device_id, "device_name": "Office laptop",
        })
        assert anonymous.status_code == 401

        registered = client.post(
            "/api/sync/devices", headers=admin_headers,
            json={"device_id": device_id, "device_name": "Office laptop"},
        )
        assert registered.status_code == 200, registered.text
        assert registered.json()["active"] is True

        updated = client.post(
            "/api/sync/devices", headers=admin_headers,
            json={"device_id": device_id, "device_name": "Updated office laptop"},
        )
        assert updated.status_code == 200
        assert updated.json()["device_name"] == "Updated office laptop"

        admin_devices = client.get("/api/sync/devices", headers=admin_headers)
        assert admin_devices.status_code == 200
        assert len(admin_devices.json()["devices"]) == 1
        assert admin_devices.json()["devices"][0]["device_id"] == device_id

        teacher_devices = client.get("/api/sync/devices", headers=teacher_headers)
        assert teacher_devices.status_code == 200
        assert teacher_devices.json()["devices"] == []

        teacher_registered = client.post(
            "/api/sync/devices", headers=teacher_headers,
            json={
                "device_id": "00000000-0000-4000-8000-000000000002",
                "device_name": "Teacher phone",
            },
        )
        assert teacher_registered.status_code == 200, teacher_registered.text
        teacher_devices_after = client.get("/api/sync/devices", headers=teacher_headers)
        assert len(teacher_devices_after.json()["devices"]) == 1
        assert teacher_devices_after.json()["devices"][0]["device_name"] == "Teacher phone"

        other_user_revoke = client.delete(
            f"/api/sync/devices/{device_id}", headers=teacher_headers,
        )
        assert other_user_revoke.status_code == 404

        revoked = client.delete(
            f"/api/sync/devices/{device_id}", headers=admin_headers,
        )
        assert revoked.status_code == 200

        listed_after_revoke = client.get("/api/sync/devices", headers=admin_headers)
        assert listed_after_revoke.json()["devices"][0]["active"] is False
        assert listed_after_revoke.json()["devices"][0]["revoked_at"] is not None

        re_register = client.post(
            "/api/sync/devices", headers=admin_headers,
            json={"device_id": device_id, "device_name": "Office laptop"},
        )
        assert re_register.status_code == 409


def test_sync_device_registration_validates_device_identity():
    reset_database()
    admin = create_admin()
    headers = {"Authorization": f"Bearer {create_access_token(admin)}"}

    with TestClient(app) as client:
        invalid = client.post(
            "/api/sync/devices", headers=headers,
            json={"device_id": "not-a-uuid", "device_name": "Laptop"},
        )
        assert invalid.status_code == 422

        blank_name = client.post(
            "/api/sync/devices", headers=headers,
            json={"device_id": "00000000-0000-4000-8000-000000000002", "device_name": "   "},
        )
        assert blank_name.status_code == 422



def test_sync_change_feed_tracks_ordered_mutations_and_deletions():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}
    device_id = "00000000-0000-4000-8000-000000000101"

    with TestClient(app) as client:
        registered = client.post(
            "/api/sync/devices", headers=admin_headers,
            json={"device_id": device_id, "device_name": "Sync test device"},
        )
        assert registered.status_code == 200

        db = SessionLocal()
        try:
            student = models.Student(
                admission_number="SYNC-001", first_name="Amina", last_name="Sample",
            )
            db.add(student)
            db.commit()
            student_id = student.id
            student.last_name = "Updated"
            db.commit()
            db.delete(student)
            db.commit()
        finally:
            db.close()

        feed_url = f"/api/sync/changes?device_id={device_id}&cursor=0&limit=2"
        first_page = client.get(feed_url, headers=admin_headers)
        assert first_page.status_code == 200, first_page.text
        assert len(first_page.json()["changes"]) == 2
        assert first_page.json()["has_more"] is True
        sequences = [row["sequence"] for row in first_page.json()["changes"]]
        assert sequences == sorted(sequences)

        second_page = client.get(
            f"/api/sync/changes?device_id={device_id}&cursor={first_page.json()['next_cursor']}&limit=10",
            headers=admin_headers,
        )
        assert second_page.status_code == 200
        all_changes = first_page.json()["changes"] + second_page.json()["changes"]
        student_changes = [row for row in all_changes if row["entity_type"] == "Student" and row["entity_id"] == student_id]
        assert [row["operation"] for row in student_changes] == ["insert", "update", "delete"]

        forbidden = client.get(
            f"/api/sync/changes?device_id={device_id}", headers=teacher_headers,
        )
        assert forbidden.status_code == 403

        revoked = client.delete(f"/api/sync/devices/{device_id}", headers=admin_headers)
        assert revoked.status_code == 200
        revoked_feed = client.get(feed_url, headers=admin_headers)
        assert revoked_feed.status_code == 403


def test_sync_change_feed_rejects_invalid_cursor_and_limit():
    reset_database()
    admin = create_admin()
    headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    device_id = "00000000-0000-4000-8000-000000000102"

    with TestClient(app) as client:
        client.post("/api/sync/devices", headers=headers, json={
            "device_id": device_id, "device_name": "Validation device",
        })
        negative_cursor = client.get(
            f"/api/sync/changes?device_id={device_id}&cursor=-1", headers=headers,
        )
        assert negative_cursor.status_code == 422
        excessive_limit = client.get(
            f"/api/sync/changes?device_id={device_id}&limit=501", headers=headers,
        )
        assert excessive_limit.status_code == 422
        skipped_cursor = client.get(
            f"/api/sync/changes?device_id={device_id}&cursor=1", headers=headers,
        )
        assert skipped_cursor.status_code == 409



def test_sync_device_checkpoint_is_monotonic_owned_and_bounded():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}
    device_id = "00000000-0000-4000-8000-000000000201"

    with TestClient(app) as client:
        registered = client.post("/api/sync/devices", headers=admin_headers, json={
            "device_id": device_id, "device_name": "Checkpoint device",
        })
        assert registered.status_code == 200
        empty_checkpoint = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence=0",
            headers=admin_headers,
        )
        assert empty_checkpoint.status_code == 200
        assert empty_checkpoint.json()["last_sync_sequence"] == 0

        db = SessionLocal()
        try:
            db.add(models.Student(admission_number="CHECK-001", first_name="Amina", last_name="Test"))
            db.commit()
            latest = db.query(func.max(models.SyncChange.id)).scalar()
        finally:
            db.close()

        # A globally valid sequence is not sufficient: this device must first
        # receive it from its own change-feed request.
        undelivered = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence={latest}",
            headers=admin_headers,
        )
        assert undelivered.status_code == 409

        feed = client.get(
            f"/api/sync/changes?device_id={device_id}&cursor=0&limit=500",
            headers=admin_headers,
        )
        assert feed.status_code == 200
        assert feed.json()["changes"][-1]["sequence"] == latest

        saved = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence={latest}",
            headers=admin_headers,
        )
        assert saved.status_code == 200
        assert saved.json()["last_sync_sequence"] == latest

        backwards = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence=0",
            headers=admin_headers,
        )
        assert backwards.status_code == 409

        future = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence={latest + 1}",
            headers=admin_headers,
        )
        assert future.status_code == 409

        other_user = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence={latest}",
            headers=teacher_headers,
        )
        assert other_user.status_code == 403

        listed = client.get("/api/sync/devices", headers=admin_headers)
        device = listed.json()["devices"][0]
        assert device["last_sync_sequence"] == latest
        assert device["last_issued_sequence"] == latest

        client.delete(f"/api/sync/devices/{device_id}", headers=admin_headers)
        revoked = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence={latest}",
            headers=admin_headers,
        )
        assert revoked.status_code == 403


def test_sync_device_checkpoint_rejects_negative_sequence():
    reset_database()
    admin = create_admin()
    headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    device_id = "00000000-0000-4000-8000-000000000202"

    with TestClient(app) as client:
        client.post("/api/sync/devices", headers=headers, json={
            "device_id": device_id, "device_name": "Negative checkpoint test",
        })
        response = client.post(
            f"/api/sync/devices/{device_id}/checkpoint?sequence=-1",
            headers=headers,
        )
        assert response.status_code == 422


def test_sync_student_snapshot_is_scoped_to_authorised_records():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="S1", section="A")
        other_class = models.SchoolClass(name="S2", section="B")
        db.add_all([school_class, other_class])
        db.flush()
        assigned = models.Student(
            admission_number="SNAP-001", first_name="Amina", last_name="Assigned",
            class_id=school_class.id, guardian_phone="0700000001",
        )
        unrelated = models.Student(
            admission_number="SNAP-002", first_name="Brian", last_name="Other",
            class_id=other_class.id,
        )
        parent = models.User(
            username="snapshot-parent", email="snapshot-parent@example.invalid",
            hashed_password=password_hash.hash("ParentPassword123!"),
            role="parent", is_active=True,
        )
        db.add_all([assigned, unrelated, parent])
        db.flush()
        db.add_all([
            models.ClassTeacherAssignment(teacher_id=teacher.id, class_id=school_class.id),
            models.ParentStudentLink(user_id=parent.id, student_id=assigned.id),
        ])
        db.commit()
        parent_id = parent.id
        assigned_id, unrelated_id = assigned.id, unrelated.id
        school_class_id, other_class_id = school_class.id, other_class.id
    finally:
        db.close()

    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}
    parent_headers = {"Authorization": f"Bearer {create_access_token(SimpleNamespace(id=parent_id, role='parent'))}"}
    devices = {
        "admin": ("00000000-0000-4000-8000-000000000301", admin_headers),
        "teacher": ("00000000-0000-4000-8000-000000000302", teacher_headers),
        "parent": ("00000000-0000-4000-8000-000000000303", parent_headers),
    }
    with TestClient(app) as client:
        for device_id, headers in devices.values():
            registered = client.post(
                "/api/sync/devices", headers=headers,
                json={"device_id": device_id, "device_name": "Snapshot test"},
            )
            assert registered.status_code == 200

        def snapshot(device, headers):
            return client.get(
                f"/api/sync/students?device_id={device}&limit=200",
                headers=headers,
            )

        admin_response = snapshot(*devices["admin"])
        teacher_response = snapshot(*devices["teacher"])
        parent_response = snapshot(*devices["parent"])
        assert admin_response.status_code == 200
        assert {row["id"] for row in admin_response.json()["students"]} == {assigned_id, unrelated_id}
        assert teacher_response.status_code == 200
        assert [row["id"] for row in teacher_response.json()["students"]] == [assigned_id]
        assert teacher_response.json()["scope"] == "assigned_classes"
        assert parent_response.status_code == 200
        assert [row["id"] for row in parent_response.json()["students"]] == [assigned_id]
        assert parent_response.json()["scope"] == "linked_students"
        assert "guardian_phone" not in teacher_response.json()["students"][0]
        assert "photo_data" not in teacher_response.json()["students"][0]

        def class_snapshot(device, headers, limit=200):
            return client.get(
                f"/api/sync/classes?device_id={device}&limit={limit}",
                headers=headers,
            )

        admin_classes = class_snapshot(*devices["admin"])
        teacher_classes = class_snapshot(*devices["teacher"])
        parent_classes = class_snapshot(*devices["parent"])
        assert admin_classes.status_code == 200
        assert {row["id"] for row in admin_classes.json()["classes"]} == {school_class_id, other_class_id}
        assert teacher_classes.status_code == 200
        assert [row["id"] for row in teacher_classes.json()["classes"]] == [school_class_id]
        assert teacher_classes.json()["scope"] == "assigned_classes"
        assert parent_classes.status_code == 200
        assert [row["id"] for row in parent_classes.json()["classes"]] == [school_class_id]
        assert parent_classes.json()["scope"] == "linked_students"
        assert set(admin_classes.json()["classes"][0]) == {"id", "name", "section"}

        paged_classes = class_snapshot(*devices["admin"], limit=1)
        assert paged_classes.status_code == 200
        assert len(paged_classes.json()["classes"]) == 1
        assert paged_classes.json()["has_more"] is True
        assert paged_classes.json()["next_after_id"] == paged_classes.json()["classes"][0]["id"]

        wrong_owner = snapshot(devices["admin"][0], teacher_headers)
        assert wrong_owner.status_code == 403
        revoked = client.delete(
            f"/api/sync/devices/{devices['parent'][0]}", headers=parent_headers,
        )
        assert revoked.status_code == 200
        revoked_snapshot = snapshot(*devices["parent"])
        assert revoked_snapshot.status_code == 403


def _register_snapshot_device(client, headers, suffix):
    device_id = f"00000000-0000-4000-8000-{suffix:012d}"
    response = client.post(
        "/api/sync/devices", headers=headers,
        json={"device_id": device_id, "device_name": "Snapshot device"},
    )
    assert response.status_code == 200, response.text
    return device_id


def test_sync_attendance_snapshot_is_scoped_to_linked_children_and_class_teachers():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    db = SessionLocal()
    try:
        assigned_class = models.SchoolClass(name="S1", section="A")
        other_class = models.SchoolClass(name="S2", section="B")
        db.add_all([assigned_class, other_class])
        db.flush()
        child = models.Student(admission_number="ATT-SYNC-1", first_name="A", last_name="One", class_id=assigned_class.id)
        unrelated = models.Student(admission_number="ATT-SYNC-2", first_name="B", last_name="Two", class_id=other_class.id)
        parent = models.User(username="att-parent", email="att-parent@example.invalid", hashed_password=password_hash.hash("ParentPassword123!"), role="parent", is_active=True)
        db.add_all([child, unrelated, parent])
        db.flush()
        db.add_all([
            models.ClassTeacherAssignment(teacher_id=teacher.id, class_id=assigned_class.id),
            models.ParentStudentLink(user_id=parent.id, student_id=child.id),
            models.Attendance(student_id=child.id, attendance_date=date(2026, 3, 1), status="Present"),
            models.Attendance(student_id=unrelated.id, attendance_date=date(2026, 3, 1), status="Absent"),
        ])
        db.commit()
        child_id, unrelated_id, parent_id = child.id, unrelated.id, parent.id
    finally:
        db.close()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}
    parent_headers = {"Authorization": f"Bearer {create_access_token(SimpleNamespace(id=parent_id, role='parent'))}"}
    with TestClient(app) as client:
        admin_device = _register_snapshot_device(client, admin_headers, 401)
        teacher_device = _register_snapshot_device(client, teacher_headers, 402)
        parent_device = _register_snapshot_device(client, parent_headers, 403)
        def get(device, headers):
            return client.get(f"/api/sync/attendance?device_id={device}", headers=headers)
        assert {r["student_id"] for r in get(admin_device, admin_headers).json()["attendance"]} == {child_id, unrelated_id}
        teacher_response = get(teacher_device, teacher_headers)
        assert teacher_response.status_code == 200, teacher_response.text
        assert {r["student_id"] for r in teacher_response.json()["attendance"]} == {child_id}
        parent_response = get(parent_device, parent_headers)
        assert parent_response.status_code == 200, parent_response.text
        assert {r["student_id"] for r in parent_response.json()["attendance"]} == {child_id}
        assert get(admin_device, teacher_headers).status_code == 403


def test_sync_exam_and_mark_snapshots_filter_teacher_subjects_and_parent_verification():
    reset_database()
    admin = create_admin()
    teacher = create_teacher()
    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="S3", section="A")
        other_class = models.SchoolClass(name="S4", section="B")
        biology = models.Subject(name="Biology")
        chemistry = models.Subject(name="Chemistry")
        db.add_all([school_class, other_class, biology, chemistry])
        db.flush()
        child = models.Student(admission_number="EX-SYNC-1", first_name="A", last_name="One", class_id=school_class.id)
        other = models.Student(admission_number="EX-SYNC-2", first_name="B", last_name="Two", class_id=other_class.id)
        parent = models.User(username="exam-parent", email="exam-parent@example.invalid", hashed_password=password_hash.hash("ParentPassword123!"), role="parent", is_active=True)
        exam = models.Exam(name="Mid Term", term="Term 1", year=2026, class_id=school_class.id)
        other_exam = models.Exam(name="Mid Term Other Class", term="Term 1", year=2026, class_id=other_class.id)
        db.add_all([child, other, parent, exam, other_exam])
        db.flush()
        db.add_all([
            models.TeacherAssignment(teacher_id=teacher.id, class_id=school_class.id, subject_id=biology.id),
            models.ParentStudentLink(user_id=parent.id, student_id=child.id),
            models.Mark(student_id=child.id, subject_id=biology.id, exam_id=exam.id, score=80, verified=True),
            models.Mark(student_id=child.id, subject_id=chemistry.id, exam_id=exam.id, score=70, verified=False),
            models.Mark(student_id=other.id, subject_id=biology.id, exam_id=other_exam.id, score=60, verified=False),
        ])
        db.commit()
        child_id, parent_id, exam_id, biology_id, chemistry_id = child.id, parent.id, exam.id, biology.id, chemistry.id
    finally:
        db.close()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(teacher)}"}
    parent_headers = {"Authorization": f"Bearer {create_access_token(SimpleNamespace(id=parent_id, role='parent'))}"}
    with TestClient(app) as client:
        ad = _register_snapshot_device(client, admin_headers, 411)
        td = _register_snapshot_device(client, teacher_headers, 412)
        pd = _register_snapshot_device(client, parent_headers, 413)
        def get(path, device, headers):
            return client.get(f"/api/sync/{path}?device_id={device}", headers=headers)
        assert len(get("exams", td, teacher_headers).json()["exams"]) == 1
        teacher_marks = get("marks", td, teacher_headers).json()["marks"]
        assert {(r["student_id"], r["subject_id"]) for r in teacher_marks} == {(child_id, biology_id)}
        parent_marks = get("marks", pd, parent_headers).json()["marks"]
        assert len(parent_marks) == 1
        assert parent_marks[0]["verified"] is True
        assert parent_marks[0]["student_id"] == child_id
        assert len(get("marks", ad, admin_headers).json()["marks"]) == 3


def test_sync_fee_snapshot_limits_parent_to_linked_children_and_paginates_collections():
    reset_database()
    admin = create_admin()
    db = SessionLocal()
    try:
        school_class = models.SchoolClass(name="P5", section="A")
        db.add(school_class)
        db.flush()
        child = models.Student(admission_number="FEE-SYNC-1", first_name="A", last_name="One", class_id=school_class.id)
        other = models.Student(admission_number="FEE-SYNC-2", first_name="B", last_name="Two", class_id=school_class.id)
        parent = models.User(username="fee-parent", email="fee-parent@example.invalid", hashed_password=password_hash.hash("ParentPassword123!"), role="parent", is_active=True)
        db.add_all([child, other, parent])
        db.flush()
        charge = models.FeeCharge(student_id=child.id, term="Term 1", year=2026, amount=1000)
        other_charge = models.FeeCharge(student_id=other.id, term="Term 1", year=2026, amount=2000)
        class_fee = models.ClassFee(class_id=school_class.id, term="Term 1", year=2026, amount=1000)
        db.add_all([charge, other_charge, class_fee])
        db.flush()
        db.add(models.FeePayment(charge_id=charge.id, amount=300, payment_date=date(2026, 3, 1), receipt_number="SYNC-RCPT-1"))
        db.add(models.ParentStudentLink(user_id=parent.id, student_id=child.id))
        db.commit()
        parent_id, child_id, other_id = parent.id, child.id, other.id
    finally:
        db.close()
    admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
    parent_headers = {"Authorization": f"Bearer {create_access_token(SimpleNamespace(id=parent_id, role='parent'))}"}
    with TestClient(app) as client:
        ad = _register_snapshot_device(client, admin_headers, 421)
        pd = _register_snapshot_device(client, parent_headers, 422)
        admin_data = client.get(f"/api/sync/fees?device_id={ad}&limit=1", headers=admin_headers)
        assert admin_data.status_code == 200, admin_data.text
        assert len(admin_data.json()["charges"]) == 1
        assert admin_data.json()["has_more"]["charges"] is True
        parent_data = client.get(f"/api/sync/fees?device_id={pd}", headers=parent_headers)
        assert parent_data.status_code == 200, parent_data.text
        payload = parent_data.json()
        assert {row["student_id"] for row in payload["charges"]} == {child_id}
        assert len(payload["payments"]) == 1
        assert payload["class_fees"][0]["class_id"] is not None
        assert all("received_by" not in row and "reference" not in row for row in payload["payments"])


def test_sync_offline_proposals_are_idempotent_scoped_and_not_applied():
    reset_database()
    admin=create_admin(); teacher=create_teacher()
    ah={"Authorization":f"Bearer {create_access_token(admin)}"}
    th={"Authorization":f"Bearer {create_access_token(teacher)}"}
    device="00000000-0000-4000-8000-000000000301"
    with TestClient(app) as client:
        assert client.post("/api/sync/devices",headers=ah,json={"device_id":device,"device_name":"Proposal device"}).status_code==200
        db=SessionLocal()
        try:
            student=models.Student(admission_number="OFFLINE-PROP-1",first_name="Amina",last_name="Original")
            db.add(student); db.commit(); sid=student.id
        finally: db.close()
        feed=client.get(f"/api/sync/changes?device_id={device}&cursor=0",headers=ah)
        body={"device_id":device,"idempotency_key":"offline-proposal-key-0001","entity_type":"Student","entity_id":sid,"operation":"update","base_sequence":feed.json()["next_cursor"],"payload":{"last_name":"Offline edit"}}
        first=client.post("/api/sync/proposals",headers=ah,json=body)
        assert first.status_code==200,first.text
        again=client.post("/api/sync/proposals",headers=ah,json=body)
        assert again.status_code==200 and again.json()["duplicate"] is True
        assert again.json()["proposal_id"]==first.json()["proposal_id"]
        assert client.post("/api/sync/proposals",headers=ah,json={**body,"payload":{"last_name":"Different"}}).status_code==409
        assert client.post("/api/sync/proposals",headers=th,json=body).status_code==403
        listed=client.get(f"/api/sync/proposals?device_id={device}",headers=ah)
        assert listed.status_code==200 and len(listed.json()["proposals"])==1
        db=SessionLocal()
        try: assert db.get(models.Student,sid).last_name=="Original"
        finally: db.close()


def test_sync_offline_proposals_detect_conflict_and_rebase_without_applying():
    reset_database(); admin=create_admin()
    headers={"Authorization":f"Bearer {create_access_token(admin)}"}
    device="00000000-0000-4000-8000-000000000302"
    with TestClient(app) as client:
        client.post("/api/sync/devices",headers=headers,json={"device_id":device,"device_name":"Conflict device"})
        db=SessionLocal()
        try:
            student=models.Student(admission_number="OFFLINE-CONFLICT-1",first_name="B",last_name="Before")
            db.add(student); db.commit(); sid=student.id
            base=db.query(func.max(models.SyncChange.id)).scalar() or 0
            student.last_name="Server update"; db.commit()
        finally: db.close()
        assert client.get(f"/api/sync/changes?device_id={device}&cursor=0",headers=headers).status_code==200
        response=client.post("/api/sync/proposals",headers=headers,json={"device_id":device,"idempotency_key":"offline-conflict-key-0001","entity_type":"Student","entity_id":sid,"operation":"update","base_sequence":base,"payload":{"last_name":"Offline version"}})
        assert response.status_code==200 and response.json()["status"]=="conflict"
        pid=response.json()["proposal_id"]
        rebased=client.patch(f"/api/sync/proposals/{pid}/resolution",headers=headers,json={"device_id":device,"decision":"rebase"})
        assert rebased.status_code==200 and rebased.json()["status"]=="pending_review" and rebased.json()["applied"] is False
        assert client.patch(f"/api/sync/proposals/{pid}/resolution",headers=headers,json={"device_id":device,"decision":"discard"}).status_code==409
        db=SessionLocal()
        try: assert db.get(models.Student,sid).last_name=="Server update"
        finally: db.close()
