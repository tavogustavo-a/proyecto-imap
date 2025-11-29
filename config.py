import os
from datetime import timedelta

basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    FLASK_ENV = os.getenv("FLASK_ENV", "development")
    DEBUG = (FLASK_ENV == "development")
    
    BLOCK_TIME_MINUTES = int(os.getenv("BLOCK_TIME_MINUTES", 5))
    ALLOWED_ATTEMPTS = int(os.getenv("ALLOWED_ATTEMPTS", 5))

    ADMIN_USER = os.getenv("ADMIN_USER") or ("admin" if FLASK_ENV == "development" else None)
    ADMIN_PASS = os.getenv("ADMIN_PASS") or ("adminpass" if FLASK_ENV == "development" else None)

    if FLASK_ENV != "development" and (not ADMIN_USER or not ADMIN_PASS):
        raise RuntimeError("ADMIN_USER y ADMIN_PASS deben estar definidos en producción.")

    DATABASE_PATH = os.path.join(basedir, 'dev.db')
    DATABASE_URI = os.getenv("DATABASE_URI", "sqlite:///dev.db")
    SQLALCHEMY_DATABASE_URI = DATABASE_URI
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    TWOFA_KEY = os.getenv("TWOFA_KEY")
    if not TWOFA_KEY:
        if FLASK_ENV == "development":
            TWOFA_KEY = "Z3B3dHBCQ3I0R2lCTHFnTE9CZ1FtZ3k2RXB4OXlnQ2g="
            print("[WARN] Usando TWOFA_KEY insegura por defecto SOLO para desarrollo.")
        else:
            raise RuntimeError("TWOFA_KEY no configurada en entorno de producción.")
    TWOFA_METHOD = os.getenv("TWOFA_METHOD", "TOTP")

    # ===== CONFIGURACIÓN SERVIDOR SMTP =====
    # Puerto 25 para recepción de emails (SMTP entrante)
    # Puerto 587 para envío de emails (SMTP saliente)
    
    # Puerto SMTP para recibir emails
    SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
    SMTP_HOST = os.getenv("SMTP_HOST", "0.0.0.0")
    
    # Puerto SMTP para enviar emails (reply/forward)
    SMTP_SEND_PORT = int(os.getenv("SMTP_SEND_PORT", "587"))
    SMTP_SEND_HOST = os.getenv("SMTP_SEND_HOST", "127.0.0.1")

    # Para sesión permanente de 15 días
    PERMANENT_SESSION_LIFETIME = timedelta(days=15)

    # Si estás en producción, setea estas variables en .env
    SESSION_COOKIE_SECURE_ENV = os.getenv("SESSION_COOKIE_SECURE")
    if SESSION_COOKIE_SECURE_ENV is not None:
        # Si está configurado en .env, usar ese valor
        SESSION_COOKIE_SECURE = (SESSION_COOKIE_SECURE_ENV == "True")
    else:
        # Si no está configurado, usar False en desarrollo y True en producción
        SESSION_COOKIE_SECURE = (FLASK_ENV != "development")
        if FLASK_ENV == "development":
            print("[INFO] SESSION_COOKIE_SECURE=False en desarrollo (permite HTTP).")
    
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
    SESSION_COOKIE_HTTPONLY = (os.getenv("SESSION_COOKIE_HTTPONLY", "True") == "True")

    # Tamaño del pool gevent (para búsqueda IMAP en paralelo)
    GEVENT_POOL_SIZE = int(os.getenv("GEVENT_POOL_SIZE", "40"))
    
    # ✅ NUEVO: Configuración para archivos grandes
    MAX_CONTENT_LENGTH = 1000 * 1024 * 1024  # 1GB máximo
    MAX_CONTENT_PATH = None  # Sin límite de ruta
    
    # ✅ NUEVO: Configuración para SocketIO
    SOCKETIO_HOST = os.getenv('SOCKETIO_HOST', '0.0.0.0')
    SOCKETIO_PORT = int(os.getenv('SOCKETIO_PORT', 5001))
    SOCKETIO_DEBUG = (FLASK_ENV == 'development')
    SOCKETIO_CORS_ORIGINS = os.getenv('SOCKETIO_CORS_ORIGINS')
    if not SOCKETIO_CORS_ORIGINS:
        if FLASK_ENV == "development":
            SOCKETIO_CORS_ORIGINS = "*"
            print("[WARN] Usando SOCKETIO_CORS_ORIGINS='*' (permite todos los orígenes) SOLO para desarrollo.")
        else:
            raise RuntimeError("SOCKETIO_CORS_ORIGINS no configurada en entorno de producción.")



    # --- Seguridad ---------------------------------------------------------
    ADMIN_CONFIG_SECURITY_CODE = os.getenv("ADMIN_CONFIG_SECURITY_CODE")
    if not ADMIN_CONFIG_SECURITY_CODE:
        if FLASK_ENV == "development":
            ADMIN_CONFIG_SECURITY_CODE = "cambia-esto-en-produccion"
            print("[WARN] Usando ADMIN_CONFIG_SECURITY_CODE insegura por defecto SOLO para desarrollo.")
        else:
            raise RuntimeError("ADMIN_CONFIG_SECURITY_CODE no configurada en entorno de producción.")
    SECRET_KEY = os.getenv("SECRET_KEY")
    if not SECRET_KEY:
        if FLASK_ENV == "development":
            SECRET_KEY = "dev-secret-key-change-me"
            print("[WARN] Usando SECRET_KEY insegura por defecto SOLO para desarrollo.")
        else:
            raise RuntimeError("SECRET_KEY no configurada en entorno de producción.")