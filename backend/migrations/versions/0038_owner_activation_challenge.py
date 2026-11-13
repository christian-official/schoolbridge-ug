"""Add single-use five-choice owner activation challenge state.

Revision ID: 0038_owner_activation_challenge
Revises: 0037_registration_claims
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0038_owner_activation_challenge"
down_revision = "0037_registration_claims"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "school_setup_state" not in set(inspector.get_table_names()):
        return
    existing = {column["name"] for column in inspector.get_columns("school_setup_state")}
    additions = [
        ("activation_challenge_id", sa.String(36)),
        ("activation_challenge_options_json", sa.Text()),
        ("activation_correct_option_hash", sa.String(64)),
    ]
    for name, column_type in additions:
        if name not in existing:
            op.add_column("school_setup_state", sa.Column(name, column_type, nullable=True))


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "school_setup_state" not in set(inspector.get_table_names()):
        return
    existing = {column["name"] for column in inspector.get_columns("school_setup_state")}
    for name in ("activation_correct_option_hash", "activation_challenge_options_json", "activation_challenge_id"):
        if name in existing:
            op.drop_column("school_setup_state", name)
