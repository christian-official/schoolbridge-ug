"""Mark existing demo-school results as unverified for testing.

Revision ID: 0013_demo_results_pending
Revises: 0012_merge_pw_class_teacher
"""
from alembic import op

revision = "0013_demo_results_pending"
down_revision = "0012_merge_pw_class_teacher"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE marks SET verified = false "
        "WHERE student_id IN (SELECT id FROM students WHERE admission_number LIKE 'DEMO-%')"
    )


def downgrade():
    # Verification is an operational decision; do not re-verify demo results on downgrade.
    pass
