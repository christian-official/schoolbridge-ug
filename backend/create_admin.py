import getpass
from app.database import Base, engine, SessionLocal
from app import models
from pwdlib import PasswordHash

Base.metadata.create_all(bind=engine)
db = SessionLocal()

try:
    setup_state = db.get(models.SchoolSetupState, 1)
    if not setup_state or not setup_state.setup_completed_at:
        raise SystemExit("Complete the owner activation and first-time school setup in the browser before creating administrator accounts.")
    if db.query(models.User).filter_by(role="admin").first():
        print("An administrator already exists.")
    else:
        username = input("Administrator username: ").strip()
        email = input("Administrator email: ").strip()
        password = getpass.getpass("Password (minimum 12 characters): ")
        confirm = getpass.getpass("Confirm password: ")

        if not username or not email:
            raise ValueError("Username and email are required.")
        if len(password) < 12:
            raise ValueError("Password must be at least 12 characters.")
        if password != confirm:
            raise ValueError("Passwords do not match.")

        admin = models.User(
            username=username,
            email=email,
            hashed_password=PasswordHash.recommended().hash(password),
            role="admin",
        )
        db.add(admin)
        db.commit()
        print("Administrator account created successfully.")
finally:
    db.close()
