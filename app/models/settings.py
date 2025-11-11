from app.extensions import db
from cryptography.fernet import Fernet

class SiteSettings(db.Model):
    __tablename__ = "site_settings"
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=True)

    def __init__(self, key, value=None):
        self.key = key
        self.value = value

class AppSecrets(db.Model):
    __tablename__ = "app_secrets"
    id = db.Column(db.Integer, primary_key=True)
    key_name = db.Column(db.String(50), unique=True, nullable=False)
    key_value = db.Column(db.Text, nullable=False)

def get_current_imap_key():
    """Obtiene la clave IMAP actual de la base de datos.
    No crea una clave si no existe.
    Lanza una excepción si no se encuentra la clave (debería haber sido creada por una migración).
    """
    row = AppSecrets.query.filter_by(key_name="CURRENT_IMAP_KEY").first()
    if not row:
        # En lugar de crearla, lanzamos un error. La clave DEBE existir.
        raise ValueError("La clave IMAP actual (CURRENT_IMAP_KEY) no se encontró en AppSecrets. Ejecuta las migraciones.")
    return row.key_value

def get_next_imap_key():
    """Obtiene la siguiente clave IMAP planificada. Devuelve None si no existe."""
    row = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()
    if row:
        return row.key_value
    return None
