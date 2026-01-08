"""agregar_campo_can_access_codigos2

Revision ID: g2h3i4j5k6l7
Revises: f1a2b3c4d5e6
Create Date: 2025-01-27 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'g2h3i4j5k6l7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    # Agregar columna can_access_codigos2 a la tabla users
    op.add_column('users', sa.Column('can_access_codigos2', sa.Boolean(), nullable=False, server_default='0'))


def downgrade():
    op.drop_column('users', 'can_access_codigos2')

