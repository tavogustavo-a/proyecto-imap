"""asegurar_can_add_own_emails_false_por_defecto

Revision ID: 0f6d63d88a73
Revises: b6dffb52816f
Create Date: 2026-01-06 06:58:58.809346

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0f6d63d88a73'
down_revision = 'b6dffb52816f'
branch_labels = None
depends_on = None


def upgrade():
    # Asegurar que todos los usuarios tengan can_add_own_emails = False por defecto
    op.execute("UPDATE users SET can_add_own_emails = 0 WHERE can_add_own_emails = 1")


def downgrade():
    # No hay necesidad de revertir, ya que solo estamos asegurando el valor por defecto
    pass
