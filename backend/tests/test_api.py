import os
import sqlite3

# Configure an isolated SQLite database before importing the application.
os.environ["SCHOOLBRIDGE_DATABASE_URL"] = "sqlite:///./schoolbridge_test.db"
os.environ["SCHOOLBRIDGE_SECRET_KEY"] = "test-only-secret-key-that-is-not-used-in-production"

from fastapi.testclient import TestClient
from types import SimpleNamespace

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
    with sqlite3.connect(str(backup_path)) as backup_db:
        backup_db.execute(
            "INSERT INTO users (username, email, hashed_password, role, is_active) "
            "VALUES (?, ?, ?, ?, ?)",
            ("backup-only-teacher", "backup-only@example.invalid", "test-hash", "teacher", 1),
        )

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
