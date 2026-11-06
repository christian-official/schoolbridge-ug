from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from .database import get_db
from . import models

router = APIRouter()


class StaffCreate(BaseModel):
    staff_number: str = Field(min_length=1, max_length=40)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    category: str = Field(default="Teaching", pattern="^(Teaching|Non-teaching)$")
    job_title: str = Field(min_length=1, max_length=100)
    department: str | None = None
    phone: str | None = None
    email: str | None = None
    employment_status: str = "Active"


class FeeStructureCreate(BaseModel):
    class_id: int
    academic_year: int = Field(ge=2000, le=2200)
    term: str = Field(pattern="^Term [123]$")
    amount: int = Field(gt=0)
    description: str = "Tuition and school fees"


class FeeChargeCreate(BaseModel):
    student_id: int
    academic_year: int = Field(ge=2000, le=2200)
    term: str = Field(pattern="^Term [123]$")
    description: str = Field(min_length=1, max_length=160)
    amount: int = Field(gt=0)


class FeePaymentCreate(BaseModel):
    student_id: int
    academic_year: int = Field(ge=2000, le=2200)
    term: str = Field(pattern="^Term [123]$")
    amount: int = Field(gt=0)
    payment_method: str = "Cash"
    reference: str | None = None
    received_by: str | None = None
    notes: str | None = None


@router.get("/api/students/page", tags=["Students"])
def paged_students(
    q: str = Query(default="", max_length=120),
    class_id: int | None = None,
    gender: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=5, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(models.Student)
    if q.strip():
        term = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            func.lower(models.Student.admission_number).like(term),
            func.lower(models.Student.first_name).like(term),
            func.lower(models.Student.middle_name).like(term),
            func.lower(models.Student.last_name).like(term),
            func.lower(models.Student.first_name + " " + models.Student.last_name).like(term),
        ))
    if class_id is not None:
        query = query.filter(models.Student.class_id == class_id)
    if gender:
        query = query.filter(models.Student.gender == gender)
    total = query.count()
    rows = query.order_by(models.Student.last_name, models.Student.first_name).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{
            "id": s.id, "admission_number": s.admission_number,
            "first_name": s.first_name, "middle_name": s.middle_name,
            "last_name": s.last_name, "gender": s.gender,
            "class_id": s.class_id, "religion": s.religion,
            "guardian_name": s.guardian_name, "guardian_phone": s.guardian_phone,
        } for s in rows],
        "total": total, "page": page, "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/api/staff", tags=["Staff"])
def list_staff(
    q: str = Query(default="", max_length=120),
    category: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=5, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(models.StaffMember)
    if q.strip():
        term = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            func.lower(models.StaffMember.staff_number).like(term),
            func.lower(models.StaffMember.first_name).like(term),
            func.lower(models.StaffMember.last_name).like(term),
            func.lower(models.StaffMember.job_title).like(term),
        ))
    if category:
        query = query.filter(models.StaffMember.category == category)
    total = query.count()
    rows = query.order_by(models.StaffMember.last_name).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [{
        "id": s.id, "staff_number": s.staff_number, "first_name": s.first_name,
        "last_name": s.last_name, "category": s.category, "job_title": s.job_title,
        "department": s.department, "phone": s.phone, "email": s.email,
        "employment_status": s.employment_status,
    } for s in rows], "total": total, "page": page, "page_size": page_size,
        "pages": (total + page_size - 1) // page_size}


@router.post("/api/staff", tags=["Staff"])
def create_staff(data: StaffCreate, db: Session = Depends(get_db)):
    item = models.StaffMember(**data.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That staff number is already in use.")
    return {"id": item.id, "staff_number": item.staff_number, "message": "Staff member added."}


@router.get("/api/finance/fee-structures", tags=["Finance"])
def list_fee_structures(db: Session = Depends(get_db)):
    return [{
        "id": f.id, "class_id": f.class_id, "academic_year": f.academic_year,
        "term": f.term, "amount": f.amount, "description": f.description,
    } for f in db.query(models.FeeStructure).order_by(models.FeeStructure.academic_year.desc(), models.FeeStructure.term).all()]


@router.post("/api/finance/fee-structures", tags=["Finance"])
def create_fee_structure(data: FeeStructureCreate, db: Session = Depends(get_db)):
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found.")
    item = models.FeeStructure(**data.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A fee structure already exists for this class, year and term.")
    return {"id": item.id, "message": "Class fee structure saved."}


@router.post("/api/finance/charges", tags=["Finance"])
def create_fee_charge(data: FeeChargeCreate, db: Session = Depends(get_db)):
    if not db.get(models.Student, data.student_id):
        raise HTTPException(404, "Student not found.")
    item = models.FeeCharge(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "message": "Fee charge recorded."}


@router.post("/api/finance/payments", tags=["Finance"])
def record_fee_payment(data: FeePaymentCreate, db: Session = Depends(get_db)):
    if not db.get(models.Student, data.student_id):
        raise HTTPException(404, "Student not found.")
    item = models.FeePayment(**data.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That payment reference has already been used.")
    return {"id": item.id, "message": "Payment recorded successfully.", "paid_at": item.paid_at}


@router.get("/api/finance/student/{student_id}", tags=["Finance"])
def student_finance(student_id: int, db: Session = Depends(get_db)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    charges = db.query(models.FeeCharge).filter_by(student_id=student_id).order_by(models.FeeCharge.academic_year.desc()).all()
    payments = db.query(models.FeePayment).filter_by(student_id=student_id).order_by(models.FeePayment.paid_at.desc()).all()
    charge_total = sum(c.amount for c in charges)
    payment_total = sum(p.amount for p in payments)
    return {
        "student_id": student_id, "admission_number": student.admission_number,
        "student_name": f"{student.first_name} {student.last_name}",
        "total_charged": charge_total, "total_paid": payment_total,
        "balance": charge_total - payment_total,
        "charges": [{"id": c.id, "year": c.academic_year, "term": c.term, "description": c.description, "amount": c.amount} for c in charges],
        "payments": [{"id": p.id, "year": p.academic_year, "term": p.term, "amount": p.amount, "method": p.payment_method, "reference": p.reference, "paid_at": p.paid_at} for p in payments],
    }


@router.get("/api/finance/summary", tags=["Finance"])
def finance_summary(academic_year: int | None = None, db: Session = Depends(get_db)):
    charges = db.query(func.coalesce(func.sum(models.FeeCharge.amount), 0))
    payments = db.query(func.coalesce(func.sum(models.FeePayment.amount), 0))
    if academic_year is not None:
        charges = charges.filter(models.FeeCharge.academic_year == academic_year)
        payments = payments.filter(models.FeePayment.academic_year == academic_year)
    charged = int(charges.scalar() or 0)
    paid = int(payments.scalar() or 0)
    return {"fees_expected": charged, "fees_collected": paid, "outstanding": charged - paid}


@router.get("/api/dashboard/summary", tags=["Dashboard"])
def dashboard_summary(db: Session = Depends(get_db)):
    student_count = db.query(func.count(models.Student.id)).scalar() or 0
    class_count = db.query(func.count(models.SchoolClass.id)).scalar() or 0
    staff_count = db.query(func.count(models.StaffMember.id)).scalar() or 0
    finance = finance_summary(None, db)
    return {"students": student_count, "classes": class_count, "staff": staff_count, **finance}
