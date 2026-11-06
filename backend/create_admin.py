import getpass
from app.database import Base, engine, SessionLocal
from app import models
from pwdlib import PasswordHash

Base.metadata.create_all(bind=engine)
db = SessionLocal()

try:
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
