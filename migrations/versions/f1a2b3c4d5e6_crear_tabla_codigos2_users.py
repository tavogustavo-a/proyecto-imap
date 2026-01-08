"""crear_tabla_codigos2_users

Revision ID: f1a2b3c4d5e6
Revises: ec1187e75623
Create Date: 2025-01-27 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'ec1187e75623'
branch_labels = None
depends_on = None


def upgrade():
    # Crear tabla de asociación para usuarios con acceso a Códigos 2
    op.create_table('codigos2_users',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('granted_at', sa.DateTime(), nullable=True, server_default=sa.func.current_timestamp()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id')
    )


def downgrade():
    op.drop_table('codigos2_users')

