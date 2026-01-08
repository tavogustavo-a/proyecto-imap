"""crear_tabla_imap_servers2

Revision ID: ec1187e75623
Revises: 681c52c34424
Create Date: 2025-11-07 23:23:06.113187

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ec1187e75623'
down_revision = '681c52c34424'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('imap_servers2',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('host', sa.String(length=200), nullable=False),
    sa.Column('port', sa.Integer(), nullable=True),
    sa.Column('username', sa.String(length=200), nullable=False),
    sa.Column('password_enc', sa.String(length=255), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=True),
    sa.Column('folders', sa.String(length=500), server_default='INBOX', nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade():
    op.drop_table('imap_servers2')
