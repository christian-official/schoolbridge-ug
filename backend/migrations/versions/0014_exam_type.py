"""Add exam type categorisation for the examinations workspace.

Revision ID: 0014_exam_type
Revises: 0013_demo_results_pending
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_exam_type"
down_revision = "0013_demo_results_pending"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("exams", sa.Column("exam_type", sa.String(length=40), nullable=False, server_default="Other"))
    op.execute("""
        UPDATE exams
        SET exam_type = CASE
            WHEN lower(name) LIKE '%beginning%' OR lower(name) LIKE '%opening%' THEN 'Beginning of Term'
            WHEN lower(name) LIKE '%mid-term%' OR lower(name) LIKE '%mid term%' OR lower(name) LIKE '%midterm%' THEN 'Mid-Term'
            WHEN lower(name) LIKE '%end of term%' OR lower(name) LIKE '%end-term%' THEN 'End of Term'
            WHEN lower(name) LIKE '%mock%' THEN 'Mock'
            WHEN lower(name) LIKE '%promotion%' OR lower(name) LIKE '%promotional%' THEN 'Promotional'
            ELSE 'Other'
        END
    """)


def downgrade():
    op.drop_column("exams", "exam_type")
