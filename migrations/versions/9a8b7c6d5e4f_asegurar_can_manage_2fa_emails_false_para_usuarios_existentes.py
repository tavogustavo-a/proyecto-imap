"""asegurar_can_manage_2fa_emails_false_para_usuarios_existentes

Revision ID: 9a8b7c6d5e4f
Revises: 7804b37b6572
Create Date: 2026-01-06 17:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9a8b7c6d5e4f'
down_revision = '7804b37b6572'
branch_labels = None
depends_on = None


def upgrade():
    # Asegurar que todos los usuarios tengan can_manage_2fa_emails = False por defecto
    # PostgreSQL requiere usar false/true en lugar de 0/1
    # SQLite también acepta false/true, pero si falla usaremos 0/1
    try:
        op.execute("UPDATE users SET can_manage_2fa_emails = false WHERE can_manage_2fa_emails = true")
    except:
        # Si falla con false/true (SQLite antiguo), usar 0/1
        op.execute("UPDATE users SET can_manage_2fa_emails = 0 WHERE can_manage_2fa_emails = 1")


def downgrade():
    pass
