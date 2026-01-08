# app/auth/session_tokens.py
"""
Sistema de tokens de sesión únicos para prevenir sesiones duplicadas.
Almacena tokens en memoria del servidor vinculados a user_id y timestamp.
"""

from secrets import token_urlsafe
from datetime import datetime, timedelta
import threading

# Diccionario en memoria para almacenar tokens activos
# Estructura: {session_token: {"user_id": int, "created_at": datetime, "is_admin": bool}}
_active_session_tokens = {}
_lock = threading.Lock()  # Lock para acceso thread-safe

# Tiempo de expiración de tokens (24 horas)
TOKEN_EXPIRY_HOURS = 24


def generate_session_token(user_id, is_admin=False):
    """
    Genera un token de sesión único y lo almacena en memoria.
    
    Args:
        user_id: ID del usuario
        is_admin: True si es admin, False si es usuario normal
        
    Returns:
        str: Token único de sesión
    """
    token = token_urlsafe(32)
    with _lock:
        _active_session_tokens[token] = {
            "user_id": user_id,
            "created_at": datetime.utcnow(),
            "is_admin": is_admin
        }
    return token


def validate_session_token(token, expected_user_id=None, require_admin=False):
    """
    Valida un token de sesión.
    
    Args:
        token: Token a validar
        expected_user_id: ID de usuario esperado (opcional)
        require_admin: Si True, requiere que el token sea de admin
        
    Returns:
        bool: True si el token es válido, False en caso contrario
    """
    if not token:
        return False
    
    with _lock:
        token_data = _active_session_tokens.get(token)
        
        if not token_data:
            return False
        
        # Verificar expiración
        age = datetime.utcnow() - token_data["created_at"]
        if age > timedelta(hours=TOKEN_EXPIRY_HOURS):
            # Token expirado, eliminarlo
            _active_session_tokens.pop(token, None)
            return False
        
        # Verificar user_id si se proporciona
        if expected_user_id is not None:
            if token_data["user_id"] != expected_user_id:
                return False
        
        # Verificar si requiere admin
        if require_admin:
            if not token_data.get("is_admin", False):
                return False
        
        return True


def revoke_session_token(token):
    """
    Revoca un token de sesión específico.
    
    Args:
        token: Token a revocar
    """
    with _lock:
        _active_session_tokens.pop(token, None)


def revoke_all_user_tokens(user_id):
    """
    Revoca todos los tokens de un usuario específico.
    
    Args:
        user_id: ID del usuario
    """
    with _lock:
        tokens_to_remove = [
            token for token, data in _active_session_tokens.items()
            if data["user_id"] == user_id
        ]
        for token in tokens_to_remove:
            _active_session_tokens.pop(token, None)


def cleanup_expired_tokens():
    """
    Limpia tokens expirados del diccionario.
    """
    now = datetime.utcnow()
    with _lock:
        expired_tokens = [
            token for token, data in _active_session_tokens.items()
            if (now - data["created_at"]) > timedelta(hours=TOKEN_EXPIRY_HOURS)
        ]
        for token in expired_tokens:
            _active_session_tokens.pop(token, None)


def revoke_all_tokens():
    """
    Revoca TODOS los tokens de sesión activos.
    Útil para "cerrar sesión de todos los usuarios".
    """
    with _lock:
        _active_session_tokens.clear()

