# app/models/email_forwarding.py

import json
from datetime import datetime

from app.extensions import db

_PLAIN_FOLDERS = {"inbox", "trash", "spam"}


def normalize_folder_keys(raw, empty_as_none=False):
    """
    Claves de carpeta: inbox, trash, spam o tag:<id>.
    Vacío o ausente -> None si empty_as_none, si no ['inbox'].
    """
    if raw is None:
        return None if empty_as_none else ["inbox"]
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None if empty_as_none else ["inbox"]
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError):
            parsed = [part.strip() for part in text.split(",") if part.strip()]
        raw = parsed
    if not isinstance(raw, (list, tuple)):
        return ["inbox"]
    cleaned = []
    seen = set()
    for item in raw:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        if key in _PLAIN_FOLDERS or (key.startswith("tag:") and key[4:].isdigit()):
            seen.add(key)
            cleaned.append(key)
    if not cleaned:
        return None if empty_as_none else ["inbox"]
    return cleaned


class EmailForwarding(db.Model):
    """Modelo para configuración de reenvío de correos vía dominio"""
    
    __tablename__ = 'email_forwarding'
    
    id = db.Column(db.Integer, primary_key=True)
    source_email = db.Column(db.String(255), nullable=True, unique=True, index=True)  # Opcional para catch-all
    destination_email = db.Column(db.String(255), nullable=False)
    title = db.Column(db.String(200), nullable=True)
    folders_json = db.Column(db.Text, nullable=True)
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        source = self.source_email or '[TODOS]'
        return f'<EmailForwarding {source} -> {self.destination_email}>'

    def stored_folder_keys(self):
        """None si la dirección es antigua y no tiene carpetas guardadas."""
        return normalize_folder_keys(self.folders_json, empty_as_none=True)

    def apply_folders(self, raw):
        keys = normalize_folder_keys(raw, empty_as_none=False)
        self.folders_json = json.dumps(keys)
        return keys
    
    def to_dict(self):
        """Convierte el objeto a diccionario"""
        keys = self.stored_folder_keys()
        return {
            'id': self.id,
            'source_email': self.source_email,
            'destination_email': self.destination_email,
            'title': self.title or '',
            'folders': keys if keys is not None else [],
            'enabled': self.enabled,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    @classmethod
    def get_active_forwardings(cls):
        """Obtiene todos los reenvíos activos"""
        return cls.query.filter_by(enabled=True).all()
    
    @classmethod
    def find_by_source_email(cls, source_email):
        """Busca un reenvío por email origen"""
        return cls.query.filter_by(source_email=source_email).first()
    
    def toggle_status(self):
        """Cambia el estado activo/inactivo"""
        self.enabled = not self.enabled
        self.updated_at = datetime.utcnow()
        return self.enabled
    
    @classmethod
    def get_active_forwardings(cls):
        """Obtiene todos los reenvíos activos"""
        return cls.query.filter_by(enabled=True).all()
    
    @classmethod
    def find_by_source_email(cls, source_email):
        """Busca un reenvío por email origen"""
        return cls.query.filter_by(source_email=source_email).first()
    
    def toggle_status(self):
        """Cambia el estado activo/inactivo"""
        self.enabled = not self.enabled
        self.updated_at = datetime.utcnow()
        return self.enabled
