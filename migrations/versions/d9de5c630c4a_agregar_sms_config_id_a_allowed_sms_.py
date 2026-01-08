"""agregar_sms_config_id_a_allowed_sms_numbers

Revision ID: d9de5c630c4a
Revises: 6578b75663e6
Create Date: 2025-11-28 07:34:46.392408

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = 'd9de5c630c4a'
down_revision = '6578b75663e6'
branch_labels = None
depends_on = None


def upgrade():
    # Paso 1: Eliminar la restricción única antigua de phone_number
    with op.batch_alter_table('allowed_sms_numbers', schema=None) as batch_op:
        batch_op.drop_index('ix_allowed_sms_numbers_phone_number')
        batch_op.drop_constraint('uq_allowed_sms_number', type_='unique')
    
    # Paso 2: Agregar el campo sms_config_id como nullable primero
    with op.batch_alter_table('allowed_sms_numbers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sms_config_id', sa.Integer(), nullable=True))
    
    # Paso 3: Asignar un sms_config_id a los registros existentes (el primer SMSConfig disponible)
    # Solo si hay registros en allowed_sms_numbers Y hay al menos un SMSConfig
    # Verificar si hay registros que necesiten sms_config_id
    connection = op.get_bind()
    result = connection.execute(text("SELECT COUNT(*) FROM allowed_sms_numbers WHERE sms_config_id IS NULL"))
    count_null = result.scalar()
    
    if count_null > 0:
        # Verificar si hay SMSConfigs disponibles
        result_config = connection.execute(text("SELECT COUNT(*) FROM sms_configs"))
        config_count = result_config.scalar()
        
        if config_count > 0:
            # Asignar el primer SMSConfig disponible a los registros existentes
            op.execute(text("""
                UPDATE allowed_sms_numbers 
                SET sms_config_id = (SELECT id FROM sms_configs LIMIT 1)
                WHERE sms_config_id IS NULL
            """))
        else:
            # Si no hay SMSConfigs pero hay registros, eliminar los registros huérfanos
            # porque no pueden existir sin un sms_config_id válido
            op.execute(text("DELETE FROM allowed_sms_numbers WHERE sms_config_id IS NULL"))
    
    # Paso 4: Hacer el campo NOT NULL y agregar foreign key
    with op.batch_alter_table('allowed_sms_numbers', schema=None) as batch_op:
        batch_op.alter_column('sms_config_id',
               existing_type=sa.Integer(),
               nullable=False)
        batch_op.create_foreign_key('fk_allowed_sms_numbers_sms_config_id', 'sms_configs', ['sms_config_id'], ['id'], ondelete='CASCADE')
        batch_op.create_index('ix_allowed_sms_numbers_sms_config_id', ['sms_config_id'])
    
    # Paso 5: Crear la nueva restricción única compuesta (phone_number, sms_config_id)
    with op.batch_alter_table('allowed_sms_numbers', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_allowed_sms_number_config', ['phone_number', 'sms_config_id'])
        # Recrear el índice de phone_number sin unique
        batch_op.create_index('ix_allowed_sms_numbers_phone_number', ['phone_number'])


def downgrade():
    # Revertir los cambios
    with op.batch_alter_table('allowed_sms_numbers', schema=None) as batch_op:
        # Eliminar la restricción única compuesta
        batch_op.drop_constraint('uq_allowed_sms_number_config', type_='unique')
        # Eliminar foreign key e índice de sms_config_id
        batch_op.drop_constraint('fk_allowed_sms_numbers_sms_config_id', type_='foreignkey')
        batch_op.drop_index('ix_allowed_sms_numbers_sms_config_id')
        # Eliminar el índice de phone_number
        batch_op.drop_index('ix_allowed_sms_numbers_phone_number')
        # Eliminar la columna sms_config_id
        batch_op.drop_column('sms_config_id')
        # Recrear la restricción única antigua
        batch_op.create_unique_constraint('uq_allowed_sms_number', ['phone_number'])
        batch_op.create_index('ix_allowed_sms_numbers_phone_number', ['phone_number'], unique=True)
