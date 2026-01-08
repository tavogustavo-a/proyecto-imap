"""make_youtube_listing_content_optional

Revision ID: 681c52c34424
Revises: ac9bfea3ff09
Create Date: 2025-11-06 15:07:37.482053

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '681c52c34424'
down_revision = 'ac9bfea3ff09'
branch_labels = None
depends_on = None


def upgrade():
    # SQLite no soporta ALTER COLUMN directamente, usar batch_alter_table
    with op.batch_alter_table('store_youtube_listings', schema=None) as batch_op:
        batch_op.alter_column('content',
                            existing_type=sa.Text(),
                            nullable=True)


def downgrade():
    # Revertir: hacer que la columna content sea obligatoria (nullable=False)
    # Primero actualizar cualquier valor NULL a una cadena vacía
    op.execute("UPDATE store_youtube_listings SET content = '' WHERE content IS NULL")
    with op.batch_alter_table('store_youtube_listings', schema=None) as batch_op:
        batch_op.alter_column('content',
                            existing_type=sa.Text(),
                            nullable=False)
