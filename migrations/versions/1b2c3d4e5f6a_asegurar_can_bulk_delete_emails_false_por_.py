"""asegurar_can_bulk_delete_emails_false_para_usuarios_existentes

Revision ID: 1b2c3d4e5f6a
Revises: 0a828cc927f4
Create Date: 2026-01-06 15:55:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1b2c3d4e5f6a'
down_revision = '0a828cc927f4'
branch_labels = None
depends_on = None


def upgrade():
    # Asegurar que todos los usuarios tengan can_bulk_delete_emails = False por defecto
    # PostgreSQL requiere usar false/true en lugar de 0/1
    op.execute("UPDATE users SET can_bulk_delete_emails = false WHERE can_bulk_delete_emails = true")


def downgrade():
    pass
