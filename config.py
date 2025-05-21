import os
from datetime import timedelta

basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    FLASK_ENV = os.getenv("FLASK_ENV", "production")
    DEBUG = (FLASK_ENV == "development")
    
    BLOCK_TIME_MINUTES = int(os.getenv("BLOCK_TIME_MINUTES", 5))
    ALLOWED_ATTEMPTS = int(os.getenv("ALLOWED_ATTEMPTS", 5))

    ADMIN_USER = os.getenv("ADMIN_USER") or ("admin" if FLASK_ENV == "development" else None)
    ADMIN_PASS = os.getenv("ADMIN_PASS") or ("adminpass" if FLASK_ENV == "development" else None)

    if FLASK_ENV != "development" and (not ADMIN_USER or not ADMIN_PASS):
        raise RuntimeError("ADMIN_USER y ADMIN_PASS deben estar definidos en producción.")

    DATABASE_PATH = os.path.join(basedir, 'dev.db')
    DATABASE_URI = os.getenv("DATABASE_URI", "sqlite:///dev.db")  #"postgresql://gustavo1994:1946899fnd@localhost:5432/imapdb")
    SQLALCHEMY_DATABASE_URI = DATABASE_URI
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    TWOFA_KEY = os.getenv("TWOFA_KEY", "Z3B3dHBCQ3I0R2lCTHFnTE9CZ1FtZ3k2RXB4OXlnQ2g=")
    TWOFA_METHOD = os.getenv("TWOFA_METHOD", "TOTP")

    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

    # Para inactividad de 48 horas
    PERMANENT_SESSION_LIFETIME = timedelta(hours=48)

    # Si estás en producción, setea estas variables en .env
    SESSION_COOKIE_SECURE = (os.getenv("SESSION_COOKIE_SECURE", "True") == "True")
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
    SESSION_COOKIE_HTTPONLY = (os.getenv("SESSION_COOKIE_HTTPONLY", "True") == "True")

    # Tamaño del pool gevent (para búsqueda IMAP en paralelo)
    GEVENT_POOL_SIZE = int(os.getenv("GEVENT_POOL_SIZE", "40"))

    # --- Seguridad ---------------------------------------------------------
    ADMIN_CONFIG_SECURITY_CODE = os.getenv("ADMIN_CONFIG_SECURITY_CODE", "cambia-esto-en-produccion")
    SECRET_KEY = os.getenv("SECRET_KEY")
    if not SECRET_KEY:
        if FLASK_ENV == "development":
            SECRET_KEY = "dev-secret-key-change-me"
            print("[WARN] Usando SECRET_KEY insegura por defecto SOLO para desarrollo.")
        else:
            raise RuntimeError("SECRET_KEY no configurada en entorno de producción.")