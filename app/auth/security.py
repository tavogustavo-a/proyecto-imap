from datetime import datetime, timedelta
from app.models import User
from app.extensions import db
from config import Config

def is_blocked(username: str) -> bool:
    user = User.query.filter_by(username=username).first()
    if not user:
        return False
    if user.blocked_until and user.blocked_until > datetime.utcnow():
        return True
    return False

def reset_failed_attempts(user: User):
    """Resetea contadores al hacer login exitoso."""
    user.failed_attempts = 0
    user.blocked_until = None
    user.block_count = 0
    # No hacemos commit aquí, se hará en la ruta de login

def record_login_attempt(username: str, success: bool):
    user = User.query.filter_by(username=username).first()
    if not user:
        return

    # Si estaba bloqueado pero el tiempo ya pasó, resetear antes de evaluar el intento actual
    if user.blocked_until and user.blocked_until <= datetime.utcnow():
        user.blocked_until = None
        user.failed_attempts = 0 
        # NO reseteamos block_count aquí, solo al hacer login exitoso

    if success:
        # Si el login es exitoso, reseteamos todo
        reset_failed_attempts(user)
    else:
        # Si el login falla y NO está bloqueado actualmente
        if not (user.blocked_until and user.blocked_until > datetime.utcnow()):
            user.failed_attempts += 1
            # Verificar si alcanzamos el límite de intentos
            if user.failed_attempts >= Config.ALLOWED_ATTEMPTS:
                block_user(user) # Llama a la función que calcula el nuevo tiempo de bloqueo

    # El commit se hace al final de la operación en la ruta de login
    # db.session.commit() <-- Quitar commit de aquí

def block_user(user: User):
    """Calcula y establece el tiempo de bloqueo incrementando la duración."""
    # Asegurarse de que block_count sea un entero antes de incrementar
    if user.block_count is None:
        user.block_count = 0
        
    # Incrementar el contador de bloqueos *antes* de calcular la duración
    user.block_count += 1 
    # La duración base se configura en Config.BLOCK_TIME_MINUTES (p.ej. 5) y escala con el número de bloqueos previos
    block_duration_minutes = Config.BLOCK_TIME_MINUTES * user.block_count 
    user.blocked_until = datetime.utcnow() + timedelta(minutes=block_duration_minutes)
    # Reseteamos los intentos fallidos al aplicar un nuevo bloqueo
    user.failed_attempts = 0 
    # No hacemos commit aquí, se hará en la ruta de login
