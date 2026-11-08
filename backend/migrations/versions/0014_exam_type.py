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


def _has_exam_type(bind):
    return any(column["name"] == "exam_type" for column in sa.inspect(bind).get_columns("exams"))


def upgrade():
    bind = op.get_bind()
    # The test suite creates tables from current SQLAlchemy metadata before
    # applying migrations. In that case the column already exists.
    if not _has_exam_type(bind):
        op.add_column(
            "exams",
            sa.Column("exam_type", sa.String(length=40), nullable=False, server_default="Other"),
        )

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
        WHERE exam_type IS NULL OR exam_type = '' OR exam_type = 'Other'
    """)


def downgrade():
    bind = op.get_bind()
    if _has_exam_type(bind):
        op.drop_column("exams", "exam_type")
